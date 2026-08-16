/* ZIMPAN — time and money tracker.
   Ported from the Zimpan.dc.html design component: same state shape, same
   numbers, same copy — plain DOM instead of the design-canvas runtime.

   Rendering is a full re-render of #app driven off `state`. Text fields sync
   into state silently on `input` (no re-render, so typing never loses the
   caret); everything else commits on `change`/`click` and re-renders. The
   focus capture/restore around the swap is the safety net for the latter. */

/* ─────────────────────────── config ─────────────────────────── */

// Mirrors the component's authored props.
const CONFIG = { defaultRange: 'day', roundToMinutes: 1 };

/* Lifted from the brand banner. Time takes its plum/rose/gold side, money the
   teal side below, so the two trackers still read apart at a glance while both
   are drawn out of the same artwork. */
const PALETTE = ['#4a2458', '#9b7bab', '#2e1b3d', '#e79aa4', '#6b4478', '#c9a04f', '#3d2150', '#f0b6bd'];
// Money runs on green. Same light/dark rhythm as PALETTE so slices stay apart.
const MONEY_PALETTE = ['#1f6b63', '#4fbfae', '#0f3f3a', '#a8dcd2', '#2a8b7d', '#7fc9bd', '#154f49', '#35a596'];
const PURPOSES = ['Shopping', 'Projects', 'Movies', 'Petrol', 'Groceries', 'Eat Out', 'House Improvements', 'Birthdays', 'Commute', 'Gadgets', 'Utilities', 'Appliances'];
const STORE_KEY = 'zimpan.v1';

/* ─────────────────────────── brand ───────────────────────────

   The Z drawn as a circuit trace with nodes at its corners and along the
   diagonal. Vector rather than the source PNG so it stays sharp at favicon
   size and inherits colour — currentColor lets it invert wherever it sits. */

/* The mark on a gradient disc, for the places that carry the brand rather than
   just wearing the current text colour — the landing header, the sign-in
   lockup. The gradient id repeats wherever this is used more than once on a
   page; every copy defines it identically, so a duplicate resolves the same. */
const LOGO_BADGE = (size) => `
<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false" style="display:block;flex:none;">
  <defs>
    <linearGradient id="zg-mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"></stop>
      <stop offset="50%" stop-color="#7856f5"></stop>
      <stop offset="100%" stop-color="#4f46e5"></stop>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="96" height="96" rx="28" fill="url(#zg-mark)"></rect>
  <path d="M28 27 H72 L28 73 H72" fill="none" stroke="#fff" stroke-width="10"
        stroke-linecap="round" stroke-linejoin="round"></path>
  <circle cx="28" cy="27" r="7.5" fill="#fff"></circle>
  <circle cx="72" cy="73" r="7.5" fill="#fff"></circle>
</svg>`;

const DONATE_URL = 'https://www.paypal.com/ncp/payment/CJ6PTT55VQWX6';

/* The badge, not the bare trace: one mark for the whole product, the same one
   the home page opens with. It keeps its own gradient rather than following the
   tracker's accent — a logo that changes colour with the page it is on is not
   really a logo. */
function wordmark(markSize, titleSize) {
  return `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span>${LOGO_BADGE(markSize)}</span>
      <span style="display: flex; flex-direction: column; gap: 1px;">
        <span style="font-family: var(--font-heading); font-weight: 600; font-size: ${titleSize}px; letter-spacing: .02em; line-height: 1;">ZIMPAN<span style="color: var(--color-accent-700);">.</span></span>
        <span style="font-size: ${Math.max(9, Math.round(titleSize * 0.46))}px; letter-spacing: .14em; text-transform: uppercase; color: var(--color-neutral-600);">Track What Matters</span>
      </span>
    </div>`;
}

/* ─────────────────────────── formatting ─────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const parseHm = (s) => { const [h, m] = (s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const clock12 = (m) => { const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${pad(mm)} ${ap}`; };
const dayLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/* ── entries that run past midnight ──
   An entry is a date plus two clock times inside it, which cannot express a
   sleep that starts at 9PM and ends at 6AM. A `to` earlier than its `from` is
   read as "the next morning" instead of as a negative span, and such an entry
   is dated the day it *ended* — you log Tuesday night's sleep against
   Wednesday, which is the day you want to see it on.

   Every duration in the app goes through span(), so the wrap is handled once
   rather than at each of the dozen places that used to subtract directly. */
const span = (e) => {
  const f = Number(e.from) || 0, t = Number(e.to) || 0;
  return t >= f ? t - f : t + 1440 - f;
};
const wraps = (e) => (Number(e.to) || 0) < (Number(e.from) || 0);

/* The clock day after an ISO date, for entries whose end lands there. */
const nextDay = (isoDate) => {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return iso(d);
};

function dur(mins) {
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return h === 1 ? '1 Hour' : `${h} Hours`;
  return `${m} Minutes`;
}
function durShort(mins) {
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
/* Currency is a display choice, not a conversion — picking a different one
   relabels the amounts you logged, it does not convert them. */
const CURRENCIES = [
  { code: 'PHP', symbol: '₱', label: 'Philippine Peso' },
  { code: 'AED', symbol: 'AED ', label: 'UAE Dirham' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' }
];
const currency = () => CURRENCIES.find((c) => c.code === state.currency) || CURRENCIES[0];

// Two decimals only when the amount actually has them, so a whole figure reads
// as ₱13,070 rather than ₱13,070.00. Rounding first keeps float sums from
// showing a spurious ".01".
const money2 = (n) => Math.round(Math.abs(Number(n) || 0) * 100) / 100;
const amount = (n) => {
  const v = money2(n);
  const cents = Math.round(v * 100) % 100 !== 0;
  return `${currency().symbol}${v.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2
  })}`;
};
const signed = (n) => (n < 0 ? `−${amount(n)}` : amount(n));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/* ─────────────────────────── emoji ───────────────────────────

   Categories and purposes are free text — you can invent them — so the icon
   is matched on keywords rather than looked up by exact name. First pattern
   to hit wins, which is why the specific ones sit above the generic ones. */

const ICONS = [
  [/workout|exercise|gym|treadmill|jog|running|sport|swim|bike|cycl|yoga|stretch|hike/, '🏃'],
  [/potato|couch|netflix|binge|scroll|telly|\btv\b/, '🛋️'],
  [/family|kids|parent|lola|lolo|anak|reunion/, '👨‍👩‍👧'],
  [/focus|deep work|study|studying|homework|research|thesis/, '🎯'],
  [/chore|laundry|tidy|sweep|dishes|housework/, '🧹'],
  [/grocer|palengke|supermarket|market/, '🛒'],
  [/eat out|restaurant|dining|dinner|lunch|breakfast|merienda|food/, '🍽️'],
  [/petrol|fuel|gas station|diesel/, '⛽'],
  [/commute|traffic|jeep|tricycle|train|\bbus\b|grab|fare/, '🚌'],
  [/house improve|renovat|repair|paint|carpent|hardware/, '🔨'],
  [/birthday|anniversar|celebrat|fiesta/, '🎂'],
  [/gadget|phone|laptop|computer|tech/, '📱'],
  [/utilit|electric|meralco|water bill|internet|wifi|bill/, '💡'],
  [/appliance|aircon|fridge|washing machine|rice cooker/, '🔌'],
  [/shopping|mall|clothes|shoes/, '🛍️'],
  [/project|freelance|client|side hustle|business/, '🛠️'],
  [/movie|cinema|film|concert|show/, '🎬'],
  [/pray|worship|church|mass|bible|devotion|medit|reflect|journal|gratitude|quiet time|retreat/, '🙏'],
  [/sleep|nap|rest|siesta|recover/, '😴'],
  [/read|book|library/, '📚'],
  [/cook|baking|kitchen/, '🍳'],
  [/wash car|\bcar\b|drive|vehicle|motor/, '🚗'],
  [/email|inbox|admin|paperwork/, '✉️'],
  [/meeting|standup|call|zoom|client sync/, '🗓️'],
  [/code|coding|program|dev\b|build/, '💻'],
  [/school|class|tuition|college|university/, '🎓'],
  [/health|doctor|clinic|medicine|hospital|dentist/, '🏥'],
  [/coffee|kape|cafe|tea/, '☕'],
  [/game|gaming|console|mobile legends/, '🎮'],
  [/travel|trip|flight|vacation|beach/, '✈️'],
  [/music|guitar|sing|band/, '🎵'],
  [/pet|\bdog\b|\bcat\b|aso|pusa/, '🐕'],
  [/friend|barkada|hangout|social/, '🧑‍🤝‍🧑'],
  [/save|savings|bank|invest|ipon/, '🏦'],
  [/gift|regalo|donation|tithe/, '🎁'],
  [/rent|mortgage|amortization/, '🏠'],
  [/walk|stroll|lakad/, '🚶'],
  [/garden|plant|halaman/, '🪴'],
  [/clean|wash|linis/, '🧼']
];

const iconCache = {};
function iconFor(name, fallback) {
  const key = String(name || '');
  if (iconCache[key] != null) return iconCache[key];
  const low = key.toLowerCase();
  const hit = ICONS.find(([re]) => re.test(low));
  return (iconCache[key] = hit ? hit[1] : fallback);
}
/* ── follow-up questions ──

   Matched on keywords rather than on an exact category name, so a category you
   invent later ("Gym", "Merienda") still asks, and renaming one does not
   silently switch the prompt off. */

/* Order matters. The food patterns are deliberately tested before the workout
   one, because "run" is a perfectly good word for an errand — a grocery run, a
   coffee run — and the workout pattern would otherwise claim all of them. */
const FOLLOW_UPS = [
  {
    key: 'shopping-food',
    // Buying food rather than eating it, so the question is worded differently.
    re: /grocer|palengke|supermarket|\bmarket\b|pantry|errand/,
    title: 'What food did you buy?',
    hint: 'Optional — handy when you look back at where the food budget went.',
    placeholder: 'e.g. rice, chicken, vegetables, milk'
  },
  {
    /* Time at the stove, not a meal. Tested before the eating patterns because
       "cooking dinner" matches both, and read as neither a question nor food:
       asking "what did you eat?" for an hour of cooking was the wrong question,
       and counting it as a meal put calories on the day that nobody ate. */
    key: 'cooking',
    re: /\bcook|baking|\bbake\b|meal prep|prepping|luto|nagluluto/,
    silent: true
  },
  {
    key: 'food',
    re: /\bfood\b|\beat\b|eating|\bate\b|\bmeal\b|breakfast|lunch|dinner|snack|merienda|restaurant|dining|kape|coffee|cafe|takeout|kain/,
    title: 'What did you eat?',
    hint: 'Optional — a line about the meal is enough.',
    placeholder: 'e.g. grilled chicken, rice, salad'
  },
  {
    key: 'workout',
    re: /workout|exercise|gym|treadmill|jog|jogging|running|\brun\b|sport|swim|bike|cycl|yoga|stretch|hike|lift|weights|cardio|crossfit|pilates|zumba|badminton|basketball/,
    title: 'What kind of workout was that?',
    hint: 'Sets, distance, how it felt — whatever you would want to read back later.',
    placeholder: 'e.g. 5 km treadmill, 30 min, steady pace'
  }
];

// Reads both the free text and the category/purpose, since either can be the
// thing that identifies an entry as a workout or a meal.
function matchFollowUp(row) {
  const hay = `${row.activity || ''} ${row.category || row.purpose || ''}`.toLowerCase();
  return FOLLOW_UPS.find((f) => f.re.test(hay)) || null;
}

/* A silent rule exists to claim a row before a later rule can — it says what
   the row is *not*, and has no question to ask. */
function followUpFor(kind, row) {
  const hit = matchFollowUp(row);
  return hit && !hit.silent ? hit : null;
}

const catIcon = (name) => iconFor(name, '⏱️');
const purposeIcon = (name) => iconFor(name, '💸');
// The tracker decides the fallback; everything else is shared.
const nameIcon = (name) => (state.app === 'money' ? purposeIcon(name) : catIcon(name));
const withIcon = (name) => `${nameIcon(name)} ${name}`;

/* ─────────────────────────── seed data ─────────────────────────── */

function seedState() {
  const today = new Date();
  const t = iso(today);

  const seed = [
    ['Watch Eala vs Nally WTA match', 'Potato Couching', 390, 420],
    ['Treadmill', 'Workout', 435, 470],
    ['Wash car', 'Chores', 490, 525],
    ['Grocery run', 'Chores', 540, 570],
    ['Breakfast with the family', 'Family Time', 570, 630],
    ['Watch Eat Bulaga', 'Potato Couching', 630, 670],
    ['Cooking for the birthday celeb', 'Chores', 670, 740]
  ].map(([a, c, f, to], i) => ({ id: 'e' + i, date: t, activity: a, category: c, from: f, to: to }));

  // Deterministic history so week and month views have something honest to show.
  const kinds = [['Deep work', 'Focus Work', 540, 240], ['Emails', 'Focus Work', 900, 45], ['Treadmill', 'Workout', 420, 40],
    ['Dinner with the family', 'Family Time', 1110, 75], ['Laundry', 'Chores', 990, 50], ['Netflix', 'Potato Couching', 1230, 90],
    ['Grocery run', 'Chores', 630, 45], ['Reading', 'Focus Work', 1290, 35]];
  const hist = [];
  for (let d = 1; d <= 34; d++) {
    const day = new Date(today); day.setDate(today.getDate() - d);
    const ds = iso(day);
    const n = 3 + ((d * 7) % 3);
    for (let k = 0; k < n; k++) {
      const [a, c, f, len] = kinds[(d * 3 + k) % kinds.length];
      const jitter = ((d * 13 + k * 29) % 40) - 20;
      hist.push({ id: `h${d}-${k}`, date: ds, activity: a, category: c, from: f + jitter, to: f + jitter + len });
    }
  }

  const mSeed = [
    ['Freelance invoice — Q3 retainer', 'Projects', 15000, 0],
    ['Grocery run', 'Groceries', 0, 2450],
    ['Fuel top-up', 'Petrol', 0, 1800],
    ['Lunch with the family', 'Eat Out', 0, 1240],
    ['Gift for Lola’s birthday', 'Birthdays', 0, 3200],
    ['Electricity bill', 'Utilities', 0, 4380]
  ].map(([a, p, i, o], k) => ({ id: 'ms' + k, date: t, activity: a, purpose: p, in: i, out: o }));

  const mKinds = [['Grocery run', 'Groceries', 0, 1900], ['Jeep + train fare', 'Commute', 0, 180], ['Coffee run', 'Eat Out', 0, 420],
    ['Movie night', 'Movies', 0, 900], ['Fuel top-up', 'Petrol', 0, 1700], ['Paint for the hallway', 'House Improvements', 0, 2600],
    ['Phone case', 'Gadgets', 0, 750], ['Client payout', 'Projects', 12000, 0], ['New rice cooker', 'Appliances', 0, 3400],
    ['Weekend shopping', 'Shopping', 0, 2100], ['Water bill', 'Utilities', 0, 690]];
  const mHist = [];
  for (let d = 1; d <= 34; d++) {
    const day = new Date(today); day.setDate(today.getDate() - d);
    const ds = iso(day);
    const n = 2 + ((d * 5) % 3);
    for (let k = 0; k < n; k++) {
      const [a, p, i, o] = mKinds[(d * 4 + k) % mKinds.length];
      const j = 1 + (((d * 11 + k * 7) % 40) - 20) / 100;
      mHist.push({ id: `mh${d}-${k}`, date: ds, activity: a, purpose: p, in: Math.round(i * j), out: Math.round(o * j) });
    }
  }

  return {
    entries: seed.concat(hist),
    money: mSeed.concat(mHist),
    // Starting set for a new account. Existing accounts keep whatever they have.
    categories: [
      'Chores', 'Workout', 'Potato Couching', 'Family Time', 'Focus Work',
      'Eat', 'Sleep', 'Prayers and Reflections', 'Meetings', 'Cooking'
    ].map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] })),
    purposes: PURPOSES.map((n, i) => ({ name: n, color: MONEY_PALETTE[i % MONEY_PALETTE.length] }))
  };
}

/* Categories and purposes without the demo history — what a brand new account
   starts from, so it is not empty on first sign-in. */
function seedTaxonomy() {
  const full = seedState();
  return { categories: full.categories, purposes: full.purposes };
}

/* ─────────────────────────── persistence ─────────────────────────── */

/* localStorage stays the app's own store: every edit lands here first and the
   UI never waits on the network. On top of the data it carries the bookkeeping
   the sync needs —

     tombstones  ids of rows deleted locally, with the time of death. Without
                 these the next pull would cheerfully restore them.
     dirty       what has changed since the last successful push.
     lastSyncAt  server clock from the last sync; the pull watermark.
     account     which account this data belongs to, so signing in as someone
                 else cannot silently inherit it.

   View, range and timer stay per-session, as before. */

const EMPTY_KEYED = () => ({ entries: {}, money: {}, categories: {}, purposes: {} });

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.entries) || !Array.isArray(d.money)) return null;
    return d;
  } catch (e) { return null; }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      entries: state.entries, money: state.money,
      categories: state.categories, purposes: state.purposes,
      currency: state.currency, currencyUpdatedAt: state.currencyUpdatedAt,
      steps: state.steps,
      weightKg: state.weightKg, weightUpdatedAt: state.weightUpdatedAt,
      entryMode: state.entryMode,
      tombstones: state.tombstones, dirty: state.dirty,
      lastSyncAt: state.lastSyncAt, account: state.account,
      drawers: state.drawers,
      timerStart: state.timerStart, timerActivity: state.timerActivity, timerCategory: state.timerCategory
    }));
  } catch (e) { /* private mode or full quota — the session still works */ }
}

/* ─────────────────────────── api ─────────────────────────── */

/* Every request passes through here, so counting them is enough to know
   whether anything is in flight — no call site has to remember to say so. */
let inFlight = 0;
function paintBusy() {
  const bar = document.getElementById('zimpan-progress');
  if (bar) bar.style.display = inFlight > 0 ? 'block' : 'none';
}

async function api(path, { method = 'GET', body } = {}) {
  inFlight += 1;
  paintBusy();
  try {
    return await request(path, method, body);
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    paintBusy();
  }
}

async function request(path, method, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: Object.assign(
      { 'X-Zimpan-Client': '1' },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const API = {
  config: () => api('/api/config'),
  google: (credential) => api('/api/auth/google', { method: 'POST', body: { credential } }),
  me: () => api('/api/me'),
  login: (email, password) => api('/api/login', { method: 'POST', body: { email, password } }),
  register: (email, password) => api('/api/register', { method: 'POST', body: { email, password } }),
  logout: () => api('/api/logout', { method: 'POST' }),
  forgot: (email) => api('/api/forgot', { method: 'POST', body: { email } }),
  reset: (token, password) => api('/api/reset', { method: 'POST', body: { token, password } }),
  push: (since, changes) => api('/api/sync', { method: 'POST', body: { since: since || 0, changes } }),
  estimate: (text) => api('/api/estimate', { method: 'POST', body: { text } })
};

/* ── AI nutrition estimates ──

   Opt-in, one meal at a time, and cached by the text itself rather than by the
   entry: the same breakfast logged on Tuesday and Thursday is one estimate, not
   two, which is the difference between a few cents a month and a bill.

   Both of these are device-local on purpose. Consent is a decision about this
   browser sending text to a third party, and the cache is a saving, not data —
   neither belongs in the account, and neither should follow the user onto a
   device where they have not been asked. */

const AI_CACHE_KEY = 'zimpan.ai.v1';
const AI_CONSENT_KEY = 'zimpan.ai.consent.v1';

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (err) { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode or full */ }
};

// Normalised so spacing and case do not split the cache, and length-suffixed
// so two different meals cannot collide on a short hash alone.
function textKey(s) {
  const t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0);
  return `${h.toString(36)}-${t.length}`;
}

/* ─────────────────────────── state ─────────────────────────── */

const today = new Date();
const todayIso = iso(today);
const storedRaw = load();
/* A device with no store starts with the category and purpose lists but no
   entries. The demo history in seedState() belongs to the local-only era — now
   that accounts exist, seeding it would offer to upload invented data into a
   brand new account on first sign-in. */
const stored = storedRaw || Object.assign({ entries: [], money: [] }, seedTaxonomy());

const state = {
  app: 'time',
  range: CONFIG.defaultRange,
  selectedDate: todayIso,

  entries: stored.entries,
  money: stored.money,
  categories: stored.categories,
  purposes: stored.purposes,
  currency: CURRENCIES.some((c) => c.code === stored.currency) ? stored.currency : 'PHP',
  /* Steps walked, keyed by date. Held on this device only: the sync protocol
     carries entries, money, categories, purposes, currency and weight, and
     adding a kind to it needs a table on the server that does not exist yet. */
  steps: (stored.steps && typeof stored.steps === 'object') ? stored.steps : {},

  weightKg: Number(stored.weightKg) || null,
  weightUpdatedAt: Number(stored.weightUpdatedAt) || 0,
  // 'timer' or 'manual' — only one entry card is on screen at a time.
  entryMode: stored.entryMode === 'manual' ? 'manual' : 'timer',

  form: { date: todayIso, activity: '', category: (stored.categories[0] || {}).name || 'Chores', from: hm(today.getHours() * 60 + today.getMinutes()), to: '' },
  mForm: { date: todayIso, activity: '', purpose: 'Groceries', in: '', out: '' },

  newCatOpen: false, newCatName: '',
  newPurposeOpen: false, newPurposeName: '',

  /* Persisted, and that is the whole trick: a stopwatch needs a start time, not
     a running process. Phones freeze and reload background tabs freely, so
     anything held only in memory is gone the moment you lock the screen. With
     the timestamp on disk the elapsed time is recomputed from the clock. */
  timerStart: Number(stored.timerStart) || null,
  timerActivity: stored.timerActivity || '',
  timerCategory: stored.timerCategory || (stored.categories[0] || {}).name || 'Chores',
  reportOpen: false,
  donateOpen: false,
  resyncArmed: false,

  // Whether the server has a key at all; the button is not drawn without one.
  aiEstimates: false,
  aiConsent: readJson(AI_CONSENT_KEY, false) === true,
  aiCache: readJson(AI_CACHE_KEY, {}),
  aiAsking: null,   // scope awaiting consent
  aiBusy: null,     // scope with a request in flight
  aiError: '',

  // Slice drill-down: the category/purpose the donut is focused on, and
  // whether its entry list is expanded underneath.
  focus: null, focusOpen: false,

  /* Which copy of the calorie gauges has its weight field open — 'today',
     'past', or nothing. Not persisted: it is a thing you opened, not a
     preference, and it should not be waiting for you on the next load. */
  weightEditOpen: null,

  /* Which wellbeing pillar has its activity list open: {key, scope}. */
  pillarOpen: null,

  /* The date whose step count is being edited, or nothing. */
  stepsOpen: null,
  stepsDraft: '',

  /* What each entry form is complaining about, if anything. Set when an add is
     refused and cleared the moment the field is typed into, so the message
     never outlives the mistake. */
  formError: { entry: '', timer: '', money: '' },

  /* A one-shot request for the caret: render() puts focus on the field with
     this data-k and clears it. Lets an action open a panel and land in it. */
  focusField: null,

  /* ── sync bookkeeping (persisted) ── */
  currencyUpdatedAt: Number(stored.currencyUpdatedAt) || 0,
  tombstones: Object.assign(EMPTY_KEYED(), stored.tombstones),
  dirty: Object.assign(EMPTY_KEYED(), stored.dirty, { currency: !!(stored.dirty && stored.dirty.currency) }),
  lastSyncAt: Number(stored.lastSyncAt) || 0,
  account: stored.account || null,

  // Collapsed by default; whether you left one open is remembered.
  drawers: Object.assign({ categories: false, activities: false, lookback: false, legend: false, leaderboard: false, today: false }, stored.drawers),

  /* ── session (per-load) ── */
  booted: false,
  auth: null,
  authOpen: false,
  googleClientId: null,
  // 'login' | 'register' | 'forgot' | 'reset'
  authMode: 'login',
  authEmail: '', authPassword: '', authError: '', authBusy: false,
  authNotice: '',
  resetToken: '',
  migrateOffer: null,
  // noteSkipped is per-session on purpose: skipping is an answer, so the same
  // question stops asking until the next page load.
  notePrompt: null, noteDraft: '', noteSkipped: {},
  legalOpen: null,
  toast: '',
  netState: 'idle', netMessage: '', netError: '', netErrorRow: null, netErrorKind: '',
  syncing: false,

  geo: null
};

// First run: persist the starting taxonomy so it is stable across reloads.
if (!storedRaw) save();

/* ─────────────────────────── sync ───────────────────────────

   Local-first. Every edit lands in localStorage and renders immediately; the
   server is reconciled afterwards and is never in the way of a keystroke.

   Conflicts resolve last-write-wins on `updatedAt`, the same rule the server
   applies, so both ends reach the same answer independently. One caveat worth
   knowing: `updatedAt` comes from whichever device made the edit, so a device
   with a badly wrong clock can win or lose exchanges it shouldn't. */

const KINDS = ['entries', 'money', 'categories', 'purposes'];
const KEY_OF = { entries: 'id', money: 'id', categories: 'name', purposes: 'name' };

const markDirty = (kind, key) => { state.dirty[kind][String(key)] = true; };

// Every mutation goes through touch() or bury(), so nothing can change without
// getting a timestamp and a place in the outbox.
function touch(kind, row) {
  row.updatedAt = Date.now();
  markDirty(kind, row[KEY_OF[kind]]);
  return row;
}
function bury(kind, key) {
  state.tombstones[kind][String(key)] = Date.now();
  markDirty(kind, key);
}

function serialise(kind, r) {
  if (kind === 'entries') return { id: r.id, date: r.date, activity: r.activity, category: r.category, from: r.from, to: r.to, note: r.note || '', updatedAt: r.updatedAt || 0 };
  if (kind === 'money') return { id: r.id, date: r.date, activity: r.activity, purpose: r.purpose, in: Number(r.in) || 0, out: Number(r.out) || 0, note: r.note || '', updatedAt: r.updatedAt || 0 };
  return { name: r.name, color: r.color, position: r.position || 0, updatedAt: r.updatedAt || 0 };
}
function deserialise(kind, r) {
  if (kind === 'entries') return { id: r.id, date: r.date, activity: r.activity, category: r.category, from: r.from, to: r.to, note: r.note || '', updatedAt: r.updatedAt };
  if (kind === 'money') return { id: r.id, date: r.date, activity: r.activity, purpose: r.purpose, in: r.in, out: r.out, note: r.note || '', updatedAt: r.updatedAt };
  return { name: r.name, color: r.color, position: r.position, updatedAt: r.updatedAt };
}

const findRow = (kind, key) => state[kind].find((x) => String(x[KEY_OF[kind]]) === String(key));

function collectChanges() {
  const out = {};
  KINDS.forEach((kind) => {
    const rows = [];
    Object.keys(state.dirty[kind]).forEach((key) => {
      const live = findRow(kind, key);
      if (live) rows.push(serialise(kind, live));
      else if (state.tombstones[kind][key]) {
        rows.push({ [KEY_OF[kind]]: key, updatedAt: state.tombstones[kind][key], deleted: true });
      }
    });
    if (rows.length) out[kind] = rows;
  });
  if (state.dirty.currency) out.currency = { value: state.currency, updatedAt: state.currencyUpdatedAt };
  if (state.dirty.weight) out.weightKg = { value: state.weightKg, updatedAt: state.weightUpdatedAt };
  return out;
}

function mergeChanges(changes) {
  if (!changes) return;
  KINDS.forEach((kind) => {
    const keyName = KEY_OF[kind];
    (changes[kind] || []).forEach((row) => {
      const key = String(row[keyName]);
      const idx = state[kind].findIndex((x) => String(x[keyName]) === key);
      const localAt = idx >= 0 ? (state[kind][idx].updatedAt || 0) : (state.tombstones[kind][key] || 0);
      // A local edit newer than the server's copy stays put and stays dirty,
      // so the next push carries it up instead of losing it here.
      if (localAt > row.updatedAt) return;
      if (row.deleted) {
        if (idx >= 0) state[kind].splice(idx, 1);
        state.tombstones[kind][key] = row.updatedAt;
      } else {
        const built = deserialise(kind, row);
        if (idx >= 0) state[kind][idx] = built; else state[kind].push(built);
        delete state.tombstones[kind][key];
      }
      delete state.dirty[kind][key];
    });
  });
  if (changes.currency && changes.currency.updatedAt >= state.currencyUpdatedAt) {
    state.currency = changes.currency.value;
    state.currencyUpdatedAt = changes.currency.updatedAt;
    state.dirty.currency = false;
  }
  if (changes.weightKg && changes.weightKg.updatedAt >= state.weightUpdatedAt) {
    state.weightKg = changes.weightKg.value == null ? null : Number(changes.weightKg.value);
    state.weightUpdatedAt = changes.weightKg.updatedAt;
    state.dirty.weight = false;
  }
}

/* Clears the outbox only for rows untouched since they were collected — an
   edit made while the request was in flight has to stay queued. */
function clearPushed(sent) {
  KINDS.forEach((kind) => {
    (sent[kind] || []).forEach((row) => {
      const key = String(row[KEY_OF[kind]]);
      const live = findRow(kind, key);
      const currentAt = live ? live.updatedAt : state.tombstones[kind][key];
      if (currentAt === row.updatedAt) delete state.dirty[kind][key];
    });
  });
  if (sent.currency && state.currencyUpdatedAt === sent.currency.updatedAt) state.dirty.currency = false;
  if (sent.weightKg && state.weightUpdatedAt === sent.weightKg.updatedAt) state.dirty.weight = false;
}

/* Resolves the row the server complained about back to something nameable, by
   rebuilding the same payload in the same order the server indexed. */
function describeBlockedRow() {
  const at = state.netErrorRow;
  if (!at) return null;
  const sent = collectChanges()[at.kind];
  const row = sent && sent[at.index];
  if (!row) return null;
  const key = at.kind === 'categories' || at.kind === 'purposes' ? row.name : row.id;
  const live = findRow(at.kind, key);
  return { kind: at.kind, key, label: (live && live.activity) || (live && live.name) || row.activity || row.name || key };
}

const pendingCount = () =>
  KINDS.reduce((n, k) => n + Object.keys(state.dirty[k]).length, 0)
  + (state.dirty.currency ? 1 : 0) + (state.dirty.weight ? 1 : 0);

function setNet(netState, message) {
  state.netState = netState;
  state.netMessage = message;
  paintNet();
}

// Status changes repaint one element rather than the page — a full render here
// would tear out the field you are typing in.
function paintNet() {
  const el = root.querySelector('[data-net]');
  if (!el) return;
  el.textContent = netLabel();
  el.style.color = state.netState === 'offline' || state.netState === 'error'
    ? 'var(--color-text)' : 'var(--color-neutral-600)';
  const btn = el.closest('button');
  if (btn) btn.title = state.netState === 'error' ? state.netError : 'Sync now';
}

function netLabel() {
  const pending = pendingCount();
  if (state.netState === 'syncing') return 'Syncing…';
  if (state.netState === 'error') {
    const what = state.netErrorKind === 'server' ? 'Server error' : 'Sync blocked';
    return pending ? `${what} · ${pending} waiting` : what;
  }
  if (state.netState === 'paused') return pending ? `Sync paused · ${pending} waiting` : 'Sync paused';
  if (state.netState === 'offline') return pending ? `Offline · ${pending} waiting` : 'Offline';
  if (state.netState === 'synced') return pending ? `${pending} waiting` : 'All changes saved';
  return pending ? `${pending} waiting` : '';
}

let syncTimer = null;
function queueSync(delay) {
  if (!state.auth) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow(); }, delay == null ? 800 : delay);
}

/* Asks the server for a closer figure. A cached answer for the same text is
   used without a request, which is what keeps this affordable — a repeated
   breakfast costs nothing after the first time. */
async function refineFood(scope) {
  const v = compute();
  const food = scope === 'today' ? v.todayFood : v.pastFood;
  if (!food || !food.detail) return;
  // Same gate the button is drawn behind, in case a click outlives the render
  // that should have removed it.
  if (scope === 'past' && !v.pastSingleDate) return;

  if (state.aiCache[food.key]) { render(); return; }

  state.aiBusy = scope;
  state.aiError = '';
  render();
  try {
    const res = await API.estimate(food.detail);
    state.aiCache[food.key] = res.estimate;
    writeJson(AI_CACHE_KEY, state.aiCache);
    flash(`Estimated · ${res.estimate.kcal.toLocaleString('en-US')} kcal`);
  } catch (err) {
    // Shown next to the button rather than as a toast: it belongs to that
    // reading, and the local estimate is still sitting there and still valid.
    state.aiError = err.message || 'Could not get an estimate just now.';
  } finally {
    state.aiBusy = null;
    render();
  }
}

