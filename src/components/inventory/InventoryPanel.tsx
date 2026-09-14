'use client';

import { useCallback, useEffect, useState } from 'react';
import { iv } from './inventory-styles';
import ReceiptScanner from './ReceiptScanner';
import ItemCatalog from './ItemCatalog';
import StockOverview from './StockOverview';
import SalesEntry from './SalesEntry';
import MenuRecipes from './MenuRecipes';
import StockCounts from './StockCounts';
import WasteLog from './WasteLog';
import AlertsPanel from './AlertsPanel';
import { fetchPurchaseLines, fetchPurchases, fetchSalesEntries } from '@/lib/inventory-api';
import { formatCop, formatQty } from '@/lib/inventory-units';
import type { Purchase, PurchaseLine, SalesEntry as SalesEntryRow } from '@/lib/inventory-types';

type InventoryTab = 'stock' | 'counts' | 'alerts' | 'purchases' | 'sales' | 'waste' | 'recipes' | 'items';

const TAB_LABEL: Record<InventoryTab, string> = {
    stock: '📊 Stock',
    counts: '📋 Counts',
    alerts: '🔔 Alerts',
    purchases: '🧾 Purchases',
    sales: '🍽️ Sales',
    waste: '🗑️ Waste',
    recipes: '📖 Recipes',
    items: '📦 Items',
};

const SOURCE_LABEL: Record<Purchase['source'], string> = {
    receipt_scan: 'Scanned receipt',
    transfer: 'Bank transfer',
    manual: 'Typed in',
};

