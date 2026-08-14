/* Nutrition estimates from a language model.

   The local table in app.js is a regex list. It cannot know that a McDonald's
   cheeseburger is 300 rather than a generic burger's 400, and it reads portions
   from whatever the person happened to type. This is the fallback for when that
   is not good enough — asked for explicitly, one meal at a time.

   Nothing here is trusted. The model is asked for strict JSON and every number
   that comes back is checked and clamped before it reaches a caller: a reply
   that is missing, malformed, negative or absurd is treated as a failure rather
   than as data. A calorie count is something people may act on, so a confidently
   wrong figure is worse than an honest error.

   The key lives only in the environment. It is never returned, logged, or sent
   to the browser — the client is told whether the feature is on, nothing more. */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Overridable because model names change faster than this file will.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 15000;
const MAX_TEXT = 1200;

export const aiConfigured = () => !!(process.env.GEMINI_API_KEY || '').trim();

/* Deliberately narrow. The model is not asked for advice, only for arithmetic
   it is better at than a regex — naming the foods it found is what lets a
   person see whether it read them correctly. */
const SYSTEM = `You estimate the nutrition of food described in free text.

Rules:
- Read every item, including quantities and weights ("250g", "2 large", "1 cup").
- Use typical published values for the named brand or dish where you know it.
- Items that are not food (supplements with no calories, water, plain black coffee) count as near zero.
- If an item is too vague to price, include it with your best typical estimate.
- Reply with JSON only, no prose, in exactly this shape:
{"kcal":number,"protein":number,"carbs":number,"fat":number,"items":[{"name":string,"kcal":number}]}
- All numbers are for the whole text combined, in kilocalories and grams.`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* Sanity bounds. A day's eating above 20,000 kcal is a parse failure, not a
   meal, and the macros have to be within reach of the energy they describe. */
function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const kcal = num(parsed.kcal), p = num(parsed.protein), c = num(parsed.carbs), f = num(parsed.fat);
  if (kcal === null || kcal < 0 || kcal > 20000) return null;
  if ([p, c, f].some((x) => x === null || x < 0 || x > 2000)) return null;

  const items = Array.isArray(parsed.items)
    ? parsed.items
        .filter((i) => i && typeof i.name === 'string' && num(i.kcal) !== null)
        .slice(0, 40)
        .map((i) => ({ name: i.name.slice(0, 80), kcal: Math.round(Math.max(0, i.kcal)) }))
    : [];

  return {
    kcal: Math.round(kcal), protein: Math.round(p), carbs: Math.round(c), fat: Math.round(f),
    items, source: 'ai'
  };
}

export async function estimateNutrition(text) {
  if (!aiConfigured()) throw new Error('AI estimates are not configured on this server.');
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error('Nothing to estimate.');

  // Node's fetch has no timeout of its own; without this a hung upstream would
  // hold the request open until the browser gave up.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      signal: abort.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY.trim() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: clean }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 900 }
      })
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'The estimate timed out.' : 'Could not reach the estimate service.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    /* Surfaced rather than swallowed: a wrong model name or a rejected key both
       arrive here, and both are configuration problems that are invisible
       otherwise. The body can carry the key back in an error echo, so only the
       status and the upstream message are kept. */
    let detail = '';
    try {
      const body = await res.json();
      detail = (body && body.error && body.error.message) || '';
    } catch { /* non-JSON error body */ }
    console.error(`[zimpan] estimate upstream ${res.status}${detail ? `: ${detail}` : ''}`);
    throw new Error(res.status === 429
      ? 'The estimate service is rate limiting us. Try again shortly.'
      : 'The estimate service refused the request.');
  }

  const body = await res.json();
  const raw = body && body.candidates && body.candidates[0]
    && body.candidates[0].content && body.candidates[0].content.parts
    && body.candidates[0].content.parts[0] && body.candidates[0].content.parts[0].text;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some replies fence the JSON despite being asked not to.
    const fenced = /\{[\s\S]*\}/.exec(String(raw || ''));
    if (fenced) { try { parsed = JSON.parse(fenced[0]); } catch { /* give up below */ } }
  }

  const clean2 = validate(parsed);
  if (!clean2) {
    console.error('[zimpan] estimate returned something unusable');
    throw new Error('The estimate came back in a form we could not read.');
  }
  return clean2;
}
