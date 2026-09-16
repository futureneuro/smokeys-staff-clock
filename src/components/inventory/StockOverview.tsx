'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import { fetchMenuCapacity, fetchSettings, fetchStockOverview } from '@/lib/inventory-api';
import { formatCop, formatQty } from '@/lib/inventory-units';
import type { MenuItemCapacity, StockOverviewRow } from '@/lib/inventory-types';

type View = 'materials' | 'capacity';

// Days of cover below which an item is worth reordering now.
const LOW_DAYS = 3;
const WARN_DAYS = 7;

function daysBadge(days: number | null) {
    if (days === null) return { ...iv.badge, ...iv.badgeInfo };
    if (days < LOW_DAYS) return { ...iv.badge, ...iv.badgeBad };
    if (days < WARN_DAYS) return { ...iv.badge, ...iv.badgeWarn };
    return { ...iv.badge, ...iv.badgeOk };
}

export default function StockOverview() {
    const [view, setView] = useState<View>('materials');
    const [rows, setRows] = useState<StockOverviewRow[]>([]);
    const [capacity, setCapacity] = useState<MenuItemCapacity[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [trackedOnly, setTrackedOnly] = useState(true);
    // Same reason as ItemCatalog: the setting must hold on every screen or it
    // holds on none.
    const [blind, setBlind] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const cfg = await fetchSettings();
            setBlind(cfg.blind_count);
            const [s, c] = await Promise.all([
                cfg.blind_count ? Promise.resolve([]) : fetchStockOverview(),
                fetchMenuCapacity(),
            ]);
            setRows(s);
            setCapacity(c);
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the stock overview.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return rows.filter(r => {
            if (trackedOnly && !r.is_tracked) return false;
            return !needle || r.name.toLowerCase().includes(needle);
        });
    }, [rows, search, trackedOnly]);

    const totals = useMemo(() => ({
        value: visible.reduce((sum, r) => sum + Number(r.stock_value_cop ?? 0), 0),
        negative: visible.filter(r => Number(r.stock_base_qty) < 0).length,
        low: visible.filter(r => r.days_left !== null && Number(r.days_left) < LOW_DAYS).length,
        daysOfData: rows.find(r => r.days_of_data != null)?.days_of_data ?? 0,
    }), [visible, rows]);

    return (
        <div style={iv.wrap}>
            <div style={iv.subTabs}>
                {(['materials', 'capacity'] as View[]).map(v => (
                    <button
                        key={v}
                        onClick={() => setView(v)}
                        style={{ ...iv.subTab, ...(view === v ? iv.subTabActive : {}) }}
                    >
                        {v === 'materials' ? '📊 Raw materials' : '🍽️ What we can still make'}
                    </button>
                ))}
                <button style={{ ...iv.subTab, marginLeft: 'auto' }} onClick={load}>↻ Refresh</button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}

            {view === 'materials' && (
                <>
                    <div style={iv.sectionHeader}>
                        <div>
                            <h3 style={iv.sectionTitle}>Raw materials in stock</h3>
                            <p style={iv.hint}>
                                {totals.daysOfData > 0
                                    ? `Days left is based on average use over the ${totals.daysOfData} day(s) of sales entered.`
                                    : 'Enter a few days of sales and this will start showing how long each item lasts.'}
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ ...iv.label, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}>
                                <input type="checkbox" checked={trackedOnly} onChange={e => setTrackedOnly(e.target.checked)} />
                                COUNTED ITEMS ONLY
                            </label>
                            <input style={{ ...iv.input, width: 200 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ ...iv.card, flex: 1, minWidth: 160 }}>
                            <div style={iv.label}>STOCK VALUE</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#f0b427' }}>{formatCop(totals.value)}</div>
                        </div>
                        <div style={{ ...iv.card, flex: 1, minWidth: 160 }}>
                            <div style={iv.label}>ITEMS TRACKED</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#eee' }}>{visible.length}</div>
                        </div>
                        <div style={{ ...iv.card, flex: 1, minWidth: 160 }}>
                            <div style={iv.label}>RUNNING LOW</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: totals.low > 0 ? '#ef4444' : '#22c55e' }}>{totals.low}</div>
                        </div>
                        <div style={{ ...iv.card, flex: 1, minWidth: 160 }}>
                            <div style={iv.label}>NEGATIVE STOCK</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: totals.negative > 0 ? '#ef4444' : '#22c55e' }}>{totals.negative}</div>
                        </div>
                    </div>

                    {totals.negative > 0 && (
                        <div style={iv.warnBox}>
                            {totals.negative} item(s) show negative stock. That means more was sold than was ever
                            recorded as bought — usually a missing purchase, or a recipe quantity that is too high.
                        </div>
                    )}

                    {loading ? (
                        <div style={iv.empty}>Loading…</div>
                    ) : blind ? (
                        <div style={iv.warnBox}>
                            Stock figures are hidden because blind counting is switched on, so the person
                            counting cannot read the expected amounts. Turn it off under <strong>Alerts</strong>
                            to see them here.
                        </div>
                    ) : visible.length === 0 ? (
                        <div style={iv.empty}>No items yet. Record a purchase first.</div>
                    ) : (
                        <div style={iv.tableWrap}>
                            <table style={iv.table}>
                                <thead>
                                    <tr>
                                        <th style={iv.th}>MATERIAL</th>
                                        <th style={iv.th}>CATEGORY</th>
                                        <th style={iv.th}>IN STOCK</th>
                                        <th style={iv.th}>VALUE</th>
                                        <th style={iv.th}>COST / UNIT</th>
                                        <th style={iv.th}>USED PER DAY</th>
                                        <th style={iv.th}>DAYS LEFT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map(r => {
                                        const stock = Number(r.stock_base_qty);
                                        return (
                                            <tr key={r.item_id}>
                                                <td style={{ ...iv.td, color: '#eee', fontWeight: 600 }}>{r.name}</td>
                                                <td style={iv.td}>{r.category}</td>
                                                <td style={{ ...iv.td, color: stock < 0 ? '#ef4444' : '#ccc' }}>
                                                    {formatQty(stock, r.base_unit)}
                                                </td>
                                                <td style={iv.td}>{formatCop(r.stock_value_cop)}</td>
                                                <td style={iv.td}>
                                                    {r.cost_per_base_unit != null
                                                        ? `${formatCop(r.cost_per_base_unit)}/${r.base_unit}`
                                                        : '—'}
                                                </td>
                                                <td style={iv.td}>
                                                    {r.avg_daily_qty != null ? formatQty(r.avg_daily_qty, r.base_unit) : '—'}
                                                </td>
                                                <td style={iv.td}>
                                                    {r.days_left != null
                                                        ? <span style={daysBadge(Number(r.days_left))}>{Number(r.days_left).toFixed(1)} DAYS</span>
                                                        : <span style={{ color: '#555' }}>no sales data</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {view === 'capacity' && (
                <>
                    <div style={iv.sectionHeader}>
                        <div>
                            <h3 style={iv.sectionTitle}>What we can still make</h3>
                            <p style={iv.hint}>
                                How many of each item current stock supports, and which ingredient runs out first.
                                Only items with a finished recipe appear here.
                            </p>
                        </div>
                    </div>

                    {loading ? (
                        <div style={iv.empty}>Loading…</div>
                    ) : capacity.length === 0 ? (
                        <div style={iv.empty}>
                            No menu item has a finished recipe yet. Add raw quantities under <strong>Recipes</strong>.
                        </div>
                    ) : (
                        <div style={iv.tableWrap}>
                            <table style={iv.table}>
                                <thead>
                                    <tr>
                                        <th style={iv.th}>MENU ITEM</th>
                                        <th style={iv.th}>CATEGORY</th>
                                        <th style={iv.th}>CAN STILL MAKE</th>
                                        <th style={iv.th}>RUNS OUT FIRST</th>
                                        <th style={iv.th}>THAT ITEM&apos;S STOCK</th>
                                        <th style={iv.th}>PER SERVING</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {capacity.map(c => {
                                        const makeable = Number(c.makeable);
                                        return (
                                            <tr key={c.menu_item_id}>
                                                <td style={{ ...iv.td, color: '#eee', fontWeight: 600 }}>{c.name}</td>
                                                <td style={iv.td}>{c.category}</td>
                                                <td style={iv.td}>
                                                    <span style={{
                                                        ...iv.badge,
                                                        ...(makeable <= 0 ? iv.badgeBad : makeable < 10 ? iv.badgeWarn : iv.badgeOk),
                                                        fontSize: 12,
                                                    }}>
                                                        {makeable.toLocaleString('es-CO')}
                                                    </span>
                                                </td>
                                                <td style={iv.td}>{c.limiting_item}</td>
                                                <td style={iv.td}>{formatQty(c.limiting_stock, c.limiting_unit)}</td>
                                                <td style={iv.td}>{formatQty(c.limiting_qty_per_serving, c.limiting_unit)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
