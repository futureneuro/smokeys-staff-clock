'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import PosMappingEditor from './PosMappingEditor';
import { fetchMenuItems } from '@/lib/inventory-api';
import {
    fetchPosImports,
    fetchPosModifierMaps,
    fetchPosProductMaps,
    retryHeldPosDays,
    suggestPosMappings,
    syncPosDay,
} from '@/lib/pos-api';
import { formatCop, getBogotaDateString } from '@/lib/inventory-units';
import type { MenuItem } from '@/lib/inventory-types';
import type { PosImport, PosImportStatus, PosModifierMap, PosProductMap, PosSyncDayResult } from '@/lib/pos-types';

const STATUS_LABEL: Record<PosImportStatus, string> = {
    pending_mapping: 'NEEDS MATCHING',
    confirmed: 'DEDUCTED',
    skipped_manual: 'TYPED BY HAND',
    no_sales: 'NO SALES',
    failed: 'FAILED',
};

function statusBadge(status: PosImportStatus) {
    if (status === 'confirmed') return { ...iv.badge, ...iv.badgeOk };
    if (status === 'pending_mapping') return { ...iv.badge, ...iv.badgeWarn };
    if (status === 'failed') return { ...iv.badge, ...iv.badgeBad };
    return { ...iv.badge, ...iv.badgeInfo };
}

const qty = (n: number | string) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });

