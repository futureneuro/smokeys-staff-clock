import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts';

type AssignmentRow = {
  id: string;
  shift_date: string;
  status: string;
  staff_id: string;
  shift_definition_id: string;
  staff: { id: string; name: string; staff_code: string } | null;
  shift_definition: { id: string; name: string; start_time: string; end_time: string; color: string; late_grace_minutes: number | null } | null;
};

type TimeLogRow = {
  id: string;
  staff_id: string;
  check_in: string;
  check_out: string | null;
  total_hours: number | null;
};

type BreakRow = {
  id: string;
  time_log_id: string;
  break_start: string;
  break_end: string | null;
};

function dayBoundsBogota(day: string): { fromIso: string; toIso: string } {
  const from = new Date(`${day}T00:00:00-05:00`);
  const to = new Date(`${day}T23:59:59-05:00`);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function bogotaDateString(date = new Date()): string {
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

function minutesLate(checkInIso: string, shiftDate: string, startTime: string, graceMinutes: number): number {
  const [hour, minute] = startTime.slice(0, 5).split(':').map(Number);
  const shiftStart = new Date(`${shiftDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`);
  const lateThreshold = new Date(shiftStart.getTime() + graceMinutes * 60 * 1000);
  const checkIn = new Date(checkInIso);
  if (checkIn <= lateThreshold) return 0;
  return Math.max(0, Math.round((checkIn.getTime() - shiftStart.getTime()) / 60000));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return errorResponse('Method not allowed.', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRole) {
    return errorResponse('Missing Supabase env vars.', 500);
  }

  const url = new URL(req.url);
  const requestedDate = url.searchParams.get('date');
  const todayBogota = bogotaDateString(new Date());
  const shiftDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayBogota;
  const { fromIso, toIso } = dayBoundsBogota(shiftDate);

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from('shift_assignments')
    .select(`
      id,
      shift_date,
      status,
      staff_id,
      shift_definition_id,
      staff:staff(id, name, staff_code),
      shift_definition:shift_definitions(id, name, start_time, end_time, color, late_grace_minutes)
    `)
    .eq('shift_date', shiftDate)
    .order('created_at', { ascending: true });

  if (assignmentError) {
    return errorResponse(assignmentError.message, 500);
  }

  const assignments = ((assignmentRows ?? []) as AssignmentRow[]).filter(row => row.staff && row.shift_definition);
  const staffIds = Array.from(new Set(assignments.map(row => row.staff_id)));

  const logsByStaff = new Map<string, TimeLogRow>();
  if (staffIds.length > 0) {
    const { data: logs, error: logsError } = await supabase
      .from('time_logs')
      .select('id, staff_id, check_in, check_out, total_hours')
      .in('staff_id', staffIds)
      .gte('check_in', fromIso)
      .lte('check_in', toIso)
      .order('check_in', { ascending: false });
    if (logsError) return errorResponse(logsError.message, 500);

    for (const log of (logs ?? []) as TimeLogRow[]) {
      if (!logsByStaff.has(log.staff_id)) logsByStaff.set(log.staff_id, log);
    }
  }

  const timeLogIds = Array.from(new Set(Array.from(logsByStaff.values()).map(log => log.id)));
  const activeBreakByLogId = new Map<string, BreakRow>();
  if (timeLogIds.length > 0) {
    const { data: breakRows } = await supabase
      .from('breaks')
      .select('id, time_log_id, break_start, break_end')
      .in('time_log_id', timeLogIds)
      .is('break_end', null);
    for (const row of (breakRows ?? []) as BreakRow[]) {
      if (!activeBreakByLogId.has(row.time_log_id)) activeBreakByLogId.set(row.time_log_id, row);
    }
  }

  const now = new Date();
  const transformed = assignments.map(assignment => {
    const shift = assignment.shift_definition!;
    const staff = assignment.staff!;
    const timeLog = logsByStaff.get(assignment.staff_id) ?? null;
    const activeBreak = timeLog ? activeBreakByLogId.get(timeLog.id) ?? null : null;

    const shiftStart = new Date(`${assignment.shift_date}T${shift.start_time.slice(0, 5)}:00-05:00`);
    const missedThreshold = new Date(shiftStart.getTime() + (shift.late_grace_minutes ?? 10) * 60 * 1000);

    const lateMinutes = timeLog ? minutesLate(timeLog.check_in, assignment.shift_date, shift.start_time, shift.late_grace_minutes ?? 10) : 0;
    let derivedStatus = assignment.status || 'scheduled';
    if (derivedStatus !== 'cancelled') {
      if (!timeLog) {
        derivedStatus = now > missedThreshold ? 'missed' : 'scheduled';
      } else if (timeLog.check_out) {
        derivedStatus = 'completed';
      } else if (activeBreak) {
        derivedStatus = 'on_break';
      } else {
        derivedStatus = 'active';
      }
    }

    return {
      id: assignment.id,
      shift_date: assignment.shift_date,
      status: assignment.status || 'scheduled',
      derived_status: derivedStatus,
      staff,
      shift_definition: shift,
      time_log: timeLog
        ? {
            id: timeLog.id,
            check_in: timeLog.check_in,
            check_out: timeLog.check_out,
            late_minutes: lateMinutes,
            check_in_flag: lateMinutes > 0 ? 'late' : 'on_time',
            net_work_minutes: null,
          }
        : null,
      active_break: activeBreak
        ? {
            id: activeBreak.id,
            break_start: activeBreak.break_start,
          }
        : null,
    };
  });

  const summary = transformed.reduce(
    (acc, row) => {
      acc.scheduled += row.derived_status === 'scheduled' ? 1 : 0;
      acc.active += row.derived_status === 'active' ? 1 : 0;
      acc.on_break += row.derived_status === 'on_break' ? 1 : 0;
      acc.missed += row.derived_status === 'missed' ? 1 : 0;
      acc.completed += row.derived_status === 'completed' ? 1 : 0;
      if ((row.time_log?.late_minutes ?? 0) > 0) acc.late += 1;
      return acc;
    },
    { scheduled: 0, active: 0, on_break: 0, late: 0, missed: 0, completed: 0 },
  );

  const { data: flagRows } = await supabase
    .from('compliance_flags')
    .select('id, staff_id, flag_type, severity, details, created_at, resolved_at, staff:staff(name)')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false })
    .limit(100);

  return jsonResponse({
    date: shiftDate,
    assignments: transformed,
    summary,
    flags: flagRows ?? [],
  });
});
