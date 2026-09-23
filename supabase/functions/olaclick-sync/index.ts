// Imports a day's sales from OlaClick and deducts them from stock.
//
// Actions:
//   sync        one finished day (default: yesterday in Bogotá)    admin or schedule
//   sync_range  every day from `from` (default: the day after the   admin
//               last day on record) up to `to` (default: yesterday)
//   retry_held  re-run recent days that were held or failed        admin
//   scheduled   yesterday, then retry held days                    schedule only
//   suggest     ask Gemini to propose mappings for unmapped rows   admin
//
// Nothing runs on a timer: the manager presses Import, looks at what came
// back, and confirms the matching. sync_range exists so catching up after a
// week away is one press, not seven.
//
// The mapping decisions live in _shared/pos-mapping.ts. This file only fetches,
// records, and hands confirmed days to inv_confirm_sales_entry — the same
// function the Sales screen uses — so there is exactly one way stock moves.

import { corsHeaders, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts';
import { hasSharedSecret, isActiveAdmin, serviceClient, type ServiceClient } from '../_shared/admin.ts';
import { GeminiError, generateContent, geminiHttpStatus, resolveGeminiKey } from '../_shared/gemini.ts';
import {
  discoverTokens,
  resolveDay,
  summariseFreehand,
  type MenuItemRef,
  type ModifierMapping,
  type PosFreehandRow,
  type PosProductRow,
  type ProductMapping,
} from '../_shared/pos-mapping.ts';

type Client = ServiceClient;

const OLACLICK_BASE = (Deno.env.get('OLACLICK_BASE_URL') ?? 'https://public-api.olaclick.app').replace(/\/+$/, '');
const TIMEZONE = 'America/Bogota';
// Long enough to cover a mapping left for a week or two, short enough that a
// forgotten day does not quietly get deducted a month late.
const RETRY_WINDOW_DAYS = 14;
const MAX_PAGES = 20;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function bogotaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Noon UTC keeps the arithmetic clear of any date-line edge.
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// OlaClick
// ---------------------------------------------------------------------------

class OlaClickError extends Error {}

function describeOlaClickFailure(status: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.detail || parsed?.title || '';
  } catch {
    detail = body.slice(0, 200);
  }
  if (status === 401) return 'OlaClick rejected the API key. Generate a new one under Integrations → API Keys.';
  if (status === 403) return `The OlaClick API key lacks a required scope (needs orders:read). ${detail}`.trim();
  if (status === 429) return 'OlaClick rate limit reached. The next run will pick this day up.';
  if (status === 422) return `OlaClick refused the request: ${detail || 'invalid parameters'}`;
  return `OlaClick returned ${status}${detail ? `: ${detail}` : ''}`;
}

