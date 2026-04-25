'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { EDGE_FUNCTIONS_BASE_URL, supabase } from '@/lib/supabase';

interface AdminSession {
    id: string;
    name: string;
    staff_code: string;
    loginAt: string;
}

interface Staff {
    id: string;
    staff_code: string;
    name: string;
    role: string;
    active: boolean;
    phone_number?: string | null;
    sms_opt_in?: boolean;
    created_at: string;
}

interface TimeLog {
    id: string;
    staff_id: string;
    check_in: string;
    check_out: string | null;
    total_hours: number | null;
    gps_lat: number;
    gps_lng: number;
    ip_address: string;
    staff?: Staff;
}

type Tab = 'staff' | 'logs' | 'reports' | 'tasks' | 'shifts' | 'monitor' | 'qrcode' | 'settings';

export default function AdminDashboard() {
    const router = useRouter();
    const [admin, setAdmin] = useState<AdminSession | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('staff');
    const [staffList, setStaffList] = useState<Staff[]>([]);
    const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
    const [loading, setLoading] = useState(true);

    // Staff form
    const [showStaffForm, setShowStaffForm] = useState(false);
    const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
    const [staffForm, setStaffForm] = useState({
        name: '',
        staff_code: '',
        pin: '',
        role: 'staff',
        phone_number: '',
        sms_opt_in: true,
    });
    const [staffFormError, setStaffFormError] = useState('');
    const [staffFormLoading, setStaffFormLoading] = useState(false);
    const [staffActionError, setStaffActionError] = useState('');
    const [staffActionLoadingId, setStaffActionLoadingId] = useState<string | null>(null);

    // Filters
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [filterStaffId, setFilterStaffId] = useState('');

    useEffect(() => {
        const session = sessionStorage.getItem('admin_session');
        if (!session) {
            router.push('/admin');
            return;
        }
        const parsed = JSON.parse(session);
        // Session timeout: 2 hours
        const loginTime = new Date(parsed.loginAt).getTime();
        if (Date.now() - loginTime > 2 * 60 * 60 * 1000) {
            sessionStorage.removeItem('admin_session');
            router.push('/admin');
            return;
        }
        setAdmin(parsed);
        setLoading(false);
    }, [router]);

    const fetchStaff = useCallback(async () => {
        const { data } = await supabase.from('staff').select('*').order('created_at', { ascending: false });
        if (data) setStaffList(data);
    }, []);

    const fetchLogs = useCallback(async () => {
        let query = supabase
            .from('time_logs')
            .select('*, staff(*)')
            .order('check_in', { ascending: false })
            .limit(200);

        if (filterStaffId) query = query.eq('staff_id', filterStaffId);
        if (dateFrom) query = query.gte('check_in', dateFrom);
        if (dateTo) query = query.lte('check_in', dateTo + 'T23:59:59');

        const { data } = await query;
        if (data) setTimeLogs(data);
    }, [filterStaffId, dateFrom, dateTo]);

    useEffect(() => {
        if (!loading && admin) {
            fetchStaff();
            fetchLogs();
        }
    }, [loading, admin, fetchStaff, fetchLogs]);

    function handleLogout() {
        sessionStorage.removeItem('admin_session');
        router.push('/admin');
    }

    async function handleStaffSubmit(e: React.FormEvent) {
        e.preventDefault();
        setStaffFormError('');
        setStaffFormLoading(true);

        try {
            if (editingStaff) {
                // Update staff
                const updates: Record<string, unknown> = {
                    name: staffForm.name,
                    staff_code: staffForm.staff_code.toUpperCase(),
                    role: staffForm.role,
                    phone_number: staffForm.phone_number.trim() || null,
                    sms_opt_in: staffForm.sms_opt_in,
                };

                if (staffForm.pin) {
                    // Hash PIN via edge function or RPC - for MVP, we'll use a separate RPC
                    const { error: pinError } = await supabase.rpc('update_staff_pin', {
                        p_staff_id: editingStaff.id,
                        p_new_pin: staffForm.pin,
                    });
                    if (pinError) {
                        setStaffFormError('Failed to update PIN.');
                        setStaffFormLoading(false);
                        return;
                    }
                }

                const { error } = await supabase.from('staff').update(updates).eq('id', editingStaff.id);
                if (error) {
                    setStaffFormError(error.message);
                    setStaffFormLoading(false);
                    return;
                }
            } else {
                // Create new staff via RPC (to hash PIN)
                const { error } = await supabase.rpc('create_staff', {
                    p_staff_code: staffForm.staff_code.toUpperCase(),
                    p_name: staffForm.name,
                    p_pin: staffForm.pin,
                    p_role: staffForm.role,
                });
                if (error) {
                    setStaffFormError(error.message);
                    setStaffFormLoading(false);
                    return;
                }

                await supabase
                    .from('staff')
                    .update({
                        phone_number: staffForm.phone_number.trim() || null,
                        sms_opt_in: staffForm.sms_opt_in,
                    })
                    .eq('staff_code', staffForm.staff_code.toUpperCase());
            }

            setShowStaffForm(false);
            setEditingStaff(null);
            setStaffForm({
                name: '',
                staff_code: '',
                pin: '',
                role: 'staff',
                phone_number: '',
                sms_opt_in: true,
            });
            fetchStaff();
        } catch {
            setStaffFormError('An error occurred.');
        } finally {
            setStaffFormLoading(false);
        }
    }

    async function toggleStaffActive(staff: Staff) {
        setStaffActionError('');
        setStaffActionLoadingId(`toggle-${staff.id}`);
        const nextActive = !staff.active;

        // When deactivating, automatically close any open log so deletion is not blocked.
        if (!nextActive) {
            const nowIso = new Date().toISOString();
            const { data: openLogs, error: openLogsError } = await supabase
                .from('time_logs')
                .select('id, check_in')
                .eq('staff_id', staff.id)
                .is('check_out', null);

            if (openLogsError) {
                setStaffActionLoadingId(null);
                setStaffActionError(openLogsError.message);
                return;
            }

            for (const log of openLogs || []) {
                const totalHours = Math.max(0, Number(((Date.now() - new Date(log.check_in).getTime()) / 3600000).toFixed(2)));

                const { error: closeLogError } = await supabase
                    .from('time_logs')
                    .update({
                        check_out: nowIso,
                        total_hours: totalHours,
                    })
                    .eq('id', log.id);

                if (closeLogError) {
                    setStaffActionLoadingId(null);
                    setStaffActionError(closeLogError.message);
                    return;
                }

                await supabase
                    .from('breaks')
                    .update({ break_end: nowIso })
                    .eq('time_log_id', log.id)
                    .is('break_end', null);

                await supabase
                    .from('shift_assignments')
                    .update({ status: 'cancelled' })
                    .eq('time_log_id' as never, log.id);
            }
        }

        const { error } = await supabase.from('staff').update({ active: nextActive }).eq('id', staff.id);
        setStaffActionLoadingId(null);
        if (error) {
            setStaffActionError(error.message);
            return;
        }
        fetchStaff();
        fetchLogs();
    }

    async function deleteStaffPermanently(staff: Staff) {
        setStaffActionError('');
        if (staff.id === admin?.id) {
            setStaffActionError('You cannot delete your current admin account.');
            return;
        }
        const confirmed = window.confirm(`Delete ${staff.name} permanently? This cannot be undone.`);
        if (!confirmed) return;

        setStaffActionLoadingId(`delete-${staff.id}`);
        let result: { ok?: boolean; error?: string } | null = null;
        let finalError: string | null = null;

        const { data, error } = await supabase.rpc('delete_staff_permanently', {
            p_staff_id: staff.id,
            p_actor_admin_id: admin?.id || null,
        });

        // Some deployments may not have this RPC yet (or have stale schema cache).
        // Fallback to guarded direct-delete to keep admin workflow functional.
        if (error?.message?.includes('Could not find the function public.delete_staff_permanently')) {
            const { count, error: openLogsError } = await supabase
                .from('time_logs')
                .select('id', { count: 'exact', head: true })
                .eq('staff_id', staff.id)
                .is('check_out', null);

            if (openLogsError) {
                finalError = openLogsError.message;
            } else if ((count || 0) > 0) {
                finalError = 'Staff has an open time log. Check out first.';
            } else {
                const { error: deleteError } = await supabase.from('staff').delete().eq('id', staff.id);
                if (deleteError) {
                    finalError = deleteError.code === '23503'
                        ? 'Cannot delete this staff member because related records exist. Deactivate instead.'
                        : deleteError.message;
                } else {
                    result = { ok: true };
                }
            }
        } else if (error) {
            finalError = error.message;
        } else {
            result = data as { ok?: boolean; error?: string } | null;
        }
        setStaffActionLoadingId(null);

        if (finalError) {
            setStaffActionError(finalError);
            return;
        }

        if (!result?.ok) {
            setStaffActionError(result?.error || 'Could not delete this staff member.');
            return;
        }

        fetchStaff();
        fetchLogs();
    }

    function editStaff(staff: Staff) {
        setEditingStaff(staff);
        setStaffForm({
            name: staff.name,
            staff_code: staff.staff_code,
            pin: '',
            role: staff.role,
            phone_number: staff.phone_number || '',
            sms_opt_in: staff.sms_opt_in ?? true,
        });
        setShowStaffForm(true);
    }

    function exportCSV() {
        const headers = ['Staff ID', 'Staff Name', 'Date', 'Check In', 'Check Out', 'Total Hours', 'GPS', 'IP'];
        const rows = timeLogs.map(log => {
            const s = log.staff as unknown as Staff;
            return [
                s?.staff_code || '',
                s?.name || '',
                new Date(log.check_in).toLocaleDateString(),
                new Date(log.check_in).toLocaleTimeString(),
                log.check_out ? new Date(log.check_out).toLocaleTimeString() : 'Still In',
                log.total_hours?.toFixed(2) || '-',
                `${log.gps_lat},${log.gps_lng}`,
                log.ip_address || '',
            ];
        });

        const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `smokeys-time-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    if (loading) {
        return (
            <div style={styles.container}>
                <p style={{ color: '#666' }}>Loading...</p>
            </div>
        );
    }

    return (
        <div style={styles.page}>
            {/* Header */}
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <span style={{ fontSize: 24 }}>🐈‍⬛</span>
                    <div>
                        <h1 style={styles.headerTitle}>SMOKEY&apos;S</h1>
                        <p style={styles.headerSub}>Admin Dashboard</p>
                    </div>
                </div>
                <div style={styles.headerRight}>
                    <span style={styles.adminName}>{admin?.name}</span>
                    <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
                </div>
            </header>

            {/* Tabs */}
            <nav style={styles.tabs}>
                {(['staff', 'logs', 'reports', 'tasks', 'shifts', 'monitor', 'qrcode', 'settings'] as Tab[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            ...styles.tab,
                            ...(activeTab === tab ? styles.tabActive : {}),
                        }}
                    >
                        {tab === 'staff' ? '👥 Staff' : tab === 'logs' ? '📋 Time Logs' : tab === 'reports' ? '📊 Reports' : tab === 'tasks' ? '✅ Tasks' : tab === 'shifts' ? '📅 Shifts' : tab === 'monitor' ? '📡 Monitor' : tab === 'qrcode' ? '📱 QR Code' : '⚙️ Settings'}
                    </button>
                ))}
            </nav>

            <main style={styles.main}>
                {/* ── STAFF TAB ── */}
                {activeTab === 'staff' && (
                    <div className="animate-fadeIn">
                        <div style={styles.sectionHeader}>
                            <h2 style={styles.sectionTitle}>Staff Management</h2>
                            <button
                                onClick={() => {
                                    setEditingStaff(null);
                                    setStaffForm({ name: '', staff_code: '', pin: '', role: 'staff', phone_number: '', sms_opt_in: true });
                                    setShowStaffForm(true);
                                }}
                                className="btn-primary"
                                style={{ width: 'auto', padding: '10px 20px' }}
                            >
                                + Add Staff
                            </button>
                        </div>

                        {showStaffForm && (
                            <div style={styles.formOverlay}>
                                <form onSubmit={handleStaffSubmit} style={styles.staffFormCard}>
                                    <h3 style={styles.formTitle}>{editingStaff ? 'Edit Staff' : 'Add New Staff'}</h3>
                                    <div style={styles.formGrid}>
                                        <div style={styles.inputGroup}>
                                            <label style={styles.formLabel}>Name</label>
                                            <input
                                                className="input-field"
                                                value={staffForm.name}
                                                onChange={e => setStaffForm({ ...staffForm, name: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div style={styles.inputGroup}>
                                            <label style={styles.formLabel}>Staff Code</label>
                                            <input
                                                className="input-field"
                                                value={staffForm.staff_code}
                                                onChange={e => setStaffForm({ ...staffForm, staff_code: e.target.value.toUpperCase() })}
                                                placeholder="e.g. SMK001"
                                                required
                                                disabled={!!editingStaff}
                                            />
                                        </div>
                                        <div style={styles.inputGroup}>
                                            <label style={styles.formLabel}>PIN {editingStaff && '(leave blank to keep)'}</label>
                                            <input
                                                type="password"
                                                className="input-field"
                                                value={staffForm.pin}
                                                onChange={e => setStaffForm({ ...staffForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                                                inputMode="numeric"
                                                maxLength={6}
                                                required={!editingStaff}
                                            />
                                        </div>
                                        <div style={styles.inputGroup}>
                                            <label style={styles.formLabel}>Role</label>
                                            <select
                                                className="input-field"
                                                value={staffForm.role}
                                                onChange={e => setStaffForm({ ...staffForm, role: e.target.value })}
                                            >
                                                <option value="staff">Staff</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        </div>
                                        <div style={styles.inputGroup}>
                                            <label style={styles.formLabel}>Phone (E.164)</label>
                                            <input
                                                className="input-field"
                                                value={staffForm.phone_number}
                                                onChange={e => setStaffForm({ ...staffForm, phone_number: e.target.value })}
                                                placeholder="+573001234567"
                                            />
                                        </div>
                                        <div style={styles.inputGroup}>
                                            <label style={styles.formLabel}>SMS Notifications</label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#bbb', paddingTop: 10 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={staffForm.sms_opt_in}
                                                    onChange={e => setStaffForm({ ...staffForm, sms_opt_in: e.target.checked })}
                                                    style={{ accentColor: '#f0b427' }}
                                                />
                                                Receive late-attendance SMS
                                            </label>
                                        </div>
                                    </div>
                                    {staffFormError && <p style={styles.formError}>⚠️ {staffFormError}</p>}
                                    <div style={styles.formActions}>
                                        <button type="button" onClick={() => setShowStaffForm(false)} style={styles.cancelBtn}>Cancel</button>
                                        <button type="submit" className="btn-primary" disabled={staffFormLoading} style={{ width: 'auto', padding: '10px 24px' }}>
                                            {staffFormLoading ? 'Saving...' : editingStaff ? 'Update' : 'Create'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {staffActionError && (
                            <div style={{ ...styles.formError, marginBottom: 12 }}>
                                ⚠️ {staffActionError}
                            </div>
                        )}

                        <div style={styles.tableContainer}>
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Code</th>
                                        <th style={styles.th}>Name</th>
                                        <th style={styles.th}>Phone</th>
                                        <th style={styles.th}>Role</th>
                                        <th style={styles.th}>Status</th>
                                        <th style={styles.th}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {staffList.map(s => (
                                        <tr key={s.id} style={styles.tr}>
                                            <td style={styles.td}><code style={styles.code}>{s.staff_code}</code></td>
                                            <td style={styles.td}>{s.name}</td>
                                            <td style={styles.td}>{s.phone_number || '—'}</td>
                                            <td style={styles.td}>
                                                <span style={{
                                                    ...styles.badge,
                                                    background: s.role === 'admin' ? 'rgba(240,180,39,0.15)' : 'rgba(99,102,241,0.15)',
                                                    color: s.role === 'admin' ? '#f0b427' : '#818cf8',
                                                }}>{s.role}</span>
                                            </td>
                                            <td style={styles.td}>
                                                <span style={{
                                                    ...styles.badge,
                                                    background: s.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                                    color: s.active ? '#22c55e' : '#ef4444',
                                                }}>{s.active ? 'Active' : 'Inactive'}</span>
                                            </td>
                                            <td style={styles.td}>
                                                <div style={styles.actionBtns}>
                                                    <button onClick={() => editStaff(s)} style={styles.actionBtn}>Edit</button>
                                                    <button
                                                        onClick={() => toggleStaffActive(s)}
                                                        disabled={staffActionLoadingId === `toggle-${s.id}` || staffActionLoadingId === `delete-${s.id}`}
                                                        style={{ ...styles.actionBtn, color: s.active ? '#ef4444' : '#22c55e' }}
                                                    >
                                                        {staffActionLoadingId === `toggle-${s.id}` ? 'Saving...' : s.active ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                    <button
                                                        onClick={() => deleteStaffPermanently(s)}
                                                        disabled={staffActionLoadingId === `toggle-${s.id}` || staffActionLoadingId === `delete-${s.id}`}
                                                        style={{ ...styles.actionBtn, color: '#ef4444', borderColor: '#ef444466' }}
                                                    >
                                                        {staffActionLoadingId === `delete-${s.id}` ? 'Deleting...' : 'Delete'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── LOGS TAB ── */}
                {activeTab === 'logs' && (
                    <div className="animate-fadeIn">
                        <div style={styles.sectionHeader}>
                            <h2 style={styles.sectionTitle}>Time Logs</h2>
                            <button onClick={exportCSV} className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}>
                                📥 Export CSV
                            </button>
                        </div>

                        <div style={styles.filterBar}>
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>From</label>
                                <input type="date" className="input-field" style={{ colorScheme: 'dark' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                            </div>
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>To</label>
                                <input type="date" className="input-field" style={{ colorScheme: 'dark' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                            </div>
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Staff</label>
                                <select className="input-field" value={filterStaffId} onChange={e => setFilterStaffId(e.target.value)}>
                                    <option value="">All Staff</option>
                                    {staffList.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} ({s.staff_code})</option>
                                    ))}
                                </select>
                            </div>
                            <button onClick={fetchLogs} className="btn-primary" style={{ width: 'auto', padding: '10px 20px', alignSelf: 'flex-end' }}>
                                Apply
                            </button>
                        </div>

                        <div style={styles.tableContainer}>
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Staff</th>
                                        <th style={styles.th}>Date</th>
                                        <th style={styles.th}>In</th>
                                        <th style={styles.th}>Out</th>
                                        <th style={styles.th}>Hours</th>
                                        <th style={styles.th}>IP</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {timeLogs.map(log => {
                                        const s = log.staff as unknown as Staff;
                                        return (
                                            <tr key={log.id} style={styles.tr}>
                                                <td style={styles.td}>
                                                    <div>
                                                        <div style={{ fontWeight: 600 }}>{s?.name}</div>
                                                        <div style={{ fontSize: 12, color: '#666' }}>{s?.staff_code}</div>
                                                    </div>
                                                </td>
                                                <td style={styles.td}>{new Date(log.check_in).toLocaleDateString()}</td>
                                                <td style={styles.td}>{new Date(log.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                                <td style={styles.td}>
                                                    {log.check_out
                                                        ? new Date(log.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                                        : <span style={{ color: '#f0b427' }}>Still In</span>
                                                    }
                                                </td>
                                                <td style={styles.td}>
                                                    {log.total_hours
                                                        ? <span style={{ fontWeight: 600 }}>{log.total_hours.toFixed(2)}h</span>
                                                        : '-'
                                                    }
                                                </td>
                                                <td style={styles.td}><span style={{ fontSize: 12, color: '#666' }}>{log.ip_address}</span></td>
                                            </tr>
                                        );
                                    })}
                                    {timeLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#666', padding: '40px 16px' }}>
                                                No time logs found for the selected filters.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── REPORTS TAB ── */}
                {activeTab === 'reports' && (
                    <div className="animate-fadeIn">
                        <h2 style={styles.sectionTitle}>Reports</h2>
                        <div style={styles.reportGrid}>
                            <ReportCard
                                title="Today's Attendance"
                                logs={timeLogs}
                                type="today"
                                staffList={staffList}
                            />
                            <ReportCard
                                title="This Week"
                                logs={timeLogs}
                                type="week"
                                staffList={staffList}
                            />
                            <ReportCard
                                title="This Month"
                                logs={timeLogs}
                                type="month"
                                staffList={staffList}
                            />
                        </div>
                    </div>
                )}

                {/* ── TASKS TAB ── */}
                {activeTab === 'tasks' && (
                    <TasksPanel staffList={staffList} adminId={admin?.id || ''} />
                )}

                {/* ── SHIFTS TAB ── */}
                {activeTab === 'shifts' && (
                    <ShiftsPanel staffList={staffList} />
                )}

                {/* ── MONITOR TAB ── */}
                {activeTab === 'monitor' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <MonitorPanel adminId={admin?.id || ''} />
                        <LateAttendancePanel />
                    </div>
                )}

                {/* ── QR CODE TAB ── */}
                {activeTab === 'qrcode' && (
                    <QRCodePanel />
                )}

                {/* ── SETTINGS TAB ── */}
                {activeTab === 'settings' && (
                    <SettingsPanel />
                )}
            </main>
        </div>
    );
}

interface TaskTemplate {
    id: string;
    title: string;
    description: string | null;
    priority: string;
    created_by: string | null;
    created_at: string;
}

interface Task {
    id: string;
    staff_id: string;
    template_id: string | null;
    title: string;
    description: string | null;
    due_date: string;
    status: string;
    priority: string;
    recurrence_rule: { frequency: string; interval: number; end_date?: string } | null;
    recurrence_group_id: string | null;
    proof_url: string | null;
    notes: string | null;
    created_by: string | null;
    completed_at: string | null;
    created_at: string;
    staff?: Staff;
}

// Helper: convert frequency value to day increment
function frequencyToDays(freq: string): number {
    switch (freq) {
        case 'daily': return 1;
        case 'every_2_days': return 2;
        case 'every_3_days': return 3;
        case 'every_4_days': return 4;
        case 'every_5_days': return 5;
        case 'every_6_days': return 6;
        case 'weekly': return 7;
        case 'biweekly': return 14;
        case 'monthly': return 0; // special case — use setMonth
        default: return 1;
    }
}

const RECURRENCE_OPTIONS = [
    { value: 'none', label: 'No Repeat' },
    { value: 'daily', label: 'Every Day' },
    { value: 'every_2_days', label: 'Every 2 Days' },
    { value: 'every_3_days', label: 'Every 3 Days' },
    { value: 'every_4_days', label: 'Every 4 Days' },
    { value: 'every_5_days', label: 'Every 5 Days' },
    { value: 'every_6_days', label: 'Every 6 Days' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Biweekly' },
    { value: 'monthly', label: 'Monthly' },
];

interface AISuggestion {
    title: string;
    description: string;
    priority: string;
}

interface TaskStatusDef {
    id: string;
    label: string;
    color: string;
    sort_order: number;
    is_default: boolean;
}

interface TaskComment {
    id: string;
    task_id: string;
    staff_id: string;
    content: string | null;
    attachment_url: string | null;
    created_at: string;
    staff?: { name: string; staff_code: string; role: string };
}

function TasksPanel({ staffList, adminId }: { staffList: Staff[]; adminId: string }) {
    // Templates
    const [templates, setTemplates] = useState<TaskTemplate[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(true);
    const [showTemplateForm, setShowTemplateForm] = useState(false);
    const [templateForm, setTemplateForm] = useState({ title: '', description: '', priority: 'medium' });
    const [templateFormLoading, setTemplateFormLoading] = useState(false);
    const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

    // Assignments
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loadingTasks, setLoadingTasks] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterStaff, setFilterStaff] = useState('');

    // Custom statuses
    const [statuses, setStatuses] = useState<TaskStatusDef[]>([]);
    const [showStatusMgr, setShowStatusMgr] = useState(false);
    const [newStatusLabel, setNewStatusLabel] = useState('');
    const [newStatusColor, setNewStatusColor] = useState('#888888');

    // Task editing
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [editTaskForm, setEditTaskForm] = useState({ status: '', priority: 'medium', due_date: '', staff_id: '', recurrence: 'none', recurrence_end: '' });
    const [applyAllConfirm, setApplyAllConfirm] = useState<{ show: boolean; pendingSave?: () => void }>({ show: false });
    const [editingGroupMode, setEditingGroupMode] = useState(false);

    // Assign modal
    const [assignTemplate, setAssignTemplate] = useState<TaskTemplate | null>(null);
    const [assignForm, setAssignForm] = useState({ staff_id: '', due_date: '', priority: 'medium', recurrence: 'none' as string, recurrence_end: '' });
    const [assignLoading, setAssignLoading] = useState(false);

    // AI state
    const [showAI, setShowAI] = useState(false);
    const [aiInstruction, setAiInstruction] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
    const [approvedIndices, setApprovedIndices] = useState<Set<number>>(new Set());
    const [savingAI, setSavingAI] = useState(false);

    // Message state
    const [showMessage, setShowMessage] = useState(false);
    const [messageTask, setMessageTask] = useState<Task | null>(null);
    const [messageText, setMessageText] = useState('');
    const [messageSending, setMessageSending] = useState(false);

    // Delete assignment
    const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
    const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
    const [assignmentDateFilter, setAssignmentDateFilter] = useState<'today' | 'all'>('today');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // Comments
    const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
    const [commentText, setCommentText] = useState('');
    const [commentSending, setCommentSending] = useState(false);
    const [commentFile, setCommentFile] = useState<File | null>(null);
    const [commentPreview, setCommentPreview] = useState<string | null>(null);
    const commentFileRef = useRef<HTMLInputElement>(null);

    // Active panel on mobile
    const [activePanel, setActivePanel] = useState<'library' | 'calendar' | 'assignments'>('library');

    // Calendar state
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');
    const [calFilterStaff, setCalFilterStaff] = useState('');
    const [calFilterPriority, setCalFilterPriority] = useState('');
    const [calFilterStatus, setCalFilterStatus] = useState('');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const today = new Date().toISOString().slice(0, 10);

    const fetchStatuses = useCallback(async () => {
        const { data } = await supabase.from('task_statuses').select('*').order('sort_order');
        if (data) setStatuses(data);
    }, []);

    const fetchTemplates = useCallback(async () => {
        setLoadingTemplates(true);
        const { data } = await supabase.from('task_templates').select('*').order('created_at', { ascending: false });
        if (data) setTemplates(data);
        setLoadingTemplates(false);
    }, []);

    const fetchTasks = useCallback(async () => {
        setLoadingTasks(true);
        let query = supabase.from('tasks').select('*, staff!tasks_staff_id_fkey(*)').order('due_date', { ascending: true });
        if (filterStatus !== 'all') query = query.eq('status', filterStatus);
        if (filterStaff) query = query.eq('staff_id', filterStaff);
        const { data } = await query;
        if (data) setTasks(data);
        setLoadingTasks(false);
    }, [filterStatus, filterStaff]);

    useEffect(() => { fetchStatuses(); fetchTemplates(); fetchTasks(); }, [fetchStatuses, fetchTemplates, fetchTasks]);

    // Auto-detect overdue
    useEffect(() => {
        tasks.forEach(async t => {
            if (t.status === 'Pending' && t.due_date < today) {
                await supabase.from('tasks').update({ status: 'Overdue' }).eq('id', t.id);
            }
        });
    }, [tasks, today]);

    // Template CRUD
    async function createOrUpdateTemplate(e: React.FormEvent) {
        e.preventDefault();
        setTemplateFormLoading(true);
        if (editingTemplateId) {
            const { error } = await supabase.from('task_templates').update({
                title: templateForm.title,
                description: templateForm.description || null,
                priority: templateForm.priority,
            }).eq('id', editingTemplateId);
            if (error) { alert('Failed to update: ' + error.message); setTemplateFormLoading(false); return; }
        } else {
            const { error } = await supabase.from('task_templates').insert({
                title: templateForm.title,
                description: templateForm.description || null,
                priority: templateForm.priority,
                created_by: adminId || null,
            });
            if (error) { alert('Failed to create: ' + error.message); setTemplateFormLoading(false); return; }
        }
        setShowTemplateForm(false);
        setEditingTemplateId(null);
        setTemplateForm({ title: '', description: '', priority: 'medium' });
        setTemplateFormLoading(false);
        fetchTemplates();
    }

    function startEditTemplate(tmpl: TaskTemplate) {
        setEditingTemplateId(tmpl.id);
        setTemplateForm({ title: tmpl.title, description: tmpl.description || '', priority: tmpl.priority });
        setShowTemplateForm(true);
        setShowAI(false);
    }

    async function deleteTemplate(id: string) {
        await supabase.from('task_templates').delete().eq('id', id);
        setDeleteTemplateId(null);
        fetchTemplates();
    }

    // Status CRUD
    async function addStatus() {
        if (!newStatusLabel.trim()) return;
        const maxOrder = statuses.length > 0 ? Math.max(...statuses.map(s => s.sort_order)) + 1 : 0;
        await supabase.from('task_statuses').insert({ label: newStatusLabel.trim(), color: newStatusColor, sort_order: maxOrder });
        setNewStatusLabel(''); setNewStatusColor('#888888');
        fetchStatuses();
    }
    async function removeStatus(id: string) {
        await supabase.from('task_statuses').delete().eq('id', id);
        fetchStatuses();
    }

    // Task editing — save single task
    async function doSaveTaskEdit(applyToAll: boolean) {
        if (!editingTask) return;
        const recurrenceRule = editTaskForm.recurrence !== 'none' ? {
            frequency: editTaskForm.recurrence,
            interval: 1,
            ...(editTaskForm.recurrence_end ? { end_date: editTaskForm.recurrence_end } : {}),
        } : null;

        // Save this task first
        await supabase.from('tasks').update({
            status: editTaskForm.status,
            priority: editTaskForm.priority,
            due_date: editTaskForm.due_date,
            staff_id: editTaskForm.staff_id,
            completed_at: editTaskForm.status === 'Completed' ? new Date().toISOString() : null,
            recurrence_rule: recurrenceRule,
        }).eq('id', editingTask.id);

        // Apply changes to ALL sibling instances in this recurrence group
        if (applyToAll && editingTask.recurrence_group_id) {
            // Get ALL tasks in the group (including this one) ordered by creation
            const { data: allGroupTasks } = await supabase
                .from('tasks')
                .select('id, due_date, created_at')
                .eq('recurrence_group_id', editingTask.recurrence_group_id)
                .order('created_at', { ascending: true });

            if (allGroupTasks && allGroupTasks.length > 1) {
                // Use the edited task's date as the base start date
                const baseDateStr = editTaskForm.due_date; // e.g. '2026-03-14'
                const [baseY, baseM, baseD] = baseDateStr.split('-').map(Number);
                const freq = editTaskForm.recurrence;
                const dayStep = frequencyToDays(freq);

                // Regenerate dates for every task in the group
                // Task at index 0 gets the base date, index 1 gets base + 1 interval, etc.
                const updates: PromiseLike<unknown>[] = [];
                for (let i = 0; i < allGroupTasks.length; i++) {
                    let newDate: Date;
                    if (dayStep > 0) {
                        // Day-based frequency: add i * dayStep days
                        newDate = new Date(baseY, baseM - 1, baseD + (i * dayStep), 12, 0, 0);
                    } else {
                        // Monthly: add i months
                        newDate = new Date(baseY, baseM - 1 + i, baseD, 12, 0, 0);
                    }
                    const dateStr = newDate.toISOString().slice(0, 10);

                    updates.push(
                        supabase.from('tasks').update({
                            due_date: dateStr,
                            recurrence_rule: recurrenceRule,
                            priority: editTaskForm.priority,
                        }).eq('id', allGroupTasks[i].id).then()
                    );
                }
                // Execute all updates in parallel for speed
                await Promise.all(updates);
            }
        }

        setApplyAllConfirm({ show: false });
        setEditingGroupMode(false);
        setEditingTask(null);
        fetchTasks();
    }

    // Regenerate all dates in a recurring group (one-click fix)
    async function regenerateGroupDates(groupId: string) {
        // Fetch all tasks in this group ordered by creation
        const { data: tasks } = await supabase
            .from('tasks')
            .select('id, due_date, recurrence_rule, created_at')
            .eq('recurrence_group_id', groupId)
            .order('created_at', { ascending: true });

        if (!tasks || tasks.length < 2) return;

        const first = tasks[0];
        const freq = first.recurrence_rule?.frequency || 'weekly';
        const dayStep = frequencyToDays(freq);
        const baseDateStr = first.due_date;
        const [baseY, baseM, baseD] = baseDateStr.split('-').map(Number);

        // Regenerate all dates using clean date math (no mutation)
        const updates: PromiseLike<unknown>[] = [];
        for (let i = 1; i < tasks.length; i++) {
            let newDate: Date;
            if (dayStep > 0) {
                newDate = new Date(baseY, baseM - 1, baseD + (i * dayStep), 12, 0, 0);
            } else {
                newDate = new Date(baseY, baseM - 1 + i, baseD, 12, 0, 0);
            }
            updates.push(
                supabase.from('tasks').update({
                    due_date: newDate.toISOString().slice(0, 10),
                }).eq('id', tasks[i].id).then()
            );
        }
        await Promise.all(updates);
        fetchTasks();
    }

    // Regenerate all dates in a legacy recurring group (by individual task IDs)
    async function regenerateGroupDatesByIds(taskIds: string[]) {
        if (taskIds.length < 2) return;
        const { data: tasks } = await supabase
            .from('tasks')
            .select('id, due_date, recurrence_rule, created_at')
            .in('id', taskIds)
            .order('created_at', { ascending: true });

        if (!tasks || tasks.length < 2) return;

        const first = tasks[0];
        const freq = first.recurrence_rule?.frequency || 'weekly';
        const dayStep = frequencyToDays(freq);
        const baseDateStr = first.due_date;
        const [baseY, baseM, baseD] = baseDateStr.split('-').map(Number);

        const updates: PromiseLike<unknown>[] = [];
        for (let i = 1; i < tasks.length; i++) {
            let newDate: Date;
            if (dayStep > 0) {
                newDate = new Date(baseY, baseM - 1, baseD + (i * dayStep), 12, 0, 0);
            } else {
                newDate = new Date(baseY, baseM - 1 + i, baseD, 12, 0, 0);
            }
            updates.push(
                supabase.from('tasks').update({
                    due_date: newDate.toISOString().slice(0, 10),
                }).eq('id', tasks[i].id).then()
            );
        }
        await Promise.all(updates);
        fetchTasks();
    }
    // Save button click — check if we need confirmation
    function saveTaskEdit() {
        if (!editingTask) return;
        // Group mode: always apply to all, no confirmation needed
        if (editingGroupMode) {
            doSaveTaskEdit(true);
            return;
        }
        const dateChanged = editTaskForm.due_date !== editingTask.due_date;
        const isRecurring = editingTask.recurrence_group_id && editingTask.recurrence_rule;
        if (dateChanged && isRecurring) {
            // Show confirmation dialog
            setApplyAllConfirm({ show: true, pendingSave: () => { } });
        } else {
            doSaveTaskEdit(false);
        }
    }

    function openEditTask(task: Task, groupMode = false) {
        setEditingTask(task);
        setEditingGroupMode(groupMode);
        const rr = task.recurrence_rule;
        setEditTaskForm({
            status: task.status,
            priority: task.priority || 'medium',
            due_date: task.due_date,
            staff_id: task.staff_id,
            recurrence: rr?.frequency || 'none',
            recurrence_end: rr?.end_date || '',
        });
        fetchComments(task.id);
    }

    // Comments
    async function fetchComments(taskId: string) {
        const { data } = await supabase
            .from('task_comments')
            .select('*, staff!task_comments_staff_id_fkey(name, staff_code, role)')
            .eq('task_id', taskId)
            .order('created_at', { ascending: true });
        if (data) setTaskComments(data);
    }

    async function postComment() {
        if (!editingTask || (!commentText.trim() && !commentFile)) return;
        setCommentSending(true);
        let attachmentUrl: string | null = null;

        if (commentFile) {
            const ext = commentFile.name.split('.').pop() || 'jpg';
            const path = `${editingTask.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('task-attachments')
                .upload(path, commentFile, { contentType: commentFile.type });
            if (!upErr) {
                const { data: urlData } = supabase.storage.from('task-attachments').getPublicUrl(path);
                attachmentUrl = urlData?.publicUrl || null;
            }
        }

        await supabase.from('task_comments').insert({
            task_id: editingTask.id,
            staff_id: adminId || null,
            content: commentText.trim() || null,
            attachment_url: attachmentUrl,
        });
        setCommentText('');
        setCommentFile(null);
        setCommentPreview(null);
        setCommentSending(false);
        fetchComments(editingTask.id);
    }

    function handleCommentFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setCommentFile(file);
        const reader = new FileReader();
        reader.onload = () => setCommentPreview(reader.result as string);
        reader.readAsDataURL(file);
    }

    // Assignment
    async function assignTask(e: React.FormEvent) {
        e.preventDefault();
        if (!assignTemplate) return;
        setAssignLoading(true);
        const defaultStatus = statuses.find(s => s.is_default)?.label || 'Pending';
        const recurrenceRule = assignForm.recurrence !== 'none' ? {
            frequency: assignForm.recurrence,
            interval: 1,
            ...(assignForm.recurrence_end ? { end_date: assignForm.recurrence_end } : {}),
        } : null;

        // Generate a group ID to link all recurring instances
        const groupId = recurrenceRule ? crypto.randomUUID() : null;

        // Insert the first task
        await supabase.from('tasks').insert({
            title: assignTemplate.title,
            description: assignTemplate.description,
            template_id: assignTemplate.id,
            staff_id: assignForm.staff_id,
            due_date: assignForm.due_date,
            status: defaultStatus,
            priority: assignForm.priority,
            created_by: adminId || null,
            recurrence_rule: recurrenceRule,
            recurrence_group_id: groupId,
        });

        // Auto-generate recurring task instances (default: next 3 months if no end date)
        if (recurrenceRule && assignForm.due_date) {
            const instances: Array<Record<string, unknown>> = [];
            const startDate = new Date(assignForm.due_date + 'T12:00:00');
            let endDate: Date;
            if (recurrenceRule.end_date) {
                endDate = new Date(recurrenceRule.end_date + 'T12:00:00');
            } else {
                // Default to 3 months from start
                endDate = new Date(startDate);
                endDate.setMonth(endDate.getMonth() + 3);
            }
            const dayStep = frequencyToDays(recurrenceRule.frequency);

            let current = new Date(startDate);
            for (let i = 0; i < 90; i++) {
                // Advance by interval
                if (dayStep > 0) current.setDate(current.getDate() + dayStep);
                else current.setMonth(current.getMonth() + 1); // monthly

                if (current > endDate) break;

                instances.push({
                    title: assignTemplate.title,
                    description: assignTemplate.description,
                    template_id: assignTemplate.id,
                    staff_id: assignForm.staff_id,
                    due_date: current.toISOString().slice(0, 10),
                    status: defaultStatus,
                    priority: assignForm.priority,
                    created_by: adminId || null,
                    recurrence_rule: recurrenceRule,
                    recurrence_group_id: groupId,
                });
            }
            if (instances.length > 0) {
                await supabase.from('tasks').insert(instances);
            }
        }

        setAssignLoading(false);
        setAssignTemplate(null);
        setAssignForm({ staff_id: '', due_date: '', priority: 'medium', recurrence: 'none', recurrence_end: '' });
        fetchTasks();
        setActivePanel('assignments');
    }

    // AI
    async function handleAIGenerate() {
        if (!aiInstruction.trim()) return;
        setAiLoading(true);
        setAiError('');
        setAiSuggestions([]);
        setApprovedIndices(new Set());
        try {
            const { data: settings } = await supabase.from('settings').select('gemini_api_key').limit(1).single();
            const activeStaff = staffList.filter(s => s.active && s.role === 'staff');
            const res = await fetch(`${supabaseUrl}/functions/v1/generate-tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction: aiInstruction,
                    staff_list: activeStaff.map(s => ({ name: s.name, role: s.role, staff_code: s.staff_code })),
                    api_key: settings?.gemini_api_key || undefined,
                }),
            });
            const data = await res.json();
            if (data.error) setAiError(data.error);
            else if (data.tasks) setAiSuggestions(data.tasks);
        } catch { setAiError('Failed to connect to AI service.'); }
        setAiLoading(false);
    }

    async function saveAIAsTemplates() {
        setSavingAI(true);
        const toSave = aiSuggestions.filter((_, i) => approvedIndices.has(i));
        for (const t of toSave) {
            await supabase.from('task_templates').insert({
                title: t.title,
                description: t.description || null,
                priority: t.priority || 'medium',
                created_by: adminId || null,
            });
        }
        setSavingAI(false);
        setAiSuggestions([]);
        setApprovedIndices(new Set());
        setShowAI(false);
        setAiInstruction('');
        fetchTemplates();
    }

    // Delete assignment
    async function deleteAssignment(id: string) {
        await supabase.from('tasks').delete().eq('id', id);
        setDeleteTaskId(null);
        fetchTasks();
    }

    async function deleteRecurrenceGroup(groupId: string) {
        if (groupId.startsWith('legacy::')) {
            // Legacy group: delete by individual task IDs
            const ids = groupId.replace('legacy::', '').split(',');
            await supabase.from('tasks').delete().in('id', ids);
        } else {
            // New-style group: delete by recurrence_group_id
            await supabase.from('tasks').delete().eq('recurrence_group_id', groupId);
        }
        setDeleteGroupId(null);
        fetchTasks();
    }

    // Toggle task complete
    async function toggleComplete(task: Task) {
        const completedLabel = statuses.find(s => s.label === 'Completed')?.label || 'Completed';
        const defaultLabel = statuses.find(s => s.is_default)?.label || 'Pending';
        const newStatus = task.status === completedLabel ? defaultLabel : completedLabel;
        await supabase.from('tasks').update({
            status: newStatus,
            completed_at: newStatus === completedLabel ? new Date().toISOString() : null,
        }).eq('id', task.id);
        fetchTasks();
    }

    // Message
    async function sendTaskMessage() {
        if (!messageTask || !messageText.trim()) return;
        setMessageSending(true);
        await supabase.from('messages').insert({
            from_staff_id: adminId || null,
            to_staff_id: messageTask.staff_id,
            content: `[Task: ${messageTask.title}] ${messageText}`,
        });
        setMessageSending(false);
        setShowMessage(false);
        setMessageTask(null);
        setMessageText('');
    }

    const priorityBadge = (p: string) => {
        const c: Record<string, { bg: string; fg: string; icon: string }> = {
            high: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', icon: '🔴' },
            medium: { bg: 'rgba(234,179,8,0.15)', fg: '#eab308', icon: '🟡' },
            low: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', icon: '🟢' },
        };
        const v = c[p] || c.medium;
        return (
            <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: v.bg, color: v.fg }}>
                {v.icon} {p}
            </span>
        );
    };

    const statusBadge = (status: string) => {
        const found = statuses.find(s => s.label.toLowerCase() === status.toLowerCase());
        const color = found?.color || '#888';
        return (
            <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: `${color}22`, color }}>
                {status}
            </span>
        );
    };

    const pendingCount = tasks.filter(t => t.status === 'Pending' || (statuses.find(s => s.is_default)?.label === t.status)).length;
    const completedCount = tasks.filter(t => t.status === 'Completed').length;

    return (
        <div className="animate-fadeIn">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Task Management</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, background: 'rgba(234,179,8,0.15)', color: '#eab308' }}>
                        {pendingCount} pending
                    </span>
                    <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                        {completedCount} done
                    </span>
                    <button onClick={() => setShowStatusMgr(true)} style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, background: 'rgba(129,140,248,0.15)', color: '#818cf8', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                        ⚙️ Statuses
                    </button>
                </div>
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} className="mobile-panel-tabs">
                {[
                    { key: 'library' as const, icon: '📋', label: `Library (${templates.length})` },
                    { key: 'calendar' as const, icon: '📆', label: 'Calendar' },
                    { key: 'assignments' as const, icon: '✅', label: `Assignments (${tasks.filter(t => t.status !== 'Completed').length})` },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActivePanel(tab.key)}
                        style={{
                            flex: 1, padding: '10px', border: '1px solid #333', borderRadius: 10,
                            background: activePanel === tab.key ? '#f0b427' : '#111',
                            color: activePanel === tab.key ? '#000' : '#999',
                            fontWeight: 600, cursor: 'pointer', fontSize: 13,
                        }}
                    >{tab.icon} {tab.label}</button>
                ))}
            </div>

            {/* Calendar View */}
            {activePanel === 'calendar' && (() => {
                const year = calendarDate.getFullYear();
                const month = calendarDate.getMonth();
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                // Filter tasks for calendar
                let calTasks = [...tasks];
                if (calFilterStaff) calTasks = calTasks.filter(t => t.staff_id === calFilterStaff);
                if (calFilterPriority) calTasks = calTasks.filter(t => t.priority === calFilterPriority);
                if (calFilterStatus) calTasks = calTasks.filter(t => t.status === calFilterStatus);

                // Group tasks by date
                const tasksByDate: Record<string, Task[]> = {};
                calTasks.forEach(t => {
                    if (!tasksByDate[t.due_date]) tasksByDate[t.due_date] = [];
                    tasksByDate[t.due_date].push(t);
                });

                const priorityColor = (p: string) => p === 'high' ? '#ef4444' : p === 'medium' ? '#eab308' : '#22c55e';

                // Generate calendar days for month view
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

                // Week view helpers
                const getWeekStart = (d: Date) => {
                    const s = new Date(d);
                    s.setDate(s.getDate() - s.getDay());
                    return s;
                };
                const weekStart = getWeekStart(calendarDate);

                const prevPeriod = () => {
                    const d = new Date(calendarDate);
                    if (calendarView === 'month') d.setMonth(d.getMonth() - 1);
                    else if (calendarView === 'week') d.setDate(d.getDate() - 7);
                    else d.setDate(d.getDate() - 1);
                    setCalendarDate(d);
                };
                const nextPeriod = () => {
                    const d = new Date(calendarDate);
                    if (calendarView === 'month') d.setMonth(d.getMonth() + 1);
                    else if (calendarView === 'week') d.setDate(d.getDate() + 7);
                    else d.setDate(d.getDate() + 1);
                    setCalendarDate(d);
                };

                const renderDayCell = (dateStr: string, dayNum: number, isCurrentMonth: boolean) => {
                    const dayTasks = tasksByDate[dateStr] || [];
                    const isToday = dateStr === today;
                    return (
                        <div
                            key={dateStr}
                            onClick={() => {
                                // Click to create — open assign with this date pre-filled
                                if (templates.length > 0) {
                                    setAssignTemplate(templates[0]);
                                    setAssignForm({ staff_id: '', due_date: dateStr, priority: 'medium', recurrence: 'none', recurrence_end: '' });
                                }
                            }}
                            style={{
                                minHeight: calendarView === 'month' ? 80 : 120,
                                background: isToday ? 'rgba(240,180,39,0.08)' : '#111',
                                border: isToday ? '1px solid rgba(240,180,39,0.3)' : '1px solid #222',
                                borderRadius: 8, padding: 6, cursor: 'pointer',
                                opacity: isCurrentMonth ? 1 : 0.3,
                            }}
                        >
                            <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? '#f0b427' : '#888', marginBottom: 4 }}>
                                {dayNum}
                            </div>
                            {dayTasks.slice(0, calendarView === 'month' ? 3 : 10).map(task => (
                                <div
                                    key={task.id}
                                    onClick={e => { e.stopPropagation(); openEditTask(task); }}
                                    style={{
                                        fontSize: 10, padding: '2px 4px', borderRadius: 4, marginBottom: 2,
                                        background: `${priorityColor(task.priority)}15`,
                                        borderLeft: `3px solid ${priorityColor(task.priority)}`,
                                        color: '#ccc', cursor: 'pointer', overflow: 'hidden',
                                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}
                                    title={`${task.title} (${task.staff?.name || 'Unassigned'})`}
                                >
                                    {task.recurrence_rule && '🔄 '}{task.title}
                                </div>
                            ))}
                            {dayTasks.length > (calendarView === 'month' ? 3 : 10) && (
                                <div style={{ fontSize: 9, color: '#666', textAlign: 'center' }}>+{dayTasks.length - (calendarView === 'month' ? 3 : 10)} more</div>
                            )}
                        </div>
                    );
                };

                return (
                    <div className="card" style={{ padding: 20 }}>
                        {/* Calendar Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={prevPeriod} style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#fff', cursor: 'pointer', fontSize: 14 }}>←</button>
                                <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 }}>
                                    {calendarView === 'day'
                                        ? calendarDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                                        : calendarView === 'week'
                                            ? `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                                            : `${monthNames[month]} ${year}`
                                    }
                                </h3>
                                <button onClick={nextPeriod} style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#fff', cursor: 'pointer', fontSize: 14 }}>→</button>
                                <button onClick={() => setCalendarDate(new Date())} style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#f0b427', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Today</button>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {(['month', 'week', 'day'] as const).map(v => (
                                    <button key={v} onClick={() => setCalendarView(v)} style={{
                                        padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                        background: calendarView === v ? '#f0b427' : '#1a1a2e',
                                        color: calendarView === v ? '#000' : '#999',
                                        border: '1px solid #333',
                                    }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
                                ))}
                            </div>
                        </div>

                        {/* Filter Bar */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                            <select className="input-field" value={calFilterStaff} onChange={e => setCalFilterStaff(e.target.value)} style={{ width: 'auto', minWidth: 130, padding: '6px 10px', fontSize: 12 }}>
                                <option value="">All Staff</option>
                                {staffList.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <select className="input-field" value={calFilterPriority} onChange={e => setCalFilterPriority(e.target.value)} style={{ width: 'auto', minWidth: 120, padding: '6px 10px', fontSize: 12 }}>
                                <option value="">All Priority</option>
                                <option value="high">🔴 High</option>
                                <option value="medium">🟡 Medium</option>
                                <option value="low">🟢 Low</option>
                            </select>
                            <select className="input-field" value={calFilterStatus} onChange={e => setCalFilterStatus(e.target.value)} style={{ width: 'auto', minWidth: 120, padding: '6px 10px', fontSize: 12 }}>
                                <option value="">All Status</option>
                                {statuses.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
                            </select>
                        </div>

                        {/* Month View */}
                        {calendarView === 'month' && (
                            <div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
                                    {dayNames.map(d => (
                                        <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#666', padding: '4px 0' }}>{d}</div>
                                    ))}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                                    {Array.from({ length: totalCells }, (_, i) => {
                                        const dayNum = i - firstDay + 1;
                                        const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
                                        const actualDate = new Date(year, month, dayNum);
                                        const dateStr = actualDate.toISOString().slice(0, 10);
                                        return renderDayCell(dateStr, actualDate.getDate(), isCurrentMonth);
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Week View */}
                        {calendarView === 'week' && (
                            <div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
                                    {dayNames.map(d => (
                                        <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#666', padding: '4px 0' }}>{d}</div>
                                    ))}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                                    {Array.from({ length: 7 }, (_, i) => {
                                        const d = new Date(weekStart);
                                        d.setDate(d.getDate() + i);
                                        const dateStr = d.toISOString().slice(0, 10);
                                        return renderDayCell(dateStr, d.getDate(), true);
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Day View */}
                        {calendarView === 'day' && (() => {
                            const dateStr = calendarDate.toISOString().slice(0, 10);
                            const dayTasks = tasksByDate[dateStr] || [];
                            return (
                                <div>
                                    {dayTasks.length === 0 ? (
                                        <p style={{ color: '#666', textAlign: 'center', padding: '40px 0' }}>No tasks for this day. Click to create one.</p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {dayTasks.map(task => (
                                                <div
                                                    key={task.id}
                                                    onClick={() => { openEditTask(task); }}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 12,
                                                        background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 10,
                                                        padding: '12px 16px', cursor: 'pointer',
                                                        borderLeft: `4px solid ${priorityColor(task.priority)}`,
                                                    }}
                                                >
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <strong style={{ color: '#fff', fontSize: 14 }}>{task.recurrence_rule && '🔄 '}{task.title}</strong>
                                                            {statusBadge(task.status)}
                                                        </div>
                                                        <p style={{ color: '#888', fontSize: 12, margin: '4px 0 0' }}>{task.staff?.name || 'Unassigned'}</p>
                                                    </div>
                                                    {priorityBadge(task.priority)}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (templates.length > 0) {
                                                setAssignTemplate(templates[0]);
                                                setAssignForm({ staff_id: '', due_date: dateStr, priority: 'medium', recurrence: 'none', recurrence_end: '' });
                                            }
                                        }}
                                        className="btn-primary"
                                        style={{ width: 'auto', padding: '10px 20px', marginTop: 16, fontSize: 13 }}
                                    >+ Add Task for {calendarDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</button>
                                </div>
                            );
                        })()}
                    </div>
                );
            })()}

            <div style={{ display: activePanel === 'calendar' ? 'none' : 'grid', gridTemplateColumns: activePanel === 'assignments' ? '1fr' : '1fr 1.5fr', gap: 20, alignItems: 'start' }} className="tasks-grid">

                {/* ═══ LEFT: Task Library ═══ */}
                <div className="tasks-library-panel" style={{ display: activePanel === 'library' ? 'block' : activePanel === 'assignments' ? 'none' : undefined }}>
                    <div className="card" style={{ padding: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>📋 Task Library</h3>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => { setShowAI(!showAI); setShowTemplateForm(false); }} style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#818cf8', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                    🤖 AI
                                </button>
                                <button onClick={() => { setShowTemplateForm(!showTemplateForm); setShowAI(false); }} className="btn-primary" style={{ width: 'auto', padding: '6px 14px', fontSize: 12 }}>
                                    + New
                                </button>
                            </div>
                        </div>

                        {/* AI Generator */}
                        {showAI && (
                            <div style={{ background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                                <p style={{ color: '#818cf8', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🤖 AI Task Generator</p>
                                <textarea
                                    className="input-field"
                                    value={aiInstruction}
                                    onChange={e => setAiInstruction(e.target.value)}
                                    placeholder="Describe what needs to be done, e.g. 'Prepare the restaurant for a health inspection next week'"
                                    rows={3}
                                    style={{ resize: 'vertical', marginBottom: 8 }}
                                />
                                <button onClick={handleAIGenerate} className="btn-primary" disabled={aiLoading || !aiInstruction.trim()} style={{ width: '100%', padding: '10px', fontSize: 13 }}>
                                    {aiLoading ? '⏳ Generating...' : '✨ Generate Tasks'}
                                </button>
                                {aiError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{aiError}</p>}
                                {aiSuggestions.length > 0 && (
                                    <div style={{ marginTop: 12 }}>
                                        <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>Select tasks to add to your library:</p>
                                        {aiSuggestions.map((sug, i) => (
                                            <div key={i} onClick={() => {
                                                setApprovedIndices(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(i)) next.delete(i); else next.add(i);
                                                    return next;
                                                });
                                            }} style={{
                                                background: approvedIndices.has(i) ? 'rgba(129,140,248,0.1)' : '#111',
                                                border: `1px solid ${approvedIndices.has(i) ? '#818cf8' : '#222'}`,
                                                borderRadius: 10, padding: 12, marginBottom: 6, cursor: 'pointer',
                                                transition: 'all 0.2s',
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontSize: 16 }}>{approvedIndices.has(i) ? '✅' : '⬜'}</span>
                                                    <strong style={{ color: '#fff', fontSize: 13 }}>{sug.title}</strong>
                                                    {priorityBadge(sug.priority)}
                                                </div>
                                                {sug.description && <p style={{ color: '#888', fontSize: 12, margin: '6px 0 0 28px' }}>{sug.description}</p>}
                                            </div>
                                        ))}
                                        <button onClick={saveAIAsTemplates} disabled={approvedIndices.size === 0 || savingAI} className="btn-primary" style={{ width: '100%', marginTop: 8, padding: '10px', fontSize: 13 }}>
                                            {savingAI ? 'Saving...' : `Add ${approvedIndices.size} to Library`}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Create Template Form */}
                        {showTemplateForm && (
                            <form onSubmit={createOrUpdateTemplate} style={{ background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                                <input className="input-field" value={templateForm.title} onChange={e => setTemplateForm({ ...templateForm, title: e.target.value })} placeholder="Task title" required style={{ marginBottom: 8 }} />
                                <textarea className="input-field" value={templateForm.description} onChange={e => setTemplateForm({ ...templateForm, description: e.target.value })} placeholder="Description (optional)" rows={2} style={{ resize: 'vertical', marginBottom: 8 }} />
                                <select className="input-field" value={templateForm.priority} onChange={e => setTemplateForm({ ...templateForm, priority: e.target.value })} style={{ marginBottom: 10 }}>
                                    <option value="low">🟢 Low Priority</option>
                                    <option value="medium">🟡 Medium Priority</option>
                                    <option value="high">🔴 High Priority</option>
                                </select>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button type="submit" className="btn-primary" disabled={templateFormLoading} style={{ flex: 1, padding: '10px', fontSize: 13 }}>
                                        {templateFormLoading ? 'Saving...' : editingTemplateId ? '✅ Update Template' : '✅ Create Template'}
                                    </button>
                                    <button type="button" onClick={() => { setShowTemplateForm(false); setEditingTemplateId(null); setTemplateForm({ title: '', description: '', priority: 'medium' }); }} className="btn-secondary" style={{ padding: '10px 16px', fontSize: 13 }}>Cancel</button>
                                </div>
                            </form>
                        )}

                        {/* Template List */}
                        {loadingTemplates ? (
                            <p style={{ color: '#666', textAlign: 'center', padding: 20 }}>Loading...</p>
                        ) : templates.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '30px 10px', color: '#666' }}>
                                <p style={{ fontSize: 32, marginBottom: 8 }}>📋</p>
                                <p style={{ fontSize: 13 }}>No templates yet. Create one or use AI.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }}>
                                {templates.map(tmpl => (
                                    <div key={tmpl.id} style={{
                                        background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14,
                                        transition: 'border-color 0.2s',
                                    }} onMouseEnter={e => (e.currentTarget.style.borderColor = '#444')} onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                    <strong style={{ color: '#fff', fontSize: 14 }}>{tmpl.title}</strong>
                                                    {priorityBadge(tmpl.priority)}
                                                </div>
                                                {tmpl.description && <p style={{ color: '#888', fontSize: 12, margin: 0 }}>{tmpl.description.length > 100 ? tmpl.description.slice(0, 100) + '...' : tmpl.description}</p>}
                                            </div>
                                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                <button onClick={() => startEditTemplate(tmpl)} title="Edit template" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#818cf8' }}>
                                                    ✏️
                                                </button>
                                                <button onClick={() => { setAssignTemplate(tmpl); setAssignForm({ staff_id: '', due_date: today, priority: tmpl.priority, recurrence: 'none', recurrence_end: '' }); }} title="Assign to staff" style={{ background: 'rgba(34,197,94,0.1)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#22c55e' }}>
                                                    📌 Assign
                                                </button>
                                                <button onClick={() => setDeleteTemplateId(tmpl.id)} title="Delete template" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#666' }}>
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ═══ RIGHT: Active Assignments ═══ */}
                {/* ═══ RIGHT: Active Assignments (flat list for Library tab) ═══ */}
                {activePanel === 'library' && (
                    <div className="tasks-assignments-panel">
                        <div className="card" style={{ padding: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>✅ Active Assignments</h3>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', background: '#111', borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}>
                                        <button onClick={() => setAssignmentDateFilter('today')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: assignmentDateFilter === 'today' ? '#f0b427' : 'transparent', color: assignmentDateFilter === 'today' ? '#000' : '#999', transition: 'all 0.2s' }}>📅 Today</button>
                                        <button onClick={() => setAssignmentDateFilter('all')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: assignmentDateFilter === 'all' ? '#f0b427' : 'transparent', color: assignmentDateFilter === 'all' ? '#000' : '#999', transition: 'all 0.2s' }}>📋 All</button>
                                    </div>
                                    <select className="input-field" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto', minWidth: 100, padding: '6px 10px', fontSize: 12 }}>
                                        <option value="all">All Status</option>
                                        {statuses.map(s => (
                                            <option key={s.id} value={s.label}>{s.label}</option>
                                        ))}
                                    </select>
                                    <select className="input-field" value={filterStaff} onChange={e => setFilterStaff(e.target.value)} style={{ width: 'auto', minWidth: 100, padding: '6px 10px', fontSize: 12 }}>
                                        <option value="">All Staff</option>
                                        {staffList.filter(s => s.active).map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {(() => {
                                // Filter tasks by date
                                const filtered = assignmentDateFilter === 'today'
                                    ? tasks.filter(t => t.due_date === today)
                                    : tasks;

                                if (loadingTasks) return <p style={{ color: '#666', textAlign: 'center', padding: 20 }}>Loading...</p>;
                                if (filtered.length === 0) return (
                                    <div style={{ textAlign: 'center', padding: '40px 10px', color: '#666' }}>
                                        <p style={{ fontSize: 36, marginBottom: 8 }}>📌</p>
                                        <p style={{ fontSize: 14, fontWeight: 500 }}>{assignmentDateFilter === 'today' ? 'No tasks due today' : 'No assignments yet'}</p>
                                        {assignmentDateFilter === 'today' && <button onClick={() => setAssignmentDateFilter('all')} style={{ marginTop: 8, background: 'none', border: '1px solid #333', borderRadius: 8, color: '#f0b427', padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>View All Tasks</button>}
                                    </div>
                                );

                                // Group tasks: recurring groups + standalone
                                const groups: { groupId: string | null; legacyKey?: string; tasks: Task[]; isRecurring: boolean }[] = [];
                                const groupedById = new Set<string>();
                                const legacyGroups = new Map<string, Task[]>();
                                const processedTaskIds = new Set<string>();

                                for (const task of filtered) {
                                    if (task.recurrence_group_id && !groupedById.has(task.recurrence_group_id)) {
                                        groupedById.add(task.recurrence_group_id);
                                        const siblings = filtered.filter(t => t.recurrence_group_id === task.recurrence_group_id);
                                        groups.push({ groupId: task.recurrence_group_id, tasks: siblings, isRecurring: true });
                                        siblings.forEach(s => processedTaskIds.add(s.id));
                                    }
                                }

                                for (const task of filtered) {
                                    if (processedTaskIds.has(task.id)) continue;
                                    if (task.recurrence_rule && !task.recurrence_group_id) {
                                        const key = `${task.title}::${task.staff_id}::${task.recurrence_rule.frequency}`;
                                        if (!legacyGroups.has(key)) legacyGroups.set(key, []);
                                        legacyGroups.get(key)!.push(task);
                                        processedTaskIds.add(task.id);
                                    }
                                }
                                for (const [key, tasks] of legacyGroups) {
                                    if (tasks.length > 1) {
                                        groups.push({ groupId: null, legacyKey: key, tasks, isRecurring: true });
                                    } else {
                                        groups.push({ groupId: null, tasks, isRecurring: false });
                                    }
                                }

                                for (const task of filtered) {
                                    if (!processedTaskIds.has(task.id)) {
                                        groups.push({ groupId: null, tasks: [task], isRecurring: false });
                                    }
                                }

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 600, overflowY: 'auto' }}>
                                        {groups.map((group) => {
                                            if (!group.isRecurring) {
                                                const task = group.tasks[0];
                                                const staffInfo = task.staff as unknown as Staff | undefined;
                                                const isOverdue = task.due_date < today && task.status !== 'Completed';
                                                return (
                                                    <div key={task.id} style={{
                                                        background: isOverdue ? 'rgba(239,68,68,0.05)' : '#111',
                                                        border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.3)' : '#222'}`,
                                                        borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'border-color 0.2s',
                                                    }} onClick={() => openEditTask(task)} onMouseEnter={e => (e.currentTarget.style.borderColor = '#555')} onMouseLeave={e => (e.currentTarget.style.borderColor = isOverdue ? 'rgba(239,68,68,0.3)' : '#222')}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                                                    <button onClick={e => { e.stopPropagation(); toggleComplete(task); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}>
                                                                        {task.status === 'Completed' ? '✅' : '⬜'}
                                                                    </button>
                                                                    <strong style={{ color: task.status === 'Completed' ? '#666' : '#fff', fontSize: 14, textDecoration: task.status === 'Completed' ? 'line-through' : 'none' }}>
                                                                        {task.title}
                                                                    </strong>
                                                                    {statusBadge(task.status)}
                                                                    {priorityBadge(task.priority || 'medium')}
                                                                </div>
                                                                {task.description && <p style={{ color: '#888', fontSize: 12, margin: '2px 0 0 30px' }}>{task.description.length > 120 ? task.description.slice(0, 120) + '...' : task.description}</p>}
                                                                <div style={{ display: 'flex', gap: 12, marginTop: 8, marginLeft: 30 }}>
                                                                    <span style={{ fontSize: 12, color: '#666' }}>👤 {staffInfo?.name || 'Unassigned'}</span>
                                                                    <span style={{ fontSize: 12, color: isOverdue ? '#ef4444' : '#666' }}>📅 {task.due_date}</span>
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                                <button onClick={e => { e.stopPropagation(); openEditTask(task); }} title="Edit task" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#818cf8' }}>✏️</button>
                                                                <button onClick={e => { e.stopPropagation(); setMessageTask(task); setMessageText(''); setShowMessage(true); }} title="Message staff" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px' }}>💬</button>
                                                                <button onClick={e => { e.stopPropagation(); setDeleteTaskId(task.id); }} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#666' }}>🗑️</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            // Recurring group card
                                            const first = group.tasks[0];
                                            const staffInfo = first.staff as unknown as Staff | undefined;
                                            const groupKey = group.groupId || group.legacyKey || first.id;
                                            const isExpanded = expandedGroups.has(groupKey);
                                            const freq = RECURRENCE_OPTIONS.find(o => o.value === first.recurrence_rule?.frequency)?.label || first.recurrence_rule?.frequency || 'Recurring';
                                            const dates = group.tasks.map(t => t.due_date).sort();
                                            const todayTasks = group.tasks.filter(t => t.due_date === today);
                                            const completedCount = group.tasks.filter(t => t.status === 'Completed').length;

                                            return (
                                                <div key={groupKey} style={{ background: '#111', border: '1px solid #2a2a4a', borderRadius: 12, overflow: 'hidden' }}>
                                                    <div
                                                        style={{ padding: 14, cursor: 'pointer', transition: 'background 0.2s' }}
                                                        onClick={() => {
                                                            const next = new Set(expandedGroups);
                                                            if (isExpanded) next.delete(groupKey); else next.add(groupKey);
                                                            setExpandedGroups(next);
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = '#1a1a2e')}
                                                        onMouseLeave={e => (e.currentTarget.style.background = '#111')}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                                                    <span style={{ fontSize: 16 }}>{isExpanded ? '▼' : '▶'}</span>
                                                                    <strong style={{ color: '#fff', fontSize: 14 }}>🔄 {first.title}</strong>
                                                                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                                                                        {freq} · {group.tasks.length} instances
                                                                    </span>
                                                                    {priorityBadge(first.priority || 'medium')}
                                                                </div>
                                                                <div style={{ display: 'flex', gap: 12, marginLeft: 28, flexWrap: 'wrap' }}>
                                                                    <span style={{ fontSize: 12, color: '#666' }}>👤 {staffInfo?.name || 'Unassigned'}</span>
                                                                    <span style={{ fontSize: 12, color: '#666' }}>📅 {dates[0]} → {dates[dates.length - 1]}</span>
                                                                    <span style={{ fontSize: 12, color: '#22c55e' }}>✅ {completedCount}/{group.tasks.length} done</span>
                                                                    {todayTasks.length > 0 && <span style={{ fontSize: 12, color: '#f0b427', fontWeight: 600 }}>⚡ {todayTasks.length} due today</span>}
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                                <button onClick={e => { e.stopPropagation(); openEditTask(first, true); }} title="Edit all instances" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#818cf8' }}>✏️</button>
                                                                <button onClick={e => { e.stopPropagation(); if (group.groupId) { regenerateGroupDates(group.groupId); } else { regenerateGroupDatesByIds(group.tasks.map(t => t.id)); } }} title="Regenerate dates" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#22c55e' }}>🔄</button>
                                                                <button onClick={e => { e.stopPropagation(); if (group.groupId) { setDeleteGroupId(group.groupId); } else { setDeleteGroupId('legacy::' + group.tasks.map(t => t.id).join(',')); } }} title="Delete all instances" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 6px', color: '#ef4444' }}>🗑️</button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {isExpanded && (
                                                        <div style={{ borderTop: '1px solid #2a2a4a', padding: '8px 14px 14px' }}>
                                                            <div style={{ fontSize: 11, color: '#666', marginBottom: 6, textAlign: 'right' }}>
                                                                Showing all {group.tasks.length} instances
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
                                                                {group.tasks.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map((task, idx) => {
                                                                    const tStaff = task.staff as unknown as Staff | undefined;
                                                                    const isOverdue = task.due_date < today && task.status !== 'Completed';
                                                                    return (
                                                                        <div key={task.id} style={{
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                                                                            background: isOverdue ? 'rgba(239,68,68,0.05)' : '#0a0a0a',
                                                                            border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.2)' : '#1a1a1a'}`,
                                                                            borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
                                                                        }} onClick={() => openEditTask(task)}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                                                                                <span style={{ fontSize: 11, color: '#555', minWidth: 20, fontWeight: 700 }}>#{idx + 1}</span>
                                                                                <button onClick={e => { e.stopPropagation(); toggleComplete(task); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0 }}>
                                                                                    {task.status === 'Completed' ? '✅' : '⬜'}
                                                                                </button>
                                                                                <span style={{ fontSize: 12, color: isOverdue ? '#ef4444' : '#999', fontWeight: 600, minWidth: 90 }}>📅 {task.due_date}</span>
                                                                                {statusBadge(task.status)}
                                                                                <span style={{ fontSize: 12, color: '#666' }}>👤 {tStaff?.name || 'Unassigned'}</span>
                                                                            </div>
                                                                            <button onClick={e => { e.stopPropagation(); setDeleteTaskId(task.id); }} title="Delete this instance" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', color: '#666' }}>🗑️</button>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* ═══ FULL-WIDTH: Assignments Board (staff columns) ═══ */}
                <div className="tasks-board-panel" style={{ display: activePanel === 'assignments' ? 'block' : 'none' }}>
                    <div className="card" style={{ padding: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>✅ Assignments Board</h3>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', background: '#111', borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}>
                                    <button onClick={() => setAssignmentDateFilter('today')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: assignmentDateFilter === 'today' ? '#f0b427' : 'transparent', color: assignmentDateFilter === 'today' ? '#000' : '#999', transition: 'all 0.2s' }}>📅 Today</button>
                                    <button onClick={() => setAssignmentDateFilter('all')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: assignmentDateFilter === 'all' ? '#f0b427' : 'transparent', color: assignmentDateFilter === 'all' ? '#000' : '#999', transition: 'all 0.2s' }}>📋 All</button>
                                </div>
                                <select className="input-field" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto', minWidth: 100, padding: '6px 10px', fontSize: 12 }}>
                                    <option value="all">All Status</option>
                                    {statuses.map(s => (
                                        <option key={s.id} value={s.label}>{s.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {(() => {
                            // Filter tasks by date and status
                            let filtered = assignmentDateFilter === 'today'
                                ? tasks.filter(t => t.due_date === today)
                                : tasks;

                            if (loadingTasks) return <p style={{ color: '#666', textAlign: 'center', padding: 20 }}>Loading...</p>;
                            if (filtered.length === 0) return (
                                <div style={{ textAlign: 'center', padding: '40px 10px', color: '#666' }}>
                                    <p style={{ fontSize: 36, marginBottom: 8 }}>📌</p>
                                    <p style={{ fontSize: 14, fontWeight: 500 }}>{assignmentDateFilter === 'today' ? 'No tasks due today' : 'No assignments yet'}</p>
                                    {assignmentDateFilter === 'today' && <button onClick={() => setAssignmentDateFilter('all')} style={{ marginTop: 8, background: 'none', border: '1px solid #333', borderRadius: 8, color: '#f0b427', padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>View All Tasks</button>}
                                </div>
                            );

                            // Build staff columns — group tasks by staff_id
                            const activeStaff = staffList.filter(s => s.active && s.role === 'staff');
                            const staffColumns: { staff: Staff | null; staffTasks: Task[] }[] = [];

                            for (const staff of activeStaff) {
                                const staffTasks = filtered.filter(t => t.staff_id === staff.id);
                                staffColumns.push({ staff, staffTasks });
                            }

                            // Unassigned column
                            const unassignedTasks = filtered.filter(t => !t.staff_id);
                            if (unassignedTasks.length > 0) {
                                staffColumns.push({ staff: null, staffTasks: unassignedTasks });
                            }

                            // Helper to render a task card within a column
                            const renderTaskCard = (task: Task) => {
                                const isOverdue = task.due_date < today && task.status !== 'Completed';
                                return (
                                    <div key={task.id} style={{
                                        background: isOverdue ? 'rgba(239,68,68,0.06)' : '#0d0d0d',
                                        border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.25)' : '#1a1a2e'}`,
                                        borderRadius: 10, padding: 12, cursor: 'pointer', transition: 'border-color 0.2s',
                                    }} onClick={() => openEditTask(task)}
                                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#444')}
                                        onMouseLeave={e => (e.currentTarget.style.borderColor = isOverdue ? 'rgba(239,68,68,0.25)' : '#1a1a2e')}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                                            <button onClick={e => { e.stopPropagation(); toggleComplete(task); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}>
                                                {task.status === 'Completed' ? '✅' : '⬜'}
                                            </button>
                                            <strong style={{ color: task.status === 'Completed' ? '#555' : '#fff', fontSize: 13, textDecoration: task.status === 'Completed' ? 'line-through' : 'none', flex: 1, lineHeight: 1.3 }}>
                                                {task.title}
                                            </strong>
                                        </div>
                                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6, marginLeft: 26 }}>
                                            {statusBadge(task.status)}
                                            {priorityBadge(task.priority || 'medium')}
                                        </div>
                                        {task.description && <p style={{ color: '#666', fontSize: 11, margin: '0 0 6px 26px', lineHeight: 1.4 }}>{task.description.length > 80 ? task.description.slice(0, 80) + '...' : task.description}</p>}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginLeft: 26 }}>
                                            <span style={{ fontSize: 11, color: isOverdue ? '#ef4444' : '#555' }}>📅 {task.due_date}</span>
                                            <div style={{ display: 'flex', gap: 2 }}>
                                                <button onClick={e => { e.stopPropagation(); openEditTask(task); }} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', color: '#818cf8' }}>✏️</button>
                                                <button onClick={e => { e.stopPropagation(); setMessageTask(task); setMessageText(''); setShowMessage(true); }} title="Message" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>💬</button>
                                                <button onClick={e => { e.stopPropagation(); setDeleteTaskId(task.id); }} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', color: '#666' }}>🗑️</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            };

                            // Helper to render a recurring group card within a column
                            const renderGroupCard = (groupTasks: Task[], groupId: string | null, legacyKey?: string) => {
                                const first = groupTasks[0];
                                const gKey = groupId || legacyKey || first.id;
                                const isExpanded = expandedGroups.has(gKey);
                                const freq = RECURRENCE_OPTIONS.find(o => o.value === first.recurrence_rule?.frequency)?.label || first.recurrence_rule?.frequency || 'Recurring';
                                const completedCount = groupTasks.filter(t => t.status === 'Completed').length;
                                const todayInGroup = groupTasks.filter(t => t.due_date === today).length;

                                return (
                                    <div key={gKey} style={{ background: '#0d0d0d', border: '1px solid #2a2a4a', borderRadius: 10, overflow: 'hidden' }}>
                                        <div
                                            style={{ padding: 12, cursor: 'pointer', transition: 'background 0.2s' }}
                                            onClick={() => {
                                                const next = new Set(expandedGroups);
                                                if (isExpanded) next.delete(gKey); else next.add(gKey);
                                                setExpandedGroups(next);
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#151525')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '#0d0d0d')}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                                <span style={{ fontSize: 12 }}>{isExpanded ? '▼' : '▶'}</span>
                                                <strong style={{ color: '#fff', fontSize: 13, flex: 1 }}>🔄 {first.title}</strong>
                                            </div>
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                                                <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{freq} · {groupTasks.length}</span>
                                                {priorityBadge(first.priority || 'medium')}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: 11, color: '#22c55e' }}>✅ {completedCount}/{groupTasks.length}</span>
                                                <div style={{ display: 'flex', gap: 2 }}>
                                                    <button onClick={e => { e.stopPropagation(); openEditTask(first, true); }} title="Edit all" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', color: '#818cf8' }}>✏️</button>
                                                    <button onClick={e => { e.stopPropagation(); if (groupId) { regenerateGroupDates(groupId); } else { regenerateGroupDatesByIds(groupTasks.map(t => t.id)); } }} title="Regenerate" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', color: '#22c55e' }}>🔄</button>
                                                    <button onClick={e => { e.stopPropagation(); if (groupId) { setDeleteGroupId(groupId); } else { setDeleteGroupId('legacy::' + groupTasks.map(t => t.id).join(',')); } }} title="Delete all" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', color: '#ef4444' }}>🗑️</button>
                                                </div>
                                            </div>
                                            {todayInGroup > 0 && <span style={{ fontSize: 10, color: '#f0b427', fontWeight: 600, marginTop: 4, display: 'block' }}>⚡ {todayInGroup} due today</span>}
                                        </div>
                                        {isExpanded && (
                                            <div style={{ borderTop: '1px solid #2a2a4a', padding: '6px 10px 10px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                                                    {groupTasks.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map((task, idx) => {
                                                        const isOverdue = task.due_date < today && task.status !== 'Completed';
                                                        return (
                                                            <div key={task.id} style={{
                                                                display: 'flex', alignItems: 'center', gap: 6,
                                                                background: isOverdue ? 'rgba(239,68,68,0.05)' : '#080808',
                                                                border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.15)' : '#151515'}`,
                                                                borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 11,
                                                            }} onClick={() => openEditTask(task)}>
                                                                <button onClick={e => { e.stopPropagation(); toggleComplete(task); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0 }}>
                                                                    {task.status === 'Completed' ? '✅' : '⬜'}
                                                                </button>
                                                                <span style={{ color: isOverdue ? '#ef4444' : '#888', fontWeight: 600, flex: 1 }}>📅 {task.due_date}</span>
                                                                {statusBadge(task.status)}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            };

                            return (
                                <div className="board-columns" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
                                    {staffColumns.map(({ staff, staffTasks }) => {
                                        const pendingCount = staffTasks.filter(t => t.status !== 'Completed').length;
                                        const completedCount = staffTasks.filter(t => t.status === 'Completed').length;

                                        // Build groups within this staff column
                                        const columnGroups: { groupId: string | null; legacyKey?: string; tasks: Task[]; isRecurring: boolean }[] = [];
                                        const colGroupedById = new Set<string>();
                                        const colLegacy = new Map<string, Task[]>();
                                        const colProcessed = new Set<string>();

                                        for (const task of staffTasks) {
                                            if (task.recurrence_group_id && !colGroupedById.has(task.recurrence_group_id)) {
                                                colGroupedById.add(task.recurrence_group_id);
                                                const siblings = staffTasks.filter(t => t.recurrence_group_id === task.recurrence_group_id);
                                                columnGroups.push({ groupId: task.recurrence_group_id, tasks: siblings, isRecurring: true });
                                                siblings.forEach(s => colProcessed.add(s.id));
                                            }
                                        }
                                        for (const task of staffTasks) {
                                            if (colProcessed.has(task.id)) continue;
                                            if (task.recurrence_rule && !task.recurrence_group_id) {
                                                const key = `${task.title}::${task.staff_id}::${task.recurrence_rule.frequency}`;
                                                if (!colLegacy.has(key)) colLegacy.set(key, []);
                                                colLegacy.get(key)!.push(task);
                                                colProcessed.add(task.id);
                                            }
                                        }
                                        for (const [key, gTasks] of colLegacy) {
                                            if (gTasks.length > 1) {
                                                columnGroups.push({ groupId: null, legacyKey: key, tasks: gTasks, isRecurring: true });
                                            } else {
                                                columnGroups.push({ groupId: null, tasks: gTasks, isRecurring: false });
                                            }
                                        }
                                        for (const task of staffTasks) {
                                            if (!colProcessed.has(task.id)) {
                                                columnGroups.push({ groupId: null, tasks: [task], isRecurring: false });
                                            }
                                        }

                                        return (
                                            <div key={staff?.id || 'unassigned'} style={{
                                                minWidth: 260, maxWidth: 320, flex: '1 0 260px',
                                                background: '#111', border: '1px solid #222', borderRadius: 14,
                                                display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 320px)',
                                            }}>
                                                {/* Column header */}
                                                <div style={{
                                                    padding: '14px 14px 10px', borderBottom: '1px solid #222',
                                                    background: staff ? 'linear-gradient(135deg, rgba(240,180,39,0.08), rgba(129,140,248,0.05))' : 'rgba(255,255,255,0.02)',
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <span style={{ fontSize: 20 }}>{staff ? '👤' : '📋'}</span>
                                                            <strong style={{ color: '#fff', fontSize: 14 }}>{staff?.name || 'Unassigned'}</strong>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 4 }}>
                                                            {pendingCount > 0 && <span style={{ background: '#f0b427', color: '#000', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{pendingCount}</span>}
                                                            {completedCount > 0 && <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{completedCount} ✓</span>}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Column tasks */}
                                                <div style={{ padding: 10, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                    {columnGroups.length === 0 ? (
                                                        <div style={{ textAlign: 'center', padding: '24px 8px', color: '#444' }}>
                                                            <p style={{ fontSize: 24, marginBottom: 4 }}>✨</p>
                                                            <p style={{ fontSize: 12 }}>No tasks</p>
                                                        </div>
                                                    ) : (
                                                        columnGroups.map(cg => {
                                                            if (cg.isRecurring) {
                                                                return renderGroupCard(cg.tasks, cg.groupId, cg.legacyKey);
                                                            }
                                                            return renderTaskCard(cg.tasks[0]);
                                                        })
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* ═══ MODALS ═══ */}

            {/* Apply to All Instances Confirmation */}
            {applyAllConfirm.show && editingTask && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(4px)' }}>
                    <div className="card" style={{ maxWidth: 440, width: '90%', padding: 28, textAlign: 'center' }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>🔄</div>
                        <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Update All Recurring Instances?</h3>
                        <p style={{ color: '#999', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
                            This task is part of a recurring series. You changed the date from <strong style={{ color: '#f0b427' }}>{editingTask.due_date}</strong> to <strong style={{ color: '#f0b427' }}>{editTaskForm.due_date}</strong>.
                            <br />Would you like to shift all other instances by the same amount?
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button onClick={() => doSaveTaskEdit(true)} className="btn-primary" style={{ padding: '12px', fontSize: 14 }}>
                                ✅ Yes, Update All Instances
                            </button>
                            <button onClick={() => doSaveTaskEdit(false)} className="btn-secondary" style={{ padding: '12px', fontSize: 14 }}>
                                📌 Only This Task
                            </button>
                            <button onClick={() => setApplyAllConfirm({ show: false })} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '8px', fontSize: 13 }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Assign Modal */}
            {assignTemplate && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 420, width: '100%', padding: 24 }}>
                        <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📌 Assign Task</h3>
                        <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>Assigning: <strong style={{ color: '#fff' }}>{assignTemplate.title}</strong></p>
                        <form onSubmit={assignTask}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Assign To</label>
                            <select className="input-field" value={assignForm.staff_id} onChange={e => setAssignForm({ ...assignForm, staff_id: e.target.value })} required style={{ marginBottom: 12 }}>
                                <option value="">Select staff member...</option>
                                {staffList.filter(s => s.active && s.role === 'staff').map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.staff_code})</option>
                                ))}
                            </select>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Due Date</label>
                            <input className="input-field" type="date" value={assignForm.due_date} onChange={e => setAssignForm({ ...assignForm, due_date: e.target.value })} required style={{ marginBottom: 12, colorScheme: 'dark' }} />
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Priority</label>
                            <select className="input-field" value={assignForm.priority} onChange={e => setAssignForm({ ...assignForm, priority: e.target.value })} style={{ marginBottom: 12 }}>
                                <option value="low">🟢 Low</option>
                                <option value="medium">🟡 Medium</option>
                                <option value="high">🔴 High</option>
                            </select>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>🔄 Repeat</label>
                            <select className="input-field" value={assignForm.recurrence} onChange={e => setAssignForm({ ...assignForm, recurrence: e.target.value })} style={{ marginBottom: assignForm.recurrence !== 'none' ? 8 : 16 }}>
                                {RECURRENCE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                            </select>
                            {assignForm.recurrence !== 'none' && (
                                <>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>End Date (optional)</label>
                                    <input className="input-field" type="date" value={assignForm.recurrence_end} onChange={e => setAssignForm({ ...assignForm, recurrence_end: e.target.value })} style={{ marginBottom: 16, colorScheme: 'dark' }} />
                                </>
                            )}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="submit" className="btn-primary" disabled={assignLoading} style={{ flex: 1, padding: '12px' }}>
                                    {assignLoading ? 'Assigning...' : assignForm.recurrence !== 'none' ? '🔄 Assign Recurring' : '📌 Assign Task'}
                                </button>
                                <button type="button" onClick={() => setAssignTemplate(null)} className="btn-secondary" style={{ padding: '12px 20px' }}>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Message Modal */}
            {showMessage && messageTask && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 420, width: '100%', padding: 24 }}>
                        <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>💬 Message About Task</h3>
                        <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>Re: <strong style={{ color: '#fff' }}>{messageTask.title}</strong></p>
                        <textarea className="input-field" value={messageText} onChange={e => setMessageText(e.target.value)} placeholder="Type your message..." rows={3} style={{ resize: 'vertical', marginBottom: 12 }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={sendTaskMessage} className="btn-primary" disabled={messageSending || !messageText.trim()} style={{ flex: 1, padding: '12px' }}>
                                {messageSending ? 'Sending...' : '📤 Send Message'}
                            </button>
                            <button onClick={() => { setShowMessage(false); setMessageTask(null); }} className="btn-secondary" style={{ padding: '12px 20px' }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Template Confirmation */}
            {deleteTemplateId && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 360, width: '100%', padding: 24, textAlign: 'center' }}>
                        <p style={{ fontSize: 32, marginBottom: 8 }}>🗑️</p>
                        <p style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Delete this template?</p>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => deleteTemplate(deleteTemplateId)} style={{ flex: 1, padding: '12px', background: '#ef4444', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                            <button onClick={() => setDeleteTemplateId(null)} className="btn-secondary" style={{ flex: 1, padding: '12px' }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Task Confirmation */}
            {deleteTaskId && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 360, width: '100%', padding: 24, textAlign: 'center' }}>
                        <p style={{ fontSize: 32, marginBottom: 8 }}>🗑️</p>
                        <p style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Remove this assignment?</p>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => deleteAssignment(deleteTaskId)} style={{ flex: 1, padding: '12px', background: '#ef4444', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                            <button onClick={() => setDeleteTaskId(null)} className="btn-secondary" style={{ flex: 1, padding: '12px' }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Delete Recurring Group Confirmation */}
            {deleteGroupId && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(4px)', padding: 20 }}>
                    <div className="card" style={{ maxWidth: 400, width: '100%', padding: 28, textAlign: 'center' }}>
                        <p style={{ fontSize: 40, marginBottom: 8 }}>🔄🗑️</p>
                        <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete All Recurring Instances?</h3>
                        <p style={{ color: '#999', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
                            This will permanently remove <strong style={{ color: '#ef4444' }}>every instance</strong> in this recurring task series. This action cannot be undone.
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => deleteRecurrenceGroup(deleteGroupId)} style={{ flex: 1, padding: '12px', background: '#ef4444', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Delete All</button>
                            <button onClick={() => setDeleteGroupId(null)} className="btn-secondary" style={{ flex: 1, padding: '12px' }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Status Manager Modal */}
            {showStatusMgr && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 440, width: '100%', padding: 24 }}>
                        <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 16 }}>⚙️ Manage Task Statuses</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 240, overflowY: 'auto' }}>
                            {statuses.map(s => (
                                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#111', borderRadius: 8, border: '1px solid #222' }}>
                                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                                    <span style={{ flex: 1, color: '#fff', fontSize: 13 }}>{s.label}</span>
                                    {s.is_default && <span style={{ fontSize: 10, color: '#888', background: '#222', padding: '2px 6px', borderRadius: 4 }}>default</span>}
                                    <button onClick={() => removeStatus(s.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12 }}>✕</button>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <input className="input-field" value={newStatusLabel} onChange={e => setNewStatusLabel(e.target.value)} placeholder="New status name..." style={{ width: '100%', fontSize: 13, padding: '10px 12px', marginBottom: 8, boxSizing: 'border-box' }} />
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input type="color" value={newStatusColor} onChange={e => setNewStatusColor(e.target.value)} style={{ width: 36, height: 36, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'none', flexShrink: 0 }} />
                                <span style={{ fontSize: 12, color: '#888', flex: 1 }}>Pick color</span>
                                <button onClick={addStatus} className="btn-primary" disabled={!newStatusLabel.trim()} style={{ padding: '8px 20px', fontSize: 13 }}>+ Add</button>
                            </div>
                        </div>
                        <button onClick={() => setShowStatusMgr(false)} className="btn-secondary" style={{ width: '100%', padding: '10px' }}>Close</button>
                    </div>
                </div>
            )}

            {/* Task Detail + Comments Modal */}
            {editingTask && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 10000, padding: 20, paddingTop: 80 }}>
                    <div className="card" style={{ maxWidth: 560, width: '100%', padding: 24, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                            <div>
                                <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>✏️ {editingTask.title}</h3>
                                {editingGroupMode && <span style={{ display: 'inline-block', background: 'rgba(129,140,248,0.15)', color: '#818cf8', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, marginBottom: 6 }}>🔄 Editing all instances — changes apply to entire group</span>}
                                {editingTask.description && <p style={{ color: '#888', fontSize: 12, margin: 0 }}>{editingTask.description}</p>}
                            </div>
                            <button onClick={() => { setEditingTask(null); setEditingGroupMode(false); setTaskComments([]); setCommentText(''); setCommentFile(null); setCommentPreview(null); }} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 20, fontWeight: 700, width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
                        </div>

                        {/* Edit Fields */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Status</label>
                                <select className="input-field" value={editTaskForm.status} onChange={e => setEditTaskForm({ ...editTaskForm, status: e.target.value })} style={{ fontSize: 12 }}>
                                    {statuses.map(s => (<option key={s.id} value={s.label}>{s.label}</option>))}
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Priority</label>
                                <select className="input-field" value={editTaskForm.priority} onChange={e => setEditTaskForm({ ...editTaskForm, priority: e.target.value })} style={{ fontSize: 12 }}>
                                    <option value="low">🟢 Low</option>
                                    <option value="medium">🟡 Medium</option>
                                    <option value="high">🔴 High</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Due Date</label>
                                <input className="input-field" type="date" value={editTaskForm.due_date} onChange={e => setEditTaskForm({ ...editTaskForm, due_date: e.target.value })} style={{ fontSize: 12, colorScheme: 'dark' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Assignee</label>
                                <select className="input-field" value={editTaskForm.staff_id} onChange={e => setEditTaskForm({ ...editTaskForm, staff_id: e.target.value })} style={{ fontSize: 12 }}>
                                    <option value="">Unassigned</option>
                                    {staffList.filter(s => s.active && s.role === 'staff').map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>🔄 Repeat</label>
                                <select className="input-field" value={editTaskForm.recurrence} onChange={e => setEditTaskForm({ ...editTaskForm, recurrence: e.target.value })} style={{ fontSize: 12 }}>
                                    {RECURRENCE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                                </select>
                            </div>
                            {editTaskForm.recurrence !== 'none' && (
                                <div>
                                    <label style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Repeat End Date</label>
                                    <input className="input-field" type="date" value={editTaskForm.recurrence_end} onChange={e => setEditTaskForm({ ...editTaskForm, recurrence_end: e.target.value })} style={{ fontSize: 12, colorScheme: 'dark' }} />
                                </div>
                            )}
                        </div>
                        <button onClick={saveTaskEdit} className="btn-primary" style={{ width: '100%', padding: '10px', fontSize: 13, marginBottom: 20 }}>💾 Save Changes</button>

                        {/* Comments Thread */}
                        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 16 }}>
                            <h4 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>💬 Comments ({taskComments.length})</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', marginBottom: 12 }}>
                                {taskComments.length === 0 ? (
                                    <p style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>No comments yet. Start the conversation!</p>
                                ) : taskComments.map(c => {
                                    const staffInfo = c.staff as any;
                                    const isAdmin = staffInfo?.role === 'admin';
                                    return (
                                        <div key={c.id} style={{ background: isAdmin ? 'rgba(240,180,39,0.06)' : '#111', border: `1px solid ${isAdmin ? 'rgba(240,180,39,0.15)' : '#222'}`, borderRadius: 10, padding: 10 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <span style={{ fontSize: 12, fontWeight: 600, color: isAdmin ? '#f0b427' : '#fff' }}>
                                                    {staffInfo?.name || 'Unknown'} {isAdmin && <span style={{ fontSize: 10, color: '#888' }}>Admin</span>}
                                                </span>
                                                <span style={{ fontSize: 10, color: '#555' }}>
                                                    {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            {c.content && <p style={{ color: '#ccc', fontSize: 13, margin: 0, lineHeight: 1.4 }}>{c.content}</p>}
                                            {c.attachment_url && (
                                                <div style={{ marginTop: 6 }}>
                                                    <img src={c.attachment_url} alt="attachment" style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, border: '1px solid #333', cursor: 'pointer' }} onClick={() => window.open(c.attachment_url!, '_blank')} />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Comment Input */}
                            {commentPreview && (
                                <div style={{ position: 'relative', marginBottom: 8 }}>
                                    <img src={commentPreview} alt="preview" style={{ maxHeight: 100, borderRadius: 8, border: '1px solid #333' }} />
                                    <button onClick={() => { setCommentFile(null); setCommentPreview(null); }} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input type="file" ref={commentFileRef} accept="image/*" onChange={handleCommentFile} style={{ display: 'none' }} />
                                <button onClick={() => commentFileRef.current?.click()} title="Attach image" style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, padding: '8px 10px', color: '#818cf8', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>📎</button>
                                <input className="input-field" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Write a comment..." onKeyDown={e => e.key === 'Enter' && !e.shiftKey && postComment()} style={{ flex: 1, minWidth: 0, width: 'auto', fontSize: 12, padding: '8px 12px' }} />
                                <button onClick={postComment} disabled={commentSending || (!commentText.trim() && !commentFile)} className="btn-primary" style={{ width: 'auto', padding: '8px 14px', fontSize: 12, flexShrink: 0 }}>
                                    {commentSending ? '...' : '📤'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                @media (max-width: 768px) {
                    .tasks-grid { grid-template-columns: 1fr !important; }
                    .tasks-library-panel { display: ${activePanel === 'library' ? 'block' : 'none'} !important; }
                    .tasks-assignments-panel { display: ${activePanel === 'library' ? 'block' : 'none'} !important; }
                    .tasks-board-panel { display: ${activePanel === 'assignments' ? 'block' : 'none'} !important; }
                    .board-columns { flex-direction: column !important; }
                    .board-columns > div { min-width: 100% !important; max-width: 100% !important; flex: 1 1 auto !important; max-height: none !important; }
                }
                @media (min-width: 769px) {
                    .mobile-panel-tabs { display: flex !important; }
                    .tasks-library-panel { display: ${activePanel === 'library' ? 'block' : 'none'} !important; }
                    .tasks-assignments-panel { display: ${activePanel === 'library' ? 'block' : 'none'} !important; }
                    .tasks-board-panel { display: ${activePanel === 'assignments' ? 'block' : 'none'} !important; }
                }
                .board-columns::-webkit-scrollbar { height: 6px; }
                .board-columns::-webkit-scrollbar-track { background: transparent; }
                .board-columns::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
            `}</style>
        </div>
    );
}


// ═══════════════════════════════════════════════════
//  MONITOR PANEL
// ═══════════════════════════════════════════════════

interface MonitorAssignment {
    id: string;
    shift_date: string;
    status: string;
    derived_status: string;
    staff: { id: string; name: string; staff_code: string };
    shift_definition: { id: string; name: string; start_time: string; end_time: string; color: string };
    time_log: { id: string; check_in: string; check_out: string | null; late_minutes: number; check_in_flag: string; net_work_minutes: number | null } | null;
    active_break: { id: string; break_start: string } | null;
}

interface ComplianceFlag {
    id: string;
    staff_id: string;
    flag_type: string;
    severity: string;
    details: Record<string, unknown>;
    created_at: string;
    resolved_at: string | null;
    staff?: { name: string };
}

function MonitorPanel({ adminId }: { adminId: string }) {
    const [assignments, setAssignments] = useState<MonitorAssignment[]>([]);
    const [flags, setFlags] = useState<ComplianceFlag[]>([]);
    const [summary, setSummary] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [monitorError, setMonitorError] = useState('');
    const [now, setNow] = useState(new Date());
    const [overrideModal, setOverrideModal] = useState<{ type: string; staffId: string; staffName: string; timeLogId?: string; breakId?: string } | null>(null);
    const [overrideReason, setOverrideReason] = useState('');
    const [overrideSaving, setOverrideSaving] = useState(false);
    const edgeFnBase = EDGE_FUNCTIONS_BASE_URL;
    const todayStr = new Date().toISOString().slice(0, 10);

    const fetchMonitor = useCallback(async () => {
        if (!edgeFnBase) {
            setAssignments([]);
            setFlags([]);
            setSummary({});
            setMonitorError('Missing NEXT_PUBLIC_SUPABASE_URL. Monitor endpoint is not configured.');
            setLoading(false);
            return;
        }
        try {
            setMonitorError('');
            const res = await fetch(`${edgeFnBase}/monitor-status?date=${todayStr}`);
            let payload: Record<string, unknown> = {};
            let message = '';
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                try {
                    payload = (await res.json()) as Record<string, unknown>;
                } catch {
                    message = 'Invalid monitor response payload.';
                }
            } else {
                try {
                    const text = await res.text();
                    message = text.trim() || 'Monitor endpoint returned an empty response.';
                } catch {
                    message = 'Could not read monitor endpoint response.';
                }
            }
            if (!res.ok) {
                setAssignments([]);
                setFlags([]);
                setSummary({});
                setMonitorError((payload.error as string) || message || 'Failed to load monitor data.');
                return;
            }

            setAssignments((payload.assignments as MonitorAssignment[]) || []);
            setFlags((payload.flags as ComplianceFlag[]) || []);
            setSummary((payload.summary as Record<string, number>) || {});
        } catch {
            setAssignments([]);
            setFlags([]);
            setSummary({});
            setMonitorError('Monitor endpoint request failed. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [edgeFnBase, todayStr]);

    useEffect(() => {
        fetchMonitor();
        const interval = setInterval(() => { fetchMonitor(); setNow(new Date()); }, 30000);
        const tick = setInterval(() => setNow(new Date()), 1000);
        return () => { clearInterval(interval); clearInterval(tick); };
    }, [fetchMonitor]);

    function breakDuration(startIso: string) {
        const secs = Math.floor((now.getTime() - new Date(startIso).getTime()) / 1000);
        const m = Math.floor(secs / 60), s = secs % 60;
        return `${m}m ${s.toString().padStart(2, '0')}s`;
    }

    function statusColor(status: string) {
        switch (status) {
            case 'active': return '#22c55e';
            case 'on_break': return '#f59e0b';
            case 'missed': return '#ef4444';
            case 'completed': return '#3b82f6';
            case 'late': return '#f97316';
            default: return '#666';
        }
    }
    function statusLabel(status: string, lateMin = 0) {
        switch (status) {
            case 'active': return lateMin > 0 ? `⚠️ Late (${lateMin}m)` : '✅ Checked In';
            case 'on_break': return '☕ On Break';
            case 'missed': return '❌ Missed';
            case 'completed': return '🏁 Completed';
            case 'scheduled': return '🕐 Scheduled';
            case 'cancelled': return '🚫 Cancelled';
            default: return status;
        }
    }

    async function doOverride() {
        if (!overrideReason.trim() || !overrideModal) return;
        setOverrideSaving(true);
        const { type, staffId, timeLogId } = overrideModal;

        if (type === 'force_checkout' && timeLogId) {
            const serverNow = new Date().toISOString();
            // Get the open log to compute hours
            const { data: log } = await supabase.from('time_logs').select('check_in').eq('id', timeLogId).single();
            const totalHours = log ? Number(((Date.now() - new Date(log.check_in).getTime()) / 3600000).toFixed(2)) : 0;
            await supabase.from('time_logs').update({
                check_out: serverNow, original_check_out: serverNow,
                total_hours: totalHours, edited_by: adminId, edit_reason: overrideReason,
                check_out_flag: 'on_time',
            }).eq('id', timeLogId);
            // Update shift assignment
            await supabase.from('shift_assignments').update({ status: 'completed' }).eq('time_log_id' as never, timeLogId);
            // Audit log
            await supabase.from('audit_logs').insert({
                admin_id: adminId, action: 'force_checkout', target_staff_id: staffId,
                details: { time_log_id: timeLogId, reason: overrideReason },
            });
        }

        if (type === 'close_break' && overrideModal.breakId) {
            const serverNow = new Date().toISOString();
            const { data: brk } = await supabase.from('breaks').select('break_start').eq('id', overrideModal.breakId).single();
            const durationMinutes = brk ? Math.round((Date.now() - new Date(brk.break_start).getTime()) / 60000) : 0;
            await supabase.from('breaks').update({ break_end: serverNow, duration_minutes: durationMinutes }).eq('id', overrideModal.breakId);
            await supabase.from('audit_logs').insert({
                admin_id: adminId, action: 'close_break', target_staff_id: staffId,
                details: { break_id: overrideModal.breakId, reason: overrideReason },
            });
        }

        setOverrideModal(null);
        setOverrideReason('');
        setOverrideSaving(false);
        fetchMonitor();
    }

    async function resolveFlag(flagId: string) {
        await supabase.from('compliance_flags').update({ resolved_at: new Date().toISOString(), resolved_by: adminId }).eq('id', flagId);
        fetchMonitor();
    }

    const unresolvedFlags = flags.filter(f => !f.resolved_at);
    const severityColor = (s: string) => s === 'critical' ? '#ef4444' : s === 'warning' ? '#f59e0b' : '#3b82f6';
    const flagLabel = (t: string) => ({ late_checkin: 'Late Check-In', early_checkout: 'Early Checkout', break_overage: 'Break Overage', missed_checkout: 'Missed Checkout' }[t] || t);

    return (
        <div className="animate-fadeIn">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h2 style={styles.sectionTitle}>📡 Real-Time Monitor</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: '#555', fontSize: 12 }}>Auto-refresh every 30s</span>
                    <button onClick={fetchMonitor} style={{ background: '#222', border: '1px solid #333', borderRadius: 8, padding: '6px 14px', color: '#ccc', cursor: 'pointer', fontSize: 12 }}>↻ Refresh</button>
                </div>
            </div>

            {/* Summary Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 24 }}>
                {[
                    { label: 'Scheduled', val: summary.scheduled || 0, color: '#666' },
                    { label: 'Checked In', val: summary.active || 0, color: '#22c55e' },
                    { label: 'On Break', val: summary.on_break || 0, color: '#f59e0b' },
                    { label: 'Late', val: summary.late || 0, color: '#f97316' },
                    { label: 'Missed', val: summary.missed || 0, color: '#ef4444' },
                    { label: 'Completed', val: summary.completed || 0, color: '#3b82f6' },
                ].map(({ label, val, color }) => (
                    <div key={label} style={{ background: '#1a1a1a', border: `1px solid ${color}33`, borderRadius: 12, padding: '14px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 26, fontWeight: 800, color }}>{val}</div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{label}</div>
                    </div>
                ))}
            </div>

            {monitorError && (
                <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 13 }}>
                    ⚠️ {monitorError}
                </div>
            )}

            {/* Staff Cards */}
            {loading ? (
                <p style={{ color: '#555', textAlign: 'center', padding: 40 }}>Loading...</p>
            ) : assignments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#444' }}>
                    <p style={{ fontSize: 32, marginBottom: 8 }}>📅</p>
                    <p style={{ fontSize: 14 }}>No shifts scheduled for today.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 28 }}>
                    {assignments.map(sa => {
                        const color = statusColor(sa.derived_status);
                        const lateMin = sa.time_log?.late_minutes || 0;
                        return (
                            <div key={sa.id} style={{ background: '#1a1a1a', border: `1px solid ${color}40`, borderRadius: 16, padding: 18, position: 'relative' }}>
                                {/* Color bar */}
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '16px 16px 0 0' }} />

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, marginTop: 4 }}>
                                    <div>
                                        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{sa.staff?.name || 'Unknown'}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: sa.shift_definition?.color || '#f0b427' }} />
                                            <span style={{ color: '#888', fontSize: 12 }}>{sa.shift_definition?.name} · {sa.shift_definition?.start_time?.slice(0, 5)}–{sa.shift_definition?.end_time?.slice(0, 5)}</span>
                                        </div>
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 600, color, background: `${color}18`, borderRadius: 20, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                                        {statusLabel(sa.derived_status, lateMin)}
                                    </span>
                                </div>

                                {sa.time_log?.check_in && (
                                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#666', marginBottom: 8 }}>
                                        <span>🕐 In: {new Date(sa.time_log.check_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                        {sa.time_log.check_out && <span>Out: {new Date(sa.time_log.check_out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>}
                                    </div>
                                )}

                                {/* Live break timer */}
                                {sa.active_break && (
                                    <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
                                        <span style={{ color: '#f59e0b', fontSize: 12, fontWeight: 600 }}>☕ Break: {breakDuration(sa.active_break.break_start)}</span>
                                    </div>
                                )}

                                {/* Override actions */}
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                    {(sa.derived_status === 'active' || sa.derived_status === 'on_break') && sa.time_log && (
                                        <button
                                            onClick={() => setOverrideModal({ type: 'force_checkout', staffId: sa.staff.id, staffName: sa.staff.name, timeLogId: sa.time_log!.id })}
                                            style={{ fontSize: 11, padding: '5px 10px', background: '#ef444422', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', cursor: 'pointer' }}
                                        >Force Checkout</button>
                                    )}
                                    {sa.derived_status === 'on_break' && sa.active_break && (
                                        <button
                                            onClick={() => setOverrideModal({ type: 'close_break', staffId: sa.staff.id, staffName: sa.staff.name, breakId: sa.active_break!.id })}
                                            style={{ fontSize: 11, padding: '5px 10px', background: '#f59e0b22', border: '1px solid #f59e0b', borderRadius: 8, color: '#f59e0b', cursor: 'pointer' }}
                                        >Close Break</button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Compliance Flags */}
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0 }}>
                        🚨 Compliance Alerts
                        {unresolvedFlags.length > 0 && (
                            <span style={{ marginLeft: 8, background: '#ef4444', color: '#fff', fontSize: 11, borderRadius: 20, padding: '2px 8px' }}>{unresolvedFlags.length}</span>
                        )}
                    </h3>
                </div>
                {unresolvedFlags.length === 0 ? (
                    <p style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>✅ No open compliance alerts today.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {unresolvedFlags.map(f => (
                            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', border: `1px solid ${severityColor(f.severity)}33`, borderRadius: 10, padding: '10px 14px' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: severityColor(f.severity), textTransform: 'uppercase', background: `${severityColor(f.severity)}18`, borderRadius: 20, padding: '2px 8px' }}>{f.severity}</span>
                                        <span style={{ color: '#ccc', fontSize: 13, fontWeight: 600 }}>{flagLabel(f.flag_type)}</span>
                                        <span style={{ color: '#555', fontSize: 11 }}>· {f.staff?.name}</span>
                                    </div>
                                    {f.details && Object.keys(f.details).length > 0 && (
                                        <div style={{ color: '#666', fontSize: 11 }}>{JSON.stringify(f.details)}</div>
                                    )}
                                    <div style={{ color: '#444', fontSize: 10, marginTop: 2 }}>{new Date(f.created_at).toLocaleTimeString()}</div>
                                </div>
                                <button onClick={() => resolveFlag(f.id)} style={{ fontSize: 11, padding: '5px 12px', background: '#22c55e22', border: '1px solid #22c55e', borderRadius: 8, color: '#22c55e', cursor: 'pointer', marginLeft: 10, flexShrink: 0 }}>Resolve</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Override Modal */}
            {overrideModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 400, width: '100%', padding: 24 }}>
                        <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                            {overrideModal.type === 'force_checkout' ? '🔴 Force Check-Out' : '☕ Close Break'}
                        </h3>
                        <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>Staff: <strong style={{ color: '#ccc' }}>{overrideModal.staffName}</strong></p>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Reason (required)</label>
                        <textarea
                            className="input-field"
                            rows={3}
                            value={overrideReason}
                            onChange={e => setOverrideReason(e.target.value)}
                            placeholder="Explain the reason for this override..."
                            style={{ resize: 'vertical', marginBottom: 16 }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={doOverride} disabled={!overrideReason.trim() || overrideSaving} className="btn-primary" style={{ flex: 1, padding: 12 }}>
                                {overrideSaving ? 'Saving...' : 'Confirm Override'}
                            </button>
                            <button onClick={() => { setOverrideModal(null); setOverrideReason(''); }} className="btn-secondary" style={{ padding: '12px 20px' }}>Cancel</button>
                        </div>
                        <p style={{ color: '#555', fontSize: 11, marginTop: 10, textAlign: 'center' }}>This action is logged in the audit trail.</p>
                    </div>
                </div>
            )}
        </div>
    );
}


interface LateAttendanceNotification {
    id: string;
    shift_date: string;
    status: string;
    sent_at: string | null;
    error_message: string | null;
    created_at: string;
    staff?: { name: string; staff_code: string } | { name: string; staff_code: string }[] | null;
}

interface LateAttendanceReason {
    id: string;
    reason_text: string;
    source: string;
    submitted_at: string;
    shift_date?: string;
    staff?: { name: string; staff_code: string } | { name: string; staff_code: string }[] | null;
}

function LateAttendancePanel() {
    const [notifications, setNotifications] = useState<LateAttendanceNotification[]>([]);
    const [reasons, setReasons] = useState<LateAttendanceReason[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchLateAttendanceData = useCallback(async () => {
        setLoading(true);
        const today = new Date().toISOString().slice(0, 10);

        const [{ data: notifData }, { data: reasonData }] = await Promise.all([
            supabase
                .from('late_attendance_notifications')
                .select('id, shift_date, status, sent_at, error_message, created_at, staff:staff(id, name, staff_code)')
                .eq('shift_date', today)
                .order('created_at', { ascending: false })
                .limit(50),
            supabase
                .from('late_attendance_reasons')
                .select('id, reason_text, source, submitted_at, shift_date:reason_date, staff:staff(id, name, staff_code)')
                .eq('reason_date', today)
                .order('submitted_at', { ascending: false })
                .limit(50),
        ]);

        setNotifications((notifData || []) as LateAttendanceNotification[]);
        setReasons((reasonData || []) as LateAttendanceReason[]);
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchLateAttendanceData();
    }, [fetchLateAttendanceData]);

    const firstStaff = (
        staff: LateAttendanceNotification['staff'] | LateAttendanceReason['staff'],
    ) => (Array.isArray(staff) ? staff[0] : staff);

    const badgeStyle = (status: string) => {
        if (status === 'sent') return { color: '#22c55e', background: 'rgba(34,197,94,0.12)' };
        if (status === 'failed') return { color: '#ef4444', background: 'rgba(239,68,68,0.12)' };
        return { color: '#f59e0b', background: 'rgba(245,158,11,0.12)' };
    };

    return (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0 }}>📲 Late Attendance Follow-up</h3>
                <button onClick={fetchLateAttendanceData} className="btn-secondary" style={{ width: 'auto', padding: '8px 14px', fontSize: 12 }}>
                    Refresh
                </button>
            </div>

            {loading ? (
                <p style={{ color: '#666', fontSize: 13 }}>Loading late attendance data...</p>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: 12 }}>
                        <h4 style={{ color: '#ddd', fontSize: 13, margin: '0 0 10px' }}>SMS Notifications (Today)</h4>
                        {notifications.length === 0 ? (
                            <p style={{ color: '#555', fontSize: 12, margin: 0 }}>No late SMS records yet.</p>
                        ) : notifications.map(item => {
                            const staff = firstStaff(item.staff);
                            const style = badgeStyle(item.status);
                            return (
                                <div key={item.id} style={{ borderBottom: '1px solid #1f1f1f', padding: '8px 0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                        <div style={{ color: '#ccc', fontSize: 12 }}>
                                            {staff?.name || 'Unknown'} ({staff?.staff_code || 'N/A'})
                                        </div>
                                        <span style={{ fontSize: 11, borderRadius: 999, padding: '3px 8px', ...style }}>{item.status}</span>
                                    </div>
                                    <div style={{ color: '#666', fontSize: 11, marginTop: 3 }}>
                                        {item.sent_at ? `Sent ${new Date(item.sent_at).toLocaleTimeString()}` : 'Pending send'}
                                        {item.error_message ? ` · ${item.error_message}` : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: 12 }}>
                        <h4 style={{ color: '#ddd', fontSize: 13, margin: '0 0 10px' }}>Late Reasons Submitted (Today)</h4>
                        {reasons.length === 0 ? (
                            <p style={{ color: '#555', fontSize: 12, margin: 0 }}>No reasons submitted today.</p>
                        ) : reasons.map(item => {
                            const staff = firstStaff(item.staff);
                            return (
                                <div key={item.id} style={{ borderBottom: '1px solid #1f1f1f', padding: '8px 0' }}>
                                    <div style={{ color: '#ccc', fontSize: 12 }}>
                                        {staff?.name || 'Unknown'} ({staff?.staff_code || 'N/A'})
                                    </div>
                                    <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>
                                        {new Date(item.submitted_at).toLocaleTimeString()} · {item.source}
                                    </div>
                                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{item.reason_text}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}


interface ShiftDefinition {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
    color: string;
    created_at: string;
    shift_type: string;
    early_checkin_minutes: number;
    late_grace_minutes: number;
    early_checkout_minutes: number;
    late_tolerance_minutes: number;
    block_outside_window: boolean;
    published: boolean;
}

interface ShiftAssignment {
    id: string;
    shift_definition_id: string;
    staff_id: string;
    shift_date: string;
    break_minutes_allowed: number;
    time_log_id?: string | null;
    shift_definition?: ShiftDefinition;
    staff?: { id: string; name: string; staff_code: string };
}

interface ShiftTemplateDay {
    id: string;
    shift_definition_id: string;
    day_of_week: number;
    active: boolean;
}

function ShiftsPanel({ staffList }: { staffList: Staff[] }) {
    const [shiftDefs, setShiftDefs] = useState<ShiftDefinition[]>([]);
    const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
    const [formDateAssignments, setFormDateAssignments] = useState<ShiftAssignment[]>([]);
    const [templateDays, setTemplateDays] = useState<ShiftTemplateDay[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [editingShift, setEditingShift] = useState<ShiftDefinition | null>(null);
    const [editingAssignment, setEditingAssignment] = useState<ShiftAssignment | null>(null);
    const [formError, setFormError] = useState('');
    const [form, setForm] = useState({
        name: '', start_time: '09:00', end_time: '17:00', color: '#f0b427',
        shift_type: 'normal',
        shift_date: new Date().toISOString().slice(0, 10),
        staff_id: '',
        break_minutes_allowed: 60,
        early_checkin_minutes: 15,
        late_grace_minutes: 10,
        early_checkout_minutes: 0,
        late_tolerance_minutes: 30,
        block_outside_window: false,
        published: false,
    });
    const [saving, setSaving] = useState(false);
    const [weekOffset, setWeekOffset] = useState(0);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState('');
    const [deletingShift, setDeletingShift] = useState(false);

    const activeStaff = staffList.filter(s => s.active && s.role === 'staff');

    function toMinutes(time: string): number {
        const [hours, mins] = (time || '00:00').split(':').map(Number);
        return ((Number.isFinite(hours) ? hours : 0) * 60) + (Number.isFinite(mins) ? mins : 0);
    }

    function normalizeTimeRanges(startTime: string, endTime: string): Array<{ start: number; end: number }> {
        const start = toMinutes(startTime);
        const end = toMinutes(endTime);
        if (end > start) return [{ start, end }];
        if (end < start) return [{ start, end: 24 * 60 }, { start: 0, end }];
        return [{ start, end: 24 * 60 }];
    }

    function hasTimeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
        const aRanges = normalizeTimeRanges(aStart, aEnd);
        const bRanges = normalizeTimeRanges(bStart, bEnd);
        return aRanges.some(a => bRanges.some(b => Math.max(a.start, b.start) < Math.min(a.end, b.end)));
    }

    function hasAssignmentConflict(
        staffId: string,
        date: string,
        startTime: string,
        endTime: string,
        ignoreAssignmentId?: string,
        sourceAssignments: ShiftAssignment[] = assignments
    ): boolean {
        return sourceAssignments.some(assignment => {
            if (assignment.staff_id !== staffId) return false;
            if (assignment.shift_date !== date) return false;
            if (assignment.id === ignoreAssignmentId) return false;
            const definition = assignment.shift_definition;
            if (!definition) return false;
            return hasTimeOverlap(startTime, endTime, definition.start_time, definition.end_time);
        });
    }

    const availableStaff = activeStaff.filter(staff => !hasAssignmentConflict(
        staff.id,
        form.shift_date,
        form.start_time,
        form.end_time,
        editingAssignment?.id,
        formDateAssignments
    ));

    // Get week dates
    const getWeekDates = useCallback(() => {
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
        monday.setHours(0, 0, 0, 0);
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            return d.toISOString().slice(0, 10);
        });
    }, [weekOffset]);

    const weekDates = getWeekDates();
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];

    const fetchShiftDefs = useCallback(async () => {
        const { data } = await supabase.from('shift_definitions').select('*').order('start_time');
        if (data) setShiftDefs(data);
    }, []);

    const fetchAssignments = useCallback(async () => {
        const { data } = await supabase
            .from('shift_assignments')
            .select('*, shift_definition:shift_definitions(*), staff:staff(id, name, staff_code)')
            .gte('shift_date', weekStart)
            .lte('shift_date', weekEnd);
        if (data) setAssignments(data);
    }, [weekStart, weekEnd]);

    useEffect(() => { fetchShiftDefs(); }, [fetchShiftDefs]);
    useEffect(() => { fetchAssignments(); }, [fetchAssignments]);
    useEffect(() => {
        if (!showForm || !form.shift_date) {
            setFormDateAssignments([]);
            return;
        }
        let active = true;
        (async () => {
            const { data } = await supabase
                .from('shift_assignments')
                .select('id, shift_definition_id, staff_id, shift_date, break_minutes_allowed, shift_definition:shift_definitions(*)')
                .eq('shift_date', form.shift_date);
            if (!active) return;
            const normalized = (data || []).map((row: any) => ({
                ...row,
                shift_definition: Array.isArray(row.shift_definition) ? row.shift_definition[0] : row.shift_definition,
            })) as ShiftAssignment[];
            setFormDateAssignments(normalized);
        })();
        return () => { active = false; };
    }, [showForm, form.shift_date]);

    async function saveShiftDef(e: React.FormEvent) {
        e.preventDefault();
        setFormError('');
        const isDefinitionEditMode = Boolean(editingShift && !editingAssignment);
        if (isDefinitionEditMode && Boolean(form.staff_id) !== Boolean(form.shift_date)) {
            setFormError('Select both a staff member and a date to add or update an assignment, or clear both to only update the shift template.');
            return;
        }
        const wantsAssignment = !isDefinitionEditMode || Boolean(form.staff_id && form.shift_date);
        if (wantsAssignment) {
            if (!form.staff_id || !form.shift_date) {
                setFormError('Please select a staff member and shift date.');
                return;
            }
            const ignoreId =
                editingAssignment?.id
                ?? assignments.find(
                    a =>
                        a.shift_definition_id === (editingAssignment?.shift_definition_id || editingShift?.id || '')
                        && a.staff_id === form.staff_id
                        && a.shift_date === form.shift_date,
                )?.id
                ?? formDateAssignments.find(
                    a =>
                        a.shift_definition_id === (editingAssignment?.shift_definition_id || editingShift?.id || '')
                        && a.staff_id === form.staff_id
                        && a.shift_date === form.shift_date,
                )?.id;
            if (hasAssignmentConflict(form.staff_id, form.shift_date, form.start_time, form.end_time, ignoreId, formDateAssignments)) {
                setFormError('Selected staff already has an overlapping shift on this date.');
                return;
            }
        }
        setSaving(true);
        const payload = {
            name: form.name, start_time: form.start_time, end_time: form.end_time, color: form.color,
            shift_type: form.shift_type,
            early_checkin_minutes: form.early_checkin_minutes,
            late_grace_minutes: form.late_grace_minutes,
            early_checkout_minutes: form.early_checkout_minutes,
            late_tolerance_minutes: form.late_tolerance_minutes,
            block_outside_window: form.block_outside_window,
            published: form.published,
        };
        try {
            let shiftDefinitionId = editingAssignment?.shift_definition_id || editingShift?.id || null;
            if (shiftDefinitionId) {
                const { error } = await supabase.from('shift_definitions').update(payload).eq('id', shiftDefinitionId);
                if (error) {
                    setFormError(error.message);
                    setSaving(false);
                    return;
                }
            } else {
                const { data, error } = await supabase
                    .from('shift_definitions')
                    .insert(payload)
                    .select('id')
                    .single();
                if (error || !data) {
                    setFormError(error?.message || 'Could not create shift definition.');
                    setSaving(false);
                    return;
                }
                shiftDefinitionId = data.id;
            }

            if (wantsAssignment && shiftDefinitionId) {
                const assignmentPayload = {
                    shift_definition_id: shiftDefinitionId,
                    staff_id: form.staff_id,
                    shift_date: form.shift_date,
                    break_minutes_allowed: Math.max(0, Math.floor(form.break_minutes_allowed)),
                };

                let targetAssignmentId = editingAssignment?.id ?? null;
                if (!targetAssignmentId) {
                    const match =
                        assignments.find(
                            a =>
                                a.shift_definition_id === shiftDefinitionId
                                && a.staff_id === form.staff_id
                                && a.shift_date === form.shift_date,
                        )
                        ?? formDateAssignments.find(
                            a =>
                                a.shift_definition_id === shiftDefinitionId
                                && a.staff_id === form.staff_id
                                && a.shift_date === form.shift_date,
                        );
                    targetAssignmentId = match?.id ?? null;
                }

                if (targetAssignmentId) {
                    const { error } = await supabase
                        .from('shift_assignments')
                        .update(assignmentPayload)
                        .eq('id', targetAssignmentId);
                    if (error) {
                        setFormError(error.message);
                        setSaving(false);
                        return;
                    }
                } else {
                    const { error } = await supabase.from('shift_assignments').insert(assignmentPayload);
                    if (error) {
                        setFormError(error.message);
                        setSaving(false);
                        return;
                    }
                }
            }
        } finally {
            setSaving(false);
        }

        setShowForm(false);
        setEditingShift(null);
        setEditingAssignment(null);
        setForm({
            name: '', start_time: '09:00', end_time: '17:00', color: '#f0b427', shift_type: 'normal',
            shift_date: new Date().toISOString().slice(0, 10), staff_id: '', break_minutes_allowed: 60,
            early_checkin_minutes: 15, late_grace_minutes: 10, early_checkout_minutes: 0, late_tolerance_minutes: 30,
            block_outside_window: false, published: false
        });
        fetchShiftDefs();
        fetchAssignments();
    }

    async function deleteShiftDef(id: string) {
        if (!id) return;
        setDeleteError('');
        setDeletingShift(true);
        const { error } = await supabase.from('shift_definitions').delete().eq('id', id);
        if (error) {
            setDeleteError(error.message || 'Could not delete shift.');
            setDeletingShift(false);
            return;
        }
        if (selectedShiftId === id) setSelectedShiftId(null);
        setDeleteId(null);
        await Promise.all([fetchShiftDefs(), fetchAssignments()]);
        setDeletingShift(false);
    }

    async function toggleAssignment(shiftDefId: string, staffId: string, date: string) {
        const currentShift = shiftDefs.find(sd => sd.id === shiftDefId);
        const existing = assignments.find(
            a => a.shift_definition_id === shiftDefId && a.staff_id === staffId && a.shift_date === date
        );
        if (existing) {
            await supabase.from('shift_assignments').delete().eq('id', existing.id);
        } else {
            if (currentShift && hasAssignmentConflict(staffId, date, currentShift.start_time, currentShift.end_time)) {
                return;
            }
            await supabase.from('shift_assignments').insert({
                shift_definition_id: shiftDefId, staff_id: staffId, shift_date: date,
                break_minutes_allowed: 60,
            });
        }
        fetchAssignments();
    }

    function openCreateShiftForm() {
        setFormError('');
        setDeleteError('');
        setShowForm(true);
        setEditingShift(null);
        setEditingAssignment(null);
        setForm({
            name: '', start_time: '09:00', end_time: '17:00', color: '#f0b427', shift_type: 'normal',
            shift_date: new Date().toISOString().slice(0, 10), staff_id: '', break_minutes_allowed: 60,
            early_checkin_minutes: 15, late_grace_minutes: 10, early_checkout_minutes: 0, late_tolerance_minutes: 30,
            block_outside_window: false, published: false
        });
    }

    function openEditAssignmentForm(assignment: ShiftAssignment) {
        const shift = assignment.shift_definition;
        if (!shift) return;
        setFormError('');
        setEditingShift(shift);
        setEditingAssignment(assignment);
        setForm({
            name: shift.name,
            start_time: shift.start_time.slice(0, 5),
            end_time: shift.end_time.slice(0, 5),
            color: shift.color,
            shift_type: shift.shift_type || 'normal',
            shift_date: assignment.shift_date,
            staff_id: assignment.staff_id,
            break_minutes_allowed: assignment.break_minutes_allowed ?? 60,
            early_checkin_minutes: shift.early_checkin_minutes ?? 15,
            late_grace_minutes: shift.late_grace_minutes ?? 10,
            early_checkout_minutes: shift.early_checkout_minutes ?? 0,
            late_tolerance_minutes: shift.late_tolerance_minutes ?? 30,
            block_outside_window: shift.block_outside_window ?? false,
            published: shift.published ?? false
        });
        setShowForm(true);
    }

    function openEditShiftForm(shift: ShiftDefinition) {
        setFormError('');
        setEditingAssignment(null);
        setEditingShift(shift);
        setForm({
            name: shift.name,
            start_time: shift.start_time.slice(0, 5),
            end_time: shift.end_time.slice(0, 5),
            color: shift.color,
            shift_type: shift.shift_type || 'normal',
            shift_date: '',
            staff_id: '',
            break_minutes_allowed: 60,
            early_checkin_minutes: shift.early_checkin_minutes,
            late_grace_minutes: shift.late_grace_minutes,
            early_checkout_minutes: shift.early_checkout_minutes,
            late_tolerance_minutes: shift.late_tolerance_minutes,
            block_outside_window: shift.block_outside_window,
            published: shift.published,
        });
        setShowForm(true);
    }

    async function copyWeekToNext() {
        const nextWeekDates = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekDates[0]);
            d.setDate(d.getDate() + 7 + i);
            return d.toISOString().slice(0, 10);
        });
        const inserts = assignments.map(a => ({
            shift_definition_id: a.shift_definition_id,
            staff_id: a.staff_id,
            shift_date: nextWeekDates[weekDates.indexOf(a.shift_date)] || nextWeekDates[new Date(a.shift_date).getDay() === 0 ? 6 : new Date(a.shift_date).getDay() - 1],
            break_minutes_allowed: a.break_minutes_allowed ?? 60,
        })).filter(ins => ins.shift_date);
        if (inserts.length > 0) {
            await supabase.from('shift_assignments').upsert(inserts, { onConflict: 'shift_definition_id,staff_id,shift_date' });
            setWeekOffset(weekOffset + 1);
        }
    }

    function getAssignment(shiftDefId: string, staffId: string, date: string) {
        return assignments.find(
            a => a.shift_definition_id === shiftDefId && a.staff_id === staffId && a.shift_date === date
        ) || null;
    }

    function getAssignedStaff(shiftDefId: string, date: string) {
        return assignments
            .filter(a => a.shift_definition_id === shiftDefId && a.shift_date === date)
            .map(a => activeStaff.find(s => s.id === a.staff_id))
            .filter(Boolean) as Staff[];
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const todayStr = new Date().toISOString().slice(0, 10);

    // Selected shift for scheduler
    const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
    useEffect(() => {
        if (shiftDefs.length > 0 && !selectedShiftId) setSelectedShiftId(shiftDefs[0].id);
    }, [shiftDefs, selectedShiftId]);

    const selectedShift = shiftDefs.find(s => s.id === selectedShiftId);
    const selectedTemplateDays = templateDays
        .filter(td => td.shift_definition_id === selectedShiftId && td.active)
        .map(td => td.day_of_week);

    const fetchTemplateDays = useCallback(async () => {
        const { data } = await supabase.from('shift_template_days').select('*');
        if (data) setTemplateDays(data);
    }, []);

    useEffect(() => { fetchTemplateDays(); }, [fetchTemplateDays]);

    async function toggleTemplateDay(dayOfWeek: number) {
        if (!selectedShiftId) return;
        const existing = templateDays.find(td => td.shift_definition_id === selectedShiftId && td.day_of_week === dayOfWeek);
        if (existing) {
            await supabase.from('shift_template_days').delete().eq('id', existing.id);
        } else {
            await supabase.from('shift_template_days').insert({
                shift_definition_id: selectedShiftId,
                day_of_week: dayOfWeek,
                active: true,
            });
        }
        fetchTemplateDays();
    }

    async function applyTemplateDaysToWeek() {
        if (!selectedShiftId || selectedTemplateDays.length === 0 || activeStaff.length === 0) return;
        const inserts: Array<{ shift_definition_id: string; staff_id: string; shift_date: string; break_minutes_allowed: number }> = [];
        for (const staff of activeStaff) {
            for (const date of weekDates) {
                const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
                if (selectedTemplateDays.includes(dayOfWeek)) {
                    inserts.push({
                        shift_definition_id: selectedShiftId,
                        staff_id: staff.id,
                        shift_date: date,
                        break_minutes_allowed: 60,
                    });
                }
            }
        }
        if (inserts.length > 0) {
            await supabase.from('shift_assignments').upsert(inserts, { onConflict: 'shift_definition_id,staff_id,shift_date' });
            fetchAssignments();
        }
    }

    return (
        <div className="animate-fadeIn">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h2 style={styles.sectionTitle}>Shift Management</h2>
                <button onClick={openCreateShiftForm} className="btn-primary" style={{ width: 'auto', padding: '10px 20px', fontSize: 13 }}>
                    + New Shift
                </button>
            </div>

            {/* Shift Definitions */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 28 }}>
                {shiftDefs.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 20px', color: '#666' }}>
                        <p style={{ fontSize: 32, marginBottom: 8 }}>📅</p>
                        <p style={{ fontSize: 14 }}>No shifts defined yet. Create your first shift to get started.</p>
                    </div>
                ) : shiftDefs.map(sd => (
                    <div key={sd.id} style={{
                        background: selectedShiftId === sd.id ? 'rgba(240,180,39,0.08)' : '#1a1a1a',
                        borderWidth: 1, borderStyle: 'solid',
                        borderColor: selectedShiftId === sd.id ? '#f0b427' : '#2a2a2a',
                        borderRadius: 14, padding: 16, cursor: 'pointer', transition: 'all 0.2s',
                    }} onClick={() => setSelectedShiftId(sd.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ width: 12, height: 12, borderRadius: '50%', background: sd.color, flexShrink: 0 }} />
                            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, flex: 1 }}>{sd.name}</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={e => { e.stopPropagation(); openEditShiftForm(sd); }} title="Edit shift" style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: 4 }}>✏️</button>
                                <button onClick={e => { e.stopPropagation(); setDeleteError(''); setDeleteId(sd.id); }} title="Delete shift" style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: 4 }}>🗑️</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#888' }}>
                            <span>🕐 {sd.start_time.slice(0, 5)}</span>
                            <span>→</span>
                            <span>{sd.end_time.slice(0, 5)}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Weekly Scheduler */}
            {selectedShift && (
                <div style={{ background: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2a2a', padding: 20, marginBottom: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: selectedShift.color }} />
                            <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0 }}>
                                {selectedShift.name} — {selectedShift.start_time.slice(0, 5)} to {selectedShift.end_time.slice(0, 5)}
                            </h3>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button onClick={() => setWeekOffset(weekOffset - 1)} style={{ background: '#222', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#ccc', cursor: 'pointer', fontSize: 13 }}>← Prev</button>
                            <button onClick={() => setWeekOffset(0)} style={{ background: weekOffset === 0 ? 'rgba(240,180,39,0.15)' : '#222', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: weekOffset === 0 ? '#f0b427' : '#ccc', cursor: 'pointer', fontSize: 13, fontWeight: weekOffset === 0 ? 700 : 400 }}>This Week</button>
                            <button onClick={() => setWeekOffset(weekOffset + 1)} style={{ background: '#222', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#ccc', cursor: 'pointer', fontSize: 13 }}>Next →</button>
                        </div>
                    </div>

                    <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                        <div style={{ color: '#888', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' as const, marginBottom: 8 }}>
                            Default Day Template (for quick weekly setup)
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {dayNames.map((name, i) => {
                                const dayOfWeek = i === 6 ? 0 : i + 1;
                                const isActive = selectedTemplateDays.includes(dayOfWeek);
                                return (
                                    <button
                                        key={name}
                                        onClick={() => toggleTemplateDay(dayOfWeek)}
                                        style={{
                                            padding: '6px 10px',
                                            borderRadius: 8,
                                            border: `1px solid ${isActive ? selectedShift.color : '#333'}`,
                                            background: isActive ? `${selectedShift.color}33` : '#171717',
                                            color: isActive ? '#fff' : '#888',
                                            fontSize: 12,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {name}
                                    </button>
                                );
                            })}
                            <button
                                onClick={applyTemplateDaysToWeek}
                                className="btn-secondary"
                                style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }}
                            >
                                Apply Template to Week
                            </button>
                        </div>
                    </div>

                    {/* Scheduler grid */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
                            <thead>
                                <tr>
                                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #2a2a2a', width: 140 }}>Staff</th>
                                    {weekDates.map((date, i) => {
                                        const isToday = date === todayStr;
                                        return (
                                            <th key={date} style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #2a2a2a', background: isToday ? 'rgba(240,180,39,0.06)' : 'transparent' }}>
                                                <div style={{ color: isToday ? '#f0b427' : '#888', fontSize: 11, fontWeight: 600 }}>{dayNames[i]}</div>
                                                <div style={{ color: isToday ? '#f0b427' : '#555', fontSize: 10 }}>{date.slice(5)}</div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {activeStaff.map(staff => (
                                    <tr key={staff.id}>
                                        <td style={{ padding: '8px 12px', color: '#ccc', fontSize: 13, fontWeight: 500, borderBottom: '1px solid #1f1f1f' }}>
                                            {staff.name}
                                        </td>
                                        {weekDates.map(date => {
                                            const assignment = getAssignment(selectedShift.id, staff.id, date);
                                            const assigned = !!assignment;
                                            const isToday = date === todayStr;
                                            const blockedByConflict = !assigned && hasAssignmentConflict(
                                                staff.id,
                                                date,
                                                selectedShift.start_time,
                                                selectedShift.end_time
                                            );
                                            return (
                                                <td key={date} style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #1f1f1f', background: isToday ? 'rgba(240,180,39,0.03)' : 'transparent' }}>
                                                    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                                        <button
                                                            onClick={() => toggleAssignment(selectedShift.id, staff.id, date)}
                                                            style={{
                                                                width: 36, height: 36, borderRadius: 10,
                                                                border: assigned ? 'none' : '2px dashed #333',
                                                                background: assigned ? selectedShift.color : 'transparent',
                                                                cursor: blockedByConflict ? 'not-allowed' : 'pointer', fontSize: 14,
                                                                transition: 'all 0.15s', opacity: blockedByConflict ? 0.25 : (assigned ? 1 : 0.5),
                                                                color: assigned ? '#000' : '#555',
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                            }}
                                                            title={blockedByConflict ? 'Conflicts with another shift' : (assigned ? 'Click to remove' : 'Click to assign')}
                                                            disabled={blockedByConflict}
                                                        >
                                                            {assigned ? '✓' : '+'}
                                                        </button>
                                                        {assignment && (
                                                            <button
                                                                onClick={() => openEditAssignmentForm(assignment)}
                                                                style={{
                                                                    background: '#1b1b1b',
                                                                    border: '1px solid #333',
                                                                    borderRadius: 6,
                                                                    color: '#999',
                                                                    fontSize: 10,
                                                                    padding: '4px 7px',
                                                                    cursor: 'pointer',
                                                                }}
                                                                title="Edit assignment"
                                                            >
                                                                Edit
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Copy week */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <button onClick={copyWeekToNext} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 12 }}>📋 Copy Week → Next Week</button>
                    </div>
                </div>
            )}

            {/* Day summary */}
            <div style={{ background: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2a2a', padding: 20 }}>
                <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>📋 Week Overview</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                    {weekDates.map((date, i) => {
                        const isToday = date === todayStr;
                        const dayAssignments = assignments.filter(a => a.shift_date === date);
                        return (
                            <div key={date} style={{
                                background: isToday ? 'rgba(240,180,39,0.06)' : '#111',
                                borderWidth: 1, borderStyle: 'solid',
                                borderColor: isToday ? 'rgba(240,180,39,0.3)' : '#222',
                                borderRadius: 12, padding: 12,
                            }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? '#f0b427' : '#888', marginBottom: 6 }}>
                                    {dayNames[i]} {date.slice(5)}
                                </div>
                                {dayAssignments.length === 0 ? (
                                    <p style={{ color: '#444', fontSize: 11, margin: 0 }}>No shifts</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {shiftDefs.map(sd => {
                                            const assigned = getAssignedStaff(sd.id, date);
                                            if (assigned.length === 0) return null;
                                            return (
                                                <div key={sd.id}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sd.color }} />
                                                        <span style={{ fontSize: 10, color: '#999', fontWeight: 600 }}>{sd.name}</span>
                                                    </div>
                                                    {assigned.map(s => {
                                                        const assignment = getAssignment(sd.id, s.id, date);
                                                        return (
                                                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 10 }}>
                                                                <div style={{ fontSize: 10, color: '#666' }}>{s.name}</div>
                                                                {assignment && assignment.break_minutes_allowed !== undefined && (
                                                                    <div style={{ fontSize: 9, background: '#333', color: '#aaa', padding: '2px 4px', borderRadius: 4, marginLeft: 4 }}>
                                                                        {assignment.break_minutes_allowed}m break
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {showForm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, overflowY: 'auto' }}>
                    <div className="card" style={{ maxWidth: 520, width: '100%', padding: 24, margin: 'auto' }}>
                        <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                            {editingShift && !editingAssignment ? '✏️ Edit Shift' : editingAssignment ? '✏️ Edit Shift Assignment' : '📅 New Shift Assignment'}
                        </h3>
                        {editingShift && !editingAssignment && (
                            <p style={{ color: '#777', fontSize: 12, margin: '0 0 16px', lineHeight: 1.45 }}>
                                Times and policy apply to every day this shift is used. Pick staff and date below to add or update that day&apos;s assignment and break budget—or leave them empty to only update the template.
                            </p>
                        )}
                        <form onSubmit={saveShiftDef}>
                            {/* Name + Type */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Shift Name</label>
                                    <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Morning" required />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Type</label>
                                    <select className="input-field" value={form.shift_type} onChange={e => setForm({ ...form, shift_type: e.target.value })} style={{ colorScheme: 'dark' }}>
                                        <option value="normal">Normal</option>
                                        <option value="opening">Opening</option>
                                        <option value="closing">Closing</option>
                                    </select>
                                </div>
                            </div>

                            {/* Times */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Start Time</label>
                                    <input className="input-field" type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} required style={{ colorScheme: 'dark' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>End Time</label>
                                    <input className="input-field" type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} required style={{ colorScheme: 'dark' }} />
                                </div>
                            </div>

                            {/* Date + Staff */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Shift Date</label>
                                    <input
                                        className="input-field"
                                        type="date"
                                        value={form.shift_date}
                                        onChange={e => setForm({ ...form, shift_date: e.target.value })}
                                        required={!Boolean(editingShift && !editingAssignment)}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Staff</label>
                                    <select
                                        className="input-field"
                                        value={form.staff_id}
                                        onChange={e => setForm({ ...form, staff_id: e.target.value })}
                                        required={!Boolean(editingShift && !editingAssignment)}
                                        style={{ colorScheme: 'dark' }}
                                    >
                                        <option value="">{editingShift && !editingAssignment ? '— Optional —' : 'Select available staff'}</option>
                                        {availableStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Break Budget */}
                            <div style={{ background: '#111', borderRadius: 12, padding: '12px 14px', marginBottom: 12, border: '1px solid #2a2a2a', opacity: editingShift && !editingAssignment && !(form.staff_id && form.shift_date) ? 0.55 : 1 }}>
                                <label style={{ fontSize: 12, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Max Break Time (min)</label>
                                <input
                                    className="input-field"
                                    type="number"
                                    min={0}
                                    max={300}
                                    value={form.break_minutes_allowed}
                                    onChange={e => setForm({ ...form, break_minutes_allowed: Number(e.target.value) })}
                                    disabled={Boolean(editingShift && !editingAssignment && !(form.staff_id && form.shift_date))}
                                    style={{ padding: '8px 10px', fontSize: 13, maxWidth: 140 }}
                                />
                                <p style={{ color: '#666', fontSize: 11, margin: '8px 0 0' }}>
                                    {editingShift && !editingAssignment && !(form.staff_id && form.shift_date)
                                        ? 'Choose staff and date above to set break minutes for that assignment.'
                                        : 'Staff can start/stop break multiple times until this total reaches 0.'}
                                </p>
                            </div>

                            {/* Time Window Policy */}
                            <div style={{ background: '#111', borderRadius: 12, padding: '14px 16px', marginBottom: 12, border: '1px solid #2a2a2a' }}>
                                <p style={{ color: '#888', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 12, margin: '0 0 12px' }}>⏱ Time Window Policy</p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Early Check-In (min)</label>
                                        <input className="input-field" type="number" min={0} max={120} value={form.early_checkin_minutes} onChange={e => setForm({ ...form, early_checkin_minutes: Number(e.target.value) })} style={{ padding: '8px 10px', fontSize: 13 }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Late Grace Period (min)</label>
                                        <input className="input-field" type="number" min={0} max={120} value={form.late_grace_minutes} onChange={e => setForm({ ...form, late_grace_minutes: Number(e.target.value) })} style={{ padding: '8px 10px', fontSize: 13 }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Early Checkout (min before)</label>
                                        <input className="input-field" type="number" min={0} max={120} value={form.early_checkout_minutes} onChange={e => setForm({ ...form, early_checkout_minutes: Number(e.target.value) })} style={{ padding: '8px 10px', fontSize: 13 }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Late Checkout Tolerance (min)</label>
                                        <input className="input-field" type="number" min={0} max={240} value={form.late_tolerance_minutes} onChange={e => setForm({ ...form, late_tolerance_minutes: Number(e.target.value) })} style={{ padding: '8px 10px', fontSize: 13 }} />
                                    </div>
                                </div>
                                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                                        <input type="checkbox" checked={form.block_outside_window} onChange={e => setForm({ ...form, block_outside_window: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#ef4444' }} />
                                        <span style={{ fontSize: 12, color: '#ccc' }}>Block check-in/out outside window</span>
                                    </label>
                                </div>
                            </div>

                            {/* Color + Published */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Color</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} style={{ width: 40, height: 36, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'none' }} />
                                        <span style={{ fontSize: 12, color: '#888' }}>{form.color}</span>
                                    </div>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 22 }}>
                                    <input type="checkbox" checked={form.published} onChange={e => setForm({ ...form, published: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#22c55e' }} />
                                    <span style={{ fontSize: 12, color: '#ccc' }}>Published (staff can see)</span>
                                </label>
                            </div>

                            {formError && (
                                <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 10px' }}>{formError}</p>
                            )}

                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="submit" className="btn-primary" disabled={saving} style={{ flex: 1, padding: 12 }}>
                                    {saving ? 'Saving...' : editingShift && !editingAssignment ? '💾 Save Shift' : editingAssignment ? '💾 Update Shift' : '📅 Create Shift'}
                                </button>
                                <button type="button" onClick={() => { setShowForm(false); setEditingShift(null); setEditingAssignment(null); setFormError(''); }} className="btn-secondary" style={{ padding: '12px 20px' }}>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteId && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                    <div className="card" style={{ maxWidth: 360, width: '100%', padding: 24, textAlign: 'center' }}>
                        <p style={{ fontSize: 32, marginBottom: 8 }}>🗑️</p>
                        <p style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Delete this shift?</p>
                        <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>All assignments for this shift will also be removed.</p>
                        {deleteError && <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 10px' }}>{deleteError}</p>}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => deleteShiftDef(deleteId)} disabled={deletingShift} style={{ flex: 1, padding: 12, background: '#ef4444', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: deletingShift ? 'not-allowed' : 'pointer', opacity: deletingShift ? 0.7 : 1 }}>{deletingShift ? 'Deleting...' : 'Delete'}</button>
                            <button onClick={() => { setDeleteId(null); setDeleteError(''); }} className="btn-secondary" style={{ flex: 1, padding: 12 }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function parseGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
    // Format: https://maps.google.com/?q=40.7128,-74.0060
    // Format: https://www.google.com/maps/@40.7128,-74.0060,17z
    // Format: https://www.google.com/maps/place/.../@40.7128,-74.0060,17z/...
    // Format: https://goo.gl/maps/... (shortened — user should paste full URL)
    // Format: 40.7128,-74.0060 (raw coordinates)
    const trimmed = url.trim();

    // Try raw coordinates: "lat,lng" or "lat, lng"
    const rawMatch = trimmed.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
    if (rawMatch) {
        return { lat: parseFloat(rawMatch[1]), lng: parseFloat(rawMatch[2]) };
    }

    // Try ?q=lat,lng or ?ll=lat,lng
    const qMatch = trimmed.match(/[?&](?:q|ll|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) {
        return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    }

    // Try /@lat,lng pattern
    const atMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
        return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    }

    // Try /place/lat,lng
    const placeMatch = trimmed.match(/\/place\/(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (placeMatch) {
        return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) };
    }

    return null;
}


function SettingsPanel() {
    const [mapsLink, setMapsLink] = useState('');
    const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [radiusMeters, setRadiusMeters] = useState(100);
    const [currentSettings, setCurrentSettings] = useState<{ id: string; restaurant_lat: number | null; restaurant_lng: number | null; radius_meters: number } | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [parseError, setParseError] = useState('');
    const [resolving, setResolving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        const { data } = await supabase.from('settings').select('*').limit(1).single();
        if (data) {
            setCurrentSettings(data);
            setRadiusMeters(data.radius_meters || 100);
            if (data.restaurant_lat && data.restaurant_lng) {
                setParsedCoords({ lat: data.restaurant_lat, lng: data.restaurant_lng });
            }
        }
    }

    async function handleParse() {
        setParseError('');
        setSaved(false);
        // Fallback: read from DOM if React state is empty (handles paste / autofill)
        let urlValue = mapsLink;
        if (!urlValue) {
            const inputEl = document.querySelector<HTMLInputElement>('input[placeholder="Paste Google Maps link or lat,lng"]');
            if (inputEl?.value) {
                urlValue = inputEl.value;
                setMapsLink(urlValue);
            }
        }

        // If it's a shortened Google Maps URL, resolve it first
        if (urlValue.includes('maps.app.goo.gl') || urlValue.includes('goo.gl/maps')) {
            setResolving(true);
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/resolve-maps-url`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: urlValue }),
                });
                const data = await res.json();
                if (data.resolvedUrl) {
                    urlValue = data.resolvedUrl;
                    setMapsLink(urlValue);
                } else {
                    setParseError('Could not resolve shortened URL. Try pasting the full Google Maps URL instead.');
                    setResolving(false);
                    return;
                }
            } catch {
                setParseError('Network error resolving shortened URL. Try pasting the full Google Maps URL instead.');
                setResolving(false);
                return;
            }
            setResolving(false);
        }

        const coords = parseGoogleMapsUrl(urlValue);
        if (coords) {
            if (coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) {
                setParseError('Coordinates out of valid range.');
                setParsedCoords(null);
                return;
            }
            setParsedCoords(coords);
        } else {
            setParseError('Could not extract coordinates. Try pasting the full Google Maps URL or enter raw coordinates like "40.7128,-74.0060".');
            setParsedCoords(null);
        }
    }

    async function handleSave() {
        if (!parsedCoords) return;
        setSaving(true);
        setSaved(false);
        setParseError('');

        const updateData = {
            restaurant_lat: parsedCoords.lat,
            restaurant_lng: parsedCoords.lng,
            radius_meters: radiusMeters,
        };

        let error;
        if (currentSettings) {
            const result = await supabase.from('settings').update(updateData).eq('id', currentSettings.id);
            error = result.error;
        } else {
            const result = await supabase.from('settings').insert(updateData);
            error = result.error;
        }

        if (error) {
            console.error('Save error:', error);
            setParseError(`Save failed: ${error.message}`);
            setSaving(false);
            return;
        }

        // Refresh settings from DB — keep parsedCoords as the source of truth
        const { data } = await supabase.from('settings').select('*').limit(1).single();
        if (data) {
            setCurrentSettings(data);
            setRadiusMeters(data.radius_meters || 100);
        }

        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    }

    const mapPreviewUrl = parsedCoords
        ? `https://maps.googleapis.com/maps/api/staticmap?center=${parsedCoords.lat},${parsedCoords.lng}&zoom=16&size=400x250&markers=color:red%7C${parsedCoords.lat},${parsedCoords.lng}&key=&style=feature:all|element:geometry|color:0x242f3e`
        : null;

    return (
        <div className="animate-fadeIn">
            <h2 style={styles.sectionTitle}>Restaurant Settings</h2>
            <p style={{ color: '#999', fontSize: 14, marginTop: 8, marginBottom: 24 }}>
                Set your restaurant&apos;s location so the app can verify staff are on-site when clocking in.
            </p>

            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' as const, alignItems: 'flex-start' }}>
                {/* Left: Input */}
                <div style={{ flex: '1 1 340px' }}>
                    <div className="card" style={{ padding: 24 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f0b427', margin: '0 0 16px' }}>
                            📍 Set Location
                        </h3>

                        <label style={{
                            fontSize: 12, fontWeight: 600, color: '#999',
                            textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                            display: 'block', marginBottom: 6,
                        }}>Google Maps Link or Coordinates</label>
                        <input
                            className="input-field"
                            value={mapsLink}
                            onChange={e => { setMapsLink(e.target.value); setParseError(''); setSaved(false); }}
                            placeholder="Paste Google Maps link or lat,lng"
                        />
                        <p style={{ fontSize: 11, color: '#666', marginTop: 6, lineHeight: 1.5 }}>
                            Open Google Maps → find your restaurant → tap &quot;Share&quot; → copy the link and paste it here.
                            Or just type the coordinates like <span style={{ color: '#f0b427' }}>40.7128,-74.0060</span>
                        </p>

                        <button onClick={handleParse} className="btn-primary" style={{ marginTop: 12, marginBottom: 0 }} disabled={resolving}>
                            {resolving ? '⏳ Resolving link…' : '🔍 Extract Coordinates'}
                        </button>

                        {parseError && (
                            <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 10 }}>{parseError}</p>
                        )}
                    </div>

                    {/* Parsed result */}
                    {parsedCoords && (
                        <div className="card" style={{ padding: 24, marginTop: 16 }}>
                            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f0b427', margin: '0 0 16px' }}>
                                ✅ Coordinates Found
                            </h3>
                            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Latitude</label>
                                    <div style={{
                                        background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
                                        padding: '10px 12px', color: '#4ecdc4', fontFamily: 'monospace', fontSize: 14,
                                    }}>
                                        {parsedCoords.lat.toFixed(6)}
                                    </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Longitude</label>
                                    <div style={{
                                        background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
                                        padding: '10px 12px', color: '#4ecdc4', fontFamily: 'monospace', fontSize: 14,
                                    }}>
                                        {parsedCoords.lng.toFixed(6)}
                                    </div>
                                </div>
                            </div>

                            <label style={{
                                fontSize: 12, fontWeight: 600, color: '#999',
                                textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                                display: 'block', marginBottom: 6,
                            }}>Check-in Radius</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <input
                                    type="range"
                                    min={25}
                                    max={5000}
                                    step={25}
                                    value={radiusMeters}
                                    onChange={e => setRadiusMeters(Number(e.target.value))}
                                    style={{ flex: 1, accentColor: '#f0b427' }}
                                />
                                <span style={{ color: '#f0b427', fontWeight: 700, fontSize: 16, minWidth: 60, textAlign: 'right' as const }}>
                                    {radiusMeters >= 1000 ? `${(radiusMeters / 1000).toFixed(1)}km` : `${radiusMeters}m`}
                                </span>
                            </div>
                            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                                Staff must be within this distance from the restaurant to clock in.
                                100m is recommended for most locations. Slide right for up to 5km.
                            </p>

                            <button
                                onClick={handleSave}
                                className="btn-primary"
                                disabled={saving}
                                style={{ marginTop: 16 }}
                            >
                                {saving ? 'Saving...' : saved ? '✅ Saved!' : '💾 Save Location'}
                            </button>

                            {saved && (
                                <p style={{ color: '#4ecdc4', fontSize: 13, marginTop: 8, textAlign: 'center' as const }}>
                                    Restaurant location updated successfully! Staff GPS checks will use this location.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Right: Map Preview / Current Settings */}
                <div style={{ flex: '1 1 340px' }}>
                    {/* Current settings card */}
                    <div className="card" style={{ padding: 24 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f0b427', margin: '0 0 12px' }}>
                            📍 Current Location
                        </h3>
                        {currentSettings?.restaurant_lat && currentSettings?.restaurant_lng ? (
                            <>
                                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                                    <div>
                                        <span style={{ fontSize: 11, color: '#666' }}>Lat: </span>
                                        <span style={{ color: '#4ecdc4', fontFamily: 'monospace' }}>
                                            {currentSettings.restaurant_lat.toFixed(6)}
                                        </span>
                                    </div>
                                    <div>
                                        <span style={{ fontSize: 11, color: '#666' }}>Lng: </span>
                                        <span style={{ color: '#4ecdc4', fontFamily: 'monospace' }}>
                                            {currentSettings.restaurant_lng.toFixed(6)}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <span style={{ fontSize: 11, color: '#666' }}>Radius: </span>
                                    <span style={{ color: '#f0b427', fontWeight: 700 }}>
                                        {currentSettings.radius_meters >= 1000 ? `${(currentSettings.radius_meters / 1000).toFixed(1)}km` : `${currentSettings.radius_meters}m`}
                                    </span>
                                </div>
                                <a
                                    href={`https://www.google.com/maps/@${currentSettings.restaurant_lat},${currentSettings.restaurant_lng},17z`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'inline-block', marginTop: 12,
                                        color: '#f0b427', fontSize: 13, textDecoration: 'underline',
                                    }}
                                >
                                    View on Google Maps ↗
                                </a>
                                {mapPreviewUrl && (
                                    <div style={{
                                        marginTop: 16, borderRadius: 12, overflow: 'hidden',
                                        border: '1px solid #333', background: '#1a1a1a',
                                        padding: 12, textAlign: 'center' as const,
                                    }}>
                                        <div style={{
                                            width: '100%', height: 200, borderRadius: 8,
                                            background: '#222', display: 'flex',
                                            alignItems: 'center', justifyContent: 'center',
                                            flexDirection: 'column' as const, gap: 8,
                                        }}>
                                            <span style={{ fontSize: 40 }}>📍</span>
                                            <span style={{ color: '#4ecdc4', fontFamily: 'monospace', fontSize: 13 }}>
                                                {parsedCoords?.lat.toFixed(4)}, {parsedCoords?.lng.toFixed(4)}
                                            </span>
                                            <span style={{ color: '#666', fontSize: 11 }}>
                                                Radius: {radiusMeters}m
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{
                                background: '#1a1a1a', border: '2px dashed #333',
                                borderRadius: 12, padding: '40px 20px',
                                textAlign: 'center' as const,
                            }}>
                                <span style={{ fontSize: 40 }}>🏪</span>
                                <p style={{ color: '#666', fontSize: 13, marginTop: 12 }}>
                                    No location set yet. Paste a Google Maps link to set your restaurant&apos;s location.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* How it works */}
                    <div className="card" style={{ padding: 24, marginTop: 16 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f0b427', margin: '0 0 12px' }}>
                            💡 How It Works
                        </h3>
                        <ol style={{ color: '#999', fontSize: 13, lineHeight: 2, margin: 0, paddingLeft: 20 }}>
                            <li>Open <strong style={{ color: '#ccc' }}>Google Maps</strong> on your phone</li>
                            <li>Search for or navigate to your restaurant</li>
                            <li>Tap <strong style={{ color: '#ccc' }}>Share</strong> → <strong style={{ color: '#ccc' }}>Copy Link</strong></li>
                            <li>Paste the link above and click <strong style={{ color: '#ccc' }}>Extract Coordinates</strong></li>
                            <li>Adjust the check-in radius and <strong style={{ color: '#ccc' }}>Save</strong></li>
                        </ol>
                    </div>
                </div>

                {/* AI Configuration */}
                <AIConfigCard />
            </div>
        </div>
    );
}

function AIConfigCard() {
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [savingKey, setSavingKey] = useState(false);
    const [savedKey, setSavedKey] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [hasKey, setHasKey] = useState(false);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    useEffect(() => {
        loadKey();
    }, []);

    async function loadKey() {
        const { data } = await supabase.from('settings').select('gemini_api_key').limit(1).single();
        if (data?.gemini_api_key) {
            setApiKey(data.gemini_api_key);
            setHasKey(true);
        }
    }

    async function saveKey() {
        setSavingKey(true);
        setSavedKey(false);
        const { data: existing } = await supabase.from('settings').select('id').limit(1).single();
        if (existing) {
            await supabase.from('settings').update({ gemini_api_key: apiKey.trim() }).eq('id', existing.id);
        } else {
            await supabase.from('settings').insert({ gemini_api_key: apiKey.trim() });
        }
        setSavingKey(false);
        setSavedKey(true);
        setHasKey(!!apiKey.trim());
        setTimeout(() => setSavedKey(false), 3000);
    }

    async function testKey() {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch(`${supabaseUrl}/functions/v1/generate-tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction: 'Create 1 test task',
                    api_key: apiKey.trim(),
                }),
            });
            const data = await res.json();
            if (data.tasks && data.tasks.length > 0) {
                setTestResult({ ok: true, msg: '✅ Connection successful! AI is ready.' });
            } else if (data.error) {
                setTestResult({ ok: false, msg: `❌ ${data.error}` });
            }
        } catch {
            setTestResult({ ok: false, msg: '❌ Could not connect to AI service.' });
        }
        setTesting(false);
    }

    return (
        <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>🤖 AI Configuration</h2>
            <p style={{ color: '#999', fontSize: 14, marginBottom: 20 }}>
                Configure your Gemini API key to enable AI-powered task generation.
            </p>
            <div className="card" style={{ padding: 24 }}>
                <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                        Gemini API Key
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            className="input-field"
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={e => { setApiKey(e.target.value); setSavedKey(false); }}
                            placeholder="Enter your Gemini API key..."
                            style={{ flex: 1 }}
                        />
                        <button
                            onClick={() => setShowKey(!showKey)}
                            style={{ background: '#222', border: '1px solid #333', borderRadius: 10, padding: '0 14px', color: '#999', cursor: 'pointer', fontSize: 16 }}
                        >
                            {showKey ? '🙈' : '👁️'}
                        </button>
                    </div>
                    <p style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                        Get your free API key from{' '}
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'underline' }}>
                            Google AI Studio
                        </a>
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={saveKey} className="btn-primary" disabled={savingKey || !apiKey.trim()} style={{ width: 'auto', padding: '10px 20px' }}>
                        {savingKey ? 'Saving...' : savedKey ? '✅ Saved!' : '💾 Save Key'}
                    </button>
                    <button onClick={testKey} className="btn-secondary" disabled={testing || !apiKey.trim()} style={{ padding: '10px 20px', fontSize: 13 }}>
                        {testing ? '⏳ Testing...' : '🧪 Test Connection'}
                    </button>
                </div>
                {testResult && (
                    <p style={{ marginTop: 12, fontSize: 13, color: testResult.ok ? '#22c55e' : '#ef4444' }}>
                        {testResult.msg}
                    </p>
                )}
                {hasKey && !testResult && (
                    <p style={{ marginTop: 12, fontSize: 12, color: '#22c55e' }}>
                        ✅ API key configured
                    </p>
                )}
            </div>
        </div>
    );
}

function QRCodePanel() {
    const [qrUrl, setQrUrl] = useState('');
    const [customUrl, setCustomUrl] = useState('');
    const [generated, setGenerated] = useState(false);

    useEffect(() => {
        // Default to current origin
        if (typeof window !== 'undefined') {
            setCustomUrl(window.location.origin);
        }
    }, []);

    async function generateQR() {
        const url = customUrl.trim() || window.location.origin;
        try {
            const QRCode = (await import('qrcode')).default;
            const dataUrl = await QRCode.toDataURL(url, {
                width: 400,
                margin: 2,
                color: {
                    dark: '#111111',
                    light: '#ffffff',
                },
                errorCorrectionLevel: 'H',
            });
            setQrUrl(dataUrl);
            setGenerated(true);
        } catch (err) {
            console.error('QR generation failed:', err);
        }
    }

    function downloadQR() {
        if (!qrUrl) return;
        const a = document.createElement('a');
        a.href = qrUrl;
        a.download = 'smokeys-staff-clock-qr.png';
        a.click();
    }

    function printQR() {
        if (!qrUrl) return;
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
                <head><title>Smokey's QR Code</title></head>
                <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,sans-serif;background:#fff;">
                    <h1 style="font-size:32px;letter-spacing:4px;color:#111;">SMOKEY'S</h1>
                    <p style="font-size:16px;color:#666;margin-bottom:24px;">Scan to Clock In / Out</p>
                    <img src="${qrUrl}" style="width:300px;height:300px;" />
                    <p style="font-size:12px;color:#999;margin-top:16px;">${customUrl || window.location.origin}</p>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.onload = () => {
            printWindow.print();
        };
    }

    return (
        <div className="animate-fadeIn">
            <h2 style={styles.sectionTitle}>QR Code Generator</h2>
            <p style={{ color: '#999', fontSize: 14, marginTop: 8, marginBottom: 24 }}>
                Generate a QR code to print and place at the restaurant entrance or kitchen.
                Staff scan this code with their phone to open the clock-in page.
            </p>

            <div style={{
                display: 'flex',
                gap: '32px',
                flexWrap: 'wrap' as const,
                alignItems: 'flex-start',
            }}>
                {/* Left: Settings */}
                <div style={{ flex: '1 1 300px' }}>
                    <div className="card" style={{ padding: 24 }}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                fontSize: 12, fontWeight: 600, color: '#999',
                                textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                                display: 'block', marginBottom: 6,
                            }}>App URL</label>
                            <input
                                className="input-field"
                                value={customUrl}
                                onChange={e => setCustomUrl(e.target.value)}
                                placeholder="https://your-deployed-url.com"
                            />
                            <p style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                                This is the URL staff will be directed to when they scan the QR code.
                                Use your deployed URL (e.g. Vercel) for production.
                            </p>
                        </div>

                        <button onClick={generateQR} className="btn-primary" style={{ marginBottom: 12 }}>
                            {generated ? '🔄 Regenerate QR Code' : '📱 Generate QR Code'}
                        </button>

                        {generated && (
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={downloadQR} className="btn-secondary" style={{ flex: 1, padding: '10px 12px', fontSize: 13 }}>
                                    📥 Download PNG
                                </button>
                                <button onClick={printQR} className="btn-secondary" style={{ flex: 1, padding: '10px 12px', fontSize: 13 }}>
                                    🖨️ Print
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Placement Tips */}
                    <div className="card" style={{ padding: 24, marginTop: 16 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f0b427', margin: '0 0 12px' }}>
                            📍 Placement Tips
                        </h3>
                        <ul style={{ color: '#999', fontSize: 13, lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
                            <li>Print on a sturdy card or laminate it</li>
                            <li>Place at the entrance and inside the kitchen</li>
                            <li>Make sure it&apos;s at eye level and well-lit</li>
                            <li>Staff need WiFi or data to connect after scanning</li>
                            <li>The QR code only opens the login page — GPS + PIN are still required</li>
                        </ul>
                    </div>
                </div>

                {/* Right: Preview */}
                <div style={{ flex: '1 1 300px', display: 'flex', justifyContent: 'center' }}>
                    {generated && qrUrl ? (
                        <div style={{
                            background: '#fff',
                            borderRadius: 20,
                            padding: '40px 32px',
                            textAlign: 'center' as const,
                            maxWidth: 380,
                            width: '100%',
                            boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
                        }}>
                            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#111', letterSpacing: 4, margin: '0 0 4px' }}>
                                SMOKEY&apos;S
                            </h2>
                            <p style={{ fontSize: 13, color: '#666', margin: '0 0 20px' }}>Scan to Clock In / Out</p>
                            <img
                                src={qrUrl}
                                alt="Staff Clock QR Code"
                                style={{ width: '100%', maxWidth: 280, height: 'auto', borderRadius: 8 }}
                            />
                            <p style={{ fontSize: 11, color: '#999', marginTop: 16, wordBreak: 'break-all' as const }}>
                                {customUrl || window.location.origin}
                            </p>
                        </div>
                    ) : (
                        <div style={{
                            background: '#1a1a1a',
                            border: '2px dashed #333',
                            borderRadius: 20,
                            padding: '60px 32px',
                            textAlign: 'center' as const,
                            maxWidth: 380,
                            width: '100%',
                        }}>
                            <span style={{ fontSize: 48 }}>📱</span>
                            <p style={{ color: '#666', fontSize: 14, marginTop: 16 }}>
                                Click &quot;Generate QR Code&quot; to create a scannable code for your staff.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ReportCard({ title, logs, type, staffList }: { title: string; logs: TimeLog[]; type: string; staffList: Staff[] }) {
    const now = new Date();
    const filtered = logs.filter(log => {
        const d = new Date(log.check_in);
        if (type === 'today') return d.toDateString() === now.toDateString();
        if (type === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return d >= weekAgo;
        }
        if (type === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return true;
    });

    const totalHours = filtered.reduce((acc, l) => acc + (l.total_hours || 0), 0);
    const uniqueStaff = new Set(filtered.map(l => l.staff_id)).size;
    const activeStaff = staffList.filter(s => s.active && s.role === 'staff').length;

    return (
        <div style={reportStyles.card}>
            <h3 style={reportStyles.title}>{title}</h3>
            <div style={reportStyles.stats}>
                <div style={reportStyles.stat}>
                    <span style={reportStyles.statValue}>{filtered.length}</span>
                    <span style={reportStyles.statLabel}>Entries</span>
                </div>
                <div style={reportStyles.stat}>
                    <span style={reportStyles.statValue}>{uniqueStaff}/{activeStaff}</span>
                    <span style={reportStyles.statLabel}>Staff Present</span>
                </div>
                <div style={reportStyles.stat}>
                    <span style={reportStyles.statValue}>{totalHours.toFixed(1)}</span>
                    <span style={reportStyles.statLabel}>Total Hours</span>
                </div>
            </div>
        </div>
    );
}

const reportStyles: Record<string, React.CSSProperties> = {
    card: {
        background: '#222',
        border: '1px solid #333',
        borderRadius: '16px',
        padding: '24px',
    },
    title: {
        fontSize: '16px',
        fontWeight: 700,
        color: '#f0b427',
        margin: '0 0 20px',
    },
    stats: {
        display: 'flex',
        gap: '20px',
    },
    stat: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
    },
    statValue: {
        fontSize: '28px',
        fontWeight: 800,
        color: '#fff',
    },
    statLabel: {
        fontSize: '12px',
        color: '#666',
        marginTop: '4px',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
};

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    page: {
        minHeight: '100vh',
        background: '#111',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 24px',
        borderBottom: '1px solid #222',
        background: '#1a1a1a',
        position: 'sticky' as const,
        top: 0,
        zIndex: 50,
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    headerTitle: {
        fontSize: '18px',
        fontWeight: 900,
        color: '#f0b427',
        letterSpacing: '3px',
        margin: 0,
    },
    headerSub: {
        fontSize: '11px',
        color: '#666',
        margin: 0,
        letterSpacing: '1px',
    },
    headerRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    adminName: {
        fontSize: '14px',
        color: '#999',
    },
    logoutBtn: {
        padding: '6px 14px',
        background: 'transparent',
        border: '1px solid #333',
        borderRadius: '8px',
        color: '#999',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
    },
    tabs: {
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid #222',
        background: '#1a1a1a',
        paddingLeft: '24px',
    },
    tab: {
        padding: '14px 24px',
        background: 'transparent',
        border: 'none',
        borderBottomWidth: '2px',
        borderBottomStyle: 'solid' as const,
        borderBottomColor: 'transparent',
        color: '#666',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
        transition: 'all 0.2s',
    },
    tabActive: {
        color: '#f0b427',
        borderBottomColor: '#f0b427',
    },
    main: {
        padding: '24px',
        maxWidth: '1200px',
        margin: '0 auto',
    },
    sectionHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap' as const,
        gap: '12px',
    },
    sectionTitle: {
        fontSize: '20px',
        fontWeight: 700,
        color: '#fff',
        margin: 0,
    },
    tableContainer: {
        overflowX: 'auto' as const,
        borderRadius: '12px',
        border: '1px solid #222',
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse' as const,
        fontSize: '14px',
    },
    th: {
        padding: '12px 16px',
        textAlign: 'left' as const,
        background: '#1a1a1a',
        color: '#999',
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
        borderBottom: '1px solid #222',
    },
    tr: {
        borderBottom: '1px solid #1a1a1a',
    },
    td: {
        padding: '12px 16px',
        color: '#ccc',
    },
    code: {
        background: '#222',
        padding: '2px 8px',
        borderRadius: '6px',
        fontSize: '13px',
        color: '#f0b427',
        fontFamily: 'monospace',
    },
    badge: {
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'capitalize' as const,
    },
    actionBtns: {
        display: 'flex',
        gap: '8px',
    },
    actionBtn: {
        padding: '4px 12px',
        background: 'transparent',
        border: '1px solid #333',
        borderRadius: '6px',
        color: '#999',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
        transition: 'all 0.2s',
    },
    filterBar: {
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap' as const,
        marginBottom: '20px',
        padding: '16px',
        background: '#1a1a1a',
        borderRadius: '12px',
        border: '1px solid #222',
    },
    filterGroup: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '4px',
        flex: '1 1 150px',
    },
    filterLabel: {
        fontSize: '11px',
        color: '#666',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
        fontWeight: 600,
    },
    formOverlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '20px',
    },
    staffFormCard: {
        background: '#1a1a1a',
        borderRadius: '20px',
        padding: '32px',
        width: '100%',
        maxWidth: '500px',
        border: '1px solid #333',
    },
    formTitle: {
        fontSize: '20px',
        fontWeight: 700,
        color: '#fff',
        margin: '0 0 24px',
    },
    formGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
    },
    inputGroup: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '6px',
    },
    formLabel: {
        fontSize: '12px',
        fontWeight: 600,
        color: '#999',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    formActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
        marginTop: '24px',
    },
    formError: {
        color: '#ef4444',
        fontSize: '14px',
        marginTop: '12px',
    },
    cancelBtn: {
        padding: '10px 24px',
        background: 'transparent',
        border: '1px solid #333',
        borderRadius: '12px',
        color: '#999',
        fontSize: '14px',
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
    },
    reportGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '16px',
        marginTop: '16px',
    },
};
