/* The demo account.

   A real account, reachable with an ordinary email and password, holding a
   fictional person's six weeks of logging. It exists so that the app can be
   shown to somebody — a reviewer, a writer, a person deciding whether to
   sign up — without either handing over a real user's life or asking them to
   judge an empty screen. An empty Zimpan says nothing about Zimpan.

   Nobody real is in here. Maya Villanueva is invented, her clients are
   invented, and every figure is generated, so there is no consent question
   and nothing to redact.

   Three rules the rest of this file follows:

   Reproducible. The days come out of a seeded generator, so rebuilding
   produces the same log rather than a different one — a screenshot taken last
   week still matches what the demo shows today, and a bug found in it can be
   found again.

   Rolling. The days are counted back from today, not written as fixed dates,
   so the demo is never showing a log that stopped last March. Rebuild it and
   it is current again.

   Borrowed, not reimplemented. The rows go in through applyChanges — the same
   function every device's push goes through — so they get the same validation,
   the same stamping and the same server_at as anything a real client writes.
   A demo written straight into the tables would be the one set of rows in the
   database that never met the rules, and it would drift from them silently. */

import { query, one, now } from './db.js';
import { hashPassword } from './auth.js';
import { applyChanges } from './sync.js';

export const DEMO_EMAIL = 'demo@zimpan.com';

/* ── the persona ── */

export const PERSONA = {
  name: 'Maya Villanueva',
  blurb: 'Freelance graphic designer, 29, Quezon City. Bills two retainer '
    + 'clients, works from home three days a week, runs on Mondays, '
    + 'Wednesdays and Fridays, and sends most of a fortnight to her family.',
  currency: 'PHP',
  weightKg: 58,
  // 11pm. Gap review walks from 6am to here looking for unlogged stretches.
  sleepMin: 23 * 60,
  days: 42
};

/* Names chosen to land on the app's own icon vocabulary — "Client work" reads
   as a tool, "Meals" as a plate, "Income" as money — so the demo looks like a
   log somebody kept rather than a fixture somebody typed. See ICONS in app.js. */
const CATEGORIES = [
  ['Client work', '#4a2458'], ['Deep work', '#9b7bab'], ['Meetings', '#2e1b3d'],
  ['Email & admin', '#e79aa4'], ['Commute', '#6b4478'], ['Meals', '#c9a04f'],
  ['Exercise', '#3d2150'], ['Chores', '#f0b6bd'], ['Family time', '#4a2458'],
  ['Reading', '#9b7bab']
];

const PURPOSES = [
  ['Income', '#1f6b63'], ['Rent', '#4fbfae'], ['Groceries', '#0f3f3a'],
  ['Transport', '#a8dcd2'], ['Utilities', '#2a8b7d'], ['Coffee', '#7fc9bd'],
  ['Health', '#154f49'], ['Savings', '#35a596'], ['Family', '#1f6b63'],
  ['Shopping', '#4fbfae']
];

const CLIENTS = ['Northlight', 'Bagoong Studio', 'Casa Verde', 'Tala Coffee', 'Halcyon Press'];

const DESIGN_TASKS = [
  'brand board', 'packaging labels', 'menu layout', 'social templates',
  'pitch deck', 'landing page mockup', 'logo revisions', 'annual report spreads',
  'signage set', 'newsletter layout'
];

/* Meals are written the way somebody actually writes them, item by item,
   because the calorie estimate is read off this text. A note of "lunch" is
   worth a generic meal; a note of "grilled bangus, rice, kangkong" is worth
   what she ate. See nutritionFor() in app.js. */