async function fetchReport(apiKey: string, date: string, include: 'products_modifiers' | 'freehand'): Promise<unknown[]> {
  const rows: unknown[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${OLACLICK_BASE}/v1/orders/products-sold`);
    url.searchParams.set('filter[start_date]', date);
    url.searchParams.set('filter[end_date]', date);
    url.searchParams.set('filter[include]', include);
    // Cancelled orders never reached a plate. Stated outright rather than
    // relying on whatever the endpoint happens to default to.
    url.searchParams.set('filter[status]', 'finalized,delivered');
    url.searchParams.set('timezone', TIMEZONE);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));

    const res = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OlaClickError(describeOlaClickFailure(res.status, text));
    }

    const json = await res.json().catch(() => null);
    const data = Array.isArray(json?.data) ? json.data : [];
    rows.push(...data);

    if (json?.pagination?.has_more !== true || data.length === 0) break;
    if (page === MAX_PAGES) {
      // Twenty full pages is two thousand distinct products in one day. Stop
      // loudly rather than import a truncated day as if it were whole.
      throw new OlaClickError(`OlaClick report for ${date} exceeded ${MAX_PAGES} pages; refusing a partial import.`);
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

type ImportStatus = 'pending_mapping' | 'confirmed' | 'skipped_manual' | 'no_sales' | 'failed';

interface DayResult {
  sold_on: string;
  status: ImportStatus;
  already?: boolean;
  held_count?: number;
  deducted_count?: number;
  not_deducted_count?: number;
  error?: string;
}

interface Trigger {
  by: 'schedule' | 'admin';
  adminId: string | null;
}

async function upsertImport(supabase: Client, row: Record<string, unknown>) {
  const { error } = await supabase
    .from('inv_pos_imports')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'sold_on' });
  if (error) throw new Error(`Could not record the import: ${error.message}`);
}

// Whoever confirmed the day first owns it. Used on every failure path, because
// two runs racing for one day (the schedule and a button press) must not leave
// the loser's "failed" written over the winner's confirmed import.
async function confirmedEntryFor(supabase: Client, date: string) {
  const { data, error } = await supabase
    .from('inv_sales_entries')
    .select('id, source')
    .eq('sold_on', date)
    .eq('status', 'confirmed')
    .maybeSingle();
  // A failed lookup must not read as "no manual entry": that would let an
  // import land on top of a day someone typed in, or record a day as failed
  // when it was in fact confirmed. A missing grant is the usual cause.
  if (error) throw new Error(`Could not check existing sales for ${date}: ${error.message}`);
  return data as { id: string; source: string } | null;
}

async function syncDay(supabase: Client, apiKey: string, date: string, trigger: Trigger): Promise<DayResult> {
  const today = bogotaToday();
  if (date >= today) {
    return { sold_on: date, status: 'failed', error: `${date} is not over yet in Bogotá. Only finished days can be imported.` };
  }

  const { data: existing } = await supabase
    .from('inv_pos_imports')
    .select('status')
    .eq('sold_on', date)
    .maybeSingle();
  if ((existing as { status?: string } | null)?.status === 'confirmed') {
    return { sold_on: date, status: 'confirmed', already: true };
  }

  const base = {
    sold_on: date,
    triggered_by: trigger.by,
    triggered_admin: trigger.adminId,
  };

  // A day typed in on the Sales screen stays as typed. Importing on top would
  // hit the one-confirmed-entry-per-day index at best, and at worst someone
  // would "fix" it by deleting the manual entry and lose what they knew.
  const manual = await confirmedEntryFor(supabase, date);
  if (manual && manual.source !== 'olaclick') {
    await upsertImport(supabase, { ...base, status: 'skipped_manual', sales_entry_id: manual.id, error: null });
    return { sold_on: date, status: 'skipped_manual' };
  }

  let products: PosProductRow[];
  let freehand: PosFreehandRow[];
  try {
    const [p, f] = await Promise.all([
      fetchReport(apiKey, date, 'products_modifiers'),
      fetchReport(apiKey, date, 'freehand'),
    ]);
    products = p as PosProductRow[];
    freehand = f as PosFreehandRow[];
  } catch (e) {
    await upsertImport(supabase, { ...base, status: 'failed', error: message(e), fetched_at: new Date().toISOString() });
    return { sold_on: date, status: 'failed', error: message(e) };
  }

  // --- discovery: anything never seen before becomes a row to map ----------
  const { data: mapsBefore } = await supabase
    .from('inv_pos_product_map')
    .select('pos_product_id, pos_variant_id, kind, menu_item_id, portion_label, confirmed');

  if (products.length > 0) {
    const { error: productError } = await supabase.from('inv_pos_product_map').upsert(
      products.map(p => ({
        pos_product_id: p.product_id,
        pos_variant_id: p.variant_id ?? '',
        pos_name: p.product_name,
        last_seen_on: date,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'pos_product_id,pos_variant_id' },
    );
    if (productError) throw new Error(`Could not record POS products: ${productError.message}`);

    const tokens = discoverTokens(products, (mapsBefore ?? []) as ProductMapping[]);
    if (tokens.length > 0) {
      const { error: tokenError } = await supabase.from('inv_pos_modifier_map').upsert(
        tokens.map(t => ({ ...t, last_seen_on: date, updated_at: new Date().toISOString() })),
        { onConflict: 'token_key' },
      );
      if (tokenError) throw new Error(`Could not record bowl pieces: ${tokenError.message}`);
    }
  }

  // --- resolve against confirmed mappings only ------------------------------
  const [productMaps, modifierMaps, menuItems] = await Promise.all([
    supabase.from('inv_pos_product_map').select('pos_product_id, pos_variant_id, kind, menu_item_id, portion_label, confirmed'),
    supabase.from('inv_pos_modifier_map').select('token_key, kind, component_name, confirmed'),
    supabase.from('inv_menu_items').select('id, name, portion_label, recipe_complete, active'),
  ]);
  for (const r of [productMaps, modifierMaps, menuItems]) {
    if (r.error) throw new Error(`Could not load mappings: ${r.error.message}`);
  }

  const day = resolveDay(
    products,
    (productMaps.data ?? []) as ProductMapping[],
    (modifierMaps.data ?? []) as ModifierMapping[],
    (menuItems.data ?? []) as MenuItemRef[],
  );
  const comps = summariseFreehand(freehand);

  const heldCount = day.unmapped_products.length + day.unmapped_tokens.length + day.unresolved_components.length;
  const record = {
    ...base,
    item_count: day.item_count,
    revenue_cop: day.revenue_cop,
    deducted_count: day.deducted.length,
    not_deducted_count: day.not_deducted.length,
    held_count: heldCount,
    freehand_count: comps.reduce((s, c) => s + c.qty, 0),
    summary: {
      deducted: day.deducted,
      not_deducted: day.not_deducted,
      unmapped_products: day.unmapped_products,
      unmapped_tokens: day.unmapped_tokens,
      unresolved_components: day.unresolved_components,
      ignored: day.ignored,
      freehand: comps,
      bowl_pieces: day.bowl_pieces,
    },
    raw_products: products,
    raw_freehand: freehand,
    fetched_at: new Date().toISOString(),
    error: null,
  };

  const counts = {
    held_count: heldCount,
    deducted_count: day.deducted.length,
    not_deducted_count: day.not_deducted.length,
  };

  if (day.item_count === 0) {
    await upsertImport(supabase, { ...record, status: 'no_sales' });
    return { sold_on: date, status: 'no_sales', ...counts };
  }

  if (day.held) {
    await upsertImport(supabase, { ...record, status: 'pending_mapping' });
    return { sold_on: date, status: 'pending_mapping', ...counts };
  }

  // Everything was recognised but nothing had a finished recipe or everything
  // was marked not-inventory. The day is done; there is simply nothing to take
  // off stock, and an empty sales entry would only add noise to the Sales tab.
  if (day.deducted.length === 0) {
    await upsertImport(supabase, { ...record, status: 'confirmed', confirmed_at: new Date().toISOString() });
    return { sold_on: date, status: 'confirmed', ...counts };
  }

  // --- write and confirm through the existing path --------------------------
  const { data: entry, error: entryError } = await supabase
    .from('inv_sales_entries')
    .insert({
      sold_on: date,
      status: 'draft',
      source: 'olaclick',
      note: `OlaClick · ${day.item_count} artículos`,
      created_by: trigger.adminId,
    })
    .select('id')
    .single();

  const fail = async (reason: string): Promise<DayResult> => {
    const winner = await confirmedEntryFor(supabase, date);
    if (winner) {
      const status: ImportStatus = winner.source === 'olaclick' ? 'confirmed' : 'skipped_manual';
      await upsertImport(supabase, { ...record, status, sales_entry_id: winner.id, confirmed_at: new Date().toISOString() });
      return { sold_on: date, status, ...counts };
    }
    await upsertImport(supabase, { ...record, status: 'failed', error: reason });
    return { sold_on: date, status: 'failed', error: reason, ...counts };
  };

  if (entryError || !entry) return fail(entryError?.message ?? 'Could not create the sales entry.');
  const entryId = (entry as { id: string }).id;

  const { error: linesError } = await supabase
    .from('inv_sales_lines')
    .insert(day.deducted.map(line => ({ sales_entry_id: entryId, menu_item_id: line.menu_item_id, qty_sold: line.qty })));
  if (linesError) {
    await supabase.from('inv_sales_entries').delete().eq('id', entryId);
    return fail(linesError.message);
  }

  const { error: confirmError } = await supabase.rpc('inv_confirm_sales_entry', {
    p_entry_id: entryId,
    p_actor_id: trigger.adminId,
  });
  if (confirmError) {
    // Atomic RPC: nothing was deducted. Remove the draft so no screen shows a
    // half-imported day.
    await supabase.from('inv_sales_entries').delete().eq('id', entryId);
    return fail(confirmError.message);
  }

  await upsertImport(supabase, {
    ...record,
    status: 'confirmed',
    sales_entry_id: entryId,
    confirmed_at: new Date().toISOString(),
  });
  return { sold_on: date, status: 'confirmed', ...counts };
}

async function retryHeld(supabase: Client, apiKey: string, trigger: Trigger, skip: Set<string>): Promise<DayResult[]> {
  const since = addDays(bogotaToday(), -RETRY_WINDOW_DAYS);
  const { data, error } = await supabase
    .from('inv_pos_imports')
    .select('sold_on')
    .in('status', ['pending_mapping', 'failed'])
    .gte('sold_on', since)
    .order('sold_on', { ascending: true });
  if (error) throw new Error(error.message);

  const results: DayResult[] = [];
  // One at a time: they share mapping rows and the rate limit.
  for (const row of (data ?? []) as { sold_on: string }[]) {
    if (skip.has(row.sold_on)) continue;
    results.push(await syncDay(supabase, apiKey, row.sold_on, trigger));
  }
  return results;
}

// A whole range in one press. Days run oldest first so the ledger fills in
// order. The gateway cuts a request off at 60s and two OlaClick calls per day
// take about a second, so this stops early and hands back `next_from`; the
// screen calls again until `done`.
const RANGE_BUDGET_MS = 45_000;
const RANGE_MAX_DAYS = 366;

interface RangeResult {
  from: string;
  to: string;
  results: DayResult[];
  done: boolean;
  next_from: string | null;
}

async function lastDayOnRecord(supabase: Client): Promise<string | null> {
  const { data, error } = await supabase
    .from('inv_pos_imports')
    .select('sold_on')
    .order('sold_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the last imported day: ${error.message}`);
  return (data as { sold_on: string } | null)?.sold_on ?? null;
}

