/* Nutrition estimates from Claude.

   The local table in app.js is a regex list. It cannot know that a McDonald's
   cheeseburger is 300 rather than a generic burger's 400, and it reads portions
   from whatever the person happened to type. This is the fallback for when that
   is not good enough — asked for explicitly, one meal at a time.

   The reply is constrained by a JSON schema rather than requested in prose, so
   "reply with JSON only" is enforced by the API instead of hoped for. Every
   number is still checked here afterwards: a schema guarantees shape, not sense,
   and 999,999 kcal is perfectly well-formed. A calorie count is something people
   may act on, so a confidently wrong figure is worse than an honest error.

   The key lives only in the environment. It is never returned, logged, or sent
   to the browser — the client is told whether the feature is on, nothing more. */

import Anthropic from '@anthropic-ai/sdk';

// Overridable because model names change faster than this file will.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 25000;
const MAX_TEXT = 1200;

export const aiConfigured = () => !!(process.env.ANTHROPIC_API_KEY || '').trim();

/* Built once, lazily — constructing it at import time would throw on a server
   with no key, which is the configuration the app is meant to run fine under. */
let client = null;
const anthropic = () => (client = client || new Anthropic({ maxRetries: 1 }));

/* Deliberately narrow. The model is not asked for advice, only for arithmetic
   it is better at than a regex — naming the foods it found is what lets a
   person see whether it read them correctly. */
const SYSTEM = `You estimate the nutrition of food described in free text.

- Read every item, including quantities and weights ("250g", "2 large", "1 cup").
- Use typical published values for the named brand or dish where you know it.
- Items that are not food (supplements with no calories, water, plain black coffee) count as near zero.
- If an item is too vague to price, include it with your best typical estimate.
- All figures are for the whole text combined, in kilocalories and grams.`;

/* Structured outputs. Every object needs additionalProperties:false and a
   complete `required` list; numeric bounds are not part of the supported subset,
   which is why the sanity check below is a separate step rather than a schema. */
const SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, kcal: { type: 'number' } },
        required: ['name', 'kcal'],
        additionalProperties: false
      }
    }
  },
  required: ['kcal', 'protein', 'carbs', 'fat', 'items'],
  additionalProperties: false
};

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

  let res;
  try {
    res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 8192,
      /* Refusal is vanishingly unlikely for a list of food, but a declined
         request otherwise just stops. This re-runs it on Anthropic's
         recommended substitute inside the same call. */
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      /* Low effort: this is arithmetic over a short list, not a problem that
         rewards deliberation, and it keeps latency and cost down. */
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: clean }]
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    /* Typed, most specific first: the three a user can actually hit are worth
       distinguishing, and the rest is a configuration problem worth logging
       verbatim — a wrong model name or a rejected key both arrive here and are
       invisible otherwise. The message shown to the browser never carries it. */
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[zimpan] estimate rate limited');
      throw new Error('The estimate service is busy. Try again shortly.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[zimpan] estimate rejected the API key');
      throw new Error('The estimate service refused our credentials.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error(`[zimpan] estimate could not connect: ${err.message}`);
      throw new Error('Could not reach the estimate service.');
    }
    console.error(`[zimpan] estimate failed${err.status ? ` (${err.status})` : ''}: ${err.message}`);
    throw new Error('The estimate service refused the request.');
  }

  /* Checked before the content is read: a refusal is a successful response with
     nothing useful in it, so indexing into content first would throw. */
  if (res.stop_reason === 'refusal') {
    console.error(`[zimpan] estimate refused${res.stop_details ? `: ${res.stop_details.category}` : ''}`);
    throw new Error('The estimate service declined that request.');
  }
  if (res.stop_reason === 'max_tokens') {
    console.error('[zimpan] estimate hit the output cap');
    throw new Error('That was too much to estimate in one go.');
  }

  /* Not content[0]: thinking blocks come first, and carry no text by default. */
  const block = (res.content || []).find((b) => b.type === 'text');

  let parsed = null;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    console.error('[zimpan] estimate returned something unusable');
    throw new Error('The estimate came back in a form we could not read.');
  }

  const checked = validate(parsed);
  if (!checked) {
    console.error('[zimpan] estimate returned values outside sane bounds');
    throw new Error('The estimate came back in a form we could not read.');
  }
  return checked;
}