async function syncNow() {
  if (!state.auth || state.syncing) return;
  state.syncing = true;
  setNet('syncing', '');
  const sent = collectChanges();
  try {
    const res = await API.push(state.lastSyncAt, sent);
    mergeChanges(res.changes);
    clearPushed(sent);
    state.lastSyncAt = res.serverTime;
    state.syncing = false;
    save();
    setNet('synced', '');
    render();
  } catch (err) {
    state.syncing = false;
    if (err.status === 401) {
      // Session expired or revoked elsewhere. The local copy is untouched.
      state.auth = null;
      setNet('idle', '');
      render();
      return;
    }
    /* A 4xx means the server understood us and refused. Retrying the same
       payload will fail identically forever, so say what happened rather than
       blaming the network and queueing silently. */
    /* A 5xx means the server was reached and broke. Calling that "offline"
       sends you looking at your connection when the answer is in stderr.log. */
    /* 503 is the server saying its database is away but that it is otherwise
       healthy. The changes are still good and will go up unaltered, so this is
       a pause rather than a failure: the queue is kept, the loud banner stays
       down, and it tries again shortly without being asked. */
    if (err.status === 503) {
      state.netErrorKind = 'paused';
      state.netError = err.message || 'Sync is paused while the server’s database is unavailable.';
      state.netErrorRow = null;
      setNet('paused', '');
      queueSync(60000);
      render();
      return;
    }
    if (err.status >= 500) {
      state.netErrorKind = 'server';
      state.netError = `The server returned an error (${err.status}). Its log will say why — often a database column the code expects but the schema has not got yet.`;
      state.netErrorRow = null;
      setNet('error', '');
      render();
      return;
    }
    if (err.status >= 400 && err.status < 500) {
      state.netErrorKind = 'client';
      state.netError = err.message || 'The server rejected these changes.';
      // Validation messages name the offending row ("entries[7].activity …"),
      // which is enough to identify it and offer a way past it.
      const at = /^(entries|money|categories|purposes)\[(\d+)\]/.exec(state.netError);
      state.netErrorRow = at ? { kind: at[1], index: Number(at[2]) } : null;
      setNet('error', '');
      render();
      return;
    }
    setNet('offline', '');
  }
}

/* ── account lifecycle ── */

const hasLocalData = () => state.entries.length > 0 || state.money.length > 0;

function resetLocal() {
  const tax = seedTaxonomy();
  const t = Date.now();
  state.entries = [];
  state.money = [];
  state.categories = tax.categories.map((c) => ({ name: c.name, color: c.color, position: 0, updatedAt: t }));
  state.purposes = tax.purposes.map((p, i) => ({ name: p.name, color: p.color, position: i, updatedAt: t }));
  state.tombstones = EMPTY_KEYED();
  state.dirty = Object.assign(EMPTY_KEYED(), { currency: false });
  state.lastSyncAt = 0;
  state.focus = null;
  state.focusOpen = false;
  // A fresh account has no taxonomy server-side, so push these up.
  ['categories', 'purposes'].forEach((k) => state[k].forEach((r) => markDirty(k, r.name)));
}

/* Stamps and queues everything already on this device. Rows predating the
   back-end have no updatedAt at all, hence the fill-in. */
function adoptLocalData() {
  const t = Date.now();
  KINDS.forEach((kind) => {
    state[kind].forEach((row) => {
      if (!row.updatedAt) row.updatedAt = t;
      if (KEY_OF[kind] === 'name' && row.position == null) row.position = 0;
      markDirty(kind, row[KEY_OF[kind]]);
    });
  });
  if (!state.currencyUpdatedAt) state.currencyUpdatedAt = t;
  state.dirty.currency = true;
}

async function afterSignIn(user) {
  // Different account on this browser: its data is not ours to inherit.
  if (state.account && state.account !== user.email) {
    resetLocal();
    state.account = user.email;
    save();
  } else if (!state.account) {
    if (hasLocalData()) {
      // Data from before there were accounts. Ask before uploading it.
      state.migrateOffer = { entries: state.entries.length, money: state.money.length };
      render();
      return;
    }
    state.account = user.email;
    save();
  }
  if (!state.dirty.currency && user.currency) state.currency = user.currency;
  render();
  await syncNow();
}

/* ── google sign-in ──
   Google's script is fetched only when the server says a client id exists, so
   an unconfigured install makes no third-party request at all. */

let gisState = 'idle'; // idle | loading | ready | failed

function loadGoogle() {
  if (gisState !== 'idle' || !state.googleClientId) return;
  gisState = 'loading';
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = () => {
    try {
      window.google.accounts.id.initialize({
        client_id: state.googleClientId,
        callback: onGoogleCredential
      });
      gisState = 'ready';
      mountGoogleButton();
    } catch (e) {
      gisState = 'failed';
    }
  };
  s.onerror = () => { gisState = 'failed'; render(); };
  document.head.appendChild(s);
}

// render() rebuilds the DOM, so the button has to be re-drawn into the fresh
// container every time the auth screen is painted.
function mountGoogleButton() {
  if (gisState !== 'ready' || !window.google) return;
  const host = root.querySelector('[data-google-btn]');
  if (!host) return;
  host.innerHTML = '';
  try {
    window.google.accounts.id.renderButton(host, {
      theme: 'outline', size: 'large', shape: 'pill',
      text: 'continue_with', width: 320, logo_alignment: 'center'
    });
  } catch (e) { /* the email form still works */ }
}

async function onGoogleCredential(response) {
  state.authBusy = true;
  state.authError = '';
  render();
  try {
    const res = await API.google(response && response.credential);
    state.authBusy = false;
    state.authPassword = '';
    state.auth = res.user;
    await afterSignIn(res.user);
  } catch (err) {
    state.authBusy = false;
    state.authError = err.message || 'Google sign-in did not complete.';
    render();
  }
}

async function boot() {
  // A reset link lands here with ?reset=<token>; that screen wins over
  // everything, including an existing session on this device.
  const token = new URLSearchParams(location.search).get('reset');
  if (token) {
    state.resetToken = token;
    state.authMode = 'reset';
    state.booted = true;
    state.auth = null;
    render();
  }

  try {
    /* Retried once: this single call decides whether the Google button and the
       Refine button exist at all, and a request lost to a flaky first moment on
       a phone would otherwise hide both for the whole session, silently and
       with nothing on screen to suggest why. */
    let cfg;
    try { cfg = await API.config(); }
    catch (first) {
      await new Promise((r) => setTimeout(r, 1500));
      cfg = await API.config();
    }
    state.googleClientId = cfg.googleClientId || null;
    state.aiEstimates = !!cfg.aiEstimates;
    if (state.googleClientId) loadGoogle();
  } catch (e) { /* offline, or not configured — email sign-in is unaffected */ }

  if (state.authMode === 'reset') { if (state.googleClientId) loadGoogle(); return; }

  try {
    const me = await API.me();
    state.booted = true;
    state.auth = me.user;
    await afterSignIn(me.user);
  } catch (err) {
    state.booted = true;
    if (err.status === 401) {
      state.auth = null;
    } else if (state.account) {
      /* Network down but this browser already belongs to an account: carry on
         from the local copy rather than locking the user out of their own data.
         A 503 is the narrower case — the server answered, its database did
         not — and saying "offline" there sends people to check their wifi. */
      state.auth = { email: state.account, currency: state.currency };
      setNet(err.status === 503 ? 'paused' : 'offline', '');
    }
    render();
  }
}

/* ─────────────────────────── derivations ─────────────────────────── */

/* Derived from position rather than read from the row. A stored colour is a
   colour chosen under whichever palette was current when the category was made,
   which is how an account that predates a rebrand keeps wearing the old one.
   Nothing in the app lets you pick a category colour, so there is none to lose. */
const colorOf = (name) => {
  const i = state.categories.findIndex((x) => x.name === name);
  return i < 0 ? PALETTE[PALETTE.length - 1] : PALETTE[i % PALETTE.length];
};
/* Purposes are drawn from MONEY_PALETTE by position rather than from the colour
   saved on the record, so the green theme applies to data logged before it
   existed without rewriting anything in storage. */
const purposeColor = (name) => {
  const i = state.purposes.findIndex((x) => x.name === name);
  return MONEY_PALETTE[(i < 0 ? 7 : i) % MONEY_PALETTE.length];
};

/* Every window is trailing and inclusive — it counts back from the selected
   date, so the day you are looking at is always the last one in it. Keeping the
   lengths in one table is what lets a new range be added without hunting down
   the arithmetic in four different places. */
const RANGE_DAYS = { day: 1, week: 7, fortnight: 14, month: 30 };
const rangeDays = () => RANGE_DAYS[state.range] || 1;

// ISO dates sort lexically, so plain string comparison beats Date round-trips.
function windowStart(endIso, days) {
  const d = new Date(endIso + 'T00:00:00');
  d.setDate(d.getDate() - (Math.max(1, days) - 1));
  return iso(d);
}

function withinRange(list) {
  const { selectedDate, range } = state;
  if (range === 'day') return list.filter((e) => e.date === selectedDate);
  const start = windowStart(selectedDate, RANGE_DAYS[range] || 1);
  return list.filter((e) => e.date >= start && e.date <= selectedDate);
}
const rangeEntries = () => withinRange(state.entries);
const moneyRangeEntries = () => withinRange(state.money);

/* ── overlapping entries ──
   A minute of the day belongs to one activity. Entries are allowed to contain
   each other — a meal inside a staycation, a session inside a conference — and
   summing them straight made a day read as twenty-six hours and let the
   container swallow the chart: a 22-hour staycation with dinner logged inside
   it reported 96% family time.

   The shorter entry is the more specific account of a minute, so it takes it;
   the longer one keeps only what nothing else claims. Resolved per date, since
   a window spans several.

   This is for totals — day totals, shares, pillars, calories. An entry's own
   card still shows its own length: that is what you entered, and it has to
   agree with the From and To printed beside it. */
function resolveSpans(list) {
  const out = new Map();
  const byDate = {};
  list.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  Object.keys(byDate).forEach((date) => {
    // Shortest first: the most specific claim on a minute gets there first.
    const order = byDate[date].slice().sort((a, b) => span(a) - span(b));
    const taken = new Uint8Array(1440);
    order.forEach((e) => {
      const ranges = wraps(e) ? [[e.from, 1440], [0, e.to]] : [[e.from, e.to]];
      let mins = 0;
      ranges.forEach(([s0, s1]) => {
        const lo = Math.max(0, Math.floor(s0)), hi = Math.min(1440, Math.ceil(s1));
        for (let m = lo; m < hi; m++) if (!taken[m]) { taken[m] = 1; mins++; }
      });
      out.set(e, mins);
    });
  });
  return out;
}

/* Minutes an entry contributes to a total, once overlaps are settled. */
const effective = (eff) => (e) => eff.get(e) || 0;

function totalsByCategory(list) {
  const map = {};
  const mins = effective(resolveSpans(list));
  list.forEach((e) => {
    const m = mins(e);
    if (!map[e.category]) map[e.category] = { name: e.category, mins: 0, count: 0, color: colorOf(e.category) };
    map[e.category].mins += m; map[e.category].count += 1;
  });
  return Object.values(map).sort((a, b) => b.mins - a.mins);
}
function totalsByPurpose(list) {
  const map = {};
  list.filter((e) => e.out > 0).forEach((e) => {
    if (!map[e.purpose]) map[e.purpose] = { name: e.purpose, mins: 0, count: 0, color: purposeColor(e.purpose) };
    map[e.purpose].mins += e.out; map[e.purpose].count += 1;
  });
  return Object.values(map).sort((a, b) => b.mins - a.mins);
}

function reportRangeLabel() {
  const { range, selectedDate } = state;
  const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (range === 'day') return f(selectedDate);
  return `${f(windowStart(selectedDate, RANGE_DAYS[range] || 1))} — ${f(selectedDate)}`;
}

/* ─────────────────────────── wellbeing ───────────────────────────

   These notes are observations drawn from what you logged — not a health
   assessment, and deliberately not phrased as one. Each activity is matched on
   its text and its minutes are shared out across the four dimensions by the
   weights below; `still` marks sedentary time, which reads against the physical
   picture rather than for it. */

const DIMENSIONS = [
  { key: 'physical', label: 'Physically' },
  { key: 'emotional', label: 'Emotionally' },
  { key: 'mental', label: 'Mentally' },
  { key: 'spiritual', label: 'Spiritually' }
];

// Minutes a day that read as "the dimension is being fed". Gentle on purpose.
const TARGETS = { physical: 30, emotional: 60, mental: 120, spiritual: 15 };

const WELLBEING = [
  { re: /workout|exercise|gym|treadmill|jog|running|sport|swim|bike|cycl|yoga|stretch|hike|walk|lakad/, w: { physical: 1, mental: .3, emotional: .3 } },
  { re: /pray|worship|church|mass|bible|devotion|medit|reflect|journal|gratitude|quiet time|retreat|nature|tithe/, w: { spiritual: 1, emotional: .4, mental: .3 } },
  // Spiritual credit comes only from the reflective rule above. Time with people
  // and time reading are their own goods; counting them here would let the card
  // report quiet you never actually had.
  { re: /family|kids|anak|parent|lola|lolo|friend|barkada|date night|reunion|dinner with|lunch with|breakfast with|visit|catch up/, w: { emotional: 1 } },
  /* Sleep credits nothing here. It used to take 80% of physical and 50% of
     mental, which read as movement and as focused work — neither of which it
     is. A night's sleep is roughly ten times the physical target on its own, so
     it buried real exercise: eight hours in bed reported six and a half hours
     "of movement" and pinned the reading at strong whatever else you did.

     Sleep is not idle either, so it takes no `still` flag; it is simply
     tracked time that no pillar worded in terms of activity should claim. */
  { re: /sleep|nap|siesta/, w: {} },
  { re: /\brest\b|recover/, w: {} },
  { re: /read|book|study|learn|class|school|course|tuition/, w: { mental: 1 } },
  { re: /focus|deep work|code|coding|program|writing|email|admin|meeting|research|project|client|work/, w: { mental: 1 } },
  { re: /chore|clean|linis|laundry|wash|cook|grocer|errand|repair|garden|tidy|dishes/, w: { physical: .5, mental: .2 } },
  { re: /potato|couch|netflix|binge|scroll|social media|youtube|\btv\b|gaming|\bgame|movie|eat bulaga/, w: {}, still: true },
  { re: /commute|traffic|jeep|train|\bbus\b|driving|fare/, w: {}, drain: true }
];

/* `steps` is {count, date, days} for the window, or nothing. Steps fed the
   calorie figure from the day they were added but never reached these
   readings, which only ever looked at logged entries — so a day walked into
   the ground still reported no movement at all. */
function wellbeing(list, steps) {
  const mins = { physical: 0, emotional: 0, mental: 0, spiritual: 0 };
  /* What fed each figure. A reading like "22m of movement" is unarguable
     until you want to know which 22 minutes — and since most rules credit a
     fraction of an entry, the answer is rarely the obvious one. */
  const parts = { physical: [], emotional: [], mental: [], spiritual: [] };
  let tracked = 0, still = 0, drain = 0, vague = 0;
  // `mins` is already the per-dimension tally above, so this one is named apart.
  const effMins = effective(resolveSpans(list));
  list.forEach((e) => {
    const m = effMins(e);
    if (!m) return;
    tracked += m;
    const hit = WELLBEING.find((r) => r.re.test(`${e.activity} ${e.category}`.toLowerCase()));
    if (!hit) { vague += m; return; }
    if (hit.still) still += m;
    if (hit.drain) drain += m;
    Object.keys(hit.w).forEach((k) => {
      if (!hit.w[k]) return;
      mins[k] += m * hit.w[k];
      parts[k].push({
        activity: e.activity, category: e.category, date: e.date,
        mins: m, weight: hit.w[k], credited: Math.round(m * hit.w[k])
      });
    });
  });
  /* Steps count as the walking they were, at the cadence the calorie figure
     already prices them at. Physical only: a walk with company earns its
     emotional credit from the entry you logged, not from a pedometer.

     Deliberately not added to `tracked` — that is logged time, and a step
     count is not an entry. It would also inflate "X logged of the Y so far
     today", which measures the same thing. */
  const stepMins = steps && steps.count ? Math.round(steps.count / STEPS_PER_MINUTE) : 0;
  if (stepMins) {
    mins.physical += stepMins;
    parts.physical.push({
      activity: `${steps.count.toLocaleString('en-US')} steps${steps.days > 1 ? ` across ${steps.days} days` : ''}`,
      category: 'Steps', date: steps.date,
      mins: stepMins, weight: 1, credited: stepMins
    });
  }

  Object.keys(parts).forEach((k) => parts[k].sort((a, b) => b.credited - a.credited));
  return { mins, parts, tracked, still, drain, vague };
}

/* Wording that reads the same whether the window is one day or thirty — the
   per-day aside carries the difference. Each line is capped at 300 characters
   by clamp() below, so a long one is trimmed rather than allowed to sprawl. */
const NOTES = {
  physical: {
    strong: (t, p) => `${t} of movement${p} — enough to matter. Regular activity is the single habit with the widest reach: it steadies sleep, mood and blood sugar at once. The gain comes from consistency rather than intensity, so protecting the routine matters more than any one hard session.`,
    steady: (t, p) => `${t} of movement${p}. A real base, though below the half-hour a day most guidance settles on. The cheapest way to close that gap is usually to lengthen something already in the routine rather than to add a new commitment you then have to defend.`,
    thin: (t, p) => `Only ${t} of movement${p} — the rest of the time was largely still. Long unbroken sitting affects circulation and energy on its own, separately from whether you exercise, so short breaks scattered through the day count for more than their length suggests.`,
    none: () => 'No movement logged at all. The body reads a still stretch as a signal to wind everything down — energy, appetite and sleep quality drift together. A brisk walk is the lowest-effort way back, and it does not need to be long to register.'
  },
  emotional: {
    strong: (t, p) => `${t} with the people who matter${p}. Time spent in company is among the strongest predictors of how a stretch is remembered, and it buffers stress that would otherwise land squarely on you. This is the part of the week worth defending first.`,
    steady: (t, p) => `${t} of time with others${p} — present, if not abundant. Connection tends to be the first thing squeezed when work expands, and the loss is quiet enough that it usually goes unnoticed until the mood has already shifted.`,
    thin: (t, p) => `Just ${t} with other people${p}. Thin company over a stretch this long tends to be felt as low mood or shorter patience well before it is recognised as loneliness, because the cause is an absence rather than an event.`,
    none: () => 'Nothing logged with other people. A stretch spent entirely alone is usually felt afterwards rather than during, and it is easy to attribute the flatness to work or sleep instead. Even a short call registers differently than time alone.'
  },
  mental: {
    strong: (t, p) => `${t} of real concentration${p}. That is a productive load and worth protecting — but sustained focus draws down the same reserves rest restores, so the ceiling is set by recovery rather than by willpower or available hours.`,
    steady: (t, p) => `${t} of focused work${p} — a workable load with room either way. Attention holds up best in blocks with genuine breaks between them, rather than a long stretch defended against interruption until it collapses.`,
    thin: (t, p) => `${t} of focused work${p}. Light, whether by choice or by drift. Worth knowing which: a deliberately light stretch restores you, while a scattered one leaves the same tiredness as a heavy one without the work to show for it.`,
    none: () => 'No focused work logged. Restful or scattered, depending on how it felt — and those two produce very different weeks from identical numbers. If it felt busy but nothing landed, the time likely went in fragments too small to log.'
  },
  spiritual: {
    strong: (t, p) => `${t} of quiet or reflection${p}. Deliberate stillness is rare enough that it shows up everywhere else — in patience, in perspective, in how heavily setbacks land. Whatever form it takes, it is doing more work than the minutes suggest.`,
    steady: (t, p) => `${t} of stillness or reflection${p}. Enough to notice the difference, and the kind of habit that compounds: its value comes from being regular rather than long, so short and daily beats occasional and extended.`,
    thin: (t, p) => `Only ${t} of anything quiet or reflective${p}. Without some room that is not filled, a stretch tends to be experienced as a queue of tasks rather than as time you actually spent, which is why busy weeks so often feel like they vanished.`,
    none: () => 'Nothing still or reflective logged — no room where the stretch could settle. Prayer, journalling, or simply sitting without a screen all serve the same purpose: somewhere for everything else to land before the next thing starts.'
  }
};

/* Keeps whole sentences within a budget, dropping from the end rather than
   cutting one off mid-phrase. Sentences are supplied most-important-first. */
function fitSentences(parts, max) {
  const kept = [];
  let used = 0;
  for (const part of parts) {
    const cost = used ? part.length + 1 : part.length;
    if (used + cost > max) break;
    kept.push(part);
    used += cost;
  }
  return kept.join(' ');
}

// Hard ceiling on any single insight, per the brief.
const clamp = (text, max) => {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const stop = cut.lastIndexOf(' ');
  return `${(stop > max * 0.6 ? cut.slice(0, stop) : cut).replace(/[,;:.\s]+$/, '')}…`;
};

/* ── what was eaten ──

   Built only from what you wrote down: the activity names and the notes the
   food question collects. It describes patterns and repeats general nutrition
   guidance — it is not an assessment of your health, and it cannot be, since a
   line of free text says nothing about portions, medication or conditions.
   Everything here is hedged accordingly and points back at your doctor. */

const FOOD_GROUPS = [
  { key: 'vegetables', good: true, label: 'vegetables', re: /veg|salad|gulay|kangkong|pechay|malunggay|broccoli|spinach|lettuce|carrot|cabbage|greens|ampalaya|okra|eggplant|talong/ },
  { key: 'fruit', good: true, label: 'fruit', re: /fruit|banana|saging|apple|mango|orange|papaya|pineapple|melon|berries|grapes|avocado/ },
  { key: 'protein', good: true, label: 'protein', re: /chicken|manok|fish|isda|bangus|tilapia|tuna|beef|baboy|pork|egg|itlog|tofu|beans|monggo|lentil|shrimp|hipon|seafood/ },
  { key: 'wholegrain', good: true, label: 'whole grains', re: /oats|oatmeal|brown rice|wholemeal|whole wheat|quinoa|barley/ },
  { key: 'water', good: true, label: 'water', re: /\bwater\b|tubig|hydrat/ },
  { key: 'grains', label: 'rice or bread', re: /\brice\b|kanin|bread|pandesal|pasta|noodle|cereal|tortilla/ },
  { key: 'fried', risk: true, label: 'fried food', re: /fried|crispy|lechon|chicharon|bacon|tempura|fries|lumpia|tocino|longganisa/ },
  { key: 'sweet', risk: true, label: 'sugary food or drinks', re: /cake|halo-halo|ice cream|dessert|chocolate|candy|soda|coke|sprite|iced tea|boba|milk tea|donut|pastry|sweet|leche flan|sugar/ },
  { key: 'processed', risk: true, label: 'processed or fast food', re: /instant|canned|hotdog|sausage|spam|corned beef|chips|fast food|jollibee|mcdo|burger|pizza|fried chicken|takeout|siomai/ },
  { key: 'caffeine', watch: true, label: 'caffeine', re: /coffee|kape|espresso|latte|americano|energy drink|red bull/ },
  { key: 'alcohol', watch: true, label: 'alcohol', re: /beer|wine|whisky|vodka|gin|rum|cocktail|alcohol|inuman/ }
];

const isFoodRow = (row) => {
  // The raw match, not the question: cooking is claimed by a silent rule that
  // has no question, and must still be kept out of the day's intake.
  const q = matchFollowUp(row);
  return !!q && (q.key === 'food' || q.key === 'shopping-food');
};

/* ── rough energy maths ──

   Every number below is an estimate and is labelled as one wherever it is
   shown. A line of text says nothing about portion size, cooking method or
   what was left on the plate, so treat these as orders of magnitude rather
   than measurements. Values are per typical serving.

   Sources are the usual public nutrition tables, rounded hard — precision
   here would be false confidence. */

/* Rules are tried in order and the first to match an item wins, so "fried
   chicken" is never also billed as plain chicken and "black coffee" never as a
   latte. Specific patterns therefore have to precede general ones. `g` is kept
   for readability; matching is per item now, so it no longer has to suppress
   anything. */
const SERVINGS = [
  // Drinks and supplements first: they are the ones most often written
  // alongside a meal, and several of them are close to free.
  { g: 'water', re: /\bwater\b|tubig/, kcal: 0, p: 0, c: 0, f: 0 },
  /* Condiments, so "fish with soy sauce" does not bill the sauce as an
     unrecognised side dish worth a hundred and seventy calories. */
  { g: 'condiment', re: /soy sauce|toyo|vinegar|suka|ketchup|patis|fish sauce|\bsauce\b|mustard|sriracha|hot sauce|\bsalt\b|pepper\b|spices/, kcal: 15, p: 0, c: 2, f: 0.5, serve: 20 },
  { g: 'supplement', re: /creatine|multivitamin|vitamins?\b|electrolyte|\bbcaa\b|pre-?workout/, kcal: 5, p: 0, c: 1, f: 0 },
  { g: 'supplement', re: /whey|protein powder|protein shake|mass gainer/, kcal: 120, p: 24, c: 3, f: 1.5 },
  { g: 'coffee', re: /black coffee|americano|espresso|brewed coffee|kapeng barako|black kape/, kcal: 5, p: 0, c: 1, f: 0 },
  { g: 'coffee', re: /latte|cappuccino|mocha|frappe|white coffee|3-?in-?1/, kcal: 150, p: 6, c: 18, f: 6 },
  { g: 'coffee', re: /coffee|kape/, kcal: 60, p: 2, c: 8, f: 2 },
  { g: 'tea', re: /green tea|black tea|\btea\b(?! ?(?:milk|boba))/, kcal: 2, p: 0, c: 0, f: 0 },

  // Baked goods — the gap that started this. A croissant is mostly butter.
  { g: 'baked', re: /croissant|croisant|crossaint|crosaint/, kcal: 250, p: 5, c: 26, f: 14 },
  { g: 'baked', re: /bagel/, kcal: 250, p: 10, c: 48, f: 1.5 },
  { g: 'baked', re: /muffin|scone|banana bread/, kcal: 380, p: 6, c: 52, f: 17 },
  { g: 'baked', re: /pancake|waffle|hotcake/, kcal: 250, p: 6, c: 35, f: 9 },
  { g: 'sandwich', re: /sandwich|sanwich|sandwhich|\bwrap\b|\bsub\b|baguette/, kcal: 330, p: 14, c: 38, f: 13 },
  { g: 'spread', re: /peanut butter|\bnutella\b|almond butter/, kcal: 190, p: 7, c: 6, f: 16, serve: 32 },
  /* A cup of nuts is nothing like a handful, and people write both. `cup`
     carries its own multiplier here because 30g is the serving this is priced
     for and a cup is closer to 145g. */
  { g: 'nuts', re: /\bnuts?\b|almond|cashew|peanuts/, kcal: 170, p: 6, c: 6, f: 15, serve: 30, cup: 4.8 },

  { g: 'grain', re: /brown rice|quinoa|barley|wholemeal/, kcal: 215, p: 5, c: 45, f: 1.8, serve: 160 },
  { g: 'grain', re: /\brice\b|kanin/, kcal: 205, p: 4, c: 45, f: 0.4, serve: 160 },
  { g: 'bread', re: /bread|pandesal|toast/, kcal: 160, p: 6, c: 30, f: 2 },
  { g: 'pasta', re: /pasta|noodle|spaghetti|pancit/, kcal: 300, p: 11, c: 56, f: 3 },
  { g: 'oats', re: /oats|oatmeal|cereal/, kcal: 160, p: 6, c: 27, f: 3 },
  /* Named dishes before their headline ingredient, or "chicken adobo" is billed
     as plain chicken and loses the oil and sugar it was cooked in. */
  { g: 'stew', re: /adobo|caldereta|kaldereta|menudo|curry|afritada|mechado|kare-?kare|bicol express/, kcal: 350, p: 25, c: 12, f: 22 },
  { g: 'soup', re: /sinigang|tinola|nilaga|bulalo|\bsoup\b|batchoy|mami/, kcal: 180, p: 14, c: 12, f: 8 },
  { g: 'chicken', re: /fried chicken|chicken inasal|lechon manok/, kcal: 420, p: 32, c: 12, f: 26 },
  { g: 'chicken', re: /chicken|manok/, kcal: 240, p: 34, c: 0, f: 11 },
  { g: 'fish', re: /fish|isda|bangus|tilapia|tuna|salmon/, kcal: 210, p: 30, c: 0, f: 9, serve: 150 },
  { g: 'beef', re: /beef|steak|baka/, kcal: 290, p: 30, c: 0, f: 18, serve: 140 },
  { g: 'pork', re: /\bpork\b|baboy|liempo|lechon kawali|lechon baboy/, kcal: 320, p: 27, c: 0, f: 23, serve: 140 },
  // One large egg, so a written count multiplies cleanly.
  { g: 'egg', re: /\begg|itlog/, kcal: 78, p: 6.5, c: 0.5, f: 5.5, serve: 50 },
  { g: 'plant', re: /tofu|tokwa|beans|monggo|lentil/, kcal: 150, p: 12, c: 12, f: 6, serve: 120 },
  { g: 'seafood', re: /shrimp|hipon|seafood/, kcal: 140, p: 26, c: 1, f: 2, serve: 100 },
  { g: 'veg', re: /salad|gulay|kangkong|pechay|vegetable|broccoli|spinach|malunggay/, kcal: 70, p: 3, c: 10, f: 2 },
  { g: 'fruit', re: /banana|saging|apple|mango|orange|papaya|pineapple|melon|berries|fruit/, kcal: 95, p: 1, c: 24, f: 0.3 },
  { g: 'curedmeat', re: /bacon|chicharon|tocino|longganisa|sausage|hotdog/, kcal: 300, p: 14, c: 3, f: 26 },
  { g: 'fastfood', re: /burger|pizza|fries|lumpia|tempura|siomai/, kcal: 400, p: 15, c: 40, f: 20 },
  { g: 'instant', re: /instant noodle|canned|spam|corned beef/, kcal: 380, p: 13, c: 45, f: 16 },
  { g: 'dessert', re: /cake|donut|pastry|leche flan|ice cream|halo-halo|dessert|chocolate/, kcal: 330, p: 4, c: 45, f: 15, serve: 100 },
  { g: 'drink', re: /milk tea|boba/, kcal: 250, p: 3, c: 45, f: 6 },
  { g: 'drink', re: /soda|coke|sprite|softdrink|iced tea|juice/, kcal: 180, p: 0, c: 44, f: 0 },
  { g: 'dairy', re: /yogurt|cheese|\bmilk\b(?! ?tea)/, kcal: 130, p: 8, c: 10, f: 6 },
];

// A meal we cannot read at all still happened; ignoring it would understate
// the day more than a rough placeholder does.
const UNKNOWN_MEAL = { kcal: 450, p: 20, c: 50, f: 16 };

/* One unreadable item inside an otherwise readable meal is not a whole meal,
   so it is charged far less than UNKNOWN_MEAL. Undercounting here is the
   failure that matters: it is invisible, where an overcount looks wrong and
   gets corrected. */
const UNKNOWN_ITEM = { kcal: 170, p: 7, c: 18, f: 7 };

/* A written line is a list, not a single food. Splitting on the punctuation
   people actually use is what lets "2 eggs, a sandwich and coffee" be three
   things rather than whichever one happened to match first. */
const ITEM_SPLIT = /\s*(?:,|;|\/|\+|\band\b|\bwith\b|\bw\/|\bplus\b|\n)\s*/i;

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, dozen: 12 };

/* Portion words, deliberately mild: "large" on a menu is not double, and an
   over-eager multiplier here would be as wrong as the undercount it replaces. */
const SIZE_WORDS = [
  { re: /\b(?:extra large|x-?large|jumbo|huge|giant)\b/, mult: 1.4 },
  { re: /\b(?:large|big|grande|venti|foot-?long)\b/, mult: 1.2 },
  { re: /\b(?:small|mini|petite|kiddie|tall)\b/, mult: 0.7 },
  { re: /\b(?:half|1\/2)\b/, mult: 0.5 }
];

/* A number followed by a unit of mass is a weight, not a count. Reading "250
   grams of fish" as two hundred and fifty fish is how a day's food reached
   seventeen thousand calories. */
const MASS_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|kilograms?|gs?\b|gr\b|grams?|oz|ounces?|lbs?|pounds?)\b/i;
const TO_GRAMS = { kg: 1000, kilo: 1000, kilogram: 1000, g: 1, gr: 1, gram: 1, oz: 28.35, ounce: 28.35, lb: 453.6, pound: 453.6 };

// Typical serving weight where a rule does not name its own.
const DEFAULT_SERVE_G = 120;

/* How much of it. A weight is scaled against the serving the rule is priced
   for; otherwise a count is read, capped because a stray year or price in the
   text would otherwise multiply a meal into the tens of thousands. Both ends
   are clamped: no single written item is a fifth of a serving or five of them. */
function portionOf(item, hit) {
  const mass = MASS_RE.exec(item);
  if (mass) {
    const unit = mass[2].toLowerCase().replace(/s$/, '');
    const grams = Number(mass[1]) * (TO_GRAMS[unit] || TO_GRAMS[unit.replace(/s$/, '')] || 1);
    const serve = (hit && hit.serve) || DEFAULT_SERVE_G;
    return Math.max(0.2, Math.min(5, grams / serve));
  }

  let qty = 1;
  const digits = /^\s*(\d+(?:\.\d+)?)\s*(?:x\b|pcs?\b|pieces?\b|servings?\b|slices?\b|cups?\b|scoops?\b)?\s*/i.exec(item);
  if (digits) {
    qty = Number(digits[1]);
    // A cup of something dense is several servings of it; a cup of rice is one.
    if (hit && hit.cup && /\bcups?\b/i.test(item)) qty *= hit.cup;
  } else {
    const word = /^\s*(one|two|three|four|five|six|seven|eight|dozen)\b/i.exec(item);
    if (word) qty = NUMBER_WORDS[word[1].toLowerCase()];
  }
  if (!Number.isFinite(qty) || qty <= 0) qty = 1;
  qty = Math.min(qty, 20);

  const size = SIZE_WORDS.find((s) => s.re.test(item));
  return qty * (size ? size.mult : 1);
}