async function syncRange(
  supabase: Client,
  apiKey: string,
  from: string | null,
  to: string,
  trigger: Trigger,
): Promise<RangeResult> {
  const start = from ?? (await lastDayOnRecord(supabase).then(d => (d ? addDays(d, 1) : to)));
  if (start > to) return { from: start, to, results: [], done: true, next_from: null };

  const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
  if (span > RANGE_MAX_DAYS) throw new Error(`That is ${span} days. Import at most ${RANGE_MAX_DAYS} at a time.`);

  const began = Date.now();
  const results: DayResult[] = [];
  let day = start;
  while (day <= to) {
    if (Date.now() - began > RANGE_BUDGET_MS) {
      return { from: start, to, results, done: false, next_from: day };
    }
    results.push(await syncDay(supabase, apiKey, day, trigger));
    day = addDays(day, 1);
  }
  return { from: start, to, results, done: true, next_from: null };
}

// ---------------------------------------------------------------------------
// AI suggestions
// ---------------------------------------------------------------------------

const SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    products: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ref: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['menu_item', 'composite', 'ignore'] },
          menu_ref: { type: 'STRING' },
          portion: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['ref', 'kind', 'reason'],
      },
    },
    pieces: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ref: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['component', 'ignore'] },
          component_ref: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['ref', 'kind', 'reason'],
      },
    },
  },
  required: ['products', 'pieces'],
};

