'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv, REASON_COLOUR } from './inventory-styles';
import { fetchItems, fetchRecentMovements, recordStockEvent } from '@/lib/inventory-api';
import { formatCop, formatQty, getBogotaDateString, isIsoDate, parseQtyInput } from '@/lib/inventory-units';
import { getLang, setLang as persistLang, t, type Lang } from '@/lib/i18n';
import {
    type InventoryItem,
    type MovementByReason,
    type StockEventReason,
} from '@/lib/inventory-types';

// Reasons a person logs by hand. Purchases, sales and counts write their own
// ledger entries, so they are not offered here.
const MANUAL_REASONS: StockEventReason[] = ['waste', 'staff_meal', 'comp', 'transfer_out', 'adjustment', 'opening'];

export default function WasteLog({ adminId }: { adminId: string }) {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [movements, setMovements] = useState<MovementByReason[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');

    const [lang, setLangState] = useState<Lang>('es');
    useEffect(() => { setLangState(getLang()); }, []);
    const T = (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);

    const [itemId, setItemId] = useState('');
    const [qty, setQty] = useState('');
    const [reason, setReason] = useState<StockEventReason>('waste');
    const [note, setNote] = useState('');
    const [occurredOn, setOccurredOn] = useState(getBogotaDateString());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [i, m] = await Promise.all([fetchItems(), fetchRecentMovements(14)]);
            setItems(i);
            setMovements(m);
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the log.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
    const selected = itemId ? itemsById.get(itemId) : null;

    const parsedQty = parseQtyInput(qty);
    const needsNote = reason === 'adjustment';
    const canSave =
        !saving && Boolean(itemId) && parsedQty !== null && parsedQty > 0 &&
        isIsoDate(occurredOn) && (!needsNote || note.trim() !== '');

    // Manual entries only. Purchases, sales and counts have their own screens.
    const manualMovements = useMemo(
        () => movements.filter(m => MANUAL_REASONS.includes(m.reason as StockEventReason)),
        [movements],
    );

    async function handleSave() {
        if (!canSave || parsedQty === null) return;
        setSaving(true);
        setError('');
        try {
            await recordStockEvent({
                itemId,
                qty: parsedQty,
                reason,
                note: note.trim() || null,
                occurredOn,
                actorId: adminId || null,
            });
            setNotice(T('wasteRecorded', { qty: formatQty(parsedQty, selected?.base_unit), item: selected?.name ?? '' }));
            setQty('');
            setNote('');
            setItemId('');
            await load();
            window.setTimeout(() => setNotice(''), 5000);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not record it.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>{T('wasteTitle')}</h3>
                    <p style={iv.hint}>
                        {T('wasteIntro')}
                    </p>
                </div>
                <button
                    style={iv.btnGhost}
                    onClick={() => { const next: Lang = lang === 'es' ? 'en' : 'es'; persistLang(next); setLangState(next); }}
                >{lang === 'es' ? '🇬🇧 English' : '🇨🇴 Español'}</button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}
            {notice && <div style={iv.okBox}>{notice}</div>}

            <div style={iv.card}>
                <div style={iv.fieldRow}>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('wasteWhat')}</label>
                        <select style={iv.input} value={itemId} onChange={e => setItemId(e.target.value)}>
                            <option value="">{T('wasteChoose')}</option>
                            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}
                        </select>
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('wasteHowMuch')}{selected ? ` (${selected.base_unit})` : ''}</label>
                        <input style={iv.input} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('wasteReason')}</label>
                        <select style={iv.input} value={reason} onChange={e => setReason(e.target.value as StockEventReason)}>
                            {MANUAL_REASONS.map(r => <option key={r} value={r}>{T(`reason_${r}`)}</option>)}
                        </select>
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('wasteDate')}</label>
                        <input style={iv.input} type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} />
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('wasteNote')}{needsNote ? ' *' : ''}</label>
                        <input
                            style={iv.input}
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder={needsNote ? T('wasteNoteRequired') : T('wasteNoteOptional')}
                        />
                    </div>
                </div>

                {reason === 'opening' && (
                    <div style={{ ...iv.warnBox, marginTop: 10 }}>
                        {T('wasteOpeningHint')}
                    </div>
                )}
                {reason === 'staff_meal' && (
                    <div style={{ ...iv.warnBox, marginTop: 10 }}>
                        {T('wasteStaffHint')}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <button
                        style={{ ...iv.btn, ...(canSave ? {} : iv.btnDisabled) }}
                        disabled={!canSave}
                        onClick={handleSave}
                    >
                        {saving ? T('saving') : T('wasteRecord')}
                    </button>
                </div>
            </div>

            <h4 style={{ ...iv.sectionTitle, fontSize: 13 }}>{T('wasteRecent')}</h4>

            {loading ? (
                <div style={iv.empty}>{T('loading')}</div>
            ) : manualMovements.length === 0 ? (
                <div style={iv.empty}>
                    {T('wasteEmpty')}
                </div>
            ) : (
                <div style={iv.tableWrap}>
                    <table style={iv.table}>
                        <thead>
                            <tr>
                                <th style={iv.th}>{T('wasteDate')}</th>
                                <th style={iv.th}>{T('colItem')}</th>
                                <th style={iv.th}>{T('colReason')}</th>
                                <th style={iv.th}>{T('colQty')}</th>
                                <th style={iv.th}>{T('colValue')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {manualMovements.map((m, index) => (
                                <tr key={`${m.item_id}-${m.occurred_on}-${m.reason}-${index}`}>
                                    <td style={iv.td}>{m.occurred_on}</td>
                                    <td style={{ ...iv.td, color: '#eee' }}>{m.item_name}</td>
                                    <td style={iv.td}>
                                        <span style={{ color: REASON_COLOUR[m.reason] ?? '#999' }}>
                                            {T(`reason_${m.reason}`)}
                                        </span>
                                    </td>
                                    <td style={iv.td}>{formatQty(m.qty, m.base_unit)}</td>
                                    <td style={iv.td}>{formatCop(Math.abs(Number(m.value_cop ?? 0)))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
