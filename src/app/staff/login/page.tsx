'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { login, isAuthenticated } from '@/lib/auth';
import { Lang, t } from '@/lib/i18n';

export default function StaffLoginPage() {
    const router = useRouter();
    const [staffCode, setStaffCode] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [locked, setLocked] = useState(false);
    const [lockTimer, setLockTimer] = useState(0);
    const [lang, setLang] = useState<Lang>('es');

    useEffect(() => {
        const saved = localStorage.getItem('smokeys_lang') as Lang | null;
        if (saved === 'en' || saved === 'es') setLang(saved);
    }, []);

    // Redirect if already logged in
    useEffect(() => {
        if (isAuthenticated()) {
            router.push('/staff/dashboard');
        }
    }, [router]);

    // Lockout countdown
    useEffect(() => {
        if (!locked || lockTimer <= 0) return;
        const interval = setInterval(() => {
            setLockTimer(prev => {
                if (prev <= 1) {
                    setLocked(false);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [locked, lockTimer]);

    const handleLogin = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!staffCode.trim() || !pin.trim()) {
            setError(t(lang, 'staffLoginEnterBoth'));
            return;
        }
        if (locked) return;

        setLoading(true);
        setError('');

        const result = await login(staffCode, pin);

        if (result.success) {
            router.push('/staff/dashboard');
        } else {
            setError(result.error || t(lang, 'staffLoginFailed'));
            if (result.locked) {
                setLocked(true);
                setLockTimer((result.lockout_minutes || 10) * 60);
            }
        }

        setLoading(false);
    }, [staffCode, pin, locked, lang, router]);

    function toggleLang() {
        const next: Lang = lang === 'en' ? 'es' : 'en';
        setLang(next);
        localStorage.setItem('smokeys_lang', next);
    }

    const formatTimer = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    return (
        <div style={styles.container}>
            <div style={styles.card} className="animate-fadeIn">
                <button onClick={toggleLang} style={styles.langToggle}>
                    {t(lang, 'langToggle')}
                </button>

                <div style={styles.logoSection}>
                    <span style={styles.catEmoji}>🐈‍⬛</span>
                    <h1 style={styles.title}>{t(lang, 'appTitle')}</h1>
                    <p style={styles.subtitle}>{t(lang, 'staffPortal')}</p>
                </div>

                <form onSubmit={handleLogin} style={styles.form}>
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>{t(lang, 'staffId')}</label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder={t(lang, 'staffIdPlaceholder')}
                            value={staffCode}
                            onChange={(e) => setStaffCode(e.target.value.toUpperCase())}
                            autoCapitalize="characters"
                            autoComplete="off"
                            disabled={loading || locked}
                        />
                    </div>

                    <div style={styles.inputGroup}>
                        <label style={styles.label}>{t(lang, 'pin')}</label>
                        <input
                            type="password"
                            className="input-field"
                            placeholder={t(lang, 'pinPlaceholder')}
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            maxLength={6}
                            autoComplete="off"
                            disabled={loading || locked}
                        />
                    </div>

                    {error && (
                        <div style={styles.errorBanner} className="animate-fadeIn">
                            <span>⚠️</span> {error}
                        </div>
                    )}

                    {locked && (
                        <div style={styles.lockBanner} className="animate-fadeIn">
                            <span style={styles.lockIcon}>🔒</span>
                            <div>
                                <p style={styles.lockText}>{t(lang, 'staffLoginLocked')}</p>
                                <p style={styles.lockTimer}>{t(lang, 'staffLoginRetryIn')} {formatTimer(lockTimer)}</p>
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={loading || locked}
                        style={{ marginTop: 8 }}
                    >
                        {loading ? t(lang, 'staffLoginSigningIn') : t(lang, 'staffLoginSignIn')}
                    </button>
                </form>

                <div style={styles.links}>
                    <a href="/" style={styles.link}>← {t(lang, 'staffLoginBackToClock')}</a>
                    <a href="/admin" style={styles.link}>{t(lang, 'adminDashboard')}</a>
                </div>
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
        position: 'relative' as const,
    },
    langToggle: {
        position: 'absolute' as const,
        top: '16px',
        right: '16px',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '20px',
        padding: '6px 14px',
        color: '#ccc',
        fontSize: '13px',
        cursor: 'pointer',
        fontWeight: 500,
        transition: 'background 0.2s',
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
        color: '#999',
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
    lockBanner: {
        padding: '16px',
        background: 'rgba(240, 180, 39, 0.08)',
        border: '1px solid rgba(240, 180, 39, 0.2)',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    lockIcon: {
        fontSize: '28px',
    },
    lockText: {
        color: '#f0b427',
        fontSize: '14px',
        fontWeight: 600,
        margin: 0,
    },
    lockTimer: {
        color: '#999',
        fontSize: '24px',
        fontWeight: 800,
        fontFamily: 'monospace',
        margin: '4px 0 0',
    },
    links: {
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '24px',
    },
    link: {
        fontSize: '13px',
        color: '#666',
        textDecoration: 'none',
    },
};
