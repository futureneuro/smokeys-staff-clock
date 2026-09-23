// Reads a purchase document (itemised receipt, bank transfer screenshot, or card
// slip) and returns structured data for a human to review.
//
// This function NEVER writes to the database. Extraction is a suggestion; the
// admin edits and confirms it in the UI, and only that confirmation moves stock.
// The whole point of the inventory feature is detecting discrepancies, so a
// hallucinated quantity must never be able to enter the ledger unreviewed.

import { corsHeaders, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts';
import { isActiveAdmin, serviceClient } from '../_shared/admin.ts';
import { GeminiError, generateContent, geminiHttpStatus, resolveGeminiKey } from '../_shared/gemini.ts';

// Roughly 8 MB of base64 ~= 6 MB of image. Phone photos compress well below this;
// anything larger is a sign the client skipped downscaling.
const MAX_BASE64_LENGTH = 8_000_000;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

// A photo is a big request and 503s are common, so this function retries
// harder than the text-only ones, but still inside the platform's 60s timeout
// so the real reason reaches the operator rather than a gateway error.
const ATTEMPTS_PER_MODEL = 4;
const REQUEST_BUDGET_MS = 55_000;

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

  let text: string;
  let model: string;
  try {
    const result = await generateContent(apiKey, {
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
    }, { attemptsPerModel: ATTEMPTS_PER_MODEL, budgetMs: REQUEST_BUDGET_MS });
    text = result.text;
    model = result.model;
  } catch (err) {
    if (err instanceof GeminiError) {
      return errorResponse(err.message, geminiHttpStatus(err), err.attempts.length ? { attempts: err.attempts } : {});
    }
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
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
});
