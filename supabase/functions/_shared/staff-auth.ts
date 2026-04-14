import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decodeJwtPayload } from './http.ts';

export type StaffIdentity = {
  id: string;
  name: string;
  staff_code: string;
  role: string;
  active: boolean;
};

type ResolveResult =
  | { ok: true; staff: StaffIdentity }
  | { ok: false; status: number; error: string };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNestedString(obj: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return asString(current);
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

async function fetchStaffById(supabase: SupabaseClient, staffId: string): Promise<StaffIdentity | null> {
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, staff_code, role, active')
    .eq('id', staffId)
    .eq('active', true)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as StaffIdentity;
}

async function fetchStaffByCode(supabase: SupabaseClient, staffCode: string): Promise<StaffIdentity | null> {
  const code = staffCode.trim().toUpperCase();
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, staff_code, role, active')
    .eq('staff_code', code)
    .eq('active', true)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as StaffIdentity;
}

async function resolveFromBearer(req: Request, supabase: SupabaseClient): Promise<ResolveResult | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return { ok: false, status: 401, error: 'Invalid session token.' };
  }

  const staffId =
    getNestedString(payload, ['staff_id']) ??
    getNestedString(payload, ['staffId']) ??
    getNestedString(payload, ['staff', 'id']) ??
    getNestedString(payload, ['user_id']) ??
    getNestedString(payload, ['sub']);
  const staffCode = getNestedString(payload, ['staff_code']) ?? getNestedString(payload, ['staff', 'staff_code']);

  let staff: StaffIdentity | null = null;
  if (staffId) staff = await fetchStaffById(supabase, staffId);
  if (!staff && staffCode) staff = await fetchStaffByCode(supabase, staffCode);

  if (!staff) {
    return { ok: false, status: 401, error: 'Session is no longer valid.' };
  }

  return { ok: true, staff };
}

async function resolveFromCredentials(body: Record<string, unknown>, supabase: SupabaseClient): Promise<ResolveResult> {
  const staffCode = asString(body.staff_code);
  const pin = asString(body.pin);

  if (!staffCode || !pin) {
    return { ok: false, status: 401, error: 'Missing staff credentials.' };
  }

  const staff = await fetchStaffByCode(supabase, staffCode);
  if (!staff) {
    return { ok: false, status: 401, error: 'Invalid staff code or inactive account.' };
  }

  const { data: pinValid, error: pinError } = await supabase.rpc('verify_pin', {
    p_staff_id: staff.id,
    p_pin: pin,
  });
  if (pinError) {
    return { ok: false, status: 500, error: 'Failed to verify PIN.' };
  }
  if (!pinValid) {
    return { ok: false, status: 401, error: 'Invalid PIN.' };
  }

  return { ok: true, staff };
}

export async function resolveStaffIdentity(
  req: Request,
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ResolveResult> {
  const bearerResult = await resolveFromBearer(req, supabase);
  if (bearerResult) return bearerResult;
  return resolveFromCredentials(body, supabase);
}