// Anything too short or without a letter in it is punctuation, not food.
const isItemish = (s) => s.trim().length >= 3 && /[a-z]/i.test(s);

/* The activity is a label — "Breakfast", "Lunch out" — and the note is the
   answer to what was in it. Stripping the label matters for more than tidiness:
   glued to the front of the note it stops the first item starting with its own
   count, and "Breakfast 2 eggs" quietly becomes one egg. */
const MEAL_LABEL = /^\s*(?:breakfast|brunch|lunch|dinner|supper|snack|merienda|meal|food|ate|eating|almusal|tanghalian|hapunan)\b[\s:–-]*/i;

function nutritionFor(rows) {
  let kcal = 0, p = 0, c = 0, f = 0, read = 0, guessed = 0, items = 0, unread = 0;

  rows.forEach((row) => {
    /* Split each source on its own rather than joining them first, so a note
       beginning "2 eggs" still begins with its count. */
    const parts = [row.activity || '', row.note || '']
      .map((s) => s.toLowerCase().replace(MEAL_LABEL, ''))
      .flatMap((s) => s.split(ITEM_SPLIT))
      .filter(isItemish);

    const found = [];
    const missed = [];
    parts.forEach((part) => {
      const hit = SERVINGS.find((s) => s.re.test(part));
      if (hit) found.push({ hit, portion: portionOf(part, hit) });
      else missed.push(part);
    });

    /* Nothing recognised at all means the line describes a meal we cannot read
       — "lunch out" — and that is worth a meal, not a handful of items. Charging
       UNKNOWN_ITEM per word there would badly understate it. */
    if (!found.length) {
      guessed += 1;
      kcal += UNKNOWN_MEAL.kcal; p += UNKNOWN_MEAL.p; c += UNKNOWN_MEAL.c; f += UNKNOWN_MEAL.f;
      return;
    }

    read += 1;
    found.forEach(({ hit, portion }) => {
      items += 1;
      kcal += hit.kcal * portion; p += hit.p * portion;
      c += hit.c * portion; f += hit.f * portion;
    });
    // Recognised company makes an unread neighbour a side, not a mystery meal.
    missed.forEach(() => {
      unread += 1; items += 1;
      kcal += UNKNOWN_ITEM.kcal; p += UNKNOWN_ITEM.p; c += UNKNOWN_ITEM.c; f += UNKNOWN_ITEM.f;
    });
  });

  return {
    kcal: Math.round(kcal), protein: Math.round(p), carbs: Math.round(c), fat: Math.round(f),
    read, guessed, items, unread
  };
}

/* ── sleep ──
   Sleep is tracked time that no activity-worded pillar should claim, so it gets
   a reading of its own. The window most guidance settles on is seven to nine
   hours; under six the losses show up as attention and appetite well before
   they are felt as tiredness, and consistently over ten tracks with disrupted
   rest rather than abundant rest. */
const SLEEP_RE = /sleep|nap|siesta/;
const isSleepRow = (row) => SLEEP_RE.test(`${row.activity || ''} ${row.category || ''}`.toLowerCase());

const SLEEP_LOW = 6 * 60, SLEEP_GOOD = 7 * 60, SLEEP_LONG = 9 * 60 + 30;

/* Bedtimes are circular — 11PM and 1AM are two hours apart, not twenty-two.
   Anything before noon is read as the small hours of the following night. */
const nightMinute = (from) => (from < 720 ? from + 1440 : from);

function sleepReport(entries) {
  const rows = entries.filter(isSleepRow).filter((e) => span(e) > 0);
  if (!rows.length) return { nights: 0 };

  /* The longest stretch on a date is the night; anything shorter is a nap.
     Summing the two would let three naps read as a good night. */
  const byDate = {};
  rows.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const nights = Object.keys(byDate).sort().map((date) => {
    const list = byDate[date].slice().sort((a, b) => span(b) - span(a));
    return {
      date,
      main: list[0],
      mins: span(list[0]),
      napMins: list.slice(1).reduce((a, e) => a + span(e), 0)
    };
  });

  const avg = Math.round(nights.reduce((a, n) => a + n.mins, 0) / nights.length);
  const napTotal = nights.reduce((a, n) => a + n.napMins, 0);
  const status = avg >= SLEEP_LONG ? 'long'
    : avg >= SLEEP_GOOD ? 'strong'
      : avg >= SLEEP_LOW ? 'steady' : 'thin';

  /* How much the bedtime moved across the window. Under an hour is a routine;
     past two, the body never learns when the night starts. */
  const beds = nights.map((n) => nightMinute(n.main.from));
  const drift = nights.length > 1 ? Math.max(...beds) - Math.min(...beds) : 0;

  return { nights: nights.length, list: nights, avg, napTotal, status, drift };
}

/* `t` arrives already phrased — a bare duration for one night, "X a night
   across N nights" for a window — because "6h a night" is a strange way to
   describe the only night there was. */
const SLEEP_NOTES = {
  thin: (t) => `${t}. Under six hours the cost lands on attention and appetite before it is felt as tiredness, which is exactly what makes a short week easy to mistake for a busy one.`,
  steady: (t) => `${t} — close to enough. The last hour is usually the cheapest to find: a fixed wake time moves it more reliably than an earlier bedtime, because the bedtime follows once the mornings are fixed.`,
  strong: (t) => `${t}, inside the range most guidance settles on. From here consistency matters more than the total — the same wake time every day steadies mood and appetite better than a long weekend catch-up does.`,
  long: (t) => `${t}. Consistently long sleep is worth a second look: it tracks with disrupted rest and with low mood more often than it tracks with being well rested.`
};

/* Everything the sleep block prints, worked out once. */
function sleepReading(entries, days) {
  const r = sleepReport(entries);
  if (!r.nights) {
    return {
      nights: 0,
      headline: 'No sleep logged in this stretch.',
      advice: 'Start the timer when you turn in and stop it when you wake — a stretch that runs past midnight is counted against the morning you wake up, so it lands on the right day.'
    };
  }

  const multi = r.nights > 1;
  const headline = SLEEP_NOTES[r.status](
    multi ? `${durShort(r.avg)} a night across ${r.nights} nights` : durShort(r.avg));

  const parts = [];
  if (!multi) {
    const n = r.list[0];
    parts.push(`${clock12(n.main.from)} to ${clock12(n.main.to)}.`);
  }
  if (r.napTotal) parts.push(`${durShort(r.napTotal)} of that was naps, counted separately from the night.`);
  if (multi && r.drift >= 120) {
    parts.push(`Your bedtime moved by ${durShort(r.drift)} across the window. A body reads a moving bedtime as a moving night, and the first hour of sleep is the one that suffers.`);
  } else if (multi && r.drift < 60) {
    // "all week" would be a claim about nights that were never logged.
    parts.push('Bedtime held within the hour across the nights you logged — that steadiness is worth as much as the total.');
  }
  if (multi && r.nights < days) {
    parts.push(`${r.nights} of ${days} nights logged, so this is an average of what you recorded rather than of the whole stretch.`);
  }

  return { nights: r.nights, headline, detail: parts.join(' '), advice: '' };
}

/* MET values — energy cost relative to sitting still. Burn is
   MET × kilograms × hours, the standard approximation. */
const METS = [
  { re: /jump ?rope|skipping rope/, met: 12.0 },
  { re: /boxing|muay thai|martial art|karate|taekwondo|\bmma\b|jiu-?jitsu/, met: 10.0 },
  { re: /run|jog|sprint/, met: 9.8 },
  { re: /climb|bouldering/, met: 8.0 },
  { re: /crossfit|hiit|zumba|circuit/, met: 8.0 },
  { re: /treadmill/, met: 7.0 },
  { re: /swim/, met: 7.0 },
  { re: /row(?:ing|er)?\b/, met: 7.0 },
  { re: /bike|cycl|spin/, met: 7.5 },
  { re: /basketball|football|soccer|badminton|tennis|padel|pickleball|volleyball|sport/, met: 6.5 },
  { re: /hike/, met: 6.0 },
  { re: /dance|dancing|aerobics/, met: 5.5 },
  { re: /elliptical|cross ?trainer|stair|calisthenic|push-?ups?|sit-?ups?|planks?/, met: 5.0 },
  { re: /gym|weights|lift|strength/, met: 5.0 },
  { re: /pilates|stretch/, met: 3.0 },
  { re: /yoga/, met: 2.5 },
  { re: /walk|lakad|stroll/, met: 3.5 },
  // Floor for anything filed as exercise but not named: the category is in the
  // text being matched, so a Workout entry is never worth nothing.
  { re: /workout|exercise|cardio|training/, met: 5.0 }
];

const DEFAULT_WEIGHT_KG = 70;

/* What a single entry did to the day's calorie ledger, for the chip on its
   card. Exercise is checked first: METS only ever matches activity verbs, so a
   meal cannot be mistaken for a workout, but an entry naming both should read
   as the effort it was. Returns nothing for the great majority of entries,
   which are neither. */
function entryEnergy(e) {
  const mins = span(e);
  if (!mins) return null;

  const text = `${e.activity || ''} ${e.category || ''} ${e.note || ''}`.toLowerCase();
  const met = METS.find((m) => m.re.test(text));
  if (met) {
    const kg = Number(state.weightKg) || DEFAULT_WEIGHT_KG;
    const kcal = Math.round(met.met * kg * (mins / 60));
    return kcal ? { kind: 'burn', kcal, label: `~${kcal.toLocaleString('en-US')} kcal burned` } : null;
  }

  if (isFoodRow(e)) {
    const kcal = nutritionFor([e]).kcal;
    return kcal ? { kind: 'food', kcal, label: `~${kcal.toLocaleString('en-US')} kcal eaten` } : null;
  }
  return null;
}

/* Resting burn — what the body spends doing nothing. Proper formulae want
   height, age and sex; from weight alone about 22 kcal per kilogram per day is
   the usual midpoint, good to roughly ±25%. Reported on its own rather than
   folded into the workout figure: at ~1,900 a day it would swamp both sides of
   the comparison and leave it meaningless. */
const KCAL_PER_KG_PER_DAY = 22;

/* Steps, priced as the walking they were.
   A hundred steps a minute is the usual cadence figure, and walking is 3.5
   METs — the same rate the entry above it would be charged at, so a walk you
   logged and a walk your phone counted cost the same. */
const STEPS_PER_MINUTE = 100;
const stepsKcal = (steps, weightKg) => {
  const n = Number(steps) || 0;
  if (n <= 0) return 0;
  const kg = Number(weightKg) || DEFAULT_WEIGHT_KG;
  return Math.round(3.5 * kg * (n / STEPS_PER_MINUTE / 60));
};

/* Steps recorded across a set of dates. */
function stepsIn(dates) {
  return dates.reduce((a, d) => a + (Number(state.steps[d]) || 0), 0);
}

function burnFor(entries, weightKg, days, dates) {
  const kg = Number(weightKg) || DEFAULT_WEIGHT_KG;
  // Named for what it is. It was `span`, which now shadowed the entry-length
  // helper of that name and made every burn read as zero.
  const dayCount = Math.max(1, days || 1);
  const effMins = effective(resolveSpans(entries));
  let kcal = 0, minutes = 0;
  entries.forEach((e) => {
    const text = `${e.activity || ''} ${e.category || ''} ${e.note || ''}`.toLowerCase();
    const hit = METS.find((m) => m.re.test(text));
    if (!hit) return;
    const mins = effMins(e);
    if (!mins) return;
    minutes += mins;
    kcal += hit.met * kg * (mins / 60);
  });
  /* Steps join the workout figure rather than standing beside it: they are
     movement that burned energy, and a second dial for them would split one
     reading into two that each look small. */
  const steps = dates ? stepsIn(dates) : 0;
  const fromSteps = stepsKcal(steps, weightKg);

  return {
    kcal: Math.round(kcal) + fromSteps,
    minutes,
    steps,
    fromSteps,
    restKcal: Math.round(KCAL_PER_KG_PER_DAY * kg * dayCount),
    days: dayCount,
    assumedWeight: !weightKg
  };
}

function foodReport(entries, money, days) {
  const rows = entries.filter(isFoodRow).concat(money.filter(isFoodRow));
  const withNotes = rows.filter((r) => (r.note || '').trim());
  const text = rows.map((r) => `${r.activity || ''} ${r.note || ''}`).join(' ').toLowerCase();
  const found = FOOD_GROUPS.filter((g) => g.re.test(text));
  const list = (arr) => arr.map((g) => g.label).join(', ').replace(/, ([^,]*)$/, ' and $1');

  const good = found.filter((g) => g.good);
  const risk = found.filter((g) => g.risk);
  const watch = found.filter((g) => g.watch);
  const per = days > 1 ? ` across ${days} days` : '';

  if (!rows.length) {
    return {
      meals: 0,
      observation: `No meals logged${per}. Food is the easiest thing to eat without noticing, and the hardest to remember accurately a week later — logging even roughly is what makes any of this readable.`,
      advice: 'Log a meal or two and answer the “What did you eat?” question. Two or three days is enough for a pattern to show.',
      nutrition: '', kcal: 0,
      hasFindings: false
    };
  }

  if (!withNotes.length) {
    return {
      meals: rows.length,
      observation: `${rows.length} food ${rows.length === 1 ? 'entry' : 'entries'} logged${per}, but none say what was in them. The timing is useful on its own — long gaps and late meals both show up here — though the contents are where the useful part lives.`,
      advice: 'Next time the “What did you eat?” box appears, a few words is plenty — “chicken, rice, salad” already tells you something a month from now.',
      nutrition: '', kcal: 0,
      hasFindings: false
    };
  }

  const parts = [`${rows.length} food ${rows.length === 1 ? 'entry' : 'entries'} logged${per}, ${withNotes.length} with details.`];
  if (good.length) parts.push(`Working for you: ${list(good)}.`);
  if (risk.length) parts.push(`Worth watching: ${list(risk)} — regular rather than occasional, these are what tend to move weight, blood pressure and blood sugar.`);
  if (!risk.length && good.length) parts.push('Nothing logged stands out as a concern.');
  if (watch.length) parts.push(`${list(watch).replace(/^./, (c) => c.toUpperCase())} also appears; worth noting how it sits against your sleep.`);
  if (!good.length && !risk.length) parts.push('Not enough detail yet to read the balance.');

  const advice = risk.length
    ? `Swapping one ${risk[0].label.replace(/ or .*/, '')} occasion a week for something cooked at home is the smallest change that tends to hold. General guidance only — anything specific to you, especially with a medical condition or medication, belongs with your doctor.`
    : `Keep the pattern and keep logging it. General guidance only — for anything specific to you, your doctor is the right person to ask.`;

  const n = nutritionFor(rows);
  /* What would be sent for an AI estimate, and what the cache is keyed on. Only
     the food itself — no dates, no amounts, nothing identifying. */
  const detail = withNotes.map((r) => `${r.activity || ''}: ${r.note || ''}`.trim()).join('\n');
  const perDay = days > 1 ? ` (about ${Math.round(n.kcal / days)} a day)` : '';
  /* Both kinds of gap are named: a meal that said nothing at all, and an item
     inside a readable meal that is not in the table. Saying so is what stops
     the figure being trusted more than it deserves. */
  const gaps = [];
  if (n.guessed) gaps.push(`${n.guessed} ${n.guessed === 1 ? 'entry' : 'entries'} too vague to read`);
  if (n.unread) gaps.push(`${n.unread} ${n.unread === 1 ? 'item' : 'items'} not in the table`);
  const nutrition = `Roughly ${n.kcal.toLocaleString('en-US')} kcal${perDay} — around ${n.protein}g protein, ${n.carbs}g carbs, ${n.fat}g fat. Estimated from what you wrote${gaps.length ? `, with ${gaps.join(' and ')}` : ''}.`;

  return {
    meals: rows.length,
    observation: fitSentences(parts, 300),
    advice: clamp(advice, 300),
    nutrition: clamp(nutrition, 300),
    kcal: n.kcal,
    local: { kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat },
    detail,
    key: detail ? textKey(detail) : '',
    hasFindings: true
  };
}

function dimensionReadings(wb, days) {
  const d = Math.max(1, days);
  return DIMENSIONS.map((dim) => {
    const total = wb.mins[dim.key];
    const perDay = total / d;
    const ratio = perDay / TARGETS[dim.key];
    const status = ratio >= 1 ? 'strong' : ratio >= .5 ? 'steady' : total > 0 ? 'thin' : 'none';
    const aside = d > 1 && total > 0 ? ` (about ${durShort(Math.round(perDay))} a day)` : '';
    return {
      key: dim.key, label: dim.label, status, ratio,
      // The meter is capped; `ratio` stays raw so overload is still detectable.
      pct: Math.max(0, Math.min(100, Math.round(ratio * 100))),
      note: clamp(NOTES[dim.key][status](durShort(Math.round(total)), aside), 300),
      total: Math.round(total),
      entries: wb.parts[dim.key] || []
    };
  });
}

/* Each suggestion carries its own short label and opening line so it can be
   read as a card rather than a bullet — the label is what makes a row of them
   scannable, and keeping it beside the rule means a rule added later cannot
   arrive without one. */
function adviceFor(wb, readings, days) {
  const out = [];
  const r = (k) => readings.find((x) => x.key === k);
  const d = Math.max(1, days);
  const low = (k) => r(k).status === 'thin' || r(k).status === 'none';
  const tip = (key, label, lead, text) => out.push({ key, label, lead, text });

  if (low('physical')) tip('move', 'Movement', 'Put movement in most days',
    'Twenty to thirty minutes, and a brisk walk qualifies. It is the cheapest change here and the one that moves sleep, mood and energy together rather than one at a time.');
  if (wb.tracked && wb.still > wb.tracked * .35 && wb.still / d > 90) tip('still', 'Stillness', 'Break up the sitting',
    `${durShort(Math.round(wb.still))} went to screens and sitting. Breaking that up matters as much as its total: standing every half hour or so counts for more than one long session later.`);
  if (low('emotional')) tip('people', 'People', 'Make time for others',
    'One call or shared meal does more for how a week is remembered than another evening alone with a screen, and it is easier to schedule than to feel like doing.');
  if (r('mental').ratio > 3) tip('breaks', 'Recovery', 'Take the breaks',
    'That is a heavy concentration load. Breaks are not lost time — attention recovers in them, and work done past the point of recovery usually needs redoing.');
  if (r('spiritual').status === 'none') tip('quiet', 'Quiet corner', 'Embrace stillness',
    'Nothing quiet logged. Ten unhurried minutes — prayer, journalling, sitting without a screen — gives the rest of the day somewhere to settle before the next thing starts.');
  if (wb.tracked && wb.vague > wb.tracked * .5) tip('notes', 'Detail', 'Sharpen your notes',
    'Much of what you logged does not describe itself. More specific activity names would sharpen every one of these notes.');

  /* Capped as a block rather than per line: the highest-priority suggestions
     are pushed first, so trimming from the end drops the least important. */
  const kept = [];
  let budget = 600;
  for (const t of out) {
    if (t.text.length + 1 > budget) break;
    kept.push(t);
    budget -= t.text.length + 1;
  }
  return kept;
}

/* ─────────────────────────── financial insights ───────────────────────────

   Everything here is read from what was logged and nothing else: a money row
   carries no budget and no merchant, so every figure comes from `in`, `out`,
   the purpose and the activity text. The wording follows the wellbeing notes —
   observations about your own spending, never a view on a product, a provider
   or an investment.

   Two weeks is the window this was built for: long enough that a single big
   purchase stops dominating the picture, short enough to still describe the
   habit you are in now. It renders at any range, and says so when the window is
   too short to carry a trend. */

/* Essentials are the hard-to-move ones; discretionary is where a suggestion can
   actually land. Matched on purpose and activity together, so "Grab to office"
   filed under a vague purpose still reads as commuting. First match wins, so
   the essential list is deliberately first — "insurance premium" should count
   as a bill, not as an investment. */
const SPEND_KINDS = [
  { kind: 'essential', re: /grocer|palengke|market|supermarket|utilit|electric|meralco|water bill|\bbills?\b|rent|tuition|school fee|medicine|pharmacy|drugstore|doctor|clinic|hospital|insurance|petrol|diesel|fuel|gasolin|commut|fare|jeep|tricycle|\bbus\b|train|\bmrt\b|\blrt\b|toll|parking|internet|load|electricity/ },
  { kind: 'discretionary', re: /eat ?out|restaurant|dine|dining|takeout|take-out|food ?delivery|grab ?food|foodpanda|jollibee|mcdo|starbucks|coffee|milk ?tea|boba|snack|dessert|movie|cinema|netflix|spotify|subscription|gaming|shopping|shopee|lazada|clothes|apparel|shoes|\bbag\b|gadget|laptop|birthday|gift|party|night out|beer|alcohol|drinks|lotto|\bbet\b/ },
  { kind: 'investment', re: /savings|invest|stock|mutual fund|uitf|time deposit|emergency fund|pag-?ibig|\bsss\b|house improvement|repair|renovat|appliance|tools|equipment|course|training|certification|books?/ }
];

const spendKind = (row) => {
  const hay = `${row.activity} ${row.purpose}`.toLowerCase();
  const hit = SPEND_KINDS.find((k) => k.re.test(hay));
  return hit ? hit.kind : 'other';
};

const pct = (n) => `${Math.round(n * 100)}%`;

/* `list` is the selected window, `prevList` the window of equal length directly
   before it — the only source of a trend. `days` is the window length rather
   than the number of days with entries: a day you spent nothing on is a real
   zero, and averaging it away would flatter the per-day figure. Coverage is
   reported separately so a thin log is visible rather than hidden. */
function financialInsights(list, prevList, days) {
  const spend = list.filter((e) => (Number(e.out) || 0) > 0);
  const outSum = spend.reduce((a, e) => a + Number(e.out), 0);
  const inSum = list.reduce((a, e) => a + (Number(e.in) || 0), 0);
  if (!outSum && !inSum) return null;

  const d = Math.max(1, days);
  const perDay = outSum / d;
  const net = inSum - outSum;
  const rate = inSum > 0 ? net / inSum : null;

  const byPurpose = totalsByPurpose(list);
  const topPurpose = byPurpose[0] || null;
  const topShare = outSum ? (topPurpose ? topPurpose.mins / outSum : 0) : 0;

  const kinds = { essential: 0, discretionary: 0, investment: 0, other: 0 };
  spend.forEach((e) => { kinds[spendKind(e)] += Number(e.out); });
  const discShare = outSum ? kinds.discretionary / outSum : 0;

  const biggest = spend.slice().sort((a, b) => b.out - a.out)[0] || null;
  const bigShare = biggest && outSum ? biggest.out / outSum : 0;

  const spendDates = new Set(spend.map((e) => e.date));
  const coverage = spendDates.size;

  // Most-repeated purpose — the drip that adds up without ever feeling like a
  // decision. Only interesting once it happens more than a handful of times.
  const repeat = byPurpose.slice().sort((a, b) => b.count - a.count)[0] || null;

  const prevOut = prevList.reduce((a, e) => a + (Number(e.out) || 0), 0);
  const trend = prevOut > 0 ? (outSum - prevOut) / prevOut : null;

  /* ── observations: what the window says ── */
  const obs = [];
  if (outSum) {
    obs.push(`${amount(outSum)} went out over ${d} ${d === 1 ? 'day' : 'days'} — about ${amount(perDay)} a day${topPurpose ? `, led by ${topPurpose.name.toLowerCase()}` : ''}.`);
  }
  if (inSum && outSum) {
    obs.push(net >= 0
      ? `${amount(inSum)} came in and you kept ${amount(net)} of it — a ${pct(rate)} margin.`
      : `${amount(inSum)} came in against ${amount(outSum)} out, so you were ${amount(Math.abs(net))} short over the window.`);
  } else if (outSum && !inSum) {
    obs.push('No income logged in this window, so the figures below describe spending on its own rather than what it is measured against.');
  } else if (inSum && !outSum) {
    obs.push(`${amount(inSum)} came in and nothing went out. Either it was a genuinely quiet fortnight or the spending has not been logged — the difference matters, because only one of them is worth repeating.`);
  }
  if (topPurpose && topShare >= .3 && byPurpose.length > 1) {
    obs.push(`${topPurpose.name} alone took ${pct(topShare)} of everything spent, across ${topPurpose.count} ${topPurpose.count === 1 ? 'entry' : 'entries'}.`);
  }
  if (kinds.discretionary > 0 && kinds.essential > 0) {
    obs.push(`Roughly ${pct(discShare)} of it was discretionary against ${pct(kinds.essential / outSum)} on essentials.`);
  }
  if (trend !== null && Math.abs(trend) >= .1) {
    obs.push(trend > 0
      ? `Spending is up ${pct(trend)} on the ${d} days before this one (${amount(prevOut)} then, ${amount(outSum)} now).`
      : `Spending is down ${pct(Math.abs(trend))} on the ${d} days before this one (${amount(prevOut)} then, ${amount(outSum)} now).`);
  }
  if (biggest && bigShare >= .2 && spend.length > 2) {
    obs.push(`The single biggest was ${biggest.activity} at ${amount(biggest.out)} — ${pct(bigShare)} of the window on its own.`);
  }

  /* ── recommendations: only what is worth saying ── */
  const rec = [];
  if (inSum > 0 && net < 0) {
    rec.push(`You spent ${amount(Math.abs(net))} more than came in. The fastest read is the largest purpose above — trimming one recurring item there moves more than cutting several small ones.`);
  } else if (rate !== null && rate < .1 && net >= 0) {
    rec.push(`Only ${pct(rate)} of what came in stayed. Setting aside a fixed amount the day income lands, rather than whatever survives to the end, is the one change that reliably holds.`);
  }
  if (discShare >= .35 && kinds.discretionary > 0) {
    rec.push(`${amount(kinds.discretionary)} went to discretionary spending — ${pct(discShare)} of the window. That is the part you can actually move without rearranging your life.`);
  }
  if (repeat && repeat.count >= 5) {
    rec.push(`${repeat.name} came up ${repeat.count} times, averaging ${amount(repeat.mins / repeat.count)}. Small repeats are easier to cut by frequency than by size — one fewer a week beats trying to spend less each time.`);
  }
  if (trend !== null && trend >= .2) {
    rec.push(`Spending is climbing period on period. Worth checking whether that is one unusual purchase or a new baseline, because the two call for very different responses.`);
  }
  if (topShare >= .45 && byPurpose.length > 2) {
    rec.push(`Nearly half of everything sits in one purpose. That concentration is fine if it is deliberate — worth a look if it is not.`);
  }
  if (!inSum && outSum) {
    rec.push('Logging what comes in as well as what goes out is what turns this from a spending list into a picture of whether the month works.');
  }
  if (coverage && coverage < d / 2 && d > 1) {
    rec.push(`Only ${coverage} of ${d} days ${coverage === 1 ? 'carries an entry' : 'carry entries'}. The averages above are diluted by the gaps — logging daily, even a zero, sharpens every figure here.`);
  }

  // Same block cap as the wellbeing advice: highest priority pushed first, so
  // trimming from the end drops the least important line.
  const kept = [];
  let budget = 700;
  for (const line of rec) {
    if (line.length + 1 > budget) break;
    kept.push(line);
    budget -= line.length + 1;
  }

  return {
    headline: outSum
      ? `${amount(perDay)} a day across ${d} ${d === 1 ? 'day' : 'days'}`
      : `${amount(inSum)} in, nothing spent`,
    perDay: amount(perDay),
    outLabel: amount(outSum),
    inLabel: amount(inSum),
    netLabel: signed(net),
    netUp: net >= 0,
    /* "Kept" only means anything when something was kept. Overspending is
       already carried by Net in the alert colour, and a rate of −800% here
       reads as a broken figure rather than a bad fortnight. */
    rateLabel: rate === null || rate < 0 ? '—' : pct(rate),
    trendLabel: trend === null ? '' : `${trend > 0 ? '+' : '−'}${pct(Math.abs(trend))}`,
    trendUp: trend !== null && trend > 0,
    coverageLabel: `${coverage} of ${d} ${d === 1 ? 'day' : 'days'} logged`,
    days: d,
    observations: obs,
    advice: kept
  };
}

