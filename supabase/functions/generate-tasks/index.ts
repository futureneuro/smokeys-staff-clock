import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// gemini-2.0-flash-lite, gemini-1.5-flash and gemini-2.0-flash were all
// retired and return 404 NOT_FOUND. Every call failed, and because the only
// failure message blamed the API key, the key kept getting replaced and the
// feature kept not working. Ordered by measured round-trip, same as the
// receipt scanner.
const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

type GeminiFailure = { status: number; body: string };

async function callGemini(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ res: Response | null; failure: GeminiFailure | null }> {
  let failure: GeminiFailure | null = null;

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header rather than ?key=, which puts the secret into every proxy
          // and request log between here and Google.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return { res, failure: null };

      const errText = await res.text();
      failure = { status: res.status, body: errText.slice(0, 300) };
      console.log(`Model ${model} failed (${res.status}): ${errText.slice(0, 200)}`);

      // A bad key or a forbidden key fails the same way on every model, so
      // stop. Anything else (404 retired, 503 overloaded) is per-model.
      if (res.status === 403) break;
      if (res.status === 400 && errText.includes('API_KEY_INVALID')) break;
    } catch (e) {
      failure = { status: 0, body: String(e).slice(0, 300) };
      console.log(`Model ${model} network error:`, e);
    }
  }

  return { res: null, failure };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { instruction, staff_list, api_key } = await req.json();

    if (!instruction || !instruction.trim()) {
      return jsonResponse({ error: 'Please provide a task instruction.' }, 400);
    }

    // Get API key: prefer request body, fallback to settings table
    let geminiKey = api_key;
    if (!geminiKey) {
      const { data: settings } = await supabase
        .from('settings')
        .select('gemini_api_key')
        .limit(1)
        .single();
      geminiKey = settings?.gemini_api_key;
    }

    if (!geminiKey) {
      return jsonResponse({
        error: 'No Gemini API key configured. Go to Settings → AI Configuration to add your key.',
      }, 400);
    }

    const staffContext = staff_list && staff_list.length > 0
      ? `\nAvailable staff members: ${staff_list.map((s: { name: string; role: string; staff_code: string }) => `${s.name} (${s.role}, ${s.staff_code})`).join(', ')}`
      : '';

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are a restaurant task manager assistant for Smokey's restaurant. Generate practical, actionable task templates based on the manager's instruction.

Today's date is ${today}.
${staffContext}

Rules:
- Generate between 1 and 10 tasks based on the instruction
- Each task must have: title (short, clear), description (1-2 sentences), priority (low/medium/high)
- Tasks should be specific and actionable, not vague

Respond ONLY with a JSON array. No markdown, no explanation. Example:
[{"title": "Clean fryers", "description": "Deep clean all fryers and replace oil.", "priority": "high"}]`;

    const requestBody = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: `Manager's instruction: ${instruction}` },
        ],
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    };

    const { res: geminiRes, failure } = await callGemini(geminiKey, requestBody);

    if (!geminiRes) {
      // Say which failure it actually was. The old message asserted a bad key
      // no matter what went wrong, which sent people to rotate a key that was
      // working perfectly well.
      if (failure?.status === 403 || (failure?.status === 400 && failure.body.includes('API_KEY_INVALID'))) {
        return jsonResponse({ error: 'Invalid or expired Gemini API key. Please verify your key at aistudio.google.com/apikey' }, 400);
      }
      if (failure?.status === 429) {
        return jsonResponse({ error: 'Gemini quota exhausted for today. Enable billing or wait for the quota to reset.' }, 429);
      }
      if (failure?.status === 404) {
        return jsonResponse({ error: 'No usable Gemini model. The configured models may have been retired — this needs a code change, not a new key.' }, 502);
      }
      return jsonResponse({
        error: `Gemini is unavailable right now${failure ? ` (${failure.status})` : ''}. This is usually temporary — try again in a minute.`,
      }, 503);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return jsonResponse({ error: 'AI returned an empty response. Try rephrasing your instruction.' }, 500);
    }

    let tasks;
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      tasks = JSON.parse(cleaned);
      if (!Array.isArray(tasks)) tasks = [tasks];
    } catch {
      console.error('Failed to parse AI response:', rawText);
      return jsonResponse({ error: 'AI returned invalid format. Try again with a clearer instruction.' }, 500);
    }

    const validTasks = tasks
      .filter((t: Record<string, unknown>) => t.title && typeof t.title === 'string')
      .slice(0, 10)
      .map((t: Record<string, unknown>) => ({
        title: String(t.title).slice(0, 200),
        description: t.description ? String(t.description).slice(0, 500) : '',
        priority: ['low', 'medium', 'high'].includes(String(t.priority)) ? String(t.priority) : 'medium',
      }));

    if (validTasks.length === 0) {
      return jsonResponse({ error: 'AI could not generate valid tasks. Try a different instruction.' }, 500);
    }

    return jsonResponse({ success: true, tasks: validTasks });
  } catch (err) {
    console.error('generate-tasks error:', err);
    return jsonResponse({ error: 'Internal server error.' }, 500);
  }
});