const BREAKFASTS = [
  'two eggs, pandesal, black coffee',
  'oatmeal with banana and peanut butter',
  'longganisa, garlic rice, fried egg',
  'tapsilog and coffee',
  'yogurt, granola, mango',
  'cheese omelette, toast, orange juice'
];
const LUNCHES = [
  'grilled bangus, rice, kangkong',
  'chicken adobo, rice, cucumber salad',
  'pork sinigang with rice',
  'tuna sandwich, apple, iced tea',
  'beef tapa, rice, fried egg',
  'chicken curry, brown rice, broccoli',
  'pancit canton and lumpia'
];
const DINNERS = [
  'tinolang manok, rice',
  'pork barbecue, rice, atchara',
  'vegetable stir fry, tofu, brown rice',
  'grilled tilapia, salad, rice',
  'spaghetti and garlic bread',
  'sinigang na hipon, rice',
  'chicken salad and soup'
];
const SNACKS = [
  'banana cue and iced coffee',
  'pandesal with cheese',
  'turon and calamansi juice',
  'apple and almonds',
  'siomai and gulaman'
];

const RUNS = [
  '5 km around the village, steady',
  '4 km easy, humid',
  '6 km with two hill repeats',
  '30 min treadmill, intervals',
  '45 min strength — legs and core',
  '40 min yoga, hip mobility'
];

const CHORES = [
  ['Laundry and folding', 60], ['Palengke run', 75], ['Kitchen deep clean', 50],
  ['Watering the plants', 20], ['Sorting the studio shelf', 45]
];

/* The activity planner's two lists. The last column is how many days from
   today the item is planned for; leaving it out makes the row a note, which is
   the split the planner reads. Spread either side of today on purpose, so the
   demo opens on a planner with something late, something now and something
   coming — which is the whole shape of the thing. */
const TODOS = [
  ['Send Northlight the revised brand board', 'doing', 'Client work', '', 0],
  ['Chase the Casa Verde invoice — 14 days late', 'stuck', 'Email & admin',
    'Their finance person is on leave until the 12th', -2],
  ['Back up the 2026 project files', 'pending', 'Email & admin', '', 3],
  ['Book the dentist before the year ends', 'pending', 'Family time', '', 9],
  ['Draft the rate card for next year', 'review', 'Client work'],
  ['Renew the font licence', 'pending', 'Email & admin'],
  ['Reply to the Halcyon Press brief', 'done', 'Client work'],
  ['Move ₱5,000 to savings after the 15th', 'done', 'Email & admin']
];

/* The money planner's three. After the status comes the list it belongs to,
   then the day of the month a subscription lands on, then how many days from
   today a due is expected, and last how it repeats. A note has none of them. */
const PLANS = [
  ['Rent — next month', 12000, 'Rent', 'out', 'planned', 'due', 0, 12, 'month'],
  ['Meralco and internet', 3499, 'Utilities', 'out', 'due', 'due', 0, 1],
  ['Northlight retainer', 22000, 'Income', 'in', 'planned', 'due', 0, 5],
  ['Adobe Creative Cloud', 3299, 'Utilities', 'out', 'planned', 'sub', 3],
  ['Google One', 449, 'Utilities', 'out', 'planned', 'sub', 15],
  ['Canva Pro', 690, 'Utilities', 'out', 'dropped', 'sub', 22],
  ['Dental cleaning', 1800, 'Health', 'out', 'planned', 'due', 0, 21],
  ['New drawing tablet', 18500, 'Shopping', 'out', 'planned', 'note'],
  ['A proper chair, eventually', 9500, 'Shopping', 'out', 'planned', 'note'],
  ['Tala Coffee — final invoice', 8500, 'Income', 'in', 'paid', 'due'],
  ['Mama’s birthday lunch', 3000, 'Family', 'out', 'paid', 'due']
];

/* ── the generator ──

   mulberry32: a small, fast, well-distributed 32-bit PRNG. Seeded, so the
   whole log is a function of one number and rebuilding is not a reroll. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/* Rows are stamped at the end of the evening they describe, so the log reads
   as one kept day by day rather than as a fortnight typed in one sitting —
   which is also what the dashboard's activity chart is counting. */
const stampFor = (dayMs, hour) => dayMs + hour * 60 * 60 * 1000;

