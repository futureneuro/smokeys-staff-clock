import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendAcsSms } from '../_shared/azure-sms.ts';

type ShiftAssignment = {
    id: string;
    shift_date: string;
    staff: {
        id: string;
        name: string;
        phone_number: string | null;
        sms_opt_in: boolean;
        active: boolean;
    } | null;
    shift_definition: {
        start_time: string;
        late_grace_minutes: number | null;
    } | null;
};

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function bogotaDateTime(shiftDate: string, time: string): Date {
    const hhmm = time.slice(0, 5);
    return new Date(`${shiftDate}T${hhmm}:00-05:00`);
}

function dayBoundsBogota(day: string): { fromIso: string; toIso: string } {
    const from = new Date(`${day}T00:00:00-05:00`);
    const to = new Date(`${day}T23:59:59-05:00`);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function lateMessage(name: string): string {
    return `Hola ${name}, no hemos registrado tu hora de llegada, por favor realiza el check in.`;
}

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const cronSecret = Deno.env.get('LATE_NOTIFIER_CRON_SECRET');
    if (cronSecret) {
        const incoming = req.headers.get('x-cron-secret');
        if (incoming !== cronSecret) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const acsEndpoint = Deno.env.get('ACS_ENDPOINT') ?? '';
    const acsAccessKey = Deno.env.get('ACS_ACCESS_KEY') ?? '';
    const acsSenderPhone = Deno.env.get('ACS_SENDER_PHONE') ?? '';

    if (!supabaseUrl || !serviceRole) {
        return new Response(JSON.stringify({ error: 'Missing Supabase env vars.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (!acsEndpoint || !acsAccessKey || !acsSenderPhone) {
        return new Response(JSON.stringify({ error: 'Missing ACS env vars.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const today = new Date().toISOString().slice(0, 10);
    const { fromIso, toIso } = dayBoundsBogota(today);

    const { data: assignments, error: assignmentError } = await supabase
        .from('shift_assignments')
        .select(`
            id,
            shift_date,
            staff:staff(id, name, phone_number, sms_opt_in, active),
            shift_definition:shift_definitions(start_time, late_grace_minutes)
        `)
        .eq('shift_date', today);

    if (assignmentError) {
        return new Response(JSON.stringify({ error: assignmentError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const now = new Date();
    let checked = 0;
    let sent = 0;
    const failures: Array<{ staff_id: string; error: string }> = [];

    for (const sa of (assignments ?? []) as ShiftAssignment[]) {
        checked += 1;
        if (!sa.staff || !sa.shift_definition) continue;
        if (!sa.staff.active || !sa.staff.sms_opt_in || !sa.staff.phone_number) continue;

        const grace = sa.shift_definition.late_grace_minutes ?? 10;
        const lateAt = new Date(bogotaDateTime(sa.shift_date, sa.shift_definition.start_time).getTime() + grace * 60 * 1000);
        if (now <= lateAt) continue;

        const { data: alreadyCheckedIn } = await supabase
            .from('time_logs')
            .select('id')
            .eq('staff_id', sa.staff.id)
            .gte('check_in', fromIso)
            .lte('check_in', toIso)
            .limit(1);
        if ((alreadyCheckedIn ?? []).length > 0) continue;

        const smsMessage = lateMessage(sa.staff.name);
        const upsertPayload = {
            staff_id: sa.staff.id,
            shift_assignment_id: sa.id,
            shift_date: sa.shift_date,
            notification_type: 'late_checkin_sms',
            sms_message: smsMessage,
            status: 'pending',
            scheduled_at: now.toISOString(),
        };

        const { data: insertedRows, error: upsertError } = await supabase
            .from('late_attendance_notifications')
            .upsert(upsertPayload, { onConflict: 'staff_id,shift_date,notification_type', ignoreDuplicates: false })
            .select('id,status')
            .limit(1);
        if (upsertError || !insertedRows || insertedRows.length === 0) {
            failures.push({ staff_id: sa.staff.id, error: upsertError?.message || 'Failed creating notification log.' });
            continue;
        }

        const notificationId = insertedRows[0].id as string;
        const existingStatus = insertedRows[0].status as string;
        if (existingStatus === 'sent') continue;

        const sendResult = await sendAcsSms({
            endpoint: acsEndpoint,
            accessKey: acsAccessKey,
            sender: acsSenderPhone,
            recipient: sa.staff.phone_number,
            message: smsMessage,
        });

        if (!sendResult.ok) {
            await supabase
                .from('late_attendance_notifications')
                .update({
                    status: 'failed',
                    error_message: `ACS send failed (${sendResult.status})`,
                    provider_response: sendResult.body,
                })
                .eq('id', notificationId);
            failures.push({ staff_id: sa.staff.id, error: `ACS send failed (${sendResult.status})` });
            continue;
        }

        await supabase
            .from('late_attendance_notifications')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                provider_response: sendResult.body,
                error_message: null,
            })
            .eq('id', notificationId);
        sent += 1;
    }

    return new Response(JSON.stringify({ ok: true, checked, sent, failures }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
});