/* Everything the templates read, computed once per render. */
function compute() {
  const s = state;
  const now = new Date();
  const isMoney = s.app === 'money';
  const fmtLong = isMoney ? amount : dur;
  const fmtShort = isMoney ? amount : durShort;

  const dayList = s.entries.filter((e) => e.date === s.selectedDate).sort((a, b) => a.from - b.from);
  const mDayList = s.money.filter((e) => e.date === s.selectedDate);
  const mRangeList = moneyRangeEntries();

  const inSum = mRangeList.reduce((a, e) => a + (Number(e.in) || 0), 0);
  const outSum = mRangeList.reduce((a, e) => a + (Number(e.out) || 0), 0);

  /* The equal-length window sitting immediately before this one. It is the only
     thing the insight block can read a trend against, and it is computed here
     rather than inside the insight so the window arithmetic stays in one file
     region with `withinRange`. */
  const winDays = rangeDays();
  const prevEndDate = new Date(windowStart(s.selectedDate, winDays) + 'T00:00:00');
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevEnd = iso(prevEndDate);
  const prevStart = windowStart(prevEnd, winDays);
  const mPrevList = s.money.filter((e) => e.date >= prevStart && e.date <= prevEnd);

  const totals = isMoney ? totalsByPurpose(mRangeList) : totalsByCategory(rangeEntries());
  const total = totals.reduce((a, b) => a + b.mins, 0);

  const C = 2 * Math.PI * 72;
  let acc = 0;
  const slices = totals.map((t) => {
    const frac = total ? t.mins / total : 0;
    const seg = { name: t.name, color: t.color, dash: `${(frac * C).toFixed(2)} ${C.toFixed(2)}`, offset: (-acc * C).toFixed(2), pct: `${Math.round(frac * 100)}%` };
    acc += frac; return seg;
  });

  /* Drill-down. `state.focus` is only a name, so it is re-validated against the
     totals every render — a focus that falls outside the current range, or that
     belongs to the other tracker, simply stops applying. */
  const focusItem = totals.find((t) => t.name === s.focus) || null;
  const focusSource = focusItem
    ? (isMoney
      ? mRangeList.filter((e) => e.purpose === focusItem.name && e.out > 0)
      : rangeEntries().filter((e) => e.category === focusItem.name))
    : [];
  /* Resolved across the whole range rather than across the focused subset —
     the minutes a grocery run takes off a deep-work block are settled between
     the two of them, and filtering to one category first would hide the
     other. The list has to add up to the slice it was opened from. */
  const focusMins = isMoney ? null : effective(resolveSpans(rangeEntries()));
  const focusList = focusSource
    .slice()
    .sort((a, b) => (a.date === b.date ? (isMoney ? 0 : a.from - b.from) : (a.date < b.date ? 1 : -1)))
    .map((e) => {
      const counted = isMoney ? 0 : focusMins(e);
      const logged = span(e);
      return {
        date: dayLabel(e.date),
        activity: e.activity,
        meta: isMoney ? ''
          // Says so when another entry claimed part of this one, rather than
          // printing a figure that quietly disagrees with the clock beside it.
          : `${clock12(e.from)} – ${clock12(e.to)}${counted < logged ? ` · ${durShort(logged)} logged` : ''}`,
        value: isMoney ? amount(e.out) : durShort(counted)
      };
    });

  const top = totals[0] ? totals[0].mins : 1;
  const dayTracked = (() => { const m = effective(resolveSpans(dayList)); return dayList.reduce((a, e) => a + m(e), 0); })();
  const untrackedMins = Math.max(0, 960 - dayTracked);

  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(s.selectedDate + 'T00:00:00'); d.setDate(d.getDate() - i);
    if (s.entries.some((e) => e.date === iso(d))) streak++; else break;
  }

  const formFrom = parseHm(s.form.from), formTo = parseHm(s.form.to);

  /* ── the report's activity list ──
     Every entry in the selected range, grouped by day and totalled per day.
     Money pulls the whole range rather than spend-only, so income shows up too;
     the summary table above it stays spend-only, as it always was. */
  const reportSource = isMoney ? mRangeList : rangeEntries();
  const byDate = {};
  reportSource.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const reportDays = Object.keys(byDate).sort().map((d) => {
    const list = byDate[d].slice().sort((a, b) => (isMoney ? 0 : a.from - b.from));
    const dayMins = effective(resolveSpans(list));
    const outSumDay = list.reduce((a, e) => a + (isMoney ? (Number(e.out) || 0) : dayMins(e)), 0);
    const inSumDay = isMoney ? list.reduce((a, e) => a + (Number(e.in) || 0), 0) : 0;
    return {
      label: new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      totalLabel: isMoney ? amount(outSumDay) : dur(outSumDay),
      inLabel: inSumDay ? amount(inSumDay) : '',
      rows: list.map((e) => ({
        activity: e.activity,
        note: e.note || '',
        name: isMoney ? e.purpose : e.category,
        color: isMoney ? purposeColor(e.purpose) : colorOf(e.category),
        when: isMoney ? '' : `${clock12(e.from)} – ${clock12(e.to)}`,
        out: isMoney ? (Number(e.out) ? amount(e.out) : '—') : durShort(span(e)),
        in: isMoney ? (Number(e.in) ? amount(e.in) : '—') : ''
      }))
    };
  });

  /* ── today, live ──
     Clipped at the current minute so the card describes hours that have
     actually happened. An entry logged ahead of the clock contributes only the
     part of it already behind us. */
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayList = s.entries
    .filter((e) => e.date === todayIso)
    /* An entry that wrapped began last night, so only the part after midnight
       counts towards today's reading; the rest belongs to yesterday evening. */
    .map((e) => Object.assign({}, e, wraps(e) ? { from: 0, to: Math.min(e.to, nowMins) } : { to: Math.min(e.to, nowMins) }))
    .filter((e) => e.to > e.from);
  const todayWb = wellbeing(todayList, { count: stepsIn([todayIso]), date: todayIso, days: 1 });
  const todayTop = totalsByCategory(todayList)[0];
  const partOfDay = nowMins < 720 ? 'Morning' : nowMins < 1020 ? 'Afternoon' : nowMins < 1260 ? 'Evening' : 'Late';
  /* The window has to be the one the entries actually sit in. "Since 6 AM"
     assumed nothing was ever logged before then — true until sleep could run
     past midnight, after which a night ending at 5:45 reported six hours logged
     out of a ninety-minute window. When something starts before six, the day is
     measured from midnight and says so. */
  const dayFrom = todayList.reduce((m, e) => Math.min(m, e.from), 360);
  const dayWindow = Math.max(0, nowMins - dayFrom);
  const windowLabel = dayFrom < 360 ? 'so far today' : 'since 6 AM';

  const todayHeadline = dayWindow < 30
    ? 'The day is barely under way — nothing to read into yet.'
    : !todayWb.tracked
      ? `Nothing logged yet across the ${durShort(dayWindow)} ${windowLabel}.`
      : `${durShort(todayWb.tracked)} logged of the ${durShort(dayWindow)} ${windowLabel}${todayTop ? `, most of it on ${todayTop.name.toLowerCase()}` : ''}.`;

  /* ── the days behind it ──
     The range window with today taken out, so the look-back is only ever about
     days that actually finished. When the range is a single day and that day is
     today there is nothing to look back on, so it falls back to yesterday. */
  let pastList = withinRange(s.entries).filter((e) => e.date !== todayIso);
  let pastFallback = false;
  if (!pastList.length && s.range === 'day' && s.selectedDate === todayIso) {
    const y = new Date(todayIso + 'T00:00:00'); y.setDate(y.getDate() - 1);
    pastList = s.entries.filter((e) => e.date === iso(y));
    pastFallback = true;
  }
  const pastDates = Array.from(new Set(pastList.map((e) => e.date))).sort();

  /* Every finished day the window covers, not only the ones carrying an entry.
     A step count can be the only thing recorded against a day, and that day
     still has to be counted. */
  const pastSpan = (() => {
    const out = [];
    for (let i = 0; i < rangeDays(); i++) {
      const d = new Date(s.selectedDate + 'T00:00:00');
      d.setDate(d.getDate() - i);
      const key = iso(d);
      if (key !== todayIso) out.push(key);
    }
    // A one-day window sitting on today has nothing finished in it, and the
    // section falls back to yesterday — so the steps do too.
    if (!out.length) {
      const y = new Date(todayIso + 'T00:00:00'); y.setDate(y.getDate() - 1);
      out.push(iso(y));
    }
    return out.sort();
  })();
  // Money logged on the same finished days, so the food read covers both trackers.
  const pastDateSet = new Set(pastDates);
  const pastMoney = s.money.filter((e) => pastDateSet.has(e.date));
  const pastWb = wellbeing(pastList, { count: stepsIn(pastSpan), date: pastSpan[pastSpan.length - 1], days: pastSpan.length });
  const pastTotals = totalsByCategory(pastList);
  const byDay = {};
  const pastMins = effective(resolveSpans(pastList));
  pastList.forEach((e) => { byDay[e.date] = (byDay[e.date] || 0) + pastMins(e); });
  const busiest = Object.keys(byDay).sort((a, b) => byDay[b] - byDay[a])[0];

  const pastLabel = !pastDates.length ? 'No finished days in this range yet'
    : pastDates.length === 1
      ? (pastFallback ? 'Yesterday · ' : '') + new Date(pastDates[0] + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
      : `${dayLabel(pastDates[0])} – ${dayLabel(pastDates[pastDates.length - 1])} · ${pastDates.length} days tracked`;

  return {
    isMoney, fmtLong, fmtShort, dayList, mDayList, mRangeList, inSum, outSum,
    totals, total, slices, top, dayTracked, untrackedMins, streak,

    geoLabel: s.geo ? `${s.geo} · auto` : 'Local time · auto',
    nowLabel: now.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    dayHeading: new Date(s.selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),

    clock: elapsedClock(),
    timerBtnLabel: s.timerStart ? 'Stop & save' : 'Start',
    /* A timer that survives reloads can also survive being forgotten, so it
       says when it started and speaks up once that gets implausible. */
    timerSince: s.timerStart
      ? `since ${new Date(s.timerStart).toLocaleString(undefined,
          iso(new Date(s.timerStart)) === todayIso
            ? { hour: 'numeric', minute: '2-digit' }
            : { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
      : '',
    timerStale: !!s.timerStart && (now - s.timerStart) > 12 * 60 * 60 * 1000,
    formDuration: formTo === formFrom ? 'set a time'
      : formTo > formFrom ? dur(formTo - formFrom)
      : `${dur(formTo + 1440 - formFrom)} · next day`,

    dayTotalLabel: dur(dayTracked),
    rangeTotal: fmtShort(total),
    rangeLabel: s.range === 'day' ? 'this day' : `last ${RANGE_DAYS[s.range] || 1} days`,
    leaderboard: totals.map((t) => ({ name: t.name, color: t.color, label: fmtShort(t.mins), width: `${Math.round((t.mins / top) * 100)}%` })),

    focusName: focusItem ? focusItem.name : null,
    focusColor: focusItem ? focusItem.color : null,
    focusPct: focusItem ? `${Math.round((focusItem.mins / (total || 1)) * 100)}%` : '',
    focusValue: focusItem ? fmtShort(focusItem.mins) : '',
    focusOpen: !!(focusItem && s.focusOpen),
    focusList,

    todayKicker: `${partOfDay} · ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
    todayHeadline,
    todayLive: liveLine(),
    todayReadings: dimensionReadings(todayWb, 1),
    todayAdvice: adviceFor(todayWb, dimensionReadings(todayWb, 1), 1),
    // Last night's sleep is dated today, so the raw entries are read rather
    // than todayList, which clips everything to the current minute.
    todaySleep: sleepReading(s.entries.filter((e) => e.date === todayIso), 1),
    todayFood: foodReport(todayList, s.money.filter((e) => e.date === todayIso), 1),
    todayBurn: burnFor(todayList, s.weightKg, 1, [todayIso]),
    todayEmpty: todayList.length === 0,

    pastLabel,
    pastHeadline: pastDates.length
      ? `${durShort(pastWb.tracked)} tracked across ${pastDates.length} ${pastDates.length === 1 ? 'day' : 'days'}${pastTotals[0] ? `, led by ${pastTotals[0].name.toLowerCase()}` : ''}.`
      : 'Nothing to look back on yet — the notes fill in as days finish.',
    // Only worth saying when there is more than one day to compare.
    pastBusiest: busiest && pastDates.length > 1 ? `Busiest day was ${dayLabel(busiest)} at ${durShort(byDay[busiest])}.` : '',
    // Every category, not a top three — the whole block already sits behind
    // the Read Full Report drawer, so there is room to be complete.
    pastTop: pastTotals.map((t) => ({
      name: t.name, color: t.color, label: durShort(t.mins),
      width: `${Math.round((t.mins / (pastWb.tracked || 1)) * 100)}%`,
      pct: `${Math.round((t.mins / (pastWb.tracked || 1)) * 100)}%`
    })),
    pastReadings: dimensionReadings(pastWb, pastDates.length),
    pastAdvice: adviceFor(pastWb, dimensionReadings(pastWb, pastDates.length), pastDates.length),
    pastSleep: sleepReading(pastList, pastSpan.length),
    pastFood: foodReport(pastList, pastMoney, Math.max(1, pastDates.length)),
    pastBurn: burnFor(pastList, s.weightKg, Math.max(1, pastDates.length), pastSpan),
    pastEmpty: pastDates.length === 0,

    untracked: durShort(untrackedMins),
    untrackedNote: untrackedMins > 240 ? 'A big slice of the day is unaccounted for.' : 'Nicely accounted for — keep it up.',
    streakLabel: `${streak} ${streak === 1 ? 'day' : 'days'}`,
    streakNote: streak >= 7 ? 'A full week of tracking. That is a habit now.' : 'Log something tomorrow to keep it alive.',

    moneyIn: amount(inSum),
    moneyOut: amount(outSum),
    moneyOutCount: mRangeList.filter((e) => e.out > 0).length,
    moneyNet: signed(inSum - outSum),
    netColor: inSum - outSum < 0 ? 'var(--color-text)' : 'var(--color-accent-700)',
    netNote: inSum - outSum < 0 ? 'Spending outran what came in.' : 'You kept some of it. Good.',

    moneyInsight: isMoney ? financialInsights(mRangeList, mPrevList, winDays) : null,
    // The block is built for a fortnight; anything else gets a one-tap way there.
    insightAtFortnight: s.range === 'fortnight',

    // The one finished day the lookback is showing, when it is showing one.
    pastSingleDate: pastSpan.length === 1 ? pastSpan[0] : null,

    reportRange: reportRangeLabel(),
    reportTitle: isMoney ? 'MONEY REPORT' : 'TIME REPORT',
    reportColLabel: isMoney ? 'Purpose' : 'Category',
    reportAmountLabel: isMoney ? 'Amount' : 'Time spent',
    reportFooterRowLabel: isMoney ? 'Money in' : 'Untracked',
    reportFooterRowValue: isMoney ? amount(inSum) : durShort(untrackedMins),
    reportHeadline: totals[0] ? `${totals[0].name} took the biggest share.` : 'Nothing tracked in this range yet.',
    reportNote: totals[0]
      ? `${fmtLong(totals[0].mins)} of ${fmtLong(total)} tracked — ${Math.round((totals[0].mins / (total || 1)) * 100)}% of everything you logged. ${totals.length} ${isMoney ? 'purposes' : 'categories'} in play.`
      : 'Add a few entries and the picture fills in.',
    reportRows: totals.map((t) => ({ name: t.name, color: t.color, count: t.count, time: fmtLong(t.mins), pct: `${Math.round((t.mins / (total || 1)) * 100)}%` })),

    reportDays,
    reportEntryCount: reportSource.length,

    /* The axis runs 6AM to 10PM, so an entry that wrapped shows as two pieces —
       the tail of the evening and the head of the morning — rather than as one
       bar drawn backwards, which is what a single clamped span produced. */
    timeline: dayList.flatMap((e) => {
      const pieces = wraps(e) ? [[e.from, 1440], [0, e.to]] : [[e.from, e.to]];
      return pieces.map(([s0, s1]) => {
        const a = Math.max(360, Math.min(1320, s0)), b = Math.max(360, Math.min(1320, s1));
        if (b <= a) return null;
        return { title: `${e.activity} · ${clock12(e.from)}`, color: colorOf(e.category), left: `${((a - 360) / 960 * 100).toFixed(2)}%`, width: `${Math.max(0.4, (b - a) / 960 * 100).toFixed(2)}%` };
      }).filter(Boolean);
    })
  };
}

/* The one genuinely real-time string: what is happening this second. Refreshed
   by the ticker between renders, so it stays current while you sit on the page. */
function liveLine() {
  if (state.timerStart) return `Running now · ${state.timerActivity.trim() || 'Untitled activity'} · ${elapsedClock()}`;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  // Only what the clock has actually reached — an entry logged ahead of now is
  // not "what is happening".
  const started = state.entries.filter((e) => e.date === todayIso && !wraps(e) && e.from <= nowMins);
  if (!started.length) return 'Nothing logged yet today.';
  const spanning = started.find((e) => e.to > nowMins);
  if (spanning) return `In progress · ${spanning.activity} · since ${clock12(spanning.from)}`;
  const sorted = started.slice().sort((a, b) => a.to - b.to);
  const last = sorted[sorted.length - 1];
  const gap = nowMins - last.to;
  return `Last logged · ${last.activity} · ended ${clock12(last.to)}${gap > 0 ? `, ${durShort(gap)} ago` : ''}`;
}

function elapsedClock() {
  const el = state.timerStart ? Math.floor((Date.now() - state.timerStart) / 1000) : 0;
  return `${pad(Math.floor(el / 3600))}:${pad(Math.floor(el / 60) % 60)}:${pad(el % 60)}`;
}

/* ─────────────────────────── style helpers ─────────────────────────── */

const chipStyle = (active, color) => `display:inline-flex;align-items:center;cursor:pointer;font-size:11px;padding:4px 12px;border-radius:999px;border:1px solid ${active ? color : 'var(--color-divider)'};background:${active ? color : 'transparent'};color:${active ? '#f2f2f3' : 'var(--color-neutral-800)'};font-family:var(--font-body);`;
const tabStyle = (active) => `padding:7px 16px;border-radius:999px;font-size:13px;cursor:pointer;border:0;font-family:var(--font-heading);font-weight:600;background:${active ? 'var(--color-accent)' : 'transparent'};color:${active ? 'var(--color-bg)' : 'var(--color-text)'};`;
// Sizing lives in the .timer-btn class so the breakpoints can widen it.
/* Running is a deeper shade of the same green, so the two states stay
   distinguishable without resorting to red — stopping saves the entry rather
   than discarding it, and red would say otherwise. */
const timerBtnStyle = (running) => `border:0;color:#fff;background:${running
  ? 'linear-gradient(115deg,#5f3ac9 0%,#472b97 55%,#2f3893 100%)'
  : 'var(--grad-brand)'};box-shadow:0 6px 20px color-mix(in srgb,#4f46e5 34%,transparent);`;
const rowChipStyle = (color) => `border:0;background:${color}1f;color:var(--color-accent-900);font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer;`;

// The value stays the bare name — only the label carries the icon — so every
// existing comparison against state keeps working.
function options(names, selected, extra) {
  return names.map((n) => `<option value="${esc(n)}"${n === selected ? ' selected' : ''}>${esc(withIcon(n))}</option>`).join('') + (extra || '');
}

/* ─────────────────────────── templates ─────────────────────────── */

/* ── drawers ── */

/* The one breakpoint the script needs to know about. It matches the 720px the
   stylesheet uses for the phone layout; keeping the number in both places is
   the price of the app having no build step to share constants through. */
const PHONE_QUERY = '(max-width: 720px)';
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

/* ── scrolling chrome ──

   Passing null scrolls to the top. Honours the reduced-motion preference: a
   long smooth scroll is exactly the kind of movement that setting exists for,
   so it jumps instead. */
function scrollToAnchor(name) {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior = smooth ? 'smooth' : 'auto';
  if (!name) { window.scrollTo({ top: 0, behavior }); return; }
  const el = root.querySelector(`[data-anchor="${name}"]`);
  if (el) el.scrollIntoView({ block: 'start', behavior });
  else window.scrollTo({ top: 0, behavior });
}

/* The sticky bar and the back-to-top button are shown by scroll position
   rather than by a re-render, so they are toggled straight on the DOM. Both
   are looked up fresh because render() replaces the tree underneath them. */
let scrollTicking = false;
function paintScrollChrome() {
  scrollTicking = false;
  const y = window.scrollY;
  const bar = root.querySelector('[data-stickybar]');
  const top = root.querySelector('[data-backtotop]');
  if (bar) bar.classList.toggle('is-on', y > 210);
  if (top) top.classList.toggle('is-on', y > 380);
}
window.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(paintScrollChrome);
}, { passive: true });

/* The count goes in the default label so "Show more" never hides an unknown
   quantity. `labels` overrides it where a section reads better named — the
   wellbeing cards say "Read Full Report" rather than counting rows. */
function drawerToggle(key, hiddenCount, noun, labels) {
  const open = state.drawers[key];
  const text = open
    ? (labels ? labels.less : 'Show less')
    : (labels ? labels.more : `Show ${hiddenCount} more${noun ? ` ${noun}` : ''}`);
  return `
        <div class="drawer-row">
          <button class="drawer-btn" data-act="toggle-drawer" data-drawer="${key}" aria-expanded="${open}">
            ${esc(text)}
            <span class="drawer-caret" aria-hidden="true">${open ? '▲' : '▼'}</span>
          </button>
        </div>`;
}

const REPORT_LABELS = { more: 'Read Full Report', less: 'Hide Full Report' };

const CHIPS_COLLAPSED = 6;

/* Collapsed, the chip row shows the first few — but never at the cost of
   hiding the one currently selected, which would leave the timer looking
   unset. */
function timerChips() {
  const all = state.categories;
  if (state.drawers.categories || all.length <= CHIPS_COLLAPSED) return all;
  const shown = all.slice(0, CHIPS_COLLAPSED);
  if (shown.some((c) => c.name === state.timerCategory)) return shown;
  const selected = all.find((c) => c.name === state.timerCategory);
  return selected ? shown.slice(0, CHIPS_COLLAPSED - 1).concat([selected]) : shown;
}

/* ── mobile bottom bar ──

   Line icons drawn here rather than pulled from an icon library: they inherit
   currentColor, stay sharp at any pixel density, and add no request. Common
   attributes live on the <svg> so each path stays readable. */

const icon = (paths) => `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

const NAV_ICONS = {
  time: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 1.9"/>'),
  money: icon('<path d="M20 9.5V8a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 8.5v9A2.5 2.5 0 0 0 5.5 20H18a2 2 0 0 0 2-2v-1.5"/><path d="M21.5 9.5h-4a2.5 2.5 0 0 0 0 5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5Z"/>'),
  donate: icon('<path d="M19 13.5c1.4-1.35 3-3 3-5.2A4.8 4.8 0 0 0 17.2 3.5c-1.7 0-2.9.5-4.2 1.9-1.3-1.4-2.5-1.9-4.2-1.9A4.8 4.8 0 0 0 4 8.3c0 2.2 1.6 3.85 3 5.2l5 5Z"/>'),
  report: icon('<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8Z"/><path d="M14 3v5h5"/><path d="M9 17.5v-2.8M12 17.5v-5M15 17.5v-1.8"/>'),
  signout: icon('<path d="M9.5 21H6a2.5 2.5 0 0 1-2.5-2.5v-13A2.5 2.5 0 0 1 6 3h3.5"/><path d="M16 16.5 20.5 12 16 7.5"/><path d="M20.5 12H9.5"/>'),
  // Climbing bars with the trend arrow over them — the reading, not the data.
  insights: icon('<path d="M4 20V13.5M9 20v-9M14 20v-5.5M19 20V8"/><path d="m3.5 9 5.5-4 4 2.5 6.5-5"/><path d="M15.5 2.5h4v4"/>'),
  up: icon('<path d="M12 19.5V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>')
};

/* One per wellbeing dimension, and one per advice rule. Kept here with the rest
   of the drawn icons rather than beside the rules, because `icon` is defined in
   this section and a map built earlier would evaluate before it exists. */
const DIMENSION_ICONS = {
  physical: icon('<circle cx="13.6" cy="4.4" r="1.7"/><path d="M6.5 20.6l2.8-4.7 2.7-2.1 1-4.3 3.5 2.8 3 .5"/><path d="M11.4 9.5 8 11 6.4 14.4"/>'),
  emotional: icon('<path d="M19 13.5c1.4-1.35 3-3 3-5.2A4.8 4.8 0 0 0 17.2 3.5c-1.7 0-2.9.5-4.2 1.9-1.3-1.4-2.5-1.9-4.2-1.9A4.8 4.8 0 0 0 4 8.3c0 2.2 1.6 3.85 3 5.2l5 5Z"/>'),
  mental: icon('<path d="M12 3.2a5.4 5.4 0 0 0-5.4 5.4c0 2 1 3.2 1.9 4.2.7.8 1.1 1.4 1.1 2.4v.6h4.8v-.6c0-1 .4-1.6 1.1-2.4.9-1 1.9-2.2 1.9-4.2A5.4 5.4 0 0 0 12 3.2Z"/><path d="M9.8 18.6h4.4M10.4 21h3.2"/>'),
  spiritual: icon('<path d="M12 20.8c0-5.2 2.9-9.7 7.6-11.8.5 5.6-2.9 10.7-7.6 11.8Z"/><path d="M12 20.8C12 15.6 9.1 11.1 4.4 9 3.9 14.6 7.3 19.7 12 20.8Z"/><path d="M12 20.8V16"/>')
};

/* The calorie balance. Four readings that have to be told apart at a glance on
   a phone, so each gets its own drawn glyph rather than sharing the heart. */
const CAL_ICONS = {
  workout: DIMENSION_ICONS.physical,
  food: icon('<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path d="M9 7.6c0-1 .9-1.4.9-2.4M12.5 7.6c0-1 .9-1.4.9-2.4M16 7.6c0-1 .9-1.4.9-2.4"/>'),
  // A pulse rather than a moon: resting burn is the body ticking over all day,
  // not sleep.
  rest: icon('<path d="M2.5 12h4l2.2-5.2 3.6 10.4L14.6 12h6.9"/>'),
  net: icon('<path d="M12 4.5v15.5"/><path d="M7.5 20h9"/><path d="M4 8.5h16"/><path d="M4 8.5 1.8 13.6a2.4 2.4 0 0 0 4.4 0Z"/><path d="M20 8.5l-2.2 5.1a2.4 2.4 0 0 0 4.4 0Z"/>')
};

const TIP_ICONS = {
  move: DIMENSION_ICONS.physical,
  still: icon('<rect x="2.6" y="4.5" width="18.8" height="12.5" rx="2"/><path d="M8.5 20.5h7"/><path d="M12 17v3.5"/>'),
  people: icon('<circle cx="9" cy="8.2" r="3.1"/><path d="M2.8 19.4a6.2 6.2 0 0 1 12.4 0"/><path d="M16.4 5.6a3.1 3.1 0 0 1 0 5.7"/><path d="M18.2 14.4a6.2 6.2 0 0 1 3 5"/>'),
  breaks: icon('<path d="M4.5 8h11v6.5a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4Z"/><path d="M15.5 9.5h1.8a2.6 2.6 0 0 1 0 5.2h-1.8"/><path d="M7 4.6v1.6M11 3.8v2.4"/>'),
  quiet: DIMENSION_ICONS.spiritual,
  notes: icon('<path d="M16.5 3.6l3.9 3.9L9.2 18.7l-5.1 1.2 1.2-5.1Z"/><path d="M14.2 6l3.9 3.9"/>')
};

/* Five destinations, fixed where a thumb reaches. Hidden above 720px, where the
   app bar keeps its own buttons.

   Two of the five are actions rather than places — Report opens the sheet and
   Insights scrolls to the reading — so only Time and Money ever carry
   aria-current, and only they take the highlight. */
function mobileNav(v) {
  const item = (act, key, label, current) => `
    <button data-act="${act}"${current ? ' aria-current="page"' : ''}>
      <span class="bn-icon">${NAV_ICONS[key]}</span><span class="bn-label">${esc(label)}</span>
    </button>`;

  return `
  <nav class="bottomnav no-print" aria-label="Main">
    ${item('app-time', 'time', 'Time', !v.isMoney)}
    ${item('app-money', 'money', 'Money', v.isMoney)}
    <a class="bn-donate" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">
      <span class="bn-icon">${NAV_ICONS.donate}</span><span class="bn-label">Donate</span>
    </a>
    ${item('scroll-insights', 'insights', 'Insights', false)}
    ${item('open-report', 'report', 'Report', false)}
  </nav>`;
}

/* The bar that takes over once the page has scrolled past the real header.
   It carries whichever control is the one you reach back up for: on the time
   tracker that is the entry mode, on money it is the tracker switch. */
function stickyBar(v) {
  const pill = (act, label, on, extra) => `<button data-act="${act}"${extra || ''} style="
      border: 1px solid var(--color-accent-700);
      background: ${on ? 'var(--color-accent-700)' : 'var(--color-bg)'};
      color: ${on ? '#fff' : 'var(--color-accent-900)'};
      font-family: var(--font-body); font-size: 12.5px; font-weight: 600;
      padding: 7px 15px; border-radius: 999px; cursor: pointer; white-space: nowrap;">${esc(label)}</button>`;

  const controls = v.isMoney
    ? `${pill('app-time', 'Time Tracker', false)}${pill('app-money', 'Money Tracker', true)}`
    : `${pill('entry-mode-timer', 'Track Real Time', state.entryMode === 'timer', ' data-jump="entry"')}
       ${pill('entry-mode-manual', 'Manual Entry', state.entryMode === 'manual', ' data-jump="entry"')}`;

  return `
  <div class="stickybar no-print" data-stickybar>
    <div class="stickybar-in">
      <div class="stickybar-controls">${controls}</div>
      <button class="stickybar-mark" data-act="scroll-top" aria-label="Back to top">
        <span>${LOGO_BADGE(19)}</span>
        <span class="stickybar-name">ZIMPAN<span style="color: var(--color-accent-700);">.</span></span>
      </button>
    </div>
  </div>`;
}

// Sits above the bottom bar rather than over it, so it never covers a destination.
function backToTop() {
  return `
  <button class="backtotop no-print" data-backtotop data-act="scroll-top" aria-label="Back to top">
    ${NAV_ICONS.up}
  </button>`;
}

function header(v) {
  return `
  <div class="appbar">
    ${wordmark(26, 20)}
    <div class="appbar-tabs" style="display: flex; border: 1px solid var(--color-divider); border-radius: 999px; overflow: hidden;">
      <button data-act="app-time" style="${tabStyle(!v.isMoney)}">Time Tracker</button>
      <button data-act="app-money" style="${tabStyle(v.isMoney)}">Money Tracker</button>
    </div>
    <div class="appbar-meta">
      <span data-geo>${esc(v.geoLabel)}</span><span style="opacity:.4">/</span><span data-now>${esc(v.nowLabel)}</span>
      ${state.auth ? `<span style="opacity:.4">/</span>
        <button data-act="sync-now" title="Sync now" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;cursor:pointer;color:var(--color-neutral-600);"><span data-net>${esc(netLabel())}</span></button>` : ''}
    </div>
    <div class="appbar-actions" style="display:flex;align-items:center;gap:10px;">
      ${state.auth ? `
        <span class="appbar-account">
          <span class="appbar-email">${esc(state.auth.email)}</span>
          <button class="btn btn-ghost" data-act="sign-out" style="font-size:12px;">Sign out</button>
        </span>` : ''}
      <span class="appbar-cta" style="display:flex;align-items:center;gap:10px;">
        <a class="btn btn-donate" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">${NAV_ICONS.donate}<span>Donate</span></a>
        <button class="btn btn-primary" data-act="open-report" style="position:relative">Export report</button>
      </span>
    </div>
  </div>`;
}

/* Shown when the server refuses the queue. Loud on purpose: nothing will reach
   the server until it is dealt with, and the old behaviour called this
   "Offline", which suggested waiting would fix it. */
function syncErrorBanner() {
  if (state.netState !== 'error') return '';
  const blocked = describeBlockedRow();
  return `
  <div style="background: var(--color-neutral-200); border-bottom: 1px solid var(--color-divider); padding: 10px 28px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px;">
    <strong style="flex: none;">${state.netErrorKind === 'server' ? 'Server error' : 'Sync blocked'}</strong>
    <span style="color: var(--color-neutral-800); min-width: 0;">${esc(state.netError)}</span>
    ${blocked ? `<span style="color: var(--color-neutral-700);">Offending entry: “${esc(blocked.label)}”.</span>` : ''}
    <span style="margin-left: auto; display: flex; gap: 8px; flex: none;">
      <button class="btn btn-secondary" data-act="sync-now" style="font-size: 12px;">Try again</button>
      ${blocked ? `<button class="btn btn-ghost" data-act="sync-discard" style="font-size: 12px;" title="Keep it on this device but stop trying to upload it">Leave it behind</button>` : ''}
    </span>
  </div>`;
}

/* ── legal ──
   Written to describe what this app actually does rather than to cover every
   eventuality. Worth having someone qualified read before launch. */

const LEGAL_UPDATED = '11 August 2026';

const LEGAL = {
  privacy: {
    title: 'Privacy Policy',
    body: [
      ['What we hold', 'Your email address, and a scrambled version of your password that cannot be reversed back into it. If you sign in with Google we also store the account identifier Google gives us and your display name — never your Google password. Beyond that: the entries you log, their categories, amounts and any notes you add, plus your currency preference.'],
      ['Why', 'To show you your own data across your devices. That is the whole purpose. We do not profile you, sell anything, or share your entries with anyone.'],
      ['Where it lives', 'On a MySQL database on our hosting at Namecheap, and in your own browser. ZIMPAN keeps a copy locally so it works offline — which means signing out or clearing your browser data removes that local copy from that device.'],
      ['Cookies', 'One essential cookie holds a random session token so you stay signed in. Google Analytics sets its own cookies to count visits and see which pages get used — that is measurement, not advertising, and we do not run ad pixels or sell audiences. If you would rather not be counted, any browser-level tracking blocker or Google\'s own opt-out will stop it, and the app works exactly the same either way.'],
      ['Analytics', 'We use Google Analytics and Google Tag Manager to understand how the site is used in aggregate — visits, devices, which parts people reach. This runs on the public pages and never has sight of your entries, notes or amounts, which are only ever fetched after you sign in. Google processes this data on its own terms as a separate controller.'],
      ['Other services', 'Google, if you choose to sign in with it, and only to confirm who you are. PayPal, only if you choose to donate — that happens on PayPal\'s own site and we never see your payment details. Neither receives your logged entries.'],
      ['How long', 'Until you ask us to delete it. Sessions expire on their own after thirty days.'],
      ['Your data is yours', 'Export a copy any time with the report tools. To have your account and everything in it permanently deleted, email us and we will action it — deletion is irreversible.'],
      ['Changes', 'If this policy changes materially we will say so in the app rather than quietly editing this page.']
    ]
  },
  terms: {
    title: 'Terms of Use',
    body: [
      ['What ZIMPAN is', 'A free personal tracker for your time and money. Free forever — no subscription, no paid tier, no advertising. Donations are voluntary, buy no additional features, and are not refundable.'],
      ['Not professional advice', 'The insights, wellbeing readings, food observations and suggestions are generated automatically from what you log, using general rules. They are not medical, nutritional, psychological or financial advice, and no professional has reviewed them for you. Before acting on anything here — especially with a health condition, medication, or money that matters — check with a qualified professional. Decisions you make remain yours.'],
      ['Your account', 'Keep your password to yourself; you are responsible for what happens under your account. Tell us promptly if you think someone else has access.'],
      ['Fair use', 'Use ZIMPAN for your own tracking. Do not attempt to break into it, disrupt it for others, or use it to store unlawful material.'],
      ['No guarantees', 'ZIMPAN is provided as-is. We work to keep it available and your data intact, but we cannot promise uninterrupted service or guarantee against loss. Keep your own copy of anything you would be upset to lose — the export tools are there for exactly that.'],
      ['Ending it', 'Stop using it whenever you like and ask us to delete your account. We may suspend accounts that abuse the service or put others at risk.'],
      ['Changes', 'These terms may be updated. Continuing to use ZIMPAN after a change means you accept the revised version.']
    ]
  }
};

function legalSheet() {
  const doc = LEGAL[state.legalOpen];
  if (!doc) return '';
  return `
    <div class="report-wrap" data-legal-backdrop style="position: fixed; inset: 0; background: color-mix(in srgb, var(--color-neutral-900) 55%, transparent); display: flex; align-items: flex-start; justify-content: center; overflow: auto; z-index: 55;">
      <div style="width: 680px; max-width: 100%;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
          <span style="color: var(--color-bg); font-size: 13px; margin-right: auto;">Last updated ${esc(LEGAL_UPDATED)}</span>
          <button class="btn btn-secondary" data-act="legal-close" style="background: var(--color-bg);">Close</button>
        </div>
        <div class="report-sheet" style="background: var(--color-bg); box-shadow: var(--shadow-lg);">
          <h4 style="margin: 0 0 6px; font-size: 22px;">${esc(doc.title)}</h4>
          <div style="font-size: 12.5px; color: var(--color-neutral-600); margin-bottom: 22px;">ZIMPAN · zimpan.com</div>
          ${doc.body.map(([heading, text]) => `
            <div style="margin-bottom: 18px;">
              <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 5px;">${esc(heading)}</div>
              <div style="font-size: 13.5px; line-height: 1.65; color: var(--color-neutral-800);">${esc(text)}</div>
            </div>`).join('')}
          <div style="margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--color-divider); font-size: 12px; color: var(--color-neutral-600);">
            Questions about either document? Get in touch and we will answer.
          </div>
        </div>
      </div>
    </div>`;
}

/* ── re-upload ──

   Sync only ever sends rows marked dirty, and clearPushed() clears that mark as
   soon as a row has gone up. That is right in normal running and wrong after a
   server-side restore: the account can come back missing rows this device still
   holds, and because those rows are not dirty any more, nothing sends them
   again. They would sit here looking fine and be invisible everywhere else.

   adoptLocalData() already does the work — it was written for the first sign-in
   on a device with pre-account data — but the only path to it is that migration
   screen, which a signed-in browser can never reach. This is that path.

   Two-step on purpose. On a device whose local copy is the thin one, this is
   the wrong button, and it does not announce which device is which. */
function resyncControl() {
  if (!state.auth) return '';
  const n = state.entries.length + state.money.length;
  const link = 'border:0;background:transparent;padding:0;font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;color:var(--color-neutral-600);';

  if (!state.resyncArmed) {
    return `<button data-act="resync-all" style="${link}" title="Send everything stored on this device to the server again">Re-upload this device's data</button>`;
  }
  return `
    <span style="display:inline-flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:12px;color:var(--color-neutral-700);">
      Send all ${n} ${n === 1 ? 'record' : 'records'} on this device up again?
      <button class="btn btn-secondary" data-act="resync-all" style="font-size:12px;">Yes, re-upload</button>
      <button data-act="resync-cancel" style="${link}">Cancel</button>
    </span>`;
}

