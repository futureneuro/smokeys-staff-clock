'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import {
    fetchItems,
    fetchMenuItems,
    fetchRecipeLines,
    saveSalesEntry,
} from '@/lib/inventory-api';
import { formatCop, formatQty, getBogotaDateString, isIsoDate, parseQtyInput } from '@/lib/inventory-units';
import type { InventoryItem, MenuCategory, MenuItem, RecipeLine } from '@/lib/inventory-types';

const CATEGORY_LABEL: Record<MenuCategory, string> = {
    cocktail: '🍸 Cocktails',
    juice: '🧃 Juices & lemonades',
    soda: '🥤 Italian sodas',
    coffee: '☕ Coffee',
    shake: '🥤 Shakes & smoothies',
    brunch: '🍳 Brunch',
    bowl: '🥗 Bowls',
    plate: '🍽️ Plates',
    dessert: '🍰 Desserts',
    side: '🍟 Sides',
    other: 'Other',
};

interface Props {
    adminId: string;
    onSaved: () => void;
    onCancel: () => void;
}

export default function SalesEntry({ adminId, onSaved, onCancel }: Props) {
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [recipes, setRecipes] = useState<RecipeLine[]>([]);
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [soldOn, setSoldOn] = useState(getBogotaDateString());
    const [note, setNote] = useState('');
    // Kept as raw strings so a half-typed number is never coerced.
    const [qty, setQty] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [m, r, i] = await Promise.all([fetchMenuItems(), fetchRecipeLines(), fetchItems()]);
            setMenu(m);
            setRecipes(r);
            setItems(i);
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the menu.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

    const recipesByMenuItem = useMemo(() => {
        const map = new Map<string, RecipeLine[]>();
        for (const line of recipes) {
            const list = map.get(line.menu_item_id);
            if (list) list.push(line);
            else map.set(line.menu_item_id, [line]);
        }
        return map;
    }, [recipes]);

    const visibleMenu = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return menu;
        return menu.filter(m => m.name.toLowerCase().includes(needle));
    }, [menu, search]);

    const grouped = useMemo(() => {
        const map = new Map<MenuCategory, MenuItem[]>();
        for (const m of visibleMenu) {
            const list = map.get(m.category);
            if (list) list.push(m);
            else map.set(m.category, [m]);
        }
        return map;
    }, [visibleMenu]);

    // What the entered quantities consume, per raw material. Recomputed live so
    // the totals move as you type.
    const consumption = useMemo(() => {
        const totals = new Map<string, number>();
        for (const [menuItemId, raw] of Object.entries(qty)) {
            const sold = parseQtyInput(raw);
            if (!sold || sold <= 0) continue;
            for (const line of recipesByMenuItem.get(menuItemId) ?? []) {
                // Untracked materials (ice, salt) are never bought into stock, so
                // showing or deducting them would only add noise. Matches what
                // inv_confirm_sales_entry actually writes.
                if (!line.is_tracked || !itemsById.get(line.item_id)?.is_tracked) continue;
                totals.set(line.item_id, (totals.get(line.item_id) ?? 0) + sold * Number(line.qty_base));
            }
        }
        return [...totals.entries()]
            .map(([itemId, amount]) => ({ item: itemsById.get(itemId), amount }))
            .filter(row => row.item)
            .sort((a, b) => a.item!.name.localeCompare(b.item!.name));
    }, [qty, recipesByMenuItem, itemsById]);

    const consumptionValue = useMemo(
        () => consumption.reduce((sum, row) => sum + row.amount * Number(row.item!.cost_per_base_unit ?? 0), 0),
        [consumption],
    );

    const totalUnitsSold = useMemo(
        () => Object.values(qty).reduce((sum, raw) => sum + (parseQtyInput(raw) ?? 0), 0),
        [qty],
    );

    // A dish whose recipe is unfinished would under-deduct, so the database
    // rejects it. Catch it here to say so before the round trip.
    const incomplete = useMemo(
        () => menu.filter(m => !m.recipe_complete && (parseQtyInput(qty[m.id] ?? '') ?? 0) > 0),
        [menu, qty],
    );

    const badNumbers = useMemo(
        () => Object.values(qty).filter(raw => raw.trim() !== '' && parseQtyInput(raw) === null).length,
        [qty],
    );

    const canSave =
        !saving && isIsoDate(soldOn) && totalUnitsSold > 0 && incomplete.length === 0 && badNumbers === 0;

    async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        setError('');
        try {
            const quantities: Record<string, number> = {};
            for (const [id, raw] of Object.entries(qty)) {
                const value = parseQtyInput(raw);
                if (value && value > 0) quantities[id] = value;
            }
            await saveSalesEntry({ soldOn, note: note || null, quantities, actorId: adminId || null });
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the sales entry.');
            setSaving(false);
        }
    }

    if (loading) return <div style={iv.empty}>Loading the menu…</div>;

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>Enter a day&apos;s sales</h3>
                    <p style={iv.hint}>
                        Type how many of each item was sold. The raw materials are worked out from the recipes
                        and come off stock when you save.
                    </p>
                </div>
                <button style={iv.btnGhost} onClick={onCancel}>Cancel</button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}

            <div style={iv.fieldRow}>
                <div style={iv.field}>
                    <label style={iv.label}>DATE SOLD *</label>
                    <input style={iv.input} type="date" value={soldOn} onChange={e => setSoldOn(e.target.value)} />
                </div>
                <div style={iv.field}>
                    <label style={iv.label}>NOTE</label>
                    <input style={iv.input} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Saturday, festivo" />
                </div>
                <div style={iv.field}>
                    <label style={iv.label}>SEARCH THE MENU</label>
                    <input style={iv.input} value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter items…" />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
                {/* ── Menu ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                    {[...grouped.entries()].map(([category, list]) => (
                        <div key={category} style={iv.card}>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 10 }}>
                                {CATEGORY_LABEL[category]}
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                                {list.map(m => (
                                    <div
                                        key={m.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '6px 8px',
                                            borderRadius: 8,
                                            background: m.recipe_complete ? 'transparent' : 'rgba(234,179,8,0.06)',
                                        }}
                                    >
                                        <input
                                            style={{ ...iv.input, width: 64, textAlign: 'center' }}
                                            inputMode="decimal"
                                            value={qty[m.id] ?? ''}
                                            onChange={e => setQty(prev => ({ ...prev, [m.id]: e.target.value }))}
                                            placeholder="0"
                                        />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 12, color: '#ddd', lineHeight: 1.3 }}>
                                                {m.name}
                                                {m.portion_label && <span style={{ color: '#777' }}> · {m.portion_label}</span>}
                                            </div>
                                            {!m.recipe_complete && (
                                                <div style={{ ...iv.badge, ...iv.badgeWarn, marginTop: 2 }}>RECIPE INCOMPLETE</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                    {grouped.size === 0 && <div style={iv.empty}>Nothing matches that search.</div>}
                </div>

                {/* ── Live totals ── */}
                <div style={{ ...iv.card, position: 'sticky', top: 16, minWidth: 0 }}>
                    <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 4 }}>Raw materials used</h4>
                    <p style={{ ...iv.hint, marginBottom: 10 }}>
                        {totalUnitsSold > 0
                            ? `${totalUnitsSold.toLocaleString('es-CO')} item(s) entered`
                            : 'Enter quantities to see the totals.'}
                    </p>

                    {consumption.length > 0 && (
                        <div style={{ ...iv.tableWrap, marginBottom: 12 }}>
                            <table style={{ ...iv.table, minWidth: 0 }}>
                                <thead>
                                    <tr>
                                        <th style={iv.th}>MATERIAL</th>
                                        <th style={iv.th}>USED</th>
                                        <th style={iv.th}>COST</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {consumption.map(row => (
                                        <tr key={row.item!.id}>
                                            <td style={{ ...iv.td, color: '#ddd' }}>{row.item!.name}</td>
                                            <td style={iv.td}>{formatQty(row.amount, row.item!.base_unit)}</td>
                                            <td style={iv.td}>
                                                {row.item!.cost_per_base_unit != null
                                                    ? formatCop(row.amount * Number(row.item!.cost_per_base_unit))
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {consumptionValue > 0 && (
                        <div style={{ fontSize: 13, color: '#ccc', marginBottom: 10 }}>
                            Raw material cost: <strong style={{ color: '#f0b427' }}>{formatCop(consumptionValue)}</strong>
                        </div>
                    )}

                    {incomplete.length > 0 && (
                        <div style={{ ...iv.warnBox, marginBottom: 10 }}>
                            These have quantities but no finished recipe, so their materials cannot be worked out:
                            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                {incomplete.map(m => <li key={m.id}>{m.name}</li>)}
                            </ul>
                            Finish the recipe, or set the quantity back to zero.
                        </div>
                    )}

                    {badNumbers > 0 && (
                        <div style={{ ...iv.warnBox, marginBottom: 10 }}>
                            {badNumbers} quantity field(s) are not a number.
                        </div>
                    )}

                    <button
                        style={{ ...iv.btn, width: '100%', ...(canSave ? {} : iv.btnDisabled) }}
                        disabled={!canSave}
                        onClick={handleSave}
                    >
                        {saving ? 'Saving…' : 'Save and deduct from stock'}
                    </button>
                </div>
            </div>
        </div>
    );
}