export function demoPayload({ today, days = PERSONA.days, seed = 20260210 } = {}) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const between = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const chance = (p) => r() < p;
  const peso = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;

  const end = new Date(`${today}T00:00:00Z`).getTime();
  const start = end - (days - 1) * DAY_MS;

  const entries = [];
  const money = [];
  const steps = {};
  let n = 0;
  // Client-minted ids everywhere else in this app; minted here for the same
  // reason — the row has to be identifiable before anything has stored it.
  const id = (kind, date) => `demo-${kind}-${date.replace(/-/g, '')}-${(n += 1)}`;

  const logTime = (date, at, activity, category, from, to, note) => {
    entries.push({ id: id('e', date), date, activity, category, from, to, note: note || '', updatedAt: at });
  };
  const logMoney = (date, at, activity, purpose, amountIn, amountOut, note) => {
    money.push({
      id: id('m', date), date, activity, purpose,
      in: amountIn, out: amountOut, note: note || '', updatedAt: at
    });
  };

  for (let i = 0; i < days; i++) {
    const dayMs = start + i * DAY_MS;
    const d = new Date(dayMs);
    const date = isoOf(d);
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    const weekday = dow >= 1 && dow <= 5;
    const evening = stampFor(dayMs, 21);

    /* A demo where every day is complete is a demo of a person who does not
       exist. Roughly one weekday in twelve is left thin on purpose — the app
       is built to say "you logged 4 hours here", and it can only say it if
       some days are like that. */
    const thin = weekday && chance(0.08);

    if (weekday && !thin) {
      logTime(date, stampFor(dayMs, 8), 'Breakfast', 'Meals', 7 * 60, 7 * 60 + 30, pick(BREAKFASTS));

      // Three days a week at a co-working space in Katipunan; the rest at home.
      const goesOut = dow === 2 || dow === 4 || (dow === 1 && chance(0.5));
      if (goesOut) {
        logTime(date, stampFor(dayMs, 9), 'Jeep to the co-working space', 'Commute', 8 * 60, 8 * 60 + 40);
        logMoney(date, stampFor(dayMs, 9), 'Jeep and tricycle fare', 'Transport', 0, peso(60, 140));
      }

      const client = pick(CLIENTS);
      logTime(date, stampFor(dayMs, 12), `${client} — ${pick(DESIGN_TASKS)}`, 'Client work',
        9 * 60, between(10, 11) * 60 + (chance(0.5) ? 30 : 0));
      logTime(date, stampFor(dayMs, 12), 'Inbox and invoices', 'Email & admin', 11 * 60 + 30, 12 * 60);
      logTime(date, stampFor(dayMs, 13), 'Lunch', 'Meals', 12 * 60, 12 * 60 + 45, pick(LUNCHES));

      if (chance(0.45)) {
        logTime(date, stampFor(dayMs, 16), `Client call — ${pick(CLIENTS)}`, 'Meetings',
          13 * 60, 13 * 60 + between(30, 60));
      }
      logTime(date, stampFor(dayMs, 18), pick(DESIGN_TASKS), 'Deep work',
        14 * 60, between(16, 17) * 60 + (chance(0.5) ? 30 : 0));

      if (chance(0.5)) {
        logTime(date, stampFor(dayMs, 18), 'Merienda', 'Meals', 15 * 60 + 30, 15 * 60 + 50, pick(SNACKS));
      }
      if (goesOut && chance(0.7)) {
        logTime(date, stampFor(dayMs, 19), 'Jeep home', 'Commute', 18 * 60, 18 * 60 + 40);
      }
      // Mondays, Wednesdays and Fridays, which is what she tells people.
      if (dow === 1 || dow === 3 || dow === 5) {
        logTime(date, stampFor(dayMs, 19), chance(0.7) ? 'Evening run' : 'Gym session', 'Exercise',
          18 * 60 + 15, 19 * 60, pick(RUNS));
      }
      logTime(date, evening, 'Dinner', 'Meals', 19 * 60 + 30, 20 * 60 + 15, pick(DINNERS));
      if (chance(0.4)) {
        logTime(date, evening, 'Reading before bed', 'Reading', 21 * 60 + 30, 22 * 60 + 15);
      } else if (chance(0.5)) {
        logTime(date, evening, 'Video call with Mama', 'Family time', 20 * 60 + 30, 21 * 60 + 15);
      }
    } else if (weekday && thin) {
      logTime(date, stampFor(dayMs, 13), 'Lunch', 'Meals', 12 * 60, 12 * 60 + 45, pick(LUNCHES));
      logTime(date, stampFor(dayMs, 18), `${pick(CLIENTS)} — ${pick(DESIGN_TASKS)}`, 'Client work',
        14 * 60, 17 * 60);
    } else if (dow === 6) {
      logTime(date, stampFor(dayMs, 9), 'Morning walk', 'Exercise', 6 * 60 + 30, 7 * 60 + 15,
        '45 min easy walk around the oval');
      logTime(date, stampFor(dayMs, 10), 'Breakfast', 'Meals', 8 * 60, 8 * 60 + 40, pick(BREAKFASTS));
      const chore = pick(CHORES);
      logTime(date, stampFor(dayMs, 12), chore[0], 'Chores', 9 * 60, 9 * 60 + chore[1]);
      logTime(date, stampFor(dayMs, 14), 'Lunch', 'Meals', 12 * 60 + 30, 13 * 60 + 15, pick(LUNCHES));
      if (chance(0.6)) {
        logTime(date, stampFor(dayMs, 18), 'Coffee with friends', 'Family time',
          15 * 60, 17 * 60, chance(0.5) ? 'iced latte and a slice of cake' : '');
      }
      logTime(date, evening, 'Dinner', 'Meals', 19 * 60, 20 * 60, pick(DINNERS));
    } else {
      logTime(date, stampFor(dayMs, 10), 'Breakfast', 'Meals', 8 * 60, 8 * 60 + 40, pick(BREAKFASTS));
      logTime(date, stampFor(dayMs, 14), 'Mass and lunch with the family', 'Family time',
        9 * 60 + 30, 13 * 60);
      logTime(date, stampFor(dayMs, 15), 'Lunch', 'Meals', 12 * 60, 12 * 60 + 45, pick(LUNCHES));
      if (chance(0.7)) logTime(date, stampFor(dayMs, 17), 'Afternoon nap', 'Reading', 14 * 60, 15 * 60 + 30);
      logTime(date, stampFor(dayMs, 19), 'Planning the week', 'Email & admin', 17 * 60, 17 * 60 + 45);
      logTime(date, evening, 'Dinner', 'Meals', 19 * 60, 20 * 60, pick(DINNERS));
    }

    /* ── what it cost ── */

    const dom = d.getUTCDate();
    if (dom === 1) logMoney(date, stampFor(dayMs, 10), 'Rent — Quezon City studio', 'Rent', 0, 12000);
    if (dom === 5) logMoney(date, stampFor(dayMs, 11), 'Meralco', 'Utilities', 0, peso(1450, 2400));
    if (dom === 5) logMoney(date, stampFor(dayMs, 11), 'Home internet', 'Utilities', 0, 1699);
    if (dom === 20) logMoney(date, stampFor(dayMs, 11), 'Phone load and subscriptions', 'Utilities', 0, 1299);
    /* Two retainers and a milestone, which is what freelance income looks like
       — three arrivals a month rather than one, none of them on payday. The
       demo is worth more than it spends, but not by a fantasy margin: the
       point of the money tracker is a balance somebody could recognise. */
    if (dom === 8) logMoney(date, stampFor(dayMs, 14), 'Casa Verde — project milestone', 'Income', peso(11000, 13000), 0);
    if (dom === 15) logMoney(date, stampFor(dayMs, 14), 'Northlight retainer', 'Income', peso(24000, 28000), 0);
    if (dom === 28) logMoney(date, stampFor(dayMs, 14), 'Bagoong Studio retainer', 'Income', peso(16000, 20000), 0);
    if (dom === 16) logMoney(date, stampFor(dayMs, 15), 'To savings', 'Savings', 0, 5000);
    if (chance(0.05)) {
      logMoney(date, stampFor(dayMs, 16), `${pick(CLIENTS)} — one-off project`, 'Income', peso(6000, 14000), 0);
    }

    if (dow === 6) logMoney(date, stampFor(dayMs, 12), 'Palengke and supermarket', 'Groceries', 0, peso(1400, 2600));
    if (dow === 3) logMoney(date, stampFor(dayMs, 18), 'Top-up shop — milk, eggs, bread', 'Groceries', 0, peso(350, 780));
    if (weekday && chance(0.5)) logMoney(date, stampFor(dayMs, 11), 'Coffee', 'Coffee', 0, peso(140, 290));
    if (weekday && chance(0.35)) logMoney(date, stampFor(dayMs, 13), 'Lunch out', 'Groceries', 0, peso(180, 420));
    if (weekday && chance(0.2)) logMoney(date, stampFor(dayMs, 19), 'Grab home — late finish', 'Transport', 0, peso(180, 340));
    if (chance(0.12)) logMoney(date, stampFor(dayMs, 16), 'Merienda', 'Coffee', 0, peso(60, 180));
    if (chance(0.07)) logMoney(date, stampFor(dayMs, 17), 'Pharmacy', 'Health', 0, peso(320, 1200));
    if (chance(0.05)) logMoney(date, stampFor(dayMs, 18), 'Groceries for Mama', 'Family', 0, peso(900, 2800));
    if (chance(0.05)) logMoney(date, stampFor(dayMs, 19), 'Art supplies', 'Shopping', 0, peso(450, 2500));

    /* Steps, keyed by date with a per-date stamp — the shape steps_json wants.
       Higher on the days she goes out and on the days she runs. */
    const active = (dow === 1 || dow === 3 || dow === 5 || dow === 6);
    steps[date] = { v: active ? between(7200, 12500) : between(2800, 6400), t: evening };
  }

  const at = new Date(`${today}T00:00:00Z`).getTime();
  /* Dates relative to the demo's own "today", so an account rebuilt in March
     reads exactly as one rebuilt in September rather than pointing at a week
     that has been and gone. */
  const dayOff = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // The next time a given day of the month falls on or after the demo's today.
  const monthly = (day) => {
    const d = new Date(`${today}T00:00:00Z`);
    const len = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (Math.min(day, len(y, m)) < d.getUTCDate()) { m += 1; if (m > 11) { m = 0; y += 1; } }
    return new Date(Date.UTC(y, m, Math.min(day, len(y, m)))).toISOString().slice(0, 10);
  };

  const todos = TODOS.map((t, i) => ({
    id: `demo-t-${i + 1}`,
    text: t[0],
    status: t[1],
    category: t[2],
    blocked: t[3] || '',
    date: t[4] == null ? undefined : dayOff(t[4]),
    createdAt: at - (TODOS.length - i) * 2 * DAY_MS,
    updatedAt: at - (TODOS.length - i) * DAY_MS
  }));

  const plans = PLANS.map((p, i) => {
    const kind = p[5] || 'due';
    const day = kind === 'sub' ? p[6] : null;
    return {
      id: `demo-p-${i + 1}`,
      text: p[0],
      amount: p[1],
      purpose: p[2],
      dir: p[3],
      status: p[4],
      kind,
      day: day || undefined,
      due: day ? monthly(day) : (p[7] == null ? undefined : dayOff(p[7])),
      every: p[8] || undefined,
      createdAt: at - (PLANS.length - i) * 2 * DAY_MS,
      updatedAt: at - (PLANS.length - i) * DAY_MS
    };
  });

  return {
    name: { value: PERSONA.name, updatedAt: at },
    currency: { value: PERSONA.currency, updatedAt: at },
    weightKg: { value: PERSONA.weightKg, updatedAt: at },
    sleepMin: { value: PERSONA.sleepMin, updatedAt: at },
    tracks: { value: { time: true, money: true, steps: true, meals: true }, updatedAt: at },
    steps,
    categories: CATEGORIES.map(([name, color], i) => ({ name, color, position: i, updatedAt: at })),
    purposes: PURPOSES.map(([name, color], i) => ({ name, color, position: i, updatedAt: at })),
    entries,
    money,
    todos,
    plans
  };
}