const legalLinks = (color) => `
  <div style="display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; font-size: 12px;">
    <button data-act="legal-privacy" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:${color};cursor:pointer;text-decoration:underline;text-underline-offset:2px;">Privacy Policy</button>
    <button data-act="legal-terms" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:${color};cursor:pointer;text-decoration:underline;text-underline-offset:2px;">Terms of Use</button>
  </div>`;

/* ── account screens ── */

/* The sign-in page gets the full stacked lockup rather than the app bar's
   horizontal one — it is the only screen with room for the mark to be the
   first thing you see. */
const authLockup = () => `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;margin-bottom:6px;">
        <span>${LOGO_BADGE(72)}</span>
        <span style="display:flex;flex-direction:column;gap:3px;">
          <span style="font-family:var(--font-heading);font-weight:600;font-size:30px;letter-spacing:.02em;line-height:1;">ZIMPAN<span style="color:var(--color-accent-700);">.</span></span>
          <span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-neutral-600);">Track What Matters</span>
        </span>
      </div>`;

/* ── landing ──
   What a signed-out visitor sees. Sign-in is a lightbox raised from here, so
   the first screen sells the thing rather than demanding credentials. */

const FEATURE_ICONS = {
  time: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.2 1.9"/>'),
  money: icon('<ellipse cx="12" cy="6.6" rx="6.8" ry="2.9"/><path d="M5.2 6.6v10.8c0 1.6 3 2.9 6.8 2.9s6.8-1.3 6.8-2.9V6.6"/><path d="M5.2 12c0 1.6 3 2.9 6.8 2.9s6.8-1.3 6.8-2.9"/>'),
  insights: icon('<circle cx="6" cy="7.2" r="2.1"/><circle cx="18" cy="6.2" r="2.1"/><circle cx="12" cy="17.4" r="2.1"/><path d="M7.5 8.8 10.8 15.6M16.6 8 13.3 15.5M8.1 6.9 15.9 6.4"/>'),
  sleep: icon('<path d="M20 14.6A8.3 8.3 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6Z"/><path d="M16.6 3.4v3.2M15 5h3.2"/>')
};

const CHECK_ICON = icon('<circle cx="12" cy="12" r="9"/><path d="m8.4 12.4 2.5 2.5 4.7-5.3"/>');

const LANDING_CHECKS = ['Financial Overview', 'Time & Project Tracking', 'Activity & Focus', 'Sleep & Well-being'];

/* Wording tightened where the original overstated the product: the insights
   are rule-based rather than AI, currency switching relabels rather than
   converting, and the timeline is a single row rather than a gantt chart. */
const LANDING_FEATURES = [
  ['time', 'Time', 'Optimize Your Time', 'Log by hand or use instant timers. See your whole day on a timeline, with efficiency reports.'],
  ['money', 'Money', 'Track Every Penny', 'Log income and expenses, switch between four currencies, and watch your spending trends.'],
  ['insights', 'Insights', 'Gain Deep Insights', 'Analyze movement, rest, focus and diet patterns with automatic reports.'],
  ['sleep', 'Sleep', 'Improve Your Sleep', 'Log sleep duration and quality to build better rest habits.']
];

/* ── hero art ──
   The app's own surfaces, floating over the brand's ribbons. Drawn rather than
   photographed: it stays sharp at any size, needs no asset, and re-colours
   itself from the palette if the palette moves again. Everything in it is a
   real thing the app shows — the donut, a calorie dial, an entry card. */
const HERO_ART = () => `
  <svg viewBox="0 0 620 520" class="hero-svg" role="img"
       aria-label="Zimpan showing a day's time split, a calorie dial and logged entries">
    <defs>
      <linearGradient id="hg-ribbon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a78bfa"></stop>
        <stop offset="55%" stop-color="#7856f5"></stop>
        <stop offset="100%" stop-color="#4f46e5"></stop>
      </linearGradient>
      <linearGradient id="hg-teal" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#0f766e"></stop>
        <stop offset="100%" stop-color="#35ae9f"></stop>
      </linearGradient>
      <linearGradient id="hg-blush" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f0abfc"></stop>
        <stop offset="100%" stop-color="#c084fc"></stop>
      </linearGradient>
      <filter id="hg-lift" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#2f1c66" flood-opacity=".22"></feDropShadow>
      </filter>
    </defs>

    <!-- the ribbons -->
    <path d="M96 12C258 -22 386 78 470 168c86 92 150 190 128 300-138 44-286 24-386-46C104 346 22 262 30 168 36 96 58 40 96 12Z"
          fill="url(#hg-ribbon)" opacity=".16"></path>
    <path d="M470 60c74 44 122 128 128 214 6 88-38 170-110 216-44-104-30-186-70-260-38-72-92-104-92-158 0-40 42-56 144-12Z"
          fill="url(#hg-teal)" opacity=".18"></path>
    <path d="M150 300c92-58 168-24 232 34 62 56 88 130 56 168-108 26-224-2-292-64-42-38-42-108 4-138Z"
          fill="url(#hg-blush)" opacity=".2"></path>

    <!-- where the time went -->
    <g filter="url(#hg-lift)">
      <rect x="36" y="96" width="250" height="196" rx="20" fill="#fff"></rect>
      <text x="60" y="130" font-family="Playfair Display, Georgia, serif" font-size="17" font-weight="700" fill="#16131f">Where the time went</text>
      <g transform="translate(112 210)">
        <circle r="52" fill="none" stroke="#e8e6ef" stroke-width="19"></circle>
        <circle r="52" fill="none" stroke="#7856f5" stroke-width="19" stroke-dasharray="118 209" transform="rotate(-90)"></circle>
        <circle r="52" fill="none" stroke="#a78bfa" stroke-width="19" stroke-dasharray="68 259" transform="rotate(45)"></circle>
        <circle r="52" fill="none" stroke="#2f1c66" stroke-width="19" stroke-dasharray="42 285" transform="rotate(128)"></circle>
        <text text-anchor="middle" y="4" font-family="Playfair Display, Georgia, serif" font-size="21" font-weight="700" fill="#16131f">6h 20m</text>
      </g>
      <g font-family="Barlow, system-ui, sans-serif" font-size="12" fill="#575168">
        <rect x="188" y="164" width="9" height="9" rx="2" fill="#7856f5"></rect><text x="204" y="173">Focus Work</text>
        <rect x="188" y="192" width="9" height="9" rx="2" fill="#a78bfa"></rect><text x="204" y="201">Family Time</text>
        <rect x="188" y="220" width="9" height="9" rx="2" fill="#2f1c66"></rect><text x="204" y="229">Workout</text>
        <rect x="188" y="248" width="9" height="9" rx="2" fill="#c4b5fd"></rect><text x="204" y="257">Chores</text>
      </g>
    </g>

    <!-- the phone, mid-log -->
    <g filter="url(#hg-lift)">
      <rect x="330" y="44" width="196" height="374" rx="30" fill="#fff"></rect>
      <rect x="342" y="56" width="172" height="350" rx="22" fill="#f8f7fb"></rect>
      <rect x="404" y="66" width="48" height="7" rx="3.5" fill="#d5d2df"></rect>
      <text x="362" y="106" font-family="Playfair Display, Georgia, serif" font-size="15" font-weight="700" fill="#16131f">Today</text>
      ${[0, 1, 2].map((i) => {
        const y = 124 + i * 62;
        const tint = ['#7856f5', '#0e9f6e', '#a78bfa'][i];
        const w = [92, 74, 84][i];
        return `
      <g>
        <rect x="362" y="${y}" width="${w}" height="17" rx="8.5" fill="${tint}" opacity=".16"></rect>
        <circle cx="373" cy="${y + 8.5}" r="4" fill="${tint}"></circle>
        <rect x="362" y="${y + 25}" width="132" height="7" rx="3.5" fill="#241f30" opacity=".7"></rect>
        <rect x="362" y="${y + 39}" width="86" height="6" rx="3" fill="#b8b4c6"></rect>
      </g>`;
      }).join('')}
      <rect x="362" y="316" width="132" height="34" rx="17" fill="url(#hg-ribbon)"></rect>
      <text x="428" y="338" text-anchor="middle" font-family="Barlow, system-ui, sans-serif" font-size="13" font-weight="600" fill="#fff">Start</text>
    </g>

    <!-- the calorie dial -->
    <g filter="url(#hg-lift)">
      <rect x="118" y="332" width="216" height="146" rx="20" fill="#fff"></rect>
      <text x="142" y="364" font-family="Barlow, system-ui, sans-serif" font-size="10" letter-spacing="1.4" fill="#756f88">DAILY BALANCE</text>
      <g transform="translate(226 438)">
        <path d="M-62 0 A 62 62 0 0 1 62 0" fill="none" stroke="#e8e6ef" stroke-width="14" stroke-linecap="round"></path>
        <path d="M-62 0 A 62 62 0 0 1 62 0" fill="none" stroke="#0e9f6e" stroke-width="14" stroke-linecap="round"
              stroke-dasharray="132 195"></path>
        <text text-anchor="middle" y="-6" font-family="Playfair Display, Georgia, serif" font-size="26" font-weight="700" fill="#16131f">~2,169</text>
        <text text-anchor="middle" y="12" font-family="Barlow, system-ui, sans-serif" font-size="9.5" letter-spacing=".9" fill="#756f88">NET · DEFICIT</text>
      </g>
    </g>
  </svg>`;

function landingScreen() {
  const cta = (size) => `
    <button data-act="auth-open" class="btn btn-primary" style="
      font-size: ${size}px; font-weight: 600; padding: ${size > 15 ? '13px 30px' : '10px 24px'};
      border-radius: 999px; cursor: pointer;">Start Tracking Now</button>`;

  return `
  <div class="landing">
    <header class="landing-bar">
      <a class="landing-brand" href="#" data-act="scroll-top">
        ${LOGO_BADGE(34)}
        <span class="landing-name">ZIMPAN<span style="color:var(--color-accent);">.</span></span>
      </a>
      <nav class="landing-nav">
        <button data-act="scroll-features">Features</button>
        <button data-act="scroll-features">How it works</button>
        <button data-act="legal-privacy">Privacy</button>
        <button data-act="legal-terms">Terms</button>
      </nav>
      <div class="landing-actions">
        <button class="landing-login" data-act="auth-open">Log In</button>
        <!-- Hidden on a phone: the hero's own button is a thumb-length below it,
             and two of the same call to action inside one screen is one too many. -->
        <div class="landing-cta-top">${cta(14)}</div>
      </div>
    </header>

    <section class="hero">
      <div class="hero-copy">
        <span class="hero-eyebrow">Free forever · No card required</span>
        <h1 class="hero-h1">
          Your Tracking Center for Everything That Matters
        </h1>
        <p class="hero-lede">
          Log your day in seconds and watch the pattern appear. Zimpan turns what you
          actually do with your time and money into something you can read — and act on.
        </p>

        <ul class="hero-checks">
          ${LANDING_CHECKS.map((t) => `
            <li><span class="hero-check">${CHECK_ICON}</span>${esc(t)}</li>`).join('')}
        </ul>

        <div class="hero-ctas">
          ${cta(16)}
          <button class="btn btn-secondary hero-cta2" data-act="scroll-features">Explore what it tracks</button>
        </div>
      </div>

      <div class="hero-art">${HERO_ART()}</div>
    </section>

    <section class="strip" data-anchor="features">
      <div class="strip-head">
        <span class="strip-kicker">What you can track</span>
        <span class="strip-rule"></span>
        <span class="strip-note">Four views, one log</span>
      </div>
      <div class="landing-points">
        ${LANDING_FEATURES.map(([key, eyebrow, title, body]) => `
          <div class="feature-card">
            <span class="feature-badge">${FEATURE_ICONS[key]}</span>
            <div style="min-width:0;">
              <div style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-neutral-600);margin-bottom:2px;">${esc(eyebrow)}</div>
              <div style="font-family:var(--font-heading);font-weight:700;font-size:19px;line-height:1.2;margin-bottom:6px;">${esc(title)}</div>
              <div style="font-size:13.5px;line-height:1.6;color:var(--color-neutral-800);">${esc(body)}</div>
            </div>
          </div>`).join('')}
      </div>
    </section>

    <footer style="padding:22px 28px 34px;display:flex;flex-direction:column;align-items:center;gap:12px;">
      <div style="font-size:13px;color:var(--color-neutral-800);text-align:center;">
        <strong>Free forever</strong> · No credit card required · Your data stays yours
      </div>
      ${legalLinks('var(--color-neutral-600)')}
    </footer>
  </div>`;
}

/* The sign-in panel is a lightbox over the landing page. Escape and the
   backdrop both dismiss it, except during a reset, where there is nowhere
   sensible to go back to. */
