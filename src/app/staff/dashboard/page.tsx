'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, logout, clockAction, StaffSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCurrentPosition, GeoPosition, haversineDistance } from '@/lib/geo';
import { Lang, t, formatTimeMedellin } from '@/lib/i18n';

interface TimeLog {
    id: string;
    check_in: string;
    check_out: string | null;
    total_hours: number | null;
}

interface Shift {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    name: string;
    color: string;
    early_checkin_minutes: number;
    late_grace_minutes: number;
    block_outside_window: boolean;
}

interface Task {
    id: string;
    title: string;
    description: string | null;
    due_date: string;
    status: string;
    priority: string | null;
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

interface TaskStatusDef {
    id: string;
    label: string;
    color: string;
    sort_order: number;
    is_default: boolean;
}

type Tab = 'home' | 'history' | 'tasks' | 'profile';

export default function StaffDashboard() {
    const router = useRouter();
    const [session, setSession] = useState<StaffSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>('home');
    const [lang, setLang] = useState<Lang>('es');

    // Dashboard data
    const [openLog, setOpenLog] = useState<TimeLog | null>(null);
    const [todayShift, setTodayShift] = useState<Shift | null>(null);
    const [todayTasks, setTodayTasks] = useState<Task[]>([]);
    const [alerts, setAlerts] = useState<string[]>([]);

    // Attendance action
    const [position, setPosition] = useState<GeoPosition | null>(null);
    const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'ok' | 'error' | 'too_far'>('idle');
    const [clockLoading, setClockLoading] = useState(false);
    const [clockError, setClockError] = useState('');
    const [clockSuccess, setClockSuccess] = useState('');

    // History data
    const [historyLogs, setHistoryLogs] = useState<TimeLog[]>([]);

    // Tasks full data
    const [allTasks, setAllTasks] = useState<Task[]>([]);
    const [tasksTab, setTasksTab] = useState<'today' | 'upcoming' | 'completed'>('today');

    // Custom statuses
    const [customStatuses, setCustomStatuses] = useState<TaskStatusDef[]>([]);

    // Task comments
    const [viewingTask, setViewingTask] = useState<Task | null>(null);
    const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
    const [commentText, setCommentText] = useState('');
    const [commentSending, setCommentSending] = useState(false);
    const [commentFile, setCommentFile] = useState<File | null>(null);
    const [commentPreview, setCommentPreview] = useState<string | null>(null);
    const commentFileRef = useRef<HTMLInputElement>(null);

    // Auto clock-out correction
    const [autoClockOutLog, setAutoClockOutLog] = useState<TimeLog | null>(null);
    const [showClockOutCorrection, setShowClockOutCorrection] = useState(false);
    const [correctionTime, setCorrectionTime] = useState('');
    const [correctionSaving, setCorrectionSaving] = useState(false);
    const autoClockOutProcessed = useRef<Set<string>>(new Set());

    // Break management
    const [activeBreak, setActiveBreak] = useState<{ id: string; break_start: string } | null>(null);
    const [breakCount, setBreakCount] = useState(0);
    const [breakTimer, setBreakTimer] = useState(0); // seconds
    const [breakLoading, setBreakLoading] = useState(false);
    const [breakError, setBreakError] = useState('');
    const [breakSuccess, setBreakSuccess] = useState('');

    useEffect(() => {
        const saved = localStorage.getItem('smokeys_lang') as Lang | null;
        if (saved === 'en' || saved === 'es') setLang(saved);
    }, []);

    useEffect(() => {
        const s = getSession();
        if (!s) {
            router.push('/staff/login');
            return;
        }
        setSession(s);
        setLoading(false);
    }, [router]);

    const today = new Date().toISOString().slice(0, 10);

    const fetchDashboardData = useCallback(async () => {
        if (!session) return;

        // Open time log (checked in but not out)
        const { data: logs } = await supabase
            .from('time_logs')
            .select('*')
            .eq('staff_id', session.staff.id)
            .is('check_out', null)
            .order('check_in', { ascending: false })
            .limit(1);
        const currentOpenLog = logs && logs.length > 0 ? logs[0] : null;

        // Auto clock-out if checked in for more than 10 hours
        if (currentOpenLog && !autoClockOutProcessed.current.has(currentOpenLog.id)) {
            const checkInTime = new Date(currentOpenLog.check_in).getTime();
            const now = Date.now();
            const hoursDiff = (now - checkInTime) / (1000 * 60 * 60);
            if (hoursDiff >= 10) {
                autoClockOutProcessed.current.add(currentOpenLog.id);
                // Auto clock out at the check-in time + 10 hours
                const autoCheckOut = new Date(checkInTime + 10 * 60 * 60 * 1000);
                const totalHrs = 10;
                await supabase
                    .from('time_logs')
                    .update({
                        check_out: autoCheckOut.toISOString(),
                        total_hours: totalHrs,
                    })
                    .eq('id', currentOpenLog.id);
                setAutoClockOutLog({ ...currentOpenLog, check_out: autoCheckOut.toISOString(), total_hours: totalHrs });
                setShowClockOutCorrection(true);
                setOpenLog(null);
                // Set a default correction time suggestion
                const suggestedHour = autoCheckOut.getHours().toString().padStart(2, '0');
                const suggestedMin = autoCheckOut.getMinutes().toString().padStart(2, '0');
                setCorrectionTime(`${suggestedHour}:${suggestedMin}`);
                return; // re-fetch will happen after correction
            }
        }
        setOpenLog(currentOpenLog);

        // Today's shift (from shift_assignments + shift_definitions)
        const { data: shiftAssignments } = await supabase
            .from('shift_assignments')
            .select('id, shift_date, shift_definition:shift_definitions(id, name, start_time, end_time, color, early_checkin_minutes, late_grace_minutes, block_outside_window)')
            .eq('staff_id', session.staff.id)
            .eq('shift_date', today)
            .limit(1);
        if (shiftAssignments && shiftAssignments.length > 0) {
            const sa = shiftAssignments[0] as any;
            const sd = sa.shift_definition;
            setTodayShift(sd ? { id: sa.id, shift_date: sa.shift_date, start_time: sd.start_time, end_time: sd.end_time, name: sd.name, color: sd.color, early_checkin_minutes: sd.early_checkin_minutes ?? 15, late_grace_minutes: sd.late_grace_minutes ?? 10, block_outside_window: sd.block_outside_window ?? false } : null);
        } else {
            setTodayShift(null);
        }

        // Today's tasks
        const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('staff_id', session.staff.id)
            .eq('due_date', today)
            .order('created_at', { ascending: true });
        setTodayTasks(tasks || []);



        // Alerts
        const newAlerts: string[] = [];
        if (shiftAssignments && shiftAssignments.length > 0) {
            const sa = shiftAssignments[0] as any;
            const sd = sa.shift_definition;
            if (sd) {
                const shiftStart = sd.start_time;
                const now = new Date();
                const [h, m] = shiftStart.split(':').map(Number);
                const shiftTime = new Date(now);
                shiftTime.setHours(h, m, 0, 0);
                if (now > shiftTime && !(logs && logs.length > 0)) {
                    newAlerts.push(t(lang, 'alertLate'));
                }
            }
        }

        // Check for yesterday's unclosed log
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yDate = yesterday.toISOString().slice(0, 10);
        const { data: yLogs } = await supabase
            .from('time_logs')
            .select('id')
            .eq('staff_id', session.staff.id)
            .is('check_out', null)
            .lt('check_in', yDate + 'T23:59:59')
            .limit(1);
        if (yLogs && yLogs.length > 0) {
            newAlerts.push(t(lang, 'alertForgotCheckout'));
        }

        // Alert if auto clock-out correction is pending
        if (showClockOutCorrection && autoClockOutLog) {
            newAlerts.push('⏰ You were auto-clocked out after 10+ hours. Please correct your clock-out time.');
        }
        setAlerts(newAlerts);
    }, [session, today, lang]);

    useEffect(() => {
        if (!loading && session) {
            fetchDashboardData();
        }
    }, [loading, session, fetchDashboardData]);

    // Fetch history when tab switches
    const fetchHistory = useCallback(async () => {
        if (!session) return;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { data } = await supabase
            .from('time_logs')
            .select('*')
            .eq('staff_id', session.staff.id)
            .gte('check_in', thirtyDaysAgo.toISOString())
            .order('check_in', { ascending: false });
        setHistoryLogs(data || []);
    }, [session]);

    const fetchBreakData = useCallback(async (timeLogId: string) => {
        // Active break
        const { data: active } = await supabase
            .from('breaks')
            .select('id, break_start')
            .eq('time_log_id', timeLogId)
            .is('break_end', null)
            .limit(1);
        setActiveBreak(active && active.length > 0 ? active[0] : null);
        // Break count (all breaks for this log, including completed)
        const { count } = await supabase
            .from('breaks')
            .select('id', { count: 'exact', head: true })
            .eq('time_log_id', timeLogId);
        setBreakCount(count || 0);
    }, []);

    // When open log changes, fetch break state
    useEffect(() => {
        if (openLog) fetchBreakData(openLog.id);
        else { setActiveBreak(null); setBreakCount(0); }
    }, [openLog, fetchBreakData]);

    // Live break timer
    useEffect(() => {
        if (!activeBreak) { setBreakTimer(0); return; }
        const tick = setInterval(() => {
            setBreakTimer(Math.floor((Date.now() - new Date(activeBreak.break_start).getTime()) / 1000));
        }, 1000);
        return () => clearInterval(tick);
    }, [activeBreak]);

    const fetchAllTasks = useCallback(async () => {
        if (!session) return;
        const { data } = await supabase
            .from('tasks')
            .select('*')
            .eq('staff_id', session.staff.id)
            .order('due_date', { ascending: true });
        setAllTasks(data || []);
    }, [session]);

    const fetchStatuses = useCallback(async () => {
        const { data } = await supabase
            .from('task_statuses')
            .select('*')
            .order('sort_order');
        if (data) setCustomStatuses(data);
    }, []);

    useEffect(() => {
        fetchStatuses();
    }, [fetchStatuses]);

    useEffect(() => {
        if (activeTab === 'history') fetchHistory();
        if (activeTab === 'tasks') fetchAllTasks();
    }, [activeTab, fetchHistory, fetchAllTasks]);

    // Geolocation for check-in/out
    async function getLocation() {
        setGeoStatus('loading');
        try {
            const pos = await getCurrentPosition();
            setPosition(pos);

            const { data: settings } = await supabase
                .from('settings')
                .select('restaurant_lat, restaurant_lng, radius_meters')
                .limit(1)
                .single();

            if (settings?.restaurant_lat && settings?.restaurant_lng) {
                const dist = haversineDistance(pos, { lat: settings.restaurant_lat, lng: settings.restaurant_lng });
                const rKm = (settings.radius_meters || 100) / 1000;
                if (dist > rKm) {
                    setGeoStatus('too_far');
                    return;
                }
            }
            setGeoStatus('ok');
        } catch {
            setGeoStatus('error');
        }
    }

    async function handleClock(action: 'check_in' | 'check_out') {
        if (!position) return;
        setClockLoading(true);
        setClockError('');
        setClockSuccess('');

        const result = await clockAction(action, position.lat, position.lng);

        if (result.success) {
            setClockSuccess(result.data?.message as string || 'Success!');
            fetchDashboardData();
            setTimeout(() => setClockSuccess(''), 5000);
        } else {
            setClockError(result.error || 'Failed');
        }
        setClockLoading(false);
    }

    async function handleBreak(action: 'break_start' | 'break_end') {
        if (!position) return;
        setBreakLoading(true);
        setBreakError('');
        setBreakSuccess('');
        const result = await clockAction(action, position.lat, position.lng);
        if (result.success) {
            setBreakSuccess(result.data?.message as string || (action === 'break_start' ? 'Break started.' : 'Break ended.'));
            if (openLog) fetchBreakData(openLog.id);
            setTimeout(() => setBreakSuccess(''), 5000);
        } else {
            setBreakError(result.error || 'Failed');
        }
        setBreakLoading(false);
    }

    async function handleClockOutCorrection() {
        if (!autoClockOutLog || !correctionTime) return;
        setCorrectionSaving(true);
        try {
            // Build the corrected check-out datetime: use check-in date + correction time
            const checkInDate = new Date(autoClockOutLog.check_in);
            const [cHour, cMin] = correctionTime.split(':').map(Number);
            const correctedCheckOut = new Date(checkInDate);
            correctedCheckOut.setHours(cHour, cMin, 0, 0);
            // If correction time is before check-in time, assume it's next day
            if (correctedCheckOut <= checkInDate) {
                correctedCheckOut.setDate(correctedCheckOut.getDate() + 1);
            }
            const totalHrs = (correctedCheckOut.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
            await supabase
                .from('time_logs')
                .update({
                    check_out: correctedCheckOut.toISOString(),
                    total_hours: Math.round(totalHrs * 100) / 100,
                })
                .eq('id', autoClockOutLog.id);
            setShowClockOutCorrection(false);
            setAutoClockOutLog(null);
            setCorrectionTime('');
            setClockSuccess('Clock-out time corrected successfully!');
            setTimeout(() => setClockSuccess(''), 5000);
            fetchDashboardData();
        } catch {
            setClockError('Failed to correct clock-out time');
        }
        setCorrectionSaving(false);
    }

    async function markTaskDone(taskId: string) {
        await supabase
            .from('tasks')
            .update({ status: 'Completed', completed_at: new Date().toISOString() })
            .eq('id', taskId);
        fetchDashboardData();
        if (activeTab === 'tasks') fetchAllTasks();
    }

    async function updateTaskStatus(taskId: string, newStatus: string) {
        const updateData: Record<string, unknown> = { status: newStatus };
        if (newStatus === 'Completed') {
            updateData.completed_at = new Date().toISOString();
        }
        await supabase.from('tasks').update(updateData).eq('id', taskId);
        // Update local viewingTask state
        if (viewingTask && viewingTask.id === taskId) {
            setViewingTask({ ...viewingTask, status: newStatus });
        }
        fetchDashboardData();
        if (activeTab === 'tasks') fetchAllTasks();
    }

    // Task comments
    async function fetchComments(taskId: string) {
        const { data } = await supabase
            .from('task_comments')
            .select('*, staff!task_comments_staff_id_fkey(name, staff_code, role)')
            .eq('task_id', taskId)
            .order('created_at', { ascending: true });
        if (data) setTaskComments(data);
    }

    function openTaskDetail(task: Task) {
        setViewingTask(task);
        fetchComments(task.id);
    }

    async function postComment() {
        if (!viewingTask || !session || (!commentText.trim() && !commentFile)) return;
        setCommentSending(true);
        let attachmentUrl: string | null = null;

        if (commentFile) {
            const ext = commentFile.name.split('.').pop() || 'jpg';
            const path = `${viewingTask.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('task-attachments')
                .upload(path, commentFile, { contentType: commentFile.type });
            if (!upErr) {
                const { data: urlData } = supabase.storage.from('task-attachments').getPublicUrl(path);
                attachmentUrl = urlData?.publicUrl || null;
            }
        }

        await supabase.from('task_comments').insert({
            task_id: viewingTask.id,
            staff_id: session.staff.id,
            content: commentText.trim() || null,
            attachment_url: attachmentUrl,
        });
        setCommentText('');
        setCommentFile(null);
        setCommentPreview(null);
        setCommentSending(false);
        fetchComments(viewingTask.id);
    }

    function handleCommentFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setCommentFile(file);
        const reader = new FileReader();
        reader.onload = () => setCommentPreview(reader.result as string);
        reader.readAsDataURL(file);
    }



    function handleLogout() {
        logout();
        router.push('/staff/login');
    }

    if (loading) {
        return (
            <div style={styles.loadingContainer}>
                <div style={styles.spinner} className="animate-pulse-slow" />
            </div>
        );
    }

    const isCheckedIn = openLog !== null;

    // ── Tab content renderers ──

    function renderHome() {
        const dueTasks = todayTasks.filter(t => t.status !== 'Completed');
        const completedTasks = todayTasks.filter(t => t.status === 'Completed');
        const overdueTasks = todayTasks.filter(t => t.due_date < today && t.status !== 'Completed');

        return (
            <div style={styles.cardsContainer}>
                {/* Attendance Card */}
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <span style={styles.cardIcon}>📍</span>
                        <h3 style={styles.cardTitle}>{t(lang, 'attTitle')}</h3>
                        <span style={{
                            ...styles.statusBadge,
                            background: isCheckedIn ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: isCheckedIn ? '#22c55e' : '#ef4444',
                        }}>
                            {isCheckedIn ? t(lang, 'attCheckedIn') : t(lang, 'attCheckedOut')}
                        </span>
                    </div>
                    {isCheckedIn && openLog && (
                        <p style={styles.cardSub}>
                            {t(lang, 'attLastCheckIn')}: {formatTimeMedellin(openLog.check_in, lang)}
                        </p>
                    )}
                    {clockSuccess && (
                        <div style={styles.successBanner} className="animate-fadeIn">✅ {clockSuccess}</div>
                    )}
                    {clockError && (
                        <div style={styles.errorBanner} className="animate-fadeIn">⚠️ {clockError}</div>
                    )}

                    {geoStatus === 'idle' && (
                        <button onClick={getLocation} className="btn-primary" style={styles.cardBtn}>
                            📍 {t(lang, 'attNeedLocation')}
                        </button>
                    )}
                    {geoStatus === 'loading' && (
                        <div style={styles.cardSub}>⏳ {t(lang, 'loadingTitle')}</div>
                    )}
                    {geoStatus === 'too_far' && (
                        <div style={styles.warningBanner}>🚫 {t(lang, 'attTooFar')}</div>
                    )}
                    {geoStatus === 'error' && (
                        <button onClick={getLocation} className="btn-primary" style={styles.cardBtn}>
                            {t(lang, 'tryAgain')}
                        </button>
                    )}
                    {geoStatus === 'ok' && (
                        <div style={styles.btnRow}>
                            {!isCheckedIn ? (
                                <button
                                    onClick={() => handleClock('check_in')}
                                    className="btn-primary"
                                    disabled={clockLoading}
                                    style={{ flex: 1 }}
                                >
                                    {clockLoading ? '...' : t(lang, 'attCheckInBtn')}
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleClock('check_out')}
                                    className="btn-secondary"
                                    disabled={clockLoading}
                                    style={{ flex: 1 }}
                                >
                                    {clockLoading ? '...' : t(lang, 'attCheckOutBtn')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Auto Clock-Out Correction Card */}
                {showClockOutCorrection && autoClockOutLog && (
                    <div style={{ ...styles.card, borderColor: '#ef4444', borderWidth: 1, borderStyle: 'solid' }}>
                        <div style={styles.cardHeader}>
                            <span style={styles.cardIcon}>⏰</span>
                            <h3 style={{ ...styles.cardTitle, color: '#ef4444' }}>Auto Clock-Out</h3>
                        </div>
                        <p style={{ color: '#ccc', fontSize: 13, margin: '0 0 8px', lineHeight: 1.5 }}>
                            You were checked in for more than 10 hours and were automatically clocked out. Please enter your actual clock-out time below.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888' }}>
                                <span>Checked in:</span>
                                <span style={{ color: '#fff' }}>{formatTimeMedellin(autoClockOutLog.check_in, lang)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888' }}>
                                <span>Auto clocked out at:</span>
                                <span style={{ color: '#ef4444' }}>{autoClockOutLog.check_out ? formatTimeMedellin(autoClockOutLog.check_out, lang) : '—'}</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                            <label style={{ color: '#999', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Actual clock-out:</label>
                            <input
                                type="time"
                                value={correctionTime}
                                onChange={e => setCorrectionTime(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    background: '#111',
                                    borderWidth: '1px',
                                    borderStyle: 'solid',
                                    borderColor: '#333',
                                    borderRadius: 8,
                                    color: '#fff',
                                    fontSize: 14,
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={handleClockOutCorrection}
                                disabled={correctionSaving || !correctionTime}
                                className="btn-primary"
                                style={{ flex: 1 }}
                            >
                                {correctionSaving ? '...' : '✓ Submit Correct Time'}
                            </button>
                            <button
                                onClick={() => { setShowClockOutCorrection(false); setAutoClockOutLog(null); fetchDashboardData(); }}
                                className="btn-secondary"
                                style={{ flex: 0, padding: '8px 16px', whiteSpace: 'nowrap' }}
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                )}

                {/* Shift Card */}
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <span style={styles.cardIcon}>🕐</span>
                        <h3 style={styles.cardTitle}>{t(lang, 'shiftTitle')}</h3>
                    </div>
                    {todayShift ? (
                        <div style={styles.shiftGrid}>
                            <div style={styles.shiftItem}>
                                <span style={styles.shiftLabel}>{t(lang, 'shiftStart')}</span>
                                <span style={styles.shiftValue}>{todayShift.start_time.slice(0, 5)}</span>
                            </div>
                            <div style={styles.shiftItem}>
                                <span style={styles.shiftLabel}>{t(lang, 'shiftEnd')}</span>
                                <span style={styles.shiftValue}>{todayShift.end_time.slice(0, 5)}</span>
                            </div>
                            <div style={styles.shiftItem}>
                                <span style={styles.shiftLabel}>Shift</span>
                                <span style={{ ...styles.shiftValue, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: todayShift.color, display: 'inline-block' }} />
                                    {todayShift.name}
                                </span>
                            </div>
                            <div style={styles.shiftItem}>
                                <span style={styles.shiftLabel}>{t(lang, 'histStatus')}</span>
                                <span style={{ ...styles.shiftValue, color: isCheckedIn ? '#22c55e' : '#888' }}>
                                    {isCheckedIn ? t(lang, 'shiftOnTime') : t(lang, 'attCheckedOut')}
                                </span>
                            </div>
                            {/* Check-in window info */}
                            {!isCheckedIn && (() => {
                                const [h, m] = todayShift.start_time.split(':').map(Number);
                                const earliest = new Date(); earliest.setHours(h, m - todayShift.early_checkin_minutes, 0, 0);
                                const latest = new Date(); latest.setHours(h, m + todayShift.late_grace_minutes, 0, 0);
                                const now = new Date();
                                const tooEarly = now < earliest;
                                const tooLate = now > latest;
                                const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                                return (
                                    <div style={{ gridColumn: '1 / -1', background: tooLate ? 'rgba(239,68,68,0.08)' : tooEarly ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)', border: `1px solid ${tooLate ? 'rgba(239,68,68,0.2)' : tooEarly ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 10, padding: '8px 12px', marginTop: 4 }}>
                                        <div style={{ fontSize: 12, color: tooLate ? '#ef4444' : tooEarly ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
                                            {tooEarly ? `⏳ Check-in opens at ${fmt(earliest)}` : tooLate ? (todayShift.block_outside_window ? '🚫 Check-in window closed' : `⚠️ Late — window closed at ${fmt(latest)}`) : `✅ Check-in window open until ${fmt(latest)}`}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    ) : (
                        <p style={styles.emptyText}>{t(lang, 'shiftNoShift')}</p>
                    )}
                </div>

                {/* Break Card — only visible when checked in */}
                {openLog && (
                    <div style={{ ...styles.card, border: activeBreak ? '1px solid rgba(245,158,11,0.4)' : undefined }}>
                        <div style={styles.cardHeader}>
                            <span style={styles.cardIcon}>☕</span>
                            <h3 style={styles.cardTitle}>Break</h3>
                            {breakCount > 0 && (
                                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888', background: '#222', borderRadius: 20, padding: '3px 10px' }}>
                                    {breakCount} break{breakCount !== 1 ? 's' : ''} taken
                                </span>
                            )}
                        </div>

                        {activeBreak && (
                            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, textAlign: 'center' }}>
                                <div style={{ color: '#f59e0b', fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                                    {`${Math.floor(breakTimer / 60)}:${(breakTimer % 60).toString().padStart(2, '0')}`}
                                </div>
                                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>Break in progress</div>
                            </div>
                        )}

                        {breakError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{breakError}</p>}
                        {breakSuccess && <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{breakSuccess}</p>}

                        {geoStatus === 'ok' ? (
                            <button
                                onClick={() => handleBreak(activeBreak ? 'break_end' : 'break_start')}
                                disabled={breakLoading}
                                style={{
                                    width: '100%', padding: '14px', borderRadius: 14,
                                    background: activeBreak ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.1)',
                                    border: `2px solid ${activeBreak ? '#f59e0b' : '#22c55e'}`,
                                    color: activeBreak ? '#f59e0b' : '#22c55e',
                                    fontSize: 15, fontWeight: 700, cursor: breakLoading ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s', opacity: breakLoading ? 0.6 : 1,
                                }}
                            >
                                {breakLoading ? '...' : activeBreak ? '⏹ End Break' : '▶ Start Break'}
                            </button>
                        ) : (
                            <p style={{ color: '#555', fontSize: 12, textAlign: 'center' }}>Location required to start/end break.</p>
                        )}
                    </div>
                )}

                {/* Tasks Card */}
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <span style={styles.cardIcon}>✅</span>
                        <h3 style={styles.cardTitle}>{t(lang, 'tasksTitle')}</h3>
                    </div>
                    {todayTasks.length > 0 ? (
                        <>
                            <div style={styles.taskCountRow}>
                                <div style={styles.taskCount}>
                                    <span style={{ color: '#f0b427', fontSize: 20, fontWeight: 800 }}>{dueTasks.length}</span>
                                    <span style={styles.taskCountLabel}>{t(lang, 'tasksDue')}</span>
                                </div>
                                <div style={styles.taskCount}>
                                    <span style={{ color: '#22c55e', fontSize: 20, fontWeight: 800 }}>{completedTasks.length}</span>
                                    <span style={styles.taskCountLabel}>{t(lang, 'tasksCompleted')}</span>
                                </div>
                                <div style={styles.taskCount}>
                                    <span style={{ color: '#ef4444', fontSize: 20, fontWeight: 800 }}>{overdueTasks.length}</span>
                                    <span style={styles.taskCountLabel}>{t(lang, 'tasksOverdue')}</span>
                                </div>
                            </div>
                            {dueTasks.slice(0, 3).map(task => {
                                const statusDef = customStatuses.find(s => s.label === task.status);
                                const badgeBg = statusDef?.color ? `${statusDef.color}22` : 'rgba(240,180,39,0.15)';
                                const badgeColor = statusDef?.color || '#f0b427';
                                return (
                                    <div key={task.id} style={styles.taskItem} onClick={() => { setViewingTask(task); fetchComments(task.id); }}>
                                        <span style={styles.taskName}>{task.title}</span>
                                        <span style={{
                                            padding: '3px 10px',
                                            borderRadius: 12,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: badgeBg,
                                            color: badgeColor,
                                            textTransform: 'capitalize' as const,
                                        }}>
                                            {task.status}
                                        </span>
                                    </div>
                                );
                            })}
                            <button onClick={() => setActiveTab('tasks')} style={styles.linkBtn}>
                                {t(lang, 'tasksViewAll')}
                            </button>
                        </>
                    ) : (
                        <p style={styles.emptyText}>{t(lang, 'tasksNoTasks')}</p>
                    )}
                </div>



                {/* Alerts Card */}
                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <span style={styles.cardIcon}>🔔</span>
                        <h3 style={styles.cardTitle}>{t(lang, 'alertsTitle')}</h3>
                    </div>
                    {alerts.length > 0 ? (
                        alerts.map((alert, i) => (
                            <div key={i} style={styles.alertItem}>⚠️ {alert}</div>
                        ))
                    ) : (
                        <p style={styles.emptyText}>{t(lang, 'alertNoAlerts')}</p>
                    )}
                </div>
            </div>
        );
    }

