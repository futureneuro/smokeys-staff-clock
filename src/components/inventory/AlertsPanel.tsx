'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { iv } from './inventory-styles';
import {
    acknowledgeAlert,
    addAlertRecipient,
    deleteAlertRecipient,
    dispatchAlertEmails,
    fetchAlertRecipients,
    fetchAlerts,
    fetchSettings,
    setAlertRecipientActive,
    updateSettings,
} from '@/lib/inventory-api';
import { formatCop, formatQty, parseCopInput, parseQtyInput } from '@/lib/inventory-units';
import type { AlertRecipient, InventoryAlert, InventorySettings } from '@/lib/inventory-types';

const EMAIL_LABEL: Record<InventoryAlert['email_status'], string> = {
    pending: 'EMAIL PENDING',
    sending: 'SENDING…',
    sent: 'EMAILED',
    failed: 'EMAIL FAILED',
    skipped: 'EMAIL NOT SET UP',
};

// A dispatcher is already working on these, so offering "try sending" would
// mail every recipient a second copy.
const IN_FLIGHT: InventoryAlert['email_status'][] = ['sent', 'sending'];

// Undelivered for over a day means something is misconfigured rather than slow.
const STUCK_AFTER_HOURS = 24;

export default function AlertsPanel({ adminId }: { adminId: string }) {
    const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
    const [settings, setSettings] = useState<InventorySettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [busy, setBusy] = useState(false);

    const [pctDraft, setPctDraft] = useState('');
    const [valueDraft, setValueDraft] = useState('');

    const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
    const [newEmail, setNewEmail] = useState('');
    const [newLabel, setNewLabel] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [a, s, r] = await Promise.all([fetchAlerts(), fetchSettings(), fetchAlertRecipients()]);
            setAlerts(a);
            setSettings(s);
            setRecipients(r);
            setPctDraft(String(s.variance_pct_threshold));
            setValueDraft(String(s.variance_value_threshold_cop));
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load alerts.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const open = useMemo(() => alerts.filter(a => a.status === 'new'), [alerts]);
    const closed = useMemo(() => alerts.filter(a => a.status !== 'new'), [alerts]);

    async function handleAcknowledge(alert: InventoryAlert, dismiss: boolean) {
        if (noteDraft.trim() === '') {
            setError('Write what caused the difference before closing it.');
            return;
        }
        setBusy(true);
        try {
            await acknowledgeAlert(alert.id, noteDraft, adminId || null, dismiss);
            setOpenId(null);
            setNoteDraft('');
            setError('');
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not close the alert.');
        } finally {
            setBusy(false);
        }
    }

    async function saveSettings() {
        const pct = parseQtyInput(pctDraft);
        const value = parseCopInput(valueDraft);
        if (pct === null || pct < 0) { setError('The percentage threshold is not a number.'); return; }
        if (value === null || value < 0) { setError('The value threshold is not a number.'); return; }

        setBusy(true);
        try {
            await updateSettings({
                variance_pct_threshold: pct,
                variance_value_threshold_cop: value,
                blind_count: settings?.blind_count ?? true,
            }, adminId || null);
            setNotice('Thresholds saved.');
            setError('');
            await load();
            window.setTimeout(() => setNotice(''), 4000);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the settings.');
        } finally {
            setBusy(false);
        }
    }

    async function addRecipient() {
        const email = newEmail.trim();
        if (!email) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setError('That does not look like an email address.');
            return;
        }
        setBusy(true);
        try {
            await addAlertRecipient(email, newLabel, adminId || null);
            setNewEmail('');
            setNewLabel('');
            setError('');
            setNotice(`${email} will now receive the reports.`);
            await load();
            window.setTimeout(() => setNotice(''), 4000);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not add the address.');
        } finally {
            setBusy(false);
        }
    }

    async function resend(alert: InventoryAlert) {
        setBusy(true);
        const result = await dispatchAlertEmails(alert.id, adminId || null);
        setNotice(result.sent > 0 ? 'Email sent.' : `Not sent — ${result.reason ?? 'unknown reason'}`);
        await load();
        setBusy(false);
        window.setTimeout(() => setNotice(''), 6000);
    }

    function hoursWaiting(alert: InventoryAlert): number {
        return (Date.now() - new Date(alert.created_at).getTime()) / 3600000;
    }

    function renderAlert(alert: InventoryAlert, isOpen: boolean) {
        const box = alert.severity === 'critical' ? iv.errBox : iv.warnBox;
        return (
            <div key={alert.id} style={{ ...iv.card, border: `1px solid ${alert.status === 'new' ? '#7a2b2b' : '#222'}` }}>
                <div style={iv.sectionHeader}>
                    <div style={{ minWidth: 0 }}>
                        <h4 style={{ ...iv.sectionTitle, fontSize: 14 }}>{alert.title}</h4>
                        <p style={iv.hint}>
                            {formatCop(alert.shortfall_value_cop)} across {alert.items_alerting} item(s) ·
                            {' '}{new Date(alert.created_at).toLocaleDateString('es-CO')}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{
                            ...iv.badge,
                            ...(alert.email_status === 'sent' ? iv.badgeOk
                                : alert.email_status === 'failed' ? iv.badgeBad : iv.badgeWarn),
                        }}>{EMAIL_LABEL[alert.email_status]}</span>
                        {alert.status !== 'new' && (
                            <span style={{ ...iv.badge, ...iv.badgeOk }}>{alert.status.toUpperCase()}</span>
                        )}
                    </div>
                </div>

                {alert.email_status !== 'sent' && alert.email_error && (
                    <p style={{ ...iv.hint, color: '#eab308' }}>{alert.email_error}</p>
                )}

                {/* The inv_alerts_stuck view existed but nothing read it, so an
                    alert undelivered for days looked identical to a fresh one. */}
                {!IN_FLIGHT.includes(alert.email_status) && hoursWaiting(alert) >= STUCK_AFTER_HOURS && (
                    <div style={{ ...iv.errBox, marginTop: 8 }}>
                        This report has been undelivered for {Math.round(hoursWaiting(alert))} hours.
                        Check the email settings — nobody has been told about it.
                    </div>
                )}

                {(alert.summary ?? []).length > 0 && (
                    <div style={{ ...iv.tableWrap, marginTop: 10 }}>
                        <table style={{ ...iv.table, minWidth: 0 }}>
                            <thead>
                                <tr>
                                    <th style={iv.th}>ITEM</th>
                                    <th style={iv.th}>EXPECTED</th>
                                    <th style={iv.th}>COUNTED</th>
                                    <th style={iv.th}>MISSING</th>
                                    <th style={iv.th}>VALUE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(alert.summary ?? []).map((row, index) => (
                                    <tr key={`${alert.id}-${index}`}>
                                        <td style={{ ...iv.td, color: '#eee' }}>{row.item}</td>
                                        <td style={iv.td}>{formatQty(row.expected, row.unit)}</td>
                                        <td style={iv.td}>{formatQty(row.counted, row.unit)}</td>
                                        <td style={{ ...iv.td, color: '#ef4444' }}>−{formatQty(row.missing, row.unit)}</td>
                                        <td style={{ ...iv.td, color: '#ef4444' }}>{formatCop(row.value_cop)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {alert.status === 'new' ? (
                    <>
                        <div style={{ ...box, marginTop: 10 }}>
                            Check waste, staff meals, comped plates and unrecorded purchases before treating
                            this as theft.
                        </div>
                        {isOpen ? (
                            <div style={{ marginTop: 10 }}>
                                <label style={iv.label}>WHAT CAUSED IT? *</label>
                                <input
                                    style={iv.input}
                                    value={noteDraft}
                                    onChange={e => setNoteDraft(e.target.value)}
                                    placeholder="e.g. freezer failed on Sunday, 2 kg thrown out"
                                />
                                <p style={{ ...iv.hint, marginTop: 6 }}>
                                    Required. The reasons recorded here are what make the thresholds worth
                                    tuning and patterns worth trusting.
                                </p>
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                                    <button style={iv.btnGhost} onClick={() => { setOpenId(null); setNoteDraft(''); }}>
                                        Cancel
                                    </button>
                                    <button
                                        style={{ ...iv.btnGhost, ...(busy ? iv.btnDisabled : {}) }}
                                        disabled={busy}
                                        onClick={() => handleAcknowledge(alert, true)}
                                    >Not a real problem</button>
                                    <button
                                        style={{ ...iv.btn, ...(busy ? iv.btnDisabled : {}) }}
                                        disabled={busy}
                                        onClick={() => handleAcknowledge(alert, false)}
                                    >Explained — close it</button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                                {!IN_FLIGHT.includes(alert.email_status) && (
                                    <button style={iv.btnGhost} disabled={busy} onClick={() => resend(alert)}>
                                        Try sending the email
                                    </button>
                                )}
                                <button style={iv.btn} onClick={() => { setOpenId(alert.id); setNoteDraft(''); }}>
                                    Explain and close
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    alert.acknowledge_note && (
                        <div style={{ ...iv.okBox, marginTop: 10 }}>
                            <strong>Explanation:</strong> {alert.acknowledge_note}
                        </div>
                    )
                )}
            </div>
        );
    }

    return (
        <div style={iv.wrap}>
            <div style={iv.sectionHeader}>
                <div>
                    <h3 style={iv.sectionTitle}>Alerts</h3>
                    <p style={iv.hint}>
                        Raised when a count finds a shortfall past both thresholds. Closing one requires a
                        reason — an alert nobody explains teaches nobody anything.
                    </p>
                </div>
                <button style={iv.btnGhost} onClick={load}>↻ Refresh</button>
            </div>

            {error && <div style={iv.errBox}>{error}</div>}
            {notice && <div style={iv.okBox}>{notice}</div>}

            {/* ── Settings ── */}
            <div style={iv.card}>
                <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 4 }}>When to alert</h4>
                <p style={{ ...iv.hint, marginBottom: 10 }}>
                    An item is flagged only when it is short by <strong>both</strong> of these. One alone
                    would flag either every herb or nothing at all.
                </p>
                <div style={iv.fieldRow}>
                    <div style={iv.field}>
                        <label style={iv.label}>PERCENTAGE SHORT</label>
                        <input style={iv.input} inputMode="decimal" value={pctDraft} onChange={e => setPctDraft(e.target.value)} />
                    </div>
                    <div style={iv.field}>
                        <label style={iv.label}>VALUE SHORT (COP)</label>
                        <input style={iv.input} inputMode="numeric" value={valueDraft} onChange={e => setValueDraft(e.target.value)} />
                    </div>
                    <div style={{ ...iv.field, justifyContent: 'flex-end' }}>
                        <label style={{ ...iv.label, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings?.blind_count ?? true}
                                disabled={busy || !settings}
                                onChange={async e => {
                                    setBusy(true);
                                    try {
                                        await updateSettings({
                                            variance_pct_threshold: settings?.variance_pct_threshold ?? 10,
                                            variance_value_threshold_cop: settings?.variance_value_threshold_cop ?? 20000,
                                            blind_count: e.target.checked,
                                        }, adminId || null);
                                        await load();
                                    } catch (err) {
                                        setError(err instanceof Error ? err.message : 'Could not change it.');
                                    } finally { setBusy(false); }
                                }}
                            />
                            HIDE EXPECTED WHILE COUNTING
                        </label>
                    </div>
                </div>
                <p style={{ ...iv.hint, marginTop: 6 }}>
                    Hiding the expected figure is what makes a count worth doing — showing it invites typing
                    the expected number straight back in.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <button style={{ ...iv.btn, ...(busy ? iv.btnDisabled : {}) }} disabled={busy} onClick={saveSettings}>
                        Save thresholds
                    </button>
                </div>
            </div>

            {/* ── Recipients ── */}
            <div style={iv.card}>
                <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginBottom: 4 }}>Who gets the report</h4>
                <p style={{ ...iv.hint, marginBottom: 10 }}>
                    Everyone active here receives the alert email. Switch someone off while they are away
                    rather than deleting them — the address is kept for when they are back.
                </p>

                {recipients.length === 0 ? (
                    <div style={{ ...iv.warnBox, marginBottom: 10 }}>
                        Nobody is on the list, so alerts only appear in this screen. Nothing is lost — but
                        nobody is told either.
                    </div>
                ) : (
                    <div style={{ ...iv.tableWrap, marginBottom: 12 }}>
                        <table style={{ ...iv.table, minWidth: 0 }}>
                            <thead>
                                <tr>
                                    <th style={iv.th}>EMAIL</th>
                                    <th style={iv.th}>WHO</th>
                                    <th style={iv.th}>RECEIVING?</th>
                                    <th style={iv.th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {recipients.map(r => (
                                    <tr key={r.id}>
                                        <td style={{ ...iv.td, color: r.active ? '#eee' : '#666' }}>{r.email}</td>
                                        <td style={iv.td}>{r.label ?? '—'}</td>
                                        <td style={iv.td}>
                                            <button
                                                style={{ ...iv.badge, ...(r.active ? iv.badgeOk : iv.badgeWarn), border: 'none', cursor: 'pointer' }}
                                                disabled={busy}
                                                onClick={async () => {
                                                    setBusy(true);
                                                    try {
                                                        await setAlertRecipientActive(r.id, !r.active, adminId || null);
                                                        await load();
                                                    } catch (e) {
                                                        setError(e instanceof Error ? e.message : 'Could not change it.');
                                                    } finally { setBusy(false); }
                                                }}
                                            >{r.active ? 'YES' : 'PAUSED'}</button>
                                        </td>
                                        <td style={iv.td}>
                                            <button
                                                style={{ ...iv.btnGhost, padding: '4px 10px', color: '#ef4444' }}
                                                disabled={busy}
                                                onClick={async () => {
                                                    if (!window.confirm(`Remove ${r.email} from the alert list?`)) return;
                                                    setBusy(true);
                                                    try {
                                                        await deleteAlertRecipient(r.id, adminId || null);
                                                        await load();
                                                    } catch (e) {
                                                        setError(e instanceof Error ? e.message : 'Could not remove it.');
                                                    } finally { setBusy(false); }
                                                }}
                                            >Remove</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ ...iv.field, flex: 1, minWidth: 200 }}>
                        <label style={iv.label}>EMAIL</label>
                        <input
                            style={iv.input}
                            value={newEmail}
                            onChange={e => setNewEmail(e.target.value)}
                            placeholder="admin@smokeys.co"
                            onKeyDown={e => { if (e.key === 'Enter') addRecipient(); }}
                        />
                    </div>
                    <div style={{ ...iv.field, width: 180 }}>
                        <label style={iv.label}>WHO (OPTIONAL)</label>
                        <input
                            style={iv.input}
                            value={newLabel}
                            onChange={e => setNewLabel(e.target.value)}
                            placeholder="Anuyan"
                            onKeyDown={e => { if (e.key === 'Enter') addRecipient(); }}
                        />
                    </div>
                    <button
                        style={{ ...iv.btn, ...(busy || newEmail.trim() === '' ? iv.btnDisabled : {}) }}
                        disabled={busy || newEmail.trim() === ''}
                        onClick={addRecipient}
                    >+ Add</button>
                </div>
            </div>

            {loading ? (
                <div style={iv.empty}>Loading…</div>
            ) : (
                <>
                    <h4 style={{ ...iv.sectionTitle, fontSize: 13 }}>
                        Open {open.length > 0 && <span style={{ ...iv.badge, ...iv.badgeBad }}>{open.length}</span>}
                    </h4>
                    {open.length === 0 ? (
                        <div style={iv.empty}>Nothing open. Alerts appear here after a count finds a shortfall.</div>
                    ) : (
                        open.map(a => renderAlert(a, openId === a.id))
                    )}

                    {closed.length > 0 && (
                        <>
                            <h4 style={{ ...iv.sectionTitle, fontSize: 13, marginTop: 8 }}>Closed</h4>
                            {closed.map(a => renderAlert(a, false))}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
