// Reads a purchase document (itemised receipt, bank transfer screenshot, or card
// slip) and returns structured data for a human to review.
//
// This function NEVER writes to the database. Extraction is a suggestion; the
// admin edits and confirms it in the UI, and only that confirmation moves stock.
// The whole point of the inventory feature is detecting discrepancies, so a
// hallucinated quantity must never be able to enter the ledger unreviewed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts';

// Roughly 8 MB of base64 ~= 6 MB of image. Phone photos compress well below this;
// anything larger is a sign the client skipped downscaling.
const MAX_BASE64_LENGTH = 8_000_000;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

// Tried in order. Each fallback sits on separate capacity and, on the free
// tier, its own quota bucket — so an overloaded or exhausted primary does not
// take receipt scanning down.
const MODEL_CANDIDATES = [...new Set([
  Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
])];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    doc_type: {
      type: 'STRING',
      enum: ['itemized_receipt', 'transfer', 'card_slip', 'unknown'],
    },
    merchant_name: { type: 'STRING', nullable: true },
    merchant_nit: { type: 'STRING', nullable: true },
    document_number: { type: 'STRING', nullable: true },
    purchased_on: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
    document_total_cop: { type: 'NUMBER', nullable: true },
    payment_method: {
      type: 'STRING',
      nullable: true,
      enum: ['transfer', 'cash', 'card', 'credit'],
    },
    reference_note: {
      type: 'STRING',
      nullable: true,
      description: 'Free-text memo on a transfer, e.g. "yogurt 5L"',
    },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          line_no: { type: 'INTEGER', nullable: true },
          description: { type: 'STRING' },
          barcode: { type: 'STRING', nullable: true },
          barcode_unreliable: { type: 'BOOLEAN' },
          qty: { type: 'NUMBER', nullable: true },
          unit_label: { type: 'STRING', nullable: true },
          unit_cost_cop: { type: 'NUMBER', nullable: true },
          line_total_cop: { type: 'NUMBER', nullable: true },
        },
        required: ['description', 'barcode_unreliable'],
      },
    },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['doc_type', 'lines', 'warnings'],
};

const PROMPT = `You read purchase documents for a restaurant in Medellín, Colombia, and turn them into structured data.

Return ONLY data you can actually see. Never invent a value. If a field is unreadable or absent, return null and add a warning explaining what was unreadable.

## Document types

Classify the image as one of:

- "itemized_receipt" — a till receipt or invoice listing individual products (D1, supermarkets, Alegra paper invoices)
- "transfer" — a bank transfer confirmation screen (Bancolombia, Nequi, Bre-B). These show an amount and a recipient but NO products.
- "card_slip" — a card terminal voucher (Bold, Redeban) showing only a total, no products
- "unknown" — anything else

For "transfer" and "card_slip", return an EMPTY lines array. Do not guess what was bought. Capture the amount, date, recipient name into merchant_name, and any free-text memo ("referencia", "descripción") into reference_note.

## Reading itemised receipts

Typical D1 layout:

    #I CAN UM VALOR U    CODIGO         DESCRIPCION    VALOR ID
     1  3 UN   2,450  7700304150069  DESENGRASANTE     7,350 A

means: line 1, quantity 3, unit "UN", unit price 2450, barcode 7700304150069, description "DESENGRASANTE", line total 7350.

Rules:

1. **Descriptions are truncated by the printer** (e.g. "JABON DE BARR", "LIMPIADOR BIC", "CANELA EN AST"). Copy them EXACTLY as printed. Never expand, complete, correct, or translate them. "PANOS MICROFI" stays "PANOS MICROFI".

2. **Weighed items span two printed lines.** For example:

       3   1.430kg X 14,500
           2930418014307  PECHUGA POLLO  20,735  5

   This is ONE line item: description "PECHUGA POLLO", qty 1.43, unit_label "kg", unit_cost_cop 14500, line_total_cop 20735. Merge the two printed lines into a single entry.

3. **Barcodes beginning with 2** (such as 2930418014307) are in-store price-embedded codes that change with the item's weight. Set barcode_unreliable to true for those. For normal EAN-13 codes beginning with any other digit, set it to false.

4. **Skip non-product lines entirely.** Do not emit entries for: TOTAL, SUBTOTAL, FORMA DE PAGO, VALOR PAGADO, EFECTIVO, CAMBIO, TARJ CRE/DEB, RESUMEN DE IMPUESTOS, IVA, BASE, IMP. CONS BOLSAS P., ID CLIENTE, NUM ART ENTREGADOS, or any DIAN/CUFE/resolution footer text.

5. A purchased plastic bag ("BOLSA RECICLA") IS a product line — include it.

## Numbers

Colombian documents use two different conventions in the same receipt. Work out which applies from context and return a plain number with no separators:

- Money on till receipts: comma is the THOUSANDS separator. "2,450" is 2450. "38,500" is 38500.
- Money in banking apps: period is the THOUSANDS separator and comma is decimals. "COP $ 120.000,00" is 120000. "$ 1.500.000" is 1500000.
- Weights: period is the DECIMAL separator. "1.430kg" is 1.43 kilograms.

Sanity check yourself: quantity times unit price should equal the line total. If it does not, keep the printed values and add a warning naming the line.

## Dates

Return purchased_on as YYYY-MM-DD. Documents may print "2026/08/08", "08/08/2026", "07 Ago 2026", or "14-08-2026". Colombian format is day first. Prefer the "Generación" or "Fecha de emisión" timestamp over a "Validación DIAN" one when both appear.

## Warnings

Add a short warning string for anything a reviewer should check by eye: blurry or cut-off regions, a total that does not match the sum of lines, ambiguous quantities, handwriting, glare, or a document type you were unsure about.`;

