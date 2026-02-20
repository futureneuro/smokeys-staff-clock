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

type Tab = 'staff' | 'logs' | 'reports' | 'qrcode' | 'settings';

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
                {(['staff', 'logs', 'reports', 'qrcode', 'settings'] as Tab[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            ...styles.tab,
                            ...(activeTab === tab ? styles.tabActive : {}),
                        }}
                    >
                        {tab === 'staff' ? '👥 Staff' : tab === 'logs' ? '📋 Time Logs' : tab === 'reports' ? '📊 Reports' : tab === 'qrcode' ? '📱 QR Code' : '⚙️ Settings'}
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