/* ── the account ── */

const TABLES = ['entries', 'money_entries', 'todos', 'plans', 'categories', 'purposes'];

export async function demoStatus() {
  const user = await one(
    'SELECT id, email, display_name, created_at, updated_at, last_seen_at FROM users WHERE email = ?',
    [DEMO_EMAIL]);
  if (!user) return { exists: false, email: DEMO_EMAIL, persona: PERSONA };

  const counts = await one(`
    SELECT
      (SELECT COUNT(*) FROM entries WHERE user_id = ? AND deleted = 0)       AS entries,
      (SELECT COUNT(*) FROM money_entries WHERE user_id = ? AND deleted = 0) AS money,
      (SELECT COUNT(*) FROM todos WHERE user_id = ? AND deleted = 0)         AS todos,
      (SELECT COUNT(*) FROM plans WHERE user_id = ? AND deleted = 0)         AS plans`,
    [user.id, user.id, user.id, user.id]);
  const span = await one(
    'SELECT MIN(date) AS first, MAX(date) AS last FROM entries WHERE user_id = ? AND deleted = 0',
    [user.id]);

  return {
    exists: true,
    email: user.email,
    name: user.display_name,
    persona: PERSONA,
    builtAt: Number(user.updated_at) || 0,
    createdAt: Number(user.created_at) || 0,
    lastSeenAt: Number(user.last_seen_at) || 0,
    counts: {
      entries: Number(counts.entries) || 0,
      money: Number(counts.money) || 0,
      todos: Number(counts.todos) || 0,
      plans: Number(counts.plans) || 0
    },
    first: span ? span.first : null,
    last: span ? span.last : null
  };
}