// Short refs instead of UUIDs: a model asked to echo a 36-character id will
// eventually return one that is almost right, and an almost-right id is a
// wrong mapping.
function buildPrompt(
  products: { ref: string; name: string }[],
  pieces: { ref: string; name: string }[],
  menu: { ref: string; label: string }[],
  components: { ref: string; name: string }[],
): string {
  return `You map point-of-sale products from Smokey's, a café in Medellín, onto its inventory menu.
POS names are the register's (mostly English) names. Menu names are the kitchen's Spanish names.

PRODUCT RULES
- kind "composite" ONLY for build-your-own bowls whose pieces are chosen separately, e.g. "BOWL - MEDIUM".
  portion: "Regular" for medium/regular, "Grande" for big/large.
- kind "menu_item" when one menu item is clearly the same dish or drink. Variants of one dish (bread type,
  "extra de proteína") map to that same menu item.
- If nothing on the menu matches, use kind "menu_item" with menu_ref "" and say what is missing. Do not guess.
- kind "ignore" only for things that are not food or drink stock at all (tips, service charges, gift cards).
- Be conservative. An empty ref with a clear reason is better than a wrong match.

BOWL PIECE RULES
- kind "component" with the component that is the same choice. Register text can be a typo
  ("Cruotones" is croutons) or phrased differently ("Pollo en especias" is the spiced chicken breast).
- "Sin salsa" or any "no X" choice is kind "ignore".
- If no component matches, use kind "component" with component_ref "" and explain.

Write reasons in Spanish, one short sentence.

MENU ITEMS
${menu.map(m => `${m.ref}: ${m.label}`).join('\n')}

BOWL COMPONENTS
${components.map(c => `${c.ref}: ${c.name}`).join('\n')}

POS PRODUCTS TO MAP
${products.map(p => `${p.ref}: ${p.name}`).join('\n') || '(none)'}

BOWL PIECES TO MAP
${pieces.map(p => `${p.ref}: ${p.name}`).join('\n') || '(none)'}`;
}