const authShell = (inner) => `
  <div data-auth-backdrop style="position:fixed;inset:0;z-index:50;overflow:auto;padding:24px 16px;
       background:color-mix(in srgb, var(--color-neutral-900) 58%, transparent);
       display:flex;align-items:flex-start;justify-content:center;">
    <div class="blueprint" style="width:400px;max-width:100%;padding:30px 28px 28px;background:var(--color-bg);margin:auto;position:relative;">
      ${state.authMode === 'reset' ? '' : `
        <button data-act="auth-close" aria-label="Close" style="position:absolute;top:10px;right:12px;border:0;background:transparent;
          font-size:22px;line-height:1;color:var(--color-neutral-600);cursor:pointer;padding:4px 8px;">×</button>`}
      ${authLockup()}
      ${inner}
    </div>
  </div>`;

const authMessages = () => `
  ${state.authNotice ? `<div style="font-size:12.5px;line-height:1.5;color:var(--color-accent-900);background:var(--color-accent-100);padding:10px 12px;border-radius:var(--radius-md);margin-bottom:14px;">${esc(state.authNotice)}</div>` : ''}
  ${state.authError ? `<div style="font-size:12.5px;line-height:1.5;color:var(--color-text);background:var(--color-neutral-200);padding:9px 11px;border-radius:var(--radius-md);margin-bottom:14px;">${esc(state.authError)}</div>` : ''}`;

function forgotScreen() {
  return authShell(`
      <div style="font-size:13px;color:var(--color-neutral-700);margin:12px 0 20px;">
        Enter the email you signed up with and we'll send a link to choose a new password.
      </div>
      <div class="field" style="margin-bottom:14px;"><label>Email</label>
        <input class="input" type="email" autocomplete="email" data-k="auth-email" data-sync="authEmail" data-enter="forgot-submit" value="${esc(state.authEmail)}" placeholder="you@example.com">
      </div>
      ${authMessages()}
      <button class="btn btn-primary" data-act="forgot-submit" style="width:100%;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:9px;"${state.authBusy ? ' disabled' : ''}>
        ${state.authBusy ? '<span class="spinner"></span>Sending…' : 'Send reset link'}
      </button>
      <button class="btn btn-ghost" data-act="auth-mode-login" style="width:100%;margin-top:10px;font-size:12.5px;">Back to sign in</button>`);
}

function resetScreen() {
  return authShell(`
      <div style="font-size:13px;color:var(--color-neutral-700);margin:12px 0 20px;">
        Choose a new password. This link works once.
      </div>
      <div class="field" style="margin-bottom:6px;"><label>New password</label>
        <input class="input" type="password" autocomplete="new-password" data-k="auth-password" data-sync="authPassword" data-enter="reset-submit" value="${esc(state.authPassword)}" placeholder="At least 10 characters">
      </div>
      <div style="font-size:11.5px;color:var(--color-neutral-600);margin-bottom:14px;">Signing in elsewhere will end when you save this — every other session is closed.</div>
      ${authMessages()}
      <button class="btn btn-primary" data-act="reset-submit" style="width:100%;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:9px;"${state.authBusy ? ' disabled' : ''}>
        ${state.authBusy ? '<span class="spinner"></span>Saving…' : 'Save new password'}
      </button>
      <button class="btn btn-ghost" data-act="auth-mode-login" style="width:100%;margin-top:10px;font-size:12.5px;">Back to sign in</button>`);
}

function authScreen() {
  if (state.authMode === 'forgot') return forgotScreen();
  if (state.authMode === 'reset') return resetScreen();
  const register = state.authMode === 'register';
  return authShell(`

      <div style="display:flex;border:1px solid var(--color-divider);border-radius:999px;overflow:hidden;margin:22px 0 20px;">
        <button data-act="auth-mode-login" style="${tabStyle(!register)};flex:1;">Sign in</button>
        <button data-act="auth-mode-register" style="${tabStyle(register)};flex:1;">Create account</button>
      </div>

      ${state.googleClientId ? `
        <div data-google-btn style="display:flex;justify-content:center;min-height:44px;margin-bottom:6px;"></div>
        ${gisState === 'failed' ? '<div style="font-size:11.5px;color:var(--color-neutral-600);text-align:center;margin-bottom:6px;">Google sign-in could not load. Use your email and password below.</div>' : ''}
        <div style="display:flex;align-items:center;gap:10px;margin:14px 0 16px;color:var(--color-neutral-600);font-size:11px;letter-spacing:.08em;text-transform:uppercase;">
          <span style="flex:1;height:1px;background:var(--color-divider);"></span>or<span style="flex:1;height:1px;background:var(--color-divider);"></span>
        </div>` : ''}

      <div class="field" style="margin-bottom:12px;"><label>Email</label>
        <input class="input" type="email" autocomplete="email" data-k="auth-email" data-sync="authEmail" data-enter="auth-submit" value="${esc(state.authEmail)}" placeholder="you@example.com">
      </div>
      <div class="field" style="margin-bottom:6px;"><label>Password</label>
        <input class="input" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" data-k="auth-password" data-sync="authPassword" data-enter="auth-submit" value="${esc(state.authPassword)}" placeholder="${register ? 'At least 10 characters' : ''}">
      </div>
      ${register
        ? '<div style="font-size:11.5px;color:var(--color-neutral-600);margin:6px 0 14px;">Use at least 10 characters.</div>'
        : '<div style="display:flex;justify-content:flex-end;margin:4px 0 14px;"><button data-act="auth-mode-forgot" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:var(--color-accent-700);cursor:pointer;text-decoration:underline;text-underline-offset:2px;">Forgot your password?</button></div>'}

      ${authMessages()}

      <button class="btn btn-primary" data-act="auth-submit" style="width:100%;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:9px;"${state.authBusy ? ' disabled' : ''}>
        ${state.authBusy ? '<span class="spinner"></span>' : ''}
        ${state.authBusy ? (register ? 'Creating your account…' : 'Signing you in…') : (register ? 'Create account' : 'Sign in')}
      </button>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--color-divider);">
        ${legalLinks('var(--color-neutral-600)')}
      </div>`);
}

function migrateScreen() {
  const o = state.migrateOffer;
  return `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 18px;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body);">
    <div class="blueprint" style="width:460px;max-width:100%;padding:30px;">
      <h4 style="margin:0 0 10px;">There is data on this device</h4>
      <div style="font-size:13px;line-height:1.6;color:var(--color-neutral-800);margin-bottom:8px;">
        This browser holds ${o.entries} time ${o.entries === 1 ? 'entry' : 'entries'} and ${o.money} money ${o.money === 1 ? 'entry' : 'entries'} logged before you had an account.
      </div>
      <div style="font-size:13px;line-height:1.6;color:var(--color-neutral-700);margin-bottom:20px;">
        Move it into <strong>${esc(state.auth ? state.auth.email : '')}</strong>, or start that account clean? Discarding clears it from this browser and cannot be undone.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" data-act="migrate-upload">Upload it to my account</button>
        <button class="btn btn-secondary" data-act="migrate-discard">Start clean</button>
      </div>
    </div>
  </div>`;
}

function notePromptDialog() {
  const p = state.notePrompt;
  if (!p) return '';
  return `
    <div style="position:fixed;inset:0;background:color-mix(in srgb, var(--color-neutral-900) 55%, transparent);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50;">
      <div class="blueprint" style="width:440px;max-width:100%;padding:26px 26px 24px;background:var(--color-bg);">
        <h4 style="margin:0 0 4px;">${esc(p.title)}</h4>
        <div style="font-size:12px;color:var(--color-neutral-600);margin-bottom:14px;">${esc(p.hint)}</div>
        <textarea class="input" data-k="note-draft" data-sync="noteDraft" rows="4" maxlength="500"
          placeholder="${esc(p.placeholder)}"
          style="width:100%;resize:vertical;min-height:88px;font:inherit;font-size:14px;line-height:1.5;padding:10px 12px;">${esc(state.noteDraft)}</textarea>
        <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap;">
          <span style="font-size:11.5px;color:var(--color-neutral-600);margin-right:auto;">Logged against “${esc(p.activity || 'this entry')}”. Optional.</span>
          <button class="btn btn-ghost" data-act="note-skip">Skip</button>
          <button class="btn btn-primary" data-act="note-save">Save note</button>
        </div>
      </div>
    </div>`;
}

/* ── the donation ask ──

   Once a day, and only after twenty minutes of the app actually being used:
   the tab in front, and either a timer running or something typed or pressed in
   the last couple of minutes. A tab left open overnight earns no credit and is
   not greeted with a fundraising sheet in the morning.

   The "seen" date is its own localStorage key rather than a field on state,
   because it describes this browser and has no business being synced to the
   account and following the user onto their other devices. */

const DONATE_SEEN_KEY = 'zimpan.donate.v1';
/* Five minutes with the app open, whether or not anyone is touching it —
   reading a report or leaving the tab up counts the same as typing. It used to
   need twenty minutes of *active* time, which a reader never accumulated. */
const DONATE_AFTER_MS = 5 * 60 * 1000;
const DONATE_TICK_MS = 15 * 1000;

let openMs = 0;

const donateSeenOn = () => { try { return localStorage.getItem(DONATE_SEEN_KEY) || ''; } catch (err) { return ''; } };
const markDonateSeen = () => { try { localStorage.setItem(DONATE_SEEN_KEY, iso(new Date())); } catch (err) { /* private mode */ } };

function tickDonate() {
  if (!state.auth || state.donateOpen) return;
  // Still only counts while the tab is actually on screen — a window left in a
  // background tab for an hour has not been used for an hour.
  if (document.visibilityState !== 'visible') return;

  openMs += DONATE_TICK_MS;
  if (openMs < DONATE_AFTER_MS) return;
  // Recomputed rather than read from todayIso, which was fixed at load and
  // would be yesterday for anyone who left the app open past midnight.
  if (donateSeenOn() === iso(new Date())) return;

  markDonateSeen();
  state.donateOpen = true;
  render();
}
setInterval(tickDonate, DONATE_TICK_MS);

function donateSheet() {
  if (!state.donateOpen) return '';
  return `
  <div class="no-print donate-backdrop" data-donate-backdrop>
    <div class="donate-sheet" role="dialog" aria-modal="true" aria-labelledby="donate-title">
      <button class="donate-x" data-act="donate-close" aria-label="Close">×</button>
      <div class="donate-kicker">A note from the maker</div>
      <h2 id="donate-title" class="donate-title">
        <span class="donate-l1">HELP US IMPROVE</span>
        <span class="donate-l2">DONATE A DOLLAR</span>
      </h2>
      <p class="donate-copy">
        ZIMPAN is free, carries no ads, and never sells what you log. A dollar covers
        the server it runs on and the time that goes into the next feature.
      </p>
      <button class="donate-cta" data-act="donate-go">${NAV_ICONS.donate}<span>Donate Now</span></button>
      <button class="donate-later" data-act="donate-close">Maybe later</button>
    </div>
  </div>`;
}

function splashScreen() {
  return `
  <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body);">
    ${wordmark(34, 24)}
    <span class="spinner" style="color:var(--color-accent-700);"></span>
  </div>`;
}

// Short-lived confirmation. Adding an entry is instant because it is written
// locally first, so the honest feedback is "done", not a fake wait.
let toastTimer = null;
function flash(message) {
  state.toast = message;
  paintToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = ''; paintToast(); }, 2200);
}

function paintToast() {
  let el = document.getElementById('zimpan-toast');
  if (!state.toast) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'zimpan-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = state.toast;
}

/* What a refused form says, and the hook the input listener uses to take it
   back down again the moment the field is typed into. */
function fieldError(scope) {
  return state.formError[scope]
    ? `<div class="field-err" data-err="${scope}" role="alert">${esc(state.formError[scope])}</div>`
    : '';
}

function segRange(name, labels) {
  const opt = (val, label) => `<label class="seg-opt"><input type="radio" name="${name}" data-act="range-${val}"${state.range === val ? ' checked' : ''}><span>${label}</span></label>`;
  return `<div class="seg">${opt('day', labels[0])}${opt('week', labels[1])}${opt('fortnight', labels[2])}${opt('month', labels[3])}</div>`;
}

/* The centre overlay covers the whole ring, so it stays click-through and only
   the readout itself takes pointer events — otherwise it would swallow every
   slice click. */
function donut(v, size, stroke, totalSize) {
  const arcs = v.slices.map((s) => {
    const dimmed = v.focusName && v.focusName !== s.name;
    return `<circle cx="100" cy="100" r="72" fill="none" stroke="${esc(s.color)}" stroke-width="${stroke}"
      stroke-dasharray="${s.dash}" stroke-dashoffset="${s.offset}"
      data-act="slice-pick" data-name="${esc(s.name)}"
      style="cursor: pointer; opacity: ${dimmed ? '.24' : '1'}; transition: opacity .15s;">
      <title>${esc(s.name)} · ${esc(s.pct)}</title></circle>`;
  }).join('');

  /* The readout is set in the heading serif, which is far wider than the
     condensed sans it replaced — a long money total such as "AED 6,617.45"
     wrapped out of the hole and across the ring. The size is fitted to the
     string it actually has to hold, and never wraps. */
  const hole = size * 0.64;
  const fit = (text) => Math.max(13, Math.min(totalSize, Math.floor(hole / (String(text).length * 0.54))));

  const centre = v.focusName
    ? `<button data-act="focus-toggle" title="Show the entries behind ${esc(v.focusName)}"
        style="pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 100%; border: 0; background: transparent; padding: 0; font: inherit; color: inherit; cursor: pointer;">
        <span style="font-size: 11px; line-height: 1.2; text-align: center; color: var(--color-neutral-700); text-decoration: underline; text-underline-offset: 2px;">${esc(withIcon(v.focusName))}</span>
        <span style="font-family: var(--font-heading); font-size: ${fit(v.focusPct)}px; line-height: 1; white-space: nowrap;">${esc(v.focusPct)}</span>
        <span style="font-size: 11px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums; white-space: nowrap;">${esc(v.focusValue)}</span>
      </button>`
    : `<div style="font-family: var(--font-heading); font-size: ${fit(v.rangeTotal)}px; line-height: 1.05; white-space: nowrap;">${esc(v.rangeTotal)}</div>
       <div style="font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--color-neutral-600); white-space: nowrap;">${esc(v.rangeLabel)}</div>`;

  return `
    <div style="position: relative; width: ${size}px; height: ${size}px; flex: none;">
      <svg viewBox="0 0 200 200" style="width: 100%; height: 100%; transform: rotate(-90deg);">
        <circle cx="100" cy="100" r="72" fill="none" stroke="var(--track)" stroke-width="${stroke}"></circle>
        ${arcs}
      </svg>
      <div style="position: absolute; inset: 0; padding: 0 18%; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
        ${centre}
      </div>
    </div>`;
}

const LIST_COLLAPSED = 5;

function legend(v) {
  const all = v.slices;
  const shown = state.drawers.legend || all.length <= LIST_COLLAPSED ? all : all.slice(0, LIST_COLLAPSED);
  return shown.map((s) => {
    const on = v.focusName === s.name;
    return `
    <button class="legend-row" data-act="legend-pick" data-name="${esc(s.name)}" title="Show the entries behind ${esc(s.name)}"
      style="background: ${on ? 'var(--color-accent-100)' : 'transparent'}; opacity: ${v.focusName && !on ? '.5' : '1'};">
      <span style="width: 10px; height: 10px; flex: none; background: ${esc(s.color)};"></span>
      <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(withIcon(s.name))}</span>
      <span style="font-variant-numeric: tabular-nums; color: var(--color-neutral-700);">${esc(s.pct)}</span>
      <span class="legend-see">See Entries</span>
    </button>`;
  }).join('') + (all.length > LIST_COLLAPSED
    ? drawerToggle('legend', all.length - LIST_COLLAPSED, v.isMoney ? 'purposes' : 'categories')
    : '');
}

/* The drilled-down entries, as a lightbox. Range-aware, so week and month views
   list days the day-by-day table cannot show — hence the date column.

   Rendered from render() rather than from inside a chart card: it is an overlay
   over the whole page, and both trackers open the same one. */
function focusPanel(v) {
  if (!v.focusOpen) return '';

  const rows = v.focusList.map((r) => `
          <div class="focus-row">
            <span class="focus-date">${esc(r.date)}</span>
            <span class="focus-what" title="${esc(r.activity)}">${esc(r.activity)}</span>
            ${r.meta ? `<span class="focus-meta">${esc(r.meta)}</span>` : ''}
            <span class="focus-val">${esc(r.value)}</span>
          </div>`).join('');

  return `
      <div class="no-print focus-backdrop" data-backdrop="focus-clear">
        <div class="focus-sheet" role="dialog" aria-modal="true" aria-label="Entries for ${esc(v.focusName)}">
          <div class="focus-head">
            <span class="focus-swatch" style="background: ${esc(v.focusColor)};"></span>
            <div class="focus-title">
              <h4>${esc(withIcon(v.focusName))}</h4>
              <span class="focus-sub">${v.focusList.length} ${v.focusList.length === 1 ? 'entry' : 'entries'} · ${esc(v.rangeLabel)} · ${esc(v.focusValue)} (${esc(v.focusPct)})</span>
            </div>
            <button class="focus-x" data-act="focus-clear" aria-label="Close">×</button>
          </div>
          <div class="focus-body">
            ${rows || '<div style="padding: 26px 0; text-align: center; font-size: 13px; color: var(--color-neutral-600);">Nothing logged here in this range.</div>'}
          </div>
          <div class="focus-foot">
            <button class="btn btn-secondary" data-act="focus-clear">Close</button>
          </div>
        </div>
      </div>`;
}

function bars(v) {
  const all = v.leaderboard;
  const shown = state.drawers.leaderboard || all.length <= LIST_COLLAPSED ? all : all.slice(0, LIST_COLLAPSED);
  return shown.map((l) => `
    <div>
      <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
        <span>${esc(withIcon(l.name))}</span><span style="color: var(--color-neutral-700); font-variant-numeric: tabular-nums;">${esc(l.label)}</span>
      </div>
      <div style="height: 8px; background: var(--track);">
        <div style="height: 100%; width: ${l.width}; background: ${esc(l.color)};"></div>
      </div>
    </div>`).join('') + (all.length > LIST_COLLAPSED
    ? drawerToggle('leaderboard', all.length - LIST_COLLAPSED, v.isMoney ? 'purposes' : 'categories')
    : '');
}

/* ── wellbeing cards ── */

const METER_COLOR = {
  strong: 'var(--color-accent-600)',
  steady: 'var(--color-accent-400)',
  thin: 'var(--color-neutral-400)',
  none: 'var(--color-neutral-300)'
};

/* A dial rather than a bar. The ring reads as a proportion of the day's target
   at a glance where a flat meter reads as a row to be scanned, and it gives the
   icon somewhere to sit. Drawn as a full circle rotated a quarter turn so the
   fill starts at the top. */
function dimensionCards(readings, scope) {
  const C = 2 * Math.PI * 26;
  return readings.map((r) => {
    const dash = (Math.max(0, Math.min(100, r.pct)) / 100) * C;
    const tone = METER_COLOR[r.status];
    return `
        <div class="wb-card">
          <div class="wb-head">
            <span class="wb-dial">
              <svg viewBox="0 0 60 60" aria-hidden="true" focusable="false">
                <circle cx="30" cy="30" r="26" fill="none" stroke="var(--track)" stroke-width="5"></circle>
                <circle cx="30" cy="30" r="26" fill="none" stroke="${tone}" stroke-width="5" stroke-linecap="round"
                        stroke-dasharray="${dash.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 30 30)"></circle>
              </svg>
              <span class="wb-glyph" style="color: ${tone};">${DIMENSION_ICONS[r.key] || ''}</span>
            </span>
            <span class="wb-label">${esc(r.label)}</span>
          </div>
          <div class="wb-note">${esc(r.note)}</div>
          ${r.entries.length ? `
          <button class="wb-see" data-act="pillar-open" data-key="${esc(r.key)}" data-scope="${esc(scope)}">
            See the ${r.entries.length} ${r.entries.length === 1 ? 'activity' : 'activities'} behind this
          </button>` : ''}
        </div>`;
  }).join('');
}

/* Steps for one day. A lightbox rather than a field on the card: it is entered
   once a day from a phone's own counter, and a permanent input for it would sit
   there empty most of the time. */
function stepsSheet() {
  if (!state.stepsOpen) return '';
  const date = state.stepsOpen;
  const saved = Number(state.steps[date]) || 0;
  const draft = state.stepsDraft === '' ? '' : Number(state.stepsDraft) || 0;
  const preview = stepsKcal(draft || saved, state.weightKg);
  const when = date === todayIso
    ? 'today'
    : new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return `
      <div class="no-print focus-backdrop" data-backdrop="steps-close">
        <div class="focus-sheet steps-sheet" role="dialog" aria-modal="true" aria-label="Steps for ${esc(when)}">
          <div class="focus-head">
            <span class="focus-swatch" style="background: var(--zg-strong);"></span>
            <div class="focus-title">
              <h4>Steps</h4>
              <span class="focus-sub">for ${esc(when)}</span>
            </div>
            <button class="focus-x" data-act="steps-close" aria-label="Close">×</button>
          </div>
          <div class="focus-body steps-body">
            <label class="steps-label" for="steps-count">How many steps did you walk?</label>
            <input class="input steps-input" id="steps-count" type="number" min="0" max="200000" step="1"
              inputmode="numeric" data-k="steps-count" data-sync="stepsDraft" data-enter="steps-save"
              placeholder="e.g. 8,000" value="${saved ? esc(saved) : ''}">
            <div class="steps-preview">
              ${preview
                ? `About <strong>${preview.toLocaleString('en-US')} kcal</strong>, counted into calories burned from workout and movement.`
                : 'Priced as walking, at the same rate a logged walk is charged.'}
            </div>
            <div class="steps-note">
              A rough estimate from step count and your weight${state.weightKg ? '' : ` (${DEFAULT_WEIGHT_KG} kg assumed)`}.
              Kept on this device — steps do not sync between devices yet.
            </div>
          </div>
          <div class="focus-foot">
            ${saved ? '<button class="btn btn-ghost" data-act="steps-clear" style="margin-right:auto;font-size:12.5px;">Remove</button>' : ''}
            <button class="btn btn-secondary" data-act="steps-close">Cancel</button>
            <button class="btn btn-primary" data-act="steps-save">Save</button>
          </div>
        </div>
      </div>`;
}

/* The activities behind one pillar's figure. Most rules credit a fraction of an
   entry — chores are half of physical, a workout a third of mental — so the
   list shows what each one contributed as well as how long it ran, which is the
   only way the total adds up on the page. */
function pillarSheet(v) {
  if (!state.pillarOpen) return '';
  const { key, scope } = state.pillarOpen;
  const readings = scope === 'past' ? v.pastReadings : v.todayReadings;
  const r = (readings || []).find((x) => x.key === key);
  if (!r) return '';

  const rows = r.entries.map((p) => `
          <div class="focus-row">
            <span class="focus-date">${esc(dayLabel(p.date))}</span>
            <span class="focus-what" title="${esc(p.activity)}">${esc(p.activity)}</span>
            <span class="focus-meta">${esc(withIcon(p.category))}${p.weight < 1 ? ` · counts ${Math.round(p.weight * 100)}%` : ''}</span>
            <span class="focus-val">${esc(durShort(p.credited))}</span>
          </div>`).join('');

  return `
      <div class="no-print focus-backdrop" data-backdrop="pillar-close">
        <div class="focus-sheet" role="dialog" aria-modal="true" aria-label="Activities behind ${esc(r.label)}">
          <div class="focus-head">
            <span class="focus-swatch" style="background: ${esc(METER_COLOR[r.status])};"></span>
            <div class="focus-title">
              <h4>${esc(r.label)}</h4>
              <span class="focus-sub">${esc(durShort(r.total))} credited · ${r.entries.length} ${r.entries.length === 1 ? 'activity' : 'activities'} · ${scope === 'past' ? 'looking back' : 'today'}</span>
            </div>
            <button class="focus-x" data-act="pillar-close" aria-label="Close">×</button>
          </div>
          <div class="focus-body">${rows}</div>
          <div class="focus-foot">
            <span class="focus-foot-note">Partial credit is deliberate — an hour of chores is not an hour of exercise.</span>
            <button class="btn btn-secondary" data-act="pillar-close">Close</button>
          </div>
        </div>
      </div>`;
}

/* Two half-dials facing each other with the difference between them in the
   middle — which is the number the pair exists to produce. Both are scaled to
   the larger of the two so the shorter arc is honestly shorter; scaling each to
   its own maximum would draw two full dials and say nothing. */
/* Four readings, left to right: what exercise burned, what food brought in,
   what the body spent doing nothing, and the three of them netted off.
   `scope` names the card this pair of gauges belongs to — the same block is
   drawn twice on the page, so the weight editor needs to know which copy was
   asked for and the fields inside it need keys that do not collide. */
function balanceGauges(food, burn, scope, stepDate) {
  if (!food.kcal && !burn.kcal) return '';

  /* A thirty-day total on a dial scaled for one day reads as wildly over-eaten
     every time, so a multi-day range is averaged and says so. Every figure is
     divided by the same span, which leaves the balance between them — the
     reading this row exists to show — unchanged. */
  const days = Math.max(1, burn.days || 1);
  const per = (n) => Math.round(n / days);
  const burned = per(burn.kcal);
  const eaten = per(food.kcal);
  const rested = per(burn.restKcal);

  /* Everything out, less everything in. Positive is a deficit — more spent
     than eaten — which is the direction people are usually looking for, so it
     takes the green. */
  const net = burned + rested - eaten;
  const deficit = net >= 0;

  // One scale across all four, so the bars are comparable to each other rather
  // than each being full of itself.
  const top = Math.max(eaten, burned, rested, Math.abs(net), 1);
  const ARC = Math.PI * 42;

  const dial = (value, tone, glyph, cap, sub) => {
    const dash = (Math.abs(value) / top) * ARC;
    return `
          <div class="cal-dial">
            <svg viewBox="0 0 110 62" aria-hidden="true" focusable="false">
              <path d="M13 55 A 42 42 0 0 1 97 55" fill="none" stroke="var(--track)" stroke-width="9" stroke-linecap="round"></path>
              <path d="M13 55 A 42 42 0 0 1 97 55" fill="none" stroke="${tone}" stroke-width="9" stroke-linecap="round"
                    stroke-dasharray="${dash.toFixed(2)} ${ARC.toFixed(2)}"></path>
            </svg>
            <span class="cal-glyph" style="color: ${tone};">${glyph}</span>
            <div class="cal-value">~${Math.abs(value).toLocaleString('en-US')}</div>
            <div class="cal-cap">${esc(cap)}</div>
            ${sub ? `<div class="cal-sub">${sub}</div>` : ''}
          </div>`;
  };

  const netTone = deficit ? 'var(--zg-strong)' : 'var(--zg-alert)';
  const open = state.weightEditOpen === scope;

  return `
      <div class="cal-kicker">${days > 1 ? `Average day across ${days} days` : 'Daily calorie balance'}</div>
      <div class="cal-row">
        ${dial(burned, 'var(--zg-strong)', CAL_ICONS.workout, 'Calories burned from workout and movement',
          /* The steps link is offered only where a single day is on screen —
             a step count belongs to one date, and there is no honest way to
             enter one against a week. */
          stepDate ? `${burn.steps
            ? `${burn.steps.toLocaleString('en-US')} steps${burn.fromSteps ? ` · about ${burn.fromSteps.toLocaleString('en-US')} kcal of the figure above` : ''}. `
            : ''}<button class="cal-link" data-act="steps-open" data-date="${esc(stepDate)}">${burn.steps ? 'Edit your steps' : 'Add your steps'}</button>.`
            : (burn.steps ? `Includes ${burn.steps.toLocaleString('en-US')} steps across the range.` : ''))}
        ${dial(eaten, 'var(--zg-donate)', CAL_ICONS.food, 'Calories consumed (food)', '')}
        ${dial(rested, 'var(--color-accent-700)', CAL_ICONS.rest, 'Calories burned (at rest)',
          `Roughly burned at rest based on ${burn.assumedWeight
            ? `a default ${DEFAULT_WEIGHT_KG} kg`
            : `your ${esc(state.weightKg)} kg`}. <button class="cal-link" data-act="weight-open" data-scope="${esc(scope)}" aria-expanded="${open}">Edit your weight here</button>.`)}
        ${dial(net, netTone, CAL_ICONS.net, `Net calories (${deficit ? 'deficit' : 'surplus'})`,
          `Your net calorie for ${days > 1 ? 'an average day' : (scope === 'past' ? 'that day' : 'today')}: workout burn + burn at rest − calories consumed.`)}
      </div>
      ${open ? `
      <div class="cal-weight">
        <label for="cal-weight-${esc(scope)}">Your weight</label>
        <input class="input" id="cal-weight-${esc(scope)}" type="number" min="20" max="400" step="1" inputmode="numeric"
          data-k="cal-weight-${esc(scope)}" data-act="set-weight" placeholder="${DEFAULT_WEIGHT_KG}"
          value="${state.weightKg || ''}">
        <span class="cal-weight-unit">kg</span>
        <button class="btn btn-secondary" data-act="weight-close">Done</button>
        <span class="cal-weight-note">Left blank, ${DEFAULT_WEIGHT_KG} kg is assumed.</span>
      </div>` : ''}
      <div class="cal-rest">Every calorie here is a rough estimate, worked out from what you logged and your weight — useful for spotting a direction, not for counting on.</div>`;
}

const DISCLAIMER = 'Suggestions only, drawn from what you logged. ZIMPAN is not a medical, nutritional or financial adviser — anything you act on, particularly with a health condition or medication involved, is worth putting to a qualified professional first.';

/* Cards rather than bullets. The grid takes whatever number of rules fired —
   between none and six — rather than assuming three, so a quiet day shows one
   card and a rough one shows six without the layout having an opinion. */
function adviceBlock(list) {
  if (!list.length) {
    return `
          <div style="margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--color-divider); font-size: 12.5px; color: var(--color-neutral-700);">
            Nothing worth flagging — this reads as a balanced stretch.
          </div>`;
  }
  return `
          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--color-divider);">
            <div class="wb-kicker">What might help</div>
            <div class="tip-grid">
              ${list.map((t, i) => `
                <div class="tip-card">
                  <div class="tip-head">
                    <span class="tip-glyph">${TIP_ICONS[t.key] || ''}</span>
                    <span class="tip-meta">
                      <span class="tip-no">Pro-tip ${i + 1}</span>
                      <span class="tip-label">${esc(t.label)}</span>
                    </span>
                  </div>
                  <div class="tip-body"><strong>${esc(t.lead)}.</strong> ${esc(t.text)}</div>
                </div>`).join('')}
            </div>
            <div style="margin-top: 12px; font-size: 11.5px; line-height: 1.5; color: var(--color-neutral-600);">${esc(DISCLAIMER)}</div>
          </div>`;
}

/* ── financial insights ──
   Two lists rather than one: what the window says, then what might be done
   about it. Keeping them apart is what stops a suggestion from reading as if it
   were also a finding. `forPrint` drops the range switch, which is the only
   interactive part and means nothing on paper. */
function insightsBody(v, forPrint) {
  const f = v.moneyInsight;

  if (!f) {
    return `
          <div style="font-size: 12.5px; line-height: 1.55; color: var(--color-neutral-700);">
            Nothing logged in this window yet. Two weeks of entries is where the patterns start to show — until then there is nothing here worth reading into.
          </div>`;
  }

  const tile = (label, value, tone) => `
            <div style="min-width: 0;">
              <div style="font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--color-neutral-600); margin-bottom: 4px;">${esc(label)}</div>
              <div style="font-family: var(--font-heading); font-size: 17px; line-height: 1.15; overflow-wrap: anywhere;${tone ? ` color: ${tone};` : ''}">${esc(value)}</div>
            </div>`;

  const good = 'var(--color-accent-700)';

  const list = (kicker, items) => !items.length ? '' : `
          <div style="margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--color-divider);">
            <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 8px;">${esc(kicker)}</div>
            <ul style="margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; line-height: 1.55; color: var(--color-neutral-800);">
              ${items.map((t) => `<li>${esc(t)}</li>`).join('')}
            </ul>
          </div>`;

  return `
          <div style="font-family: var(--font-heading); font-size: 21px; line-height: 1.25; margin-bottom: 3px;">${esc(f.headline)}</div>
          <div style="font-size: 11.5px; color: var(--color-neutral-600); margin-bottom: 14px;">${esc(f.coverageLabel)}${f.trendLabel ? ` · ${esc(f.trendLabel)} on the previous ${f.days} days` : ''}</div>

          <div class="fin-stats">
            ${tile('Out', f.outLabel)}
            ${tile('In', f.inLabel)}
            ${tile('Net', f.netLabel, f.netUp ? good : 'var(--color-text)')}
            ${tile('Kept', f.rateLabel, f.netUp ? good : 'var(--color-text)')}
          </div>

          ${list('What stands out', f.observations)}
          ${list('What might help', f.advice)}
          ${!f.advice.length && f.observations.length ? `
          <div style="margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--color-divider); font-size: 12.5px; color: var(--color-neutral-700);">
            Nothing worth flagging — this reads as a steady stretch.
          </div>` : ''}
          <div style="margin-top: 10px; font-size: 11.5px; line-height: 1.5; color: var(--color-neutral-600);">${esc(DISCLAIMER)}</div>`;
}

/* Both trackers head their reading the same way, and the anchor the Insights
   button scrolls to lives on it. */
function insightsHeading() {
  return `
      <div class="blueprint card-w-head insights-head" data-anchor="insights" style="scroll-margin-top: 78px;">
        ${cardHead('Your Insights, our recommendations',
          'Read from what you logged. Estimates, not measurements — and never a substitute for professional advice.')}
      </div>`;
}

/* The on-page card. The range switch is here rather than in the body because a
   fortnight is what the wording is calibrated for — at a single day most of the
   rules cannot fire at all, so it is worth one tap to get there. */
function insightsCard(v) {
  return `
      <div class="blueprint" style="padding: 20px 22px 24px;">        <div style="display: flex; align-items: baseline; gap: 8px 10px; margin-bottom: 14px; flex-wrap: wrap;">
          <h4 style="margin: 0; margin-right: auto;">Financial Insights</h4>
          ${v.insightAtFortnight
            ? '<span style="font-size: 11px; color: var(--color-neutral-600);">Last 14 days</span>'
            : '<button class="drawer-btn" data-act="range-fortnight" style="font-size: 11px; padding: 5px 13px;">Read 2 weeks</button>'}
        </div>
        ${insightsBody(v, false)}
      </div>`;
}

/* The food block sits between the wellbeing rows and the advice — it is the
   one part built from what you wrote rather than from the clock. */
/* `canRefine` gates the AI button, not the reading. It is offered only where a
   single day is on screen — today, and Looking back when it is showing
   Yesterday. Across a week the detail handed to the model is every meal of
   every day run together, which is a worse question than the local reading
   already answers, and a much more expensive one. */
function foodBlock(food, scope, canRefine) {
  if (!food) return '';
  const ai = food.key ? state.aiCache[food.key] : null;
  const busy = state.aiBusy === scope;

  /* The AI figure replaces the local one rather than sitting beside it. Two
     different totals for the same meal is not a second opinion, it is a
     question the reader cannot answer — so the better one wins and says where
     it came from. The local reading stays available underneath. */
  const line = ai
    ? `Roughly ${ai.kcal.toLocaleString('en-US')} kcal — around ${ai.protein}g protein, ${ai.carbs}g carbs, ${ai.fat}g fat.`
    : food.nutrition;

  const refine = !canRefine || !state.aiEstimates || !food.detail ? '' : `
            <div style="margin-top: 9px; display: flex; align-items: center; gap: 9px; flex-wrap: wrap;">
              <button class="drawer-btn btn-refine" data-act="refine-food" data-scope="${esc(scope)}"${busy ? ' disabled' : ''}>
                ${busy ? '<span class="spinner"></span> Checking…' : (ai ? 'Check again' : 'Refine with AI')}
              </button>
              ${ai ? `<span style="font-size: 11px; color: var(--color-neutral-600);">Local reading was ${food.local.kcal.toLocaleString('en-US')} kcal</span>` : ''}
              ${state.aiError && state.aiBusy === null ? `<span style="font-size: 11px; color: var(--color-text);">${esc(state.aiError)}</span>` : ''}
            </div>`;

  return `
          <div style="margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--color-divider);">
            <div class="wb-kicker">What you ate</div>
            <div class="food-text">${esc(food.observation)}</div>
            ${line ? `<div class="food-text" style="margin-top: 7px;">${esc(line)}${ai ? ' <span style="color: var(--color-neutral-600);">Estimated by AI from what you wrote.</span>' : ''}</div>` : ''}
            ${ai && ai.items && ai.items.length ? `
            <div class="food-items">${ai.items.map((i) => `${esc(i.name)} ~${i.kcal}`).join(' · ')}</div>` : ''}
            <div class="food-text" style="margin-top: 7px;">${esc(food.advice)}</div>
            ${refine}
          </div>`;
}

/* The night behind the day. Sits with the other readings rather than among the
   four pillars: sleep is not an activity, and a fifth card in a grid built for
   four would say it was. */
function sleepBlock(sleep, scope) {
  if (!sleep) return '';
  return `
          <div style="margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--color-divider);">
            <div class="wb-kicker">${scope === 'past' ? 'How you slept' : "Last night's sleep"}</div>
            <div class="food-text">${esc(sleep.headline)}</div>
            ${sleep.detail ? `<div class="food-text" style="margin-top: 7px;">${esc(sleep.detail)}</div>` : ''}
            ${sleep.advice ? `<div class="food-text" style="margin-top: 7px;">${esc(sleep.advice)}</div>` : ''}
          </div>`;
}

/* Asked once, then remembered on this device. The wording is plain about what
   leaves the browser, because "your data stays yours" is on the landing page
   and this is the one place that stops being strictly true. */
function aiConsentDialog() {
  if (!state.aiAsking) return '';
  return `
  <div class="no-print donate-backdrop">
    <div class="donate-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title" style="text-align: left;">
      <button class="donate-x" data-act="ai-decline" aria-label="Close">×</button>
      <div class="donate-kicker">Before we do this</div>
      <h2 id="ai-consent-title" style="margin: 0 0 12px; font-family: var(--font-heading); font-size: 24px; line-height: 1.2;">Send this meal to be estimated?</h2>
      <p style="margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: var(--color-neutral-800);">
        To get a closer figure, the text of what you ate is sent to Anthropic's Claude API, which returns an estimate.
        Only the food description goes — not your name, your account, your dates or anything else you track.
      </p>
      <p style="margin: 0 0 18px; font-size: 13px; line-height: 1.6; color: var(--color-neutral-800);">
        Everything else in ZIMPAN stays as it is: nothing is sent unless you press this button, and the answer is
        kept on this device so the same meal is never sent twice. You can carry on using the built-in estimate instead.
      </p>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="btn btn-primary" data-act="ai-accept">Yes, estimate it</button>
        <button class="btn btn-ghost" data-act="ai-decline">No thanks</button>
      </div>
    </div>
  </div>`;
}

function todayCard(v) {
  return `
      <div class="blueprint" style="padding: 20px 22px 22px;">
        <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;">
          <h4 style="margin: 0;">Today, as it happens</h4>
          <span data-today-kicker style="font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--color-accent-700); margin-left: auto;">${esc(v.todayKicker)}</span>
        </div>
        <div data-live-line style="font-size: 12px; color: var(--color-neutral-600);">${esc(v.todayLive)}</div>
        ${balanceGauges(v.todayFood, v.todayBurn, 'today', todayIso)}
        <div class="wb-status"><span class="wb-kicker">Daily log status</span>${esc(v.todayHeadline)}</div>
        ${v.todayEmpty || !state.drawers.today ? '' : `
          <div class="wb-grid">${dimensionCards(v.todayReadings, 'today')}</div>
          ${sleepBlock(v.todaySleep, 'today')}
          ${foodBlock(v.todayFood, 'today', true)}
          ${adviceBlock(v.todayAdvice)}`}
        ${v.todayEmpty ? '' : drawerToggle('today', 0, '', REPORT_LABELS)}
      </div>`;
}

/* Optional, and the only personal measurement the app asks for. It exists
   solely to scale the burn estimate; leaving it blank costs accuracy, not
   function. */
function weightCard(v) {
  return `
      <div class="blueprint" style="padding: 16px 22px 18px;">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <div style="min-width: 0; flex: 1 1 190px;">
            <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 3px;">Your weight</div>
            <div style="font-size: 12px; line-height: 1.5; color: var(--color-neutral-600);">
              Optional. Used only to sharpen the calorie-burn estimate${state.weightKg ? '' : ' — an average build is assumed until you set it'}.
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 7px; flex: none;">
            <input class="input" type="number" min="20" max="400" step="1" inputmode="numeric"
              data-k="weight-kg" data-act="set-weight" placeholder="70"
              value="${state.weightKg || ''}" style="width: 84px; text-align: right;">
            <span style="font-size: 12.5px; color: var(--color-neutral-600);">kg</span>
          </div>
        </div>
      </div>`;
}

function pastCard(v) {
  return `
      <div class="blueprint" style="padding: 20px 22px 22px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;">
          <h4 style="margin: 0;">Looking back</h4>
          <!-- The same window the chart above runs on, reachable from down
               here too. "Yesterday" rather than "Day": this section only ever
               counts days that have finished. -->
          <div style="margin-left: auto;">${segRange('lookrange', ['Yesterday', 'Week', '2 Weeks', 'Month'])}</div>
        </div>
        <div style="font-size: 12px; color: var(--color-neutral-600); margin-bottom: 12px;">${esc(v.pastLabel)}</div>
        <div style="font-size: 13.5px; line-height: 1.6;">${esc(v.pastHeadline)}</div>
        ${v.pastBusiest ? `<div style="font-size: 12.5px; line-height: 1.6; color: var(--color-neutral-700); margin-top: 4px;">${esc(v.pastBusiest)}</div>` : ''}
        ${balanceGauges(v.pastFood, v.pastBurn, 'past', v.pastSingleDate)}
        ${v.pastEmpty || !state.drawers.lookback ? '' : `
        <div style="display: flex; flex-direction: column; gap: 8px; margin: 16px 0 18px;">
          ${v.pastTop.map((t) => `
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 4px;">
                <span>${esc(withIcon(t.name))}</span>
                <span style="color: var(--color-neutral-700); font-variant-numeric: tabular-nums;">${esc(t.label)} · ${esc(t.pct)}</span>
              </div>
              <div style="height: 5px; background: var(--track);">
                <div style="height: 100%; width: ${t.width}; background: ${esc(t.color)};"></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="wb-grid">${dimensionCards(v.pastReadings, 'past')}</div>
        ${sleepBlock(v.pastSleep, 'past')}
        ${foodBlock(v.pastFood, 'past', !!v.pastSingleDate)}
        ${adviceBlock(v.pastAdvice)}`}
        ${v.pastEmpty ? '' : drawerToggle('lookback', 0, '', REPORT_LABELS)}
      </div>`;
}

/* One entry method on screen at a time. The timer and the manual form do the
   same job by different routes, and showing both doubled the height of the
   page for no gain. */
function entryModeBar() {
  const pill = (mode, label) => {
    const on = state.entryMode === mode;
    return `<button data-act="entry-mode-${mode}" aria-pressed="${on}" style="
      border: 1px solid var(--color-accent-700);
      background: ${on ? 'var(--color-accent-700)' : 'transparent'};
      color: ${on ? '#fff' : 'var(--color-accent-900)'};
      font-family: var(--font-body); font-size: 13.5px; font-weight: 600;
      padding: 9px 22px; border-radius: 999px; cursor: pointer;
      transition: background-color .15s ease, color .15s ease;">${esc(label)}</button>`;
  };
  return `
      <div data-anchor="entry" style="scroll-margin-top: 78px;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
          ${pill('timer', 'Track Real Time')}
          ${pill('manual', 'Manual Entry')}
          <button data-act="open-new-cat" style="border:0;background:transparent;padding:6px 4px;font:inherit;font-size:13px;color:var(--color-accent-700);cursor:pointer;">Add a category +</button>
        </div>
        ${state.newCatOpen ? `
          <div class="blueprint" style="margin-top: 12px; padding: 14px 18px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 12px; color: var(--color-neutral-700); flex: none;">Name your new category</span>
            <input class="input" data-k="new-cat" data-sync="newCatName" data-enter="create-cat" style="flex: 1 1 200px; min-width: 160px;" placeholder="e.g. Side hustle" value="${esc(state.newCatName)}">
            <button class="btn btn-secondary" data-act="create-cat">Create</button>
            <button class="btn btn-ghost" data-act="cancel-cat">Cancel</button>
          </div>` : ''}
      </div>`;
}

