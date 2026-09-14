'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import {
    archiveMenuItem,
    createMenuItem,
    deleteRecipeLine,
    fetchItems,
    fetchMenuCosts,
    fetchMenuItems,
    fetchRecipeLines,
    updateMenuItem,
    upsertRecipeLine,
} from '@/lib/inventory-api';
import { formatCop, formatQty, parseCopInput, parseQtyInput } from '@/lib/inventory-units';
import {
    MENU_CATEGORIES,
    type InventoryItem,
    type MenuCategory,
    type MenuItem,
    type MenuItemCost,
    type RecipeLine,
} from '@/lib/inventory-types';

export default function MenuRecipes() {
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [recipes, setRecipes] = useState<RecipeLine[]>([]);
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [costs, setCosts] = useState<MenuItemCost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [showNew, setShowNew] = useState(false);
    const [newForm, setNewForm] = useState({ name: '', category: 'plate' as MenuCategory, portion_label: '' });

    // Add-ingredient row
    const [addItemId, setAddItemId] = useState('');
    const [addQty, setAddQty] = useState('');
    const [priceDraft, setPriceDraft] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [m, r, i, c] = await Promise.all([
                fetchMenuItems(), fetchRecipeLines(), fetchItems(), fetchMenuCosts(),
            ]);
            setMenu(m);
            setRecipes(r);
            setItems(i);
            setCosts(c);
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the menu.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
    const costsById = useMemo(() => new Map(costs.map(c => [c.menu_item_id, c])), [costs]);

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return menu;
        return menu.filter(m => m.name.toLowerCase().includes(needle));
    }, [menu, search]);

    const selected = useMemo(() => menu.find(m => m.id === selectedId) ?? null, [menu, selectedId]);
    const selectedLines = useMemo(
        () => recipes.filter(r => r.menu_item_id === selectedId),
        [recipes, selectedId],
    );

    useEffect(() => {
        setPriceDraft(selected?.sale_price_cop != null ? String(selected.sale_price_cop) : '');
    }, [selected]);

    async function handleAddLine() {
        if (!selectedId || !addItemId) return;
        const qty = parseQtyInput(addQty);
        if (qty === null || qty <= 0) {
            setError('Enter a quantity greater than zero.');
            return;
        }
        try {
            await upsertRecipeLine(selectedId, addItemId, qty);
            setAddItemId('');
            setAddQty('');
            setRecipes(await fetchRecipeLines());
            setCosts(await fetchMenuCosts());
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not add the ingredient.');
        }
    }

    async function toggleComplete(item: MenuItem) {
        const lines = recipes.filter(r => r.menu_item_id === item.id);
        if (!item.recipe_complete && lines.length === 0) {
            setError('Add at least one ingredient before marking the recipe complete.');
            return;
        }
        try {
            await updateMenuItem(item.id, { recipe_complete: !item.recipe_complete });
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not change it.');
        }
    }

    const completeCount = menu.filter(m => m.recipe_complete).length;

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>Recipes</h3>
                    <p style={iv.hint}>
                        Quantities are in <strong>raw</strong> units — how much uncooked rice is in a serving, not
                        the cooked weight on the plate. {completeCount} of {menu.length} recipes finished.
                    </p>
                </div>
                <button style={iv.btn} onClick={() => setShowNew(v => !v)}>
                    {showNew ? 'Close' : '+ New menu item'}
                </button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}

            {showNew && (
                <div style={iv.card}>
                    <div style={iv.fieldRow}>
                        <div style={iv.field}>
                            <label style={iv.label}>NAME</label>
                            <input style={iv.input} value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="Bowl Quinoa + Chicharrón" />
                        </div>
                        <div style={iv.field}>
                            <label style={iv.label}>CATEGORY</label>
                            <select style={iv.input} value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value as MenuCategory }))}>
                                {MENU_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div style={iv.field}>
                            <label style={iv.label}>SIZE (OPTIONAL)</label>
                            <input style={iv.input} value={newForm.portion_label} onChange={e => setNewForm(f => ({ ...f, portion_label: e.target.value }))} placeholder="Regular / Grande" />
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <button
                            style={iv.btn}
                            onClick={async () => {
                                if (!newForm.name.trim()) return;
                                try {
                                    const created = await createMenuItem({
                                        name: newForm.name.trim(),
                                        category: newForm.category,
                                        portion_label: newForm.portion_label.trim() || null,
                                    });
                                    setShowNew(false);
                                    setNewForm({ name: '', category: 'plate', portion_label: '' });
                                    await load();
                                    setSelectedId(created.id);
                                } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Could not create the menu item.');
                                }
                            }}
                        >Create</button>
                    </div>
                </div>
            )}

            {loading ? (
                <div style={iv.empty}>Loading…</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)', gap: 16, alignItems: 'start' }}>
                    {/* ── Menu list ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                        <input style={iv.input} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the menu…" />
                        <div style={{ ...iv.tableWrap, maxHeight: 520, overflowY: 'auto' }}>
                            <table style={{ ...iv.table, minWidth: 0 }}>
                                <thead>
                                    <tr>
                                        <th style={iv.th}>ITEM</th>
                                        <th style={iv.th}>ING.</th>
                                        <th style={iv.th}>STATUS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map(m => {
                                        const count = recipes.filter(r => r.menu_item_id === m.id).length;
                                        return (
                                            <tr
                                                key={m.id}
                                                onClick={() => setSelectedId(m.id)}
                                                style={{ cursor: 'pointer', background: m.id === selectedId ? 'rgba(240,180,39,0.08)' : undefined }}
                                            >
                                                <td style={{ ...iv.td, color: '#eee' }}>
                                                    {m.name}
                                                    {m.portion_label && <span style={{ color: '#777' }}> · {m.portion_label}</span>}
                                                    <div style={{ fontSize: 10, color: '#666' }}>{m.category}</div>
                                                </td>
                                                <td style={iv.td}>{count}</td>
                                                <td style={iv.td}>
                                                    <span style={{ ...iv.badge, ...(m.recipe_complete ? iv.badgeOk : iv.badgeWarn) }}>
                                                        {m.recipe_complete ? 'DONE' : 'TODO'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── Selected recipe ── */}
                    <div style={{ ...iv.card, minWidth: 0 }}>
                        {!selected ? (
                            <div style={iv.empty}>Pick a menu item on the left to edit its recipe.</div>
                        ) : (
                            <>
                                <div style={iv.sectionHeader}>
                                    <h4 style={{ ...iv.sectionTitle, fontSize: 14 }}>
                                        {selected.name}
                                        {selected.portion_label && <span style={{ color: '#777' }}> · {selected.portion_label}</span>}
                                    </h4>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button style={iv.btnGhost} onClick={() => toggleComplete(selected)}>
                                            {selected.recipe_complete ? 'Mark unfinished' : 'Mark complete'}
                                        </button>
                                        <button
                                            style={{ ...iv.btnGhost, color: '#ef4444' }}
                                            onClick={async () => {
                                                if (!window.confirm(`Remove "${selected.name}" from the menu?`)) return;
                                                try {
                                                    await archiveMenuItem(selected.id);
                                                    setSelectedId(null);
                                                    await load();
                                                } catch (e) {
                                                    setError(e instanceof Error ? e.message : 'Could not remove it.');
                                                }
                                            }}
                                        >Remove</button>
                                    </div>
                                </div>

                                {selected.notes && <div style={{ ...iv.warnBox, marginBottom: 10 }}>{selected.notes}</div>}

                                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
                                    <div style={{ ...iv.field, width: 160 }}>
                                        <label style={iv.label}>SALE PRICE (COP)</label>
                                        <input
                                            style={iv.input}
                                            inputMode="numeric"
                                            value={priceDraft}
                                            onChange={e => setPriceDraft(e.target.value)}
                                            onBlur={async () => {
                                                const value = priceDraft.trim() === '' ? null : parseCopInput(priceDraft);
                                                if (priceDraft.trim() !== '' && value === null) {
                                                    setError('The sale price is not a number.');
                                                    return;
                                                }
                                                // Only write when it actually changed. Saving on every
                                                // blur re-parsed a value that was never edited.
                                                if (value === (selected.sale_price_cop ?? null)) return;
                                                try {
                                                    await updateMenuItem(selected.id, { sale_price_cop: value });
                                                    await load();
                                                } catch (e) {
                                                    setError(e instanceof Error ? e.message : 'Could not save the price.');
                                                }
                                            }}
                                        />
                                    </div>
                                    {(() => {
                                        const cost = costsById.get(selected.id);
                                        const raw = Number(cost?.raw_cost_cop ?? 0);
                                        const price = Number(selected.sale_price_cop ?? 0);
                                        return (
                                            <div style={{ fontSize: 12, color: '#999' }}>
                                                Raw material cost <strong style={{ color: '#ccc' }}>{formatCop(raw)}</strong>
                                                {price > 0 && raw > 0 && (
                                                    <> · margin <strong style={{ color: '#22c55e' }}>{Math.round(((price - raw) / price) * 100)}%</strong></>
                                                )}
                                                {cost && cost.ingredient_count > cost.priced_ingredient_count && (
                                                    <div style={{ color: '#eab308', fontSize: 11 }}>
                                                        {cost.ingredient_count - cost.priced_ingredient_count} ingredient(s) have no purchase price yet
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                <div style={iv.tableWrap}>
                                    <table style={{ ...iv.table, minWidth: 0 }}>
                                        <thead>
                                            <tr>
                                                <th style={iv.th}>RAW MATERIAL</th>
                                                <th style={iv.th}>PER SERVING</th>
                                                <th style={iv.th}>COST</th>
                                                <th style={iv.th}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedLines.length === 0 && (
                                                <tr><td style={{ ...iv.td, ...iv.empty }} colSpan={4}>No ingredients yet.</td></tr>
                                            )}
                                            {selectedLines.map(line => {
                                                const item = itemsById.get(line.item_id);
                                                if (!item) return null;
                                                return (
                                                    <tr key={line.id}>
                                                        <td style={{ ...iv.td, color: '#ddd' }}>{item.name}</td>
                                                        <td style={iv.td}>{formatQty(line.qty_base, item.base_unit)}</td>
                                                        <td style={iv.td}>
                                                            {item.cost_per_base_unit != null
                                                                ? formatCop(Number(line.qty_base) * Number(item.cost_per_base_unit))
                                                                : '—'}
                                                        </td>
                                                        <td style={iv.td}>
                                                            <button
                                                                style={{ ...iv.btnGhost, padding: '4px 8px', color: '#ef4444' }}
                                                                onClick={async () => {
                                                                    try {
                                                                        await deleteRecipeLine(line.id);
                                                                        setRecipes(await fetchRecipeLines());
                                                                        setCosts(await fetchMenuCosts());
                                                                    } catch (e) {
                                                                        setError(e instanceof Error ? e.message : 'Could not remove the ingredient.');
                                                                    }
                                                                }}
                                                            >✕</button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                                    <select style={{ ...iv.input, width: 220 }} value={addItemId} onChange={e => setAddItemId(e.target.value)}>
                                        <option value="">— raw material —</option>
                                        {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}
                                    </select>
                                    <input
                                        style={{ ...iv.input, width: 110 }}
                                        inputMode="decimal"
                                        value={addQty}
                                        onChange={e => setAddQty(e.target.value)}
                                        placeholder={addItemId ? itemsById.get(addItemId)?.base_unit ?? 'qty' : 'qty'}
                                    />
                                    <button style={iv.btnGhost} onClick={handleAddLine}>+ Add ingredient</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