interface GeminiPart {
  text?: string;
}

function serviceClient() {
  const url = Deno.env.get('INV_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole = Deno.env.get('INV_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each scan spends real money on the restaurant's Gemini key, so the caller has
// to prove it is an active admin first. Without this the endpoint is a free OCR
// proxy for anyone who learns the URL, and draining the daily quota takes
// receipt scanning down for the shop.
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
    // Fail closed, but say so: a misconfigured service role otherwise looks
    // identical to a genuine "you are not an admin" and is hard to diagnose.
    console.error('Admin check failed:', error.message);
    return false;
  }

  return Boolean(data);
}

async function resolveGeminiKey(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const fromEnv = Deno.env.get('GEMINI_API_KEY');
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  // Fall back to the key the admin saved in Settings. Read with the service role
  // so the key never has to travel to the browser.
  const { data, error } = await supabase.from('settings').select('gemini_api_key').limit(1).maybeSingle();
  if (error || !data) return null;

  const key = (data as { gemini_api_key: string | null }).gemini_api_key;
  return key && key.trim() ? key.trim() : null;
}

// 503 and 500 are transient spikes and clear within seconds, so they are worth
// waiting out. 429 is a quota bucket, not a burst limit — backing off does not
// refill it, so it moves straight to the next model instead.
const RETRY_STATUSES = [500, 503];
const MAX_ATTEMPTS = 4;

// Four models times four attempts, plus 7s of backoff each, can outrun the
// platform's request timeout — and a timed-out request replaces the useful
// "quota exhausted, enable billing" message with a generic gateway error.
// Attempts stop once this budget is spent so the real reason gets through.
const REQUEST_BUDGET_MS = 55_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiOnce(model: string, apiKey: string, base64: string, mimeType: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  return await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Header rather than a ?key= query parameter, which would put the secret
      // into proxy and request logs along the way.
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        // Extraction, not creativity.
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
}

// An unread response body keeps its stream open, so every discarded attempt
// must be drained explicitly.
async function discard(res: Response) {
  try {
    await res.body?.cancel();
  } catch {
    // Already closed; nothing to release.
  }
}

// Gemini returns 503 "model is overloaded" often enough that a single attempt is
// not usable in a kitchen. Back off and retry before giving up on this model,
// but never past the deadline: the caller has to receive the real explanation
// rather than have the gateway time the request out first.
async function callGemini(
  model: string,
  apiKey: string,
  base64: string,
  mimeType: string,
  deadline: number,
) {
  let res = await callGeminiOnce(model, apiKey, base64, mimeType);

  for (let attempt = 1; attempt < MAX_ATTEMPTS && RETRY_STATUSES.includes(res.status); attempt++) {
    // 1s, 2s, 4s plus jitter so parallel scans do not retry in lockstep.
    const wait = 1000 * 2 ** (attempt - 1) + Math.random() * 400;
    if (Date.now() + wait > deadline) break;

    await discard(res);
    await sleep(wait);
    res = await callGeminiOnce(model, apiKey, base64, mimeType);
  }

  return res;
}

