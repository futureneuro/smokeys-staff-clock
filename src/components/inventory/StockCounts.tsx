'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import {
    fetchCountSummaries,
    fetchCountVariance,
    fetchItemStock,
    fetchItems,
    fetchSettings,
    saveCount,
    dispatchAlertEmails,
} from '@/lib/inventory-api';
import { formatCop, formatQty, getBogotaDateString, isIsoDate, parseQtyInput } from '@/lib/inventory-units';
import { getLang, setLang as persistLang, t, type Lang } from '@/lib/i18n';
import {
    STORAGE_AREAS,
    type CountSummary,
    type CountVarianceRow,
    type InventoryItem,
    type InventorySettings,
    type ItemStock,
    type StorageArea,
} from '@/lib/inventory-types';

type Mode = 'list' | 'counting' | 'result';

export default function StockCounts({ adminId }: { adminId: string }) {
    const [mode, setMode] = useState<Mode>('list');
    const [summaries, setSummaries] = useState<CountSummary[]>([]);
    const [settings, setSettings] = useState<InventorySettings | null>(null);
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [stock, setStock] = useState<ItemStock[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [countedOn, setCountedOn] = useState(getBogotaDateString());
    const [area, setArea] = useState<StorageArea | ''>('');
    const [note, setNote] = useState('');
    const [entries, setEntries] = useState<Record<string, string>>({});

    const [lang, setLangState] = useState<Lang>('es');
    useEffect(() => { setLangState(getLang()); }, []);
    const T = (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);

    const [openCountId, setOpenCountId] = useState<string | null>(null);
    const [variance, setVariance] = useState<CountVarianceRow[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [s, cfg, i] = await Promise.all([
                fetchCountSummaries(), fetchSettings(), fetchItems(),
            ]);
            setSummaries(s);
            setSettings(cfg);
            setItems(i);

            // Only fetched when the expected figure is meant to be visible.
            // Downloading it during a blind count and merely hiding it in the
            // markup leaves it readable in the network tab and in devtools —
            // which is precisely what the setting exists to prevent.
            setStock(cfg.blind_count ? [] : await fetchItemStock());
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load counts.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const stockByItem = useMemo(() => new Map(stock.map(s => [s.item_id, s])), [stock]);

    // Only tracked items get counted; the rest are excluded deliberately.
    const countable = useMemo(() => {
        const list = items.filter(i => i.is_tracked);
        return area ? list.filter(i => i.storage_area === area) : list;
    }, [items, area]);

    const byPriority = useMemo(() => {
        const groups = new Map<number, InventoryItem[]>();
        for (const item of countable) {
            const list = groups.get(item.track_priority);
            if (list) list.push(item);
            else groups.set(item.track_priority, [item]);
        }
        return [...groups.entries()].sort((a, b) => b[0] - a[0]);
    }, [countable]);

    const filledCount = useMemo(
        () => countable.filter(i => {
            const raw = entries[i.id] ?? '';
            return raw.trim() !== '' && parseQtyInput(raw) !== null;
        }).length,
        [entries, countable],
    );
    // Scoped to the visible area, like filledCount. Counting hidden fields meant
    // a stray value typed under a different filter disabled Save with no field
    // on screen to correct.
    const badEntries = useMemo(
        () => countable.filter(i => {
            const raw = entries[i.id] ?? '';
            return raw.trim() !== '' && parseQtyInput(raw) === null;
        }).length,
        [entries, countable],
    );

    const canSave = !saving && isIsoDate(countedOn) && filledCount > 0 && badEntries === 0;

    async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        setError('');
        try {
            // Only what is actually on the sheet right now. Someone who typed
            // quantities on "Everywhere" and then narrowed to "Bar" must not
            // have those other items written into a bar-only count.
            const visible = new Set(countable.map(i => i.id));
            const quantities: Record<string, number> = {};
            for (const [id, raw] of Object.entries(entries)) {
                if (!visible.has(id)) continue;
                const value = parseQtyInput(raw);
                if (value !== null && value >= 0 && raw.trim() !== '') quantities[id] = value;
            }
            if (Object.keys(quantities).length === 0) {
                setError(T('noItemsInArea'));
                setSaving(false);
                return;
            }
            const countId = await saveCount({
                countedOn,
                storageArea: area || null,
                note: note || null,
                quantities,
                actorId: adminId || null,
            });

            // Past this point the count is confirmed and the ledger is written.
            // Anything that fails from here is a display problem, not a failed
            // save — reporting it as one left the quantities on screen and
            // invited a second count for the same day.
            setOpenCountId(countId);
            setEntries({});
            setNote('');
            setMode('result');

            // The alert row is written by the database, so the report exists in
            // the app regardless. Emailing is best-effort and never blocks.
            void dispatchAlertEmails(undefined, adminId || null);

            try {
                setVariance(await fetchCountVariance(countId));
                await load();
            } catch (e) {
                setVariance([]);
                setError(
                    e instanceof Error
                        ? `The count was saved, but the result could not be loaded: ${e.message}`
                        : 'The count was saved, but the result could not be loaded.',
                );
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the count.');
        } finally {
            setSaving(false);
        }
    }

    async function openResult(countId: string) {
        try {
            setVariance(await fetchCountVariance(countId));
            setOpenCountId(countId);
            setMode('result');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the variance.');
        }
    }

    // ── Counting sheet ──
    if (mode === 'counting') {
        return (
            <div style={iv.wrap}>
                <div style={iv.sectionHeader}>
                    <div>
                        <h3 style={iv.sectionTitle}>{T('countSheetTitle')}</h3>
                        <p style={iv.hint}>
                            {T('countSheetIntro')}{settings?.blind_count && ` ${T('countBlindNote')}`}
                        </p>
                    </div>
                    <button style={iv.btnGhost} onClick={() => { setMode('list'); setEntries({}); }}>{T('cancel')}</button>
                </div>

                {error && <div style={iv.errBox}>{error}</div>}

                <div style={iv.fieldRow}>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('dateCounted')}</label>
                        <input style={iv.input} type="date" value={countedOn} onChange={e => setCountedOn(e.target.value)} />
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('area')}</label>
                        <select style={iv.input} value={area} onChange={e => setArea(e.target.value as StorageArea | '')}>
                            <option value="">{T('everywhere')}</option>
                            {STORAGE_AREAS.map(a => <option key={a} value={a}>{T(`area_${a}`)}</option>)}
                        </select>
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('whoNote')}</label>
                        <input style={iv.input} value={note} onChange={e => setNote(e.target.value)} placeholder={T('whoPlaceholder')} />
                    </div>
                </div>

                {countable.length === 0 ? (
                    <div style={iv.empty}>
                        {T('noItemsInArea')}
                    </div>
                ) : (
                    byPriority.map(([priority, list]) => (
                        <div key={priority} style={iv.card}>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 4 }}>
                                {priority >= 3 ? T('highPriority') : priority === 2 ? T('mediumPriority') : T('normalPriority')}
                                <span style={{ color: '#666', fontWeight: 400 }}> · {list.length} items</span>
                            </h4>
                            {priority >= 3 && (
                                <p style={{ ...iv.hint, marginBottom: 8 }}>
                                    {T('highPriorityHint')}
                                </p>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                                {list.map(item => (
                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
                                        <input
                                            style={{ ...iv.input, width: 90, textAlign: 'center' }}
                                            inputMode="decimal"
                                            value={entries[item.id] ?? ''}
                                            onChange={e => setEntries(prev => ({ ...prev, [item.id]: e.target.value }))}
                                            placeholder={item.base_unit}
                                        />
                                        <div style={{ minWidth: 0, fontSize: 12, color: '#ddd' }}>
                                            {item.name}
                                            <div style={{ fontSize: 10, color: '#666' }}>
                                                {T('inUnit')} {item.base_unit}
                                                {!settings?.blind_count && (
                                                    <> · {T('systemSays')} {formatQty(stockByItem.get(item.id)?.stock_base_qty ?? 0, item.base_unit)}</>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#888' }}>{T('itemsCounted', { n: filledCount })}</span>
                    {badEntries > 0 && <span style={{ ...iv.badge, ...iv.badgeWarn }}>{T('notANumber', { n: badEntries })}</span>}
                    <button
                        style={{ ...iv.btn, ...(canSave ? {} : iv.btnDisabled) }}
                        disabled={!canSave}
                        onClick={handleSave}
                    >
                        {saving ? T('saving') : T('saveCount')}
                    </button>
                </div>
            </div>
        );
    }

    // ── Result ──
    if (mode === 'result') {
        const alerts = variance.filter(v => v.is_alert);
        const shortfall = variance
            .filter(v => Number(v.variance_qty) < 0)
            .reduce((sum, v) => sum + Number(v.variance_value_cop ?? 0), 0);

        return (
            <div style={iv.wrap}>
                <div style={iv.sectionHeader}>
                    <div>
                        <h3 style={iv.sectionTitle}>{T('resultTitle')}</h3>
                        <p style={iv.hint}>
                            {T('resultIntro')}
                        </p>
                    </div>
                    <button style={iv.btnGhost} onClick={() => { setMode('list'); setOpenCountId(null); }}>{T('back')}</button>
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ ...iv.card, flex: 1, minWidth: 150 }}>
                        <div style={iv.label}>{T('statItems')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#eee' }}>{variance.length}</div>
                    </div>
                    <div style={{ ...iv.card, flex: 1, minWidth: 150 }}>
                        <div style={iv.label}>{T('statNeedsLook')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: alerts.length > 0 ? '#ef4444' : '#22c55e' }}>
                            {alerts.length}
                        </div>
                    </div>
                    <div style={{ ...iv.card, flex: 1, minWidth: 150 }}>
                        <div style={iv.label}>{T('statShortfall')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: shortfall < 0 ? '#ef4444' : '#22c55e' }}>
                            {formatCop(Math.abs(shortfall))}
                        </div>
                    </div>
                </div>

                {alerts.length > 0 && (
                    <div style={iv.errBox}>
                        <strong>{T('alertLine', { n: alerts.length })}</strong>
                        <div style={{ marginTop: 6 }}>{T('alertAdvice')}</div>
                    </div>
                )}

                <div style={iv.tableWrap}>
                    <table style={iv.table}>
                        <thead>
                            <tr>
                                <th style={iv.th}>ITEM</th>
                                <th style={iv.th}>{T('colExpected')}</th>
                                <th style={iv.th}>{T('colCounted')}</th>
                                <th style={iv.th}>{T('colDifference')}</th>
                                <th style={iv.th}>%</th>
                                <th style={iv.th}>{T('colValue')}</th>
                                <th style={iv.th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {variance.map(v => {
                                const diff = Number(v.variance_qty ?? 0);
                                return (
                                    <tr key={v.line_id}>
                                        <td style={{ ...iv.td, color: '#eee', fontWeight: 600 }}>{v.item_name}</td>
                                        <td style={iv.td}>{formatQty(v.expected_qty, v.base_unit)}</td>
                                        <td style={iv.td}>{formatQty(v.counted_qty, v.base_unit)}</td>
                                        <td style={{ ...iv.td, color: diff < 0 ? '#ef4444' : diff > 0 ? '#eab308' : '#666' }}>
                                            {diff > 0 ? '+' : ''}{formatQty(diff, v.base_unit)}
                                        </td>
                                        <td style={iv.td}>{v.variance_pct != null ? `${v.variance_pct}%` : '—'}</td>
                                        <td style={iv.td}>{formatCop(v.variance_value_cop)}</td>
                                        <td style={iv.td}>
                                            {v.is_alert && <span style={{ ...iv.badge, ...iv.badgeBad }}>{T('check')}</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    // ── List ──
    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>{T('countsTitle')}</h3>
                    <p style={iv.hint}>
                        {T('countsIntro')}
                        {settings && ` ${T('countsThresholds', {
                            pct: settings.variance_pct_threshold,
                            value: formatCop(settings.variance_value_threshold_cop),
                        })}`}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                        style={iv.btnGhost}
                        onClick={() => { const next: Lang = lang === 'es' ? 'en' : 'es'; persistLang(next); setLangState(next); }}
                    >{lang === 'es' ? '🇬🇧 English' : '🇨🇴 Español'}</button>
                    <button style={iv.btn} onClick={() => { setMode('counting'); setCountedOn(getBogotaDateString()); }}>
                        {T('newCount')}
                    </button>
                </div>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}

            {loading ? (
                <div style={iv.empty}>{T('loading')}</div>
            ) : summaries.length === 0 ? (
                <div style={iv.empty}>{T('noCounts')}</div>
            ) : (
                <div style={iv.tableWrap}>
                    <table style={iv.table}>
                        <thead>
                            <tr>
                                <th style={iv.th}>{T('colDate')}</th>
                                <th style={iv.th}>{T('colArea')}</th>
                                <th style={iv.th}>{T('colItems')}</th>
                                <th style={iv.th}>{T('colNeedsLook')}</th>
                                <th style={iv.th}>{T('colShortfall')}</th>
                                <th style={iv.th}>{T('colNote')}</th>
                                <th style={iv.th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaries.map(s => (
                                <tr key={s.count_id} style={{ background: s.count_id === openCountId ? 'rgba(240,180,39,0.06)' : undefined }}>
                                    <td style={{ ...iv.td, color: '#eee' }}>{s.counted_on}</td>
                                    <td style={iv.td}>{s.storage_area ? T(`area_${s.storage_area}`) : T('everywhere')}</td>
                                    <td style={iv.td}>{s.items_counted}</td>
                                    <td style={iv.td}>
                                        <span style={{ ...iv.badge, ...(Number(s.items_alerting) > 0 ? iv.badgeBad : iv.badgeOk) }}>
                                            {s.items_alerting}
                                        </span>
                                    </td>
                                    <td style={iv.td}>{formatCop(Math.abs(Number(s.shortfall_value_cop ?? 0)))}</td>
                                    <td style={iv.td}>{s.note ?? '—'}</td>
                                    <td style={iv.td}>
                                        <button style={{ ...iv.btnGhost, padding: '4px 10px' }} onClick={() => openResult(s.count_id)}>
                                            {T('view')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
