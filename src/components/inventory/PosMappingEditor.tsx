'use client';

import { useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import { setPosModifierMap, setPosProductMap } from '@/lib/pos-api';
import type { MenuItem } from '@/lib/inventory-types';
import type { PosModifierKind, PosModifierMap, PosProductKind, PosProductMap } from '@/lib/pos-types';

const PORTIONS = ['Regular', 'Grande'];

const PRODUCT_KIND_LABEL: Record<PosProductKind, string> = {
    menu_item: 'Menu item',
    composite: 'Build-your-own bowl',
    ignore: 'Not inventory',
};

interface ProductDraft {
    kind: PosProductKind | '';
    menuItemId: string;
    portion: string;
}

interface PieceDraft {
    kind: PosModifierKind | '';
    componentName: string;
}

// A confirmed mapping is shown as confirmed. An unconfirmed row starts from the
// AI suggestion, if any, so accepting it is one click — but it is still a
// click. Nothing here saves on its own.
function productDraftFrom(m: PosProductMap): ProductDraft {
    if (m.confirmed && m.kind) {
        return { kind: m.kind, menuItemId: m.menu_item_id ?? '', portion: m.portion_label ?? '' };
    }
    return {
        kind: m.suggested_kind ?? '',
        menuItemId: m.suggested_menu_item_id ?? '',
        portion: m.suggested_portion_label ?? '',
    };
}

function pieceDraftFrom(m: PosModifierMap): PieceDraft {
    if (m.confirmed && m.kind) return { kind: m.kind, componentName: m.component_name ?? '' };
    return { kind: m.suggested_kind ?? '', componentName: m.suggested_component_name ?? '' };
}

function productDraftReady(d: ProductDraft): boolean {
    if (d.kind === 'ignore') return true;
    if (d.kind === 'menu_item') return Boolean(d.menuItemId);
    if (d.kind === 'composite') return PORTIONS.includes(d.portion);
    return false;
}

function pieceDraftReady(d: PieceDraft): boolean {
    if (d.kind === 'ignore') return true;
    return d.kind === 'component' && Boolean(d.componentName);
}

export default function PosMappingEditor({
    adminId,
    productMaps,
    modifierMaps,
    menu,
    onChanged,
    onError,
    onNotice,
}: {
    adminId: string;
    productMaps: PosProductMap[];
    modifierMaps: PosModifierMap[];
    menu: MenuItem[];
    onChanged: () => Promise<void> | void;
    onError: (message: string) => void;
    onNotice: (message: string) => void;
}) {
    const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
    const [pieceDrafts, setPieceDrafts] = useState<Record<string, PieceDraft>>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [bulkSaving, setBulkSaving] = useState(false);
    const [showConfirmed, setShowConfirmed] = useState(false);

    // Bowl components are pieces, not dishes: offering "Topping: Aguacate" as a
    // menu item for a POS product invites exactly the wrong match.
    const menuOptions = useMemo(
        () => menu
            .filter(m => m.active && m.category !== 'bowl')
            .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
        [menu],
    );
    const componentNames = useMemo(
        () => [...new Set(menu.filter(m => m.active && m.category === 'bowl').map(m => m.name))].sort(),
        [menu],
    );
    const menuById = useMemo(() => new Map(menu.map(m => [m.id, m])), [menu]);

    const pendingProducts = productMaps.filter(m => !m.confirmed);
    const pendingPieces = modifierMaps.filter(m => !m.confirmed);
    const visibleProducts = showConfirmed ? productMaps : pendingProducts;
    const visiblePieces = showConfirmed ? modifierMaps : pendingPieces;

    const productDraft = (m: PosProductMap) => productDrafts[m.id] ?? productDraftFrom(m);
    const pieceDraft = (m: PosModifierMap) => pieceDrafts[m.id] ?? pieceDraftFrom(m);

    const acceptable = {
        products: pendingProducts.filter(m => m.suggested_kind && productDraftReady(productDraftFrom(m))),
        pieces: pendingPieces.filter(m => m.suggested_kind && pieceDraftReady(pieceDraftFrom(m))),
    };

    async function saveProduct(m: PosProductMap) {
        const d = productDraft(m);
        if (!productDraftReady(d)) return;
        setSavingId(m.id);
        try {
            await setPosProductMap({
                mapId: m.id,
                kind: d.kind as PosProductKind,
                menuItemId: d.menuItemId || null,
                portionLabel: d.portion || null,
                actorId: adminId || null,
            });
            setProductDrafts(prev => {
                const next = { ...prev };
                delete next[m.id];
                return next;
            });
            await onChanged();
        } catch (e) {
            onError(e instanceof Error ? e.message : 'Could not save that mapping.');
        } finally {
            setSavingId(null);
        }
    }

    async function savePiece(m: PosModifierMap) {
        const d = pieceDraft(m);
        if (!pieceDraftReady(d)) return;
        setSavingId(m.id);
        try {
            await setPosModifierMap({
                mapId: m.id,
                kind: d.kind as PosModifierKind,
                componentName: d.componentName || null,
                actorId: adminId || null,
            });
            setPieceDrafts(prev => {
                const next = { ...prev };
                delete next[m.id];
                return next;
            });
            await onChanged();
        } catch (e) {
            onError(e instanceof Error ? e.message : 'Could not save that mapping.');
        } finally {
            setSavingId(null);
        }
    }

    // Accepts the suggestions as they were proposed, not any unsaved edits on
    // screen — those are saved row by row, where the person can see them.
    async function acceptAllSuggestions() {
        const total = acceptable.products.length + acceptable.pieces.length;
        if (total === 0) return;
        if (!window.confirm(
            `Accept ${total} AI suggestion(s) as they are? Each one decides what comes off stock when that product sells.`,
        )) return;

        setBulkSaving(true);
        let saved = 0;
        const failures: string[] = [];
        for (const m of acceptable.products) {
            const d = productDraftFrom(m);
            try {
                await setPosProductMap({
                    mapId: m.id,
                    kind: d.kind as PosProductKind,
                    menuItemId: d.menuItemId || null,
                    portionLabel: d.portion || null,
                    actorId: adminId || null,
                });
                saved += 1;
            } catch (e) {
                failures.push(`${m.pos_name}: ${e instanceof Error ? e.message : 'failed'}`);
            }
        }
        for (const m of acceptable.pieces) {
            const d = pieceDraftFrom(m);
            try {
                await setPosModifierMap({
                    mapId: m.id,
                    kind: d.kind as PosModifierKind,
                    componentName: d.componentName || null,
                    actorId: adminId || null,
                });
                saved += 1;
            } catch (e) {
                failures.push(`${m.token_display}: ${e instanceof Error ? e.message : 'failed'}`);
            }
        }
        setBulkSaving(false);
        await onChanged();
        if (failures.length > 0) onError(`${saved} saved, ${failures.length} failed — ${failures.slice(0, 3).join(' · ')}`);
        else onNotice(`${saved} mapping(s) saved.`);
    }

    if (productMaps.length === 0 && modifierMaps.length === 0) {
        return (
            <div style={iv.empty}>
                No POS products seen yet. They appear here after the first import.
            </div>
        );
    }

    const acceptTotal = acceptable.products.length + acceptable.pieces.length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ ...iv.label, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}>
                    <input type="checkbox" checked={showConfirmed} onChange={e => setShowConfirmed(e.target.checked)} />
                    SHOW CONFIRMED TOO
                </label>
                {acceptTotal > 0 && (
                    <button
                        style={{ ...iv.btnGhost, ...(bulkSaving ? iv.btnDisabled : {}), marginLeft: 'auto' }}
                        disabled={bulkSaving}
                        onClick={acceptAllSuggestions}
                    >
                        {bulkSaving ? 'Saving…' : `Accept all ${acceptTotal} AI suggestions`}
                    </button>
                )}
            </div>

            {/* ── Products ── */}
            <div>
                <h4 style={{ ...iv.sectionTitle, fontSize: 14, marginBottom: 6 }}>
                    Products {pendingProducts.length > 0 && <span style={{ color: '#eab308' }}>· {pendingProducts.length} to match</span>}
                </h4>
                {visibleProducts.length === 0 ? (
                    <p style={iv.hint}>Every product is matched.</p>
                ) : (
                    <div style={iv.tableWrap}>
                        <table style={iv.table}>
                            <thead>
                                <tr>
                                    <th style={iv.th}>ON THE REGISTER</th>
                                    <th style={iv.th}>IS</th>
                                    <th style={iv.th}>MATCH</th>
                                    <th style={iv.th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleProducts.map(m => {
                                    const d = productDraft(m);
                                    const edited = Boolean(productDrafts[m.id]);
                                    const target = d.menuItemId ? menuById.get(d.menuItemId) : undefined;
                                    const update = (patch: Partial<ProductDraft>) =>
                                        setProductDrafts(prev => ({ ...prev, [m.id]: { ...d, ...patch } }));
                                    const fromAi = !m.confirmed && !edited && Boolean(m.suggested_kind);

                                    return (
                                        <tr key={m.id}>
                                            <td style={{ ...iv.td, color: '#eee', fontWeight: 600, minWidth: 180 }}>
                                                {m.pos_name}
                                                {m.confirmed && <span style={{ ...iv.badge, ...iv.badgeOk, marginLeft: 6 }}>CONFIRMED</span>}
                                                {m.suggestion_reason && !m.confirmed && (
                                                    <div style={{ fontSize: 11, color: '#888', fontWeight: 400, marginTop: 2 }}>
                                                        ✨ {m.suggestion_reason}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={iv.td}>
                                                <select
                                                    style={{ ...iv.input, width: 170, fontSize: 12 }}
                                                    value={d.kind}
                                                    onChange={e => update({ kind: e.target.value as PosProductKind | '' })}
                                                >
                                                    <option value="">— choose —</option>
                                                    {(Object.keys(PRODUCT_KIND_LABEL) as PosProductKind[]).map(k => (
                                                        <option key={k} value={k}>{PRODUCT_KIND_LABEL[k]}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td style={iv.td}>
                                                {d.kind === 'menu_item' && (
                                                    <>
                                                        <select
                                                            style={{ ...iv.input, width: 240, fontSize: 12 }}
                                                            value={d.menuItemId}
                                                            onChange={e => update({ menuItemId: e.target.value })}
                                                        >
                                                            <option value="">— menu item —</option>
                                                            {menuOptions.map(item => (
                                                                <option key={item.id} value={item.id}>
                                                                    {item.name}{item.portion_label ? ` · ${item.portion_label}` : ''} ({item.category})
                                                                </option>
                                                            ))}
                                                        </select>
                                                        {fromAi && !m.suggested_menu_item_id && (
                                                            <div style={{ fontSize: 11, color: '#eab308', marginTop: 3 }}>
                                                                No menu item matches — create it under Recipes first.
                                                            </div>
                                                        )}
                                                        {target && !target.recipe_complete && (
                                                            <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                                                                Recipe not finished: sales will be recorded but take nothing off stock yet.
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                                {d.kind === 'composite' && (
                                                    <>
                                                        <select
                                                            style={{ ...iv.input, width: 140, fontSize: 12 }}
                                                            value={d.portion}
                                                            onChange={e => update({ portion: e.target.value })}
                                                        >
                                                            <option value="">— size —</option>
                                                            {PORTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                                                        </select>
                                                        <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                                                            Each piece the customer picks comes off at this size.
                                                        </div>
                                                    </>
                                                )}
                                                {d.kind === 'ignore' && (
                                                    <span style={{ fontSize: 12, color: '#888' }}>Sales recorded, nothing deducted.</span>
                                                )}
                                            </td>
                                            <td style={iv.td}>
                                                <button
                                                    style={{
                                                        ...iv.btn,
                                                        padding: '6px 12px',
                                                        fontSize: 12,
                                                        ...(!productDraftReady(d) || savingId === m.id ? iv.btnDisabled : {}),
                                                    }}
                                                    disabled={!productDraftReady(d) || savingId === m.id}
                                                    onClick={() => saveProduct(m)}
                                                >
                                                    {savingId === m.id ? 'Saving…' : m.confirmed ? 'Update' : fromAi ? 'Accept' : 'Confirm'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Bowl pieces ── */}
            <div>
                <h4 style={{ ...iv.sectionTitle, fontSize: 14, marginBottom: 6 }}>
                    Bowl pieces {pendingPieces.length > 0 && <span style={{ color: '#eab308' }}>· {pendingPieces.length} to match</span>}
                </h4>
                <p style={{ ...iv.hint, marginBottom: 6 }}>
                    What the customer picks inside a bowl. Each piece is matched once to a bowl component; the size
                    comes from whether the bowl was Medium or Big.
                </p>
                {visiblePieces.length === 0 ? (
                    <p style={iv.hint}>Every bowl piece is matched.</p>
                ) : (
                    <div style={iv.tableWrap}>
                        <table style={iv.table}>
                            <thead>
                                <tr>
                                    <th style={iv.th}>ON THE REGISTER</th>
                                    <th style={iv.th}>IS</th>
                                    <th style={iv.th}>COMPONENT</th>
                                    <th style={iv.th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {visiblePieces.map(m => {
                                    const d = pieceDraft(m);
                                    const edited = Boolean(pieceDrafts[m.id]);
                                    const update = (patch: Partial<PieceDraft>) =>
                                        setPieceDrafts(prev => ({ ...prev, [m.id]: { ...d, ...patch } }));
                                    const fromAi = !m.confirmed && !edited && Boolean(m.suggested_kind);

                                    return (
                                        <tr key={m.id}>
                                            <td style={{ ...iv.td, color: '#eee', fontWeight: 600, minWidth: 180 }}>
                                                {m.token_display}
                                                {m.confirmed && <span style={{ ...iv.badge, ...iv.badgeOk, marginLeft: 6 }}>CONFIRMED</span>}
                                                {m.suggestion_reason && !m.confirmed && (
                                                    <div style={{ fontSize: 11, color: '#888', fontWeight: 400, marginTop: 2 }}>
                                                        ✨ {m.suggestion_reason}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={iv.td}>
                                                <select
                                                    style={{ ...iv.input, width: 150, fontSize: 12 }}
                                                    value={d.kind}
                                                    onChange={e => update({ kind: e.target.value as PosModifierKind | '' })}
                                                >
                                                    <option value="">— choose —</option>
                                                    <option value="component">Component</option>
                                                    <option value="ignore">Not inventory</option>
                                                </select>
                                            </td>
                                            <td style={iv.td}>
                                                {d.kind === 'component' ? (
                                                    <>
                                                        <select
                                                            style={{ ...iv.input, width: 260, fontSize: 12 }}
                                                            value={d.componentName}
                                                            onChange={e => update({ componentName: e.target.value })}
                                                        >
                                                            <option value="">— component —</option>
                                                            {componentNames.map(name => <option key={name} value={name}>{name}</option>)}
                                                        </select>
                                                        {fromAi && !m.suggested_component_name && (
                                                            <div style={{ fontSize: 11, color: '#eab308', marginTop: 3 }}>
                                                                No component matches — add it under Recipes first.
                                                            </div>
                                                        )}
                                                    </>
                                                ) : d.kind === 'ignore' ? (
                                                    <span style={{ fontSize: 12, color: '#888' }}>Nothing deducted, e.g. &quot;Sin salsa&quot;.</span>
                                                ) : null}
                                            </td>
                                            <td style={iv.td}>
                                                <button
                                                    style={{
                                                        ...iv.btn,
                                                        padding: '6px 12px',
                                                        fontSize: 12,
                                                        ...(!pieceDraftReady(d) || savingId === m.id ? iv.btnDisabled : {}),
                                                    }}
                                                    disabled={!pieceDraftReady(d) || savingId === m.id}
                                                    onClick={() => savePiece(m)}
                                                >
                                                    {savingId === m.id ? 'Saving…' : m.confirmed ? 'Update' : fromAi ? 'Accept' : 'Confirm'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