function timerCard(v) {
  return `
      <div class="blueprint timer-card" style="padding: 20px 22px;">        <div>
          <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 4px;">Real Time Tracking</div>
          <div data-clock style="font-family: var(--font-heading); font-size: 46px; line-height: 1; font-variant-numeric: tabular-nums;">${v.clock}</div>
          ${v.timerSince ? `<div style="font-size: 11px; color: ${v.timerStale ? 'var(--color-text)' : 'var(--color-neutral-600)'}; margin-top: 5px;">${esc(v.timerSince)}${v.timerStale ? ' · still running — did you forget to stop it?' : ''}</div>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; min-width: 0;">
          <input class="input" data-k="timer-activity" data-sync="timerActivity" placeholder="What are you doing right now?" value="${esc(state.timerActivity)}"${state.formError.timer ? ' aria-invalid="true"' : ''}>
          ${fieldError('timer')}
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${timerChips().map((c) => `<button data-act="pick-timer-cat" data-name="${esc(c.name)}" style="${chipStyle(state.timerCategory === c.name, c.color)}">${esc(catIcon(c.name))} ${esc(c.name)}</button>`).join('')}
            <button class="chip-add" data-act="add-cat-jump">+ Add a Category</button>
          </div>
          ${state.categories.length > CHIPS_COLLAPSED
            ? drawerToggle('categories', state.categories.length - CHIPS_COLLAPSED, 'categories')
            : ''}
        </div>
        <button class="timer-btn" data-act="toggle-timer" style="${timerBtnStyle(!!state.timerStart)}">${v.timerBtnLabel}</button>
      </div>`;
}

function addEntryCard(v) {
  return `
      <div class="blueprint" style="padding: 18px 22px 20px;">        <div style="display: flex; align-items: baseline; gap: 4px 10px; margin-bottom: 14px; flex-wrap: wrap;">
          <h4 style="margin: 0;">Add an entry by hand</h4>
          <span style="font-size: 12px; color: var(--color-neutral-600);">Date and time are filled in from where you are — change anything you like.</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: end;">
          <div class="field" style="flex: 1 1 150px; min-width: 140px;"><label>Date</label><input class="input" type="date" data-k="form-date" data-sync="form.date" value="${esc(state.form.date)}"></div>
          <div class="field" style="flex: 3 1 220px; min-width: 180px;"><label>Activity</label><input class="input" data-k="form-activity" data-sync="form.activity" placeholder="e.g. Wash car" value="${esc(state.form.activity)}"${state.formError.entry ? ' aria-invalid="true"' : ''}></div>
          <div class="field" style="flex: 2 1 180px; min-width: 160px;"><label>Category</label>
            <select class="input" data-act="form-category">${options(state.categories.map((c) => c.name), state.form.category, '<option value="__new">+ New category…</option>')}</select>
          </div>
          <!-- From and To share a wrapper so they wrap as a pair. Left as
               siblings they split across lines the moment the row runs out of
               width, which reads as two unrelated fields. -->
          <div style="display: flex; gap: 10px; flex: 1 1 246px; min-width: 216px;">
            <div class="field" style="flex: 1 1 0; min-width: 0;"><label>From</label><input class="input" type="time" data-k="form-from" data-sync="form.from" data-live-dur value="${esc(state.form.from)}"></div>
            <div class="field" style="flex: 1 1 0; min-width: 0;"><label>To</label><input class="input" type="time" data-k="form-to" data-sync="form.to" data-live-dur value="${esc(state.form.to)}"></div>
          </div>
          <div class="field" style="flex: 0 1 100px; min-width: 92px;"><label>Time spent</label><div data-form-duration style="height: 36px; display: flex; align-items: center; font-size: 14px; font-variant-numeric: tabular-nums; color: var(--color-accent-700);">${esc(v.formDuration)}</div></div>
          <button class="btn btn-primary" data-act="add-entry" style="height: 36px;">Add entry</button>
        </div>
        ${fieldError('entry')}
      </div>`;
}

/* A solid bar rather than a line of text, so a section announces itself on a
   phone where everything else is a white card on a white page. Declared as a
   function so call order does not matter, and drawn from the accent tokens so
   it follows the money tracker into green without a second rule.

   `meta` and `right` are inserted as markup — callers escape their own text. */
function cardHead(title, meta, right) {
  return `
        <div class="card-head">
          <div class="card-head-main">
            <h4>${esc(title)}</h4>
            ${meta ? `<span class="card-head-meta">${meta}</span>` : ''}
          </div>
          ${right ? `<div class="card-head-right">${right}</div>` : ''}
        </div>`;
}

function dayNav(v, countLabel) {
  return cardHead(v.dayHeading, countLabel, `
            <button class="head-btn" data-act="prev-day" title="Previous day" aria-label="Previous day">‹</button>
            <button class="head-btn" data-act="next-day" title="Next day" aria-label="Next day">›</button>`);
}

const ROWS_COLLAPSED = 5;

function timeTableCard(v) {
  const visible = state.drawers.activities || v.dayList.length <= ROWS_COLLAPSED
    ? v.dayList
    : v.dayList.slice(0, ROWS_COLLAPSED);
  /* A card per entry, gathered under the category it belongs to and laid out
     two columns wide at every width. Grouping rather than following the clock:
     the list flows down one column and up the next, so a tab that labelled a
     run of consecutive rows would be separated from most of its run. Each
     category is one block instead, kept whole, and the select inside a card
     still moves that one entry to another group. */
  const groups = [];
  const byCategory = new Map();
  visible.forEach((e) => {
    let g = byCategory.get(e.category);
    if (!g) { g = { category: e.category, rows: [] }; byCategory.set(e.category, g); groups.push(g); }
    g.rows.push(e);
  });

  const card = (e) => {
    const spent = span(e);
    const tint = colorOf(e.category);
    const energy = entryEnergy(e);
    return `
                <div class="entry-card">
                  <input class="entry-name" data-k="r-${esc(e.id)}-a" data-change="entry-activity" data-id="${esc(e.id)}" value="${esc(e.activity)}" title="${esc(e.activity)}${e.note ? ` — ${esc(e.note)}` : ''}">
                  <div class="entry-controls">
                    <button class="cell-note" data-act="note-edit" data-kind="entries" data-id="${esc(e.id)}" title="${e.note ? esc(e.note) : 'Add a note for this entry'}"${e.note ? ' data-has-note' : ''}>${e.note ? 'Note' : 'Add note'}</button>
                    <select class="entry-select" data-change="entry-category" data-id="${esc(e.id)}" style="${rowChipStyle(tint)}">${options(state.categories.map((c) => c.name), e.category)}</select>
                  </div>
                  <div class="entry-times">
                    <span class="entry-time"><span class="entry-leg">From</span><input class="cell-time" type="time" data-change="entry-from" data-id="${esc(e.id)}" value="${hm(e.from)}"></span>
                    <span class="entry-rule"></span>
                    <span class="entry-time"><span class="entry-leg">To</span><input class="cell-time" type="time" data-change="entry-to" data-id="${esc(e.id)}" value="${hm(e.to)}"></span>
                  </div>
                  <div class="entry-foot">
                    <span class="entry-dur">${esc(dur(spent))}</span>
                    ${energy ? `<span class="entry-kcal" data-kind="${energy.kind}" title="A rough estimate from what you logged${energy.kind === 'burn' ? ' and your weight' : ''}">${esc(energy.label)}</span>` : ''}
                    <button class="cell-del" data-act="entry-remove" data-id="${esc(e.id)}" title="Delete entry" aria-label="Delete entry">×</button>
                  </div>
                </div>`;
  };

  const rows = groups.map((g) => `
              <div class="entry-group">
                <div class="entry-tab" style="background: ${esc(colorOf(g.category))};">${esc(withIcon(g.category))}</div>
                ${g.rows.map(card).join('')}
              </div>`).join('');

  return `
      <div class="blueprint card-w-head">
        ${dayNav(v, `${esc(v.dayTotalLabel)} logged across ${v.dayList.length} entries`)}
        <div class="card-body">
          <div class="entry-list">${rows}</div>
          ${v.dayList.length > ROWS_COLLAPSED ? drawerToggle('activities', v.dayList.length - ROWS_COLLAPSED, 'entries') : ''}
          ${v.dayList.length === 0 ? '<div style="padding: 22px 0 24px; text-align: center; font-size: 13px; color: var(--color-neutral-600);">Nothing logged yet — start the timer, or add a row above.</div>' : ''}
        </div>
      </div>`;
}

function timelineCard(v) {
  return `
      <div class="blueprint card-w-head">
        ${cardHead('Your day, end to end', '6 AM to 10 PM · gaps are time you didn\'t log')}
        <div class="card-body">
        <!-- The unlogged ground is a wash of the accent rather than bare grey,
             and the hour ticks a stronger tint of the same. -->
        <div style="position: relative; height: 34px; border-radius: 8px; overflow: hidden;
                    background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 34%, transparent) 0 1px, transparent 1px 100%), var(--track);
                    border: 1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);">
          ${v.timeline.map((s) => `<div title="${esc(s.title)}" style="position: absolute; top: 0; bottom: 0; left: ${s.left}; width: ${s.width}; background: ${esc(s.color)};"></div>`).join('')}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--color-neutral-600); margin-top: 6px; font-variant-numeric: tabular-nums;">
          <span>6 AM</span><span>10 AM</span><span>2 PM</span><span>6 PM</span><span>10 PM</span>
        </div>
        </div>
      </div>`;
}

function timeDesktop(v) {
  return `
  <div data-page-grid style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 28px; padding: 28px; max-width: 1560px; margin: 0 auto; align-items: start;">

    <div class="col">
      <div data-sec="entry">${entryModeBar()}</div>
      <div data-sec="entrycard">${state.entryMode === 'manual' ? addEntryCard(v) : timerCard(v)}</div>
      <div data-sec="log">${timeTableCard(v)}</div>
      <div data-sec="ins-head">${insightsHeading()}</div>
      <div data-sec="ins-today">${todayCard(v)}</div>
      <div data-sec="ins-past">${pastCard(v)}</div>
      <div data-sec="ins-weight">${weightCard(v)}</div>
    </div>

    <div class="col">

      <div class="blueprint card-w-head" data-sec="chart">
        ${cardHead('Where the time went', '', segRange('range', ['Day', 'Week', '2 Weeks', 'Month']))}
        <div class="card-body">
        <div class="chart-row" style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          ${donut(v, 190, 34, 27)}
          <div style="display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0;">${legend(v)}</div>
        </div>
        </div>
      </div>

      <div class="blueprint card-w-head" data-sec="board">
        ${cardHead('Leaderboard', 'Where the hours actually go')}
        <div class="card-body">
          <div style="display: flex; flex-direction: column; gap: 13px;">${bars(v)}</div>
        </div>
      </div>

      <div data-sec="stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 22px;">
        <div class="blueprint" style="padding: 18px 20px 20px;">          <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 8px;">Untracked</div>
          <div style="font-family: var(--font-heading); font-size: 32px; line-height: 1;">${esc(v.untracked)}</div>
          <div style="font-size: 12px; color: var(--color-neutral-600); margin-top: 8px;">${esc(v.untrackedNote)}</div>
        </div>
        <div class="blueprint" style="padding: 18px 20px 20px;">          <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 8px;">Streak</div>
          <div style="font-family: var(--font-heading); font-size: 32px; line-height: 1;">${esc(v.streakLabel)}</div>
          <div style="font-size: 12px; color: var(--color-neutral-600); margin-top: 8px;">${esc(v.streakNote)}</div>
        </div>
      </div>

      <div data-sec="timeline">${timelineCard(v)}</div>
    </div>
  </div>`;
}

function moneyDesktop(v) {
  const rows = v.mDayList.map((e) => `
              <tr>
                <td data-col="activity"><input class="cell-input" data-k="mr-${esc(e.id)}-a" data-change="money-activity" data-id="${esc(e.id)}" value="${esc(e.activity)}"${e.note ? ` title="${esc(e.note)}"` : ''}><button class="cell-note" data-act="note-edit" data-kind="money" data-id="${esc(e.id)}" title="${e.note ? esc(e.note) : 'Add a note for this entry'}"${e.note ? ' data-has-note' : ''}>${e.note ? 'Note' : 'Add note'}</button></td>
                <td data-col="purpose"><select data-change="money-purpose" data-id="${esc(e.id)}" style="${rowChipStyle(purposeColor(e.purpose))}">${options(state.purposes.map((p) => p.name), e.purpose)}</select></td>
                <td data-col="in" data-label="Received" style="text-align: right;"><input class="cell-num is-in" type="number" min="0" step="0.01" placeholder="0" data-change="money-in" data-id="${esc(e.id)}" value="${e.in || ''}"></td>
                <td data-col="out" data-label="Spent" style="text-align: right;"><input class="cell-num" type="number" min="0" step="0.01" placeholder="0" data-change="money-out" data-id="${esc(e.id)}" value="${e.out || ''}"></td>
                <td data-col="remove" style="text-align: right;"><button class="cell-del" data-act="money-remove" data-id="${esc(e.id)}" title="Delete entry">×</button></td>
              </tr>`).join('');

  const stat = (kicker, value, note, color) => `
        <div class="blueprint" style="padding: 18px 20px 20px;">          <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 8px;">${kicker}</div>
          <div style="font-family: var(--font-heading); font-size: 32px; line-height: 1;${color ? ` color: ${color};` : ''}">${esc(value)}</div>
          <div style="font-size: 12px; color: var(--color-neutral-600); margin-top: 8px;">${esc(note)}</div>
        </div>`;

  return `
  <div data-page-grid style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 28px; padding: 28px; max-width: 1560px; margin: 0 auto; align-items: start;">

    <div style="display: flex; flex-direction: column; gap: 22px; min-width: 0;">

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 22px;">
        ${stat('Money in', v.moneyIn, v.rangeLabel)}
        ${stat('Money out', v.moneyOut, `across ${v.moneyOutCount} entries`)}
        ${stat('Net', v.moneyNet, v.netNote, v.netColor)}
      </div>

      <div class="blueprint" style="padding: 18px 22px 20px;">        <div style="display: flex; align-items: baseline; gap: 4px 10px; margin-bottom: 14px; flex-wrap: wrap;">
          <h4 style="margin: 0;">Log money</h4>
          <span style="font-size: 12px; color: var(--color-neutral-600); margin-right: auto;">Today's date is filled in for you — change it, and fill either column.</span>
          <label style="display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--color-neutral-700);">
            Currency
            <select class="input" data-act="set-currency" style="width: auto; height: 32px; padding-block: 0;">
              ${CURRENCIES.map((c) => `<option value="${esc(c.code)}"${c.code === state.currency ? ' selected' : ''}>${esc(c.label)} (${esc(c.symbol.trim())})</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: end;">
          <div class="field" style="flex: 1 1 150px; min-width: 140px;"><label>Date</label><input class="input" type="date" data-k="m-date" data-sync="mForm.date" value="${esc(state.mForm.date)}"></div>
          <div class="field" style="flex: 3 1 220px; min-width: 180px;"><label>Activity</label><input class="input" data-k="m-activity" data-sync="mForm.activity" placeholder="e.g. Grocery run" value="${esc(state.mForm.activity)}"${state.formError.money ? ' aria-invalid="true"' : ''}></div>
          <div class="field" style="flex: 2 1 190px; min-width: 170px;"><label>Purpose</label>
            <select class="input" data-act="m-purpose">${options(state.purposes.map((p) => p.name), state.mForm.purpose, '<option value="__new">+ New purpose…</option>')}</select>
          </div>
          <div class="field" style="flex: 0 1 130px; min-width: 118px;"><label>Received</label><input class="input" type="number" min="0" step="0.01" placeholder="0" data-k="m-in" data-sync="mForm.in" value="${esc(state.mForm.in)}"></div>
          <div class="field" style="flex: 0 1 130px; min-width: 118px;"><label>Spent</label><input class="input" type="number" min="0" step="0.01" placeholder="0" data-k="m-out" data-sync="mForm.out" value="${esc(state.mForm.out)}"></div>
          <button class="btn btn-primary" data-act="add-money" style="height: 36px;">Add entry</button>
        </div>
        ${fieldError('money')}
        ${state.newPurposeOpen ? `
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--color-divider);">
            <span style="font-size: 12px; color: var(--color-neutral-700);">Name your new purpose</span>
            <input class="input" data-k="new-purpose" data-sync="newPurposeName" data-enter="create-purpose" style="width: 220px;" placeholder="e.g. Tuition" value="${esc(state.newPurposeName)}">
            <button class="btn btn-secondary" data-act="create-purpose">Create</button>
            <button class="btn btn-ghost" data-act="cancel-purpose">Cancel</button>
          </div>` : ''}
      </div>

      <div class="blueprint" style="padding: 18px 22px 8px;">        ${dayNav(v, `${v.mDayList.length} entries`)}
        <div class="rows-scroll">
        <table class="table rows">
          <thead><tr><th style="width: 34%">Activity</th><th style="width: 26%">Purpose</th><th style="width: 18%; text-align: right;">Received</th><th style="width: 18%; text-align: right;">Spent</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>
        ${v.mDayList.length === 0 ? '<div style="padding: 26px 0 30px; text-align: center; font-size: 13px; color: var(--color-neutral-600);">Nothing logged for this day yet.</div>' : ''}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 22px; min-width: 0;">
      <div class="blueprint" style="padding: 20px 22px 24px;">        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap;">
          <h4 style="margin: 0; margin-right: auto;">Where the money went</h4>
          ${segRange('mrange2', ['Day', 'Week', '2 Weeks', 'Month'])}
        </div>
        <div class="chart-row" style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          ${donut(v, 190, 34, 24)}
          <div style="display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0;">${legend(v)}</div>
        </div>
      </div>

      ${insightsHeading()}
      ${insightsCard(v)}

      <div class="blueprint" style="padding: 18px 22px 22px;">        <h4 style="margin: 0 0 14px;">Biggest purposes</h4>
        <div style="display: flex; flex-direction: column; gap: 13px;">${bars(v)}</div>
      </div>
    </div>
  </div>`;
}

/* ── sharing ──

   A report has no URL to send: the data belongs to one account and is never
   published, so there is nothing for a recipient to open. What travels is a
   text digest — the same figures the sheet leads with, written to be readable
   in a chat window. The image stays a download, because neither wa.me nor
   mailto can carry a file. */

const SHARE_ICONS = {
  whatsapp: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false" style="display:block;flex:none;"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 1 1-4.2 15.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-2.6 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2s.9 2.3 1 2.5c.1.2 1.7 2.8 4.3 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.15-1.2-.05-.1-.2-.2-.45-.3l-1.6-.8c-.2-.1-.4-.15-.55.1l-.75 1c-.15.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.35-1.7c-.15-.25 0-.4.1-.5l.4-.5c.1-.15.15-.25.2-.4a.4.4 0 0 0 0-.4l-.8-1.9c-.2-.45-.4-.4-.55-.4Z"/></svg>`,
  email: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;flex:none;"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 8.1 5.4a1.6 1.6 0 0 0 1.8 0L21 7"/></svg>`
};

function reportShareText(v) {
  const isMoney = v.isMoney;
  const lines = [];
  lines.push(`ZIMPAN — ${isMoney ? 'Money' : 'Time'} report`);
  lines.push(v.reportRange);
  lines.push('');

  if (isMoney) {
    lines.push(`Spent: ${v.moneyOut} across ${v.moneyOutCount} entries`);
    lines.push(`Received: ${v.moneyIn} · Net: ${v.moneyNet}`);
  } else {
    lines.push(`Tracked: ${v.rangeTotal} across ${v.reportEntryCount} entries`);
  }

  const top = v.reportRows.slice(0, 5);
  if (top.length) {
    lines.push('');
    lines.push(isMoney ? 'Where it went:' : 'Where the time went:');
    top.forEach((r, i) => lines.push(`${i + 1}. ${r.name} — ${r.time} (${r.pct})`));
  }

  /* One line of the reading, so the message says something the table does not.
     The money side has the insight block; the time side has its advice list. */
  /* Advice on the time side is an object now, not a string — reading it as one
     would send "[object Object]" to whoever the report was shared with. */
  const note = isMoney
    ? (v.moneyInsight && v.moneyInsight.observations[0]) || ''
    : (v.pastAdvice && v.pastAdvice[0] && `${v.pastAdvice[0].lead}. ${v.pastAdvice[0].text}`) || '';
  if (note) { lines.push(''); lines.push(note); }

  lines.push('');
  lines.push('Tracked with ZIMPAN · https://zimpan.com');
  return lines.join('\n');
}

/* Every entry in range, day by day. `break-inside: avoid` keeps a day's block
   from being split across pages when this goes to PDF. */
function reportActivities(v) {
  if (!v.reportEntryCount) {
    return `
          <div style="margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--color-divider); font-size: 13px; color: var(--color-neutral-600);">
            No activities logged in this range.
          </div>`;
  }

  // Sits under the activity, indented to the same column, so a day still scans
  // as a list of entries rather than a wall of prose.
  const noteLine = (r, indent) => (r.note ? `
              <div class="ract-note" style="padding: 0 0 6px ${indent}px; margin-top: -2px; border-bottom: 1px solid var(--color-neutral-200); break-inside: avoid;">
                <span style="font-size: 11.5px; line-height: 1.5; color: var(--color-neutral-700);">${esc(r.note)}</span>
              </div>` : '');

  /* Classed so the mobile rules can restack these. The fixed columns add up to
     more than a phone is wide, which is what made them collide. */
  const row = (r) => (v.isMoney ? `
              <div class="ract" style="display: flex; gap: 12px; align-items: baseline; padding: 6px 0; ${r.note ? '' : 'border-bottom: 1px solid var(--color-neutral-200);'} break-inside: avoid;">
                <span class="ract-what" style="flex: 1; min-width: 0; font-size: 13px;">${esc(r.activity)}</span>
                <span class="ract-cat" style="flex: 0 0 168px; display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--color-neutral-700);"><span style="width: 8px; height: 8px; flex: none; background: ${esc(r.color)};"></span>${esc(withIcon(r.name))}</span>
                <span class="ract-amt" style="flex: 0 0 88px; text-align: right; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--color-accent-700);">${esc(r.in)}</span>
                <span class="ract-amt" style="flex: 0 0 88px; text-align: right; font-size: 12.5px; font-variant-numeric: tabular-nums;">${esc(r.out)}</span>
              </div>${noteLine(r, 0)}` : `
              <div class="ract" style="display: flex; gap: 12px; align-items: baseline; padding: 6px 0; ${r.note ? '' : 'border-bottom: 1px solid var(--color-neutral-200);'} break-inside: avoid;">
                <span class="ract-when" style="flex: 0 0 132px; font-size: 11.5px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums;">${esc(r.when)}</span>
                <span class="ract-what" style="flex: 1; min-width: 0; font-size: 13px;">${esc(r.activity)}</span>
                <span class="ract-cat" style="flex: 0 0 150px; display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--color-neutral-700);"><span style="width: 8px; height: 8px; flex: none; background: ${esc(r.color)};"></span>${esc(withIcon(r.name))}</span>
                <span class="ract-amt" style="flex: 0 0 62px; text-align: right; font-size: 12.5px; font-variant-numeric: tabular-nums;">${esc(r.out)}</span>
              </div>${noteLine(r, 144)}`);

  return `
          <div style="margin-top: 34px;">
            <div style="display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--color-divider); padding-bottom: 10px;">
              <div style="font-family: var(--font-heading); font-size: 18px; margin-right: auto;">Every activity</div>
              <div style="font-size: 12px; color: var(--color-neutral-700);">${v.reportEntryCount} ${v.reportEntryCount === 1 ? 'entry' : 'entries'} · ${esc(v.reportRange)}</div>
            </div>
            ${v.reportDays.map((d) => `
            <div style="margin-top: 20px; break-inside: avoid;">
              <div style="display: flex; align-items: baseline; gap: 10px; padding-bottom: 5px; border-bottom: 1px solid var(--color-divider);">
                <span style="font-family: var(--font-heading); font-size: 14px;">${esc(d.label)}</span>
                <span style="margin-left: auto; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--color-neutral-700);">${d.inLabel ? `${esc(d.inLabel)} in · ` : ''}${esc(d.totalLabel)}${v.isMoney ? ' out' : ''}</span>
              </div>
              ${d.rows.map(row).join('')}
            </div>`).join('')}
          </div>`;
}

function reportSheet(v) {
  const rows = v.reportRows.map((r) => `
                <tr>
                  <td><span style="display: inline-flex; align-items: center; gap: 8px;"><span style="width: 10px; height: 10px; background: ${esc(r.color)};"></span>${esc(withIcon(r.name))}</span></td>
                  <td style="text-align: right; font-variant-numeric: tabular-nums;">${r.count}</td>
                  <td style="text-align: right; font-variant-numeric: tabular-nums;">${esc(r.time)}</td>
                  <td style="text-align: right; font-variant-numeric: tabular-nums;">${esc(r.pct)}</td>
                </tr>`).join('');

  return `
    <!-- 50 puts this with the app's other overlays (auth, the note prompt) and,
         crucially, above the fixed chrome: the bottom bar at 45 and the sticky
         header and back-to-top at 46. At its old 40 all three drew on top of
         the sheet, which on a phone meant the header covering its toolbar. -->
    <div class="report-wrap" data-report-backdrop style="position: fixed; inset: 0; background: color-mix(in srgb, var(--color-neutral-900) 55%, transparent); display: flex; align-items: flex-start; justify-content: center; overflow: auto; z-index: 50;">
      <div style="width: 780px; max-width: 100%;">
        <div class="no-print report-tools">
          <span class="report-hint" style="color: var(--color-bg); font-size: 13px; margin-right: auto;">Preview — chart, totals and every activity in range.</span>
          <button class="btn btn-secondary" data-act="export-pdf" style="background: var(--color-bg);">Download PDF</button>
          <button class="btn btn-secondary" data-act="export-jpg" style="background: var(--color-bg);">Download JPG</button>
          <button class="btn btn-secondary" data-act="share-whatsapp" style="background: var(--color-bg);">${SHARE_ICONS.whatsapp}<span>WhatsApp</span></button>
          <button class="btn btn-secondary" data-act="share-email" style="background: var(--color-bg);">${SHARE_ICONS.email}<span>Email</span></button>
          <button class="btn btn-secondary" data-act="close-report" style="background: var(--color-bg);">Close</button>
        </div>
        <div class="report-sheet" id="report-sheet" style="background: var(--color-bg); box-shadow: var(--shadow-lg);">
          <div style="display: flex; align-items: baseline; border-bottom: 1px solid var(--color-divider); padding-bottom: 14px; margin-bottom: 28px;">
            <div style="font-family: var(--font-heading); font-size: 26px; margin-right: auto;">${esc(v.reportTitle)}</div>
            <div style="font-size: 12px; color: var(--color-neutral-700);">${esc(v.reportRange)}</div>
          </div>
          <div style="display: flex; gap: 36px; align-items: center; margin-bottom: 32px; flex-wrap: wrap;">
            <div class="report-donut" style="position: relative; flex: none;">
              <svg viewBox="0 0 200 200" style="width: 100%; height: 100%; transform: rotate(-90deg);">
                <circle cx="100" cy="100" r="72" fill="none" stroke="var(--track)" stroke-width="40"></circle>
                ${v.slices.map((s) => `<circle cx="100" cy="100" r="72" fill="none" stroke="${esc(s.color)}" stroke-width="40" stroke-dasharray="${s.dash}" stroke-dashoffset="${s.offset}"></circle>`).join('')}
              </svg>
              <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                <div style="font-family: var(--font-heading); font-size: ${Math.max(15, Math.min(30, Math.floor(148 / (String(v.rangeTotal).length * 0.54))))}px; line-height: 1.05; white-space: nowrap;">${esc(v.rangeTotal)}</div>
                <div style="font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--color-neutral-600);">tracked</div>
              </div>
            </div>
            <div style="flex: 1 1 240px; min-width: 0;">
              <div style="font-family: var(--font-heading); font-size: 20px; margin-bottom: 8px;">${esc(v.reportHeadline)}</div>
              <div style="font-size: 13px; color: var(--color-neutral-700); line-height: 1.6;">${esc(v.reportNote)}</div>
            </div>
          </div>
          <div style="overflow-x: auto;">
          <table class="table">
            <thead><tr><th>${esc(v.reportColLabel)}</th><th style="text-align: right;">Entries</th><th style="text-align: right;">${esc(v.reportAmountLabel)}</th><th style="text-align: right;">Share</th></tr></thead>
            <tbody>
              ${rows}
              <tr>
                <td style="font-family: var(--font-heading);">${esc(v.reportFooterRowLabel)}</td>
                <td style="text-align: right;">—</td>
                <td style="text-align: right; font-variant-numeric: tabular-nums;">${esc(v.reportFooterRowValue)}</td>
                <td style="text-align: right;">—</td>
              </tr>
            </tbody>
          </table>
          </div>
          ${v.isMoney ? `
          <div style="margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--color-divider); break-inside: avoid;">
            <div style="font-family: var(--font-heading); font-size: 20px; margin-bottom: 12px;">Financial Insights</div>
            ${insightsBody(v, true)}
          </div>` : ''}
          ${reportActivities(v)}
          <div style="margin-top: 30px; font-size: 11px; color: var(--color-neutral-600); display: flex; justify-content: space-between;">
            <span>Generated by ZIMPAN · ${esc(v.geoLabel)}</span><span>${esc(v.nowLabel)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

/* ─────────────────────────── render ─────────────────────────── */

const root = document.getElementById('app');

function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.k) return null;
  let sel = null;
  try { sel = { s: el.selectionStart, e: el.selectionEnd }; } catch (err) { /* not a text field */ }
  return { k: el.dataset.k, sel };
}
function restoreFocus(f) {
  if (!f) return;
  const el = root.querySelector(`[data-k="${f.k}"]`);
  if (!el) return;
  el.focus();
  if (f.sel && f.sel.s != null) { try { el.setSelectionRange(f.sel.s, f.sel.e); } catch (err) { /* ignore */ } }
}

function render() {
  const f = captureFocus();
  /* Every render replaces the whole tree, which collapses the document to
     nothing for an instant and takes the scroll position with it — switching
     the range from down the page threw you back to the top. Captured here and
     put back below; anything that means to move the page (scrollToAnchor, the
     back-to-top button) runs after render and still wins. */
  const scrollY = window.scrollY;

  // Gates, in order: nothing to show before the session is known (unless this
  // browser already has an account and can work offline), then the migration
  // question, then the app itself.
  if (!state.booted && !state.account) { root.innerHTML = splashScreen(); return; }
  if (state.booted && !state.auth) {
    // A reset link has to open its panel directly; there is no landing page
    // journey that leads to it.
    const panelOpen = state.authOpen || state.authMode === 'reset';
    root.innerHTML = landingScreen() + (panelOpen ? authScreen() : '') + legalSheet();
    if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    restoreFocus(f);
    if (panelOpen) mountGoogleButton();
    return;
  }
  if (state.migrateOffer) { root.innerHTML = migrateScreen(); return; }

  const v = compute();
  const body = v.isMoney ? moneyDesktop(v) : timeDesktop(v);

  // data-app re-points the accent custom properties; see the theme block in index.html.
  root.innerHTML = `
<div id="zimpan-progress" class="topbar" style="display:none"><i></i></div>
<div data-app="${state.app}" style="min-height: 100vh; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); padding-bottom: 48px;">
  ${header(v)}
  ${stickyBar(v)}
  ${syncErrorBanner()}
  ${body}
  <div class="no-print" style="padding: 26px 28px 10px; display: flex; align-items: center; gap: 10px 18px; flex-wrap: wrap;">
    ${legalLinks('var(--color-neutral-600)')}
  </div>
  ${focusPanel(v)}
  ${pillarSheet(v)}
  ${stepsSheet()}
  ${state.reportOpen ? reportSheet(v) : ''}
  ${notePromptDialog()}
  ${donateSheet()}
  ${aiConsentDialog()}
  ${legalSheet()}
  ${backToTop()}
  ${mobileNav(v)}
</div>`;

  /* Before focus: restoring focus to a field can itself scroll the page, and
     that scroll is the one worth keeping. */
  if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  restoreFocus(f);
  paintBusy();
  // The tree was just replaced, so the scroll-driven classes have to be put back.
  paintScrollChrome();
  // The dialog exists to be typed in, so put the caret there straight away.
  const note = root.querySelector('[data-k="note-draft"]');
  if (note && document.activeElement !== note) note.focus();

  /* A field an action asked for — the one it just opened, or the one it just
     refused. One shot: clearing it here stops the next unrelated render from
     stealing the caret back. */
  if (state.focusField) {
    const want = root.querySelector(`[data-k="${state.focusField}"]`);
    state.focusField = null;
    if (want) want.focus();
  }
}

/* ── account actions ── */

function setAuthMode(mode) {
  state.authMode = mode;
  state.authError = '';
  state.authNotice = '';
  if (mode !== 'reset') state.authPassword = '';
  render();
}

async function submitForgot() {
  if (state.authBusy) return;
  const email = state.authEmail.trim();
  if (!email) { state.authError = 'Enter the email you signed up with.'; render(); return; }
  state.authBusy = true; state.authError = ''; state.authNotice = ''; render();
  try {
    const res = await API.forgot(email);
    state.authBusy = false;
    state.authNotice = res.message;
    render();
  } catch (err) {
    state.authBusy = false;
    state.authError = err.message || 'Could not send the email. Try again shortly.';
    render();
  }
}

async function submitReset() {
  if (state.authBusy) return;
  if (state.authPassword.length < 10) { state.authError = 'Password must be at least 10 characters.'; render(); return; }
  state.authBusy = true; state.authError = ''; render();
  try {
    const res = await API.reset(state.resetToken, state.authPassword);
    state.authBusy = false;
    state.authPassword = '';
    state.resetToken = '';
    clearResetFromUrl();
    state.auth = res.user;
    flash('Password updated');
    await afterSignIn(res.user);
  } catch (err) {
    state.authBusy = false;
    state.authError = err.message || 'Could not reset the password.';
    render();
  }
}

// Takes the token out of the address bar so it is not left in history or
// copied out of the URL later.
function clearResetFromUrl() {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* not supported */ }
}

async function submitAuth() {
  if (state.authBusy) return;
  const email = state.authEmail.trim();
  const password = state.authPassword;
  if (!email || !password) { state.authError = 'Enter your email and password.'; render(); return; }

  state.authBusy = true; state.authError = ''; render();
  try {
    const res = state.authMode === 'register'
      ? await API.register(email, password)
      : await API.login(email, password);
    state.authBusy = false;
    state.authPassword = '';
    state.auth = res.user;
    await afterSignIn(res.user);
  } catch (err) {
    state.authBusy = false;
    state.authError = err.status === 0 || !err.status
      ? 'Could not reach the server. Check your connection.'
      : err.message;
    render();
  }
}

async function signOut() {
  // Anything still queued would be stranded — flush it before dropping the session.
  if (pendingCount()) { try { await syncNow(); } catch (e) { /* keep it locally */ } }
  try { await API.logout(); } catch (e) { /* the local session goes either way */ }
  // Without this Google silently signs them straight back in on the next visit.
  try { if (window.google) window.google.accounts.id.disableAutoSelect(); } catch (e) { /* not loaded */ }
  state.auth = null;
  state.authEmail = '';
  state.authPassword = '';
  state.authError = '';
  setNet('idle', '');
  render();
}

/* ─────────────────────────── actions ─────────────────────────── */

function setDeep(path, value) {
  const parts = path.split('.');
  if (parts.length === 1) { state[parts[0]] = value; return; }
  state[parts[0]] = Object.assign({}, state[parts[0]], { [parts[1]]: value });
}

/* A row edit commits on `change`, which the browser fires on blur — i.e. in
   the middle of the click that caused the blur. Re-rendering there would tear
   out the button before its click lands, so the row re-render waits for the
   current gesture to finish. */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 0);
}

function updateEntry(id, patch) {
  state.entries = state.entries.map((e) => (e.id === id ? touch('entries', Object.assign({}, e, patch)) : e));
  save(); queueSync(); scheduleRender();
}
function updateMoney(id, patch) {
  state.money = state.money.map((e) => (e.id === id ? touch('money', Object.assign({}, e, patch)) : e));
  save(); queueSync(); scheduleRender();
}
function addCategoryIfNeeded(name) {
  if (!name || state.categories.some((c) => c.name === name)) return;
  state.categories = state.categories.concat([touch('categories', {
    name, color: PALETTE[state.categories.length % PALETTE.length], position: state.categories.length
  })]);
}

// Debounced: typing should not hit localStorage on every keystroke.
let timerSaveTimer = null;
function queueTimerSave() {
  clearTimeout(timerSaveTimer);
  timerSaveTimer = setTimeout(save, 400);
}

function toggleTimer() {
  // Written to disk immediately, so a reload one second later still knows.
  if (!state.timerStart) {
    /* What you are doing is the entry — a timer started without it produces a
       row called "Untitled activity", which is a row nobody can read later. */
    if (!state.timerActivity.trim()) {
      state.formError.timer = 'Say what you are doing before starting the timer.';
      state.focusField = 'timer-activity';
      render();
      return;
    }
    state.formError.timer = '';
    state.timerStart = Date.now(); save(); render(); return;
  }
  const round = CONFIG.roundToMinutes || 1;
  const startD = new Date(state.timerStart), endD = new Date();
  const rnd = (m) => Math.round(m / round) * round;
  const from = rnd(startD.getHours() * 60 + startD.getMinutes());

  /* Taken from the two timestamps rather than from the two wall clocks. Read
     off the clocks, a session that ran from 9PM to 6AM looked like it went
     backwards, and the old `Math.max(to, from + 1)` floor turned nine hours of
     sleep into a one-minute entry. Capped just under a full day: past that the
     clock has lapped and there is no honest reading left. */
  const elapsed = Math.max(1, Math.min(1439, Math.round((endD - startD) / 60000)));
  const to = (from + elapsed) % 1440;
  const overnight = to < from;

  const entry = {
    id: 't' + Date.now(),
    // Dated the morning it ended, so last night's sleep shows up on today.
    date: overnight ? iso(endD) : iso(startD),
    activity: state.timerActivity.trim() || 'Untitled activity',
    category: state.timerCategory,
    from,
    to
  };
  state.entries = state.entries.concat([touch('entries', entry)]);
  state.timerStart = null;
  state.timerActivity = '';
  state.selectedDate = entry.date;
  // Stopping a timer is the natural moment to ask what it was — same rule as a
  // manual entry, including the "skipped this session" suppression.
  askFollowUp('entries', entry);
  save(); queueSync(0); render();
  if (!state.notePrompt) flash(`Saved · ${entry.activity}`);
}

function addEntry() {
  const f = parseHm(state.form.from), t = parseHm(state.form.to);
  /* Both refusals used to be a silent `return`, which looked like the button
     was broken rather than like the form was incomplete. */
  if (!state.form.activity.trim()) {
    state.formError.entry = 'Activity is required — name what you did.';
    state.focusField = 'form-activity';
    render();
    return;
  }
  if (t === f) {
    state.formError.entry = 'From and To are the same time.';
    render();
    return;
  }
  state.formError.entry = '';
  /* To earlier than From means it ran past midnight, the same as the timer —
     and it lands on the morning it ended, not the evening it began. */
  const date = t < f ? nextDay(state.form.date) : state.form.date;
  const entry = touch('entries', { id: 'm' + Date.now(), date, activity: state.form.activity.trim(), category: state.form.category, from: f, to: t, note: '' });
  state.entries = state.entries.concat([entry]);
  state.selectedDate = state.form.date;
  state.form = Object.assign({}, state.form, { activity: '', from: state.form.to, to: '' });
  // The entry is already saved; the follow-up only ever adds to it.
  askFollowUp('entries', entry);
  save(); queueSync(0); render();
  if (!state.notePrompt) flash(`Added · ${entry.activity}`);
}

function addMoney() {
  const inV = money2(state.mForm.in), outV = money2(state.mForm.out);
  if (!state.mForm.activity.trim()) {
    state.formError.money = 'Activity is required — name what the money was for.';
    state.focusField = 'm-activity';
    render();
    return;
  }
  if (!inV && !outV) {
    state.formError.money = 'Fill in either Received or Spent.';
    render();
    return;
  }
  state.formError.money = '';
  const row = touch('money', { id: 'mn' + Date.now(), date: state.mForm.date, activity: state.mForm.activity.trim(), purpose: state.mForm.purpose, in: inV, out: outV, note: '' });
  state.money = state.money.concat([row]);
  state.selectedDate = state.mForm.date;
  state.mForm = Object.assign({}, state.mForm, { activity: '', in: '', out: '' });
  askFollowUp('money', row);
  save(); queueSync(0); render();
  if (!state.notePrompt) flash(`Added · ${row.activity}`);
}

/* Opens the follow-up dialog when a just-added row looks like a workout or a
   meal. Never blocks the entry itself — the row is committed either way.

   Assignment is unconditional: an earlier prompt left in state would otherwise
   survive into the next entry and look like the dialog refusing to close. */
function askFollowUp(kind, row) {
  const q = followUpFor(kind, row);
  state.notePrompt = q && !state.noteSkipped[q.key] ? promptFor(kind, row, q) : null;
  state.noteDraft = '';
}

const promptFor = (kind, row, q) => ({
  kind, id: row.id, key: q.key, title: q.title, hint: q.hint,
  placeholder: q.placeholder, activity: row.activity
});

function closeFollowUp(saveIt) {
  const p = state.notePrompt;
  state.notePrompt = null;
  if (!p) { render(); return; }
  const text = state.noteDraft.trim();
  state.noteDraft = '';
  if (saveIt) {
    // Saving means the question is welcome; it keeps being asked next time.
    if (text) {
      if (p.kind === 'entries') updateEntry(p.id, { note: text.slice(0, 500) });
      else updateMoney(p.id, { note: text.slice(0, 500) });
      return; // updateEntry/updateMoney already save, sync and re-render
    }
  } else if (p.key) {
    // Skipped or dismissed: stop asking this particular question this session.
    state.noteSkipped[p.key] = true;
  }
  render();
}

/* The 📝 on every row opens the same dialog by hand, so notes stay reachable
   after a question has been skipped — and can be edited afterwards. */
function editNote(kind, id) {
  const row = findRow(kind, id);
  if (!row) return;
  const q = followUpFor(kind, row);
  state.notePrompt = {
    kind, id, key: null,
    title: row.note ? 'Edit this note' : (q ? q.title : 'Add a note'),
    hint: q ? q.hint : 'Anything worth remembering about this entry.',
    placeholder: q ? q.placeholder : 'e.g. who you were with, how it went',
    activity: row.activity
  };
  state.noteDraft = row.note || '';
  render();
}

function shiftDay(delta) {
  const d = new Date(state.selectedDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  state.selectedDate = iso(d);
  render();
}

function clearFocus() { state.focus = null; state.focusOpen = false; }

const ACTIONS = {
  // Categories and purposes are separate vocabularies, so a focus never carries
  // across the two trackers.
  'app-time': () => { state.app = 'time'; clearFocus(); render(); },
  'app-money': () => { state.app = 'money'; clearFocus(); render(); },

  'range-day': () => { state.range = 'day'; render(); },
  'range-week': () => { state.range = 'week'; render(); },
  'range-fortnight': () => { state.range = 'fortnight'; render(); },
  'range-month': () => { state.range = 'month'; render(); },

  'prev-day': () => shiftDay(-1),
  'next-day': () => shiftDay(1),

  'toggle-timer': toggleTimer,
  'pick-timer-cat': (el) => { state.timerCategory = el.dataset.name; save(); render(); },

  'add-entry': addEntry,
  'add-money': addMoney,

  // Relabels every amount on the next render; the stored numbers are untouched.
  'set-currency': (el) => {
    state.currency = el.value;
    state.currencyUpdatedAt = Date.now();
    state.dirty.currency = true;
    save(); queueSync(0); render();
  },

  /* ── account ── */
  'auth-open': () => { state.authOpen = true; setAuthMode('login'); },
  'auth-close': () => { state.authOpen = false; state.authError = ''; state.authNotice = ''; render(); },
  'auth-mode-login': () => { setAuthMode('login'); },
  'auth-mode-register': () => { setAuthMode('register'); },
  'auth-mode-forgot': () => { setAuthMode('forgot'); },
  'forgot-submit': submitForgot,
  'reset-submit': submitReset,
  'note-save': () => closeFollowUp(true),
  'note-skip': () => closeFollowUp(false),
  'note-edit': (el) => editNote(el.dataset.kind, el.dataset.id),

  'auth-submit': submitAuth,
  'sign-out': signOut,
  'scroll-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  'scroll-features': () => scrollToAnchor('features'),

  'legal-privacy': () => { state.legalOpen = 'privacy'; render(); },
  'legal-terms': () => { state.legalOpen = 'terms'; render(); },
  'legal-close': () => { state.legalOpen = null; render(); },
  /* First press arms, second press sends. adoptLocalData() stamps every row on
     the device and marks it dirty, so the next sync carries the lot. */
  'resync-all': () => {
    if (!state.auth) return;
    if (!state.resyncArmed) { state.resyncArmed = true; render(); return; }
    state.resyncArmed = false;
    adoptLocalData();
    save();
    /* Deliberately not a count. The confirm quotes entries and money — what a
       person thinks of as their records — while the queue also carries the
       category and purpose lists, so any number here would contradict the one
       they just agreed to. */
    flash('Re-uploading everything on this device');
    render();
    syncNow();
  },
  'resync-cancel': () => { state.resyncArmed = false; render(); },

  /* Consent first, then the call. The scope is held across the dialog so
     accepting continues what was asked for rather than dropping it. */
  'refine-food': (el) => {
    const scope = el.dataset.scope;
    state.aiError = '';
    if (!state.aiConsent) { state.aiAsking = scope; render(); return; }
    refineFood(scope);
  },
  'ai-accept': () => {
    const scope = state.aiAsking;
    state.aiConsent = true;
    state.aiAsking = null;
    writeJson(AI_CONSENT_KEY, true);
    render();
    if (scope) refineFood(scope);
  },
  'ai-decline': () => { state.aiAsking = null; render(); },

  'donate-close': () => { state.donateOpen = false; render(); },
  'donate-go': () => {
    window.open(DONATE_URL, '_blank', 'noopener');
    state.donateOpen = false; render();
  },
  /* `data-jump` is set only on the copies in the sticky bar. Pressed there the
     button is a way back to the form as much as a mode switch, so it scrolls;
     pressed on the form itself it must not move the page under you. */
  'entry-mode-timer': (el) => { state.entryMode = 'timer'; save(); render(); if (el.dataset.jump) scrollToAnchor(el.dataset.jump); },
  'entry-mode-manual': (el) => { state.entryMode = 'manual'; save(); render(); if (el.dataset.jump) scrollToAnchor(el.dataset.jump); },
  // The form opens directly beneath the link, so neither entry mode is disturbed.
  'open-new-cat': () => { state.newCatOpen = !state.newCatOpen; state.newCatName = ''; render(); },

  /* The chip at the end of the timer's category row. Opens the same field the
     "Add a category +" link does, scrolls it into view and lands the caret in
     it — from down among the chips it is otherwise off the top of the screen. */
  'add-cat-jump': () => {
    state.newCatOpen = true;
    state.newCatName = '';
    state.focusField = 'new-cat';
    render();
    scrollToAnchor('entry');
  },

  'set-weight': (el) => {
    const kg = Math.round(Number(el.value));
    state.weightKg = Number.isFinite(kg) && kg >= 20 && kg <= 400 ? kg : null;
    state.weightUpdatedAt = Date.now();
    state.dirty.weight = true;
    save(); queueSync(0); render();
  },

  /* The same weight the card below the gauges sets, reachable from the reading
     it actually changes. Only one copy opens at a time — the two would show the
     same number and disagree the moment one of them was typed in. */
  'weight-open': (el) => {
    state.weightEditOpen = state.weightEditOpen === el.dataset.scope ? null : el.dataset.scope;
    render();
  },
  'weight-close': () => { state.weightEditOpen = null; render(); },

  /* One drawer at a time on a phone. The page is a single column there, so a
     second open drawer pushes the first a long way off screen; on a desktop the
     columns sit side by side and closing one because another opened would be
     arbitrary. Collapsing the others moves the page under the thumb, so the
     button that was just pressed is scrolled back to where it was. */
  'toggle-drawer': (el) => {
    const key = el.dataset.drawer;
    const opening = !state.drawers[key];
    const accordion = opening && isPhone();

    /* Pin the top of the card, not the button. A drawer's content renders above
       its own button, so holding the button still would scroll the page down
       past everything that just appeared — which is the complaint, not the fix.
       Holding the card's top edge means revealed content flows downward into
       view, while a collapse higher up the page cannot jerk the card out from
       under the thumb. */
    const anchor = el.closest('.blueprint') || el;
    const before = anchor.getBoundingClientRect().top;

    if (accordion) Object.keys(state.drawers).forEach((k) => { state.drawers[k] = false; });
    state.drawers[key] = opening;
    save(); render();

    const moved = root.querySelector(`[data-act="toggle-drawer"][data-drawer="${key}"]`);
    const movedCard = moved && (moved.closest('.blueprint') || moved);
    if (movedCard) {
      const delta = movedCard.getBoundingClientRect().top - before;
      if (delta) window.scrollBy(0, delta);
    }
  },
  'scroll-top': () => scrollToAnchor(null),
  'scroll-insights': () => scrollToAnchor('insights'),

  'sync-now': () => { if (state.netState === 'error') setNet('idle', ''); syncNow(); },

  /* Last resort for a change the server will never accept: drop it from the
     outbox so the other queued edits can go up. The row stays on this device —
     only its place in the queue is given up. */
  'sync-discard': () => {
    const row = describeBlockedRow();
    if (!row) return;
    delete state.dirty[row.kind][String(row.key)];
    state.netError = ''; state.netErrorRow = null;
    setNet('idle', '');
    save();
    flash(`Left behind · ${row.label}`);
    syncNow();
  },
  'migrate-upload': () => {
    adoptLocalData();
    state.account = state.auth.email;
    state.migrateOffer = null;
    save(); render(); syncNow();
  },
  'migrate-discard': () => {
    resetLocal();
    state.account = state.auth.email;
    state.migrateOffer = null;
    save(); render(); syncNow();
  },

  'create-cat': () => {
    const n = state.newCatName.trim(); if (!n) return;
    addCategoryIfNeeded(n);
    state.newCatOpen = false; state.newCatName = '';
    state.form = Object.assign({}, state.form, { category: n });
    save(); queueSync(0); render();
  },
  'cancel-cat': () => { state.newCatOpen = false; state.newCatName = ''; render(); },
  'create-purpose': () => {
    const n = state.newPurposeName.trim(); if (!n) return;
    if (!state.purposes.some((p) => p.name === n)) {
      state.purposes = state.purposes.concat([touch('purposes', {
        name: n, color: MONEY_PALETTE[state.purposes.length % MONEY_PALETTE.length], position: state.purposes.length
      })]);
    }
    state.newPurposeOpen = false; state.newPurposeName = '';
    state.mForm = Object.assign({}, state.mForm, { purpose: n });
    save(); queueSync(0); render();
  },
  'cancel-purpose': () => { state.newPurposeOpen = false; state.newPurposeName = ''; render(); },

  // Deletes are soft: the row leaves the list but its id is remembered, or the
  // next pull from another device would restore it.
  'entry-remove': (el) => {
    state.entries = state.entries.filter((e) => e.id !== el.dataset.id);
    bury('entries', el.dataset.id);
    save(); queueSync(0); render();
  },
  'money-remove': (el) => {
    state.money = state.money.filter((e) => e.id !== el.dataset.id);
    bury('money', el.dataset.id);
    save(); queueSync(0); render();
  },

  // A slice names its share; the name is then the handle for the entries.
  /* A slice opens the entries behind it, the same as its legend row does.
     It used to only highlight, leaving the drill-down two clicks away with
     nothing on screen saying where the second one was. */
  'slice-pick': (el) => {
    const n = el.dataset.name;
    if (state.focus === n && state.focusOpen) clearFocus();
    else { state.focus = n; state.focusOpen = true; }
    render();
  },
  'focus-toggle': () => { state.focusOpen = !state.focusOpen; render(); },
  'legend-pick': (el) => {
    const n = el.dataset.name;
    if (state.focus === n && state.focusOpen) clearFocus();
    else { state.focus = n; state.focusOpen = true; }
    render();
  },
  'focus-clear': () => { clearFocus(); render(); },

  'pillar-open': (el) => { state.pillarOpen = { key: el.dataset.key, scope: el.dataset.scope }; render(); },
  'pillar-close': () => { state.pillarOpen = null; render(); },

  'steps-open': (el) => {
    state.stepsOpen = el.dataset.date;
    state.stepsDraft = String(state.steps[el.dataset.date] || '');
    state.focusField = 'steps-count';
    render();
  },
  'steps-close': () => { state.stepsOpen = null; state.stepsDraft = ''; render(); },
  'steps-save': () => {
    const date = state.stepsOpen;
    if (!date) return;
    const n = Math.round(Number(state.stepsDraft));
    // Blank or zero removes the day rather than storing a nought, so the link
    // goes back to offering to add one.
    if (Number.isFinite(n) && n > 0) state.steps[date] = Math.min(200000, n);
    else delete state.steps[date];
    state.stepsOpen = null; state.stepsDraft = '';
    save(); render();
    flash(state.steps[date] ? `Saved · ${state.steps[date].toLocaleString('en-US')} steps` : 'Steps cleared');
  },
  'steps-clear': () => {
    if (state.stepsOpen) delete state.steps[state.stepsOpen];
    state.stepsOpen = null; state.stepsDraft = '';
    save(); render(); flash('Steps cleared');
  },

  'open-report': () => { state.reportOpen = true; render(); },
  'close-report': () => { state.reportOpen = false; render(); },
  'export-pdf': () => window.print(),
  'export-jpg': () => exportJpg(),

  /* Both hand the text to something else to send — nothing leaves the browser
     until the person presses send in WhatsApp or their mail client. */
  'share-whatsapp': () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(reportShareText(compute()))}`, '_blank', 'noopener');
  },
  'share-email': () => {
    const v = compute();
    const subject = `ZIMPAN ${v.isMoney ? 'money' : 'time'} report — ${v.reportRange}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reportShareText(v))}`;
  }
};

