import { EDGE_FUNCTION_URL } from './supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SESSION_KEY = 'smokeys_staff_session';

export interface StaffSession {
  token: string;
  staff: {
    id: string;
    name: string;
    staff_code: string;
    role: string;
  };
  loginAt: number; // timestamp ms
}

export interface LoginResult {
  success: boolean;
  error?: string;
  locked?: boolean;
  lockout_minutes?: number;
  session?: StaffSession;
}

/**
 * Login with Staff ID + PIN. Returns session on success.
 */
export async function login(staffCode: string, pin: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/staff-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_code: staffCode.trim().toUpperCase(), pin: pin.trim() }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        error: data.error || 'Login failed.',
        locked: data.locked,
        lockout_minutes: data.lockout_minutes,
      };
    }

    const session: StaffSession = {
      token: data.token,
      staff: data.staff,
      loginAt: Date.now(),
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { success: true, session };
  } catch {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/**
 * Get current session from sessionStorage. Returns null if expired or missing.
 */
export function getSession(): StaffSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const session: StaffSession = JSON.parse(raw);

    // Check client-side expiry (60 min)
    if (Date.now() - session.loginAt > 60 * 60 * 1000) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated.
 */
export function isAuthenticated(): boolean {
  return getSession() !== null;
}

/**
 * Logout — clear session.
 */
export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/**
 * Get auth headers for API calls.
 */
export function getAuthHeaders(): Record<string, string> {
  const session = getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.token}` };
}

/**
 * Clock action (check-in/out) using JWT auth.
 */
export async function clockAction(
  action: 'check_in' | 'check_out',
  gpsLat: number,
  gpsLng: number,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const session = getSession();
  if (!session) return { success: false, error: 'Not logged in.' };

  try {
    const res = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ action, gps_lat: gpsLat, gps_lng: gpsLng }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error || 'Action failed.' };
    }

    return { success: true, data };
  } catch {
    return { success: false, error: 'Network error.' };
  }
}
