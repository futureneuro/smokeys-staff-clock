import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, errorResponse, getClientIp, jsonResponse, parseJsonBody } from '../_shared/http.ts';
import { resolveStaffIdentity } from '../_shared/staff-auth.ts';

type ClockAction = 'check_in' | 'check_out' | 'break_start' | 'break_end';

const VALID_ACTIONS: ClockAction[] = ['check_in', 'check_out', 'break_start', 'break_end'];

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBogotaDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value ?? '1970';
  const month = parts.find(part => part.type === 'month')?.value ?? '01';
  const day = parts.find(part => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

async function getOpenLog(supabase: ReturnType<typeof createClient>, staffId: string) {
  const { data, error } = await supabase
    .from('time_logs')
    .select('id, check_in, check_out')
    .eq('staff_id', staffId)
    .is('check_out', null)
    .order('check_in', { ascending: false })
    .limit(1);

  if (error) return { error: error.message, log: null };
  return { error: null, log: data && data.length > 0 ? data[0] : null };
}

async function safeUpdateAssignment(
  supabase: ReturnType<typeof createClient>,
  staffId: string,
  shiftDate: string,
  updatePayload: Record<string, unknown>,
) {
  const { data: assignments, error: assignmentError } = await supabase
    .from('shift_assignments')
    .select('id')
    .eq('staff_id', staffId)
    .eq('shift_date', shiftDate)
    .limit(1);
  if (assignmentError || !assignments || assignments.length === 0) return;

  const assignmentId = assignments[0].id as string;
  await supabase.from('shift_assignments').update(updatePayload).eq('id', assignmentId);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRole) {
    return errorResponse('Missing Supabase env vars.', 500);
  }

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const body = await parseJsonBody(req);
  const action = body.action as ClockAction | undefined;
  if (!action || !VALID_ACTIONS.includes(action)) {
    return errorResponse('Invalid action.', 400);
  }

  const identity = await resolveStaffIdentity(req, body, supabase);
  if (!identity.ok) {
    return errorResponse(identity.error, identity.status);
  }
  const staff = identity.staff;

  const gpsLat = toNumber(body.gps_lat);
  const gpsLng = toNumber(body.gps_lng);
  if (gpsLat === null || gpsLng === null) {
    return errorResponse('Missing valid GPS coordinates.', 400);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const todayBogota = getBogotaDateString(now);
  const ipAddress = getClientIp(req);

  if (action === 'check_in') {
    const openLog = await getOpenLog(supabase, staff.id);
    if (openLog.error) return errorResponse(openLog.error, 500);
    if (openLog.log) return errorResponse('You are already checked in.', 409);

    const { data: inserted, error: insertError } = await supabase
      .from('time_logs')
      .insert({
        staff_id: staff.id,
        check_in: nowIso,
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        ip_address: ipAddress,
      })
      .select('id, check_in')
      .limit(1);

    if (insertError || !inserted || inserted.length === 0) {
      return errorResponse(insertError?.message || 'Could not create check-in record.', 500);
    }

    const timeLog = inserted[0];
    await safeUpdateAssignment(supabase, staff.id, todayBogota, { status: 'active', time_log_id: timeLog.id });

    return jsonResponse({
      action: 'check_in',
      staff_name: staff.name,
      message: `Welcome ${staff.name}, check-in recorded.`,
      check_in_time: timeLog.check_in,
    });
  }

  if (action === 'check_out') {
    const openLog = await getOpenLog(supabase, staff.id);
    if (openLog.error) return errorResponse(openLog.error, 500);
    if (!openLog.log) return errorResponse('No active shift found to check out.', 409);

    const checkInTime = new Date(openLog.log.check_in).getTime();
    const totalHours = Math.max(0, Number(((Date.now() - checkInTime) / 3600000).toFixed(2)));

    const { error: updateError } = await supabase
      .from('time_logs')
      .update({
        check_out: nowIso,
        total_hours: totalHours,
      })
      .eq('id', openLog.log.id);
    if (updateError) return errorResponse(updateError.message, 500);

    await supabase
      .from('breaks')
      .update({
        break_end: nowIso,
      })
      .eq('time_log_id', openLog.log.id)
      .is('break_end', null);

    await safeUpdateAssignment(supabase, staff.id, todayBogota, { status: 'completed' });

    return jsonResponse({
      action: 'check_out',
      staff_name: staff.name,
      message: `See you ${staff.name}, check-out recorded.`,
      check_out_time: nowIso,
      total_hours: totalHours,
    });
  }

  const openLog = await getOpenLog(supabase, staff.id);
  if (openLog.error) return errorResponse(openLog.error, 500);
  if (!openLog.log) return errorResponse('You must check in before using breaks.', 409);

  if (action === 'break_start') {
    const { data: activeBreak } = await supabase
      .from('breaks')
      .select('id')
      .eq('time_log_id', openLog.log.id)
      .is('break_end', null)
      .limit(1);
    if (activeBreak && activeBreak.length > 0) {
      return errorResponse('A break is already active.', 409);
    }

    const { error: breakError } = await supabase
      .from('breaks')
      .insert({
        time_log_id: openLog.log.id,
        break_start: nowIso,
      });
    if (breakError) return errorResponse(breakError.message, 400);

    await safeUpdateAssignment(supabase, staff.id, todayBogota, { status: 'on_break' });

    return jsonResponse({
      action: 'break_start',
      staff_name: staff.name,
      message: 'Break started.',
      break_start_time: nowIso,
    });
  }

  const { data: activeBreak, error: activeBreakError } = await supabase
    .from('breaks')
    .select('id, break_start')
    .eq('time_log_id', openLog.log.id)
    .is('break_end', null)
    .limit(1);
  if (activeBreakError) return errorResponse(activeBreakError.message, 500);
  if (!activeBreak || activeBreak.length === 0) {
    return errorResponse('No active break found.', 409);
  }

  const breakRow = activeBreak[0];
  const durationMinutes = Math.max(0, Math.round((Date.now() - new Date(breakRow.break_start).getTime()) / 60000));

  const { error: endBreakError } = await supabase
    .from('breaks')
    .update({
      break_end: nowIso,
      duration_minutes: durationMinutes,
    })
    .eq('id', breakRow.id);
  if (endBreakError) return errorResponse(endBreakError.message, 400);

  await safeUpdateAssignment(supabase, staff.id, todayBogota, { status: 'active' });

  return jsonResponse({
    action: 'break_end',
    staff_name: staff.name,
    message: 'Break ended.',
    break_end_time: nowIso,
    duration_minutes: durationMinutes,
  });
});
