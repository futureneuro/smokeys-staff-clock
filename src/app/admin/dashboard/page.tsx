'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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

type Tab = 'staff' | 'logs' | 'reports';

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
    const [staffForm, setStaffForm] = useState({ name: '', staff_code: '', pin: '', role: 'staff' });
    const [staffFormError, setStaffFormError] = useState('');
    const [staffFormLoading, setStaffFormLoading] = useState(false);

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
            }

            setShowStaffForm(false);
            setEditingStaff(null);
            setStaffForm({ name: '', staff_code: '', pin: '', role: 'staff' });
            fetchStaff();
        } catch {
            setStaffFormError('An error occurred.');
        } finally {
            setStaffFormLoading(false);
        }
    }

    async function toggleStaffActive(staff: Staff) {
        await supabase.from('staff').update({ active: !staff.active }).eq('id', staff.id);
        fetchStaff();
    }

    function editStaff(staff: Staff) {
        setEditingStaff(staff);
        setStaffForm({ name: staff.name, staff_code: staff.staff_code, pin: '', role: staff.role });
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
                {(['staff', 'logs', 'reports'] as Tab[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            ...styles.tab,
                            ...(activeTab === tab ? styles.tabActive : {}),
                        }}
                    >
                        {tab === 'staff' ? '👥 Staff' : tab === 'logs' ? '📋 Time Logs' : '📊 Reports'}
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
                                    setStaffForm({ name: '', staff_code: '', pin: '', role: 'staff' });
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

                        <div style={styles.tableContainer}>
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Code</th>
                                        <th style={styles.th}>Name</th>
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
                                                        style={{ ...styles.actionBtn, color: s.active ? '#ef4444' : '#22c55e' }}
                                                    >
                                                        {s.active ? 'Deactivate' : 'Activate'}
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
                                <input type="date" className="input-field" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                            </div>
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>To</label>
                                <input type="date" className="input-field" value={dateTo} onChange={e => setDateTo(e.target.value)} />
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
            </main>
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
        borderBottom: '2px solid transparent',
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
