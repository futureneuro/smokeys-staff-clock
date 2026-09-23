// One Gemini client for every function that talks to it.
//
// Model order, key lookup, retry, fallback and the wording of failures used to
// be copied into each function and had already drifted. The scanner, the POS
// mapper, the month summary and the task generator now share this file, so a
// retired model or a new quota message is fixed in one place.

import type { ServiceClient } from './admin.ts';

// Tried in order. Each fallback sits on separate capacity and, on the free
// tier, its own quota bucket, so an overloaded or exhausted primary does not
// take the feature down.
//
// Ordered by measured round-trip on this project's key (2026-09-14, one-token
// reply), not by version number:
//
//   gemini-3.6-flash      1.7s
//   gemini-3.5-flash      4.6s
//   gemini-flash-latest  47.3s   alias — whatever it resolves to today thinks hard
//
// gemini-3.7-flash was dropped: 503 UNAVAILABLE or ~37s when it did answer.
// Re-measure before reordering — these are capacity figures and they move.
export const MODEL_CANDIDATES: string[] = [...new Set([
  Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
])];

// The env var wins so a key can be rotated without touching the database;
// otherwise the key the admin saved under Settings, read with the service role
// so it never has to travel to the browser.
export async function resolveGeminiKey(supabase: ServiceClient): Promise<string | null> {
  const fromEnv = Deno.env.get('GEMINI_API_KEY');
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const { data, error } = await supabase.from('settings').select('gemini_api_key').limit(1).maybeSingle();
  if (error || !data) return null;
  const key = (data as { gemini_api_key: string | null }).gemini_api_key;
  return key && key.trim() ? key.trim() : null;
}

export type GeminiFailureKind =
  | 'invalid_key'   // 400 API_KEY_INVALID or 403: the key itself is wrong
  | 'quota'         // every model answered 429
  | 'no_model'      // every model answered 404: the list needs a code change
  | 'unavailable'   // overloaded / network / mixed failures
  | 'bad_response'; // 200 with nothing usable in it

export class GeminiError extends Error {
  kind: GeminiFailureKind;
  attempts: string[];
  constructor(kind: GeminiFailureKind, message: string, attempts: string[] = []) {
    super(message);
    this.kind = kind;
    this.attempts = attempts;
  }
}

export interface GeminiRequest {
  contents: unknown[];
  generationConfig?: Record<string, unknown>;
}

export interface GeminiOptions {
  models?: string[];
  // Per model, on 500/503 only. Backoff is 1s, 2s, 4s plus jitter.
  attemptsPerModel?: number;
  // Total time allowed across all models and retries. The platform gateway
  // times a request out at 60s and replaces the useful error with a generic
  // one, so callers keep this under that.
  budgetMs?: number;
}

export interface GeminiResult {
  text: string;
  model: string;
  payload: unknown;
}

const RETRY_STATUSES = [500, 503];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function discard(res: Response) {
  try {
    await res.body?.cancel();
  } catch {
    // Already closed; nothing to release.
  }
}

async function callOnce(model: string, apiKey: string, request: GeminiRequest): Promise<Response> {
  return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Header rather than ?key=, which would put the secret into every proxy
      // and request log between here and Google.
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(request),
  });
}

// Sends one request, walking the model list and retrying transient errors,
// and returns the text of the first usable reply. Throws GeminiError with a
// message the operator can act on when nothing answers.
export async function generateContent(
  apiKey: string,
  request: GeminiRequest,
  options: GeminiOptions = {},
): Promise<GeminiResult> {
  const models = options.models ?? MODEL_CANDIDATES;
  const attemptsPerModel = options.attemptsPerModel ?? 2;
  const deadline = Date.now() + (options.budgetMs ?? 50_000);

  // Collected so the reported failure names the real cause per model rather
  // than whichever candidate happened to be tried last.
  const failures: { model: string; status: number | null; reason: string }[] = [];

  for (const model of models) {
    if (Date.now() > deadline) {
      failures.push({ model, status: null, reason: 'skipped, request budget spent' });
      break;
    }

    let res: Response | null = null;
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      if (attempt > 0) {
        const wait = 1000 * 2 ** (attempt - 1) + Math.random() * 400;
        if (Date.now() + wait > deadline) break;
        await sleep(wait);
      }
      try {
        res = await callOnce(model, apiKey, request);
      } catch (e) {
        res = null;
        failures.push({ model, status: null, reason: e instanceof Error ? e.message : String(e) });
        break;
      }
      if (!RETRY_STATUSES.includes(res.status)) break;
      if (attempt < attemptsPerModel - 1) await discard(res);
    }
    if (!res) continue;

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
      const detail = await res.text().catch(() => '');
      // A bad key fails the same way on every model, so stop here.
      if (res.status === 403 || (res.status === 400 && detail.includes('API_KEY_INVALID'))) {
        throw new GeminiError('invalid_key', 'Invalid or expired Gemini API key. Check it at aistudio.google.com/apikey.');
      }
      throw new GeminiError('unavailable', `Gemini returned ${res.status}: ${detail.slice(0, 300)}`);
    }

    const payload = await res.json();
    const parts: { text?: string }[] = payload?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map(p => p.text ?? '').join('').trim();
    if (!text) {
      const finishReason = payload?.candidates?.[0]?.finishReason ?? 'unknown';
      throw new GeminiError('bad_response', `Gemini returned no content (finishReason: ${finishReason}).`);
    }
    return { text, model, payload };
  }

  const attempts = failures.map(f => `${f.model}: ${f.status ?? 'network'} — ${f.reason}`);
  const all = (status: number) => failures.length > 0 && failures.every(f => f.status === status);
  const any = (status: number) => failures.some(f => f.status === status);

  if (all(404)) {
    throw new GeminiError('no_model', 'No usable Gemini model. The configured models may have been retired — this needs a code change, not a new key.', attempts);
  }
  if (failures.length > 0 && failures.every(f => f.status === 429 || f.status === 404) && any(429)) {
    throw new GeminiError('quota', 'Gemini quota is exhausted for today. This API key is on the free tier — enable billing on the Google AI Studio project, or try again tomorrow.', attempts);
  }
  if (any(429)) {
    throw new GeminiError('unavailable', 'Gemini is out of quota on some models and overloaded on the rest. Try again in a few minutes.', attempts);
  }
  throw new GeminiError('unavailable', 'Gemini is overloaded right now. Try again in a minute.', attempts);
}

// HTTP status a function should answer with for each failure kind.
export function geminiHttpStatus(err: GeminiError): number {
  switch (err.kind) {
    case 'invalid_key': return 400;
    case 'quota': return 429;
    case 'no_model': return 502;
    case 'bad_response': return 502;
    default: return 503;
  }
}
