// Turns one month's inventory report into a few plain sentences.
//
// The numbers come from inv_month_report — the same function the Report tab
// renders — so the summary can never disagree with the tables under it. The
// model is only asked to describe; it is never asked for a figure the report
// does not already contain, and nothing here writes to the database.

import { corsHeaders, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts';
import { isActiveAdmin, serviceClient } from '../_shared/admin.ts';
import { GeminiError, generateContent, geminiHttpStatus, resolveGeminiKey } from '../_shared/gemini.ts';

const MONTH_RE = /^\d{4}-\d{2}-01$/;

// Long lists add tokens without adding insight. The model sees the head of
// each ranking; the full tables are on screen already.
const TOP = 12;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

interface Row { [key: string]: unknown }

function head(rows: unknown, n = TOP): Row[] {
  return Array.isArray(rows) ? (rows as Row[]).slice(0, n) : [];
}

function compact(report: Row): Row {
  const sold = (report.sold ?? {}) as Row;
  const purchases = (report.purchases ?? {}) as Row;
  const usage = (report.usage ?? {}) as Row;
  const stock = (report.stock ?? {}) as Row;

  return {
    month: report.month,
    sold: {
      total_qty: sold.total_qty,
      revenue_cop: sold.revenue_cop,
      days_with_sales: sold.days_with_sales,
      days_from_pos: sold.days_from_pos,
      pos: sold.pos,
      top_items: head(sold.items).map(r => ({ name: r.name, portion: r.portion_label, qty: r.qty, revenue_cop: r.revenue_cop })),
    },
    purchases: {
      count: purchases.count,
      total_cop: purchases.total_cop,
      top_items: head(purchases.items).map(r => ({ name: r.name, qty: r.base_qty, unit: r.base_unit, cost_cop: r.cost_cop })),
    },
    usage: {
      by_reason: usage.by_reason,
      loss_value_cop: usage.loss_value_cop,
      biggest_losses: head(usage.losses, 8).map(r => ({ name: r.name, reason: r.reason, qty: r.qty, unit: r.base_unit, value_cop: r.value_cop })),
      most_consumed: head(usage.consumed, 8).map(r => ({ name: r.name, qty: r.qty, unit: r.base_unit, value_cop: r.value_cop })),
    },
    stock: {
      tracked: stock.tracked,
      total_value_cop: stock.total_value_cop,
      negative: stock.negative,
      out: stock.out,
      running_low: head(stock.low, 10).map(r => ({ name: r.name, qty: r.stock_base_qty, unit: r.base_unit, days_left: r.days_left })),
    },
    alerts: head(report.alerts, 6).map(r => ({ title: r.title, severity: r.severity, status: r.status, shortfall_value_cop: r.shortfall_value_cop })),
  };
}

function buildPrompt(report: Row, lang: 'es' | 'en'): string {
  const language = lang === 'en' ? 'English' : 'Spanish (Colombia)';
  return `You are the inventory assistant for Smokey's, a café in Medellín, Colombia. Below is the inventory report for one month as JSON. Money is Colombian pesos (COP); quantities are in the unit given.

Write a short summary for the owner in ${language}: 5 to 8 sentences, plain language, no headings, no bullet points, no markdown. Cover, in this order and only when the data supports it:
1. What sold most and roughly how much revenue the sales represent.
2. What was spent on purchases and whether anything stands out.
3. The biggest losses (waste, staff meals, comps, count differences) and their value.
4. Anything running low or out of stock that should be reordered.
5. Any variance alerts still open.

Rules: use only numbers present in the JSON, rounded sensibly. If a section is empty, say so in a few words rather than inventing. If sales came from the POS on only some days, mention that the picture is partial. Do not give advice beyond what the numbers show.

REPORT
${JSON.stringify(compact(report))}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const supabase = serviceClient();
  if (!supabase) return errorResponse('Missing Supabase env vars.', 500);

  const body = await parseJsonBody(req);

  if (!(await isActiveAdmin(supabase, body.admin_id))) {
    return errorResponse('Not authorised. Sign in as an admin.', 403);
  }

  const month = typeof body.month === 'string' ? body.month : '';
  if (!MONTH_RE.test(month)) return errorResponse('month must be YYYY-MM-01.', 400);
  const lang = body.lang === 'en' ? 'en' : 'es';

  const { data: report, error } = await supabase.rpc('inv_month_report', { p_month: month });
  if (error) return errorResponse(`Could not build the report: ${error.message}`, 500);
  if (!report || typeof report !== 'object') return errorResponse('The report came back empty.', 500);

  const apiKey = await resolveGeminiKey(supabase);
  if (!apiKey) {
    return errorResponse('No Gemini API key configured. Set it under Settings → AI Configuration.', 500);
  }

  try {
    const { text, model } = await generateContent(apiKey, {
      contents: [{ role: 'user', parts: [{ text: buildPrompt(report as Row, lang) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });
    return jsonResponse({ summary: text, model_used: model, month });
  } catch (e) {
    if (e instanceof GeminiError) {
      return errorResponse(e.message, geminiHttpStatus(e), e.attempts.length ? { attempts: e.attempts } : {});
    }
    return errorResponse(e instanceof Error ? e.message : String(e), 502);
  }
});