async function callGemini(apiKey: string, prompt: string): Promise<unknown> {
  const { text, model } = await generateContent(apiKey, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: SUGGEST_SCHEMA,
    },
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError('bad_response', `${model} returned unreadable JSON.`);
  }
}

async function suggest(supabase: Client): Promise<{ products: number; pieces: number }> {
  const [productRows, pieceRows, menuRows] = await Promise.all([
    supabase.from('inv_pos_product_map').select('id, pos_name').eq('confirmed', false).order('pos_name'),
    supabase.from('inv_pos_modifier_map').select('id, token_display').eq('confirmed', false).order('token_display'),
    supabase.from('inv_menu_items').select('id, name, category, portion_label').eq('active', true).order('category').order('name'),
  ]);
  for (const r of [productRows, pieceRows, menuRows]) {
    if (r.error) throw new Error(r.error.message);
  }

  const products = (productRows.data ?? []) as { id: string; pos_name: string }[];
  const pieces = (pieceRows.data ?? []) as { id: string; token_display: string }[];
  const menuAll = (menuRows.data ?? []) as { id: string; name: string; category: string; portion_label: string | null }[];

  if (products.length === 0 && pieces.length === 0) return { products: 0, pieces: 0 };

  const geminiKey = await resolveGeminiKey(supabase);
  if (!geminiKey) throw new Error('No Gemini API key is configured. Add one under Settings.');

  // Bowl components are offered as pieces, not as menu items, so a bowl piece
  // cannot be mistaken for a dish and a dish cannot be matched to "Topping: …".
  const menuItems = menuAll.filter(m => m.category !== 'bowl');
  const componentNames = [...new Set(menuAll.filter(m => m.category === 'bowl').map(m => m.name))].sort();

  const productRefs = products.map((p, i) => ({ ref: `P${i + 1}`, id: p.id, name: p.pos_name }));
  const pieceRefs = pieces.map((p, i) => ({ ref: `T${i + 1}`, id: p.id, name: p.token_display }));
  const menuRefs = menuItems.map((m, i) => ({
    ref: `M${i + 1}`,
    id: m.id,
    label: `${m.name}${m.portion_label ? ` (${m.portion_label})` : ''} [${m.category}]`,
  }));
  const componentRefs = componentNames.map((name, i) => ({ ref: `C${i + 1}`, name }));

  const raw = await callGemini(geminiKey, buildPrompt(productRefs, pieceRefs, menuRefs, componentRefs)) as {
    products?: { ref: string; kind: string; menu_ref?: string; portion?: string; reason?: string }[];
    pieces?: { ref: string; kind: string; component_ref?: string; reason?: string }[];
  };

  const productByRef = new Map(productRefs.map(p => [p.ref, p]));
  const pieceByRef = new Map(pieceRefs.map(p => [p.ref, p]));
  const menuByRef = new Map(menuRefs.map(m => [m.ref, m]));
  const componentByRef = new Map(componentRefs.map(c => [c.ref, c]));
  const now = new Date().toISOString();

  let productCount = 0;
  for (const s of raw?.products ?? []) {
    const target = productByRef.get(s.ref);
    if (!target || !['menu_item', 'composite', 'ignore'].includes(s.kind)) continue;
    const menuItem = s.menu_ref ? menuByRef.get(s.menu_ref) : undefined;
    const portion = s.portion === 'Regular' || s.portion === 'Grande' ? s.portion : null;

    const { error } = await supabase
      .from('inv_pos_product_map')
      .update({
        suggested_kind: s.kind,
        suggested_menu_item_id: s.kind === 'menu_item' ? menuItem?.id ?? null : null,
        suggested_portion_label: s.kind === 'composite' ? portion : null,
        suggestion_reason: (s.reason ?? '').slice(0, 300),
        suggested_at: now,
        updated_at: now,
      })
      .eq('id', target.id)
      .eq('confirmed', false);
    if (!error) productCount += 1;
  }

  let pieceCount = 0;
  for (const s of raw?.pieces ?? []) {
    const target = pieceByRef.get(s.ref);
    if (!target || !['component', 'ignore'].includes(s.kind)) continue;
    const component = s.component_ref ? componentByRef.get(s.component_ref) : undefined;

    const { error } = await supabase
      .from('inv_pos_modifier_map')
      .update({
        suggested_kind: s.kind,
        suggested_component_name: s.kind === 'component' ? component?.name ?? null : null,
        suggestion_reason: (s.reason ?? '').slice(0, 300),
        suggested_at: now,
        updated_at: now,
      })
      .eq('id', target.id)
      .eq('confirmed', false);
    if (!error) pieceCount += 1;
  }

  return { products: productCount, pieces: pieceCount };
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
  const action = typeof body.action === 'string' ? body.action : 'sync';

  const viaSchedule = hasSharedSecret(req, 'x-pos-sync-secret', 'POS_SYNC_SECRET');
  const adminId = typeof body.admin_id === 'string' ? body.admin_id : null;
  const viaAdmin = !viaSchedule && (await isActiveAdmin(supabase, adminId));

  if (!viaSchedule && !viaAdmin) return errorResponse('Not authorised. Sign in as an admin.', 403);

  // Which caller may use which action is settled before anything else, so a
  // refusal is never masked by a configuration error further down.
  if (!['sync', 'sync_range', 'retry_held', 'scheduled', 'suggest'].includes(action)) {
    return errorResponse(`Unknown action "${action}".`, 400);
  }
  if (action === 'suggest' && !viaAdmin) {
    return errorResponse('Suggestions are requested from the POS screen.', 403);
  }
  if (action === 'sync_range' && !viaAdmin) {
    return errorResponse('Range imports are started from the Sales screen.', 403);
  }
  if (action === 'scheduled' && !viaSchedule) {
    return errorResponse('This action is reserved for the daily schedule.', 403);
  }

  try {
    if (action === 'suggest') {
      return jsonResponse(await suggest(supabase));
    }

    // Validated before the key check so a bad date is reported as a bad date,
    // not as a server configuration problem.
    const rangeTo = typeof body.to === 'string' && body.to ? body.to : null;
    const rangeFrom = typeof body.from === 'string' && body.from ? body.from : null;
    if (action === 'sync_range') {
      if ((rangeTo !== null && !ISO_DATE_RE.test(rangeTo)) || (rangeFrom !== null && !ISO_DATE_RE.test(rangeFrom))) {
        return errorResponse('from and to must be YYYY-MM-DD.', 400);
      }
    }

    const apiKey = (Deno.env.get('OLACLICK_API_KEY') ?? '').trim();
    if (!apiKey) {
      return errorResponse('OLACLICK_API_KEY is not configured on the server, so sales cannot be imported yet.', 503);
    }

    const trigger: Trigger = viaSchedule ? { by: 'schedule', adminId: null } : { by: 'admin', adminId };
    const yesterday = addDays(bogotaToday(), -1);

    if (action === 'scheduled') {
      const first = await syncDay(supabase, apiKey, yesterday, trigger);
      const retried = await retryHeld(supabase, apiKey, trigger, new Set([yesterday]));
      return jsonResponse({ results: [first, ...retried] });
    }

    if (action === 'retry_held') {
      return jsonResponse({ results: await retryHeld(supabase, apiKey, trigger, new Set()) });
    }

    if (action === 'sync_range') {
      const to = rangeTo ?? yesterday;
      if (to > yesterday) return errorResponse(`${to} is not over yet in Bogotá. Only finished days can be imported.`, 400);
      return jsonResponse(await syncRange(supabase, apiKey, rangeFrom, to, trigger));
    }

    if (action === 'sync') {
      const soldOn = typeof body.sold_on === 'string' && body.sold_on ? body.sold_on : yesterday;
      if (!ISO_DATE_RE.test(soldOn)) return errorResponse('sold_on must be YYYY-MM-DD.', 400);
      return jsonResponse({ results: [await syncDay(supabase, apiKey, soldOn, trigger)] });
    }

    return errorResponse(`Unknown action "${action}".`, 400);
  } catch (e) {
    console.error('olaclick-sync failed:', e);
    if (e instanceof GeminiError) {
      return errorResponse(e.message, geminiHttpStatus(e), e.attempts.length ? { attempts: e.attempts } : {});
    }
    return errorResponse(message(e), 500);
  }
});