function yesterdayInBogota(): string {
    const today = getBogotaDateString();
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

function describe(results: PosSyncDayResult[]): string {
    if (results.length === 0) return 'Nothing to retry.';
    return results.map(r => {
        if (r.already) return `${r.sold_on}: already imported.`;
        switch (r.status) {
            case 'confirmed': return `${r.sold_on}: ${r.deducted_count ?? 0} item(s) taken off stock${r.not_deducted_count ? `, ${r.not_deducted_count} waiting on recipes` : ''}.`;
            case 'pending_mapping': return `${r.sold_on}: held — ${r.held_count ?? 0} thing(s) need matching below.`;
            case 'skipped_manual': return `${r.sold_on}: skipped, that day was typed in by hand.`;
            case 'no_sales': return `${r.sold_on}: OlaClick reports no sales.`;
            default: return `${r.sold_on}: failed — ${r.error ?? 'unknown error'}`;
        }
    }).join(' ');
}

export default function PosSync({ adminId }: { adminId: string }) {
    const [imports, setImports] = useState<PosImport[]>([]);
    const [productMaps, setProductMaps] = useState<PosProductMap[]>([]);
    const [modifierMaps, setModifierMaps] = useState<PosModifierMap[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState<'sync' | 'date' | 'retry' | 'suggest' | null>(null);
    const [syncDate, setSyncDate] = useState(yesterdayInBogota());
    const [openDay, setOpenDay] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [i, p, m, items] = await Promise.all([
                fetchPosImports(),
                fetchPosProductMaps(),
                fetchPosModifierMaps(),
                fetchMenuItems(),
            ]);
            setImports(i);
            setProductMaps(p);
            setModifierMaps(m);
            setMenu(items);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the POS sync.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function run(kind: NonNullable<typeof busy>, action: () => Promise<string>) {
        setBusy(kind);
        setError('');
        setNotice('');
        try {
            setNotice(await action());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The POS sync failed.');
        } finally {
            setBusy(null);
            await load();
        }
    }

    const pendingProducts = productMaps.filter(m => !m.confirmed).length;
    const pendingPieces = modifierMaps.filter(m => !m.confirmed).length;
    const heldDays = imports.filter(i => i.status === 'pending_mapping' || i.status === 'failed').length;
    const today = getBogotaDateString();

    const insights = useMemo(() => {
        const pieces = new Map<string, number>();
        let comps = 0;
        let revenue = 0;
        let days = 0;
        for (const day of imports) {
            if (day.status !== 'confirmed' && day.status !== 'pending_mapping') continue;
            days += 1;
            revenue += Number(day.revenue_cop ?? 0);
            comps += Number(day.freehand_count ?? 0);
            for (const p of day.summary?.bowl_pieces ?? []) {
                pieces.set(p.token_display, (pieces.get(p.token_display) ?? 0) + Number(p.qty));
            }
        }
        const topPieces = [...pieces.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
        const max = topPieces[0]?.[1] ?? 0;
        return { topPieces, max, comps, revenue, days };
    }, [imports]);

    const busyStyle = (kind: typeof busy) => (busy && busy !== kind ? iv.btnDisabled : {});

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>OlaClick POS</h3>
                    <p style={iv.hint}>
                        Every morning at 4:00 the previous day&apos;s sales are pulled from OlaClick and taken off stock.
                        A day only deducts once every product sold is matched — anything unrecognised holds the day
                        rather than being skipped.
                    </p>
                </div>
            </div>

            <div style={{ ...iv.card, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <button
                    style={{ ...iv.btn, ...busyStyle('sync') }}
                    disabled={busy !== null}
                    onClick={() => run('sync', async () => describe(await syncPosDay(null, adminId || null)))}
                >
                    {busy === 'sync' ? 'Importing…' : 'Import yesterday'}
                </button>

                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    <div style={iv.field}>
                        <label style={iv.label}>OR A DAY</label>
                        <input
                            type="date"
                            style={{ ...iv.input, width: 160 }}
                            value={syncDate}
                            max={yesterdayInBogota()}
                            onChange={e => setSyncDate(e.target.value)}
                        />
                    </div>
                    <button
                        style={{ ...iv.btnGhost, ...busyStyle('date'), ...(!syncDate || syncDate >= today ? iv.btnDisabled : {}) }}
                        disabled={busy !== null || !syncDate || syncDate >= today}
                        onClick={() => run('date', async () => describe(await syncPosDay(syncDate, adminId || null)))}
                    >
                        {busy === 'date' ? 'Importing…' : 'Import'}
                    </button>
                </div>

                <button
                    style={{ ...iv.btnGhost, ...busyStyle('retry'), ...(heldDays === 0 ? iv.btnDisabled : {}) }}
                    disabled={busy !== null || heldDays === 0}
                    onClick={() => run('retry', async () => describe(await retryHeldPosDays(adminId || null)))}
                >
                    {busy === 'retry' ? 'Retrying…' : `Retry held days${heldDays ? ` (${heldDays})` : ''}`}
                </button>

                <button
                    style={{ ...iv.btnGhost, marginLeft: 'auto', ...busyStyle('suggest'), ...(pendingProducts + pendingPieces === 0 ? iv.btnDisabled : {}) }}
                    disabled={busy !== null || pendingProducts + pendingPieces === 0}
                    onClick={() => run('suggest', async () => {
                        const r = await suggestPosMappings(adminId || null);
                        return `AI suggested ${r.products} product match(es) and ${r.pieces} bowl piece match(es). Review and accept below.`;
                    })}
                >
                    {busy === 'suggest' ? 'Asking AI…' : '✨ Suggest matches with AI'}
                </button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}
            {notice && <div style={iv.okBox}>{notice}</div>}

            {loading ? (
                <div style={iv.empty}>Loading…</div>
            ) : (
                <>
                    {(pendingProducts > 0 || pendingPieces > 0) && (
                        <div style={iv.warnBox}>
                            {pendingProducts} product(s) and {pendingPieces} bowl piece(s) still need matching. Days that
                            sold them stay held until they are.
                        </div>
                    )}

                    <div style={iv.card}>
                        <h4 style={{ ...iv.sectionTitle, fontSize: 15, marginBottom: 10 }}>Matching</h4>
                        <PosMappingEditor
                            adminId={adminId}
                            productMaps={productMaps}
                            modifierMaps={modifierMaps}
                            menu={menu}
                            onChanged={load}
                            onError={msg => { setNotice(''); setError(msg); }}
                            onNotice={msg => { setError(''); setNotice(msg); }}
                        />
                    </div>

                    <div>
                        <h4 style={{ ...iv.sectionTitle, fontSize: 15, marginBottom: 8 }}>Imported days</h4>
                        {imports.length === 0 ? (
                            <div style={iv.empty}>No days imported yet.</div>
                        ) : (
                            <div style={iv.tableWrap}>
                                <table style={iv.table}>
                                    <thead>
                                        <tr>
                                            <th style={iv.th}>DAY</th>
                                            <th style={iv.th}>STATUS</th>
                                            <th style={iv.th}>ITEMS SOLD</th>
                                            <th style={iv.th}>REVENUE</th>
                                            <th style={iv.th}>DEDUCTED</th>
                                            <th style={iv.th}>WAITING ON RECIPES</th>
                                            <th style={iv.th}>COMPS</th>
                                            <th style={iv.th}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {imports.map(day => {
                                            const isOpen = openDay === day.id;
                                            const s = day.summary ?? {};
                                            return (
                                                <DayRows
                                                    key={day.id}
                                                    day={day}
                                                    isOpen={isOpen}
                                                    onToggle={() => setOpenDay(isOpen ? null : day.id)}
                                                    summary={s}
                                                />
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {insights.days > 0 && (
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
                            <div style={{ ...iv.card, flex: 2, minWidth: 280 }}>
                                <div style={iv.label}>WHAT CUSTOMERS PUT IN BOWLS · LAST {insights.days} DAY(S)</div>
                                {insights.topPieces.length === 0 ? (
                                    <p style={iv.hint}>No bowls sold in these days.</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                                        {insights.topPieces.map(([name, count]) => (
                                            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                                <span style={{ width: 190, color: '#ccc', flexShrink: 0 }}>{name}</span>
                                                <div style={{ flex: 1, background: '#222', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                                                    <div style={{
                                                        width: `${insights.max ? (count / insights.max) * 100 : 0}%`,
                                                        background: '#f0b427',
                                                        height: '100%',
                                                    }} />
                                                </div>
                                                <span style={{ width: 28, textAlign: 'right', color: '#eee' }}>{qty(count)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 180 }}>
                                <div style={iv.card}>
                                    <div style={iv.label}>REVENUE IMPORTED</div>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: '#f0b427' }}>{formatCop(insights.revenue)}</div>
                                </div>
                                <div style={iv.card}>
                                    <div style={iv.label}>COMPS &amp; STAFF MEALS</div>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: insights.comps > 0 ? '#eab308' : '#22c55e' }}>
                                        {qty(insights.comps)}
                                    </div>
                                    <p style={{ ...iv.hint, marginTop: 4 }}>
                                        Typed as free text at the register, so their pieces are unknown. Ring them as the
                                        real item with a 100% discount and they deduct properly.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function DayRows({
    day,
    isOpen,
    onToggle,
    summary,
}: {
    day: PosImport;
    isOpen: boolean;
    onToggle: () => void;
    summary: PosImport['summary'];
}) {
    const heldTotal =
        (summary.unmapped_products?.length ?? 0) +
        (summary.unmapped_tokens?.length ?? 0) +
        (summary.unresolved_components?.length ?? 0);

    return (
        <>
            <tr>
                <td style={{ ...iv.td, color: '#eee', fontWeight: 600 }}>
                    {day.sold_on}
                    {day.triggered_by === 'schedule' && <div style={{ fontSize: 10, color: '#666' }}>automatic</div>}
                </td>
                <td style={iv.td}>
                    <span style={statusBadge(day.status)}>{STATUS_LABEL[day.status]}</span>
                </td>
                <td style={iv.td}>{qty(day.item_count)}</td>
                <td style={iv.td}>{formatCop(Number(day.revenue_cop))}</td>
                <td style={iv.td}>{day.status === 'confirmed' ? day.deducted_count : '—'}</td>
                <td style={{ ...iv.td, color: day.not_deducted_count > 0 ? '#eab308' : '#ccc' }}>{day.not_deducted_count}</td>
                <td style={iv.td}>{qty(day.freehand_count)}</td>
                <td style={iv.td}>
                    <button style={{ ...iv.btnGhost, padding: '4px 10px' }} onClick={onToggle}>
                        {isOpen ? 'Hide' : 'Details'}
                    </button>
                </td>
            </tr>
            {isOpen && (
                <tr>
                    <td colSpan={8} style={{ ...iv.td, background: '#141414' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                            {day.error && (
                                <div style={{ ...iv.errBox, gridColumn: '1 / -1' }}>{day.error}</div>
                            )}

                            {heldTotal > 0 && (
                                <Section title="Holding this day" color="#eab308">
                                    {summary.unmapped_products?.map(p => (
                                        <Line key={`p-${p.pos_product_id}-${p.pos_variant_id}`} left={p.pos_name} right={qty(p.qty)} note="product not matched" />
                                    ))}
                                    {summary.unmapped_tokens?.map(t => (
                                        <Line key={`t-${t.token_key}`} left={t.token_display} right={qty(t.qty)} note="bowl piece not matched" />
                                    ))}
                                    {summary.unresolved_components?.map(c => (
                                        <Line key={`c-${c.component_name}-${c.portion_label}`} left={`${c.component_name} · ${c.portion_label}`} right={qty(c.qty)} note="no component at this size" />
                                    ))}
                                </Section>
                            )}

                            <Section title={day.status === 'confirmed' ? 'Taken off stock' : 'Would come off stock'}>
                                {(summary.deducted ?? []).length === 0
                                    ? <p style={iv.hint}>Nothing.</p>
                                    : summary.deducted!.map(d => (
                                        <Line key={d.menu_item_id} left={`${d.name}${d.portion_label ? ` · ${d.portion_label}` : ''}`} right={qty(d.qty)} />
                                    ))}
                            </Section>

                            {(summary.not_deducted ?? []).length > 0 && (
                                <Section title="Recorded, not deducted">
                                    {summary.not_deducted!.map(n => (
                                        <Line key={`${n.name}-${n.portion_label}-${n.reason}`} left={`${n.name}${n.portion_label ? ` · ${n.portion_label}` : ''}`} right={qty(n.qty)} note={n.reason} />
                                    ))}
                                </Section>
                            )}

                            {(summary.freehand ?? []).length > 0 && (
                                <Section title="Comps typed as free text">
                                    {summary.freehand!.map((f, i) => (
                                        <Line key={`${f.name}-${i}`} left={f.name} right={qty(f.qty)} />
                                    ))}
                                    <p style={{ ...iv.hint, marginTop: 6 }}>Log these under Waste → Staff meal.</p>
                                </Section>
                            )}

                            {(summary.ignored ?? []).length > 0 && (
                                <Section title="Not inventory">
                                    {summary.ignored!.map(n => <Line key={n.name} left={n.name} right={qty(n.qty)} />)}
                                </Section>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

function Section({ title, color, children }: { title: string; color?: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{ ...iv.label, color: color ?? '#999', marginBottom: 6 }}>{title.toUpperCase()}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</div>
        </div>
    );
}

function Line({ left, right, note }: { left: string; right: string; note?: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
            <span style={{ color: '#ccc' }}>
                {left}
                {note && <span style={{ color: '#777' }}> — {note}</span>}
            </span>
            <span style={{ color: '#eee', fontWeight: 600 }}>{right}</span>
        </div>
    );
}
