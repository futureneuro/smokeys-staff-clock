// Who is allowed to call an inventory edge function.
//
// Every function that spends money (Gemini, email) or moves stock checks the
// same two things: a service-role client to read with, and proof that the
// caller is an active admin or the scheduled job holding a shared secret.
// One copy here so the check cannot drift between functions.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ServiceClient = ReturnType<typeof createClient>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// INV_* lets local development point the inventory functions at a separate
// database while everything else keeps talking to the project's own.
export function serviceClient(): ServiceClient | null {
  const url = Deno.env.get('INV_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole = Deno.env.get('INV_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

export async function isActiveAdmin(supabase: ServiceClient, adminId: unknown): Promise<boolean> {
  if (typeof adminId !== 'string' || !UUID_RE.test(adminId)) return false;

  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('id', adminId)
    .eq('role', 'admin')
    .eq('active', true)
    .maybeSingle();

  if (error) {
    // Fail closed, but say why: a misconfigured service role otherwise looks
    // identical to "you are not an admin" and is hard to diagnose.
    console.error('Admin check failed:', error.message);
    return false;
  }
  return Boolean(data);
}

// Constant-time compare so a shared secret cannot be recovered by timing.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True when the request carries the expected secret in the given header. A
// short or empty secret counts as unset, so a misconfiguration fails closed
// rather than accepting an empty header.
export function hasSharedSecret(req: Request, header: string, envName: string, minLength = 32): boolean {
  const secret = Deno.env.get(envName) ?? '';
  const presented = req.headers.get(header) ?? '';
  return secret.length >= minLength && timingSafeEqual(presented, secret);
}