    function renderHistory() {
        return (
            <div style={styles.pageContent}>
                <h2 style={styles.pageTitle}>{t(lang, 'histTitle')}</h2>
                {historyLogs.length > 0 ? (
                    <div style={styles.historyList}>
                        {historyLogs.map(log => (
                            <div key={log.id} style={styles.historyItem}>
                                <div style={styles.histDate}>
                                    {new Date(log.check_in).toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', {
                                        timeZone: 'America/Bogota', weekday: 'short', month: 'short', day: 'numeric',
                                    })}
                                </div>
                                <div style={styles.histTimes}>
                                    <span style={styles.histTimeLabel}>{t(lang, 'histIn')}</span>
                                    <span style={styles.histTimeValue}>{formatTimeMedellin(log.check_in, lang)}</span>
                                </div>
                                <div style={styles.histTimes}>
                                    <span style={styles.histTimeLabel}>{t(lang, 'histOut')}</span>
                                    <span style={styles.histTimeValue}>
                                        {log.check_out ? formatTimeMedellin(log.check_out, lang) : t(lang, 'histStillIn')}
                                    </span>
                                </div>
                                <div style={styles.histHours}>
                                    {log.total_hours ? `${log.total_hours.toFixed(1)}h` : '-'}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p style={styles.emptyText}>{t(lang, 'histNoRecords')}</p>
                )}
            </div>
        );
    }

    function renderTasks() {
        const filtered = allTasks.filter(task => {
            if (tasksTab === 'completed') return task.status === 'Completed';
            if (tasksTab === 'upcoming') return task.status !== 'Completed' && task.due_date > today;
            return task.due_date === today && task.status !== 'Completed';
        });

        return (
            <div style={styles.pageContent}>
                <h2 style={styles.pageTitle}>{t(lang, 'tasksPageTitle')}</h2>
                <div style={styles.tabsRow}>
                    {(['today', 'upcoming', 'completed'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setTasksTab(tab)}
                            style={{
                                ...styles.tabBtn,
                                ...(tasksTab === tab ? styles.tabBtnActive : {}),
                            }}
                        >
                            {t(lang, tab === 'today' ? 'tasksTabToday' : tab === 'upcoming' ? 'tasksTabUpcoming' : 'tasksTabCompleted')}
                        </button>
                    ))}
                </div>
                {filtered.length > 0 ? (
                    filtered.map(task => (
                        <div key={task.id} style={{ ...styles.taskCard, cursor: 'pointer' }} onClick={() => openTaskDetail(task)}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                    <p style={styles.taskCardTitle}>{task.title}</p>
                                    {task.priority && (
                                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: task.priority === 'High' ? 'rgba(239,68,68,0.15)' : task.priority === 'Medium' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)', color: task.priority === 'High' ? '#ef4444' : task.priority === 'Medium' ? '#f59e0b' : '#22c55e' }}>
                                            {task.priority === 'High' ? '🔴' : task.priority === 'Medium' ? '🟡' : '🟢'} {task.priority}
                                        </span>
                                    )}
                                </div>
                                <p style={styles.taskCardDate}>{t(lang, 'tasksDueDate', { date: task.due_date })}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, color: '#818cf8' }}>💬</span>
                                {(() => {
                                    const statusDef = customStatuses.find(s => s.label === task.status);
                                    const bgColor = task.status === 'Completed'
                                        ? 'rgba(34,197,94,0.15)'
                                        : statusDef?.color
                                            ? `${statusDef.color}22`
                                            : 'rgba(240,180,39,0.15)';
                                    const textColor = task.status === 'Completed'
                                        ? '#22c55e'
                                        : statusDef?.color || '#f0b427';
                                    return (
                                        <span style={{
                                            padding: '3px 10px',
                                            borderRadius: 12,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: bgColor,
                                            color: textColor,
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {task.status === 'Completed' ? '✓ ' : ''}{task.status}
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    ))
                ) : (
                    <p style={styles.emptyText}>{t(lang, 'tasksEmpty')}</p>
                )}

                {/* Task Detail + Comments Modal */}
                {viewingTask && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                        <div style={{ background: '#1a1a2e', borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2a4a', borderRadius: 16, maxWidth: 480, width: '100%', padding: 24, maxHeight: '85vh', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                <div style={{ flex: 1 }}>
                                    <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>{viewingTask.title}</h3>
                                    {viewingTask.description && <p style={{ color: '#888', fontSize: 12, margin: '4px 0 0' }}>{viewingTask.description}</p>}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                        <span style={{ color: '#666', fontSize: 11 }}>📅 Due: {viewingTask.due_date}</span>
                                        {viewingTask.priority && (
                                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: viewingTask.priority === 'High' ? 'rgba(239,68,68,0.15)' : viewingTask.priority === 'Medium' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)', color: viewingTask.priority === 'High' ? '#ef4444' : viewingTask.priority === 'Medium' ? '#f59e0b' : '#22c55e' }}>
                                                {viewingTask.priority === 'High' ? '🔴' : viewingTask.priority === 'Medium' ? '🟡' : '🟢'} {viewingTask.priority}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button onClick={() => { setViewingTask(null); setTaskComments([]); setCommentText(''); setCommentFile(null); setCommentPreview(null); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>✕</button>
                            </div>

                            {/* Status Changer */}
                            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ color: '#999', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</label>
                                <select
                                    value={viewingTask.status}
                                    onChange={e => updateTaskStatus(viewingTask.id, e.target.value)}
                                    style={{
                                        flex: 1,
                                        padding: '8px 12px',
                                        background: '#111',
                                        borderWidth: 1, borderStyle: 'solid', borderColor: '#333',
                                        borderRadius: 8,
                                        color: '#fff',
                                        fontSize: 13,
                                        cursor: 'pointer',
                                        outline: 'none',
                                    }}
                                >
                                    {customStatuses.map(s => (
                                        <option key={s.id} value={s.label}>{s.label}</option>
                                    ))}
                                    {!customStatuses.find(s => s.label === viewingTask.status) && (
                                        <option value={viewingTask.status}>{viewingTask.status}</option>
                                    )}
                                </select>
                            </div>

                            {/* Comments */}
                            <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 12 }}>
                                <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>💬 Comments ({taskComments.length})</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                                    {taskComments.length === 0 ? (
                                        <p style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>No comments yet</p>
                                    ) : taskComments.map(c => {
                                        const staffInfo = c.staff as any;
                                        const isMe = c.staff_id === session?.staff.id;
                                        const isAdmin = staffInfo?.role === 'admin';
                                        return (
                                            <div key={c.id} style={{ background: isMe ? 'rgba(240,180,39,0.06)' : '#111', border: `1px solid ${isMe ? 'rgba(240,180,39,0.15)' : '#222'}`, borderRadius: 10, padding: 10 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: isAdmin ? '#f0b427' : '#fff' }}>
                                                        {isMe ? 'You' : (staffInfo?.name || 'Unknown')} {isAdmin && <span style={{ fontSize: 10, color: '#888' }}>Admin</span>}
                                                    </span>
                                                    <span style={{ fontSize: 10, color: '#555' }}>
                                                        {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                {c.content && <p style={{ color: '#ccc', fontSize: 13, margin: 0, lineHeight: 1.4 }}>{c.content}</p>}
                                                {c.attachment_url && (
                                                    <div style={{ marginTop: 6 }}>
                                                        <img src={c.attachment_url} alt="attachment" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: '#333', cursor: 'pointer' }} onClick={() => window.open(c.attachment_url!, '_blank')} />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Comment Input */}
                                {commentPreview && (
                                    <div style={{ position: 'relative', marginBottom: 8 }}>
                                        <img src={commentPreview} alt="preview" style={{ maxHeight: 80, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: '#333' }} />
                                        <button onClick={() => { setCommentFile(null); setCommentPreview(null); }} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', borderWidth: 0, borderStyle: 'none', color: '#fff', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input type="file" ref={commentFileRef} accept="image/*" onChange={handleCommentFile} style={{ display: 'none' }} />
                                    <button onClick={() => commentFileRef.current?.click()} title="Attach image" style={{ background: 'rgba(129,140,248,0.1)', borderWidth: 1, borderStyle: 'solid', borderColor: '#333', borderRadius: 8, padding: '8px 10px', color: '#818cf8', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>📎</button>
                                    <input className="input-field" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Write a comment..." onKeyDown={e => e.key === 'Enter' && !e.shiftKey && postComment()} style={{ flex: 1, minWidth: 0, width: 'auto', fontSize: 12, padding: '8px 12px' }} />
                                    <button onClick={postComment} disabled={commentSending || (!commentText.trim() && !commentFile)} className="btn-primary" style={{ width: 'auto', padding: '8px 14px', fontSize: 12, flexShrink: 0 }}>
                                        {commentSending ? '...' : '📤'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }



    function renderProfile() {
        return (
            <div style={styles.pageContent}>
                <h2 style={styles.pageTitle}>{t(lang, 'profileTitle')}</h2>
                <div style={styles.profileCard}>
                    <div style={styles.profileAvatar}>
                        {session?.staff.name?.charAt(0).toUpperCase()}
                    </div>
                    <div style={styles.profileField}>
                        <span style={styles.profileLabel}>{t(lang, 'profileName')}</span>
                        <span style={styles.profileValue}>{session?.staff.name}</span>
                    </div>
                    <div style={styles.profileField}>
                        <span style={styles.profileLabel}>{t(lang, 'profileStaffId')}</span>
                        <span style={{ ...styles.profileValue, fontFamily: 'monospace', color: '#f0b427' }}>{session?.staff.staff_code}</span>
                    </div>
                    <div style={styles.profileField}>
                        <span style={styles.profileLabel}>{t(lang, 'profileRole')}</span>
                        <span style={styles.profileValue}>{session?.staff.role}</span>
                    </div>
                    <button onClick={handleLogout} className="btn-primary" style={{ marginTop: 24, background: '#ef4444' }}>
                        {t(lang, 'profileLogout')}
                    </button>
                </div>
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
                        <p style={styles.headerSub}>{t(lang, 'dashTitle')}</p>
                    </div>
                </div>
                <div style={styles.headerRight}>
                    <span style={styles.staffName}>{session?.staff.name}</span>
                    <button onClick={handleLogout} style={styles.logoutBtn}>{t(lang, 'dashLogout')}</button>
                </div>
            </header>

            {/* Content */}
            <main style={styles.main}>
                {activeTab === 'home' && renderHome()}
                {activeTab === 'history' && renderHistory()}
                {activeTab === 'tasks' && renderTasks()}
                {activeTab === 'profile' && renderProfile()}
            </main>

            {/* Bottom Navigation */}
            <nav style={styles.bottomNav}>
                {([
                    { key: 'home' as Tab, icon: '🏠', label: t(lang, 'dashHome') },
                    { key: 'history' as Tab, icon: '📋', label: t(lang, 'dashHistory') },
                    { key: 'tasks' as Tab, icon: '✅', label: t(lang, 'dashTasks') },
                    { key: 'profile' as Tab, icon: '👤', label: t(lang, 'dashProfile') },
                ]).map(item => (
                    <button
                        key={item.key}
                        onClick={() => setActiveTab(item.key)}
                        style={{
                            ...styles.navItem,
                            color: activeTab === item.key ? '#f0b427' : '#666',
                        }}
                    >
                        <span style={styles.navIcon}>{item.icon}</span>
                        <span style={styles.navLabel}>{item.label}</span>
                    </button>
                ))}
            </nav>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    page: {
        minHeight: '100vh',
        background: '#111',
        display: 'flex',
        flexDirection: 'column' as const,
        paddingBottom: '80px',
    },
    loadingContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111',
    },
    spinner: {
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: '#f0b427',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        background: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        position: 'sticky' as const,
        top: 0,
        zIndex: 100,
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
        letterSpacing: '1px',
        textTransform: 'uppercase' as const,
        margin: 0,
    },
    headerRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    staffName: {
        color: '#999',
        fontSize: '13px',
        fontWeight: 500,
    },
    logoutBtn: {
        background: 'rgba(239,68,68,0.1)',
        color: '#ef4444',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(239,68,68,0.2)',
        borderRadius: '8px',
        padding: '6px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: 600,
    },
    main: {
        flex: 1,
        padding: '20px',
        maxWidth: '600px',
        margin: '0 auto',
        width: '100%',
    },
    cardsContainer: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '16px',
    },
    card: {
        background: '#1a1a1a',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: '#2a2a2a',
        borderRadius: '16px',
        padding: '20px',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '12px',
    },
    cardIcon: {
        fontSize: '20px',
    },
    cardTitle: {
        fontSize: '15px',
        fontWeight: 700,
        color: '#fff',
        margin: 0,
        flex: 1,
    },
    cardSub: {
        fontSize: '13px',
        color: '#999',
        margin: '0 0 12px',
    },
    cardBtn: {
        marginTop: '8px',
        fontSize: '14px',
        padding: '12px',
    },
    statusBadge: {
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 600,
    },
    successBanner: {
        padding: '10px 14px',
        background: 'rgba(34,197,94,0.1)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(34,197,94,0.2)',
        borderRadius: '10px',
        color: '#22c55e',
        fontSize: '13px',
        marginBottom: '12px',
    },
    errorBanner: {
        padding: '10px 14px',
        background: 'rgba(239,68,68,0.1)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(239,68,68,0.2)',
        borderRadius: '10px',
        color: '#ef4444',
        fontSize: '13px',
        marginBottom: '12px',
    },
    warningBanner: {
        padding: '10px 14px',
        background: 'rgba(240,180,39,0.08)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(240,180,39,0.2)',
        borderRadius: '10px',
        color: '#f0b427',
        fontSize: '13px',
        marginTop: '8px',
    },
    btnRow: {
        display: 'flex',
        gap: '12px',
        marginTop: '12px',
    },
    // Shift
    shiftGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
    },
    shiftItem: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '2px',
    },
    shiftLabel: {
        fontSize: '11px',
        color: '#666',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    shiftValue: {
        fontSize: '16px',
        fontWeight: 700,
        color: '#fff',
    },
    // Tasks
    taskCountRow: {
        display: 'flex',
        gap: '16px',
        marginBottom: '12px',
    },
    taskCount: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        flex: 1,
    },
    taskCountLabel: {
        fontSize: '11px',
        color: '#666',
        textTransform: 'uppercase' as const,
    },
    taskItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderTop: '1px solid #2a2a2a',
    },
    taskName: {
        fontSize: '14px',
        color: '#ccc',
    },
    taskDoneBtn: {
        background: 'rgba(34,197,94,0.1)',
        color: '#22c55e',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(34,197,94,0.2)',
        borderRadius: '8px',
        padding: '4px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: 600,
    },
    linkBtn: {
        background: 'none',
        borderWidth: 0,
        borderStyle: 'none',
        color: '#f0b427',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        padding: '8px 0',
        display: 'block',
        width: '100%',
        textAlign: 'left' as const,
    },
    unreadBadge: {
        padding: '3px 8px',
        borderRadius: '12px',
        background: '#ef4444',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 700,
    },
    msgPreview: {
        fontSize: '14px',
        color: '#999',
        margin: '0 0 8px',
        lineHeight: 1.5,
    },
    alertItem: {
        padding: '8px 12px',
        background: 'rgba(239,68,68,0.08)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(239,68,68,0.15)',
        borderRadius: '8px',
        color: '#ef4444',
        fontSize: '13px',
        marginBottom: '8px',
    },
    emptyText: {
        color: '#666',
        fontSize: '14px',
        margin: 0,
        textAlign: 'center' as const,
        padding: '12px 0',
    },
    // Bottom nav
    bottomNav: {
        position: 'fixed' as const,
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        background: '#1a1a1a',
        borderTop: '1px solid #2a2a2a',
        padding: '8px 0',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        zIndex: 200,
    },
    navItem: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        gap: '2px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '6px 0',
        position: 'relative' as const,
    },
    navIcon: {
        fontSize: '20px',
    },
    navLabel: {
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.5px',
    },
    navBadge: {
        position: 'absolute' as const,
        top: '2px',
        right: '20%',
        background: '#ef4444',
        color: '#fff',
        fontSize: '9px',
        fontWeight: 800,
        borderRadius: '8px',
        padding: '1px 5px',
        minWidth: '14px',
        textAlign: 'center' as const,
    },
    // Page content
    pageContent: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '16px',
    },
    pageTitle: {
        fontSize: '22px',
        fontWeight: 800,
        color: '#fff',
        margin: '0 0 8px',
    },
    // History
    historyList: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '8px',
    },
    historyItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        background: '#1a1a1a',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: '#2a2a2a',
        borderRadius: '12px',
        flexWrap: 'wrap' as const,
    },
    histDate: {
        fontSize: '13px',
        fontWeight: 700,
        color: '#f0b427',
        minWidth: '80px',
    },
    histTimes: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '2px',
        flex: 1,
        minWidth: '60px',
    },
    histTimeLabel: {
        fontSize: '10px',
        color: '#666',
        textTransform: 'uppercase' as const,
    },
    histTimeValue: {
        fontSize: '14px',
        fontWeight: 600,
        color: '#ccc',
    },
    histHours: {
        fontSize: '16px',
        fontWeight: 800,
        color: '#fff',
        minWidth: '45px',
        textAlign: 'right' as const,
    },
    // Tasks page
    tabsRow: {
        display: 'flex',
        gap: '8px',
        marginBottom: '8px',
    },
    tabBtn: {
        flex: 1,
        padding: '10px',
        background: 'transparent',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: '#333',
        borderRadius: '10px',
        color: '#999',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
    },
    tabBtnActive: {
        background: 'rgba(240,180,39,0.1)',
        borderColor: 'rgba(240,180,39,0.3)',
        color: '#f0b427',
    },
    taskCard: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        background: '#1a1a1a',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: '#2a2a2a',
        borderRadius: '12px',
    },
    taskCardTitle: {
        fontSize: '14px',
        fontWeight: 600,
        color: '#fff',
        margin: 0,
    },
    taskCardDate: {
        fontSize: '12px',
        color: '#666',
        margin: '4px 0 0',
    },
    // Messages
    msgInputRow: {
        display: 'flex',
        gap: '8px',
    },
    msgList: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '8px',
    },
    msgBubble: {
        padding: '12px 16px',
        borderRadius: '16px',
        borderWidth: '1px',
        borderStyle: 'solid',
        maxWidth: '85%',
    },
    msgText: {
        fontSize: '14px',
        color: '#ddd',
        margin: 0,
        lineHeight: 1.5,
    },
    msgTime: {
        fontSize: '11px',
        color: '#666',
        marginTop: 4,
        display: 'block',
    },
    // Profile
    profileCard: {
        padding: '32px 24px',
        background: '#1a1a1a',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: '#2a2a2a',
        borderRadius: '20px',
        textAlign: 'center' as const,
    },
    profileAvatar: {
        width: '72px',
        height: '72px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #f0b427 0%, #d9a020 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '32px',
        fontWeight: 900,
        color: '#111',
        margin: '0 auto 24px',
    },
    profileField: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '14px 0',
        borderBottom: '1px solid #2a2a2a',
    },
    profileLabel: {
        fontSize: '13px',
        color: '#666',
        fontWeight: 500,
    },
    profileValue: {
        fontSize: '14px',
        fontWeight: 700,
        color: '#fff',
    },
};
