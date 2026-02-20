'use client';

import { useState, useEffect } from 'react';
import { EDGE_FUNCTION_URL, supabase } from '@/lib/supabase';
import { getCurrentPosition, GeoPosition, haversineDistance } from '@/lib/geo';
import { Lang, t, formatDistance, formatTimeMedellin } from '@/lib/i18n';

type AppState = 'needs_permission' | 'loading' | 'location_error' | 'ready' | 'submitting' | 'success';
type ActionType = 'check_in' | 'check_out';

interface ClockResult {
  action: ActionType;
  staff_name: string;
  message: string;
  check_in_time?: string;
  check_out_time?: string;
  total_hours?: number;
}

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>('needs_permission');
  const [geoError, setGeoError] = useState<string>('');
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [staffCode, setStaffCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ClockResult | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(0.1);
  const [lang, setLang] = useState<Lang>('es');

  // Load saved language preference
  useEffect(() => {
    const saved = localStorage.getItem('smokeys_lang') as Lang | null;
    if (saved === 'en' || saved === 'es') setLang(saved);
  }, []);

  async function requestLocation() {
    setAppState('loading');
    setGeoError('');
    try {
      const pos = await getCurrentPosition();
      setPosition(pos);

      const { data: settings } = await supabase
        .from('settings')
        .select('restaurant_lat, restaurant_lng, radius_meters')
        .limit(1)
        .single();

      if (settings?.restaurant_lat && settings?.restaurant_lng) {
        const restaurant: GeoPosition = {
          lat: settings.restaurant_lat,
          lng: settings.restaurant_lng,
        };
        const rKm = (settings.radius_meters || 100) / 1000;
        setRadiusKm(rKm);
        const dist = haversineDistance(pos, restaurant);
        setDistanceKm(dist);

        if (dist > rKm) {
          setGeoError(
            t(lang, 'distError', {
              dist: formatDistance(dist, lang),
              radius: formatDistance(rKm, lang),
            })
          );
          setAppState('location_error');
          return;
        }
      }
      setAppState('ready');
    } catch (err: unknown) {
      setGeoError(err instanceof Error ? err.message : 'Failed to get location');
      setAppState('location_error');
    }
  }

  async function handleClock(action: ActionType) {
    if (!staffCode.trim() || !pin.trim()) {
      setError(t(lang, 'enterBoth'));
      return;
    }
    if (!position) {
      setError(t(lang, 'noLocation'));
      return;
    }

    setError('');
    setAppState('submitting');

    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff_code: staffCode.trim().toUpperCase(),
          pin: pin.trim(),
          action,
          gps_lat: position.lat,
          gps_lng: position.lng,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setAppState('ready');
        return;
      }

      setResult(data);
      setAppState('success');
    } catch {
      setError(t(lang, 'networkError'));
      setAppState('ready');
    }
  }

  function handleReset() {
    setStaffCode('');
    setPin('');
    setError('');
    setResult(null);
    setAppState('ready');
  }

  function toggleLang() {
    const next: Lang = lang === 'en' ? 'es' : 'en';
    setLang(next);
    localStorage.setItem('smokeys_lang', next);
  }

  // ── Language Toggle Button (shared across states) ──
  const langToggleBtn = (
    <button onClick={toggleLang} style={styles.langToggle}>
      {t(lang, 'langToggle')}
    </button>
  );

  // ── Needs Permission State (Mobile) ──
  if (appState === 'needs_permission') {
    return (
      <div style={styles.container}>
        <div style={styles.card} className="animate-fadeIn">
          {langToggleBtn}
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>{t(lang, 'appTitle')}</h1>
            <p style={styles.subtitle}>{t(lang, 'staffClock')}</p>
          </div>
          <div style={styles.permSection}>
            <div style={styles.permIcon}>📍</div>
            <p style={styles.permTitle}>{t(lang, 'permTitle')}</p>
            <p style={styles.permMessage}>{t(lang, 'permMessage')}</p>
            <button
              onClick={requestLocation}
              className="btn-primary"
              style={styles.permButton}
            >
              {t(lang, 'permButton')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading State ──
  if (appState === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.card} className="animate-fadeIn">
          {langToggleBtn}
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>{t(lang, 'appTitle')}</h1>
            <p style={styles.subtitle}>{t(lang, 'staffClock')}</p>
          </div>
          <div style={styles.loadingSection}>
            <div style={styles.spinner} className="animate-pulse-slow" />
            <p style={styles.loadingText}>{t(lang, 'loadingTitle')}</p>
            <p style={styles.loadingHint}>{t(lang, 'loadingHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Location Error State ──
  if (appState === 'location_error') {
    return (
      <div style={styles.container}>
        <div style={styles.card} className="animate-fadeIn">
          {langToggleBtn}
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>{t(lang, 'appTitle')}</h1>
            <p style={styles.subtitle}>{t(lang, 'staffClock')}</p>
          </div>
          <div style={styles.errorSection}>
            <div style={styles.errorIcon}>📍</div>
            <p style={styles.errorTitle}>{t(lang, 'locErrorTitle')}</p>
            <p style={styles.errorMessage}>{geoError}</p>
            <button onClick={requestLocation} className="btn-primary" style={{ marginTop: 16 }}>
              {t(lang, 'tryAgain')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Success State ──
  if (appState === 'success' && result) {
    return (
      <div style={styles.container}>
        <div style={styles.card} className="animate-slideUp">
          {langToggleBtn}
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>{t(lang, 'appTitle')}</h1>
          </div>
          <div style={styles.successSection}>
            <div style={styles.successIcon}>
              {result.action === 'check_in' ? '✅' : '👋'}
            </div>
            <p style={styles.successMessage}>{result.message}</p>

            {result.check_in_time && (
              <p style={styles.timeStamp}>
                🕐 {formatTimeMedellin(result.check_in_time, lang)}
              </p>
            )}
            {result.check_out_time && (
              <p style={styles.timeStamp}>
                🕐 {formatTimeMedellin(result.check_out_time, lang)}
              </p>
            )}

            <p style={styles.catQuote}>
              {result.action === 'check_in'
                ? t(lang, 'checkInQuote')
                : t(lang, 'checkOutQuote')}
            </p>
            {result.total_hours !== undefined && (
              <div style={styles.hoursCard}>
                <span style={styles.hoursLabel}>{t(lang, 'totalHours')}</span>
                <span style={styles.hoursValue}>
                  {Math.floor(result.total_hours)}h {Math.round((result.total_hours - Math.floor(result.total_hours)) * 60)}m
                </span>
              </div>
            )}
          </div>
          <button onClick={handleReset} className="btn-secondary" style={{ marginTop: 24 }}>
            {t(lang, 'done')}
          </button>
        </div>
      </div>
    );
  }

  // ── Ready / Form State ──
  return (
    <div style={styles.container}>
      <div style={styles.card} className="animate-fadeIn">
        {langToggleBtn}
        <div style={styles.logoSection}>
          <span style={styles.catEmoji}>🐈‍⬛</span>
          <h1 style={styles.title}>{t(lang, 'appTitle')}</h1>
          <p style={styles.subtitle}>{t(lang, 'staffClock')}</p>
        </div>

        <div style={styles.locationBadge}>
          <span style={styles.locationDot} />
          {t(lang, 'locVerified')}
          {distanceKm !== null && (
            <span style={{ marginLeft: 4, opacity: 0.7 }}>
              ({formatDistance(distanceKm, lang)} {t(lang, 'away')})
            </span>
          )}
        </div>

        <div style={styles.formSection}>
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
              disabled={appState === 'submitting'}
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
              disabled={appState === 'submitting'}
            />
          </div>

          {error && (
            <div style={styles.errorBanner} className="animate-fadeIn">
              <span>⚠️</span> {error}
            </div>
          )}

          <div style={styles.buttonGroup}>
            <button
              onClick={() => handleClock('check_in')}
              className="btn-primary"
              disabled={appState === 'submitting'}
              style={{ flex: 1 }}
            >
              {appState === 'submitting' ? '...' : t(lang, 'checkIn')}
            </button>
            <button
              onClick={() => handleClock('check_out')}
              className="btn-secondary"
              disabled={appState === 'submitting'}
              style={{ flex: 1 }}
            >
              {appState === 'submitting' ? '...' : t(lang, 'checkOut')}
            </button>
          </div>
        </div>

        <a href="/admin" style={styles.adminLink}>
          {t(lang, 'adminDashboard')}
        </a>
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
    marginBottom: '28px',
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
  // Permission screen
  permSection: {
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  permIcon: {
    fontSize: '56px',
    marginBottom: '16px',
  },
  permTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#f0b427',
    margin: '0 0 12px',
  },
  permMessage: {
    color: '#999',
    fontSize: '15px',
    margin: '0 0 24px',
    lineHeight: 1.6,
  },
  permButton: {
    fontSize: '16px',
    padding: '16px 32px',
    width: '100%',
  },
  // Location badge
  locationBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 16px',
    background: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    borderRadius: '12px',
    color: '#22c55e',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '24px',
  },
  locationDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#22c55e',
    display: 'inline-block',
  },
  formSection: {
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
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
  },
  adminLink: {
    display: 'block',
    textAlign: 'center' as const,
    marginTop: '24px',
    fontSize: '13px',
    color: '#666',
    textDecoration: 'none',
  },
  loadingSection: {
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  spinner: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: '#f0b427',
    margin: '0 auto 16px',
  },
  loadingText: {
    color: '#fff',
    fontSize: '16px',
    fontWeight: 500,
    margin: '0 0 4px',
  },
  loadingHint: {
    color: '#666',
    fontSize: '13px',
    margin: 0,
  },
  errorSection: {
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  errorIcon: {
    fontSize: '48px',
    marginBottom: '12px',
  },
  errorTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ef4444',
    margin: '0 0 8px',
  },
  errorMessage: {
    color: '#999',
    fontSize: '14px',
    margin: 0,
    lineHeight: 1.5,
  },
  successSection: {
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  successIcon: {
    fontSize: '56px',
    marginBottom: '16px',
  },
  successMessage: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#fff',
    margin: '0 0 12px',
    lineHeight: 1.4,
  },
  timeStamp: {
    fontSize: '14px',
    color: '#aaa',
    margin: '0 0 8px',
  },
  catQuote: {
    fontSize: '15px',
    color: '#f0b427',
    fontStyle: 'italic',
    margin: '0 0 20px',
  },
  hoursCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '16px',
    background: 'rgba(240, 180, 39, 0.1)',
    border: '1px solid rgba(240, 180, 39, 0.2)',
    borderRadius: '12px',
    marginTop: '8px',
  },
  hoursLabel: {
    fontSize: '12px',
    color: '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  hoursValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#f0b427',
    marginTop: '4px',
  },
};
