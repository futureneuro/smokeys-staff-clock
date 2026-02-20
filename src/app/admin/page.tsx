'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EDGE_FUNCTION_URL } from '@/lib/supabase';

export default function AdminLoginPage() {
    const router = useRouter();
    const [staffCode, setStaffCode] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (!staffCode.trim() || !pin.trim()) {
            setError('Please enter your Admin ID and PIN.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // We verify admin credentials via a special admin-verify endpoint
            // For MVP, we'll use the Supabase client directly
            const { supabase } = await import('@/lib/supabase');

            const { data: staff, error: fetchError } = await supabase
                .from('staff')
                .select('*')
                .eq('staff_code', staffCode.trim().toUpperCase())
                .eq('role', 'admin')
                .eq('active', true)
                .single();

            if (fetchError || !staff) {
                setError('Invalid Admin ID or insufficient permissions.');
                setLoading(false);
                return;
            }

            // Verify PIN via RPC
            const { data: pinValid } = await supabase.rpc('verify_pin', {
                p_staff_id: staff.id,
                p_pin: pin.trim(),
            });

            if (!pinValid) {
                setError('Invalid PIN.');
                setLoading(false);
                return;
            }

            // Store admin session in sessionStorage
            sessionStorage.setItem('admin_session', JSON.stringify({
                id: staff.id,
                name: staff.name,
                staff_code: staff.staff_code,
                loginAt: new Date().toISOString(),
            }));

            router.push('/admin/dashboard');
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={styles.container}>
            <div style={styles.card} className="animate-fadeIn">
                <div style={styles.logoSection}>
                    <span style={styles.catEmoji}>🐈‍⬛</span>
                    <h1 style={styles.title}>SMOKEY&apos;S</h1>
                    <p style={styles.subtitle}>Admin Portal</p>
                </div>

                <form onSubmit={handleLogin} style={styles.form}>
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Admin ID</label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="e.g. ADMIN01"
                            value={staffCode}
                            onChange={(e) => setStaffCode(e.target.value.toUpperCase())}
                            autoCapitalize="characters"
                            autoComplete="off"
                            disabled={loading}
                        />
                    </div>

                    <div style={styles.inputGroup}>
                        <label style={styles.label}>PIN</label>
                        <input
                            type="password"
                            className="input-field"
                            placeholder="Enter your PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            maxLength={6}
                            autoComplete="off"
                            disabled={loading}
                        />
                    </div>

                    {error && (
                        <div style={styles.errorBanner} className="animate-fadeIn">
                            <span>⚠️</span> {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={loading}
                        style={{ marginTop: 8 }}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <a href="/" style={styles.backLink}>← Back to Clock</a>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background: 'linear-gradient(180deg, #111111 0%, #0a0a0a 100%)',
    },
    card: {
        width: '100%',
        maxWidth: '400px',
        background: '#1a1a1a',
        borderRadius: '24px',
        padding: '40px 28px',
        border: '1px solid #2a2a2a',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    },
    logoSection: {
        textAlign: 'center' as const,
        marginBottom: '32px',
    },
    catEmoji: {
        fontSize: '48px',
        display: 'block',
        marginBottom: '8px',
    },
    title: {
        fontSize: '28px',
        fontWeight: 900,
        color: '#f0b427',
        letterSpacing: '4px',
        margin: 0,
    },
    subtitle: {
        fontSize: '14px',
        color: '#666',
        letterSpacing: '2px',
        textTransform: 'uppercase' as const,
        marginTop: '4px',
    },
    form: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '16px',
    },
    inputGroup: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '6px',
    },
    label: {
        fontSize: '13px',
        fontWeight: 600,
        color: '#999',
        textTransform: 'uppercase' as const,
        letterSpacing: '1px',
    },
    errorBanner: {
        padding: '12px 16px',
        background: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        borderRadius: '12px',
        color: '#ef4444',
        fontSize: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    backLink: {
        display: 'block',
        textAlign: 'center' as const,
        marginTop: '24px',
        fontSize: '13px',
        color: '#666',
        textDecoration: 'none',
    },
};
