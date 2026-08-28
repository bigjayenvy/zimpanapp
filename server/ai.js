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

/* Not every model accepts an effort level — the cheaper tiers reject it with a
   400 rather than ignoring it, which would turn "switch the model to save
   money" into "every estimate fails". Omitted for those, so the env var really
   is the only thing that has to change. ANTHROPIC_EFFORT=off forces it off for
   a model this doesn't know about yet. */
const REJECTS_EFFORT = /haiku|sonnet-4-5/i;
const effortLevel = () => {
  const set = (process.env.ANTHROPIC_EFFORT || '').trim().toLowerCase();
  if (set === 'off') return null;
  if (REJECTS_EFFORT.test(MODEL)) return null;
  return set || 'low';
};
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
      /* Low effort where the model takes it: this is arithmetic over a short
         list, not a problem that rewards deliberation, and it keeps both
         latency and the bill down. */
      output_config: Object.assign(
        { format: { type: 'json_schema', schema: SCHEMA } },
        effortLevel() ? { effort: effortLevel() } : {}
      ),
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

/* ── the report deck's written summaries ──

   The deck used to say only what the arithmetic said. These are the sentences
   between the figures: what the fortnight looked like, what the split says
   about how someone spends their days, and a closing note worth reading.

   One call returns every summary for a window at once. Seven separate requests
   for seven cards would be seven times the latency and the bill for the same
   context, and the cards would not agree with each other — the closing note
   would be written without knowing what the sleep card had just said.

   What arrives here is the same summarised figures the cards display, never the
   raw log. Activity names come through, notes do not: the model needs to know
   the window went to Family Time, not what was written about it.

   Every number a reader might act on is computed before this is called and
   passed in already worded. The model arranges and explains; it is never the
   thing that worked out how much weight a deficit implies. */

const DECK_SYSTEM = `You write the short prose sections of a personal time-and-wellbeing report. The reader is the person whose data it is, and they are reading about their own fortnight.

Voice:
- Second person, warm, plain. Speak to them, not about them.
- Specific over generic: name their actual categories, days and figures.
- Never scold. A thin week is a thin week, not a failure.
- No emoji. No headings. No bullet points. Plain sentences.

Honesty:
- Use only the figures given to you. Never invent a number, a date or an activity.
- Do not print figures. No calorie counts, no totals, no hours, no percentages, no
  weights. The card prints its own numbers directly above your paragraph, and yours
  is written once and then cached, so a quoted figure goes stale beside a live one
  and the two disagree on screen. Say "most of it", "a little over half", "a wide
  gap" — describe the shape, and let the rows carry the arithmetic.
- Naming a day, a category or a count of days is fine; those do not drift the way
  a total does.
- The figures are estimates from what they chose to log, and gaps are common. Say "logged" rather than implying the record is complete.
- You are not a doctor, a dietitian or a therapist. Do not diagnose, do not prescribe, do not tell anyone to eat less or exercise more as a medical instruction. Observations about their own logged data are fine.
- If a figure is missing or zero, say so plainly rather than guessing around it.

Length is a hard limit, not a target. Staying well under it is always fine.`;

const DECK_SCHEMA = {
  type: 'object',
  properties: {
    cover: { type: 'string', description: 'At most 100 words. What this window looked like overall — how much was tracked, how consistently, what dominated.' },
    donut: { type: 'string', description: 'At most 60 words. What the split across categories says. Name the largest one or two.' },
    profile: { type: 'string', description: 'At most 100 words. Given their top three categories, describe the kind of fortnight this was and what it suggests about how they spend their days. Generic is fine; flattering-but-empty is not.' },
    pace: { type: 'string', description: 'At most 60 words. Compare their busiest day with their lightest, and say something useful about the range between them.' },
    sleep: { type: 'string', description: 'At most 100 words. What the nights logged look like — the average, the consistency, any night that stands out.' },
    energy: { type: 'string', description: 'At most 80 words. Say in plain terms which way the calorie balance is leaning and what that means at this rate, without printing any figure — the card shows the numbers and the projected weight change on its own rows. Make clear it is a rough estimate from what was logged.' },
    closing: { type: 'string', description: 'At most 250 words. The closing card. Tell them specifically what they did well in this window, drawing on the real figures. Offer one or two concrete, gentle suggestions. End on genuine encouragement. Creative and warm, never saccharine, never a lecture.' }
  },
  required: ['cover', 'donut', 'profile', 'pace', 'sleep', 'energy', 'closing'],
  additionalProperties: false
};

// The caps the prompt asks for, enforced here so a long reply is trimmed rather
// than allowed to overflow the card it has to sit inside.
const DECK_CAPS = { cover: 100, donut: 60, profile: 100, pace: 60, sleep: 100, energy: 80, closing: 250 };

