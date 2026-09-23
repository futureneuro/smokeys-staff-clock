'use client';

import { useCallback, useEffect, useState } from 'react';
import { iv, REASON_COLOUR } from './inventory-styles';
import { fetchMonthReport, summariseMonth } from '@/lib/inventory-api';
import { formatCop, formatQty, getBogotaDateString } from '@/lib/inventory-units';
import { getLang, setLang as persistLang, t, type Lang } from '@/lib/i18n';
import type { MonthReport as MonthReportData } from '@/lib/inventory-types';

const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
    info: iv.badgeInfo,
    warning: iv.badgeWarn,
    critical: iv.badgeBad,
};

// YYYY-MM for the <input type="month">, YYYY-MM-01 for the database.
function monthInputValue(iso: string): string {
    return iso.slice(0, 7);
}

function daysInMonth(monthIso: string): number {
    const [y, m] = monthIso.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const card: React.CSSProperties = { ...iv.card, padding: 14, minWidth: 0 };
const cardLabel: React.CSSProperties = { fontSize: 10, color: '#777', letterSpacing: 0.6, marginBottom: 6 };
const cardValue: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#eee' };
const cardGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 };
const tableCompact: React.CSSProperties = { ...iv.table, minWidth: 0 };
const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' };

export default function MonthReport({ adminId }: { adminId: string }) {
    const [monthIso, setMonthIso] = useState(() => `${getBogotaDateString().slice(0, 7)}-01`);
    const [report, setReport] = useState<MonthReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [summary, setSummary] = useState('');
    const [summaryModel, setSummaryModel] = useState('');
    const [summarising, setSummarising] = useState(false);
    const [summaryError, setSummaryError] = useState('');

    const [lang, setLangState] = useState<Lang>('es');
    useEffect(() => { setLangState(getLang()); }, []);
    const T = (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setReport(await fetchMonthReport(monthIso));
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the report.');
        } finally {
            setLoading(false);
        }
    }, [monthIso]);

    useEffect(() => { load(); }, [load]);

    // A summary describes one month; switching months makes it stale.
    useEffect(() => { setSummary(''); setSummaryModel(''); setSummaryError(''); }, [monthIso]);

    async function handleSummarise() {
        if (summarising || !adminId) return;
        setSummarising(true);
        setSummaryError('');
        try {
            const result = await summariseMonth(monthIso, lang, adminId);
            setSummary(result.summary);
            setSummaryModel(result.model_used);
        } catch (e) {
            setSummaryError(e instanceof Error ? e.message : 'The AI could not summarise this month.');
        } finally {
            setSummarising(false);
        }
    }

    const sold = report?.sold;
    // Out of stock, negative, or fewer than a week left. Sorted worst first.
    const attention = (report?.stock.items ?? [])
        .filter(row => row.stock_base_qty <= 0 || (row.days_left !== null && row.days_left <= 7))
        .sort((a, b) => (a.days_left ?? -1) - (b.days_left ?? -1));
    const pos = sold?.pos;
    const totalDays = daysInMonth(monthIso);
    const isCurrentMonth = monthIso.slice(0, 7) === getBogotaDateString().slice(0, 7);
    const elapsedDays = isCurrentMonth ? Number(getBogotaDateString().slice(8, 10)) : totalDays;

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>{T('reportTitle')}</h3>
                    <p style={iv.hint}>{T('reportIntro')}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={iv.field}>
                        <label style={iv.label}>{T('reportMonth')}</label>
                        <input
                            style={{ ...iv.input, width: 'auto' }}
                            type="month"
                            value={monthInputValue(monthIso)}
                            max={getBogotaDateString().slice(0, 7)}
                            onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonthIso(`${e.target.value}-01`); }}
                        />
                    </div>
                    <button style={iv.btnGhost} onClick={load} disabled={loading}>↻ {T('reportRefresh')}</button>
                    <button
                        style={iv.btnGhost}
                        onClick={() => { const next: Lang = lang === 'es' ? 'en' : 'es'; persistLang(next); setLangState(next); }}
                    >{lang === 'es' ? '🇬🇧 English' : '🇨🇴 Español'}</button>
                    <button
                        style={{ ...iv.btn, ...(summarising || loading || !report ? iv.btnDisabled : {}) }}
                        disabled={summarising || loading || !report}
                        onClick={handleSummarise}
                    >
                        {summarising ? T('reportAiWorking') : T('reportAiButton')}
                    </button>
                </div>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}
            {summaryError && <div style={iv.errBox}>{summaryError}</div>}

            {summary && (
                <div style={{ ...iv.card, borderColor: 'rgba(240,180,39,0.4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                        <strong style={{ color: '#f0b427', fontSize: 13 }}>🤖 {T('reportAiTitle')} · {report?.month}</strong>
                        {summaryModel && <span style={iv.tdMono}>{summaryModel}</span>}
                    </div>
                    <p style={{ margin: 0, color: '#ddd', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{summary}</p>
                    <p style={{ ...iv.hint, marginTop: 10 }}>{T('reportAiHint')}</p>
                </div>
            )}

            {loading && !report ? (
                <div style={iv.empty}>{T('loading')}</div>
            ) : report && sold ? (
                <>
                    <div style={cardGrid}>
                        <div style={card}>
                            <div style={cardLabel}>{T('reportCardRevenue')}</div>
                            <div style={cardValue}>{formatCop(sold.revenue_cop)}</div>
                            <div style={iv.hint}>{T('reportDays', { days: sold.days_with_sales, pos: sold.days_from_pos })}</div>
                        </div>
                        <div style={card}>
                            <div style={cardLabel}>{T('reportCardSold')}</div>
                            <div style={cardValue}>{formatQty(sold.total_qty)}</div>
                        </div>
                        <div style={card}>
                            <div style={cardLabel}>{T('reportCardSpend')}</div>
                            <div style={cardValue}>{formatCop(report.purchases.total_cop)}</div>
                            <div style={iv.hint}>{report.purchases.count} {T('colPurchases').toLowerCase()}</div>
                        </div>
                        <div style={card}>
                            <div style={cardLabel}>{T('reportCardLoss')}</div>
                            <div style={{ ...cardValue, color: report.usage.loss_value_cop > 0 ? '#ef4444' : '#eee' }}>
                                {formatCop(report.usage.loss_value_cop)}
                            </div>
                        </div>
                        <div style={card}>
                            <div style={cardLabel}>{T('reportCardStock')}</div>
                            <div style={cardValue}>{formatCop(report.stock.total_value_cop)}</div>
                            <div style={iv.hint}>{report.stock.tracked} {T('colItem').toLowerCase()}</div>
                        </div>
                        <div style={card}>
                            <div style={cardLabel}>{T('reportCardLow')}</div>
                            <div style={{ ...cardValue, color: report.stock.low.length > 0 ? '#eab308' : '#22c55e' }}>
                                {report.stock.low.length}
                            </div>
                            <div style={iv.hint}>{report.stock.out} {lang === 'es' ? 'agotados' : 'out of stock'}</div>
                        </div>
                    </div>

                    {pos && (pos.days_imported > 0 || pos.days_held > 0) && (
                        <div style={iv.hint}>
                            {T('reportPosLine', {
                                items: formatQty(pos.item_count),
                                revenue: formatCop(pos.revenue_cop),
                                days: pos.days_imported,
                                held: pos.days_held > 0 ? T('reportPosHeld', { held: pos.days_held }) : '',
                            })}
                        </div>
                    )}

                    {sold.days_with_sales > 0 && sold.days_with_sales < elapsedDays && (
                        <div style={iv.warnBox}>{T('reportPartial', { days: sold.days_with_sales, total: elapsedDays })}</div>
                    )}

                    <div style={twoCol}>
                        <section>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 8 }}>{T('reportSold')}</h4>
                            {sold.items.length === 0 ? (
                                <div style={iv.empty}>{T('reportSoldEmpty')}</div>
                            ) : (
                                <div style={iv.tableWrap}>
                                    <table style={tableCompact}>
                                        <thead>
                                            <tr>
                                                <th style={iv.th}>{T('colMenuItem')}</th>
                                                <th style={iv.th}>{T('colQty')}</th>
                                                <th style={iv.th}>{T('colDays')}</th>
                                                <th style={iv.th}>{T('colRevenue')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sold.items.map(row => (
                                                <tr key={row.menu_item_id}>
                                                    <td style={{ ...iv.td, color: '#eee' }}>
                                                        {row.name}{row.portion_label ? <span style={{ color: '#777' }}> · {row.portion_label}</span> : null}
                                                    </td>
                                                    <td style={iv.td}>{formatQty(row.qty)}</td>
                                                    <td style={iv.td}>{row.days}</td>
                                                    <td style={iv.td}>{formatCop(row.revenue_cop)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <section>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 8 }}>{T('reportPurchased')}</h4>
                            {report.purchases.items.length === 0 ? (
                                <div style={iv.empty}>{T('reportPurchasedEmpty')}</div>
                            ) : (
                                <div style={iv.tableWrap}>
                                    <table style={tableCompact}>
                                        <thead>
                                            <tr>
                                                <th style={iv.th}>{T('colItem')}</th>
                                                <th style={iv.th}>{T('colQty')}</th>
                                                <th style={iv.th}>{T('colPurchases')}</th>
                                                <th style={iv.th}>{T('colSpend')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.purchases.items.map(row => (
                                                <tr key={row.item_id}>
                                                    <td style={{ ...iv.td, color: '#eee' }}>{row.name}</td>
                                                    <td style={iv.td}>{formatQty(row.base_qty, row.base_unit)}</td>
                                                    <td style={iv.td}>{row.purchases}</td>
                                                    <td style={iv.td}>{formatCop(row.cost_cop)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <section>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 8 }}>{T('reportLosses')}</h4>
                            {report.usage.losses.length === 0 ? (
                                <div style={iv.empty}>{T('reportLossesEmpty')}</div>
                            ) : (
                                <div style={iv.tableWrap}>
                                    <table style={tableCompact}>
                                        <thead>
                                            <tr>
                                                <th style={iv.th}>{T('colItem')}</th>
                                                <th style={iv.th}>{T('colReason')}</th>
                                                <th style={iv.th}>{T('colQty')}</th>
                                                <th style={iv.th}>{T('colValue')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.usage.losses.map(row => (
                                                <tr key={`${row.item_id}-${row.reason}`}>
                                                    <td style={{ ...iv.td, color: '#eee' }}>{row.name}</td>
                                                    <td style={iv.td}>
                                                        <span style={{ color: REASON_COLOUR[row.reason ?? ''] ?? '#999' }}>
                                                            {T(`reason_${row.reason}`)}
                                                        </span>
                                                    </td>
                                                    <td style={iv.td}>{formatQty(Math.abs(row.qty), row.base_unit)}</td>
                                                    <td style={{ ...iv.td, color: '#ef4444' }}>{formatCop(Math.abs(row.value_cop))}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <section>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 8 }}>{T('reportConsumed')}</h4>
                            {report.usage.consumed.length === 0 ? (
                                <div style={iv.empty}>{T('reportSoldEmpty')}</div>
                            ) : (
                                <div style={iv.tableWrap}>
                                    <table style={tableCompact}>
                                        <thead>
                                            <tr>
                                                <th style={iv.th}>{T('colItem')}</th>
                                                <th style={iv.th}>{T('colQty')}</th>
                                                <th style={iv.th}>{T('colValue')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.usage.consumed.map(row => (
                                                <tr key={row.item_id}>
                                                    <td style={{ ...iv.td, color: '#eee' }}>{row.name}</td>
                                                    <td style={iv.td}>{formatQty(row.qty, row.base_unit)}</td>
                                                    <td style={iv.td}>{formatCop(row.value_cop)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Only what needs attention. The full shelf, item by item, is the
                        Stock tab's job; repeating it here made the report twice as long
                        for nothing. */}
                    <section>
                        <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 8 }}>{T('reportStock')}</h4>
                        <p style={{ ...iv.hint, marginBottom: 8 }}>{T('reportStockHint')}</p>
                        {attention.length === 0 ? (
                            <div style={iv.empty}>{report.stock.items.length === 0 ? T('reportStockEmpty') : T('reportStockFine')}</div>
                        ) : (
                            <div style={iv.tableWrap}>
                                <table style={tableCompact}>
                                    <thead>
                                        <tr>
                                            <th style={iv.th}>{T('colItem')}</th>
                                            <th style={iv.th}>{T('colStock')}</th>
                                            <th style={iv.th}>{T('colValue')}</th>
                                            <th style={iv.th}>{T('colDaysLeft')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attention.map(row => {
                                            const low = row.days_left !== null && row.days_left <= 7;
                                            const out = row.stock_base_qty <= 0;
                                            return (
                                                <tr key={row.item_id}>
                                                    <td style={{ ...iv.td, color: '#eee' }}>{row.name}</td>
                                                    <td style={{ ...iv.td, color: out ? '#ef4444' : '#ccc' }}>{formatQty(row.stock_base_qty, row.base_unit)}</td>
                                                    <td style={iv.td}>{formatCop(row.stock_value_cop ?? 0)}</td>
                                                    <td style={{ ...iv.td, color: out ? '#ef4444' : low ? '#eab308' : '#ccc' }}>
                                                        {row.days_left === null || out ? '—' : formatQty(row.days_left)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <section>
                        <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 8 }}>{T('reportAlerts')}</h4>
                        {report.alerts.length === 0 ? (
                            <div style={iv.empty}>{T('reportAlertsEmpty')}</div>
                        ) : (
                            <div style={iv.tableWrap}>
                                <table style={tableCompact}>
                                    <thead>
                                        <tr>
                                            <th style={iv.th}>{T('colDate')}</th>
                                            <th style={iv.th}>{T('colTitle')}</th>
                                            <th style={iv.th}>{T('colSeverity')}</th>
                                            <th style={iv.th}>{T('colMissing')}</th>
                                            <th style={iv.th}>{T('colStatus')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.alerts.map(a => (
                                            <tr key={a.id}>
                                                <td style={iv.td}>{a.created_at.slice(0, 10)}</td>
                                                <td style={{ ...iv.td, color: '#eee' }}>{a.title}</td>
                                                <td style={iv.td}>
                                                    <span style={{ ...iv.badge, ...(SEVERITY_STYLE[a.severity] ?? iv.badgeInfo) }}>{a.severity}</span>
                                                </td>
                                                <td style={{ ...iv.td, color: '#ef4444' }}>{formatCop(a.shortfall_value_cop)}</td>
                                                <td style={iv.td}>{a.status}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </>
            ) : null}
        </div>
    );
}
