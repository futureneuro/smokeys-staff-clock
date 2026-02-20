'use client';

import { useState, useEffect } from 'react';
import { EDGE_FUNCTION_URL } from '@/lib/supabase';
import { getCurrentPosition, GeoPosition } from '@/lib/geo';

type AppState = 'loading' | 'location_error' | 'ready' | 'submitting' | 'success';
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
  const [appState, setAppState] = useState<AppState>('loading');
  const [geoError, setGeoError] = useState<string>('');
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [staffCode, setStaffCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ClockResult | null>(null);

  useEffect(() => {
    requestLocation();
  }, []);

  async function requestLocation() {
    setAppState('loading');
    setGeoError('');
    try {
      const pos = await getCurrentPosition();
      setPosition(pos);
      setAppState('ready');
    } catch (err: unknown) {
      setGeoError(err instanceof Error ? err.message : 'Failed to get location');
      setAppState('location_error');
    }
  }

  async function handleClock(action: ActionType) {
    if (!staffCode.trim() || !pin.trim()) {
      setError('Please enter your Staff ID and PIN.');
      return;
    }
    if (!position) {
      setError('Location not available. Please refresh and allow location access.');
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
      setError('Network error. Please check your connection and try again.');
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

  // ── Loading State ──
  if (appState === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.card} className="animate-fadeIn">
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>SMOKEY&apos;S</h1>
            <p style={styles.subtitle}>Staff Clock</p>
          </div>
          <div style={styles.loadingSection}>
            <div style={styles.spinner} className="animate-pulse-slow" />
            <p style={styles.loadingText}>Verifying your location...</p>
            <p style={styles.loadingHint}>Please allow location access when prompted</p>
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
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>SMOKEY&apos;S</h1>
            <p style={styles.subtitle}>Staff Clock</p>
          </div>
          <div style={styles.errorSection}>
            <div style={styles.errorIcon}>📍</div>
            <p style={styles.errorTitle}>Location Required</p>
            <p style={styles.errorMessage}>{geoError}</p>
            <button onClick={requestLocation} className="btn-primary" style={{ marginTop: 16 }}>
              Try Again
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
          <div style={styles.logoSection}>
            <span style={styles.catEmoji}>🐈‍⬛</span>
            <h1 style={styles.title}>SMOKEY&apos;S</h1>
          </div>
          <div style={styles.successSection}>
            <div style={styles.successIcon}>
              {result.action === 'check_in' ? '✅' : '👋'}
            </div>
            <p style={styles.successMessage}>{result.message}</p>
            <p style={styles.catQuote}>
              {result.action === 'check_in'
                ? '"Clock in. Stay sharp."'
                : '"Good hustle. See you tomorrow."'}
            </p>
            {result.total_hours !== undefined && (
              <div style={styles.hoursCard}>
                <span style={styles.hoursLabel}>Total Hours</span>
                <span style={styles.hoursValue}>
                  {Math.floor(result.total_hours)}h {Math.round((result.total_hours - Math.floor(result.total_hours)) * 60)}m
                </span>
              </div>
            )}
          </div>
          <button onClick={handleReset} className="btn-secondary" style={{ marginTop: 24 }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Ready / Form State ──
  return (
    <div style={styles.container}>
      <div style={styles.card} className="animate-fadeIn">
        <div style={styles.logoSection}>
          <span style={styles.catEmoji}>🐈‍⬛</span>
          <h1 style={styles.title}>SMOKEY&apos;S</h1>
          <p style={styles.subtitle}>Staff Clock</p>
        </div>

        <div style={styles.locationBadge}>
          <span style={styles.locationDot} />
          Location verified
        </div>

        <div style={styles.formSection}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Staff ID</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. SMK001"
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              disabled={appState === 'submitting'}
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
              {appState === 'submitting' ? '...' : '✦ CHECK IN'}
            </button>
            <button
              onClick={() => handleClock('check_out')}
              className="btn-secondary"
              disabled={appState === 'submitting'}
              style={{ flex: 1 }}
            >
              {appState === 'submitting' ? '...' : 'CHECK OUT ✦'}
            </button>
          </div>
        </div>

        <a href="/admin" style={styles.adminLink}>
          Admin Dashboard →
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
