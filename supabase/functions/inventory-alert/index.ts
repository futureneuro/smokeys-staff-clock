// Sends the stock-count variance report by email.
//
// Called after a count is confirmed, or on a schedule to catch anything the
// browser failed to dispatch. Picks up alerts still marked pending, renders
// the report, sends it, and records the outcome on the alert row so a failure
// is visible rather than silent.
//
// The alert row is created by inv_confirm_count in the database, so the report
// exists in the app whether or not the email ever goes out.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts';
import { sendAcsEmail } from '../_shared/azure-email.ts';

interface AlertRow {
  id: string;
  count_id: string | null;
  title: string;
  severity: string;
  items_alerting: number;
  shortfall_value_cop: number;
  summary: SummaryItem[] | null;
  created_at: string;
}

interface SummaryItem {
  item: string;
  expected: number | string;
  counted: number | string;
  missing: number | string;
  unit: string;
  pct: number | string | null;
  value_cop: number | string;
}

const cop = (value: unknown) => {
  const n = Number(value ?? 0);
  return '$ ' + Math.round(Math.abs(n)).toLocaleString('es-CO');
};

const qty = (value: unknown, unit: string) => {
  const n = Number(value ?? 0);
  return `${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${unit}`;
};

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function renderHtml(alert: AlertRow, appUrl: string | null): string {
  const rows = (alert.summary ?? []).map(item => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;font-weight:600">${esc(item.item)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${esc(qty(item.expected, item.unit))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${esc(qty(item.counted, item.unit))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;text-align:right;color:#c0392b">-${esc(qty(item.missing, item.unit))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${item.pct == null ? '—' : esc(item.pct) + '%'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;text-align:right;color:#c0392b;font-weight:600">${esc(cop(item.value_cop))}</td>
    </tr>`).join('');

  const link = appUrl
    ? `<p style="margin:22px 0 0">
         <a href="${esc(appUrl)}" style="background:#f0b427;color:#111;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">
           Ver el conteo completo
         </a>
       </p>`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;color:#222">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
    <div style="background:#111;padding:18px 24px">
      <div style="color:#f0b427;font-weight:800;letter-spacing:3px;font-size:15px">SMOKEY&#39;S</div>
      <div style="color:#999;font-size:11px;letter-spacing:1px">CONTROL DE INVENTARIO</div>
    </div>

    <div style="padding:24px">
      <h1 style="margin:0 0 4px;font-size:19px">${esc(alert.title)}</h1>
      <p style="margin:0 0 18px;color:#666;font-size:13px">
        Faltante total: <strong style="color:#c0392b">${esc(cop(alert.shortfall_value_cop))}</strong>
        · ${alert.items_alerting} producto(s)
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f0f0f0">
            <th style="padding:8px 10px;text-align:left;font-size:11px;letter-spacing:.5px">PRODUCTO</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px">ESPERADO</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px">CONTADO</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px">FALTA</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px">%</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px">VALOR</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:20px;padding:14px;background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;font-size:13px;line-height:1.6">
        <strong>Antes de sacar conclusiones:</strong> revisen si el faltante se explica por
        desperdicio, comida del personal, un plato rehecho, o una compra que todavía no se
        ha registrado en el sistema. Esas cosas se anotan en la pestaña <strong>Waste</strong>.
      </div>

      ${link}
    </div>

    <div style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;color:#888;font-size:11px">
      Mensaje automático del sistema de inventario de Smokey&#39;s.
    </div>
  </div>
</body></html>`;
}

function renderText(alert: AlertRow): string {
  const lines = (alert.summary ?? []).map(
    i => `- ${i.item}: esperado ${qty(i.expected, i.unit)}, contado ${qty(i.counted, i.unit)}, ` +
         `falta ${qty(i.missing, i.unit)} (${cop(i.value_cop)})`);

  return [
    alert.title,
    `Faltante total: ${cop(alert.shortfall_value_cop)} en ${alert.items_alerting} producto(s).`,
    '',
    ...lines,
    '',
    'Antes de sacar conclusiones, revisen si se explica por desperdicio, comida del',
    'personal, un plato rehecho o una compra sin registrar.',
  ].join('\n');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Constant-time compare so the secret cannot be recovered by timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isActiveAdmin(
  supabase: ReturnType<typeof createClient>,
  adminId: unknown,
): Promise<boolean> {
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
    // identical to "you are not an admin".
    console.error('Admin check failed:', error.message);
    return false;
  }
  return Boolean(data);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const url = Deno.env.get('INV_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole = Deno.env.get('INV_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceRole) return errorResponse('Missing Supabase env vars.', 500);

  const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });
  const body = await parseJsonBody(req);

  // Sending email costs money on the restaurant's ACS account and mails every
  // recipient, so the caller has to be one of two things: an active admin, or
  // the scheduled retry holding the shared secret.
  const secret = Deno.env.get('INVENTORY_ALERT_SECRET') ?? '';
  const presented = req.headers.get('x-inventory-secret') ?? '';
  const viaSecret = secret.length > 0 && timingSafeEqual(presented, secret);

  if (!viaSecret && !(await isActiveAdmin(supabase, body.admin_id))) {
    return errorResponse('Not authorised.', 403);
  }

  // Either one specific alert, or everything still pending.
  if (body.alert_id !== undefined && (typeof body.alert_id !== 'string' || !UUID_RE.test(body.alert_id))) {
    return errorResponse('alert_id must be a uuid.', 400);
  }

  // Return anything a previous dispatcher claimed and then died holding.
  await supabase.rpc('inv_release_stale_alert_claims');

  // Claim atomically rather than select-then-send. The browser fires a dispatch
  // when a count is confirmed and the retry runs every 30 minutes; without a
  // claim both could pick up the same row and mail every recipient twice.
  // The claim also filters to undelivered rows, so an already-sent alert is
  // never re-sent and its 'sent' status cannot be overwritten.
  const { data: alerts, error } = await supabase.rpc('inv_claim_alerts', {
    p_alert_id: body.alert_id ?? null,
    p_limit: 20,
  });
  if (error) return errorResponse(error.message, 500);
  if (!alerts || alerts.length === 0) {
    return jsonResponse({ sent: 0, message: 'Nothing to send — everything has already gone out.' });
  }

  const { data: recipientRows } = await supabase
    .from('inv_alert_recipients')
    .select('email')
    .eq('active', true);

  const recipients = (recipientRows ?? [])
    .map(r => String((r as { email: string }).email).trim())
    .filter(Boolean);

  const endpoint = Deno.env.get('ACS_ENDPOINT') ?? '';
  const accessKey = Deno.env.get('ACS_ACCESS_KEY') ?? '';
  const sender = Deno.env.get('ACS_SENDER_EMAIL') ?? '';
  const appUrl = Deno.env.get('INVENTORY_APP_URL') ?? null;

  // Nothing configured is a normal state, not a failure: the alert still lives
  // in the app. Mark it skipped with the reason so the UI can say why.
  const missing: string[] = [];
  if (recipients.length === 0) missing.push('no active recipients — add one under Alerts');
  if (!endpoint || !accessKey) missing.push('ACS_ENDPOINT / ACS_ACCESS_KEY not set');
  if (!sender) missing.push('ACS_SENDER_EMAIL not set');

  if (missing.length > 0) {
    // Released from the claim, back to a state the retry will pick up again
    // once the missing configuration is supplied.
    await supabase
      .from('inv_alerts')
      .update({ email_status: 'skipped', email_error: missing.join('; ') })
      .in('id', (alerts as AlertRow[]).map(a => a.id));
    return jsonResponse({ sent: 0, skipped: alerts.length, reason: missing.join('; ') });
  }

  let sent = 0;
  const failures: string[] = [];

  for (const row of alerts as AlertRow[]) {
    try {
      // One message per recipient. Putting them all in a single To: header
      // discloses the whole roster to everyone on it — and the list itself was
      // locked down precisely because who receives shortfall reports is
      // sensitive.
      const results = [];
      for (const recipient of recipients) {
        results.push(await sendAcsEmail({
          endpoint,
          accessKey,
          sender,
          recipients: [recipient],
          subject: `[Smokey's] ${row.title}`,
          html: renderHtml(row, appUrl),
          plainText: renderText(row),
        }));
      }

      // Delivered if it reached at least one recipient; a partial failure is
      // reported rather than silently treated as success.
      const failedFor = results.filter(r => !r.ok);
      const result = {
        ok: failedFor.length < results.length,
        status: failedFor[0]?.status ?? 200,
      };

      if (result.ok) {
        sent += 1;
        await supabase.from('inv_alerts')
          .update({
            email_status: 'sent',
            email_sent_at: new Date().toISOString(),
            email_error: failedFor.length > 0
              ? `Sent, but ${failedFor.length} of ${results.length} recipient(s) failed.`
              : null,
          })
          .eq('id', row.id);
      } else {
        const detail = `ACS returned ${result.status}`;
        failures.push(detail);
        await supabase.from('inv_alerts')
          .update({ email_status: 'failed', email_error: detail })
          .eq('id', row.id);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      failures.push(detail);
      await supabase.from('inv_alerts')
        .update({ email_status: 'failed', email_error: detail })
        .eq('id', row.id);
    }
  }

  return jsonResponse({ sent, failed: failures.length, failures });
});