function stripDataUrl(value: string): string {
  const commaIndex = value.indexOf(',');
  if (value.startsWith('data:') && commaIndex !== -1) {
    return value.slice(commaIndex + 1);
  }
  return value;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const body = await parseJsonBody(req);
  const rawImage = typeof body.image_base64 === 'string' ? body.image_base64 : '';
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg';

  if (!rawImage) return errorResponse('Missing image_base64.', 400);
  if (!ALLOWED_MIME.includes(mimeType)) {
    return errorResponse(`Unsupported mime_type "${mimeType}".`, 400);
  }

  const base64 = stripDataUrl(rawImage);
  if (base64.length > MAX_BASE64_LENGTH) {
    return errorResponse('Image is too large. Downscale it before uploading.', 413);
  }

  const supabase = serviceClient();
  if (!supabase) {
    return errorResponse('Missing Supabase env vars.', 500);
  }

  if (!(await isActiveAdmin(supabase, body.admin_id))) {
    return errorResponse('Not authorised. Sign in as an admin.', 403);
  }

  const apiKey = await resolveGeminiKey(supabase);
  if (!apiKey) {
    return errorResponse('No Gemini API key configured. Set it in Settings or the GEMINI_API_KEY env var.', 500);
  }

  // Leaves headroom under the platform's request timeout so the fallback
  // message below is what the operator actually sees.
  const deadline = Date.now() + REQUEST_BUDGET_MS;

  // Collected so the reported failure names the real cause per model rather
  // than whichever candidate happened to be tried last.
  const failures: { model: string; status: number | null; reason: string }[] = [];

  for (const model of MODEL_CANDIDATES) {
    if (Date.now() > deadline) {
      failures.push({ model, status: null, reason: 'skipped, request budget spent' });
      break;
    }

    let res: Response;
    try {
      res = await callGemini(model, apiKey, base64, mimeType, deadline);
    } catch (err) {
      failures.push({ model, status: null, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (res.status === 404) {
      await discard(res);
      failures.push({ model, status: 404, reason: 'not available for this API key' });
      continue;
    }

    if (res.status === 429) {
      await discard(res);
      failures.push({ model, status: 429, reason: 'quota exhausted' });
      continue;
    }

    if (RETRY_STATUSES.includes(res.status)) {
      await discard(res);
      failures.push({ model, status: res.status, reason: 'overloaded after retries' });
      continue;
    }

    if (!res.ok) {
      const detail = await res.text();
      return errorResponse(`Gemini returned ${res.status}.`, 502, { detail: detail.slice(0, 800) });
    }

    const payload = await res.json();
    const parts: GeminiPart[] = payload?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map(p => p.text ?? '').join('').trim();

    if (!text) {
      const finishReason = payload?.candidates?.[0]?.finishReason ?? 'unknown';
      return errorResponse(`Gemini returned no content (finishReason: ${finishReason}).`, 502);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return errorResponse('Gemini returned malformed JSON.', 502, { raw: text.slice(0, 800) });
    }

    return jsonResponse({
      ...parsed,
      model_used: model,
    });
  }

  // Every candidate failed. Lead with the cause the admin can actually act on.
  const allQuota = failures.length > 0 && failures.every(f => f.status === 429 || f.status === 404);
  const anyQuota = failures.some(f => f.status === 429);

  const message = allQuota && anyQuota
    ? 'Gemini quota is exhausted for today. This API key is on the free tier — enable billing on the Google AI Studio project, or try again tomorrow.'
    : anyQuota
      ? 'Gemini is out of quota on some models and overloaded on the rest. Try again in a few minutes.'
      : 'Gemini is overloaded right now. Try again in a minute.';

  return errorResponse(message, 502, {
    attempts: failures.map(f => `${f.model}: ${f.status ?? 'network'} — ${f.reason}`),
  });
});
