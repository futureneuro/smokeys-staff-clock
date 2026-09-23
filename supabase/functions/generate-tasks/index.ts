// Turns a manager's instruction into a handful of task templates for review.
//
// Nothing here writes to the database: the suggestions go back to the browser
// and only the ones the admin ticks are saved.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts';
import { serviceClient } from '../_shared/admin.ts';
import { GeminiError, generateContent, geminiHttpStatus, resolveGeminiKey } from '../_shared/gemini.ts';

interface StaffRef {
  name: string;
  role: string;
  staff_code: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const supabase = serviceClient();
  if (!supabase) return errorResponse('Missing Supabase env vars.', 500);

  const body = await parseJsonBody(req);
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) return errorResponse('Please provide a task instruction.', 400);

  const staffList = Array.isArray(body.staff_list) ? (body.staff_list as StaffRef[]) : [];

  // The Settings screen's "Test connection" sends the key it is about to save,
  // so an unsaved key can be tried first. Everything else relies on the stored
  // one, read server-side.
  const bodyKey = typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : null;
  const geminiKey = bodyKey ?? await resolveGeminiKey(supabase);
  if (!geminiKey) {
    return errorResponse('No Gemini API key configured. Go to Settings → AI Configuration to add your key.', 400);
  }

  const staffContext = staffList.length > 0
    ? `\nAvailable staff members: ${staffList.map(s => `${s.name} (${s.role}, ${s.staff_code})`).join(', ')}`
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

  let rawText: string;
  try {
    const result = await generateContent(geminiKey, {
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
    });
    rawText = result.text;
  } catch (err) {
    if (err instanceof GeminiError) {
      if (err.kind === 'bad_response') {
        return errorResponse('AI returned an empty response. Try rephrasing your instruction.', 500);
      }
      return errorResponse(err.message, geminiHttpStatus(err));
    }
    console.error('generate-tasks error:', err);
    return errorResponse('Internal server error.', 500);
  }

  let tasks: unknown;
  try {
    const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    tasks = JSON.parse(cleaned);
  } catch {
    console.error('Failed to parse AI response:', rawText);
    return errorResponse('AI returned invalid format. Try again with a clearer instruction.', 500);
  }
  const list = Array.isArray(tasks) ? tasks : [tasks];

  const validTasks = list
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object' && typeof (t as Record<string, unknown>).title === 'string')
    .slice(0, 10)
    .map(t => ({
      title: String(t.title).slice(0, 200),
      description: t.description ? String(t.description).slice(0, 500) : '',
      priority: ['low', 'medium', 'high'].includes(String(t.priority)) ? String(t.priority) : 'medium',
    }));

  if (validTasks.length === 0) {
    return errorResponse('AI could not generate valid tasks. Try a different instruction.', 500);
  }

  return jsonResponse({ success: true, tasks: validTasks });
});