const clampWords = (text, max) => {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= max) return words.join(' ');
  // Cut at the last sentence that fits, so a trimmed summary still ends.
  const cut = words.slice(0, max).join(' ');
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > cut.length * 0.5 ? cut.slice(0, stop + 1) : `${cut}…`;
};

export async function summariseDeck(facts) {
  if (!aiConfigured()) throw new Error('AI summaries are not configured on this server.');

  let res;
  try {
    res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 8192,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: DECK_SYSTEM,
      output_config: Object.assign(
        { format: { type: 'json_schema', schema: DECK_SCHEMA } },
        effortLevel() ? { effort: effortLevel() } : {}
      ),
      messages: [{ role: 'user', content: JSON.stringify(facts) }]
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[zimpan] deck summary rate limited');
      throw new Error('The summary service is busy. Try again shortly.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[zimpan] deck summary rejected the API key');
      throw new Error('The summary service refused our credentials.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error(`[zimpan] deck summary could not connect: ${err.message}`);
      throw new Error('Could not reach the summary service.');
    }
    console.error(`[zimpan] deck summary failed${err.status ? ` (${err.status})` : ''}: ${err.message}`);
    throw new Error('The summary service refused the request.');
  }

  if (res.stop_reason === 'refusal') {
    console.error(`[zimpan] deck summary refused${res.stop_details ? `: ${res.stop_details.category}` : ''}`);
    throw new Error('The summary service declined that request.');
  }
  if (res.stop_reason === 'max_tokens') {
    console.error('[zimpan] deck summary hit the output cap');
    throw new Error('That was too much to summarise in one go.');
  }

  const block = (res.content || []).find((b) => b.type === 'text');
  let parsed = null;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    console.error('[zimpan] deck summary returned something unusable');
    throw new Error('The summary came back in a form we could not read.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The summary came back in a form we could not read.');
  }

  const out = {};
  for (const [key, cap] of Object.entries(DECK_CAPS)) {
    if (typeof parsed[key] !== 'string') continue;
    const text = clampWords(parsed[key], cap);
    if (text) out[key] = text;
  }
  // A reply with nothing usable in it is a failure, not an empty success — the
  // client would otherwise cache the emptiness and never ask again.
  if (!Object.keys(out).length) throw new Error('The summary came back empty.');
  return out;
}

/* ── chat ──

   "Chat with Zimpan": questions answered from the log the client sends with
   each turn. Unlike the two above, this one is prose rather than a schema —
   there is no shape to constrain, only a subject to stay on.

   Read-only by construction. Nothing here writes, and the system prompt says
   so, because a model told it can log things will offer to and then appear to
   have done it. The client does not act on replies either way: the only path
   into the log is still the log's own screens.

   The whole conversation is sent every turn and nothing is kept here. The
   server holds no transcript — the browser owns it, which keeps this endpoint
   stateless and means a chat that is closed is a chat that is gone. */
const CHAT_SYSTEM = `You are the assistant inside ZIMPAN, an app for tracking time, money, food, sleep and exercise.

You are answering questions about one person's own logged data, which is supplied to you as JSON with each question. Everything you say must come from that data.

- Answer from the log. If the log does not say, say that it does not say — never fill a gap with a plausible number.
- Be brief and specific. Two or three sentences is usually right. Quote real figures and dates from the data rather than describing them vaguely.
- The figures are estimates read from what the person typed, not measurements. Treat calorie and nutrition numbers as approximate and say so when it matters.
- You cannot change anything. You have no way to add, edit or delete an entry. If asked to log something, say that you cannot, and that they can log it on the Activity or Money screen.
- Be plain and warm, never chirpy. No emoji. Do not open with a greeting or a restatement of the question.
- On health, money or medication specifics, give general information and say that anything personal belongs with a doctor or a qualified adviser.
- If a question has nothing to do with what they track, say briefly that it is outside what you can see here.`;

const CHAT_MAX_TURNS = 20;
const CHAT_MAX_CHARS = 2000;

/* The reply, as text. `history` is the conversation so far and `facts` is the
   log it is answered from; the facts ride on the newest user turn rather than
   in the system prompt so that a long chat does not re-send a stale snapshot
   alongside a fresh question. */
