'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { iv } from './inventory-styles';
import {
    createItem,
    fetchAliasesFor,
    fetchGlobalConversions,
    fetchItems,
    fetchPackConversions,
    findSupplierByName,
    downscaleImage,
    savePurchase,
    scanReceipt,
    uploadReceiptImage,
} from '@/lib/inventory-api';
import {
    convertToBaseQty,
    formatCop,
    getBogotaDateString,
    groupPacksByItem,
    isIsoDate,
    normaliseDescription,
    parseCopInput,
    parseQtyInput,
} from '@/lib/inventory-units';
import type {
    BaseUnit,
    DraftLine,
    GlobalUnitConversion,
    InventoryItem,
    PackConversion,
    PaymentMethod,
    PurchaseSource,
    ScanResult,
} from '@/lib/inventory-types';

interface Props {
    adminId: string;
    onSaved: () => void;
    onCancel: () => void;
}

let keyCounter = 0;
const nextKey = () => `line-${++keyCounter}`;

function emptyLine(): DraftLine {
    return {
        key: nextKey(),
        description: '',
        barcode: null,
        barcode_unreliable: false,
        qty: null,
        unit_label: null,
        unit_cost_cop: null,
        line_total_cop: null,
        item_id: null,
        auto_matched: false,
        base_qty: null,
        conversion_error: null,
        qty_input: '',
        line_total_input: '',
    };
}

function numberToInput(value: number | null | undefined): string {
    return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
}