/* Build, or rebuild. Existing rows go first rather than being merged over:
   the log is generated from today backwards, so yesterday's build sits a day
   behind this one and the two together would read as a person who logged the
   same lunch twice.

   Hard deletes, not tombstones. Everything under this account was written by
   this function, there is no other device holding a copy, and a demo whose
   history is half tombstones is a demo of the tombstones. */
export async function buildDemo({ password, today, days, seed } = {}) {
  const t = now();
  const existing = await one('SELECT id, role FROM users WHERE email = ?', [DEMO_EMAIL]);

  let userId;
  if (existing) {
    /* Never touches `role`. If somebody has deliberately given this account a
       dashboard role, rebuilding its log is not the place that decision gets
       reversed — and quietly re-granting one would be worse. */
    userId = existing.id;
    const sets = ['display_name = ?', 'currency = ?', 'kind = ?', 'updated_at = ?', 'last_seen_at = ?'];
    const args = [PERSONA.name, PERSONA.currency, 'personal', t, t];
    if (password) { sets.splice(1, 0, 'password_hash = ?'); args.splice(1, 0, hashPassword(password)); }
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...args, userId]);
    for (const table of TABLES) await query(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  } else {
    if (!password) throw new Error('A password is needed to create the demo account.');
    const made = await query(
      `INSERT INTO users (email, password_hash, display_name, currency, kind, role, created_at, updated_at, last_seen_at)
       VALUES (?,?,?,?,'personal','user',?,?,?)`,
      [DEMO_EMAIL, hashPassword(password), PERSONA.name, PERSONA.currency, t, t, t]);
    userId = made.insertId;
  }

  const payload = demoPayload({
    today: today || new Date(t).toISOString().slice(0, 10),
    days: days || PERSONA.days,
    seed
  });
  await applyChanges(userId, payload);

  const status = await demoStatus();
  return Object.assign({ created: !existing }, status);
}

/* Removing the account takes its log with it — every table above is ON DELETE
   CASCADE from users. Named for what it does to the person's view of it. */
export async function removeDemo() {
  const user = await one('SELECT id FROM users WHERE email = ?', [DEMO_EMAIL]);
  if (!user) return { removed: false, email: DEMO_EMAIL };
  await query('DELETE FROM users WHERE id = ?', [user.id]);
  return { removed: true, email: DEMO_EMAIL };
}