const CHANGES = {
  'form-category': (el) => {
    if (el.value === '__new') { state.newCatOpen = true; render(); return; }
    state.form = Object.assign({}, state.form, { category: el.value });
  },
  'm-purpose': (el) => {
    if (el.value === '__new') { state.newPurposeOpen = true; render(); return; }
    state.mForm = Object.assign({}, state.mForm, { purpose: el.value });
  },
  'entry-activity': (el) => updateEntry(el.dataset.id, { activity: el.value }),
  'entry-category': (el) => updateEntry(el.dataset.id, { category: el.value }),
  'entry-from': (el) => updateEntry(el.dataset.id, { from: parseHm(el.value) }),
  'entry-to': (el) => updateEntry(el.dataset.id, { to: parseHm(el.value) }),
  'money-activity': (el) => updateMoney(el.dataset.id, { activity: el.value }),
  'money-purpose': (el) => updateMoney(el.dataset.id, { purpose: el.value }),
  'money-in': (el) => updateMoney(el.dataset.id, { in: money2(el.value) }),
  'money-out': (el) => updateMoney(el.dataset.id, { out: money2(el.value) })
};

/* ─────────────────────────── wiring ─────────────────────────── */

/* A lightbox closes when you click the sheet's surround. Checked before the
   normal delegation and only when the backdrop is itself the thing clicked —
   `closest` would otherwise match it for every click landing inside the sheet
   and close the dialog the moment anyone touched its contents. */
root.addEventListener('click', (ev) => {
  const back = ev.target.closest('[data-backdrop]');
  if (back && ev.target === back) {
    const fn = ACTIONS[back.dataset.backdrop];
    if (fn) { ev.preventDefault(); fn(back); }
  }
});

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  // Radios in the range switch fire their action on `change`, not on click.
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el); }
});

root.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset && el.dataset.change && CHANGES[el.dataset.change]) { CHANGES[el.dataset.change](el); return; }
  if (el.dataset && el.dataset.act) {
    if (CHANGES[el.dataset.act]) { CHANGES[el.dataset.act](el); return; }
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el);
  }
});

/* Which complaint each field answers, so typing into it takes the message
   back down. */
const ERROR_FIELD = { timerActivity: 'timer', 'form.activity': 'entry', 'mForm.activity': 'money' };

// Text fields feed state without re-rendering, so typing is never interrupted.
root.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset || !el.dataset.sync) return;
  setDeep(el.dataset.sync, el.value);

  /* Cleared by hand rather than by re-rendering: a render here would rebuild
     the field under the caret on every keystroke. */
  const scope = ERROR_FIELD[el.dataset.sync];
  if (scope && state.formError[scope]) {
    state.formError[scope] = '';
    const msg = root.querySelector(`[data-err="${scope}"]`);
    if (msg) msg.remove();
    el.removeAttribute('aria-invalid');
  }
  // What you are timing has to survive a reload too, not just the start time.
  if (el.dataset.sync === 'timerActivity') queueTimerSave();
  if (el.hasAttribute('data-live-dur')) {
    const out = root.querySelector('[data-form-duration]');
    if (out) {
      const f = parseHm(state.form.from), t = parseHm(state.form.to);
      out.textContent = t === f ? 'set a time'
        : t > f ? dur(t - f)
        : `${dur(t + 1440 - f)} · next day`;
    }
  }
});

/* Bound to the document, not to #app: a re-render drops focus, and an Escape
   that only works while something inside the app happens to be focused is an
   Escape that does not work. */
document.addEventListener('keydown', (ev) => {
  const el = ev.target;
  if (ev.key === 'Enter' && el.dataset && el.dataset.enter) {
    ev.preventDefault();
    const fn = ACTIONS[el.dataset.enter];
    if (fn) fn(el);
    return;
  }
  // Topmost first: the follow-up dialog sits above the report sheet.
  if (ev.key === 'Escape' && state.notePrompt) { closeFollowUp(false); return; }
  if (ev.key === 'Escape' && state.donateOpen) { state.donateOpen = false; render(); return; }
  if (ev.key === 'Escape' && state.legalOpen) { state.legalOpen = null; render(); return; }
  if (ev.key === 'Escape' && state.authOpen && state.authMode !== 'reset') { state.authOpen = false; render(); return; }
  if (ev.key === 'Escape' && state.stepsOpen) { state.stepsOpen = null; state.stepsDraft = ''; render(); return; }
  if (ev.key === 'Escape' && state.pillarOpen) { state.pillarOpen = null; render(); return; }
  if (ev.key === 'Escape' && state.reportOpen) { state.reportOpen = false; render(); return; }
  if (ev.key === 'Escape' && state.focus) { clearFocus(); render(); }
});

/* ─────────────────────────── JPG export ─────────────────────────── */

/* A context-shaped sink. The sheet is laid out twice — once against this to
   learn how tall it needs to be, then again against the real canvas — so the
   height always matches what actually gets drawn. */
function measuringContext() {
  const noop = () => {};
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', globalCompositeOperation: '',
    fillText: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, arc: noop, closePath: noop, fill: noop,
    /* Estimated from the font size rather than reported as zero. Wrapped
       paragraphs decide their line count from this, and a zero width would
       measure every one of them as a single line — leaving the real canvas too
       short to hold what then gets drawn. The ratio deliberately runs a little
       wide of Barlow's true average: over-estimating costs some blank space at
       the bottom, under-estimating clips the text. */
    measureText: (t) => {
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font || '');
      return { width: String(t).length * (m ? parseFloat(m[1]) : 14) * 0.55 };
    }
  };
  return ctx;
}

/* The sheet has only ever needed single-line clipping; the insight paragraphs
   are the first thing on it that has to flow. Measures as it goes, so it wraps
   to whatever font is currently set on the context. */
function wrapText(x, s, max) {
  const words = String(s).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${line} ${words[i]}`;
    if (x.measureText(next).width > max) { lines.push(line); line = words[i]; }
    else line = next;
  }
  lines.push(line);
  return lines;
}

function clipText(x, s, max) {
  let t = String(s);
  if (!x.measureText || x.measureText(t).width <= max) return t;
  while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/* The sheet's ground. It has to be painted rather than left transparent: the
   export is a JPEG, and anything unpainted arrives as black. */
const SHEET_BG = '#f8f7fb';

/* Draws the whole sheet and returns the y it finished at.
   Everything it prints comes off `v`, the same object reportSheet() renders
   from — the two layouts are drawn by different machinery, so shared wording is
   the only thing keeping the exported image and the preview saying the same
   thing. Re-deriving a label here is how they drift apart. */
function paintReport(x, W, v) {
  const isMoney = v.isMoney;
  const totals = v.totals;
  const total = v.total || 1;
  const accent = isMoney ? '#10756c' : '#5f3ac9';

  x.fillStyle = SHEET_BG; x.fillRect(0, 0, W, 200000);
  x.fillStyle = '#16131f';
  x.font = '600 34px "Playfair Display", serif'; x.fillText(v.reportTitle, 60, 84);
  x.font = '400 14px Barlow, sans-serif'; x.fillStyle = '#575168';
  x.fillText(v.reportRange, 60, 110);
  x.strokeStyle = '#d5d2df'; x.beginPath(); x.moveTo(60, 132); x.lineTo(W - 60, 132); x.stroke();

  const cx = 210, cy = 350, r = 120;
  let a0 = -Math.PI / 2;
  totals.forEach((t) => {
    const a1 = a0 + (t.mins / total) * Math.PI * 2;
    x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r, a0, a1); x.closePath();
    x.fillStyle = t.color; x.fill(); a0 = a1;
  });
  /* A disc in the page colour rather than a destination-out punch. That cut
     through the background fill as well as the ring, and JPEG carries no alpha
     to hold the hole — so the middle of the donut exported as a black circle
     with the total unreadable in dark navy on top of it. */
  x.fillStyle = SHEET_BG;
  x.beginPath(); x.arc(cx, cy, 62, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#16131f'; x.textAlign = 'center';
  x.font = '600 26px "Playfair Display", serif'; x.fillText(v.rangeTotal, cx, cy + 2);
  x.fillStyle = '#756f88'; x.font = '400 10px Barlow, sans-serif';
  x.fillText('TRACKED', cx, cy + 20);
  x.textAlign = 'left';

  /* The reading that sits beside the donut on screen. It went missing from the
     export entirely, which left the image showing the shape of the range
     without the sentence that says what the shape means. */
  let ly = 268;
  x.fillStyle = '#16131f'; x.font = '600 21px "Playfair Display", serif';
  wrapText(x, v.reportHeadline, W - 460).forEach((ln) => { x.fillText(ln, 400, ly); ly += 24; });
  ly += 4;
  x.fillStyle = '#575168'; x.font = '400 13px Barlow, sans-serif';
  wrapText(x, v.reportNote, W - 460).forEach((ln) => { x.fillText(ln, 400, ly); ly += 19; });
  ly += 24;

  totals.forEach((t) => {
    x.fillStyle = t.color; x.fillRect(400, ly - 10, 12, 12);
    x.fillStyle = '#16131f'; x.font = '400 16px Barlow, sans-serif'; x.fillText(clipText(x, withIcon(t.name), 250), 424, ly);
    x.fillStyle = '#575168'; x.fillText(`${Math.round((t.mins / total) * 100)}%  ·  ${v.fmtShort(t.mins)}`, 690, ly);
    ly += 34;
  });

  // Clears the legend rather than assuming it fits — a month can surface far
  // more categories than the original fixed 560 allowed for.
  let ty = Math.max(560, ly + 26);
  x.fillStyle = '#575168'; x.font = '400 12px Barlow, sans-serif';
  x.fillText(v.reportColLabel.toUpperCase(), 60, ty); x.fillText('ENTRIES', 520, ty); x.fillText(v.reportAmountLabel.toUpperCase(), 640, ty); x.fillText('SHARE', 800, ty);
  ty += 12; x.strokeStyle = '#d5d2df'; x.beginPath(); x.moveTo(60, ty); x.lineTo(W - 60, ty); x.stroke();
  ty += 30;
  v.reportRows.forEach((r) => {
    x.fillStyle = '#16131f'; x.font = '400 16px Barlow, sans-serif';
    x.fillText(clipText(x, withIcon(r.name), 430), 60, ty); x.fillText(String(r.count), 520, ty);
    x.fillText(r.time, 640, ty); x.fillText(r.pct, 800, ty);
    ty += 16; x.strokeStyle = '#e8e6ef'; x.beginPath(); x.moveTo(60, ty); x.lineTo(W - 60, ty); x.stroke();
    ty += 26;
  });

  /* The table's last row: untracked time, or money in. It is the one figure on
     the sheet that is not a share of the total, which is why it sits under the
     rule rather than among them — and why leaving it out of the export made the
     numbers look like they should add up to the whole day, and fail to. */
  x.fillStyle = '#16131f'; x.font = '600 18px "Playfair Display", serif';
  x.fillText(v.reportFooterRowLabel, 60, ty);
  x.font = '400 16px Barlow, sans-serif'; x.fillStyle = '#575168';
  x.fillText('—', 520, ty); x.fillText('—', 800, ty);
  x.fillStyle = '#16131f'; x.fillText(v.reportFooterRowValue, 640, ty);
  ty += 16; x.strokeStyle = '#d5d2df'; x.beginPath(); x.moveTo(60, ty); x.lineTo(W - 60, ty); x.stroke();
  ty += 26;

  /* Financial insights. Drawn before the early return below, so a money sheet
     still carries the reading even when there is nothing to itemise under it. */
  if (isMoney && v.moneyInsight) {
    const f = v.moneyInsight;

    ty += 30;
    x.fillStyle = '#16131f'; x.font = '600 22px "Playfair Display", serif';
    x.fillText('FINANCIAL INSIGHTS', 60, ty);
    x.font = '400 12px Barlow, sans-serif'; x.fillStyle = '#575168'; x.textAlign = 'right';
    x.fillText(f.coverageLabel, W - 60, ty);
    x.textAlign = 'left';
    ty += 11;
    x.strokeStyle = '#d5d2df'; x.beginPath(); x.moveTo(60, ty); x.lineTo(W - 60, ty); x.stroke();
    ty += 34;

    x.fillStyle = '#16131f'; x.font = '600 21px "Playfair Display", serif';
    x.fillText(f.headline, 60, ty);
    ty += 30;

    // The same four figures as the card, on one row.
    [['OUT', f.outLabel, false], ['IN', f.inLabel, false], ['NET', f.netLabel, true], ['KEPT', f.rateLabel, true]]
      .forEach((t, i) => {
        const tx = 60 + i * 195;
        x.fillStyle = '#575168'; x.font = '400 11px Barlow, sans-serif';
        x.fillText(t[0], tx, ty);
        x.fillStyle = t[2] ? (f.netUp ? accent : '#16131f') : '#16131f';
        x.font = '600 20px "Playfair Display", serif';
        x.fillText(t[1], tx, ty + 23);
      });
    ty += 52;

    const para = (kicker, items) => {
      if (!items.length) return;
      ty += 14;
      x.fillStyle = accent; x.font = '400 11px Barlow, sans-serif';
      x.fillText(kicker, 60, ty);
      ty += 20;
      x.font = '400 13px Barlow, sans-serif';
      items.forEach((t) => {
        const lines = wrapText(x, t, W - 138);
        x.fillStyle = '#575168'; x.fillText('•', 60, ty);
        x.fillStyle = '#16131f';
        lines.forEach((ln, i) => x.fillText(ln, 78, ty + i * 19));
        ty += lines.length * 19 + 9;
      });
    };

    para('WHAT STANDS OUT', f.observations);
    para('WHAT MIGHT HELP', f.advice);

    ty += 12;
    x.fillStyle = '#756f88'; x.font = '400 11px Barlow, sans-serif';
    const legal = wrapText(x, DISCLAIMER, W - 120);
    legal.forEach((ln, i) => x.fillText(ln, 60, ty + i * 16));
    ty += legal.length * 16 + 10;
  }

  if (!v.reportEntryCount) return ty;

  ty += 30;
  x.fillStyle = '#16131f'; x.font = '600 22px "Playfair Display", serif';
  x.fillText('EVERY ACTIVITY', 60, ty);
  x.font = '400 12px Barlow, sans-serif'; x.fillStyle = '#575168'; x.textAlign = 'right';
  x.fillText(`${v.reportEntryCount} ${v.reportEntryCount === 1 ? 'entry' : 'entries'}`, W - 60, ty);
  x.textAlign = 'left';
  ty += 11;
  x.strokeStyle = '#d5d2df'; x.beginPath(); x.moveTo(60, ty); x.lineTo(W - 60, ty); x.stroke();
  ty += 32;

  v.reportDays.forEach((d) => {
    x.fillStyle = '#16131f'; x.font = '600 17px "Playfair Display", serif';
    x.fillText(d.label, 60, ty);
    x.font = '400 12px Barlow, sans-serif'; x.fillStyle = '#575168'; x.textAlign = 'right';
    x.fillText(`${d.inLabel ? d.inLabel + ' in · ' : ''}${d.totalLabel}${isMoney ? ' out' : ''}`, W - 60, ty);
    x.textAlign = 'left';
    ty += 8;
    x.strokeStyle = '#e8e6ef'; x.beginPath(); x.moveTo(60, ty); x.lineTo(W - 60, ty); x.stroke();
    ty += 22;

    /* Notes indent to the activity column, as they do on screen: a day should
       still scan as a list of entries rather than a wall of prose. */
    const noteX = isMoney ? 60 : 200;

    d.rows.forEach((rw) => {
      x.font = '400 13px Barlow, sans-serif';
      if (isMoney) {
        x.fillStyle = '#16131f'; x.fillText(clipText(x, rw.activity, 310), 60, ty);
        x.fillStyle = rw.color; x.fillRect(392, ty - 8, 8, 8);
        x.fillStyle = '#575168'; x.fillText(clipText(x, withIcon(rw.name), 190), 406, ty);
        x.textAlign = 'right';
        x.fillStyle = accent; x.fillText(rw.in, 730, ty);
        x.fillStyle = '#16131f'; x.fillText(rw.out, W - 60, ty);
        x.textAlign = 'left';
      } else {
        x.fillStyle = '#575168'; x.fillText(rw.when, 60, ty);
        x.fillStyle = '#16131f'; x.fillText(clipText(x, rw.activity, 258), 200, ty);
        x.fillStyle = rw.color; x.fillRect(478, ty - 8, 8, 8);
        x.fillStyle = '#575168'; x.fillText(clipText(x, withIcon(rw.name), 240), 492, ty);
        x.textAlign = 'right';
        x.fillStyle = '#16131f'; x.fillText(rw.out, W - 60, ty);
        x.textAlign = 'left';
      }
      ty += 24;

      // What the entry said about itself. The preview has carried these since
      // notes were added; the export never has.
      if (rw.note) {
        x.font = '400 12px Barlow, sans-serif'; x.fillStyle = '#575168';
        wrapText(x, rw.note, W - 60 - noteX).forEach((ln) => { x.fillText(ln, noteX, ty); ty += 17; });
        ty += 7;
      }
    });
    ty += 18;
  });

  return ty;
}

function exportJpg() {
  // compute() already holds the totals the sheet is drawn from; deriving a
  // second set here was another way for the image to disagree with the preview.
  const v = compute();

  const W = 900;
  const H = Math.max(1160, Math.ceil(paintReport(measuringContext(), W, v)) + 84);

  const cv = document.createElement('canvas');
  cv.width = W * 2; cv.height = H * 2;
  const x = cv.getContext('2d'); x.scale(2, 2);
  paintReport(x, W, v);

  // The same two-ended footer the sheet prints.
  x.fillStyle = '#756f88'; x.font = '400 12px Barlow, sans-serif';
  x.fillText(`Generated by ZIMPAN · ${v.geoLabel}`, 60, H - 40);
  x.textAlign = 'right';
  x.fillText(v.nowLabel, W - 60, H - 40);
  x.textAlign = 'left';

  const a = document.createElement('a');
  a.href = cv.toDataURL('image/jpeg', 0.92);
  a.download = `zimpan-report-${state.selectedDate}.jpg`;
  a.click();
}

/* ─────────────────────────── boot ─────────────────────────── */

// The running clock and the "now" stamp tick without a full re-render.
function tickLive() {
  const c = elapsedClock();
  root.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = c; });
  const now = new Date();
  const n = root.querySelector('[data-now]');
  if (n) n.textContent = now.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // Keeps "Today, as it happens" honest without re-rendering over your typing.
  const live = root.querySelector('[data-live-line]');
  if (live) live.textContent = liveLine();
  const kicker = root.querySelector('[data-today-kicker]');
  if (kicker) {
    const m = now.getHours() * 60 + now.getMinutes();
    const part = m < 720 ? 'Morning' : m < 1020 ? 'Afternoon' : m < 1260 ? 'Evening' : 'Late';
    kicker.textContent = `${part} · ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
}

setInterval(tickLive, 1000);

try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  state.geo = tz ? tz.split('/').pop().replace(/_/g, ' ') : null;
} catch (e) { /* location unavailable — the timezone label still stands in */ }

// A returning device paints from its local copy at once and reconciles behind
// the scenes; only a browser with no account waits on the network.
render();
boot();

// Catches anything the debounce missed — a failed push, or edits made offline.
setInterval(() => { if (state.auth && pendingCount()) syncNow(); }, 60 * 1000);
/* Coming back from a locked screen or another app: the 1s ticker may have been
   frozen the whole time, so repaint at once rather than showing a stale clock
   for up to a second. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  tickLive();
  if (state.auth) syncNow();
});

window.addEventListener('online', () => { if (state.auth) syncNow(); });
window.addEventListener('offline', () => { if (state.auth) setNet('offline', ''); });