export async function chatReply(history, facts) {
  if (!aiConfigured()) throw new Error('Chat is not configured on this server.');

  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .slice(-CHAT_MAX_TURNS)
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, CHAT_MAX_CHARS) }))
    .filter((m) => m.content.trim());

  if (!turns.length) throw new Error('Nothing to answer.');
  // The API requires the exchange to end with the user; a trailing assistant
  // turn means the client sent its own optimistic echo back to us.
  while (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop();
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new Error('Nothing to answer.');

  const last = turns[turns.length - 1];
  turns[turns.length - 1] = {
    role: 'user',
    content: `${last.content}\n\n<log>\n${JSON.stringify(facts || {})}\n</log>`
  };

  let res;
  try {
    res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: CHAT_SYSTEM,
      messages: turns
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[zimpan] chat rate limited');
      throw new Error('The assistant is busy. Try again shortly.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[zimpan] chat rejected the API key');
      throw new Error('The assistant refused our credentials.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error(`[zimpan] chat could not connect: ${err.message}`);
      throw new Error('Could not reach the assistant.');
    }
    console.error(`[zimpan] chat failed${err.status ? ` (${err.status})` : ''}: ${err.message}`);
    throw new Error('The assistant refused the request.');
  }

  if (res.stop_reason === 'refusal') {
    console.error(`[zimpan] chat refused${res.stop_details ? `: ${res.stop_details.category}` : ''}`);
    throw new Error('The assistant declined that one.');
  }

  const text = (res.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // An empty reply is a failure rather than a silent success: the client would
  // otherwise show a blank bubble and look broken.
  if (!text) throw new Error('The assistant came back empty.');
  return { text, truncated: res.stop_reason === 'max_tokens' };
}

/* ── what an effort actually cost ──

   The MET table in app.js prices an activity by matching a word and multiplying
   by weight and time. It cannot know that "5k in 24 minutes" is harder than a
   jog, or what "heavy legs, 4 sets" costs. This is the same fallback the
   nutrition estimate is, for the other side of the ledger — and it exists
   because a Refine button that only ever refined food made the workout half of
   the balance look finished when it was not.

   Given the weight and the minutes, so the model is doing the part it is better
   at — reading the description — and not guessing the arithmetic around it. */
const BURN_SYSTEM = `You estimate the energy cost of a described physical activity.

- You are given a description, the person's weight in kilograms, and how many minutes it ran.
- Reply with the total kilocalories burned over those minutes, and the MET value you used.
- Use published MET values for the activity described, adjusted for any intensity the text gives ("easy", "intervals", "5k in 24 minutes", "heavy", "4 sets").
- Sitting still is about 1 MET. Walking is about 3.5. Running is about 9-12. Very few activities exceed 16.
- If the text does not describe physical activity at all, use 1.5 and say so in the activity field.`;

const BURN_SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    met: { type: 'number' },
    activity: { type: 'string' }
  },
  required: ['kcal', 'met', 'activity'],
  additionalProperties: false
};

export async function estimateBurn(text, weightKg, minutes) {
  if (!aiConfigured()) throw new Error('AI estimates are not configured on this server.');
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error('Nothing to estimate.');
  const kg = Number(weightKg) || 70;
  const mins = Math.max(1, Math.min(1440, Number(minutes) || 1));

  let res;
  try {
    res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: BURN_SYSTEM,
      output_config: Object.assign(
        { format: { type: 'json_schema', schema: BURN_SCHEMA } },
        effortLevel() ? { effort: effortLevel() } : {}
      ),
      messages: [{ role: 'user', content: `${clean}\n\nweight: ${kg} kg\nminutes: ${mins}` }]
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[zimpan] burn estimate rate limited');
      throw new Error('The estimate service is busy. Try again shortly.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[zimpan] burn estimate rejected the API key');
      throw new Error('The estimate service refused our credentials.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error(`[zimpan] burn estimate could not connect: ${err.message}`);
      throw new Error('Could not reach the estimate service.');
    }
    console.error(`[zimpan] burn estimate failed${err.status ? ` (${err.status})` : ''}: ${err.message}`);
    throw new Error('The estimate service refused the request.');
  }

  if (res.stop_reason === 'refusal') throw new Error('The estimate service declined that request.');

  const block = (res.content || []).find((b) => b.type === 'text');
  let parsed = null;
  try { parsed = JSON.parse(block.text); } catch { parsed = null; }
  if (!parsed) throw new Error('The estimate came back in a form we could not read.');

  /* Checked, not trusted. A schema guarantees a number is a number, not that it
     is possible: 20 METs for an hour is roughly a world record, and a figure
     someone may act on is worse wrong than absent. The ceiling is the highest
     honest reading for the time given rather than a flat cap. */
  const met = num(parsed.met);
  const kcal = num(parsed.kcal);
  if (met === null || met < 0.8 || met > 20) return null;
  if (kcal === null || kcal < 0) return null;
  const ceiling = 20 * kg * (mins / 60) * 1.15;
  if (kcal > ceiling) return null;

  return { kcal: Math.round(kcal), met: Math.round(met * 10) / 10, activity: String(parsed.activity || '').slice(0, 120) };
}
