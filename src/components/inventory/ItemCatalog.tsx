'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import {
    addPackConversion,
    archiveItem,
    createItem,
    deletePackConversion,
    fetchItemStock,
    fetchItems,
    fetchPackConversions,
    fetchSettings,
    updateItem,
} from '@/lib/inventory-api';
import { formatCop, formatQty, groupPacksByItem, parseQtyInput } from '@/lib/inventory-units';
import {
    STORAGE_AREAS,
    STORAGE_AREA_LABEL,
    type BaseUnit,
    type InventoryItem,
    type ItemCategory,
    type ItemStock,
    type PackConversion,
    type StorageArea,
} from '@/lib/inventory-types';

const CATEGORIES: ItemCategory[] = ['ingredient', 'beverage', 'alcohol', 'supply', 'other'];
const UNITS: BaseUnit[] = ['g', 'ml', 'unidad'];

export default function ItemCatalog() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [stock, setStock] = useState<ItemStock[]>([]);
    const [packs, setPacks] = useState<PackConversion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ name: '', base_unit: 'g' as BaseUnit, category: 'ingredient' as ItemCategory, is_tracked: true, storage_area: '' as StorageArea | '' });
    const [savingForm, setSavingForm] = useState(false);

    const [packLabel, setPackLabel] = useState('');
    const [packQty, setPackQty] = useState('');
    // The blind-count setting has to hold across every screen. Hiding the
    // expected figure only on the count sheet let the counter read it by
    // switching to this tab.
    const [blind, setBlind] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [i, p, cfg] = await Promise.all([fetchItems(), fetchPackConversions(), fetchSettings()]);
            setItems(i);
            setPacks(p);
            setBlind(cfg.blind_count);
            // Not fetched at all while blind counting is on, so it is not in
            // the network response either.
            setStock(cfg.blind_count ? [] : await fetchItemStock());
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the catalog.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const stockByItem = useMemo(() => new Map(stock.map(s => [s.item_id, s])), [stock]);

    const packsByItem = useMemo(() => groupPacksByItem(packs), [packs]);

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return items;
        return items.filter(i => i.name.toLowerCase().includes(needle));
    }, [items, search]);

    async function handleCreate() {
        if (!form.name.trim()) return;
        setSavingForm(true);
        try {
            await createItem({
                name: form.name.trim(),
                base_unit: form.base_unit,
                category: form.category,
                is_tracked: form.is_tracked,
                // Without this the item is invisible to an area-scoped count
                // sheet, which is how the kitchen and the bar are counted
                // separately.
                storage_area: form.storage_area || null,
                item_type: 'raw',
            });
            setForm({ name: '', base_unit: 'g', category: 'ingredient', is_tracked: true, storage_area: '' });
            setShowForm(false);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the item.');
        } finally {
            setSavingForm(false);
        }
    }

    async function handleAddPack(itemId: string) {
        const qty = parseQtyInput(packQty);
        if (!packLabel.trim() || qty === null || qty <= 0) {
            setError('Give the pack a name and a positive size.');
            return;
        }
        try {
            await addPackConversion(itemId, packLabel, qty);
            setPackLabel('');
            setPackQty('');
            setPacks(await fetchPackConversions());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not add the pack size.');
        }
    }

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>Item catalog</h3>
                    <p style={iv.hint}>
                        Everything is stored in one base unit per item. Pack sizes translate what suppliers write
                        (&quot;1 bulto&quot;, &quot;1 caja&quot;) into that unit.
                    </p>
                </div>
                <button style={iv.btn} onClick={() => setShowForm(v => !v)}>
                    {showForm ? 'Close' : '+ New item'}
                </button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}

            {showForm && (
                <div style={iv.card}>
                    <div style={iv.fieldRow}>
                        <div style={iv.field}>
                            <label style={iv.label}>NAME</label>
                            <input style={iv.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Pechuga de pollo" />
                        </div>
                        <div style={iv.field}>
                            <label style={iv.label}>BASE UNIT</label>
                            <select style={iv.input} value={form.base_unit} onChange={e => setForm(f => ({ ...f, base_unit: e.target.value as BaseUnit }))}>
                                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                        </div>
                        <div style={iv.field}>
                            <label style={iv.label}>CATEGORY</label>
                            <select style={iv.input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as ItemCategory }))}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div style={iv.field}>
                            <label style={iv.label}>WHERE IT IS KEPT</label>
                            <select style={iv.input} value={form.storage_area} onChange={e => setForm(f => ({ ...f, storage_area: e.target.value as StorageArea | '' }))}>
                                <option value="">— not set —</option>
                                {STORAGE_AREAS.map(a => <option key={a} value={a}>{STORAGE_AREA_LABEL[a]}</option>)}
                            </select>
                        </div>
                        <div style={{ ...iv.field, justifyContent: 'flex-end' }}>
                            <label style={{ ...iv.label, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                                <input type="checkbox" checked={form.is_tracked} onChange={e => setForm(f => ({ ...f, is_tracked: e.target.checked }))} />
                                COUNT THIS ITEM
                            </label>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <button style={{ ...iv.btn, ...(savingForm ? iv.btnDisabled : {}) }} disabled={savingForm} onClick={handleCreate}>
                            {savingForm ? 'Saving…' : 'Create item'}
                        </button>
                    </div>
                </div>
            )}

            <input style={{ ...iv.input, maxWidth: 320 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" />

            {loading ? (
                <div style={iv.empty}>Loading…</div>
            ) : visible.length === 0 ? (
                <div style={iv.empty}>
                    No items yet. They appear here as you map receipt lines, or add them directly.
                </div>
            ) : (
                <div style={iv.tableWrap}>
                    <table style={iv.table}>
                        <thead>
                            <tr>
                                <th style={iv.th}>ITEM</th>
                                <th style={iv.th}>CATEGORY</th>
                                <th style={iv.th}>UNIT</th>
                                <th style={iv.th}>AREA</th>
                                <th style={iv.th}>IN STOCK</th>
                                <th style={iv.th}>LAST COST</th>
                                <th style={iv.th}>COUNTED</th>
                                <th style={iv.th}>PACKS</th>
                                <th style={iv.th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(item => {
                                const itemStock = stockByItem.get(item.id);
                                const itemPacks = packsByItem.get(item.id) ?? [];
                                const isOpen = expanded === item.id;
                                return (
                                    <Fragment key={item.id}>
                                        <tr>
                                            <td style={{ ...iv.td, color: '#eee', fontWeight: 600 }}>{item.name}</td>
                                            <td style={iv.td}>{item.category}</td>
                                            <td style={iv.td}>{item.base_unit}</td>
                                            <td style={iv.td}>
                                                <select
                                                    style={{ ...iv.input, width: 110, fontSize: 11 }}
                                                    value={item.storage_area ?? ''}
                                                    onChange={async e => {
                                                        try {
                                                            await updateItem(item.id, { storage_area: (e.target.value || null) as StorageArea | null });
                                                            await load();
                                                        } catch (err) {
                                                            setError(err instanceof Error ? err.message : 'Could not change the area.');
                                                        }
                                                    }}
                                                >
                                                    <option value="">—</option>
                                                    {STORAGE_AREAS.map(a => <option key={a} value={a}>{STORAGE_AREA_LABEL[a]}</option>)}
                                                </select>
                                            </td>
                                            <td style={iv.td}>
                                                {blind
                                                    ? <span style={{ color: '#555' }} title="Hidden while blind counting is on">••••</span>
                                                    : formatQty(itemStock?.stock_base_qty ?? 0, item.base_unit)}
                                            </td>
                                            <td style={iv.td}>
                                                {item.cost_per_base_unit != null
                                                    ? `${formatCop(item.cost_per_base_unit)}/${item.base_unit}`
                                                    : '—'}
                                            </td>
                                            <td style={iv.td}>
                                                <label style={{ cursor: 'pointer' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={item.is_tracked}
                                                        onChange={async e => {
                                                            try {
                                                                await updateItem(item.id, { is_tracked: e.target.checked });
                                                                await load();
                                                            } catch (err) {
                                                                setError(err instanceof Error ? err.message : 'Could not change it.');
                                                            }
                                                        }}
                                                    />
                                                </label>
                                            </td>
                                            <td style={iv.td}>
                                                <button style={{ ...iv.btnGhost, padding: '4px 10px' }} onClick={() => setExpanded(isOpen ? null : item.id)}>
                                                    {itemPacks.length} ▾
                                                </button>
                                            </td>
                                            <td style={iv.td}>
                                                <button
                                                    style={{ ...iv.btnGhost, padding: '4px 10px', color: '#ef4444' }}
                                                    onClick={async () => {
                                                        if (!window.confirm(`Archive "${item.name}"? Its stock history is kept.`)) return;
                                                        try {
                                                            await archiveItem(item.id);
                                                            await load();
                                                        } catch (err) {
                                                            setError(err instanceof Error ? err.message : 'Could not archive it.');
                                                        }
                                                    }}
                                                >Archive</button>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr>
                                                <td style={{ ...iv.td, background: '#141414' }} colSpan={9}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <p style={iv.hint}>
                                                            How much of <strong>{item.base_unit}</strong> is in one pack, so receipt quantities convert automatically.
                                                        </p>
                                                        {itemPacks.map(pack => (
                                                            <div key={pack.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: '#ccc' }}>
                                                                <span>1 <strong>{pack.pack_label}</strong> = {formatQty(pack.base_qty, item.base_unit)}</span>
                                                                <button
                                                                    style={{ ...iv.btnGhost, padding: '2px 8px', color: '#ef4444' }}
                                                                    onClick={async () => {
                                                                    try {
                                                                        await deletePackConversion(pack.id);
                                                                        setPacks(await fetchPackConversions());
                                                                    } catch (err) {
                                                                        setError(err instanceof Error ? err.message : 'Could not remove the pack size.');
                                                                    }
                                                                }}
                                                                >remove</button>
                                                            </div>
                                                        ))}
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <input style={{ ...iv.input, width: 140 }} value={packLabel} onChange={e => setPackLabel(e.target.value)} placeholder="bulto, caja, sobre" />
                                                            <span style={{ color: '#666', fontSize: 12 }}>=</span>
                                                            <input style={{ ...iv.input, width: 120 }} inputMode="decimal" value={packQty} onChange={e => setPackQty(e.target.value)} placeholder={item.base_unit} />
                                                            <button style={iv.btnGhost} onClick={() => handleAddPack(item.id)}>Add pack size</button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