export default function InventoryPanel({ adminId }: { adminId: string }) {
    const [tab, setTab] = useState<InventoryTab>('stock');
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [salesEntries, setSalesEntries] = useState<SalesEntryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [scanning, setScanning] = useState(false);
    const [enteringSales, setEnteringSales] = useState(false);
    const [openPurchase, setOpenPurchase] = useState<string | null>(null);
    const [openLines, setOpenLines] = useState<PurchaseLine[]>([]);
    const [savedNotice, setSavedNotice] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setPurchases(await fetchPurchases());
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load purchases.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadSales = useCallback(async () => {
        setLoading(true);
        try {
            setSalesEntries(await fetchSalesEntries());
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load sales entries.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab === 'purchases') load();
        if (tab === 'sales') loadSales();
    }, [tab, load, loadSales]);

    function notify(message: string) {
        setSavedNotice(message);
        window.setTimeout(() => setSavedNotice(''), 6000);
    }

    async function toggleLines(purchaseId: string) {
        if (openPurchase === purchaseId) {
            setOpenPurchase(null);
            setOpenLines([]);
            return;
        }
        setOpenPurchase(purchaseId);
        // Cleared first: on a failed fetch the previous purchase's lines would
        // otherwise stay on screen under the new purchase's heading.
        setOpenLines([]);
        try {
            setOpenLines(await fetchPurchaseLines(purchaseId));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the purchase lines.');
        }
    }

    if (scanning) {
        return (
            <ReceiptScanner
                adminId={adminId}
                onCancel={() => setScanning(false)}
                onSaved={() => {
                    setScanning(false);
                    notify('Purchase saved and stock updated.');
                    load();
                }}
            />
        );
    }

    if (enteringSales) {
        return (
            <SalesEntry
                adminId={adminId}
                onCancel={() => setEnteringSales(false)}
                onSaved={() => {
                    setEnteringSales(false);
                    notify('Sales saved and raw materials deducted from stock.');
                    loadSales();
                }}
            />
        );
    }

    return (
        <div style={iv.wrap}>
            <div style={iv.subTabs}>
                {(Object.keys(TAB_LABEL) as InventoryTab[]).map(name => (
                    <button
                        key={name}
                        onClick={() => setTab(name)}
                        style={{ ...iv.subTab, ...(tab === name ? iv.subTabActive : {}) }}
                    >
                        {TAB_LABEL[name]}
                    </button>
                ))}
            </div>

            {savedNotice && <div style={iv.okBox}>{savedNotice}</div>}

            {tab === 'stock' && <StockOverview />}
            {tab === 'counts' && <StockCounts adminId={adminId} />}
            {tab === 'alerts' && <AlertsPanel adminId={adminId} />}
            {tab === 'waste' && <WasteLog adminId={adminId} />}
            {tab === 'recipes' && <MenuRecipes />}
            {tab === 'items' && <ItemCatalog />}

            {tab === 'sales' && (
                <>
                    <div style={iv.sectionHeader}>
                        <div>
                            <h3 style={iv.sectionTitle}>Sales</h3>
                            <p style={iv.hint}>
                                Enter what was sold each day. The raw materials come off stock automatically —
                                there is no POS connection.
                            </p>
                        </div>
                        <button style={iv.btn} onClick={() => setEnteringSales(true)}>+ Enter a day&apos;s sales</button>
                    </div>

                    {error && <div style={iv.errBox}>{error}</div>}

                    {loading ? (
                        <div style={iv.empty}>Loading…</div>
                    ) : salesEntries.length === 0 ? (
                        <div style={iv.empty}>
                            No sales entered yet. Use <strong>Enter a day&apos;s sales</strong> to start.
                        </div>
                    ) : (
                        <div style={iv.tableWrap}>
                            <table style={iv.table}>
                                <thead>
                                    <tr>
                                        <th style={iv.th}>DATE SOLD</th>
                                        <th style={iv.th}>STATUS</th>
                                        <th style={iv.th}>NOTE</th>
                                        <th style={iv.th}>ENTERED</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {salesEntries.map(entry => (
                                        <tr key={entry.id}>
                                            <td style={{ ...iv.td, color: '#eee' }}>{entry.sold_on}</td>
                                            <td style={iv.td}>
                                                <span style={{ ...iv.badge, ...(entry.status === 'confirmed' ? iv.badgeOk : iv.badgeWarn) }}>
                                                    {entry.status.toUpperCase()}
                                                </span>
                                            </td>
                                            <td style={iv.td}>{entry.note ?? '—'}</td>
                                            <td style={iv.td}>{new Date(entry.created_at).toLocaleDateString('es-CO')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {tab === 'purchases' && (
                <>
                    <div style={iv.sectionHeader}>
                        <div>
                            <h3 style={iv.sectionTitle}>Purchases</h3>
                            <p style={iv.hint}>
                                Every confirmed purchase adds to stock. Nothing is written until you review and confirm it.
                            </p>
                        </div>
                        <button style={iv.btn} onClick={() => setScanning(true)}>+ New purchase</button>
                    </div>

                    {error && <div style={iv.errBox}>{error}</div>}

                    {loading ? (
                        <div style={iv.empty}>Loading…</div>
                    ) : purchases.length === 0 ? (
                        <div style={iv.empty}>
                            No purchases recorded yet. Use <strong>New purchase</strong> to scan a receipt or type one in.
                        </div>
                    ) : (
                        <div style={iv.tableWrap}>
                            <table style={iv.table}>
                                <thead>
                                    <tr>
                                        <th style={iv.th}>DATE</th>
                                        <th style={iv.th}>SUPPLIER</th>
                                        <th style={iv.th}>SOURCE</th>
                                        <th style={iv.th}>PAYMENT</th>
                                        <th style={iv.th}>TOTAL</th>
                                        <th style={iv.th}>STATUS</th>
                                        <th style={iv.th}>NOTE</th>
                                        <th style={iv.th}>DOCUMENT</th>
                                        <th style={iv.th}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {purchases.map(purchase => (
                                        <tr key={purchase.id}>
                                            <td style={iv.td}>{purchase.purchased_on}</td>
                                            <td style={{ ...iv.td, color: '#eee' }}>{purchase.supplier?.name ?? '—'}</td>
                                            <td style={iv.td}>{SOURCE_LABEL[purchase.source]}</td>
                                            <td style={iv.td}>{purchase.payment_method ?? '—'}</td>
                                            <td style={iv.td}>{formatCop(purchase.document_total_cop)}</td>
                                            <td style={iv.td}>
                                                <span style={{
                                                    ...iv.badge,
                                                    ...(purchase.status === 'confirmed' ? iv.badgeOk : purchase.status === 'draft' ? iv.badgeWarn : iv.badgeBad),
                                                }}>{purchase.status.toUpperCase()}</span>
                                                {purchase.ai_warnings && purchase.ai_warnings.length > 0 && (
                                                    <span style={{ ...iv.badge, ...iv.badgeWarn, marginLeft: 6 }}>
                                                        {purchase.ai_warnings.length} ⚠
                                                    </span>
                                                )}
                                            </td>
                                            <td style={iv.td}>{purchase.note ?? '—'}</td>
                                            <td style={iv.td}>
                                                {purchase.image_path ? (
                                                    <a
                                                        href={purchase.image_path}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{ color: '#f0b427', fontSize: 12, textDecoration: 'none' }}
                                                    >📎 View</a>
                                                ) : <span style={{ color: '#555' }}>—</span>}
                                            </td>
                                            <td style={iv.td}>
                                                <button style={{ ...iv.btnGhost, padding: '4px 10px' }} onClick={() => toggleLines(purchase.id)}>
                                                    {openPurchase === purchase.id ? 'Hide' : 'Lines'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {openPurchase && (
                        <div style={iv.card}>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 14, marginBottom: 10 }}>Lines</h4>
                            {openLines.length === 0 ? (
                                <p style={iv.hint}>
                                    This purchase has no itemised lines — typical of a bank transfer recorded for its
                                    cost only.
                                </p>
                            ) : (
                                <div style={iv.tableWrap}>
                                    <table style={iv.table}>
                                        <thead>
                                            <tr>
                                                <th style={iv.th}>ON DOCUMENT</th>
                                                <th style={iv.th}>BARCODE</th>
                                                <th style={iv.th}>QTY</th>
                                                <th style={iv.th}>ADDED TO STOCK</th>
                                                <th style={iv.th}>LINE TOTAL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {openLines.map(line => (
                                                <tr key={line.id}>
                                                    <td style={iv.td}>{line.raw_description ?? '—'}</td>
                                                    <td style={{ ...iv.td, ...iv.tdMono }}>{line.raw_barcode ?? '—'}</td>
                                                    <td style={iv.td}>{formatQty(line.qty, line.unit_label ?? undefined)}</td>
                                                    <td style={iv.td}>{formatQty(line.base_qty)}</td>
                                                    <td style={iv.td}>{formatCop(line.line_total_cop)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