export default function ReceiptScanner({ adminId, onSaved, onCancel }: Props) {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [packs, setPacks] = useState<PackConversion[]>([]);
    const [globals, setGlobals] = useState<GlobalUnitConversion[]>([]);

    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [scan, setScan] = useState<ScanResult | null>(null);
    // Stored alongside the extraction so a disputed line can be checked
    // against the original document later.
    const [imagePath, setImagePath] = useState<string | null>(null);
    const [imageUploading, setImageUploading] = useState(false);
    const [lines, setLines] = useState<DraftLine[]>([]);

    const [supplierName, setSupplierName] = useState('');
    const [supplierNit, setSupplierNit] = useState('');
    const [purchasedOn, setPurchasedOn] = useState(getBogotaDateString());
    const [source, setSource] = useState<PurchaseSource>('manual');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
    const [documentTotal, setDocumentTotal] = useState<string>('');
    const [documentNumber, setDocumentNumber] = useState('');
    const [note, setNote] = useState('');

    const fileRef = useRef<HTMLInputElement>(null);

    const loadReference = useCallback(async () => {
        try {
            const [i, p, g] = await Promise.all([fetchItems(), fetchPackConversions(), fetchGlobalConversions()]);
            setItems(i);
            setPacks(p);
            setGlobals(g);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the item catalog.');
        }
    }, []);

    useEffect(() => {
        loadReference();
    }, [loadReference]);

    useEffect(() => {
        if (!file) {
            setPreviewUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

    const packsByItem = useMemo(() => groupPacksByItem(packs), [packs]);

    const computeBaseQty = useCallback(
        (line: DraftLine): { base_qty: number | null; conversion_error: string | null } => {
            if (!line.item_id) return { base_qty: null, conversion_error: null };
            const item = itemsById.get(line.item_id);
            if (!item) return { base_qty: null, conversion_error: 'Item not found' };

            const result = convertToBaseQty({
                qty: line.qty,
                unitLabel: line.unit_label,
                baseUnit: item.base_unit,
                packConversions: packsByItem.get(item.id) ?? [],
                globalConversions: globals,
            });
            return { base_qty: result.baseQty, conversion_error: result.error };
        },
        [itemsById, packsByItem, globals],
    );

    // Re-derive conversions whenever the catalog or conversion tables change.
    useEffect(() => {
        setLines(prev => prev.map(line => ({ ...line, ...computeBaseQty(line) })));
    }, [computeBaseQty]);

    async function runScan(selected: File) {
        setError('');
        setScanning(true);
        try {
            const prepared = await downscaleImage(selected);
            const result = await scanReceipt(selected, adminId, prepared);

            // Warnings are added before the object reaches state. Mutating it
            // afterwards only rendered because another setState happened to
            // follow in the same batch.
            if (result.purchased_on && !isIsoDate(result.purchased_on)) {
                result.warnings = [
                    ...result.warnings,
                    `Could not read the date ("${result.purchased_on}") — check it before saving.`,
                ];
            }

            setScan(result);

            // Runs alongside the review so the reviewer is not kept waiting,
            // but confirming is blocked until it settles — otherwise a quick
            // confirm saves the purchase with no document attached, which is
            // exactly the evidence this is meant to preserve. Reuses the bytes
            // already downscaled above rather than decoding the photo again.
            setImageUploading(true);
            void uploadReceiptImage(selected, prepared)
                .then(setImagePath)
                .finally(() => setImageUploading(false));

            if (result.merchant_name) setSupplierName(result.merchant_name);
            if (result.merchant_nit) setSupplierNit(result.merchant_nit);
            if (result.document_number) setDocumentNumber(result.document_number);
            if (result.document_total_cop != null) setDocumentTotal(String(result.document_total_cop));
            if (result.payment_method) setPaymentMethod(result.payment_method);
            if (result.reference_note) setNote(result.reference_note);

            // A non-ISO date would leave the date input rendering blank while
            // state kept the bad string — an apparently empty required field
            // with Save still enabled, and a failed insert at the end of it.
            if (isIsoDate(result.purchased_on)) {
                setPurchasedOn(result.purchased_on);
            }

            setSource(
                result.doc_type === 'itemized_receipt'
                    ? 'receipt_scan'
                    : result.doc_type === 'transfer'
                        ? 'transfer'
                        : 'manual',
            );

            // Descriptions only identify a product within one supplier's
            // printing, so alias matching is scoped to the supplier on the
            // document. An unknown supplier matches on barcode alone.
            let supplierId: string | null = null;
            if (result.merchant_name) {
                supplierId = await findSupplierByName(result.merchant_name).catch(() => null);
            }

            const aliases = await fetchAliasesFor({
                barcodes: result.lines
                    .filter(l => l.barcode && !l.barcode_unreliable)
                    .map(l => String(l.barcode).trim()),
                descriptions: result.lines.map(l => normaliseDescription(l.description)),
                supplierId,
            }).catch(() => []);

            const byBarcode = new Map<string, string>();
            const byDescription = new Map<string, string>();
            for (const alias of aliases) {
                if (alias.alias_type === 'barcode') byBarcode.set(alias.value.trim(), alias.item_id);
                else byDescription.set(alias.value, alias.item_id);
            }

            const drafted: DraftLine[] = result.lines.map(line => {
                const unreliable = Boolean(line.barcode_unreliable);
                const itemId =
                    (line.barcode && !unreliable ? byBarcode.get(String(line.barcode).trim()) : undefined) ??
                    byDescription.get(normaliseDescription(line.description)) ??
                    null;

                const base: DraftLine = {
                    ...line,
                    key: nextKey(),
                    barcode_unreliable: unreliable,
                    item_id: itemId,
                    auto_matched: Boolean(itemId),
                    base_qty: null,
                    conversion_error: null,
                    qty_input: numberToInput(line.qty),
                    line_total_input: numberToInput(line.line_total_cop),
                };
                return { ...base, ...computeBaseQty(base) };
            });

            setLines(drafted);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Scan failed.');
        } finally {
            setScanning(false);
        }
    }

    function handleFile(selected: File | null) {
        if (!selected) return;
        setFile(selected);
        setScan(null);
        setLines([]);
        runScan(selected);
    }

    function updateLine(key: string, patch: Partial<DraftLine>) {
        setLines(prev =>
            prev.map(line => {
                if (line.key !== key) return line;
                const merged = { ...line, ...patch };
                // Any manual edit means this is no longer an unreviewed guess.
                if ('item_id' in patch) merged.auto_matched = false;
                return { ...merged, ...computeBaseQty(merged) };
            }),
        );
    }

    async function quickCreateItem(line: DraftLine) {
        const name = window.prompt('New item name', line.description.trim());
        if (!name || !name.trim()) return;

        const unit = window.prompt('Base unit — type g, ml, or unidad', 'g');
        const baseUnit = (unit ?? '').trim().toLowerCase();
        if (!['g', 'ml', 'unidad'].includes(baseUnit)) {
            setError('Base unit must be g, ml or unidad.');
            return;
        }

        try {
            // Asked here too: an item with no area never appears on an
            // area-scoped count sheet, which is how the bar and the kitchen are
            // counted separately.
            const area = (window.prompt(
                'Where is it kept? kitchen, bar, fridge, freezer, dry_store — or leave blank',
                'kitchen',
            ) ?? '').trim().toLowerCase();

            const created = await createItem({
                name: name.trim(),
                base_unit: baseUnit as BaseUnit,
                category: 'ingredient',
                storage_area: (['kitchen', 'bar', 'fridge', 'freezer', 'dry_store', 'other'].includes(area)
                    ? area : null) as InventoryItem['storage_area'],
                item_type: 'raw',
            });
            setItems(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
            updateLine(line.key, { item_id: created.id });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the item.');
        }
    }

    const lineSum = useMemo(
        () => lines.reduce((total, line) => total + (line.line_total_cop ?? 0), 0),
        [lines],
    );

    const parsedDocTotal = parseCopInput(documentTotal);
    const docTotalInvalid = documentTotal.trim() !== '' && parsedDocTotal === null;
    const totalsMatch =
        parsedDocTotal === null || lines.length === 0 || Math.abs(lineSum - parsedDocTotal) < 1;

    const unmapped = lines.filter(line => !line.item_id).length;
    const unconverted = lines.filter(line => line.item_id && line.base_qty === null).length;
    // A line with text in the amount box that does not parse would otherwise be
    // saved as a null total and quietly break reconciliation.
    const unreadableAmounts = lines.filter(
        line =>
            (line.qty_input.trim() !== '' && line.qty === null) ||
            (line.line_total_input.trim() !== '' && line.line_total_cop === null),
    ).length;

    const canSave =
        !saving &&
        !imageUploading &&
        supplierName.trim() !== '' &&
        isIsoDate(purchasedOn) &&
        unmapped === 0 &&
        unconverted === 0 &&
        unreadableAmounts === 0 &&
        !docTotalInvalid;

    async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        setError('');
        try {
            await savePurchase({
                supplierName,
                supplierNit: supplierNit || null,
                purchasedOn,
                source,
                paymentMethod: paymentMethod || null,
                documentTotalCop: parsedDocTotal,
                documentNumber: documentNumber || null,
                imagePath,
                note: note || null,
                aiRaw: scan,
                aiWarnings: scan?.warnings ?? [],
                lines,
                actorId: adminId || null,
            });
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the purchase.');
            setSaving(false);
        }
    }

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <h3 style={iv.sectionTitle}>New purchase</h3>
                <button style={iv.btnGhost} onClick={onCancel}>Cancel</button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}

            {/* ── Upload ── */}
            {!scan && (
                <div
                    style={{ ...iv.dropZone, ...(dragging ? iv.dropZoneActive : {}) }}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => {
                        e.preventDefault();
                        setDragging(false);
                        handleFile(e.dataTransfer.files?.[0] ?? null);
                    }}
                >
                    {scanning ? (
                        <>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
                            <div style={{ color: '#f0b427', fontWeight: 600 }}>Reading the document…</div>
                            <div style={{ fontSize: 11, marginTop: 6 }}>Usually 5–25 seconds.</div>
                        </>
                    ) : (
                        <>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>🧾</div>
                            <div style={{ color: '#ccc', fontWeight: 600 }}>Drop a receipt photo here, or click to choose</div>
                            <div style={{ fontSize: 11, marginTop: 6 }}>
                                Till receipts, invoices, bank transfer screenshots. JPG, PNG or PDF.
                            </div>
                        </>
                    )}
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*,application/pdf"
                        style={{ display: 'none' }}
                        onChange={e => handleFile(e.target.files?.[0] ?? null)}
                    />
                </div>
            )}

            {!scan && !scanning && (
                <div style={{ textAlign: 'center' }}>
                    <button
                        style={iv.btnGhost}
                        onClick={() => {
                            setScan({ doc_type: 'unknown', lines: [], warnings: [] });
                            setSource('manual');
                            setLines([emptyLine()]);
                        }}
                    >
                        Skip the photo and type it in
                    </button>
                    <p style={{ ...iv.hint, marginTop: 8 }}>
                        Most purchases paid by bank transfer have no itemised receipt. Typing them in is the normal path, not a fallback.
                    </p>
                </div>
            )}

            {/* ── Review ── */}
            {scan && (
                <>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        {previewUrl && file?.type.startsWith('image/') && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={previewUrl} alt="Uploaded document" style={iv.preview} />
                        )}
                        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {scan.doc_type !== 'unknown' && (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ ...iv.badge, ...iv.badgeInfo }}>
                                        {scan.doc_type === 'itemized_receipt'
                                            ? 'ITEMISED RECEIPT'
                                            : scan.doc_type === 'transfer'
                                                ? 'BANK TRANSFER'
                                                : scan.doc_type === 'card_slip'
                                                    ? 'CARD SLIP'
                                                    : 'UNRECOGNISED'}
                                    </span>
                                    {scan.model_used && <span style={iv.tdMono}>{scan.model_used}</span>}
                                </div>
                            )}

                            {(scan.doc_type === 'transfer' || scan.doc_type === 'card_slip') && (
                                <div style={iv.warnBox}>
                                    This document shows an amount but no products, so nothing can be added to stock
                                    from it automatically. Add the items below by hand.
                                </div>
                            )}

                            {scan.warnings.length > 0 && (
                                <div style={iv.warnBox}>
                                    <strong>Check these by eye:</strong>
                                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                        {scan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                                    </ul>
                                </div>
                            )}

                            <div style={iv.fieldRow}>
                                <div style={iv.field}>
                                    <label style={iv.label}>SUPPLIER *</label>
                                    <input style={iv.input} value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="D1, carnicería, …" />
                                </div>
                                <div style={iv.field}>
                                    <label style={iv.label}>DATE *</label>
                                    <input style={iv.input} type="date" value={purchasedOn} onChange={e => setPurchasedOn(e.target.value)} />
                                </div>
                                <div style={iv.field}>
                                    <label style={iv.label}>PAYMENT</label>
                                    <select style={iv.input} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                                        <option value="">—</option>
                                        <option value="transfer">Transfer</option>
                                        <option value="cash">Cash</option>
                                        <option value="card">Card</option>
                                        <option value="credit">Credit</option>
                                    </select>
                                </div>
                                <div style={iv.field}>
                                    <label style={iv.label}>DOCUMENT TOTAL (COP)</label>
                                    <input style={iv.input} inputMode="numeric" value={documentTotal} onChange={e => setDocumentTotal(e.target.value)} />
                                </div>
                                <div style={iv.field}>
                                    <label style={iv.label}>DOCUMENT No.</label>
                                    <input style={iv.input} value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} />
                                </div>
                                <div style={iv.field}>
                                    <label style={iv.label}>NOTE</label>
                                    <input style={iv.input} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. yogurt 5L" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Lines ── */}
                    <div style={iv.tableWrap}>
                        <table style={iv.table}>
                            <thead>
                                <tr>
                                    <th style={iv.th}>ON DOCUMENT</th>
                                    <th style={iv.th}>BARCODE</th>
                                    <th style={iv.th}>QTY</th>
                                    <th style={iv.th}>UNIT</th>
                                    <th style={iv.th}>INVENTORY ITEM</th>
                                    <th style={iv.th}>ADDS TO STOCK</th>
                                    <th style={iv.th}>LINE TOTAL</th>
                                    <th style={iv.th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.length === 0 && (
                                    <tr><td style={{ ...iv.td, ...iv.empty }} colSpan={8}>No lines yet. Add one below.</td></tr>
                                )}
                                {lines.map(line => {
                                    const item = line.item_id ? itemsById.get(line.item_id) : null;
                                    return (
                                        <tr key={line.key}>
                                            <td style={iv.td}>
                                                <input
                                                    style={{ ...iv.input, minWidth: 160 }}
                                                    value={line.description}
                                                    onChange={e => updateLine(line.key, { description: e.target.value })}
                                                    placeholder="What was bought"
                                                />
                                            </td>
                                            <td style={{ ...iv.td, ...iv.tdMono }}>
                                                {line.barcode || '—'}
                                                {line.barcode_unreliable && (
                                                    <div style={{ ...iv.badge, ...iv.badgeWarn, marginTop: 4 }}>WEIGHED</div>
                                                )}
                                            </td>
                                            <td style={iv.td}>
                                                <input
                                                    style={{ ...iv.input, width: 80 }}
                                                    inputMode="decimal"
                                                    value={line.qty_input}
                                                    onChange={e => updateLine(line.key, {
                                                        qty_input: e.target.value,
                                                        qty: parseQtyInput(e.target.value),
                                                    })}
                                                />
                                            </td>
                                            <td style={iv.td}>
                                                <input
                                                    style={{ ...iv.input, width: 80 }}
                                                    value={line.unit_label ?? ''}
                                                    onChange={e => updateLine(line.key, { unit_label: e.target.value })}
                                                    placeholder="kg, UN…"
                                                />
                                            </td>
                                            <td style={iv.td}>
                                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                    <select
                                                        style={{ ...iv.input, minWidth: 170 }}
                                                        value={line.item_id ?? ''}
                                                        onChange={e => updateLine(line.key, { item_id: e.target.value || null })}
                                                    >
                                                        <option value="">— choose —</option>
                                                        {items.map(option => (
                                                            <option key={option.id} value={option.id}>
                                                                {option.name} ({option.base_unit})
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button style={{ ...iv.btnGhost, padding: '6px 10px' }} onClick={() => quickCreateItem(line)} title="Create a new item">+</button>
                                                </div>
                                                {line.auto_matched && (
                                                    <div style={{ ...iv.badge, ...iv.badgeInfo, marginTop: 4 }}>AUTO-MATCHED</div>
                                                )}
                                            </td>
                                            <td style={iv.td}>
                                                {line.base_qty !== null
                                                    ? <span style={{ color: '#22c55e' }}>+{line.base_qty.toLocaleString('es-CO', { maximumFractionDigits: 2 })} {item?.base_unit}</span>
                                                    : <span style={{ color: line.conversion_error ? '#ef4444' : '#666' }}>{line.conversion_error ?? '—'}</span>}
                                            </td>
                                            <td style={iv.td}>
                                                <input
                                                    style={{ ...iv.input, width: 100 }}
                                                    inputMode="numeric"
                                                    value={line.line_total_input}
                                                    onChange={e => updateLine(line.key, {
                                                        line_total_input: e.target.value,
                                                        line_total_cop: parseCopInput(e.target.value),
                                                    })}
                                                />
                                            </td>
                                            <td style={iv.td}>
                                                <button
                                                    style={{ ...iv.btnGhost, padding: '6px 10px', color: '#ef4444' }}
                                                    onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}
                                                >✕</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button style={iv.btnGhost} onClick={() => setLines(prev => [...prev, emptyLine()])}>+ Add line</button>
                        <span style={{ fontSize: 12, color: '#888' }}>
                            Lines total <strong style={{ color: '#ccc' }}>{formatCop(lineSum)}</strong>
                            {parsedDocTotal !== null && <> · document says <strong style={{ color: '#ccc' }}>{formatCop(parsedDocTotal)}</strong></>}
                        </span>
                        {!totalsMatch && <span style={{ ...iv.badge, ...iv.badgeWarn }}>TOTALS DISAGREE</span>}
                        {totalsMatch && lines.length > 0 && parsedDocTotal !== null && (
                            <span style={{ ...iv.badge, ...iv.badgeOk }}>TOTALS MATCH</span>
                        )}
                    </div>

                    {(unmapped > 0 || unconverted > 0 || unreadableAmounts > 0 || docTotalInvalid || !isIsoDate(purchasedOn)) && (
                        <div style={iv.warnBox}>
                            {unmapped > 0 && <div>{unmapped} line(s) are not linked to an inventory item yet.</div>}
                            {unconverted > 0 && <div>{unconverted} line(s) have a unit that cannot be converted. Fix the unit, or add a pack size for that item.</div>}
                            {unreadableAmounts > 0 && <div>{unreadableAmounts} line(s) have a quantity or amount that is not a number.</div>}
                            {docTotalInvalid && <div>The document total is not a number.</div>}
                            {!isIsoDate(purchasedOn) && <div>Pick a valid purchase date.</div>}
                            These must be resolved before the purchase can be saved — that is what keeps the catalog and the ledger clean.
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button style={iv.btnGhost} onClick={onCancel}>Cancel</button>
                        <button
                            style={{ ...iv.btn, ...(canSave ? {} : iv.btnDisabled) }}
                            disabled={!canSave}
                            onClick={handleSave}
                        >
                            {saving ? 'Saving…' : imageUploading ? 'Storing the photo…' : 'Confirm and add to stock'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
