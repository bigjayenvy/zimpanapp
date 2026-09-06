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

/* Rounded here rather than at the call sites. Averages divide, division gives
   fractions, and a fraction of a minute has no meaning on screen — one caller
   forgetting to round is all it takes to print "4h 50.785714m". */
function dur(mins) {
  const n = Math.round(mins);
  if (n <= 0) return '—';
  const h = Math.floor(n / 60), m = n % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return h === 1 ? '1 Hour' : `${h} Hours`;
  return `${m} Minutes`;
}
function durShort(mins) {
  const n = Math.round(mins);
  if (n <= 0) return '—';
  const h = Math.floor(n / 60), m = n % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
/* Currency is a display choice, not a conversion — picking a different one
   relabels the amounts you logged, it does not convert them. */
/* What an account starts on before anyone picks. Changing it moves only new
   accounts: an existing one carries its own choice, and a stored PHP is still
   PHP — the amounts under it were entered as pesos and re-labelling them
   dollars would rewrite what every past entry meant. */
const DEFAULT_CURRENCY = 'USD';

const CURRENCIES = [
  // PHP stays first: currency() falls back to this row, and that fallback is
  // what an account with no stored preference has always resolved to.
  { code: 'PHP', symbol: '₱', label: 'Philippine Peso' },
  // "Dhs" rather than "AED" — the dirham is written the way it is spoken in
  // the shops, and it is the symbol the mobile flow puts on its money tile.
  { code: 'AED', symbol: 'Dhs ', label: 'UAE Dirham' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar' },
  { code: 'HKD', symbol: 'HK$', label: 'Hong Kong Dollar' }
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
  // \bsport, not sport: "Transport" ends in one and is not exercise.
  [/workout|exercise|gym|treadmill|jog|running|\bsport|swim|bike|cycl|yoga|stretch|hike/, '🏃'],
  [/potato|couch|netflix|binge|scroll|telly|\btv\b/, '🛋️'],
  [/family|kids|parent|lola|lolo|anak|reunion/, '👨‍👩‍👧'],
  [/focus|deep work|study|studying|homework|research|thesis/, '🎯'],
  [/chore|laundry|tidy|sweep|dishes|housework/, '🧹'],
  // \bmarket\b keeps "Marketing" out; "supermarket" is spelled out because
  // the boundary would exclude it too.
  [/grocer|palengke|supermarket|\bmarket\b/, '🛒'],
  // Bare "Eat" is the commonest name anyone gives this category and it used
  // to fall through to the fallback, because only "eat out" was listed.
  [/\beat\b|eat out|restaurant|dining|dinner|lunch|breakfast|merienda|food|kain/, '🍽️'],
  [/petrol|fuel|gas station|diesel/, '⛽'],
  // "Transport" is the name most people give this and it matched nothing —
  // it only ever reached the exercise rule by accident, through "sport".
  [/commute|transport|traffic|jeep|tricycle|train|\bbus\b|grab|fare/, '🚌'],
  [/house improve|renovat|repair|paint|carpent|hardware/, '🔨'],
  [/birthday|anniversar|celebrat|fiesta/, '🎂'],
  [/gadget|phone|laptop|computer|tech/, '📱'],
  [/utilit|electric|meralco|water bill|internet|wifi|bill/, '💡'],
  [/appliance|aircon|fridge|washing machine|rice cooker/, '🔌'],
  [/shopping|mall|clothes|shoes/, '🛍️'],
  [/project|freelance|client|side hustle|business/, '🛠️'],
  // \bshow\b, or every Shower is a night at the cinema.
  [/movie|cinema|film|concert|\bshow\b/, '🎬'],
  [/pray|worship|church|mass|bible|devotion|medit|reflect|journal|gratitude|quiet time|retreat/, '🙏'],
  // \brest\b: "Interest" and "Forest" are not naps.
  [/sleep|nap|\brest\b|siesta|recover/, '😴'],
  [/read|book|library/, '📚'],
  [/cook|baking|kitchen/, '🍳'],
  [/wash car|\bcar\b|drive|vehicle|motor/, '🚗'],
  [/email|inbox|admin|paperwork/, '✉️'],
  [/meeting|standup|call|zoom|\bsync\b|1:1|one on one/, '🗓️'],
  // \bbuild\b, so a "Building" category is not filed as software.
  [/code|coding|program|dev\b|\bbuild\b/, '💻'],
  [/school|class|tuition|college|university/, '🎓'],
  [/health|doctor|clinic|medicine|hospital|dentist/, '🏥'],
  // \btea\b, or "Team" and "Teaching" both come out as a hot drink.
  [/coffee|kape|cafe|\btea\b/, '☕'],
  [/game|gaming|console|mobile legends/, '🎮'],
  [/travel|trip|flight|vacation|beach/, '✈️'],
  [/music|guitar|sing|band/, '🎵'],
  [/pet|\bdog\b|\bcat\b|aso|pusa/, '🐕'],
  [/friend|barkada|hangout|social/, '🧑‍🤝‍🧑'],
  [/salary|sahod|payroll|paycheck|\bwage|income|bonus|commission|dividend|refund/, '💰'],
  [/save|savings|bank|invest|ipon/, '🏦'],
  [/gift|regalo|donation|tithe/, '🎁'],
  [/rent|mortgage|amortization/, '🏠'],
  [/walk|stroll|lakad/, '🚶'],
  [/garden|plant|halaman/, '🪴'],
  [/clean|wash|linis/, '🧼']
];

/* Keyed by name AND fallback. A name that matches no keyword is cached as
   whatever the caller's fallback was, and the two callers have different ones
   — so with the name alone as the key, whichever tracker asked first decided
   for both: a "Salary" purpose came back as a stopwatch because the time side
   had asked about a category of the same name a moment earlier. */
const iconCache = {};
function iconFor(name, fallback) {
  const key = String(name || '') + '\u0000' + String(fallback || '');
  if (iconCache[key] != null) return iconCache[key];
  const low = String(name || '').toLowerCase();
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
    re: /\bfood\b|\beat\b|eating|\bate\b|\bdrinks?\b|\bdrank\b|\bmeal\b|breakfast|lunch|dinner|snack|merienda|restaurant|dining|kape|coffee|cafe|takeout|kain|inuman/,
    title: 'What did you eat?',
    hint: 'Optional — a line about the meal is enough.',
    placeholder: 'e.g. grilled chicken, rice, salad'
  },
  {
    key: 'workout',
    re: /workout|exercise|gym|treadmill|jog|jogging|running|\brun\b|\bsports?\b|swim|bike|cycl|yoga|stretch|hike|lift|weights|cardio|crossfit|pilates|zumba|badminton|basketball/,
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

/* Pickers list A–Z; ranked views do not.

   `position` is only ever creation order — nothing here lets you arrange the
   list by hand — so sorting a picker throws away no intent and answers the one
   question a picker gets asked: where is the one I am looking for. Anything
   that ranks (the donut, the legend, the leaderboard) stays biggest-first,
   because that ordering is the information. localeCompare rather than < so
   accented names land where a reader expects Vervé to be. */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/* ── work mode ──

   Zimpan Teams is a different product from Zimpan, not a larger one. An account
   in a team exists to measure how a working week was spent, so the personal
   app's whole subject — what a body ate, how it slept, what it spent — is not
   hidden here, it is absent: no surface offers it, and the only things to log
   against are the team's projects.

   Read from the team rather than from a setting, because it is not a
   preference. The two products have different purposes and an account belongs
   to one of them. */
const workMode = () => (state.auth && state.auth.kind === 'work') || !!(state.team && state.team.team);

/* In work mode the pickable categories are the team's projects and nothing
   else, so there is no way to file an hour against something personal.
   Anything else the account happens to hold is left alone rather than deleted
   — a category is not worth destroying to enforce a menu — it is simply not
   offered. */
const pickCategories = () => {
  const all = state.categories.slice().sort(byName);
  if (!workMode()) return all;
  const names = new Set(teamProjects().filter((p) => !p.archived).map((p) => p.name));
  return all.filter((c) => names.has(c.name));
};
const pickPurposes = () => state.purposes.slice().sort(byName);

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
      'Eat / Drink', 'Sleep', 'Prayers and Reflections', 'Meetings', 'Cooking'
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

const EMPTY_KEYED = () => ({ entries: {}, money: {}, categories: {}, purposes: {}, todos: {}, plans: {} });

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
      todos: state.todos, todosRequeued: state.todosRequeued,
      plans: state.plans,
      aiRequeued: state.aiRequeued,
      currency: state.currency, currencyUpdatedAt: state.currencyUpdatedAt,
      steps: state.steps, stepsAt: state.stepsAt,
      deckRange: state.deckRange,
      weightKg: state.weightKg, weightUpdatedAt: state.weightUpdatedAt,
      sleepMin: state.sleepMin, sleepUpdatedAt: state.sleepUpdatedAt,
      displayName: state.displayName, nameUpdatedAt: state.nameUpdatedAt,
      tracks: state.tracks, tracksUpdatedAt: state.tracksUpdatedAt,
      timerUpdatedAt: state.timerUpdatedAt,
      setupDone: state.setupDone, mClassic: state.mClassic,
      deductAlways: state.deductAlways,
      refineAlways: state.refineAlways,
      entryMode: state.entryMode,
      tombstones: state.tombstones, dirty: state.dirty,
      lastSyncAt: state.lastSyncAt, account: state.account, accountId: state.accountId,
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
  google: (credential, kind) => api('/api/auth/google', { method: 'POST', body: { credential, kind } }),
  me: () => api('/api/me'),
  login: (email, password) => api('/api/login', { method: 'POST', body: { email, password } }),
  register: (email, password, kind) => api('/api/register', { method: 'POST', body: { email, password, kind } }),
  logout: () => api('/api/logout', { method: 'POST' }),
  forgot: (email) => api('/api/forgot', { method: 'POST', body: { email } }),
  reset: (token, password) => api('/api/reset', { method: 'POST', body: { token, password } }),
  push: (since, changes) => api('/api/sync', { method: 'POST', body: { since: since || 0, changes } }),
  estimate: (text) => api('/api/estimate', { method: 'POST', body: { text } }),
  deckSummary: (facts) => api('/api/deck-summary', { method: 'POST', body: { facts } }),
  chat: (history, facts) => api('/api/chat', { method: 'POST', body: { history, facts } }),
  estimateBurn: (text, weightKg, minutes) => api('/api/estimate-burn', { method: 'POST', body: { text, weightKg, minutes } }),
  donateClick: () => api('/api/donate-click', { method: 'POST', body: {} }),

  /* Teams. Not one of these sends a team id: the server reads which team you
     are in from your own membership, so there is nothing here that could name
     somebody else's. */
  team: {
    get: () => api('/api/team'),
    create: (name) => api('/api/team', { method: 'POST', body: { name } }),
    invite: (email, role) => api('/api/team/invite', { method: 'POST', body: { email, role } }),
    revoke: (email) => api('/api/team/invite/revoke', { method: 'POST', body: { email } }),
    resend: (email) => api('/api/team/invite/resend', { method: 'POST', body: { email } }),
    accept: (token) => api('/api/team/accept', { method: 'POST', body: { token } }),
    role: (userId, role) => api('/api/team/role', { method: 'POST', body: { userId, role } }),
    remove: (userId) => api('/api/team/remove', { method: 'POST', body: { userId } }),
    project: (project) => api('/api/team/project', { method: 'POST', body: project }),
    dropProject: (id) => api('/api/team/project/delete', { method: 'POST', body: { id } }),
    entries: (userId, from, to) => api(`/api/team/member/${encodeURIComponent(userId)}/entries?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`),
    editEntry: (id, patch) => api(`/api/team/entry/${encodeURIComponent(id)}`, { method: 'POST', body: patch }),
    dashboard: (from, to) => api(`/api/team/dashboard?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`),
    /* The date is sent because the server cannot know it. It has no idea what
       day it is where the team is sitting, and a timezone guessed there would
       put a whole office's morning on yesterday. */
    now: (date) => api(`/api/team/now?date=${encodeURIComponent(date || '')}`)
  },
  support: (body) => api('/api/support', { method: 'POST', body }),
  closeAccount: () => api('/api/me', { method: 'DELETE' }),
  blog: {
    list: () => api('/api/blog'),
    read: (slug) => api(`/api/blog/${encodeURIComponent(slug)}`)
  }
};

/* Someone opened the donate link. Not a donation — the checkout reports nothing
   back — but it is the only signal this app has that anyone considered it, and
   it is counted as interest rather than as money everywhere it appears.

   Fire and forget, and silent on failure: the click's job is to open PayPal,
   and nothing about recording it is worth delaying or interrupting that. */
/* Only two roles reach the dashboard, and only accounts that hold one are ever
   told it exists. The server decides — this is the role it reported for the
   signed-in session, not something the browser can award itself. */
const adminRole = () => {
  const r = state.auth && state.auth.role;
  return r === 'manager' || r === 'superadmin' ? r : null;
};

function noteDonateClick() {
  if (!state.auth) return;
  try { API.donateClick().catch(() => {}); } catch (err) { /* never in the way */ }
}

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
/* Chat gets its own consent, deliberately not the estimate's. The estimate
   dialog promises that "only the food description goes — not your name, your
   account, your dates or anything else you track", and chat sends the log
   itself, notes included. Reusing that flag would have people who agreed to one
   sentence of food text silently agreeing to their whole diary. */
const CHAT_CONSENT_KEY = 'zimpan.ai.chat.v1';
// Whether replies are read aloud. A per-browser preference: the speaker you
// have to hand is a fact about the device, not about the account.
const CHAT_SPEAK_KEY = 'zimpan.ai.speak.v1';

/* The report deck's prose, kept between visits. Persisted rather than held in
   memory because the whole cost of this feature is the calls, and a page reload
   was throwing away a summary that had just been paid for. */
const DECK_CACHE_KEY = 'zimpan.deck.v1';
// Whether this browser has ever opened the report — the gate on warming it up.
const DECK_USED_KEY = 'zimpan.deck.used.v1';
// Past half a day the world has moved on even if the log has not.
const DECK_STALE_MS = 12 * 60 * 60 * 1000;
const DECK_CACHE_MAX = 12;
/* The food estimate cache had no ceiling and lives in the same localStorage as
   the log, so a year of distinct meals could quietly grow to crowd out the
   entries. Two hundred is plenty — a repeated meal keys the same, so this only
   counts genuinely different ones. */
const AI_CACHE_MAX = 200;

/* ── which page the address is asking for ──

   /teams is its own page rather than a section of the landing: it is pitched at
   a different reader, and a reader who is sent a link to it should arrive on
   it. One document still serves both — the server hands index.html to either
   path — so this is the only place the two are told apart. */
/* Three pages now, and one of them takes a name: /blogs is the index and
   /blogs/<slug> is one post. So this returns a pair rather than a word — the
   post's address is part of which page it is, and a route that dropped the
   slug would send every shared link to the index. */
function routeFromPath() {
  if (typeof location === 'undefined') return { route: 'home', slug: '' };
  const path = location.pathname;
  if (/^\/teams\/?$/.test(path)) return { route: 'teams', slug: '' };
  const post = path.match(/^\/blogs\/([^/]+)\/?$/);
  if (post) return { route: 'blogs', slug: decodeURIComponent(post[1]) };
  if (/^\/blogs\/?$/.test(path)) return { route: 'blogs', slug: '' };
  return { route: 'home', slug: '' };
}

/* The one place the address is copied into state.

   routeFromPath returns a pair now that /blogs/<slug> exists, and a pair
   assigned whole to state.route is an object that stringifies to
   "[object Object]" and quietly fails every === against 'home' or 'teams'.
   Three call sites were three chances to do that; this is one. */
function applyPath() {
  const at = routeFromPath();
  state.route = at.route;
  state.blogSlug = at.slug;
  return at;
}

const pathForRoute = (route, slug) => (
  route === 'teams' ? '/teams'
    : route === 'blogs' ? (slug ? `/blogs/${encodeURIComponent(slug)}` : '/blogs')
      : '/'
);

function goRoute(route, slug) {
  const want = slug || '';
  /* Reached from a menu as often as from a link now, and a menu left hanging
     over the page it just moved you to is a menu that failed to act. The
     phone's account sheet is the same menu in a different shape: it is not
     drawn on the blog route, so leaving it open would spring it back on the
     way home. */
  const shut = state.menuOpen || !!(state.m && state.m.accountOpen);
  state.menuOpen = false;
  if (state.m) state.m.accountOpen = false;
  if (state.route === route && (state.blogSlug || '') === want) {
    if (shut) render();
    scrollToAnchor(null);
    return;
  }
  state.route = route;
  state.blogSlug = want;
  try { history.pushState({ route, slug: want }, '', pathForRoute(route, want)); } catch (e) { /* file:// */ }
  window.scrollTo(0, 0);
  render();
  if (route === 'blogs') loadBlog();
}

if (typeof window !== 'undefined') {
  // Back and forward have to move between them, or the address lies.
  window.addEventListener('popstate', () => {
    const next = routeFromPath();
    if (next.route === state.route && next.slug === (state.blogSlug || '')) return;
    applyPath();
    window.scrollTo(0, 0);
    render();
    if (next.route === 'blogs') loadBlog();
  });
}

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (err) { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode or full */ }
};
/* readJson falls back on anything falsy, so a stored `false` reads back as
   "never set" anyway. Withdrawn consent is therefore removed rather than
   written as false: the storage then says the true thing, and there is no
   value sitting there that only looks like a record. */
const dropJson = (key) => {
  try { localStorage.removeItem(key); } catch (err) { /* private mode */ }
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

/* The date the app believes it is.
   Not a constant. A phone keeps a tab alive for days, and a session that
   outlived midnight went on filing everything against the day it was opened:
   the "Today, as it happens" card described a day that had ended, and a step
   count entered on Tuesday was stored under Monday — so Tuesday reported none
   of it. Being a `const`, it could not even be corrected without a reload.
   Refreshed by the same tick that moves the clock. */
let todayIso = iso(new Date());

/* Called every second. Returns whether the day actually turned. */
function rollDay() {
  const now = iso(new Date());
  if (now === todayIso) return false;
  const was = todayIso;
  todayIso = now;
  /* Someone watching today keeps watching today. Someone who navigated back to
     an earlier day stays where they put themselves. */
  if (state && state.selectedDate === was) state.selectedDate = now;
  return true;
}
const storedRaw = load();
/* A device with no store starts with the category and purpose lists but no
   entries. The demo history in seedState() belongs to the local-only era — now
   that accounts exist, seeding it would offer to upload invented data into a
   brand new account on first sign-in. */
const stored = storedRaw || Object.assign({ entries: [], money: [] }, seedTaxonomy());

/* The three long windows: key, label, length. One table because both layouts
   offer them, the deck offers them, and the stored preference is validated
   against them — four lists of the same three windows are four chances for
   them to disagree.

   91, 182 and 365 rather than 3, 6 and 12 calendar months: every other window
   here is a trailing count of days, and one that changed length depending on
   which months it happened to cross could not be set against the one before
   it. "3 Months" is what it is called; 91 days is what it means.

   Declared above `state` rather than beside RANGE_DAYS because the state
   literal reads it — a const referenced before its declaration throws, and a
   throw at this depth leaves the whole module half-built. */
const LONG_RANGES = [['quarter', '3 Months', 91], ['half', '6 Months', 182], ['year', '12 Months', 365]];

const state = {
  app: 'time',
  range: CONFIG.defaultRange,
  selectedDate: todayIso,

  entries: stored.entries,
  money: stored.money,
  categories: stored.categories,
  purposes: stored.purposes,
  /* The to-do pad. Absent from any store written before it existed, hence the
     guard: load() only vouches for entries and money. */
  todos: Array.isArray(stored.todos) ? stored.todos : [],
  /* The money tracker's pad, on the same terms as the to-do one above: absent
     from every store written before it existed. */
  plans: Array.isArray(stored.plans) ? stored.plans : [],
  currency: CURRENCIES.some((c) => c.code === stored.currency) ? stored.currency : DEFAULT_CURRENCY,
  /* Steps walked, keyed by date. Travels with everything else now, merged a
     day at a time on the stamps in `stepsAt` below. */
  steps: (stored.steps && typeof stored.steps === 'object') ? stored.steps : {},
  /* When each date's count was last written, so two devices can each record a
     different day and both survive the merge. Days stored before steps could
     sync carry no stamp; they are treated as older than anything that arrives. */
  stepsAt: (stored.stepsAt && typeof stored.stepsAt === 'object') ? stored.stepsAt : {},

  weightKg: Number(stored.weightKg) || null,
  weightUpdatedAt: Number(stored.weightUpdatedAt) || 0,

  /* Where the day stops. Gap review walks from 6am to here; null means nobody
     has said, and 10pm stands in. Minutes since midnight, like everything else
     that is a time in this app. */
  sleepMin: stored.sleepMin == null ? null : Number(stored.sleepMin),
  sleepUpdatedAt: Number(stored.sleepUpdatedAt) || 0,
  // What to call you. Collected at setup, shown on Today.
  displayName: stored.displayName || '',
  nameUpdatedAt: Number(stored.nameUpdatedAt) || 0,
  // Which trackers to ask about. Time and money carry the app, so they start on.
  tracks: Object.assign({ time: true, money: true, steps: false, meals: false },
    stored.tracks && typeof stored.tracks === 'object' ? stored.tracks : {}),
  tracksUpdatedAt: Number(stored.tracksUpdatedAt) || 0,
  timerUpdatedAt: Number(stored.timerUpdatedAt) || 0,
  /* Whether first-run setup has been through. An account that already has rows
     has plainly been set up, whatever this device remembers. */
  setupDone: stored.setupDone === true,
  // Whether the phone was sent back to the full desktop layout by hand.
  mClassic: stored.mClassic === true,
  // 'timer' or 'manual' — only one entry card is on screen at a time.
  entryMode: stored.entryMode === 'manual' ? 'manual' : 'timer',

  form: { date: todayIso, activity: '', category: (stored.categories[0] || {}).name || 'Chores', from: (() => { const n = new Date(); return hm(n.getHours() * 60 + n.getMinutes()); })(), to: '' },
  mForm: { date: todayIso, activity: '', purpose: 'Groceries', in: '', out: '' },

  newCatOpen: false, newCatName: '',
  // Which vocabulary entry is being renamed, and the name being typed for it.
  pickRename: null, pickRenameName: '',
  // Which calorie dial has been opened for a breakdown: { kind, scope }.
  calOpen: null,
  // Whether the once-a-day "what happened yesterday" offer is on screen.
  recapAsk: false,
  /* The refine question: what is being asked about, whether "every time" is
     ticked while it is open, and the standing answer once it has been. */
  refineAsk: null, refineRemember: false, aiPending: null,
  /* The standing answers, laid out where they can be taken back. */
  prefsOpen: false,

  /* ── team ──
     null while unknown, { team: null } once the server says this account is in
     no team, and the whole overview once it is in one. The three are different
     answers and the screens read them apart. */
  team: null,
  teamOpen: false,
  teamTab: 'people',
  teamBusy: '',
  teamError: '',
  teamNotice: '',
  teamName: '',
  teamInviteEmail: '',
  teamInviteRole: 'member',
  teamInviteLink: '',
  // Whether the last invitation was actually emailed. See noteInvite().
  teamMailed: false,
  teamProjectName: '',
  teamMemberId: null,
  teamRows: [],
  teamDash: null,
  /* Who is working right now, and what each of them has logged today. Polled
     while the Members tab is open and dropped when it closes — nothing about
     this is worth keeping once nobody is looking at it. */
  teamLive: null,
  teamLiveAt: 0,
  teamLiveOpen: null,
  /* 'home' or 'teams', read from the address on boot. */
  route: routeFromPath().route,
  /* Empty on the index, the post's address on a post page. */
  blogSlug: routeFromPath().slug,
  /* { posts, more } for the index and { ...post } for one, each null until
     fetched and false once the fetch has failed — three states, because
     "loading" and "there is nothing here" are different pages. */
  blogList: null,
  blogPost: null,
  blogBusy: false,
  blogError: '',
  refineAlways: stored.refineAlways === true || stored.refineAlways === false ? stored.refineAlways : null,
  /* "Chat with Zimpan". The transcript lives here and nowhere else — not on the
     server, not in localStorage — so closing the app ends the conversation.
     `speak` is whether replies are read aloud; it is remembered per browser. */
  chat: {
    open: false, messages: [], draft: '', busy: false, error: '',
    listening: false, speak: readJson(CHAT_SPEAK_KEY, true) !== false
  },
  chatConsent: readJson(CHAT_CONSENT_KEY, false) === true,
  chatAsking: false,
  newPurposeOpen: false, newPurposeName: '',

  /* Which searchable picker is open — 'category', 'purpose', or null — and what
     has been typed into it. Session state rather than persisted: an open
     dropdown is not something to restore. */
  pickOpen: null, pickQuery: '',
  // Which picker has its naming row open, and what is being typed into it.
  pickNew: null, pickNewName: '',
  // {kind, name} while the delete confirmation is up.
  pickDelete: null,

  /* Persisted, and that is the whole trick: a stopwatch needs a start time, not
     a running process. Phones freeze and reload background tabs freely, so
     anything held only in memory is gone the moment you lock the screen. With
     the timestamp on disk the elapsed time is recomputed from the clock. */
  timerStart: Number(stored.timerStart) || null,
  timerActivity: stored.timerActivity || '',
  timerCategory: stored.timerCategory || (stored.categories[0] || {}).name || 'Chores',
  reportOpen: false,
  // Session only: a search is something you are doing, not a preference.
  searchQuery: '', searchAll: false,
  donateOpen: false,
  resyncArmed: false,

  // Whether the server has a key at all; the button is not drawn without one.
  aiEstimates: false,
  aiConsent: readJson(AI_CONSENT_KEY, false) === true,
  aiCache: readJson(AI_CACHE_KEY, {}),
  aiAsking: null,   // scope awaiting consent
  aiBusy: null,     // scope with a request in flight

  /* The report deck's written summaries, keyed by window and kept on disk. Each
     entry carries when it was written and what it was written from, so staleness
     is a judgement made at read time rather than a key that misses on every new
     entry. `deckUsed` is what stops the warm-up running for someone who has
     never opened a report. */
  deckAi: readJson(DECK_CACHE_KEY, {}),
  deckUsed: readJson(DECK_USED_KEY, false) === true,
  deckAiBusy: null, deckAiError: '',
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

  /* The report deck's own window, independent of the range the page is on:
     switching it must not move the donut or the insight sections. */
  deckRange: ['today', 'yesterday', 'week', 'fortnight', 'month'].concat(LONG_RANGES.map((r) => r[0]))
    .includes(stored.deckRange) ? stored.deckRange : 'week',

  /* Which category the day's entries are narrowed to, or '' for all. Deliberately
     not saved: a filter restored on load would read as missing entries, and the
     control that explains it is halfway down the page. */
  logFilter: '',

  /* The spend whose "take it off?" question is on screen: {id, done}. `done`
     flips once answered, and the panel becomes the answer rather than closing
     — the point of asking was to say where the balance stands. */
  deductAsk: null,
  /* Whether to stop asking: true always deducts, false never does, null asks.
     Kept on the device rather than synced, like the other view preferences —
     it decides what a form does here, not what any figure means. */
  deductAlways: stored.deductAlways === true || stored.deductAlways === false ? stored.deductAlways : null,
  // Whether "do this every time" is ticked while the question is open.
  deductRemember: false,

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
  dirty: Object.assign(EMPTY_KEYED(), stored.dirty, {
    currency: !!(stored.dirty && stored.dirty.currency),
    steps: !!(stored.dirty && stored.dirty.steps),
    sleep: !!(stored.dirty && stored.dirty.sleep),
    name: !!(stored.dirty && stored.dirty.name),
    tracks: !!(stored.dirty && stored.dirty.tracks),
    timer: !!(stored.dirty && stored.dirty.timer),
    ai: !!(stored.dirty && stored.dirty.ai)
  }),
  lastSyncAt: Number(stored.lastSyncAt) || 0,
  account: stored.account || null,
  /* Which account, not just which address. An account deleted and re-made
     under the same email is a different one, and this is how the browser
     knows. See afterSignIn(). */
  accountId: Number(stored.accountId) || null,

  // Collapsed by default; whether you left one open is remembered.
  drawers: Object.assign({ categories: false, activities: false, lookback: false, legend: false, leaderboard: false, today: false, mEntries: false }, stored.drawers),

  /* ── session (per-load) ── */
  booted: false,
  auth: null,
  authOpen: false,
  googleClientId: null,
  // 'login' | 'register' | 'forgot' | 'reset'
  authMode: 'login',
  /* 'work' when the panel was opened from the team page or an invitation, so
     the account it creates belongs to that product. Decided at sign-up and
     never again — a personal account cannot become a team one. */
  authFor: 'personal',
  /* Set to the account's kind when someone signs in to the other product. */
  crossKind: '',
  authEmail: '', authPassword: '', authError: '', authBusy: false,
  authNotice: '',
  resetToken: '',
  migrateOffer: null,
  // noteSkipped is per-session on purpose: skipping is an answer, so the same
  // question stops asking until the next page load.
  notePrompt: null, noteDraft: '', noteSkipped: {},
  /* The meal that was logged with nothing written in it, and the meals already
     told about it. Both per-session: the warning is worth showing once per
     meal, and never twice for the same one. */
  mealAsk: null, mealAsked: {},
  legalOpen: null,
  /* The to-do pad, and which note's delete button is armed. Arming rather than
     a dialog: a note is one line, and a modal asking whether you meant it is
     heavier than the thing it protects — but a single stray click should not
     take away something written. */
  todoOpen: false,
  todoArm: '',
  /* The money tracker's pad, and which of its lines has its delete armed. Held
     apart from the to-do pad's pair rather than shared: the two open from
     different places and one must not close the other. */
  planOpen: false,
  planArm: '',
  // Whether this browser has re-offered its notes. See requeueTodos().
  todosRequeued: stored.todosRequeued === true,
  // And its estimates. See requeueAi().
  aiRequeued: stored.aiRequeued === true,
  // The "why is this stuck" dialog: which note, and what has been typed.
  todoWhy: null,

  // The header menu, and the close-account confirmation it opens.
  menuOpen: false,
  closing: null,
  /* The help dialog: null when shut, otherwise the draft being written. Held
     as one object so closing it throws the whole thing away rather than
     leaving three fields to remember to clear. */
  help: null,
  toast: '',
  netState: 'idle', netMessage: '', netError: '', netErrorRow: null, netErrorKind: '',
  syncing: false,

  geo: null
};

// First run: persist the starting taxonomy so it is stable across reloads.
if (!storedRaw) save();

/* Steps predate this device knowing how to sync them, so days recorded back
   then carry no stamp. Left at zero they would tie with the same day on another
   device and neither would ever win, so the counts already here are stamped on
   the first load that finds them unstamped and queued for a push. Whichever
   device opens first therefore sets the shared value for those old days; every
   day written from here on carries its own stamp and merges properly. */
(() => {
  const unstamped = Object.keys(state.steps).filter((d) => !state.stepsAt[d]);
  if (!unstamped.length) return;
  const at = Date.now();
  unstamped.forEach((d) => { state.stepsAt[d] = at; });
  state.dirty.steps = true;
  save();
})();

/* ─────────────────────────── sync ───────────────────────────

   Local-first. Every edit lands in localStorage and renders immediately; the
   server is reconciled afterwards and is never in the way of a keystroke.

   Conflicts resolve last-write-wins on `updatedAt`, the same rule the server
   applies, so both ends reach the same answer independently. One caveat worth
   knowing: `updatedAt` comes from whichever device made the edit, so a device
   with a badly wrong clock can win or lose exchanges it shouldn't. */

const KINDS = ['entries', 'money', 'categories', 'purposes', 'todos', 'plans'];
const KEY_OF = { entries: 'id', money: 'id', categories: 'name', purposes: 'name', todos: 'id', plans: 'id' };

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
  /* `project` only when there is one. An absent field is a personal entry —
     which is every row written before teams existed, and the reason the server
     treats it as the thing an admin cannot see. */
  if (kind === 'entries') return { id: r.id, date: r.date, activity: r.activity, category: r.category, project: r.project || undefined, from: r.from, to: r.to, note: r.note || '', updatedAt: r.updatedAt || 0 };
  if (kind === 'money') return { id: r.id, date: r.date, activity: r.activity, purpose: r.purpose, in: Number(r.in) || 0, out: Number(r.out) || 0, note: r.note || '', updatedAt: r.updatedAt || 0 };
  if (kind === 'todos') return { id: r.id, text: r.text || '', status: r.status || 'pending', blocked: r.blocked || undefined, createdAt: r.createdAt || 0, updatedAt: r.updatedAt || 0 };
  if (kind === 'plans') return { id: r.id, text: r.text || '', amount: money2(r.amount), purpose: r.purpose || undefined, status: r.status || 'planned', createdAt: r.createdAt || 0, updatedAt: r.updatedAt || 0 };
  return { name: r.name, color: r.color, position: r.position || 0, updatedAt: r.updatedAt || 0 };
}
function deserialise(kind, r) {
  if (kind === 'entries') return { id: r.id, date: r.date, activity: r.activity, category: r.category, project: r.project || undefined, from: r.from, to: r.to, note: r.note || '', updatedAt: r.updatedAt };
  if (kind === 'money') return { id: r.id, date: r.date, activity: r.activity, purpose: r.purpose, in: r.in, out: r.out, note: r.note || '', updatedAt: r.updatedAt };
  if (kind === 'todos') return { id: r.id, text: r.text || '', status: r.status || 'pending', blocked: r.blocked || undefined, createdAt: r.createdAt || 0, updatedAt: r.updatedAt };
  if (kind === 'plans') return { id: r.id, text: r.text || '', amount: money2(r.amount), purpose: r.purpose || undefined, status: r.status || 'planned', createdAt: r.createdAt || 0, updatedAt: r.updatedAt };
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
  if (state.dirty.sleep) out.sleepMin = { value: state.sleepMin, updatedAt: state.sleepUpdatedAt };
  if (state.dirty.name) out.name = { value: state.displayName, updatedAt: state.nameUpdatedAt };
  if (state.dirty.tracks) out.tracks = { value: state.tracks, updatedAt: state.tracksUpdatedAt };
  /* A stopped timer is as much news as a started one, so this pushes whatever
     the field currently says rather than only a live start time. */
  /* The whole map, merged server-side by the stamp on each entry — the same
     shape as steps, and for the same reason: a device only knows the meals it
     refined, and sending its map whole is what lets another device's estimates
     survive rather than being overwritten by this one's. */
  if (state.dirty.ai) out.aiCache = state.aiCache;
  if (state.dirty.timer) {
    out.timer = {
      start: state.timerStart, category: state.timerCategory,
      // What the timer is called travels with it, or a timer started on one
      // device shows up on another as a running clock with no name on it.
      activity: state.timerActivity, updatedAt: state.timerUpdatedAt
    };
  }
  /* Sent whole rather than as a diff. The map is one small object, the server
     stores it verbatim, and sending all of it is what lets a device that has
     been away contribute its days without having to work out which are new. */
  if (state.dirty.steps) {
    out.steps = {};
    /* Every date either map knows about, not only the ones still carrying a
       count: a day that was cleared exists solely as a stamp, and leaving it
       out would let another device's copy of it come straight back. */
    new Set(Object.keys(state.steps).concat(Object.keys(state.stepsAt))).forEach((d) => {
      out.steps[d] = { v: Number(state.steps[d]) || 0, t: Number(state.stepsAt[d]) || 0 };
    });
  }
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
  if (changes.sleepMin && changes.sleepMin.updatedAt >= state.sleepUpdatedAt) {
    state.sleepMin = changes.sleepMin.value == null ? null : Number(changes.sleepMin.value);
    state.sleepUpdatedAt = changes.sleepMin.updatedAt;
    state.dirty.sleep = false;
  }
  if (changes.name && changes.name.updatedAt >= state.nameUpdatedAt) {
    state.displayName = changes.name.value || '';
    state.nameUpdatedAt = changes.name.updatedAt;
    state.dirty.name = false;
  }
  if (changes.tracks && changes.tracks.value && changes.tracks.updatedAt >= state.tracksUpdatedAt) {
    state.tracks = Object.assign({}, state.tracks, changes.tracks.value);
    state.tracksUpdatedAt = changes.tracks.updatedAt;
    state.dirty.tracks = false;
  }
  /* The timer is the one scalar a local edit should not automatically win: a
     device that stopped it wrote that fact at a later stamp, and a device that
     merely still has it running has nothing newer to say. Equal stamps leave
     what is here — the server is echoing this device's own push. */
  if (changes.timer && changes.timer.updatedAt > state.timerUpdatedAt) {
    state.timerStart = changes.timer.start == null ? null : Number(changes.timer.start);
    if (changes.timer.category) state.timerCategory = changes.timer.category;
    // Applied even when empty: a device that stopped the timer clears the name,
    // and that clearing is as much a fact as the name was.
    if (changes.timer.activity != null) state.timerActivity = changes.timer.activity;
    state.timerUpdatedAt = changes.timer.updatedAt;
    state.dirty.timer = false;
  }

  /* Merged a day at a time on its own stamp rather than the whole map at once:
     a phone that recorded Monday and a laptop that recorded Tuesday should end
     up holding both, which taking the newer map wholesale would not do. */
  if (changes.aiCache && typeof changes.aiCache === 'object') {
    let gained = false;
    Object.keys(changes.aiCache).forEach((key) => {
      const incoming = changes.aiCache[key];
      if (!incoming || typeof incoming !== 'object') return;
      const mine = state.aiCache[key];
      // Newer stamp wins; a key we have never seen is always news.
      if (!mine || (Number(incoming.at) || 0) > (Number(mine.at) || 0)) {
        state.aiCache[key] = incoming;
        gained = true;
      }
    });
    if (gained) { capAiCache(); writeJson(AI_CACHE_KEY, state.aiCache); }
  }

  if (changes.steps && typeof changes.steps === 'object') {
    let gained = false;
    Object.keys(changes.steps).forEach((d) => {
      const row = changes.steps[d] || {};
      const t = Number(row.t) || 0;
      const mine = Number(state.stepsAt[d]) || 0;
      if (t < mine) return;
      // Equal stamps: nothing to choose between them, so leave what is here.
      if (t === mine && state.steps[d] != null) return;
      const v = Number(row.v) || 0;
      if (v > 0) { state.steps[d] = v; state.stepsAt[d] = t; }
      else { delete state.steps[d]; delete state.stepsAt[d]; }
      gained = true;
    });
    // The outbox is only cleared when nothing arrived that this device lacked.
    if (!gained) state.dirty.steps = false;
  }
}

/* Clears the outbox only for rows untouched since they were collected — an
   edit made while the request was in flight has to stay queued. */
/* What the outbox may forget, given what the server said it did with it.

   `applied` is the server's own count per kind. A server running code older
   than a kind answers 200, ignores the field it does not know, and reports no
   count for it — and clearing the outbox on that 200 loses the rows silently:
   they stay on the device that wrote them, marked clean, and never go up
   again even after the server catches up. That is precisely what a static
   deploy without a restart looks like from here.

   So a kind is only forgotten when the server counted it. Anything else is
   kept and tried again, which costs one repeated request until the server is
   current and then settles by itself. A reply with no `applied` at all is not
   evidence either way, so it is treated as it always was. */
function clearPushed(sent, applied) {
  const counted = applied && typeof applied === 'object';
  KINDS.forEach((kind) => {
    if (counted && (sent[kind] || []).length && typeof applied[kind] !== 'number') return;
    (sent[kind] || []).forEach((row) => {
      const key = String(row[KEY_OF[kind]]);
      const live = findRow(kind, key);
      const currentAt = live ? live.updatedAt : state.tombstones[kind][key];
      if (currentAt === row.updatedAt) delete state.dirty[kind][key];
    });
  });
  if (sent.currency && state.currencyUpdatedAt === sent.currency.updatedAt) state.dirty.currency = false;
  if (sent.weightKg && state.weightUpdatedAt === sent.weightKg.updatedAt) state.dirty.weight = false;
  if (sent.sleepMin && state.sleepUpdatedAt === sent.sleepMin.updatedAt) state.dirty.sleep = false;
  if (sent.name && state.nameUpdatedAt === sent.name.updatedAt) state.dirty.name = false;
  if (sent.tracks && state.tracksUpdatedAt === sent.tracks.updatedAt) state.dirty.tracks = false;
  if (sent.timer && state.timerUpdatedAt === sent.timer.updatedAt) state.dirty.timer = false;
  /* Cleared unless a meal was refined while the push was in flight. A key the
     server did not carry back is one it now holds anyway — the map went up
     whole — so a stale entry cannot get stranded in the outbox. */
  if (sent.aiCache && !Object.keys(state.aiCache).some((k) => !sent.aiCache[k]
      || (Number(state.aiCache[k].at) || 0) > (Number(sent.aiCache[k].at) || 0))) {
    state.dirty.ai = false;
  }
  /* Cleared only when nothing was written while the request was in flight —
     the same rule the rows above follow, applied to the whole map at once. */
  if (sent.steps && !Object.keys(sent.steps).some((d) => (Number(state.stepsAt[d]) || 0) > (Number(sent.steps[d].t) || 0))) {
    state.dirty.steps = false;
  }
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

/* Steps count here too, or a day whose only edit was the step field would sit in
   the outbox forever: this number is what the minute timer and the flush on the
   way out both test before they bother calling syncNow. */
const pendingCount = () =>
  KINDS.reduce((n, k) => n + Object.keys(state.dirty[k]).length, 0)
  + (state.dirty.currency ? 1 : 0) + (state.dirty.weight ? 1 : 0)
  + (state.dirty.steps ? 1 : 0);

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

/* ── hearing from the other device ──

   Every sync is one round trip: the push carries what changed here, and the
   reply carries what changed anywhere else. Until now the only thing that ever
   started one was a local write — so a device that was merely *watching* never
   asked, and never heard.

   That is the whole of the stopped-timer bug. Start a timer on the laptop and
   stop it on the phone: the phone's stop reaches the server immediately, and
   the laptop sits there counting, because the laptop has nothing of its own to
   say and nothing was asking on its behalf.

   The cadence follows what is at stake. A running timer is the one piece of
   state that goes stale in seconds and that two devices are likely to be
   watching at once, so it is checked four times a minute; everything else can
   wait a minute. A hidden tab asks for nothing — a phone in a pocket and a
   laptop with the lid down have no screen to keep honest — and asks once on
   the way back, which is the moment the screen is about to be believed again.

   The clock is reset by any sync, not only by these, so a device being typed
   into is never also polled. */
const BEAT_RUNNING_MS = 15000;
const BEAT_IDLE_MS = 60000;
const BEAT_TICK_MS = 5000;
let lastSyncTry = 0;

function syncHeartbeat() {
  if (!state.auth || state.syncing) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const due = state.timerStart ? BEAT_RUNNING_MS : BEAT_IDLE_MS;
  if (Date.now() - lastSyncTry < due) return;
  queueSync(0);
}
setInterval(syncHeartbeat, BEAT_TICK_MS);

/* Coming back to the tab is worth a round trip on its own: whatever is on
   screen was painted before the phone was picked up, and a timer that stopped
   in between is exactly what the reader is about to look at. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') queueSync(0);
});

/* Asks the server for a closer figure. A cached answer for the same text is
   used without a request, which is what keeps this affordable — a repeated
   breakfast costs nothing after the first time. */
async function refineFood(scope) {
  /* The phone reads its own window rather than the desktop's today/past, so
     it asks for its own report rather than picking one out of compute(). The
     cache is keyed on the meal text either way, so a breakfast refined on the
     laptop is already refined here and costs nothing. */
  const food = scope === 'm' ? mFood() : (scope === 'today' ? compute().todayFood : compute().pastFood);
  if (!food || !food.detail) return;
  // Same gate the button is drawn behind, in case a click outlives the render
  // that should have removed it.
  if (scope === 'past' && !compute().pastSingleDate) return;
  if (scope === 'm' && mRangeDates().length !== 1) return;

  return askEstimate(food.detail, food.key, scope);
}

/* The estimate for one named day, for the automatic path. Same fetch, same
   cache, same key — only the thing that decided to ask is different. */
function refineDay(date) {
  const day = buildDayFood(date);
  if (day) askEstimate(day.detail, day.key, 'auto');
}

/* The one place an estimate is fetched and stored. The button and the automatic
   refresh both come through here so the key, the stamping and the error
   handling cannot drift apart between them. */
async function askEstimate(detail, key, scope) {
  if (!detail || !key) return;
  if (state.aiCache[key]) { render(); return; }

  state.aiBusy = scope;
  state.aiError = '';
  render();
  try {
    const res = await API.estimate(detail);
    /* Stamped and queued so the answer reaches the other devices: the cache is
       keyed on the meal text, so once it has synced a meal refined on the
       laptop really is already refined on the phone. */
    state.aiCache[key] = Object.assign({}, res.estimate, { at: Date.now() });
    capAiCache();
    state.dirty.ai = true;
    writeJson(AI_CACHE_KEY, state.aiCache);
    /* The estimate is written to its own store; this writes the note saying it
       has not gone up yet. Without it the outbox flag lived only in memory, so
       a push that did not land before the tab closed — a restart, a dropped
       connection, a sync already blocked on something else — took with it the
       only record that anything was owed. The estimate stayed on the device
       that asked for it and never reached the others, which reads exactly like
       calibration not syncing. Every other flag in the outbox is saved beside
       the thing it describes; these two were not. */
    save();
    queueSync(0);
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

/* ── the report deck's written summaries ──

   Everything the cards can say from arithmetic, they say from arithmetic. These
   are the paragraphs between the figures, and they are the one part of the app
   that has to be written rather than computed.

   One request per window, cached against a fingerprint of what went into it, so
   flicking between Week and Month costs one call each and flicking back costs
   nothing. The fingerprint includes the totals rather than only the range, so
   logging something new gets a summary that knows about it. */

// Only what a summary needs. The raw log never leaves: the model is told the
// window went to Family Time, not what was written in the notes.
function deckFacts(v) {
  const days = Math.max(1, v.rangeDayCount);
  const b = v.rangeBurn, f = v.rangeFood;
  const netDay = Math.round((b.kcal + b.restKcal - f.kcal) / days);
  const quiet = v.quietestDay;

  return {
    tracker: v.isMoney ? 'money' : 'time',
    range: v.reportRange,
    days,
    daysLogged: v.reportDays.length,
    dayStreak: v.streak,
    entries: v.reportEntryCount,
    totalTracked: v.rangeTotal,
    averageDay: durShort(v.rangeTotalMins / days),
    untrackedOnSelectedDay: v.untracked,
    steps: v.rangeSteps || 0,
    categories: v.reportRows.slice(0, 8).map((r) => ({ name: r.name, share: r.pct, time: r.time })),
    busiestDay: v.rangeBusiest ? { day: v.rangeBusiest.label, tracked: v.rangeBusiest.value } : null,
    lightestDay: quiet ? { day: dayLabel(quiet.date), tracked: durShort(quiet.total) } : null,
    sleep: v.rangeSleep.nights ? {
      nightsLogged: v.rangeSleep.nights,
      averageNight: durShort(v.rangeSleep.avgMins),
      bedtimeDrift: durShort(v.rangeSleep.drift),
      perNight: v.rangeSleep.list.map((n) => ({ day: dayLabel(n.date), slept: durShort(n.mins) }))
    } : null,
    energy: (b.kcal || f.kcal) ? {
      burnedMoving: Math.round(b.kcal / days),
      burnedAtRest: Math.round(b.restKcal / days),
      eaten: Math.round(f.kcal / days),
      netPerDay: netDay,
      /* Context for the model, not something for it to print — it is told to
         quote no figures, and this one is on the card's own row where it is
         recomputed every render. Sent so the prose can describe the pace
         correctly without having to work it out. */
      ifThisHeld: weekWeightLabel(netDay)
    } : null
  };
}

/* Which window a summary describes — and only that. The figures it was written
   from are stored beside it rather than baked into the key, because they decide
   something different: the key decides which summary to show, the figures decide
   whether it is still worth showing.

   Folding the entry count into the key, as this first did, meant every new
   entry was a cache miss. Log four things and open the report and that is a
   fresh call for prose that would have read almost identically. The window
   itself already carries the date range, so a rolling window keys differently
   tomorrow without anything extra. */
const deckKey = (v) => [v.isMoney ? 'm' : 't', state.deckRange, v.reportRange].join('|');

/* A summary is rewritten when the window has actually moved under it, not when
   it has twitched. Five entries or a tenth of the log, whichever is larger:
   below that the prose would say the same thing in different words, and the
   figures on the card are computed locally and always live regardless. */
const deckMoved = (hit, v) => {
  const n = v.reportEntryCount;
  return Math.abs((hit.entries || 0) - n) > Math.max(5, Math.round(n * 0.1));
};
const deckFresh = (hit, v) =>
  !!(hit && hit.s && Date.now() - (hit.at || 0) < DECK_STALE_MS && !deckMoved(hit, v));

/* Oldest out first, and only ever a dozen: this lives in the same localStorage
   as the log itself, and a report cache that grows without limit would
   eventually cost someone their entries. */
function saveDeckCache() {
  const keys = Object.keys(state.deckAi);
  if (keys.length > DECK_CACHE_MAX) {
    keys.sort((a, b) => (state.deckAi[a].at || 0) - (state.deckAi[b].at || 0))
      .slice(0, keys.length - DECK_CACHE_MAX)
      .forEach((k) => { delete state.deckAi[k]; });
  }
  writeJson(DECK_CACHE_KEY, state.deckAi);
}

/* Oldest out first, by the stamp each estimate carries. */
function capAiCache() {
  const keys = Object.keys(state.aiCache);
  if (keys.length <= AI_CACHE_MAX) return;
  keys.sort((a, b) => (state.aiCache[a].at || 0) - (state.aiCache[b].at || 0))
    .slice(0, keys.length - AI_CACHE_MAX)
    .forEach((k) => { delete state.aiCache[k]; });
}

async function fetchDeckSummary(v) {
  if (!state.aiEstimates || !state.auth) return;
  const key = deckKey(v);
  if (state.deckAiBusy === key) return;
  if (deckFresh(state.deckAi[key], v)) return;

  state.deckAiBusy = key;
  state.deckAiError = '';
  // Only when someone is looking. A warm-up in the background has no business
  // rebuilding the page it is not on.
  if (state.reportOpen) render();
  try {
    const res = await API.deckSummary(deckFacts(v));
    state.deckAi[key] = { at: Date.now(), entries: v.reportEntryCount, s: res.summaries || {} };
    saveDeckCache();
  } catch (err) {
    /* Not cached: a summary that failed because the network was down should be
       retried the next time the deck opens, not remembered as "no summary". */
    state.deckAiError = err.message || 'Could not write the summary just now.';
  } finally {
    state.deckAiBusy = null;
    if (state.reportOpen) render();
  }
}

/* ── warming it up ──

   Written on the way in rather than on the way out, so the report is already
   there when it is asked for. Two things keep that from turning into a bill:

   It only runs for people who have opened the report before. Fetching a summary
   on every app open for someone who never reads one would be pure waste, and
   most opens are someone logging an entry and leaving.

   It respects the cache like everything else, so a second visit on the same day
   with nothing much logged in between costs nothing at all. The realistic
   steady state is one call a day per window you actually look at. */
let warmed = false;
function warmDeckSummary() {
  if (warmed || !state.deckUsed || !state.aiEstimates || !state.auth) return;
  warmed = true;
  // After the first paint and the first sync, not in competition with them.
  setTimeout(() => {
    if (!state.auth) return;
    try { fetchDeckSummary(deckView()); } catch (err) { /* a warm-up never matters enough to throw */ }
  }, 6000);
}

async function syncNow() {
  if (!state.auth || state.syncing) return;
  // Stamped here rather than in the heartbeat, so a device being typed into is
  // never also polled — any sync at all resets the quiet clock.
  lastSyncTry = Date.now();
  state.syncing = true;
  setNet('syncing', '');
  const sent = collectChanges();
  try {
    const res = await API.push(state.lastSyncAt, sent);
    mergeChanges(res.changes);
    clearPushed(sent, res.applied);
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
  state.todos = [];
  state.plans = [];
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
  /* An address is not an identity.

     Deleting an account and signing up again with the same email makes a new
     account with a new id — and the browser, which only ever compared
     addresses, kept its local copy and pushed the whole thing back up. A team
     member removed by an admin came back with their hours, except the admin
     could not see them: the re-uploaded entries carried no project, because at
     the moment they synced the account was not on a team yet, and nothing
     revisits a row to stamp it later.

     So the id decides. Only when a KNOWN id differs, because a browser that
     signed in before this existed has none stored and must not be wiped for
     it — it records the id and carries on. */
  const knownId = Number(state.accountId) || 0;
  const nowId = Number(user.id) || 0;
  if (knownId && nowId && knownId !== nowId) {
    resetLocal();
    state.account = user.email;
    state.accountId = nowId;
    save();
  } else if (state.account && state.account !== user.email) {
    resetLocal();
    state.account = user.email;
    state.accountId = nowId;
    save();
  } else if (!state.account) {
    if (hasLocalData()) {
      // Data from before there were accounts. Ask before uploading it.
      state.migrateOffer = { entries: state.entries.length, money: state.money.length };
      render();
      return;
    }
    state.account = user.email;
    state.accountId = nowId;
    save();
  }
  // Recorded whichever branch ran, so the next sign-in has something to compare.
  if (nowId && state.accountId !== nowId) { state.accountId = nowId; save(); }
  if (!state.dirty.currency && user.currency) state.currency = user.currency;
  render();
  await syncNow();
  /* After the sync, so the summary is written from the log this device has just
     finished pulling rather than the one it woke up with. */
  warmDeckSummary();
  // Same reasoning: yesterday is only worth offering once this device has
  // pulled what the other one logged.
  maybeAskRecap();
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
    const res = await API.google(response && response.credential, state.authFor === 'work' ? 'work' : 'personal');
    state.authBusy = false;
    state.authPassword = '';
    state.auth = res.user;
    landAfterSignIn(res.user);
    /* Before afterSignIn rather than after it. A work account with no team yet
       has exactly one thing to do, and the sheet that says so is raised by
       render() — which afterSignIn calls. Until now only boot() loaded this,
       so a team account that had just signed up saw the app with nothing to
       log against and no prompt, and the offer only arrived on a reload. */
    await loadTeam();
    /* Before afterSignIn, because afterSignIn renders — and a render with an
       unredeemed invitation is the "Start a team" sheet in the face of
       somebody who was invited to one. */
    if (pendingInviteToken()) await acceptPendingInvite();
    await afterSignIn(res.user);
  } catch (err) {
    state.authBusy = false;
    state.authError = err.message || 'Google sign-in did not complete.';
    render();
  }
}

/* Notes written while the server did not yet know about them.

   Until clearPushed learned to check what the server counted, a push to a
   server running older code came back 200 with the notes quietly dropped, and
   the outbox was emptied on that answer. Those notes are still here, still
   correct, and marked as though they had been delivered — so nothing would
   ever send them, and they would sit on one device forever.

   Queued again, once per browser, and remembered so it is not done twice. A
   re-push costs nothing: the rows carry their own stamps and the server takes
   the newer of the two, so a note that did land is written back as itself. */
function requeueTodos() {
  if (state.todosRequeued) return;
  state.todosRequeued = true;
  state.todos.forEach((t) => markDirty('todos', t.id));
  save();
}

/* Estimates stranded the same way, for the same reason, and recovered on the
   same terms: offered once more per browser and remembered, so a calibration
   made before the flag was durable still reaches the other devices. The map
   goes up whole and the server merges it entry by entry on each stamp, so
   offering one it already holds costs a request and changes nothing. */
function requeueAi() {
  if (state.aiRequeued) return;
  state.aiRequeued = true;
  if (Object.keys(state.aiCache || {}).length) state.dirty.ai = true;
  save();
}

async function boot() {
  requeueTodos();
  requeueAi();
  const params = new URLSearchParams(location.search);

  // A reset link lands here with ?reset=<token>; that screen wins over
  // everything, including an existing session on this device.
  const token = params.get('reset');
  if (token) {
    state.resetToken = token;
    state.authMode = 'reset';
    state.booted = true;
    state.auth = null;
    render();
  }

  /* ?signin=1 opens the panel on arrival. The dashboard sends people here when
     they are not signed in, and landing on a marketing page with the sign-in a
     scroll away is a poor answer to "you need to sign in". */
  if (!token && params.get('signin')) state.authOpen = true;

  /* Started before the session call rather than after it. The blog is public,
     so its content does not depend on who is asking, and a reader arriving
     from a search result should not wait on /api/me to find out there is an
     article here. Not awaited: it renders itself when it lands. */
  if (state.route === 'blogs') loadBlog();

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
    /* After sign-in rather than beside it: an invitation can only be accepted
       once there is an account to attach it to, and the roster that follows
       should already include whoever just joined. */
    await loadTeam();
    if (pendingInviteToken()) await acceptPendingInvite();
    render();
  } catch (err) {
    state.booted = true;
    if (err.status === 401) {
      state.auth = null;
      // Landed on an invitation link with no session: offer the work sign-up
      // it needs rather than the ordinary one it must not use.
      offerInviteSignup();
    } else if (state.account) {
      /* Network down but this browser already belongs to an account: carry on
         from the local copy rather than locking the user out of their own data.
         A 503 is the narrower case — the server answered, its database did
         not — and saying "offline" there sends people to check their wifi. */
      state.auth = { email: state.account, currency: state.currency };
      setNet(err.status === 503 ? 'paused' : 'offline', '');
      // Offered from the local copy too — the report reads what is on this
      // device, and being offline does not make yesterday less interesting.
      maybeAskRecap();
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
const RANGE_DAYS = Object.assign({ day: 1, week: 7, fortnight: 14, month: 30 },
  Object.fromEntries(LONG_RANGES.map(([key, , days]) => [key, days])));
// ISO dates sort lexically, so plain string comparison beats Date round-trips.
function windowStart(endIso, days) {
  const d = new Date(endIso + 'T00:00:00');
  d.setDate(d.getDate() - (Math.max(1, days) - 1));
  return iso(d);
}

/* ── a window is two dates, not a length ──

   Every window used to be a count of days ending on the selected date, which
   is what a trailing one is. Two of the ones offered now are not: "Last Month"
   ends on the last day of the previous month rather than on the day you are
   looking at, and a calendar month is 28 to 31 days depending on which. All
   Time has no length that can be written down at all.

   So the pair became the primary thing and the length became derived. Every
   trailing range still answers exactly as it did — windowStart is the same
   arithmetic — but the callers now ask for two dates and stop assuming the
   second one is today. */
function rangeWindow(range, endIso) {
  const anchor = new Date(endIso + 'T00:00:00');
  if (range === 'thismonth') {
    return { from: iso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), to: endIso };
  }
  if (range === 'lastmonth') {
    // Day 0 of this month is the last day of the previous one, whatever its length.
    return {
      from: iso(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)),
      to: iso(new Date(anchor.getFullYear(), anchor.getMonth(), 0))
    };
  }
  if (range === 'all') {
    /* Back to the first thing ever logged. Steps count: a day may carry a step
       count and nothing else, and All Time that started after it would be
       missing a day it can see on the chart. With nothing logged at all the
       window is the selected day, so the heading has a date to print rather
       than an empty string. */
    let first = endIso;
    const consider = (d) => { if (d && d < first) first = d; };
    state.entries.forEach((e) => consider(e.date));
    state.money.forEach((e) => consider(e.date));
    Object.keys(state.steps || {}).forEach(consider);
    return { from: first, to: endIso };
  }
  return { from: windowStart(endIso, RANGE_DAYS[range] || 1), to: endIso };
}

const DAY_MS = 86400000;
const daysBetween = (from, to) => Math.max(1,
  Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / DAY_MS) + 1);

// The window the page is currently on, and how many days are in it.
const currentWindow = () => rangeWindow(state.range, state.selectedDate);
const rangeDays = () => { const w = currentWindow(); return daysBetween(w.from, w.to); };

function withinRange(list) {
  const w = currentWindow();
  return list.filter((e) => e.date >= w.from && e.date <= w.to);
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
  const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (state.range === 'day') return f(state.selectedDate);
  const w = currentWindow();
  return `${f(w.from)} — ${f(w.to)}`;
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

/* Eating and buying food are different events, and only one of them is intake.

   They used to share a predicate, so a palengke run noted "rice, chicken,
   vegetables, milk" was read as a meal and put a thousand calories into the day
   it was bought on. Nobody eats the week's shop on the day they carry it home.
   What you buy still informs the pattern reading — it is a real signal about
   how you eat — but it contributes nothing to the day's intake.

   The raw match rather than the question, because cooking is claimed by a
   silent rule that has no question and must still be kept out of both. */
const isEatenRow = (row) => {
  const q = matchFollowUp(row);
  return !!q && q.key === 'food';
};
const isGroceryRow = (row) => {
  const q = matchFollowUp(row);
  return !!q && q.key === 'shopping-food';
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
  { g: 'water', re: /\bwater\b|tubig/, kcal: 0, p: 0, c: 0, f: 0, serve: 250 },
  /* Condiments, so "fish with soy sauce" does not bill the sauce as an
     unrecognised side dish worth a hundred and seventy calories. */
  { g: 'condiment', re: /soy sauce|toyo|vinegar|suka|ketchup|patis|fish sauce|\bsauce\b|mustard|sriracha|hot sauce|\bsalt\b|pepper\b|spices/, kcal: 15, p: 0, c: 2, f: 0.5, serve: 20 },
  { g: 'supplement', re: /creatine|multivitamin|vitamins?\b|electrolyte|\bbcaa\b|pre-?workout/, kcal: 5, p: 0, c: 1, f: 0 },
  { g: 'supplement', re: /whey|protein powder|protein shake|mass gainer/, kcal: 120, p: 24, c: 3, f: 1.5, serve: 300 },
  { g: 'coffee', re: /black coffee|americano|espresso|brewed coffee|kapeng barako|black kape/, kcal: 5, p: 0, c: 1, f: 0, serve: 240 },
  { g: 'coffee', re: /latte|cappuccino|mocha|frappe|white coffee|3-?in-?1/, kcal: 150, p: 6, c: 18, f: 6, serve: 350 },
  { g: 'coffee', re: /coffee|kape/, kcal: 60, p: 2, c: 8, f: 2, serve: 240 },
  /* Alcohol was in the labels table — it is named as something to watch — but
     never in this one, so a drink was a meal nobody could read and got billed
     as UNKNOWN_MEAL: 450 calories and twenty grams of protein for a glass of
     wine. Priced per standard serve, so "half glass wine" halves it.

     `gin` and `rum` carry word boundaries or they match ginger and crumble.
     There is deliberately no rule for "spirit": this app has a wellbeing
     dimension by that name, and reading a quiet evening as a shot of vodka is
     a worse failure than not reading it at all. */
  { g: 'alcohol', re: /cocktail|mojito|margarita|pi(?:ñ|n)a colada|sangria|negroni/, kcal: 250, p: 0, c: 25, f: 0, serve: 250 },
  { g: 'alcohol', re: /\bwines?\b|prosecco|champagne|merlot|cabernet|chardonnay|rose wine/, kcal: 125, p: 0, c: 4, f: 0, serve: 150 },
  { g: 'alcohol', re: /\bbeers?\b|lager|pilsner|stout|cerveza|san ?mig/, kcal: 140, p: 1.6, c: 11, f: 0, serve: 330 },
  { g: 'alcohol', re: /whisk(?:y|ey)|vodka|\bgin\b|\brum\b|tequila|brandy|liquor/, kcal: 100, p: 0, c: 0, f: 0, serve: 44 },
  { g: 'alcohol', re: /alcohol|inuman|\bbooze\b/, kcal: 150, p: 0, c: 8, f: 0, serve: 200 },

  /* Named tea drinks before plain tea, and the order is load-bearing: the tea
     rule below guards against "tea milk" with a lookahead, which does nothing
     for "milk tea" or "iced tea", where the qualifier comes first. Sitting
     under plain tea these two were billed at two calories a cup — a large milk
     tea read as lighter than the water it was made with. First match wins, so
     being above it is the fix; a lookbehind would parse-error on older iOS
     Safari and take the whole file with it. */
  { g: 'drink', re: /milk tea|boba/, kcal: 250, p: 3, c: 45, f: 6, serve: 500 },
  { g: 'drink', re: /soda|coke|sprite|softdrink|iced tea|juice/, kcal: 180, p: 0, c: 44, f: 0, serve: 400 },
  { g: 'tea', re: /green tea|black tea|\btea\b(?! ?(?:milk|boba))/, kcal: 2, p: 0, c: 0, f: 0, serve: 240 },

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
  { g: 'dairy', re: /\bmilk\b(?! ?tea)/, kcal: 120, p: 8, c: 12, f: 5, serve: 240 },
  { g: 'dairy', re: /yogurt|cheese/, kcal: 130, p: 8, c: 10, f: 6 },
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
/* Volume belongs here as much as weight. Without it "330ml coke" missed this
   rule entirely and fell through to the count below, where the 330 was read as
   a number of cokes and clamped to twenty of them — the same failure this
   regex was written to stop, arriving through the unit it did not know.

   Millilitres are counted as grams: everything drinkable here is near enough
   to the density of water, and a rule priced per 330ml can does not care about
   the third decimal. `l` is last in the alternation so `lbs` still wins the
   match, and it keeps its word boundary so "large" is not a litre. */
const MASS_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|kilograms?|mls?|millilit(?:re|er)s?|cls?|dls?|lit(?:re|er)s?|fl\.?\s*ozs?|gs?\b|gr\b|grams?|ozs?|ounces?|lbs?|pounds?|l\b)\b/i;
const TO_GRAMS = {
  kg: 1000, kilo: 1000, kilogram: 1000, g: 1, gr: 1, gram: 1,
  oz: 28.35, ounce: 28.35, lb: 453.6, pound: 453.6,
  ml: 1, millilitre: 1, milliliter: 1, cl: 10, dl: 100, l: 1000, litre: 1000, liter: 1000,
  floz: 29.57
};

// Typical serving weight where a rule does not name its own.
const DEFAULT_SERVE_G = 120;

/* How much of it. A weight is scaled against the serving the rule is priced
   for; otherwise a count is read, capped because a stray year or price in the
   text would otherwise multiply a meal into the tens of thousands. Both ends
   are clamped: no single written item is a fifth of a serving or five of them. */
function portionOf(item, hit) {
  const mass = MASS_RE.exec(item);
  if (mass) {
    // "fl. oz" and "fl oz" are the same unit as "floz"; the plural is not a
    // different one. Normalised in one place so the table needs one key each.
    const unit = mass[2].toLowerCase().replace(/[.\s]/g, '').replace(/s$/, '');
    const grams = Number(mass[1]) * (TO_GRAMS[unit] || 1);
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
      nights: 0, avgMins: 0,
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

  return {
    nights: r.nights, avgMins: r.avg, headline, detail: parts.join(' '), advice: '',
    drift: r.drift,
    // Per night, for the bar chart on the report card. Minutes rather than
    // hours: every other duration in here is minutes, and one unit is enough.
    list: r.list.map((n) => ({ date: n.date, mins: n.mins }))
  };
}

/* Roughly 7,700 kcal to a kilogram of body fat — the figure most guidance uses.
   It is an approximation resting on an approximation, which is why it is only
   ever shown as "if this held" and always with the word about in front of it. */
const KCAL_PER_KG = 7700;
const weekWeightKg = (netKcalPerDay) => (netKcalPerDay * 7) / KCAL_PER_KG;

/* ── net calories, day by day ──
   The gauges answer "how did the window go" with one figure. A window is not
   one day though, and an average hides the shape of it: five steady days and
   two heavy ones average out to the same number as seven middling ones. Each
   day is worked out on its own so the run of them can be drawn.

   Deliberately built from the same burnFor / foodReport the gauges use rather
   than from a quicker sum, so a bar and the dial above it can never disagree. */
function netSeries(dates, entries, money, weightKg) {
  const byDate = {};
  entries.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const moneyByDate = {};
  money.forEach((e) => { (moneyByDate[e.date] = moneyByDate[e.date] || []).push(e); });

  return dates.map((date) => {
    const rows = byDate[date] || [];
    const burn = burnFor(rows, weightKg, 1, [date]);
    const food = foodReport(rows, moneyByDate[date] || [], 1);
    const net = burn.kcal + burn.restKcal - food.kcal;
    return {
      date,
      net,
      burned: burn.kcal,
      rest: burn.restKcal,
      eaten: food.kcal,
      // A day with nothing logged is not a deficit, it is a day with no reading.
      logged: !!(rows.length || burn.steps)
    };
  });
}

/* The money tracker's equivalent, and much simpler: the two magnitudes are
   already in the rows, so there is nothing to estimate. Shaped as up/down from
   the start because unlike a calorie net, a day can genuinely have both — pay
   day with the groceries done on the way home is one bar each way. */
function moneySeries(dates, money) {
  const byDate = {};
  money.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  return dates.map((date) => {
    const rows = byDate[date] || [];
    return {
      date,
      up: rows.reduce((a, e) => a + (Number(e.in) || 0), 0),
      down: rows.reduce((a, e) => a + (Number(e.out) || 0), 0),
      logged: rows.length > 0
    };
  });
}

/* MET values — energy cost relative to sitting still. Burn is
   MET × kilograms × hours, the standard approximation. */
/* Matched against what was written, so every rule is anchored to a word.
   Without the boundaries a stem is a substring: "spin" found spinach, "run"
   found brunch, "row" found throw and "sport" found passport — each one
   quietly priced a meal as exercise. Stems that only ever begin a word keep
   their open ends (\w*) so inflections still land; the ones that are also
   short common syllables are spelled out in full. */
const METS = [
  { re: /\bjump ?ropes?\b|\bskipping rope\b/, met: 12.0 },
  { re: /\bboxing\b|\bmuay thai\b|\bmartial arts?\b|\bkarate\b|\btaekwondo\b|\bmma\b|\bjiu-?jitsu\b/, met: 10.0 },
  { re: /\bruns?\b|\brunning\b|\bran\b|\bjogs?\b|\bjogg\w*|\bsprint\w*/, met: 9.8 },
  { re: /\bclimb\w*|\bbouldering\b/, met: 8.0 },
  { re: /\bcrossfit\b|\bhiit\b|\bzumba\b|\bcircuits?\b/, met: 8.0 },
  { re: /\btreadmill\b/, met: 7.0 },
  { re: /\bswim\w*/, met: 7.0 },
  { re: /\brow(?:s|ing|er|ed)?\b/, met: 7.0 },
  { re: /\bbikes?\b|\bbiking\b|\bcycl\w*|\bspins?\b|\bspinning\b/, met: 7.5 },
  { re: /\bbasketball\b|\bfootball\b|\bsoccer\b|\bbadminton\b|\btennis\b|\bpadel\b|\bpickleball\b|\bvolleyball\b|\bsports?\b/, met: 6.5 },
  { re: /\bhikes?\b|\bhiking\b|\bhiked\b/, met: 6.0 },
  { re: /\bdanc\w*|\baerobics\b/, met: 5.5 },
  { re: /\belliptical\b|\bcross ?trainer\b|\b(?:up|down)?stairs?\b|\bcalisthenics?\b|\bpush-?ups?\b|\bsit-?ups?\b|\bplanks?\b|\bplanking\b/, met: 5.0 },
  { re: /\bgym\b|\bweights\b|\blift\w*|\bstrength\b/, met: 5.0 },
  { re: /\bpilates\b|\bstretch\w*/, met: 3.0 },
  { re: /\byoga\b/, met: 2.5 },
  { re: /\bwalk\w*|\blakad\b|\bstroll\w*/, met: 3.5 },

  /* Domestic effort. Housework is work — it is hours on your feet carrying
     things — and filing it as nothing made a Saturday of chores read as a day
     spent sitting down. Values are the Compendium's, which is where the rest of
     this table comes from, and they sit at the bottom of the range because that
     is honestly where they belong: an hour of cooking is not an hour of boxing.

     Below the sport rules on purpose. "Cleaning the bike" is still filed as
     cycling by the rule above, which is the reading most people intend. */
  { re: /\bgarden\w*|\bhalaman\b|\bmowing\b|\blawn\b|\byard work\b/, met: 4.0 },
  { re: /\bcar ?wash\w*|\bwash(?:ing)? the car\b|\bhugas kotse\b/, met: 3.5 },
  { re: /\bchores?\b|\bhousework\b|\bcleaning\b|\bclean the\b|\bmaglinis\b|\bsweep\w*|\bmops?\b|\bmopping\b|\bvacuum\w*|\blaundry\b|\blabada\b|\bwash(?:ing)? (?:the )?dishes\b|\bhugas pinggan\b|\biron(?:ing)? clothes\b|\btidy\w*/, met: 3.3 },
  /* The act, not the food. Bare "cook" would take "home cooked lunch" off the
     eaten side of the ledger and file the meal as exercise. Gerunds only, and
     "cooked" on its own stays a description of what was served. */
  { re: /\bcooking\b|\bcooked for\b|\bnagluto\b|\bmagluto\b|\bmeal ?prep\w*|\bbaking\b(?! soda)/, met: 2.5 },
  { re: /\bgrocer\w*|\bpalengke\b|\berrands?\b/, met: 2.3 },
  // Floor for anything filed as exercise but not named: the category is in the
  // text being matched, so a Workout entry is never worth nothing.
  { re: /\bworkouts?\b|\bexercis\w*|\bcardio\b|\btraining\b/, met: 5.0 }
];

/* The table's reading for one entry, or nothing at all.

   In one place, because three callers ran the match themselves — the chip on
   the card, the day's burn figure, and the list behind it — and a rule fixed
   in one stayed wrong in the other two.

   A row the follow-up filed as food is never priced as effort, whatever the
   words in it. The table is matched against the note as well as the activity,
   and the note is exactly where a meal gets described: a breakfast whose note
   read "cheese spinach sandwich" was priced as a spin class, so the card said
   95 kcal burned while the block above it said 829 eaten. When the words and
   the category disagree, the category the person chose wins. */
const metHit = (e) => {
  if (isEatenRow(e)) return null;
  const text = `${e.activity || ''} ${e.category || ''} ${e.note || ''}`.toLowerCase();
  return METS.find((m) => m.re.test(text)) || null;
};

const DEFAULT_WEIGHT_KG = 70;

/* What a single entry did to the day's calorie ledger, for the chip on its
   card. Effort is checked first — an entry naming both a workout and what was
   eaten after it should read as the effort it was — but metHit has already
   refused anything the follow-up filed as food, so a meal cannot reach the
   burn branch. Returns nothing for the great majority of entries, which are
   neither. */
function entryEnergy(e) {
  /* Not this product's subject, and this is where the chip on every card comes
     from — gating the blocks above left the rows themselves still pricing a
     meeting in calories. See workMode(). */
  if (workMode()) return null;
  const mins = span(e);
  if (!mins) return null;

  const met = metHit(e);
  if (met) {
    const kg = Number(state.weightKg) || DEFAULT_WEIGHT_KG;
    /* A refined reading replaces the table's, exactly as it does for food: two
       figures for one workout is not a second opinion. */
    const ai = burnEstimateFor(e);
    const kcal = ai ? ai.kcal : Math.round(met.met * kg * (mins / 60));
    return kcal ? { kind: 'burn', kcal, refined: !!ai, label: `~${kcal.toLocaleString('en-US')} kcal burned` } : null;
  }

  // Eaten, not bought: a grocery run has no business wearing a "kcal eaten" chip.
  if (isEatenRow(e)) {
    const local = nutritionFor([e]).kcal;
    if (!local) return null;
    /* A refinement has to reach the row as well as the block above it. Refined
       in one place and not the other, the card and the "What you ate" figure
       disagree about the same meal — which is the thing the report block's own
       comment says must never happen, applied one level down.

       The day's correction is apportioned across the day's rows rather than
       claimed per item: the estimate is asked for a day's worth of text at
       once, so what it actually knows is that day's total. Scaling by the ratio
       keeps the rows summing to exactly the figure on the block, which is the
       property that matters — no row claims a precision the estimate has not
       got. */
    const day = dayFood(e.date);
    const kcal = day && day.ai && day.local.kcal
      ? Math.max(1, Math.round(local * (day.ai.kcal / day.local.kcal)))
      : local;
    return { kind: 'food', kcal, refined: !!(day && day.ai), label: `~${kcal.toLocaleString('en-US')} kcal eaten` };
  }
  return null;
}

/* The food reading for one day, built through foodReport so the cache key is
   derived in exactly one place. A second copy of that derivation would look
   right and miss the cache on the first difference in punctuation.

   A day is the unit because refining is always a single day — every entry into
   it insists on one — so a row's figure cannot change depending on which range
   happens to be on screen. Memoised per render because the entry list asks for
   the same day once per row. */
/* A workout's refined figure, cached in the same map the meals use.

   The key is prefixed so the two cannot collide, and carries the weight and the
   minutes as well as the text: the same description at a different weight is a
   different number, and quietly reusing the old one would be wrong in the
   direction nobody would check. Prefixing rather than a second map means it
   syncs to the other devices with no new column — the server stores whatever
   keys it is given. */
const burnKeyOf = (row) => {
  const text = [String(row.activity || '').trim(), String(row.note || '').trim()].filter(Boolean).join(': ');
  if (!text) return null;
  const kg = Number(state.weightKg) || DEFAULT_WEIGHT_KG;
  return 'b:' + textKey(`${text}|${kg}|${span(row) || 0}`);
};
const burnEstimateFor = (row) => {
  const k = burnKeyOf(row);
  const hit = k ? state.aiCache[k] : null;
  return hit && hit.kcal ? hit : null;
};

async function refineBurn(id) {
  const row = state.entries.find((r) => r.id === id);
  if (!row) return;
  const key = burnKeyOf(row);
  if (!key || state.aiCache[key]) { render(); return; }
  const text = [String(row.activity || '').trim(), String(row.note || '').trim()].filter(Boolean).join(': ');

  state.aiBusy = 'burn';
  state.aiError = '';
  render();
  try {
    const res = await API.estimateBurn(text, Number(state.weightKg) || DEFAULT_WEIGHT_KG, span(row) || 0);
    state.aiCache[key] = Object.assign({}, res.estimate, { at: Date.now() });
    capAiCache();
    state.dirty.ai = true;
    writeJson(AI_CACHE_KEY, state.aiCache);
    /* The estimate is written to its own store; this writes the note saying it
       has not gone up yet. Without it the outbox flag lived only in memory, so
       a push that did not land before the tab closed — a restart, a dropped
       connection, a sync already blocked on something else — took with it the
       only record that anything was owed. The estimate stayed on the device
       that asked for it and never reached the others, which reads exactly like
       calibration not syncing. Every other flag in the outbox is saved beside
       the thing it describes; these two were not. */
    save();
    queueSync(0);
    flash(`Estimated · ${res.estimate.kcal.toLocaleString('en-US')} kcal burned`);
  } catch (err) {
    state.aiError = err.message || 'Could not get an estimate just now.';
  } finally {
    state.aiBusy = null;
    render();
  }
}

function buildDayFood(date) {
  const rows = state.entries.filter((r) => r.date === date);
  return rows.length ? foodReport(rows, [], [date]) : null;
}

let renderSeq = 0;
let dayFoodMemo = { at: -1, map: new Map() };
function dayFood(date) {
  if (dayFoodMemo.at !== renderSeq) dayFoodMemo = { at: renderSeq, map: new Map() };
  if (dayFoodMemo.map.has(date)) return dayFoodMemo.map.get(date);
  const r = buildDayFood(date);
  dayFoodMemo.map.set(date, r);
  return r;
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
    const hit = metHit(e);
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
    // Kept so a reader can be shown what went into the figure, not only the figure.
    dates: dates || [],
    assumedWeight: !weightKg
  };
}

function foodReport(entries, money, days) {
  /* One tracker owns intake: the activity tracker.

     A meal is one event that can leave two traces — a block of time and a
     payment — and counting both read lunch as two lunches. Rather than guess
     which payment belongs to which meal, the line is drawn where it needs no
     guessing at all: the activity tracker records what you ate, the money tracker
     records what it cost, and only the first feeds the calorie count.

     Nothing is thrown away. What you bought and what you paid to eat both still
     shape the pattern reading below, because where the food comes from says as
     much about how you eat as what you sat down to. They just add no calories. */
  const rows = entries.filter(isEatenRow);
  const paidFor = money.filter(isEatenRow);
  const bought = entries.filter(isGroceryRow).concat(money.filter(isGroceryRow));
  const uncounted = paidFor.concat(bought);

  /* A row counts as described if it says what was in it — and the activity is
     allowed to be where that is said. The old rule looked only at the note, so
     "half glass wine" logged as the activity with nothing in the note was
     treated as a meal that said nothing: no detail, and therefore no Refine
     button, on the entries most in need of one.

     A bare meal label still counts as saying nothing. MEAL_LABEL is what
     separates them: strip "Lunch" and there is nothing left, strip it from
     "Lunch: half glass wine" and there is. */
  const describes = (r) => !!((r.note || '').trim()
    || String(r.activity || '').toLowerCase().replace(MEAL_LABEL, '').trim());
  const withNotes = rows.filter(describes);
  const text = rows.concat(uncounted)
    .map((r) => `${r.activity || ''} ${r.note || ''}`).join(' ').toLowerCase();
  const found = FOOD_GROUPS.filter((g) => g.re.test(text));
  const list = (arr) => arr.map((g) => g.label).join(', ').replace(/, ([^,]*)$/, ' and $1');

  const good = found.filter((g) => g.good);
  const risk = found.filter((g) => g.risk);
  const watch = found.filter((g) => g.watch);
  const per = days > 1 ? ` across ${days} days` : '';

  if (!rows.length) {
    return {
      meals: 0,
      observation: uncounted.length
        ? `No meals logged in the activity tracker${per}, though ${uncounted.length} food ${uncounted.length === 1 ? 'entry is' : 'entries are'} in the money tracker. Calories are read from the activity tracker only — paying for a meal, or shopping for one, is not the same as eating it — so log what you ate there and this fills in.`
        : `No meals logged${per}. Food is the easiest thing to eat without noticing, and the hardest to remember accurately a week later — logging even roughly is what makes any of this readable.`,
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
  /* Said out loud, always. Money quietly left out of a calorie count is how
     this comes back as "why is my lunch missing" — and the sentence doubles as
     the instruction for getting it counted. */
  if (paidFor.length) {
    // Not "only" — the same meal may well be logged in both, and this sentence
    // has to read true either way. What it states is that money adds no calories.
    parts.push(`${paidFor.length} food ${paidFor.length === 1 ? 'payment is' : 'payments are'} logged too. Calories are read from the activity tracker alone, so anything you ate needs an entry there to count.`);
  }
  if (bought.length) {
    parts.push(`${bought.length} food ${bought.length === 1 ? 'shop' : 'shops'} logged too — read for what you buy, not counted as eaten.`);
  }
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
  // Joined only where both halves exist, so a row described by its activity
  // alone does not go up as "half glass wine:" with a dangling colon.
  const detail = withNotes
    .map((r) => [String(r.activity || '').trim(), String(r.note || '').trim()].filter(Boolean).join(': '))
    .join('\n');
  /* A refinement already asked for and answered, keyed by the text it was asked
     about — so it survives a reload and is found again the moment the same
     meals are on screen. */
  const key = detail ? textKey(detail) : '';
  const ai = key ? state.aiCache[key] || null : null;
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
    /* The effective figure, resolved here rather than at each reader. A refined
       estimate replaces the local one everywhere or nowhere: the dial and the
       sentence under it disagreeing is not a second opinion, it is a question
       nobody on the page can answer. `local` keeps the original so the block
       can still show what the reading was before. */
    kcal: ai ? ai.kcal : n.kcal,
    ai,
    local: { kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat },
    detail,
    key,
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
    obs.push(`${amount(outSum)} went out over ${d} ${d === 1 ? 'day' : 'days'} — about ${amount(Math.round(perDay))} a day${topPurpose ? `, led by ${topPurpose.name.toLowerCase()}` : ''}.`);
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
    rec.push(`${repeat.name} came up ${repeat.count} times, averaging ${amount(Math.round(repeat.mins / repeat.count))}. Small repeats are easier to cut by frequency than by size — one fewer a week beats trying to spend less each time.`);
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
    // Rounded: an average carried to the centavo claims a precision that
    // dividing a fortnight by fourteen does not have.
    headline: outSum
      ? `${amount(Math.round(perDay))} a day across ${d} ${d === 1 ? 'day' : 'days'}`
      : `${amount(inSum)} in, nothing spent`,
    perDay: amount(Math.round(perDay)),
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
    // What the trend is measured against, so a card can show both ends of it.
    prevOutLabel: amount(prevOut),
    topPurposeLabel: topPurpose ? topPurpose.name : '',
    discLabel: amount(kinds.discretionary),
    essentialLabel: amount(kinds.essential),
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

  /* ── the whole window, for the report deck ──
     The insight cards read "today" and "the finished days behind it"; a report
     is about the window as a whole, today included. Every date in it is
     enumerated rather than taken from the entries, so a day carrying only a
     step count still counts as a day. */
  const windowDates = (() => {
    const out = [];
    for (let i = 0; i < winDays; i++) {
      const d = new Date(s.selectedDate + 'T00:00:00');
      d.setDate(d.getDate() - i);
      out.push(iso(d));
    }
    return out.sort();
  })();
  const rangeList = rangeEntries();
  const rangeWb = wellbeing(rangeList, { count: stepsIn(windowDates), date: s.selectedDate, days: winDays });
  const rangeBusy = (() => {
    const per = {};
    const m = effective(resolveSpans(rangeList));
    rangeList.forEach((e) => { per[e.date] = (per[e.date] || 0) + m(e); });
    const top = Object.keys(per).sort((a, b) => per[b] - per[a])[0];
    return top ? { date: top, mins: per[top], days: Object.keys(per).length } : null;
  })();

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
      date: d,
      // The number behind totalLabel, for the cards that compare days.
      total: outSumDay,
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
    /* Walked from the window's own end rather than from the selected date:
       Last Month ends before it, and counting back from today would read a
       month that has not happened. */
    const w = currentWindow();
    for (let d = new Date(w.to + 'T00:00:00'); iso(d) >= w.from; d.setDate(d.getDate() - 1)) {
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

  const out = {
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
    /* Named rather than measured for the two calendar windows and All Time:
       "last 30 days" is a true description of a trailing month and a false one
       of September, and "last 412 days" is not how anyone says "everything". */
    rangeLabel: s.range === 'day' ? 'this day'
      : s.range === 'thismonth' ? 'this month'
        : s.range === 'lastmonth' ? 'last month'
          : s.range === 'all' ? 'everything logged'
            : `last ${winDays} days`,
    leaderboard: totals.map((t) => ({ name: t.name, color: t.color, label: fmtShort(t.mins), width: `${Math.round((t.mins / top) * 100)}%` })),

    // Every date in the window, enumerated — a chart needs the nights with
    // nothing logged as much as the ones with something.
    windowDates,
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
    /* The stat above is this window's net. The balance under it is the whole
       account, which is a different figure whenever the window is not the
       whole log — so it is named rather than left to be inferred. */
    netNote: (() => {
      const b = moneyBalance(s.money);
      const base = inSum - outSum < 0 ? 'Spending outran what came in.' : 'You kept some of it. Good.';
      if (!b.inCents && !b.countedCents) return base;
      const left = `${amount(Math.abs(b.leftCents) / 100)}${b.leftCents < 0 ? ' over' : ' left'}`;
      const aside = b.asideCents ? ` ${amount(b.asideCents / 100)} is held aside from it.` : '';
      return `${base} Across everything logged, ${left}.${aside}`;
    })(),

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
    reportRows: totals.map((t) => ({ name: t.name, color: t.color, count: t.count, mins: t.mins, time: fmtLong(t.mins), pct: `${Math.round((t.mins / (total || 1)) * 100)}%` })),
    // The unformatted total, for cards that need to divide it rather than print it.
    rangeTotalMins: total,

    reportDays,
    reportEntryCount: reportSource.length,
    /* The window's entries in clock order — the log itself rather than a
       total of it. Only the raw-summary card reads this, and only on a single
       day: over a fortnight it would be two hundred rows behind a button,
       which is a list nobody opens rather than a summary anybody reads.

       An entry that wrapped past midnight is dated the day it ended, so a
       sleep from 11PM to 6AM carries from=1380 and sorted to the bottom — the
       night that opened the day appearing after the evening walk that closed
       it. Sorting it from the previous evening puts it where it belongs in
       the telling: first. */
    rangeRows: winDays === 1
      ? rangeList.slice().sort((a, b) => {
        const at = (e) => (wraps(e) ? e.from - 1440 : e.from);
        return (at(a) - at(b)) || (a.to - b.to);
      })
      : [],
    /* The other end of the busiest day. Only meaningful once there are two days
       to compare, and drawn from days that carry something — a day with nothing
       logged is not a quiet day, it is a day the app cannot see. */
    quietestDay: reportDays.length > 1
      ? reportDays.reduce((a, d) => (d.total < a.total ? d : a), reportDays[0]) : null,

    /* Readings across the whole window, for the report deck. */
    rangeReadings: dimensionReadings(rangeWb, winDays),
    rangeSleep: sleepReading(rangeList, winDays),
    rangeBurn: burnFor(rangeList, s.weightKg, winDays, windowDates),

    rangeFood: foodReport(rangeList, mRangeList, winDays),
    rangeSteps: stepsIn(windowDates),
    rangeDayCount: winDays,
    rangeBusiest: rangeBusy
      ? { label: dayLabel(rangeBusy.date), value: durShort(rangeBusy.mins), days: rangeBusy.days }
      : null,

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

  /* Day-by-day nets are the most expensive thing here — a burn and a food read
     per day of the window — and most renders never draw them. Defined as
     getters that build once and cache, so compute() stays cheap for the many
     calls that only want the totals, and a chart still just reads v.rangeNet. */
  const lazy = (name, build) => {
    let made = false, value = null;
    Object.defineProperty(out, name, {
      configurable: true, enumerable: false,
      get() { if (!made) { value = build(); made = true; } return value; }
    });
  };
  lazy('rangeNet', () => (winDays > 1 ? netSeries(windowDates, rangeList, mRangeList, s.weightKg) : null));
  lazy('pastNet', () => (pastSpan.length > 1 ? netSeries(pastSpan, pastList, pastMoney, s.weightKg) : null));
  // Cheap by comparison, but lazy for the same reason: only two views read it.
  lazy('rangeCash', () => (winDays > 1 ? moneySeries(windowDates, mRangeList) : null));

  return out;
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

/* ── the searchable picker ──

   A native <select> is fine at six categories and unusable at twenty: the list
   is only ever as long as your own invention, and the answer to "where is
   Vervé" should not be scrolling. This is the same control both trackers use —
   the button shows what is chosen, the panel filters as you type.

   The filtering happens in the DOM rather than through state, because a render
   per keystroke would rebuild the field the caret is sitting in. `data-pick`
   names which picker a node belongs to so one handler serves both. */
/* ── deleting a name ──
   A category and everything logged under it. Deletes are tombstoned and
   synced, so this reaches every device the account is signed into and there is
   no undo — which is why it counts what it is about to destroy and says the
   number out loud before doing it. */
const renamingPick = (kind, name) =>
  !!(state.pickRename && state.pickRename.kind === kind && state.pickRename.name === name);

/* Renaming a category or a purpose.

   The name IS the reference — every entry carries it as a string, not an id —
   so a rename that touched only the vocabulary would orphan every row filed
   under the old one. They are rewritten here, which is the one place in the app
   allowed to rewrite what someone typed: the field is a pointer, not prose.

   It cannot be done in place either. Categories and purposes sync keyed on
   their name, so editing the record would teach the server the new name while
   it went on serving the old one beside it. Old name tombstoned, new one put
   back at the same index.

   The index matters for more than order: colour is derived from position, so
   appending the renamed one would silently repaint it and everything after. */
function renamePick() {
  const t = state.pickRename;
  if (!t) return;
  const money = t.kind === 'purpose';
  const vocab = money ? 'purposes' : 'categories';
  const noun = money ? 'purpose' : 'category';
  const from = t.name;
  const to = String(state.pickRenameName || '').trim().slice(0, 60);

  if (!to || to === from) { ACTIONS['pick-rename-cancel'](); return; }
  if (state[vocab].some((c) => c.name !== from && c.name.toLowerCase() === to.toLowerCase())) {
    flash(`There is already a ${noun} called ${to}`);
    return;
  }
  const at = state[vocab].findIndex((c) => c.name === from);
  if (at < 0) { ACTIONS['pick-rename-cancel'](); return; }
  const held = state[vocab][at];

  state[vocab] = state[vocab].map((c, i) => (i === at
    ? touch(vocab, { name: to, color: held.color, position: held.position })
    : c));
  // Stamped so the old name goes on the other devices too, rather than coming
  // back on the next pull and sitting there beside its replacement.
  bury(vocab, from);

  const rowKind = money ? 'money' : 'entries';
  const field = money ? 'purpose' : 'category';
  state[rowKind] = state[rowKind].map((r) => (r[field] === from
    ? touch(rowKind, Object.assign({}, r, { [field]: to }))
    : r));

  // Everything else still holding the name it just lost.
  if (money) {
    if (state.mForm.purpose === from) state.mForm = Object.assign({}, state.mForm, { purpose: to });
  } else {
    if (state.timerCategory === from) state.timerCategory = to;
    if (state.form.category === from) state.form = Object.assign({}, state.form, { category: to });
  }
  if (state.logFilter === from) state.logFilter = to;
  if (state.m && state.m.cat === from) state.m.cat = to;

  state.pickRename = null; state.pickRenameName = '';
  state.pickOpen = null; state.pickQuery = '';
  clearFocus();
  save(); queueSync(0); render();
  flash(`Renamed · ${from} → ${to}`);
}

function pickDeleteDialog() {
  const t = state.pickDelete;
  if (!t) return '';
  const money = t.kind === 'purpose';
  const rows = (money ? state.money : state.entries).filter((r) => (money ? r.purpose : r.category) === t.name);
  const noun = money ? 'purpose' : 'category';
  return lightbox({
    icon: 'trash',
    // Alert red, because this is the one dialog here that destroys something.
    tone: 'var(--zg-alert)',
    kicker: rows.length ? 'This cannot be undone' : 'Just checking',
    title: `Delete “${t.name}”?`,
    closeAct: 'pick-del-cancel',
    body: rows.length
      ? `<p><strong>This also deletes ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}</strong>
         logged under it. They go from every device you are signed in on, and they cannot be brought back.</p>`
      : `<p>Nothing is logged under this ${esc(noun)}, so only the ${esc(noun)} itself goes.</p>`,
    actions: `
      <button class="btn btn-secondary" data-act="pick-del-cancel">Cancel</button>
      <button class="btn" data-act="pick-del-confirm"
        style="background:#8a2f4a;color:#fff;border-color:#8a2f4a;">${rows.length ? `Delete ${esc(noun)} and ${rows.length}` : `Delete ${esc(noun)}`}</button>`
  });
}

/* Naming a new one without leaving the list you were searching. It used to
   close the popover and open a panel elsewhere on the page, which meant
   discovering the name was missing and then losing your place looking for
   somewhere to add it.

   What was typed into the search seeds the field: someone who typed "Cyclin"
   and found nothing has already said what they want to call it. */
function pickCreateRow(kind, newLabel) {
  if (state.pickNew !== kind) {
    return `<button type="button" class="pick-new" data-act="pick-new" data-pick="${esc(kind)}">${esc(newLabel)}</button>`;
  }
  return `
    <div class="pick-create">
      <input class="input" data-k="pick-new-name" data-sync="pickNewName" value="${esc(state.pickNewName)}"
        placeholder="Name it" autocomplete="off" data-enter="pick-create" data-pick="${esc(kind)}">
      <button type="button" class="btn btn-primary" data-act="pick-create" data-pick="${esc(kind)}">Add</button>
    </div>`;
}

function pickerField(kind, label, names, selected, newLabel) {
  const open = state.pickOpen === kind;
  return `
          <div class="field pick-field" data-pick-field="${esc(kind)}">
            <label>${esc(label)}</label>
            <div class="pick-anchor">
            <button type="button" class="input pick-btn" data-act="pick-open" data-pick="${esc(kind)}"
              aria-haspopup="listbox" aria-expanded="${open}">
              <span class="pick-current">${esc(withIcon(selected))}</span>
              <span class="pick-caret" aria-hidden="true">▾</span>
            </button>
            ${open ? `
            <div class="pick-pop" role="listbox">
              <input class="input pick-search" data-k="pick-search" data-pick-search="${esc(kind)}"
                type="text" placeholder="Search ${esc(label.toLowerCase())}…" autocomplete="off"
                aria-label="Search ${esc(label.toLowerCase())}">
              <div class="pick-list" data-pick-list>
                ${names.map((n) => (renamingPick(kind, n) ? `
                <span class="pick-row is-editing">
                  <input class="input pick-rename" data-k="pick-rename-name" data-sync="pickRenameName"
                    value="${esc(state.pickRenameName)}" data-enter="pick-rename-save"
                    aria-label="Rename ${esc(n)}" autocomplete="off">
                  <button type="button" class="pick-del pick-ok" data-act="pick-rename-save"
                    aria-label="Save the new name" title="Save">✓</button>
                  <button type="button" class="pick-del" data-act="pick-rename-cancel"
                    aria-label="Cancel renaming" title="Cancel">✕</button>
                </span>` : `
                <span class="pick-row">
                  <button type="button" class="pick-opt${n === selected ? ' is-on' : ''}" role="option"
                    aria-selected="${n === selected}" data-act="pick-choose" data-pick="${esc(kind)}"
                    data-name="${esc(n)}" data-find="${esc(n.toLowerCase())}">${esc(withIcon(n))}</button>
                  <button type="button" class="pick-del" data-act="pick-rename" data-pick="${esc(kind)}"
                    data-name="${esc(n)}" aria-label="Rename ${esc(n)}" title="Rename ${esc(n)}">✎</button>
                  <button type="button" class="pick-del" data-act="pick-del" data-pick="${esc(kind)}"
                    data-name="${esc(n)}" aria-label="Delete ${esc(n)}" title="Delete ${esc(n)}">✕</button>
                </span>`)).join('')}
                <div class="pick-empty" hidden>Nothing matches that.</div>
              </div>
              ${pickCreateRow(kind, newLabel)}
            </div>
            <div class="pick-shade" data-backdrop="pick-close"></div>` : ''}
            </div>
          </div>`;
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
  const all = pickCategories();
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
    ${item('app-time', 'time', 'Activity', !v.isMoney)}
    ${workMode() ? '' : item('app-money', 'money', 'Money', v.isMoney)}
    ${workMode() ? '' : `
    <a class="bn-donate" href="${DONATE_URL}" data-donate target="_blank" rel="noopener noreferrer">
      <span class="bn-icon">${NAV_ICONS.donate}</span><span class="bn-label">Donate</span>
    </a>`}
    ${workMode() ? '' : item('scroll-insights', 'insights', 'Insights', false)}
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
    ? `${pill('app-time', 'Activity Tracker', false)}${workMode() ? '' : pill('app-money', 'Money Tracker', true)}`
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

/* Sits above the bottom bar rather than over it, so it never covers a
   destination. Ask takes the top slot and back-to-top the one below, which is
   why they share a column rather than each being fixed on their own: the
   column keeps back-to-top's place reserved while it is hidden, so Ask holds
   still instead of hopping 54px the first time the page is scrolled.

   Only the full layout reaches this — the phone's takeover carries Ask in its
   tab bar. On a phone in full view it is the only way in at all, because
   the header carries a menu rather than a row of buttons, and Ask Zimpan is not
   there to fall back to. */
function backToTop() {
  /* One button, carrying whichever pad belongs to the tracker on screen. The
     to-do pad is about the hours and the money pad is about the money, so
     showing both at once would be offering a list that has nothing to do with
     what is being looked at. Teams never reaches the money side at all — see
     the guard in render() — so the plan pad cannot appear there. */
  const money = state.app === 'money';
  const open = money ? planOpenCount() : todoOpenCount();
  return `
  <div class="fabs no-print">
    ${money ? planPad() : todoPad()}
    <button class="${money ? 'fab-plan' : 'fab-todo'}" data-act="${money ? 'plan-toggle' : 'todo-toggle'}"
      aria-expanded="${!!(money ? state.planOpen : state.todoOpen)}">
      ${nodeIcon(money ? 'scales' : 'todo', 16)}<span>${money ? 'Money Plan' : 'To Do'}</span>${open ? `<b class="fab-tally">${open}</b>` : ''}
    </button>
    ${state.aiEstimates ? `
    <button class="fab-ask" data-act="chat-open">
      ${nodeIcon('pulse', 16)}<span>Ask Zimpan</span>
    </button>` : ''}
    <button class="backtotop" data-backtotop data-act="scroll-top" aria-label="Back to top">
      ${NAV_ICONS.up}
    </button>
  </div>`;
}

/* ── the to-do pad ──

   A sticky pad rather than a page: the notes are a handful of lines, they are
   read at a glance, and they belong beside whatever is on screen instead of
   somewhere you have to go. So it hangs off the same fixed column as Ask
   Zimpan on a wide screen, and comes up as a sheet on a phone, where a panel
   pinned to a corner would cover the thing it is meant to sit beside.

   A note is text and a status. No dates, no priorities, no ordering by hand:
   every one of those is a second thing to maintain, and the pad exists to be
   written on and glanced at. Nothing here is shown to anyone else — a team
   admin sees hours against projects and never this. */
const TODO_STATUSES = [
  /* Listed in the order the picker offers them, which is the order a piece of
     work moves through. `rank` is where the note then sits in the pad, and the
     two differ in one place: For review outranks Pending, because something
     waiting on a person is nearer being finished than something not started,
     and it is the one that needs chasing. */
  { key: 'pending', label: 'Pending', tone: '#6b6580', tint: '#efedf5', rank: 2 },
  { key: 'doing', label: 'In progress', tone: '#5f3ac9', tint: '#f2eefe', rank: 0 },
  { key: 'review', label: 'For review', tone: '#9a6b12', tint: '#fdf1de', rank: 1 },
  { key: 'done', label: 'Complete', tone: '#0e7a5c', tint: '#e3f5ed', rank: 3 },
  { key: 'stuck', label: 'Stuck', tone: '#8a2f4a', tint: '#fdecf1', rank: 4 }
];
const TODO_MAX = 500;
const todoStatus = (k) => TODO_STATUSES.find((s) => s.key === k) || TODO_STATUSES[0];

/* Grouped by status, in the order the pad is read: what is being worked on
   first, then what is waiting, then what is finished, and what is blocked at
   the bottom where it can be looked at deliberately rather than scrolled past.
   Newest first inside each group, so a group behaves like the pad did.

   Marking a note therefore moves it, which is the point — the list is a
   picture of where things stand, and it is worth rearranging to keep that
   true. The chip and the rank come from one table, so the two cannot disagree
   about where a status belongs. */
const todoRows = () => state.todos.slice().sort((a, b) => (
  todoStatus(a.status).rank - todoStatus(b.status).rank
  || (b.createdAt || 0) - (a.createdAt || 0)
));
const todoOpenCount = () => state.todos.filter((t) => t.status !== 'done').length;

/* Client-minted, like every other id in this app, and checked for a collision
   because two notes made inside the same millisecond would otherwise be one
   row on the server. */
function newTodoId() {
  let id;
  do { id = `td${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
  while (findRow('todos', id));
  return id;
}

function todoNote(t) {
  const st = todoStatus(t.status);
  const armed = state.todoArm === t.id;
  /* Only while it is stuck. The reason is kept when a note moves off stuck —
     something blocked twice is usually blocked on the same thing — but showing
     it under a note that is running again would be a lie about the present. */
  const why = t.status === 'stuck' ? String(t.blocked || '').trim() : '';
  return `
  <div class="todo-note" style="--tone:${st.tone};--tint:${st.tint};">
    <textarea class="todo-text" rows="1" maxlength="${TODO_MAX}"
      data-k="todo-${esc(t.id)}" data-todo-text="${esc(t.id)}" data-todo-grow
      placeholder="What needs doing?" aria-label="Note">${esc(t.text || '')}</textarea>
    ${t.status === 'stuck' ? `
    <button class="todo-why" data-act="todo-why" data-id="${esc(t.id)}">
      ${why ? `<span class="todo-why-mark">Stuck:</span> ${esc(why)}` : 'Say why this is stuck'}
    </button>` : ''}
    <div class="todo-foot">
      <select class="todo-status" data-change="todo-status" data-id="${esc(t.id)}" aria-label="Status">
        ${TODO_STATUSES.map((o) => `<option value="${o.key}"${o.key === st.key ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <button class="todo-del${armed ? ' is-armed' : ''}" data-act="todo-del" data-id="${esc(t.id)}"
        aria-label="${armed ? 'Delete this note for good' : 'Delete note'}">${armed ? 'Delete?' : nodeIcon('trash', 15)}</button>
    </div>
  </div>`;
}

/* The pad's contents, shared by the panel and the sheet so the two can never
   drift into being different features. */
function todoBody() {
  const rows = todoRows();
  return `
  <div class="todo-head">
    <span class="todo-name">To Do</span>
    ${rows.length ? `<span class="todo-count">${todoOpenCount()} open</span>` : ''}
    <button class="todo-x" data-act="todo-close" aria-label="Close the pad">✕</button>
  </div>
  <button class="todo-new" data-act="todo-add">+ New note</button>
  <div class="todo-list" data-todo-list>
    ${rows.length
    ? rows.map(todoNote).join('')
    : `<p class="todo-empty">Nothing on the pad yet. A note is a line of text and a status — write one and it follows you to your other devices.</p>`}
  </div>`;
}

/* Two surfaces, one for each shape of screen. The phone gets a sheet because a
   panel pinned to the bottom-right of a phone is the whole screen anyway, and
   a sheet is the gesture the rest of the phone app already uses. */
/* The entrance runs on the way in and never again.

   Every render replaces the whole tree, so the pad is a new element each time —
   and an animation declared on the class replayed on every one of them. A sync
   landing behind an open pad made it drop to nothing and slide back up, which
   is not an entrance, it is a flicker. `is-new` is on only for the render that
   puts the pad on screen; paintTodo clears it once it is there, and sets it
   again when the pad has gone, so the next opening still arrives. */
let todoFresh = true;

const todoPad = () => (!state.todoOpen || isPhone() ? '' : `
  <div class="todo-pad${todoFresh ? ' is-new' : ''}" role="dialog" aria-label="To Do">${todoBody()}</div>`);

const todoSheet = () => (!state.todoOpen || !isPhone() ? '' : `
  <div class="todo-scrim${todoFresh ? ' is-new' : ''}" data-backdrop="todo-close">
    <div class="todo-drawer" role="dialog" aria-label="To Do">
      <div class="todo-grab" aria-hidden="true"></div>
      ${todoBody()}
    </div>
  </div>`);

/* Asked when a note is marked stuck, and reachable afterwards from the line
   under it. Skippable on purpose: "stuck" is worth recording even when there
   is no time to say why, and a dialog that will not let go of the pad until it
   is fed would stop people marking things honestly. */
function todoWhyDialog() {
  const w = state.todoWhy;
  if (!w) return '';
  const row = findRow('todos', w.id);
  if (!row) return '';
  const had = String(row.blocked || '').trim();
  return lightbox({
    icon: 'history',
    tone: '#8a2f4a',
    kicker: row.text ? `“${String(row.text).slice(0, 60)}”` : 'This note',
    title: 'What is holding this up?',
    body: `
      <p style="margin:0 0 10px;font-size:12.5px;color:var(--color-neutral-600);">
        Optional, and only for you — a line now is what makes this readable in a week.</p>
      <textarea class="input" data-k="todo-why-draft" data-sync="todoWhy.draft" rows="3" maxlength="500"
        placeholder="e.g. waiting on the bank to confirm the transfer"
        style="width:100%;resize:vertical;min-height:78px;font:inherit;font-size:14px;line-height:1.5;padding:10px 12px;">${esc(w.draft)}</textarea>`,
    closeAct: 'todo-why-skip',
    actions: `
      ${had ? `<button class="btn btn-ghost" data-act="todo-why-clear" style="color:#8a2f4a;">Remove</button>` : ''}
      <button class="btn btn-ghost" data-act="todo-why-skip">Not now</button>
      <button class="btn btn-primary" data-act="todo-why-save">Save</button>`
  });
}

/* The list keeps its place across a render, and every note is sized to its own
   text. Both have to happen after the tree is replaced: the textareas are new
   elements with no height of their own, and the scroller is a new scroller. */
let todoScroll = 0;
function paintTodo() {
  const list = root.querySelector('[data-todo-list]');
  /* Nothing on screen: the next one to open is a new one, and starts at its
     own top rather than where the last one was left. */
  if (!list) { todoScroll = 0; todoFresh = true; return; }
  todoFresh = false;
  /* Sized here rather than by rows, because a note is as tall as what is
     written in it. Done before the frame is painted, in the same task as the
     tree that was just built, so no half-height box is ever shown. */
  root.querySelectorAll('[data-todo-grow]').forEach((el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
  });
  list.scrollTop = todoScroll;
}

/* ── the money pad ──

   The to-do pad answers "what needs doing". On the money tracker the question
   is a different one — what is coming out that has not gone out yet — so it
   gets a pad of its own rather than the same one relabelled. The two never
   share a screen: the button above Ask Zimpan carries whichever belongs to the
   tracker you are on, and the phone's menu lists both.

   A line is text, a figure, and where it will be filed. The figure is the
   whole reason this is not simply the to-do pad on another tab: a list of
   planned spends that does not add itself up is a list you still have to do
   arithmetic on, and the arithmetic is the question. So the pad totals what is
   unpaid and says what that leaves of the money already logged.

   Kept out of the ledger until it happens. A plan has no date it occurred on
   and may never occur at all; letting one into money_entries would put money
   that was never spent into the balance, the insights and the report. Paying a
   line writes a real entry and marks the line paid — one direction only, so
   the ledger stays a record of what happened. */
const PLAN_STATUSES = [
  /* Ordered as the picker offers them, which is the order a bill moves
     through. `rank` is where the line then sits: what is due first, because it
     is what needs money now; what is dropped at the bottom, kept as a record
     of a decision rather than as something to act on. */
  { key: 'due', label: 'Due now', tone: '#8a2f4a', tint: '#fdecf1', rank: 0, owed: true },
  { key: 'planned', label: 'Planned', tone: '#5f3ac9', tint: '#f2eefe', rank: 1, owed: true },
  { key: 'paid', label: 'Paid', tone: '#0e7a5c', tint: '#e3f5ed', rank: 2, owed: false },
  { key: 'dropped', label: 'Dropped', tone: '#6b6580', tint: '#efedf5', rank: 3, owed: false }
];
const PLAN_MAX = 500;
const planStatus = (k) => PLAN_STATUSES.find((s) => s.key === k) || PLAN_STATUSES[1];
// Whether a line is still money you expect to part with.
const planOwed = (row) => planStatus(row.status).owed;

const planRows = () => state.plans.slice().sort((a, b) => (
  planStatus(a.status).rank - planStatus(b.status).rank
  || (b.createdAt || 0) - (a.createdAt || 0)
));
const planOpenCount = () => state.plans.filter(planOwed).length;

function newPlanId() {
  let id;
  do { id = `pl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
  while (findRow('plans', id));
  return id;
}

/* The arithmetic, in minor units all the way through — the same rule
   moneyBalance follows, and for the same reason: these are figures somebody
   checks against a bank app, and cents that drift are worse than no figure.

   `left` is the whole log's balance, not the window's: a bill is paid out of
   what you actually have, not out of what happened to fall inside the range
   the tracker is showing. */
function planTotals() {
  const owedCents = state.plans.reduce((a, r) => a + (planOwed(r) ? mCents(r.amount) : 0), 0);
  const dueCents = state.plans.reduce((a, r) => a + (r.status === 'due' ? mCents(r.amount) : 0), 0);
  const leftCents = moneyBalance(moneyAll()).leftCents;
  return {
    owedCents, dueCents, leftCents,
    afterCents: leftCents - owedCents,
    owed: amount(owedCents / 100),
    due: amount(dueCents / 100),
    left: amount(leftCents / 100),
    after: amount(Math.abs(leftCents - owedCents) / 100),
    count: state.plans.filter(planOwed).length
  };
}

/* The strip at the top of the pad: what is owed, and what paying it leaves.

   Written as two plain sentences rather than a row of stats. "₱4,200 planned"
   on its own is a number; what somebody actually wants to know is whether it
   fits, and that is a subtraction they should not have to do in their head
   while looking at the list. Nothing is hidden when it does not fit — a
   negative answer is the one worth showing most. */
function planSumInner() {
  const t = planTotals();
  const short = t.afterCents < 0;
  return `
    <span class="plan-sum-fig">${esc(t.owed)}</span>
    <span class="plan-sum-cap">to pay${t.dueCents ? ` · ${esc(t.due)} due now` : ''}</span>
    <span class="plan-sum-line${short ? ' is-short' : ''}">
      ${short
    ? `That is ${esc(t.after)} more than the ${esc(t.left)} you have logged.`
    : `Leaves ${esc(t.after)} of the ${esc(t.left)} you have logged.`}
    </span>`;
}

/* Always in the tree and hidden when there is nothing owed, rather than drawn
   on demand: typing a figure does not re-render, so what a keystroke changes
   has to already be there for paintPlanSum to reach it. */
const planSum = () => `<div class="plan-sum" data-plan-sum${planTotals().count ? '' : ' hidden'}>${planSumInner()}</div>`;

/* The totals, and the two things beside them that a typed figure changes: how
   many lines are owed, and whether a line has enough on it to be logged. */
function paintPlanSum() {
  const box = root.querySelector('[data-plan-sum]');
  if (!box) return;
  const t = planTotals();
  box.hidden = !t.count;
  box.innerHTML = planSumInner();
  const chip = root.querySelector('[data-plan-count]');
  if (chip) {
    chip.hidden = !t.count;
    chip.textContent = `${t.count} to pay`;
  }
  root.querySelectorAll('[data-plan-log]').forEach((btn) => {
    const row = findRow('plans', btn.dataset.planLog);
    btn.hidden = !row || !planOwed(row) || !mCents(row.amount);
  });
}

/* One planned spend. The amount is an ordinary number field rather than the
   phone's tap-pad: this pad is written on with a keyboard already — the line
   above it is a sentence — so summoning one for the figure changes nothing,
   where routing through the pad would mean leaving the list to type a number
   and coming back. */
function planLine(row) {
  const st = planStatus(row.status);
  const armed = state.planArm === row.id;
  const owed = st.owed;
  const cents = mCents(row.amount);
  return `
  <div class="todo-note plan-note" style="--tone:${st.tone};--tint:${st.tint};">
    <textarea class="todo-text" rows="1" maxlength="${PLAN_MAX}"
      data-k="plan-${esc(row.id)}" data-plan-text="${esc(row.id)}" data-todo-grow
      placeholder="What is coming out?" aria-label="Planned spend">${esc(row.text || '')}</textarea>
    <div class="plan-row">
      <label class="plan-amt">
        <span aria-hidden="true">${esc(currency().symbol)}</span>
        <input type="text" inputmode="decimal" data-k="plan-amt-${esc(row.id)}" data-plan-amount="${esc(row.id)}"
          value="${row.amount ? esc(money2(row.amount)) : ''}" placeholder="0.00"
          aria-label="Amount" autocomplete="off">
      </label>
      <select class="plan-pick" data-change="plan-purpose" data-id="${esc(row.id)}" aria-label="Purpose">
        <option value=""${row.purpose ? '' : ' selected'}>No purpose yet</option>
        ${state.purposes.map((pp) => `<option value="${esc(pp.name)}"${pp.name === row.purpose ? ' selected' : ''}>${esc(pp.name)}</option>`).join('')}
      </select>
    </div>
    <div class="todo-foot">
      <select class="todo-status" data-change="plan-status" data-id="${esc(row.id)}" aria-label="Status">
        ${PLAN_STATUSES.map((o) => `<option value="${o.key}"${o.key === st.key ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <button class="todo-del${armed ? ' is-armed' : ''}" data-act="plan-del" data-id="${esc(row.id)}"
        aria-label="${armed ? 'Delete this line for good' : 'Delete line'}">${armed ? 'Delete?' : nodeIcon('trash', 15)}</button>
    </div>
    <button class="plan-log" data-act="plan-log" data-id="${esc(row.id)}" data-plan-log="${esc(row.id)}"
      ${owed && cents > 0 ? '' : 'hidden'}>Log it as spent today</button>
  </div>`;
}

/* Shared by the panel and the sheet, exactly as todoBody is, so the two
   surfaces cannot drift into being different features. */
function planBody() {
  const rows = planRows();
  return `
  <div class="todo-head">
    <span class="todo-name">Money Plan</span>
    <span class="todo-count" data-plan-count${planOpenCount() ? '' : ' hidden'}>${planOpenCount()} to pay</span>
    <button class="todo-x" data-act="plan-close" aria-label="Close the pad">✕</button>
  </div>
  ${planSum()}
  <button class="todo-new" data-act="plan-add">+ New line</button>
  <div class="todo-list" data-plan-list>
    ${rows.length
    ? rows.map(planLine).join('')
    : `<p class="todo-empty">Nothing planned yet. A line is what you owe, how much, and what it is for — the pad adds them up and tells you what that leaves.</p>`}
  </div>`;
}

// Same one-render entrance the to-do pad uses. See todoFresh.
let planFresh = true;

const planPad = () => (!state.planOpen || isPhone() ? '' : `
  <div class="todo-pad plan-pad${planFresh ? ' is-new' : ''}" role="dialog" aria-label="Money Plan">${planBody()}</div>`);

const planSheet = () => (!state.planOpen || !isPhone() ? '' : `
  <div class="todo-scrim${planFresh ? ' is-new' : ''}" data-backdrop="plan-close">
    <div class="todo-drawer" role="dialog" aria-label="Money Plan">
      <div class="todo-grab" aria-hidden="true"></div>
      ${planBody()}
    </div>
  </div>`);

let planScroll = 0;
function paintPlan() {
  const list = root.querySelector('[data-plan-list]');
  if (!list) { planScroll = 0; planFresh = true; return; }
  planFresh = false;
  /* Sized here as well as in paintTodo, rather than left to it: paintTodo
     returns the moment the to-do list is not on screen, and on the money
     tracker it never is — so a two-line plan was drawn one line tall. */
  list.querySelectorAll('[data-todo-grow]').forEach((el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
  });
  list.scrollTop = planScroll;
}

/* A line with nothing written on it and nothing owed is not a line. Same tidy
   the to-do pad does on close, so an accidental "+ New line" does not leave a
   blank row behind on every device. */
function planTidy() {
  const empty = state.plans.filter((r) => !String(r.text || '').trim() && !mCents(r.amount));
  if (!empty.length) return;
  state.plans = state.plans.filter((r) => String(r.text || '').trim() || mCents(r.amount));
  empty.forEach((r) => bury('plans', r.id));
  save(); queueSync(0);
}

function header(v) {
  return `
  <div class="appbar">
    ${wordmark(26, 20)}
    <div class="appbar-tabs" style="display: flex; border: 1px solid var(--color-divider); border-radius: 999px; overflow: hidden;">
      <button data-act="app-time" style="${tabStyle(!v.isMoney)}">Activity Tracker</button>
      ${workMode() ? '' : `<button data-act="app-money" style="${tabStyle(v.isMoney)}">Money Tracker</button>`}
    </div>
    <div class="appbar-meta">
      <span data-geo>${esc(v.geoLabel)}</span><span style="opacity:.4">/</span><span data-now>${esc(v.nowLabel)}</span>
      ${state.auth ? `<span style="opacity:.4">/</span>
        <button data-act="sync-now" title="Sync now" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;cursor:pointer;color:var(--color-neutral-600);"><span data-net>${esc(netLabel())}</span></button>` : ''}
    </div>
    <div class="appbar-actions" style="display:flex;align-items:center;gap:10px;">
      ${appbarMenu()}
    </div>
  </div>`;
}

/* ── the header menu ──

   The bar used to lay everything out in a row: the address, Sign out, the
   product's own dialog and the report. It fit, and then it stopped fitting —
   an email address is as long as somebody's name and domain make it, and the
   row grew with it until the buttons were the smallest thing on screen.

   So it is a menu. A hamburger is a poor choice where three things need to be
   one tap away and a fine one where they are all secondary to the page behind
   them, which these are: everything here opens something else.

   The address is the first line rather than a control — it answers "whose app
   is this" without being a button that does nothing when pressed. */
/* The initial in the disc, and the name beside it. A display name if there is
   one — it is what the person calls themselves — with the address underneath,
   which is what identifies the account. */
const menuInitial = () => {
  const from = String(state.displayName || (state.auth && state.auth.email) || '?').trim();
  return (from[0] || '?').toUpperCase();
};

/* One row of a menu: a glyph, a label, and sometimes a count. Shared by the
   drop-down and the phone's sheet, because they are the same menu in two
   shapes and had already drifted once. */
function menuRow(o) {
  const inner = `
    <span class="mn-ico" aria-hidden="true">${nodeIcon(o.icon, 19)}</span>
    <span class="mn-label">${esc(o.label)}</span>
    ${o.badge ? `<span class="mn-badge">${esc(String(o.badge))}</span>` : ''}`;
  const cls = `mn-row${o.extra ? ` ${o.extra}` : ''}`;
  return o.href
    ? `<a class="${cls}" href="${esc(o.href)}"${o.blank ? ' target="_blank" rel="noopener noreferrer"' : ''}${o.donate ? ' data-donate' : ''} role="menuitem">${inner}</a>`
    : `<button class="${cls}" data-act="${esc(o.act)}" role="menuitem">${inner}</button>`;
}

/* Who is signed in, drawn the same way in both menus. */
const menuWho = () => `
  <div class="am-who">
    <span class="am-face" aria-hidden="true">${esc(menuInitial())}</span>
    <span class="am-id">
      ${state.displayName ? `<span class="am-name">${esc(state.displayName)}</span>` : ''}
      <span class="am-mail">${esc((state.auth && state.auth.email) || '')}</span>
    </span>
  </div>`;

/* The way out of an account, in both menus: signing out as an outlined
   control, and below it — quieter, and never a button that looks the same —
   the one that cannot be undone. */
const menuExit = () => `
  <button class="mn-out" data-act="sign-out">Sign out</button>
  <button class="mn-kill" data-act="close-account">
    <span aria-hidden="true">${nodeIcon('trash', 15)}</span><span>Delete my account</span>
  </button>`;

function appbarMenu() {
  if (!state.auth) return '';
  const open = todoOpenCount();

  return `
  <div class="appbar-menu">
    <button class="am-toggle" data-act="menu-toggle" aria-haspopup="true" aria-expanded="${!!state.menuOpen}" aria-label="Menu">
      <span class="am-bars" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    ${state.menuOpen ? `
    <div class="am-drop" role="menu">
      ${menuWho()}
      <div class="mn-list">
        ${menuRow({ act: 'open-report', icon: 'insights', label: 'Your Report Cards' })}
        ${workMode()
          ? menuRow({ act: 'team-open', icon: 'people', label: 'Your Team' })
          : menuRow({ act: 'prefs-open', icon: 'sliders', label: 'Preferences' })}
        ${adminRole() ? menuRow({ href: '/admin', icon: 'shield', label: 'Admin dashboard' }) : ''}
        ${state.app === 'money'
          ? menuRow({ act: 'plan-open', icon: 'scales', label: 'Money Plan', badge: planOpenCount() || '' })
          : menuRow({ act: 'todo-open', icon: 'todo', label: 'To Do', badge: open || '' })}
        ${menuRow({ act: 'go-blogs', icon: 'article', label: 'Blog' })}
        ${menuRow({ act: 'legal-faq', icon: 'question', label: 'FAQs' })}
        ${menuRow({ act: 'help-open', icon: 'support', label: 'Help' })}
        ${workMode() ? '' : menuRow({ href: DONATE_URL, icon: 'heart', label: 'Donate', blank: true, donate: true })}
      </div>
      ${menuExit()}
    </div>` : ''}
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
  /* Grouped and collapsed rather than a flat run like the two legal documents.

     Those are read start to finish, once, by someone checking what they have
     agreed to. This is read by someone with one question, and twenty-five
     answers left open is a wall to scroll past rather than a page to search.
     <details> does the collapsing with no JavaScript and no state to keep, so
     nothing here has to survive a re-render.

     Every answer is what the app actually does. Where it names a limit or a
     rule, that rule is in the code — the overnight timer, the calorie source,
     who can see a team's hours. An FAQ that describes an app you wish you had
     written is worse than none. */
  faq: {
    title: 'Frequently Asked Questions',
    groups: [
      ['Getting started', [
        ['What is ZIMPAN?', 'A tracker for your time and your money, and for what the two do to you. You log what you did and what you spent; it reads the pattern back to you — where the hours went, what you ate, how you slept, and whether the shape of the week is one you would choose again.'],
        ['Do I need an account?', 'No. Everything works in your browser without one. An account is what carries your log between your phone and your laptop, and what keeps it if you lose the device.'],
        ['Is it really free?', 'The personal tracker is free, with no ads and no paid tier, and nothing you log is ever sold. Zimpan for Teams is the paid product. Donations are voluntary and buy no extra features.'],
        ['Does it work offline?', 'Yes. Your log lives in the browser first and syncs when there is a connection. You can log on a plane and it will be there when you land.'],
        ['What happens if I sign out?', 'The local copy on that device is cleared. Anything already synced is safe and comes back when you sign in again — so let a pending sync finish before you go.']
      ]],
      ['Tracking time', [
        ['How do I log time?', 'Two ways. Start the timer and stop it when you are done, or write the entry afterwards and set the times by dragging the bar or typing them.'],
        ['What if I forget to stop the timer?', 'Stop it whenever you notice and trim the times — an entry is just a start and an end, and both can be edited afterwards.'],
        ['What about something that runs past midnight?', 'It is counted against the morning it ended, so a sleep from 11PM to 7AM lands on the day you woke up rather than being split in two or lost between them.'],
        ['Can I edit or delete an entry?', 'Any of it — the activity, the category, the times, the note. Deleting is immediate and syncs to your other devices.'],
        ['What are categories?', 'Your own labels for kinds of activity. Rename them, recolour them, add your own; the readings follow whatever you call things rather than a fixed list.'],
        ['What does "unaccounted for" mean?', 'The minutes of a day with nothing logged against them. It is not a scolding — it is the part of the day the report genuinely cannot see, said out loud so you do not read a half-logged day as a quiet one.']
      ]],
      ['Money', [
        ['How do I log money?', 'The money tracker takes an amount, a purpose and a date. Whether a spend comes off your running balance is a question it asks once and then remembers.'],
        ['Why does food I paid for not count as calories?', 'Calories are read from the activity tracker only. Paying for a meal is not the same as eating it — you may have bought it for someone else, or eaten half. Log what you ate as an activity and it counts.'],
        ['What currency does it use?', 'New accounts start in US dollars and you can change it whenever you like. Changing it relabels the figures; it does not convert them.']
      ]],
      ['Calories, sleep and the readings', [
        ['Where do the calorie figures come from?', 'What you wrote. Food is read from the note on each meal against a table of typical servings; burn is priced from the activity, how long it ran, and your weight. Steps ride with the burn figure. All of it is an estimate, and an entry with nothing written down cannot be priced — that is what "not read" means.'],
        ['What is "Calibrate with AI"?', 'An optional second reading of a single day\'s meals by a language model, which is better than a lookup table at knowing what a named dish or a branded item actually contains. It runs only when you ask for it, and the local reading stays visible underneath so you can see the two disagree.'],
        ['How is sleep counted?', 'The longest sleep entry on a date is that night; anything shorter the same day is a nap and is counted separately, so three naps cannot add up to a good night.'],
        ['What are the four readings?', 'Body, mind, emotions and spirit — a rough sense of what your logged hours fed, with partial credit, because an hour of chores is not an hour of exercise. They describe your entries, not you.'],
        ['Is any of this medical advice?', 'No. Every reading is generated automatically from what you logged, using general rules, and no professional has reviewed it for you. Before acting on any of it — especially with a health condition, medication, or money that matters — ask someone qualified.']
      ]],
      ['Reports and windows', [
        ['What are Report Cards?', 'A run of cards summarising a window: where the time went, your top three, the busiest day against the quietest, and a closing card on what a stretch like that tends to do. Swipe or click through them; they print.'],
        ['What do the windows mean?', 'Day and Week are the last 1 and 7 days ending on the day you are looking at. This Month is this calendar month so far, Last Month is the whole of the previous one, and 3, 6 and 12 Months are the last 91, 182 and 365 days. All Time reaches back to the first thing you ever logged.'],
        ['Can I get my data out?', 'Yes — the report tools export it, and you should keep your own copy of anything you would be upset to lose.']
      ]],
      ['Ask Zimpan', [
        ['What is Ask Zimpan?', 'A chat that can see your log and answer questions about it — what you spent on what, how last week compared, how the app works.'],
        ['Can it get things wrong?', 'Yes. It is an AI assistant and it can be mistaken, so check anything that matters against the figures themselves. If a question is outside what it can see, it will say so rather than guess.']
      ]],
      ['Zimpan for Teams', [
        ['What is Zimpan for Teams?', 'A separate product for measuring a team\'s productivity: hours logged against projects, a roster you invite by email, and a reading of where the week went. It tracks work only — no money, no food, no sleep, nothing personal.'],
        ['Can I use my personal account for it?', 'No. A team account is its own login with its own email, decided at sign-up and never moved between the two. That separation is what keeps your personal log out of your employer\'s sight.'],
        ['Who can see my hours?', 'Your team\'s admins and its owner, and only the hours you logged against the team\'s projects. They can also see when you have a timer running and what it is on. Notes you write on an entry are never shown to them, and a timer running on anything that is not one of the team\'s projects shows only as "working" — never by name.'],
        ['Who can edit them?', 'Admins and the owner can correct a member\'s hours; members log their own. Only the owner manages billing.'],
        ['What does it cost?', 'From $9 a month for six people up to $100 for unlimited, and every team starts on a 14-day trial for three people with no card needed.']
      ]],
      ['Your data', [
        ['Where does my data live?', 'In your own browser, and — if you have an account — in a database on our hosting. Nothing is sold, and nothing you log is shared with anyone.'],
        ['How do I delete my account?', 'Email us and we will delete the account and everything in it. Deletion is irreversible, so export anything you want to keep first.']
      ]]
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

/* ── asking for help ──

   Reachable from the footer, which is on every page including the ones you
   reach without an account — somebody who cannot sign in is the likeliest
   person to need this.

   The address is asked for only when there is no session to take it from. A
   signed-in person's own address is what we reply to, and offering to change
   it would be offering to send somebody else's answer somewhere else. */
/* ── closing your own account ──

   Typed rather than clicked. Every other destructive thing in this app is one
   button; this is the one that cannot be undone at all, and a dialog that only
   needs a click is a dialog that gets clicked.

   What it says is what actually happens, which is worth being exact about
   because the answer changed: signing up again with the same address makes a
   NEW account, and the browser now knows the difference and clears what it was
   holding. There is no version of this where the data comes back. */
function closeAccountDialog() {
  const c = state.closing;
  if (!c) return '';
  const email = (state.auth && state.auth.email) || '';

  if (c.done) {
    return lightbox({
      icon: 'check',
      tone: 'var(--color-neutral-600)',
      kicker: 'Closed',
      title: 'Your account is gone',
      body: '<p>Everything logged under it has been deleted, here and on the server. Thanks for trying it.</p>',
      actions: '<button class="btn btn-primary" data-act="closed-done">Back to the start</button>'
    });
  }

  return lightbox({
    icon: 'trash',
    tone: '#8a2f4a',
    kicker: 'This cannot be undone',
    title: 'Delete your account?',
    closeAct: 'close-account-cancel',
    body: `
      <div class="help-form">
        <p style="margin:0;">Everything goes: every entry, every amount, your categories, your settings${
          workMode() ? ', and your hours on this team' : ''}. It is deleted from the server, not hidden — nobody can restore it and neither can we.</p>
        <p style="margin:0;color:var(--color-neutral-700);font-size:13px;">Signing up again with this address later makes a <strong>new</strong> account, empty. What is here now does not come back with it.</p>
        ${workMode() ? `
        <p style="margin:0;color:var(--color-neutral-700);font-size:13px;">Your team's admins will no longer see the hours you logged against its projects.</p>` : ''}
        <label class="help-field">
          <span>Type ${esc(email)} to confirm</span>
          <input class="input" type="text" data-k="close-typed" data-sync="closing.typed"
            value="${esc(c.typed || '')}" placeholder="${esc(email)}" autocomplete="off" spellcheck="false">
        </label>
        ${c.error ? `<p class="tm-err" style="margin:0;">${esc(c.error)}</p>` : ''}
      </div>`,
    actions: `
      <button class="btn btn-secondary" data-act="close-account-cancel">Cancel</button>
      <button class="btn btn-danger" data-act="close-account-go"${c.busy ? ' disabled' : ''}>${
        c.busy ? 'Deleting…' : 'Delete everything'}</button>`
  });
}

function helpDialog() {
  const h = state.help;
  if (!h) return '';

  if (h.ref) {
    return lightbox({
      icon: 'check',
      tone: '#0e9f6e',
      kicker: 'Sent',
      title: `Your reference is ${h.ref}`,
      closeAct: 'help-close',
      body: `
        <p>${h.delivered
          ? `A copy is on its way to ${esc(h.email)}. Reply to it if you have anything to add.`
          : 'We have your message and it is waiting to be read. The emailed copy did not go out, so keep the reference above — it is how we will find this.'}</p>`,
      actions: '<button class="btn btn-primary" data-act="help-close">Done</button>'
    });
  }

  return lightbox({
    icon: 'pencil',
    tone: 'var(--color-accent)',
    kicker: 'Help',
    title: 'What can we help with?',
    sub: 'We answer by email',
    closeAct: 'help-close',
    body: `
      <div class="help-form">
        ${state.auth ? `
        <p class="help-who">Replying to <strong>${esc(state.auth.email)}</strong></p>` : `
        <label class="help-field">
          <span>Your email</span>
          <input class="input" type="email" data-k="help-email" data-sync="help.email"
            value="${esc(h.email || '')}" placeholder="Where should we reply?" autocomplete="email">
        </label>`}

        <label class="help-field">
          <span>Subject</span>
          <input class="input" type="text" data-k="help-subject" data-sync="help.subject"
            value="${esc(h.subject || '')}" placeholder="In a few words" maxlength="200" autocomplete="off">
        </label>

        <label class="help-field">
          <span>Message</span>
          <textarea class="input help-body" data-k="help-body" data-sync="help.body" rows="6"
            maxlength="8000" placeholder="What happened, and what you expected instead.">${esc(h.body || '')}</textarea>
        </label>

        ${h.error ? `<p class="tm-err">${esc(h.error)}</p>` : ''}
      </div>`,
    actions: `
      <button class="btn btn-secondary" data-act="help-close">Cancel</button>
      <button class="btn btn-primary" data-act="help-send"${h.busy ? ' disabled' : ''}>${h.busy ? 'Sending…' : 'Send'}</button>`
  });
}

function legalSheet() {
  const doc = LEGAL[state.legalOpen];
  if (!doc) return '';
  return `
    <div class="report-wrap" data-legal-backdrop style="position: fixed; inset: 0; background: color-mix(in srgb, var(--color-neutral-900) 55%, transparent); display: flex; align-items: flex-start; justify-content: center; overflow: auto; z-index: 55;">
      <div style="width: 680px; max-width: 100%;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
          <span style="color: var(--color-bg); font-size: 13px; margin-right: auto;">${doc.groups ? '' : `Last updated ${esc(LEGAL_UPDATED)}`}</span>
          <button class="btn btn-secondary" data-act="legal-close" style="background: var(--color-bg);">Close</button>
        </div>
        <div class="report-sheet" style="background: var(--color-bg); box-shadow: var(--shadow-lg);">
          <h4 style="margin: 0 0 6px; font-size: 22px;">${esc(doc.title)}</h4>
          <div style="font-size: 12.5px; color: var(--color-neutral-600); margin-bottom: 22px;">ZIMPAN · zimpan.com</div>
          ${doc.body ? doc.body.map(([heading, text]) => `
            <div style="margin-bottom: 18px;">
              <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 5px;">${esc(heading)}</div>
              <div style="font-size: 13.5px; line-height: 1.65; color: var(--color-neutral-800);">${esc(text)}</div>
            </div>`).join('') : ''}
          ${doc.groups ? doc.groups.map(([section, items]) => `
            <div style="margin-bottom: 22px;">
              <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 8px;">${esc(section)}</div>
              ${items.map(([q, a]) => `
              <details class="faq-item">
                <summary>${esc(q)}</summary>
                <div class="faq-answer">${esc(a)}</div>
              </details>`).join('')}
            </div>`).join('') : ''}
          <div style="margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--color-divider); font-size: 12px; color: var(--color-neutral-600);">
            ${doc.groups
              ? 'Something not answered here? Get in touch and we will answer it — and add it to this list.'
              : 'Questions about either document? Get in touch and we will answer.'}
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
    <button data-act="legal-faq" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:${color};cursor:pointer;text-decoration:underline;text-underline-offset:2px;">FAQs</button>
    <button data-act="help-open" style="border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:${color};cursor:pointer;text-decoration:underline;text-underline-offset:2px;">Help</button>
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
  sleep: icon('<path d="M20 14.6A8.3 8.3 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6Z"/><path d="M16.6 3.4v3.2M15 5h3.2"/>'),
  // The two the team page needs and the personal one never had.
  clipboard: icon('<rect x="5.2" y="4.6" width="13.6" height="15.4" rx="2.4"/><path d="M9.2 4.6V3.4h5.6v1.2"/><path d="M8.6 10.4h6.8M8.6 14h4.6"/>'),
  shield: icon('<path d="M12 3.4 19 6v5.6c0 4-2.9 7.4-7 9-4.1-1.6-7-5-7-9V6Z"/><path d="m8.8 11.8 2.3 2.3 4.1-4.6"/>')
};

const CHECK_ICON = icon('<circle cx="12" cy="12" r="9"/><path d="m8.4 12.4 2.5 2.5 4.7-5.3"/>');

const LANDING_CHECKS = ['Financial Overview', 'Time & Project Tracking', 'Activity & Focus', 'Sleep & Well-being'];

/* ─────────────────────────── icons ───────────────────────────

   The app was using geometric characters for its own furniture — ◱ for Home,
   ◲ for Insights, ◷ for time — which is the same square typed three ways and
   reads as something nobody got round to drawing.

   These are drawn instead, in one language: a trace, and a filled node where
   the trace turns or ends. It is the shape the brand already uses for the way
   one thing leads to another, and at 20px a node is still legible where a
   detailed glyph is mud.

   Stroke is currentColor, so an icon takes the colour of whatever it sits in
   — a tab that goes violet when active needs no second copy.

   Separate from icon() above only because these are used by the phone, which
   is styled inline and has no class to hang a size on: nodeIcon takes the
   size as an argument where icon() takes it from CSS. */
const ICON_PATHS = {
  home: '<path d="M3.7 11.5 12 4.6l8.3 6.9"/><path d="M6.4 10.4v9h11.2v-9"/>'
    + '<circle cx="12" cy="4.6" r="1.7" fill="currentColor" stroke="none"/>',
  insights: '<path d="M4.2 19.4h15.6"/><path d="M5.9 15.7 10 10.8l3.7 3.3 5.1-6.5"/>'
    + '<circle cx="10" cy="10.8" r="1.5" fill="currentColor" stroke="none"/>'
    + '<circle cx="13.7" cy="14.1" r="1.5" fill="currentColor" stroke="none"/>'
    + '<circle cx="18.8" cy="7.6" r="1.6" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.3V12l3.3 2.3"/>'
    + '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  play: '<path d="M9.4 7.1 17 12l-7.6 4.9Z" stroke-linejoin="round"/>'
    + '<circle cx="17" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.1"/><path d="M15.1 15.1 19.3 19.3"/>'
    + '<circle cx="19.5" cy="19.5" r="1.4" fill="currentColor" stroke="none"/>',
  up: '<path d="M12 19.3V6.7"/><path d="M6.6 12.1 12 6.5l5.4 5.6"/>'
    + '<circle cx="12" cy="19.3" r="1.5" fill="currentColor" stroke="none"/>',
  check: '<circle cx="12" cy="12" r="9.1"/><path d="M7.7 12.3 10.6 15.3 16.3 8.9"/>',
  pencil: '<path d="M4.6 19.4h3.1l9-9a2.2 2.2 0 0 0-3.1-3.1l-9 9Z" stroke-linejoin="round"/><path d="M13.2 8.2 15.8 10.8"/>',
  funnel: '<path d="M4.4 5.4h15.2l-5.9 6.9v5.6l-3.4 1.9v-7.5Z" stroke-linejoin="round"/>',
  calendar: '<rect x="4" y="5.6" width="16" height="14" rx="2.6"/><path d="M4 10h16M8.6 3.6v3.4M15.4 3.6v3.4"/>'
    + '<circle cx="12" cy="14.6" r="1.4" fill="currentColor" stroke="none"/>',
  heart: '<path d="M12 19.6 5.4 13a4.3 4.3 0 0 1 6.6-5.4A4.3 4.3 0 0 1 18.6 13Z" stroke-linejoin="round"/>'
    + '<circle cx="12" cy="7.6" r="1.4" fill="currentColor" stroke="none"/>',
  /* The four calorie readings. Same shapes the desktop's CAL_ICONS use, so a
     flame means the same thing on both. */
  flame: '<path d="M12 3.8c3.1 2.9 4.7 5.3 4.7 7.5a4.7 4.7 0 0 1-9.4 0c0-1 .4-2 1.2-2.9.3 1 .9 1.7 1.7 1.9.2-2.3.8-4.2 1.8-6.5Z" stroke-linejoin="round"/>',
  plate: '<path d="M8 3.8v7.3M8 11.1v9.1M5.7 3.8v3.9a2.3 2.3 0 0 0 4.6 0V3.8"/>'
    + '<path d="M16.7 3.8c-1.5 1.2-2 3-1.6 5.3.2 1.2.9 1.9 1.8 2v9.1"/>',
  pulse: '<path d="M2.7 12h4.1l2.3-5.3 3.6 10.6 2.4-5.3h6.2"/>'
    + '<circle cx="12" cy="17.3" r="1.3" fill="currentColor" stroke="none"/>',
  /* Chat's two controls. Drawn like the rest of the set rather than set as
     emoji: an emoji is a different typeface at a different weight in a row of
     line icons, and it renders differently on every platform. */
  mic: '<rect x="9.2" y="3.2" width="5.6" height="11.2" rx="2.8"/>'
    + '<path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0"/><path d="M12 18v2.8M8.8 20.8h6.4"/>',
  stop: '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.4"/>',
  sound: '<path d="M4.4 9.4h3.4L12.6 5.4v13.2L7.8 14.6H4.4Z" stroke-linejoin="round"/>'
    + '<path d="M15.8 9.4a3.7 3.7 0 0 1 0 5.2"/><path d="M18.4 6.8a7.4 7.4 0 0 1 0 10.4"/>',
  mute: '<path d="M4.4 9.4h3.4L12.6 5.4v13.2L7.8 14.6H4.4Z" stroke-linejoin="round"/>'
    + '<path d="M16.2 10.2 20.6 14.6M20.6 10.2 16.2 14.6"/>',
  history: '<path d="M4.4 12a7.6 7.6 0 1 0 2.3-5.4"/><path d="M3.6 4.4v4.2h4.2"/>'
    + '<path d="M12 8.1V12l2.9 1.7"/>',
  shield: '<path d="M12 3.2 19.4 6v6c0 4.4-3 7.3-7.4 8.8C7.6 19.3 4.6 16.4 4.6 12V6Z" stroke-linejoin="round"/>'
    + '<path d="M9.2 12.2 11.3 14.3 15 10.4"/>',
  /* Two rails set to different points: the shape of a default you can move. */
  sliders: '<path d="M4.4 8.6h8.4M17.2 8.6h2.4"/><path d="M4.4 15.4h2.4M10.8 15.4h8.8"/>'
    + '<circle cx="15.1" cy="8.6" r="2" fill="currentColor" stroke="none"/>'
    + '<circle cx="8.9" cy="15.4" r="2" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.6 6.8h14.8"/><path d="M9.4 6.8V5.2a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v1.6"/>'
    + '<path d="M6.6 6.8 7.5 19a1.8 1.8 0 0 0 1.8 1.6h5.4a1.8 1.8 0 0 0 1.8-1.6l.9-12.2" stroke-linejoin="round"/>'
    + '<path d="M10.4 10.4v6.2M13.6 10.4v6.2"/>',
  /* Whose account this is. A head over shoulders, drawn at the same weight as
     the rest so it reads as one of the set rather than an avatar. */
  person: '<circle cx="12" cy="8.3" r="3.5"/>'
    + '<path d="M5.6 19.9a6.4 6.4 0 0 1 12.8 0"/>',
  /* The menus. Each one is the thing itself rather than a symbol for it: a
     clipboard with a tick for the pad, a page of lines for the blog, a pane
     with a sidebar for the full layout, two figures for a team. Same 1.7
     stroke and currentColor as the rest, so a row of them reads as one set. */
  todo: '<rect x="5.4" y="4.6" width="13.2" height="15.8" rx="2.6"/>'
    + '<path d="M9 4.6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.6v1.1H9Z" stroke-linejoin="round"/>'
    + '<path d="m9.2 13.1 2 2 3.6-4.2"/>',
  article: '<rect x="3.6" y="4.8" width="16.8" height="14.4" rx="2.6"/>'
    + '<path d="M6.8 9h6.4M6.8 12.4h6.4M6.8 15.6h4"/>'
    + '<path d="M16.2 9h1.2v3.4h-1.2z" fill="currentColor" stroke="none" opacity=".35"/>',
  layout: '<rect x="3.4" y="4.8" width="17.2" height="14.4" rx="2.6"/>'
    + '<path d="M3.4 9h17.2M9.2 9v10.2"/>',
  people: '<circle cx="9.4" cy="8.6" r="3.1"/>'
    + '<path d="M3.8 19.4a5.7 5.7 0 0 1 11.2 0"/>'
    + '<path d="M15.6 6.1a3 3 0 0 1 0 5.6"/><path d="M17.2 14.4a5 5 0 0 1 3 4.6"/>',
  question: '<circle cx="12" cy="12" r="9.1"/>'
    + '<path d="M9.6 9.5a2.5 2.5 0 1 1 3.2 2.6c-.6.2-.9.7-.9 1.4v.4"/>'
    + '<circle cx="11.9" cy="16.6" r="1.2" fill="currentColor" stroke="none"/>',
  support: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4"/>'
    + '<path d="m6 6 3.6 3.6M18 6l-3.6 3.6M6 18l3.6-3.6M18 18l-3.6-3.6"/>',
  exit: '<path d="M14.2 4.8H6.6a1.8 1.8 0 0 0-1.8 1.8v10.8a1.8 1.8 0 0 0 1.8 1.8h7.6"/>'
    + '<path d="M15.6 8.4 19.2 12l-3.6 3.6M19.2 12H9.4"/>',
  scales: '<path d="M12 4.5v15.3M7.7 19.8h8.6M4.3 8.6h15.4"/>'
    + '<path d="M4.3 8.6 2.2 13.3a2.3 2.3 0 0 0 4.2 0Z" stroke-linejoin="round"/>'
    + '<path d="M19.7 8.6l-2.1 4.7a2.3 2.3 0 0 0 4.2 0Z" stroke-linejoin="round"/>'
};

const nodeIcon = (name, size, style) => `<svg viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}"
  fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"
  style="display:block;flex:none;${style || ''}">${ICON_PATHS[name] || ''}</svg>`;

/* Wording tightened where the original overstated the product: the insights
   are rule-based rather than AI, currency switching relabels rather than
   converting, and the timeline is a single row rather than a gantt chart. */
const LANDING_FEATURES = [
  ['time', 'Time', 'Optimize Your Time', 'Log by hand or use instant timers. See your whole day on a timeline, with efficiency reports.'],
  ['money', 'Money', 'Track Every Penny', 'Log income and expenses, switch between four currencies, and watch your spending trends.'],
  ['insights', 'Insights', 'Gain Deep Insights', 'Analyze movement, rest, focus and diet patterns with automatic reports.'],
  ['sleep', 'Sleep', 'Improve Your Sleep', 'Log sleep duration and quality to build better rest habits.']
];

/* ── the team page ──

   The same skeleton as the landing above, with corporate copy in place of the
   personal one. A second page rather than a section of the first, because the
   two are pitched at different readers: one is talking to a person about their
   own day, the other to whoever signs off on a team's hours.

   Money is deliberately absent from every list here. The personal app tracks
   what you spend; a manager reading their team's hours has no business being
   handed anyone's grocery bill, so the team story is hours and projects only. */

/* Replace with the photograph when it lands: put the file in ds/ — everything
   there is copied on deploy — and name it here. Nothing else has to change. */
const TEAM_HERO = '/ds/team-hero.svg';

// Matches TRIAL_DAYS in server/teams.js, where it is actually enforced.
const TEAM_TRIAL_DAYS = 14;

const TEAM_CHECKS = ['Project Time Tracking', 'Per-Member Reports', 'Team Productivity Overview', 'Roles and Access Control'];

const TEAM_FEATURES = [
  ['time', 'Projects', 'Time Against Real Projects',
    'Members log to the projects you define, by timer or by hand, so an hour always belongs somewhere.'],
  ['insights', 'People', 'See Where the Week Went',
    'Every member gets their own reading, and every project shows the hours it actually took.'],
  ['clipboard', 'Reports', 'Report Cards, Per Person',
    'The same weekly cards the app already writes, scoped to a member or to the whole team.'],
  ['shield', 'Control', 'Roles That Mean Something',
    'A super admin owns the team, admins manage people and projects, members log their own time.']
];

/* Priced per team rather than per seat: a team of six paying for six is the
   sort of arithmetic that punishes hiring. The cap is the promise. */
/* [key, label, nickname, seats, price, PayPal hosted button id].

   The button ids are not secrets — they are in the markup of every PayPal
   button on the web, and a hosted button can only ever charge what it was set
   up to charge. Kept here beside the price they belong to so the two cannot
   drift; the server holds the same table, and a test compares them. */
const TEAM_PLANS = [
  ['team6', 'Team of 6', 'Starter', 6, 9, 'L2TA54N2MGAEC'],
  ['team12', 'Team of 12', 'Squad', 12, 15, 'LWSN5Y8ETFSSJ'],
  ['team20', 'Team of 20', 'Business', 20, 22, 'NYRHVDWH6SXN8'],
  ['team50', 'Team of 50', 'Max', 50, 30, 'AZBJMFGCVEK98'],
  ['unlimited', 'Unlimited', 'Unlimited', 0, 100, 'C7ZHCA5ZMUG8G']
];

/* PayPal's own hosted-button form, with their gif swapped for our button.

   A hosted button is encrypted at PayPal's end, so it has to be POSTed as a
   form — there is no link version that carries the same thing, and extra
   variables are ignored, which is why the payment cannot carry a team id and
   why the plan is matched to a team by hand afterwards.

   target="_blank" where PayPal's snippet says "_top": this app is one document
   holding unsaved state, and navigating the whole tab away to PayPal loses
   whatever the person was in the middle of. */
const TEAM_POPULAR = 'team20';

const paypalForm = (buttonId, label, extraClass) => `
  <form action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_blank" rel="noopener noreferrer" style="margin:0;">
    <input type="hidden" name="cmd" value="_s-xclick">
    <input type="hidden" name="hosted_button_id" value="${esc(buttonId)}">
    <input type="hidden" name="currency_code" value="USD">
    <button type="submit" class="btn btn-primary ${esc(extraClass || '')}">${esc(label)}</button>
  </form>`;

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

/* ── the blog ──

   Two pages behind one route: the index at /blogs and one post at
   /blogs/<slug>. They share the landing page's bar and footer, because a
   reader who arrives from a search result should be able to see what the site
   is and get into it — a blog post on an island sells nothing.

   The body is the one string in this whole file written with innerHTML rather
   than escaped. That is deliberate and it is why server/blog.js sanitises on
   the way in: the formatting is the point of a post, and there is no way to
   have it and escape it too. Everything else here — title, byline, excerpt —
   goes through esc() like the rest of the app. */
const blogDate = (ms) => (ms
  ? new Date(Number(ms)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  : '');

function blogBar() {
  return `
    <header class="landing-bar">
      <a class="landing-brand" href="/" data-act="go-home">
        ${LOGO_BADGE(34)}
        <span class="landing-name">ZIMPAN<span style="color:var(--color-accent);">.</span></span>
      </a>
      <nav class="landing-nav">
        <button data-act="go-home">Home</button>
        <button data-act="go-blogs">Blog</button>
        <button class="nav-gold" data-act="go-teams">For Teams</button>
      </nav>
      <div class="landing-actions">
        <button class="landing-login" data-act="auth-open">Log In</button>
        <div class="landing-cta-top">
          <button data-act="auth-open" class="btn btn-primary" style="font-size:14px;font-weight:600;padding:10px 24px;border-radius:999px;cursor:pointer;">Start Tracking Now</button>
        </div>
      </div>
    </header>`;
}

const blogFoot = () => `
    <footer style="padding:22px 28px 34px;display:flex;flex-direction:column;align-items:center;gap:12px;">
      ${legalLinks('var(--color-neutral-600)')}
    </footer>`;

function blogIndex() {
  const data = state.blogList;
  const body = state.blogBusy && data === null
    ? '<p class="blog-note">Loading…</p>'
    : state.blogError
      ? `<p class="blog-note">${esc(state.blogError)}</p>`
      : !data || !data.posts || !data.posts.length
        ? '<p class="blog-note">Nothing published yet. Come back soon.</p>'
        : `<div class="blog-grid">${data.posts.map((post) => `
          <article class="blog-card">
            <a class="blog-card-link" href="${esc(pathForRoute('blogs', post.slug))}"
               data-act="go-post" data-slug="${esc(post.slug)}">
              ${post.cover ? `<span class="blog-card-cover" style="background-image:url('${esc(post.cover)}');"></span>` : ''}
              <span class="blog-card-body">
                <span class="blog-card-when">${esc(blogDate(post.publishedAt))}</span>
                <span class="blog-card-title">${esc(post.title)}</span>
                ${post.excerpt ? `<span class="blog-card-ex">${esc(post.excerpt)}</span>` : ''}
              </span>
            </a>
          </article>`).join('')}</div>`;

  return `
  <div class="landing">
    ${blogBar()}
    <section class="blog-head">
      <span class="strip-kicker">The ZIMPAN blog</span>
      <h1 class="blog-h1">Read articles about time, money, tasks, and self management</h1>
      <p class="blog-sub">Plain writing on productivity, financial freedom, and running your
        time and money like they belong to you — because the day you can account for
        is the day you can change.</p>
    </section>
    <section class="blog-wrap">${body}</section>
    ${blogFoot()}
  </div>`;
}

function blogPostPage() {
  const post = state.blogPost;
  const body = state.blogBusy && post === null
    ? '<p class="blog-note">Loading…</p>'
    : post === false
      ? `<p class="blog-note">${esc(state.blogError || 'No post lives at that address.')}
         <button class="blog-back" data-act="go-blogs">See everything published</button></p>`
      : !post
        ? '<p class="blog-note">Loading…</p>'
        : `
      <article class="blog-post">
        <span class="blog-card-when">${esc(blogDate(post.publishedAt))}${post.author ? ` · ${esc(post.author)}` : ''}</span>
        <h1 class="blog-h1">${esc(post.title)}</h1>
        ${post.excerpt ? `<p class="blog-sub">${esc(post.excerpt)}</p>` : ''}
        ${post.cover ? `<img class="blog-cover" src="${esc(post.cover)}" alt="">` : ''}
        <!-- Sanitised on the way into the database by server/blog.js. This is
             the only unescaped string in this file, and that is where it is
             made safe. -->
        <div class="blog-body">${post.body}</div>
        <button class="blog-back" data-act="go-blogs">← All posts</button>
      </article>`;

  return `
  <div class="landing">
    ${blogBar()}
    <section class="blog-wrap blog-wrap-post">${body}</section>
    ${blogFoot()}
  </div>`;
}

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
        <button data-act="go-blogs">Blog</button>
        <button data-act="legal-privacy">Privacy</button>
        <button data-act="legal-terms">Terms</button>
        <button class="nav-gold" data-act="go-teams">For Teams</button>
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
          <!-- Its own row beneath the pair, running the full width of both.
               Gold rather than violet because it is not a third way to do the
               same thing — it is the door to the other product, and the brand
               already uses gold for the thing that is not the app itself. -->
          <button class="btn hero-cta3" data-act="go-teams">${nodeIcon('shield', 16)}<span>Tracker for Teams</span></button>
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

function teamsScreen() {
  /* The button starts the account rather than the payment. A subscription that
     arrives before there is a team to attach it to is a receipt nobody can
     match: PayPal reports an email and an amount, and a hosted button cannot
     be made to carry anything else. Make the team first and the payer's email
     is the account's email, which is what makes the two findable. */
  const plan = ([key, label, nickname, seats, price]) => {
    const hot = key === TEAM_POPULAR;
    return `
    <div class="plan${hot ? ' is-popular' : ''}">
      ${hot ? `<span class="plan-flag">${nodeIcon('flame', 12)}Most popular</span>` : ''}
      ${nickname === label ? '<div class="plan-kicker">&nbsp;</div>' : `<div class="plan-kicker">${esc(nickname)}</div>`}
      <div class="plan-name">${esc(label)}</div>
      <div class="plan-seats">${seats ? `Up to ${seats} people` : 'As many people as you like'}</div>
      <div class="plan-price"><span class="plan-amount">$${price}</span><span class="plan-per">/month</span></div>
      <button class="btn ${hot ? 'btn-primary' : 'btn-secondary'} plan-go" data-act="auth-open-work">Start this plan</button>
    </div>`;
  };

  return `
  <div class="landing">
    <header class="landing-bar">
      <a class="landing-brand" href="/" data-act="go-home">
        ${LOGO_BADGE(34)}
        <span class="landing-name">ZIMPAN<span style="color:var(--color-accent);">.</span></span>
      </a>
      <nav class="landing-nav">
        <button data-act="scroll-features">How it works</button>
        <button data-act="scroll-pricing">Pricing</button>
        <button data-act="go-home">For individuals</button>
        <button data-act="legal-privacy">Privacy</button>
      </nav>
      <div class="landing-actions">
        <button class="landing-login" data-act="auth-open-work">Log In</button>
        <div class="landing-cta-top">
          <button data-act="auth-open-work" class="btn btn-primary" style="font-size:14px;font-weight:600;padding:10px 24px;border-radius:999px;cursor:pointer;">Create Teams Account</button>
        </div>
      </div>
    </header>

    <section class="hero">
      <div class="hero-copy">
        <span class="hero-eyebrow">For teams · From $9 a month</span>
        <h1 class="hero-h1">Measure Your Team&rsquo;s Productivity</h1>
        <p class="hero-lede">
          Zimpan for Teams turns the hours your people actually work into something
          you can read: which project took them, who they belonged to, and where the
          week really went.
        </p>

        <ul class="hero-checks">
          ${TEAM_CHECKS.map((t) => `
            <li><span class="hero-check">${CHECK_ICON}</span>${esc(t)}</li>`).join('')}
        </ul>

        <div class="hero-ctas">
          <button data-act="scroll-pricing" class="btn btn-primary" style="font-size:16px;font-weight:600;padding:13px 30px;border-radius:999px;cursor:pointer;">See pricing</button>
          <button class="btn btn-secondary hero-cta2" data-act="auth-open-work">Create Teams Account</button>
        </div>
      </div>

      <div class="hero-art">
        <figure class="team-shot">
          <img src="${esc(TEAM_HERO)}" alt="A team at work together" width="900" height="620">
        </figure>
      </div>
    </section>

    <section class="strip" data-anchor="features">
      <div class="strip-head">
        <span class="strip-kicker">What a team gets</span>
        <span class="strip-rule"></span>
        <span class="strip-note">Hours and projects, nothing personal</span>
      </div>
      <div class="landing-points">
        ${TEAM_FEATURES.map(([key, eyebrow, title, body]) => `
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

    <section class="strip" data-anchor="roles">
      <div class="strip-head">
        <span class="strip-kicker">Who can do what</span>
        <span class="strip-rule"></span>
        <span class="strip-note">Three roles</span>
      </div>
      <div class="role-grid">
        <div class="role-card">
          <div class="role-name">Super admin</div>
          <p>Owns the team and the billing. Grants and removes admin access, and sees the dashboard across every project and every person.</p>
        </div>
        <div class="role-card">
          <div class="role-name">Admin</div>
          <p>Invites members by email and manages their access. Can edit a member&rsquo;s time, activity and the project it was logged against.</p>
        </div>
        <div class="role-card">
          <div class="role-name">Member</div>
          <p>Logs their own time against the team&rsquo;s projects, and reads their own report cards. Their personal tracking stays their own.</p>
        </div>
      </div>
    </section>

    <section class="strip" data-anchor="pricing">
      <div class="strip-head">
        <span class="strip-kicker">Pricing</span>
        <span class="strip-rule"></span>
        <span class="strip-note">One price per team, not per seat</span>
      </div>
      <div class="plans">${TEAM_PLANS.map(plan).join('')}</div>
      <p class="plans-foot">Start free for ${TEAM_TRIAL_DAYS} days with up to 3 people, then subscribe from inside your team. Billed monthly in USD. The personal Zimpan stays free for everyone.</p>
    </section>

    <footer style="padding:22px 28px 34px;display:flex;flex-direction:column;align-items:center;gap:12px;">
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

      ${state.authFor === 'work' ? `
      <div style="margin:18px 0 0;padding:11px 13px;border-radius:12px;background:color-mix(in srgb, var(--color-accent) 9%, transparent);font-size:12.5px;line-height:1.5;color:var(--color-accent-900);text-align:left;">
        <strong>Zimpan for Teams</strong> — this makes a work account, kept separate from a personal Zimpan. If you already track your own day here, use a different email.
      </div>` : ''}

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

/* Whether the entry behind the open prompt already carries a note. Only then
   is there anything to remove, and only then is the button worth drawing —
   offering "Remove note" on a blank one is offering to do nothing. */
const noteOnRow = (p) => !!(p && ((findRow(p.kind, p.id) || {}).note || '').trim());

function notePromptDialog() {
  const p = state.notePrompt;
  if (!p) return '';
  return lightbox({
    icon: 'pencil',
    tone: 'var(--color-accent)',
    kicker: p.activity ? `Logged against “${p.activity}”` : 'Optional',
    title: p.title,
    body: `
      <p style="margin:0 0 10px;font-size:12.5px;color:var(--color-neutral-600);">${esc(p.hint)}</p>
      <textarea class="input" data-k="note-draft" data-sync="noteDraft" rows="4" maxlength="500"
        placeholder="${esc(p.placeholder)}"
        style="width:100%;resize:vertical;min-height:92px;font:inherit;font-size:14px;line-height:1.5;padding:10px 12px;">${esc(state.noteDraft)}</textarea>`,
    actions: `
      ${noteOnRow(p) ? `<button class="btn btn-ghost" data-act="note-remove" style="color:#8a2f4a;">Remove note</button>` : ''}
      <button class="btn btn-ghost" data-act="note-skip">Skip</button>
      <button class="btn btn-primary" data-act="note-save">Save note</button>`
  });
}

/* ── a meal with nothing written in it ──

   Calories eaten are read out of the words on the entry. "Lunch" on its own
   says when you ate and nothing about what, so there is nothing to read, and
   the meal is charged UNKNOWN_MEAL instead — a flat placeholder that keeps the
   day from being understated and says nothing about the actual plate. That
   happened silently: the question was skipped, the entry was saved, and a
   number nobody chose went onto the card and into the dial looking exactly
   like a reading.

   So the skip is answered rather than obeyed, and it is answered honestly —
   the figure is named as the guess it is rather than described as nothing.
   Add Note goes straight back to the box; Skip Counting accepts the
   placeholder on purpose and stops the whole line of questioning for the
   session, because having said it once, being asked again at dinner is
   nagging. */
function mealNoteDialog() {
  const a = state.mealAsk;
  if (!a) return '';
  return lightbox({
    icon: 'plate',
    tone: 'var(--zg-donate)',
    kicker: a.activity ? `Logged against “${a.activity}”` : 'Meal logged',
    title: 'Nothing to count it from',
    body: `
      <p>To get the calories consumed, you have to enter the foods you have eaten. The
      reading prices what you wrote down, and there is nothing written on this one.</p>
      <p style="margin:10px 0 0;">Left as it is, it is charged as an average meal —
      ${UNKNOWN_MEAL.kcal.toLocaleString('en-US')} kcal — and counted as too vague to read.
      That is a placeholder, not your meal.</p>`,
    actions: `
      <button class="btn btn-secondary" data-act="meal-skip">Skip Counting</button>
      <button class="btn btn-primary" data-act="meal-note">Add Note</button>`
  });
}

/* Raised from closeFollowUp when a meal came out of the question with no words
   on it. Returns whether it took the turn, so the caller stops rather than
   rendering over the dialog it just set. */
function mealNeedsFoods(p) {
  if (!p || p.kind !== 'entries' || state.mealAsked[p.id]) return false;
  const row = findRow('entries', p.id);
  if (!row || !isEatenRow(row) || (row.note || '').trim()) return false;
  state.mealAsked[p.id] = true;
  state.mealAsk = { id: p.id, activity: row.activity };
  render();
  return true;
}

/* ── one shell for the dialogs that ask something ──

   Every one of these was its own hand-built box, and the two consent dialogs
   had borrowed the donation sheet's — which is styled around a picture band
   across the top. Without that band the close button, positioned to ride on
   it, floated over the title on bare cream, and the kicker sat hard against
   the top edge because the padding lived in a body element these dialogs do
   not have.

   So: a medallion with the icon of whatever is being asked about, a kicker, a
   title, the body, and a row of actions. The icon is the point of it — a
   question about your log, a question about a meal, a question about deleting
   something, and a note all looked identical before, and the first thing read
   on any of them was the word "Before". */
function lightbox(o) {
  const tone = o.tone || 'var(--color-accent)';
  return `
  <div class="no-print lb-back"${o.closeAct ? ` data-backdrop="${esc(o.closeAct)}"` : ''}>
    <div class="lb${o.wide ? ' lb-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
      ${o.closeAct ? `<button class="lb-x" data-act="${esc(o.closeAct)}" aria-label="Close">✕</button>` : ''}
      <div class="lb-mark" style="--lb-tone:${tone};" aria-hidden="true">${nodeIcon(o.icon, 26)}</div>
      ${o.kicker ? `<div class="lb-kicker" style="color:${tone};">${esc(o.kicker)}</div>` : ''}
      <h2 class="lb-title">${esc(o.title)}</h2>
      ${o.sub ? `<p class="lb-sub">${esc(o.sub)}</p>` : ''}
      <div class="lb-body">${o.body}</div>
      ${o.pinned || ''}
      ${o.actions ? `<div class="lb-acts${o.actsClass ? ` ${esc(o.actsClass)}` : ''}">${o.actions}</div>` : ''}
      ${o.foot ? `<p class="lb-foot">${o.foot}</p>` : ''}
    </div>
  </div>`;
}

/* ── the money-out question, drawn ──

   Two screens on one flag: the question, while the spend is unfiled, and where
   it leaves you once it is answered. The markup below is written once and
   dropped into both frames — the laptop's dialog and the phone's sheet — so
   the two layouts cannot drift into saying different things about the same
   spend. Only the frame around it differs, the way the donate ask already
   works.

   The art is drawn rather than photographed: same 1.7 stroke and the same
   currentColor as the rest of the icon set, so the scale on this card reads as
   the scale on the summary card. Everything sits in a 64×56 box, which lets a
   card hold one without measuring it. */
const DQ_ART = {
  // A coin above a balance: the spend going onto the scale it is weighed on.
  scales: '<circle cx="32" cy="8.6" r="5.4"/><circle cx="32" cy="8.6" r="1.5" fill="currentColor" stroke="none"/>'
    + '<path d="M32 15.4v5.4"/><path d="M13 21h38"/><path d="M32 21v22.4"/>'
    + '<path d="M26.2 43.4h11.6l2 4H24.2Z"/>'
    + '<path d="M13 21 7.6 33.4A6.4 6.4 0 0 0 18.4 33.4Z"/>'
    + '<path d="M51 21 45.6 33.4A6.4 6.4 0 0 0 56.4 33.4Z"/>',
  /* The same coin, going somewhere else entirely.

     Every point that meets the body is solved off the body's own ellipse
     rather than placed by eye: an ear whose base floats above the back reads
     as a fin, and a snout that only grazes the edge reads as a circle stuck
     on. The coin hangs above the slot with no line drawn between them — the
     line made a lollipop out of it. */
  piggy: '<path d="M8 31C8 23.5 14.6 17.4 23 16.4c2.5-.3 5.2-.2 7.6.3L36.6 8l5.8 12.4'
    + 'c2.8 1.9 5 4.3 6.2 7.1h4a4.9 4.9 0 0 1 0 9.9h-4.2c-2.2 4.8-7.6 8.4-14.4 9.4'
    + '-6.4 1-12.6-.4-16.6-3.4C10.4 39.6 8 35.6 8 31Z"/>'
    + '<circle cx="54.4" cy="30.4" r="1" fill="currentColor" stroke="none"/><circle cx="54.4" cy="34.2" r="1" fill="currentColor" stroke="none"/>'
    + '<circle cx="38.4" cy="26.4" r="1.6" fill="currentColor" stroke="none"/>'
    + '<path d="M17.4 43v5.4M33.6 45.2v3.2"/><path d="M8.2 27.4c-4.2-.4-5.2 3.8-1.8 4.8"/>'
    + '<path d="M17.4 20.6h9"/><circle cx="24" cy="8" r="5"/>'
    + '<circle cx="24" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
  // What is left: a wallet, with a note edge showing above the fold.
  wallet: '<path d="M15.6 17.4v-3.2a3.4 3.4 0 0 1 3.4-3.4h20a3.4 3.4 0 0 1 3.4 3.4v3.2"/>'
    + '<rect x="5.6" y="17.4" width="52.8" height="30.4" rx="6.4"/>'
    + '<path d="M58.4 27.2h-10.4a6.2 6.2 0 0 0 0 12.4h10.4"/>'
    + '<circle cx="51.4" cy="33.4" r="2" fill="currentColor" stroke="none"/>',
  /* Money arriving and money leaving. The stack and the arrow are kept clear of
     one another: overlapped, the arrowhead reads as part of the coins and the
     direction — the whole point of the drawing — stops being legible. */
  inflow: '<ellipse cx="18" cy="24" rx="9.4" ry="3.6"/><path d="M8.6 24v16.8a9.4 3.6 0 0 0 18.8 0V24"/>'
    + '<path d="M8.6 30.6a9.4 3.6 0 0 0 18.8 0"/><path d="M8.6 36.2a9.4 3.6 0 0 0 18.8 0"/>'
    + '<path d="M45 46V16"/><path d="M35.6 25.4 45 16l9.4 9.4"/>',
  outflow: '<rect x="5.6" y="27" width="29" height="17.4" rx="3.6"/>'
    + '<circle cx="20.1" cy="35.7" r="4.2"/>'
    + '<path d="M10.4 27v-3a3 3 0 0 1 3-3h22.2a3 3 0 0 1 3 3v16.6"/>'
    + '<path d="M51 11.6v27"/><path d="M43.6 31.2 51 38.6l7.4-7.4"/>'
};
const dqArt = (name) => `<svg class="dq-art" viewBox="0 0 64 56" fill="none" stroke="currentColor"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DQ_ART[name] || ''}</svg>`;

/* The question. The two answers are shown as the two things they actually are
   — two ways of filing one spend — rather than as a yes and a no with the
   difference buried in a paragraph above them. The amount rides on the seam
   between them, because it is the subject of both. */
function deductQuestion(c) {
  return `
  <div class="dq">
    <h4 class="dq-title">${esc(c.title)}</h4>
    <p class="dq-sub">${esc(c.sub)}</p>
    <div class="dq-opts">
      <span class="dq-pill">${esc(c.spend)}</span>
      <div class="dq-opt is-take">
        ${dqArt('scales')}
        <span class="dq-cap">Reduce balance</span>
        <p class="dq-copy">Comes off Money In, so the balance stays a true running total.</p>
      </div>
      <div class="dq-opt is-aside">
        <span class="dq-tag">Savings fund</span>
        ${dqArt('piggy')}
        <span class="dq-cap">Keep apart</span>
        <p class="dq-copy">Logged as a spend of its own. For savings, or anything reimbursed.</p>
      </div>
    </div>
    <button class="dq-switch" data-act="deduct-remember" role="switch" aria-checked="${state.deductRemember}">
      <span class="dq-track"><span class="dq-knob"></span></span>
      <span>Do this every time — stop asking</span>
    </button>
    <div class="dq-acts">
      <button class="btn btn-primary dq-go" data-act="deduct-yes">Yes, take it off</button>
      <button class="btn btn-secondary dq-go" data-act="deduct-no">No, keep it aside</button>
    </div>
  </div>`;
}

/* The answer. Three figures rather than a sentence carrying all three: the
   balance is the one being asked about, and burying it mid-sentence between
   the other two is what made it hard to find.

   Spending is everything logged, including anything held aside — that total
   answers "what did I spend", which is not the question the balance answers.
   The gap between them is named in the footnote rather than left to be
   noticed. */
function deductResult(c) {
  const st = c.st;
  const f = (cents) => amount(Math.abs(cents) / 100);
  const over = st.leftCents < 0;
  const cards = [
    {
      cls: over ? 'is-over' : 'is-bal', tag: 'Current balance', art: 'wallet',
      amt: f(st.leftCents), unit: over ? 'over' : 'left',
      // Describes the figure rather than restating the heading above it.
      note: over ? 'How far past Money In you have gone.' : 'Your running net funds.'
    },
    { cls: 'is-in', tag: 'Total income', art: 'inflow', amt: f(st.inCents), unit: 'in', note: 'Total funds received.' },
    { cls: 'is-out', tag: 'Total spending', art: 'outflow', amt: f(st.outCents), unit: 'out', note: 'Total funds spent.' }
  ];
  const aside = st.asideCents
    ? ` ${f(st.asideCents)} is held aside across ${st.asideCount} ${st.asideCount === 1 ? 'entry' : 'entries'}, so it is in what you spent but not off your balance.`
    : '';
  return `
  <div class="dq">
    <h4 class="dq-title">${esc(c.title)}</h4>
    <p class="dq-sub">${esc(c.sub)}</p>
    <div class="dq-stats">
      ${cards.map((s) => `
        <div class="dq-stat ${s.cls}">
          <span class="dq-stat-tag">${esc(s.tag)}</span>
          ${dqArt(s.art)}
          <div class="dq-stat-fig">
            <span class="dq-stat-amt">${esc(s.amt)}</span>
            <span class="dq-stat-unit">${esc(s.unit)}</span>
            <span class="dq-stat-note">${esc(s.note)}</span>
          </div>
        </div>`).join('')}
    </div>
    <p class="dq-foot">This summary is based on ${esc(c.window)}. Change it on any entry later.${esc(aside)}</p>
    <button class="btn btn-primary dq-done" data-act="deduct-close">Done</button>
  </div>`;
}

/* The desktop's frame. The backdrop scrolls and centres safely: a result panel
   taller than a short window would otherwise overflow the top of a centred
   flex box, where no scroll can reach it. */
function deductDialog() {
  if (!state.deductAsk) return '';
  const c = deductCopy();
  return `
    <div style="position:fixed;inset:0;background:color-mix(in srgb, var(--color-neutral-900) 55%, transparent);display:flex;align-items:safe center;justify-content:safe center;padding:20px;z-index:50;overflow:auto;">
      <div class="blueprint dq-shell" style="background:var(--color-bg);">
        ${state.deductAsk.done ? deductResult(c) : deductQuestion(c)}
      </div>
    </div>`;
}

/* ── yesterday, offered once ──

   The first time the app is opened on a new day, and only then. The key is its
   own localStorage entry rather than a field on state, for the same reason the
   donation ask's is: it describes this browser and has no business syncing to
   the account and following someone onto their other devices — being shown the
   recap on the laptop is not a reason to withhold it on the phone.

   Only offered when there is something to show. "Would you like to know what
   happened yesterday" is a poor question to ask someone who logged nothing
   yesterday, and a worse one to answer with an empty deck. Answering either way
   marks the day done: "Not now" means not now, not "ask again on the next
   render". */
const RECAP_SEEN_KEY = 'zimpan.recap.v1';
const recapSeenOn = () => { try { return localStorage.getItem(RECAP_SEEN_KEY) || ''; } catch (err) { return ''; } };
const markRecapSeen = () => { try { localStorage.setItem(RECAP_SEEN_KEY, iso(new Date())); } catch (err) { /* private mode */ } };

function maybeAskRecap() {
  if (!state.auth || state.recapAsk) return;
  const today = iso(new Date());
  if (recapSeenOn() === today) return;
  const y = mShiftIso(today, -1);
  const had = state.entries.some((e) => e.date === y) || state.money.some((e) => e.date === y);
  if (!had) return;
  state.recapAsk = true;
  render();
}

function recapDialog() {
  if (!state.recapAsk) return '';
  const y = mShiftIso(iso(new Date()), -1);

  /* What is actually there, rather than a promise that something is. "Would you
     like to know what happened yesterday" is a better question when it can say
     how much there is to know — and it costs a reader nothing to decline once
     they can see it is thin. */
  const rows = state.entries.filter((e) => e.date === y);
  const cash = state.money.filter((e) => e.date === y);
  const mins = rows.reduce((a, e) => a + (span(e) || 0), 0);
  const out = cash.reduce((a, e) => a + (Number(e.out) || 0), 0);
  const bits = [];
  if (mins) bits.push(`${dur(mins)} logged`);
  if (rows.length) bits.push(`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`);
  if (out) bits.push(`${amount(out)} out`);

  return lightbox({
    icon: 'history',
    tone: 'var(--color-accent)',
    kicker: dayLabel(y),
    title: 'Would you like to know what happened yesterday?',
    closeAct: 'recap-no',
    body: `
      ${bits.length ? `<div class="lb-stats">${bits.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <p style="text-align:center;">Your report cards, in the time it takes to read them.</p>`,
    actions: `
      <button class="btn btn-secondary" data-act="recap-no">Not now</button>
      <button class="btn btn-primary" data-act="recap-yes">Show me</button>`
  });
}

/* What the assistant is given to answer from.

   This is the one place in the app that sends the log itself rather than a
   summary of it — notes included, which is what makes "what did I eat on
   Tuesday" answerable at all. It is also why chat has its own consent: the
   estimate dialog promises the opposite, and that promise still holds for
   estimates.

   Bounded on purpose. A window rather than everything ever logged, and a cap on
   rows inside it, because the whole log of a long-standing account is both a
   large request and more than any question needs. Newest first, so the cap
   drops the oldest rather than the most relevant.

   No ids, no account, no sync stamps: none of it helps answer a question, and
   the less that leaves the device the better. */
const CHAT_DAYS = 60;
const CHAT_ROWS = 400;
/* The server refuses a body over 60,000 characters, and four hundred rows is
   only a small request when the rows are short. An account that writes notes
   on what it logs reached the refusal — "That is more log than we can send in
   one go" — with no way past it but to log less, which is not an answer.

   So the row cap is fitted rather than fixed: the payload is measured and
   shrunk until it is inside the budget, dropping the oldest first. Under the
   server's number by a margin, because the request carries the transcript
   too. */
const CHAT_BUDGET = 52000;
const CHAT_ROWS_MIN = 25;
// One long note should cost a few rows, not the whole request.
const CHAT_NOTE_MAX = 400;

const chatNote = (note) => {
  const t = String(note || '').trim();
  if (!t) return undefined;
  return t.length > CHAT_NOTE_MAX ? `${t.slice(0, CHAT_NOTE_MAX)}…` : t;
};

/* The oldest day the lists actually reach. Without it a trimmed log reads as
   an empty one, and the assistant answers "you logged nothing that week" about
   a week that is right there in `daily`. Both lists are newest first, so it is
   the earlier of their last rows. */
const rowsFrom = (lists) => lists
  .map((l) => (l.length ? l[l.length - 1].date : ''))
  .filter(Boolean)
  .sort()[0];

const windowSteps = (inWindow) => {
  const out = {};
  Object.keys(state.steps || {}).forEach((d) => {
    const v = Number(state.steps[d]) || 0;
    if (v && inWindow(d)) out[d] = v;
  });
  return out;
};

/* Newest first, so the fit drops the oldest rather than the most relevant, and
   the count that was asked for is reported back as `rowCap` — the assistant is
   told what it is not being shown. */
function chatFacts() {
  let cap = CHAT_ROWS;
  let facts = chatPayload(cap);
  // A guess scaled from the measured size lands close; the loop covers rows of
  // uneven length and the part of the body that does not shrink with them.
  for (let i = 0; i < 8; i++) {
    const size = JSON.stringify(facts).length;
    if (size <= CHAT_BUDGET || cap <= CHAT_ROWS_MIN) break;
    cap = Math.max(CHAT_ROWS_MIN, Math.min(cap - 1, Math.floor(cap * (CHAT_BUDGET / size))));
    facts = chatPayload(cap);
  }
  return facts;
}

function chatPayload(rowCap) {
  const to = iso(new Date());
  const from = mShiftIso(to, -(CHAT_DAYS - 1));
  const inWindow = (d) => d >= from && d <= to;
  const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  const entries = state.entries
    .filter((e) => inWindow(e.date))
    .sort(newestFirst)
    .slice(0, rowCap)
    .map((e) => ({
      date: e.date, activity: e.activity || '', category: e.category || '',
      from: clock12(e.from), to: clock12(e.to), minutes: span(e) || 0,
      note: chatNote(e.note)
    }));

  const money = state.money
    .filter((e) => inWindow(e.date))
    .sort(newestFirst)
    .slice(0, rowCap)
    .map((e) => ({
      date: e.date, activity: e.activity || '', purpose: e.purpose || '',
      in: Number(e.in) || 0, out: Number(e.out) || 0,
      offBudget: e.offBudget ? true : undefined,
      note: chatNote(e.note)
    }));

  /* The figures the app itself puts on screen, worked out here the same way
     the dials work them out. Without these the assistant was handed nothing
     but text, and answered a question about calories burned versus consumed
     with "the log doesn't hold calorie figures on either side" — true of what
     we were sending it, and plainly false to someone looking at the two dials
     saying exactly that. A number the app shows and the assistant cannot see
     is worse than one neither has.

     Per day rather than as a total, because almost every question about a
     balance is really about a stretch of days, and a total cannot be taken
     apart again. */
  const dates = [...new Set(state.entries.filter((e) => inWindow(e.date)).map((e) => e.date))]
    .sort().reverse().slice(0, CHAT_DAYS);
  const daily = dates.map((d) => {
    const rows = state.entries.filter((e) => e.date === d);
    const burn = burnFor(rows, state.weightKg, 1, [d]);
    const food = foodReport(rows, state.money.filter((m) => m.date === d), 1);
    const macros = food.ai || food.local || null;
    const eaten = Math.round(food.kcal || 0);
    const sleep = rows.filter(isSleepRow).reduce((t, r) => t + (span(r) || 0), 0);
    return {
      date: d,
      burnedMovingKcal: burn.kcal,
      workoutMinutes: burn.minutes || undefined,
      steps: burn.steps || undefined,
      burnedAtRestKcal: burn.restKcal,
      eatenKcal: eaten,
      proteinG: macros ? Math.round(macros.protein) : undefined,
      carbsG: macros ? Math.round(macros.carbs) : undefined,
      fatG: macros ? Math.round(macros.fat) : undefined,
      // Positive means more spent than eaten. Named rather than left as "net",
      // which reads either way round and would be guessed at.
      netDeficitKcal: burn.kcal + burn.restKcal - eaten,
      refinedByAi: food.ai ? true : undefined,
      sleepMinutes: sleep || undefined
    };
  });

  const sum = (k) => daily.reduce((t, d) => t + (d[k] || 0), 0);
  /* The wellbeing reading behind the report cards, so "how am I doing" can be
     answered with the app's own four dimensions rather than reinvented. */
  const readings = dimensionReadings(wellbeing(state.entries.filter((e) => inWindow(e.date)), state.steps), dates.length || 1)
    .map((r) => ({ dimension: r.label, minutesLogged: r.total, status: r.status, reading: r.note }));

  /* A work account has no money, meals or sleep to describe, and sending an
     empty shape of each would only invite the assistant to talk about things
     this product does not do. The whole personal half is left out rather than
     sent as zeroes. */
  const work = workMode();
  const bal = moneyStatus(moneyAll());
  if (work) {
    return {
      today: to,
      window: { from, to, days: CHAT_DAYS },
      product: 'Zimpan for Teams — work hours against projects. This account has no money, meal or sleep tracking; say so if asked about them.',
      projects: teamProjects().map((p) => p.name),
      rowCap,
      truncated: {
        entries: state.entries.filter((e) => inWindow(e.date)).length > rowCap,
        rowsFrom: rowsFrom([entries])
      },
      entries
    };
  }
  return {
    today: to,
    window: { from, to, days: CHAT_DAYS },
    /* Spelled out, because the assistant has no other way to know these are
       estimates read from typed descriptions rather than anything measured. */
    energyNote: 'Calories are estimates. Food is read from what was typed; movement is priced by MET table unless refinedByAi is true, in which case a model re-read the description. Rest is about 22 kcal per kg per day.',
    daily,
    energyTotals: {
      daysWithEntries: daily.length,
      burnedMovingKcal: sum('burnedMovingKcal'),
      burnedAtRestKcal: sum('burnedAtRestKcal'),
      eatenKcal: sum('eatenKcal'),
      netDeficitKcal: sum('netDeficitKcal')
    },
    wellbeing: readings,
    currency: currency().code,
    weightKg: state.weightKg || null,
    // Named so the model does not read a capped list as the whole of it.
    rowCap,
    truncated: {
      entries: state.entries.filter((e) => inWindow(e.date)).length > rowCap,
      money: state.money.filter((e) => inWindow(e.date)).length > rowCap,
      rowsFrom: rowsFrom([entries, money])
    },
    categories: state.categories.map((c) => c.name),
    purposes: state.purposes.map((p) => p.name),
    /* The window's days only. The whole map is every day this account has ever
       recorded a step count on, which for a long-standing account is thousands
       of characters about days the question cannot be about. */
    steps: windowSteps(inWindow),
    balance: {
      inTotal: bal.inCents / 100, outTotal: bal.outCents / 100,
      left: bal.leftCents / 100, heldAside: bal.asideCents / 100
    },
    entries,
    money
  };
}

/* The turns that go with the question. The server takes forty of them and
   20,000 characters, and a long enough afternoon of asking reaches both — so
   the oldest turns are dropped here rather than the whole request being
   refused. The newest are what a follow-up depends on, and the question just
   typed is never among the ones dropped. */
const CHAT_TURNS = 20;
const CHAT_TURN_CHARS = 2000;
const CHAT_HISTORY_BUDGET = 16000;

function chatHistory() {
  const all = state.chat.messages.map((m) => ({
    role: m.role,
    // The same clamp the server puts on a turn before it reaches the model, so
    // what is measured against the budget here is what would be used there.
    text: String(m.text || '').slice(0, CHAT_TURN_CHARS)
  }));
  let out = all.slice(-CHAT_TURNS);
  while (out.length > 1 && JSON.stringify(out).length > CHAT_HISTORY_BUDGET) out = out.slice(1);
  // A single turn over the budget is still sent: the server's own cap is the
  // backstop, and dropping the question itself would send nothing to answer.
  return out;
}

/* ── asking, and being answered ──

   The transcript is state and nothing else: no server copy, no localStorage.
   Closing the chat ends it, which is the honest behaviour for something that
   sends your log with every question — a history that quietly persisted would
   be a second copy of the diary nobody asked for.

   The user's turn is appended before the request so it appears immediately;
   a failure leaves it there with the error beneath it rather than swallowing
   what was typed. */
async function chatSend(text) {
  const q = String(text == null ? state.chat.draft : text).trim();
  if (!q || state.chat.busy) return;
  if (!state.chatConsent) { state.chatAsking = true; render(); return; }

  state.chat.messages = state.chat.messages.concat([{ role: 'user', text: q }]);
  state.chat.draft = '';
  state.chat.error = '';
  state.chat.busy = true;
  chatStopListening();
  render();

  try {
    const res = await API.chat(chatHistory(), chatFacts());
    const reply = (res.reply && res.reply.text) || '';
    state.chat.messages = state.chat.messages.concat([{ role: 'assistant', text: reply, truncated: !!(res.reply && res.reply.truncated) }]);
    if (state.chat.speak) speakReply(reply);
  } catch (err) {
    state.chat.error = err.message || 'Could not reach the assistant.';
  } finally {
    state.chat.busy = false;
    render();
  }
}

/* ── voice ──

   Both halves are browser features rather than anything the server hears: the
   microphone goes to the platform's own recognition, and replies are read by
   the platform's synthesiser. Nothing extra is sent anywhere by either.

   Feature-detected rather than assumed. Recognition in particular is absent or
   unreliable outside Chromium and recent Safari, so the button is only drawn
   where it will actually work — an affordance that silently does nothing is
   worse than one that is not there. */
const SpeechRec = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const canHear = () => !!SpeechRec;
const canSpeak = () => typeof window !== 'undefined' && !!window.speechSynthesis;

let recogniser = null;

function chatStopListening() {
  state.chat.listening = false;
  if (recogniser) { try { recogniser.stop(); } catch (err) { /* already stopped */ } }
  recogniser = null;
}

function chatListen() {
  if (!canHear()) return;
  if (state.chat.listening) { chatStopListening(); render(); return; }
  // Speaking while it listens would have it transcribe its own last answer.
  stopSpeaking();

  let rec;
  try { rec = new SpeechRec(); } catch (err) { state.chat.error = 'This browser will not open the microphone.'; render(); return; }
  recogniser = rec;
  rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;

  rec.onresult = (ev) => {
    let said = '';
    for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
    state.chat.draft = said.trim();
    // Painted rather than re-rendered: a full render mid-dictation would rebuild
    // the field the words are landing in.
    paintChatDraft();
    if (ev.results[ev.results.length - 1].isFinal) {
      const finished = state.chat.draft;
      chatStopListening();
      if (finished) chatSend(finished); else render();
    }
  };
  rec.onerror = (ev) => {
    chatStopListening();
    state.chat.error = ev && ev.error === 'not-allowed'
      ? 'The microphone is blocked for this site. Allow it in your browser settings and try again.'
      : 'Could not hear that. Try again, or type it.';
    render();
  };
  rec.onend = () => { if (state.chat.listening) { state.chat.listening = false; render(); } };

  try { rec.start(); } catch (err) { chatStopListening(); return; }
  state.chat.listening = true;
  state.chat.error = '';
  render();
}

function stopSpeaking() {
  if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (err) { /* nothing to cancel */ } }
}

function speakReply(text) {
  if (!canSpeak() || !text) return;
  stopSpeaking();
  try {
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 1200));
    u.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch (err) { /* a device with no voice installed is not an error worth showing */ }
}

/* The dictation field, repainted without a render for the same reason the
   category search is: rebuilding an input while words are arriving in it loses
   both the caret and the text. */
function paintChatDraft() {
  const el = document.querySelector('[data-k="chat-draft"]');
  if (el && el.value !== state.chat.draft) el.value = state.chat.draft;
}

/* ── the chat panel ──

   One body, two frames — the phone's sheet and the laptop's dialog — the way
   the calorie breakdown and the money-out question already work. */
function chatBody(closeAct) {
  const c = state.chat;
  const empty = !c.messages.length;

  const bubbles = c.messages.map((m) => `
    <div class="chat-turn is-${m.role === 'user' ? 'me' : 'it'}">
      <div class="chat-bubble">${esc(m.text).replace(/\n/g, '<br>')}</div>
      ${m.truncated ? '<div class="chat-cut">Cut short — ask for the rest if you need it.</div>' : ''}
    </div>`).join('');

  /* Openers rather than an empty box. Nobody's first instinct is to know what
     an assistant over their own diary can be asked, and these are the questions
     the log can actually answer well. */
  const seeds = ['Am I burning more than I eat?', 'Where did my time go this week?', 'What am I spending most on?', 'How has my sleep been?', 'How do I edit a category?'];

  return `
  <div class="chat">
    <div class="chat-head">
      <span class="chat-mark" aria-hidden="true">${nodeIcon('pulse', 18)}</span>
      <div class="chat-title">
        <strong>Chat with Zimpan</strong>
        <span>Your log, and how this app works. Nothing beyond that.</span>
      </div>
      ${canSpeak() ? `<button type="button" class="chat-icon${c.speak ? ' is-on' : ''}" data-act="chat-speak"
        aria-pressed="${c.speak}" title="${c.speak ? 'Replies are read aloud' : 'Replies stay silent'}"
        aria-label="${c.speak ? 'Stop reading replies aloud' : 'Read replies aloud'}">${nodeIcon(c.speak ? 'sound' : 'mute', 17)}</button>` : ''}
      <button type="button" class="chat-icon" data-act="${esc(closeAct)}" aria-label="Close">✕</button>
    </div>

    <div class="chat-log" data-chat-log>
      ${empty ? `
        <div class="chat-empty">
          <p>Ask about anything you have logged — the last ${CHAT_DAYS} days are what it can see — or about how the app works.</p>
          <div class="chat-seeds">
            ${seeds.map((q) => `<button type="button" class="chat-seed" data-act="chat-seed" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
          </div>
        </div>` : bubbles}
      ${c.busy ? '<div class="chat-turn is-it"><div class="chat-bubble is-wait"><span class="spinner"></span> Reading your log…</div></div>' : ''}
      ${c.error ? `<div class="chat-err">${esc(c.error)}</div>` : ''}
    </div>

    <div class="chat-ask">
      ${canHear() ? `<button type="button" class="chat-mic${c.listening ? ' is-live' : ''}" data-act="chat-listen"
        aria-pressed="${c.listening}" aria-label="${c.listening ? 'Stop listening' : 'Ask by voice'}"
        title="${c.listening ? 'Listening — tap to stop' : 'Ask by voice'}">${nodeIcon(c.listening ? 'stop' : 'mic', 18)}</button>` : ''}
      <input class="input chat-input" type="text" data-k="chat-draft" data-sync="chat.draft"
        data-enter="chat-send" value="${esc(c.draft)}" autocomplete="off"
        placeholder="${c.listening ? 'Listening…' : 'Ask about your log'}" aria-label="Ask about your log">
      <button type="button" class="btn btn-primary chat-send" data-act="chat-send"${c.busy ? ' disabled' : ''}>Ask</button>
    </div>
    <p class="chat-foot">Answers are read from what you logged and can be wrong. Nothing here can change your log.</p>
  </div>`;
}

function chatDialog() {
  if (!state.chat.open || mobileOn()) return '';
  return `
    <div class="no-print" data-backdrop="chat-close"
         style="position:fixed;inset:0;background:color-mix(in srgb, var(--color-neutral-900) 55%, transparent);display:flex;align-items:safe center;justify-content:safe center;padding:20px;z-index:66;overflow:auto;">
      <div class="blueprint chat-shell" style="background:var(--color-bg);">${chatBody('chat-close')}</div>
    </div>`;
}

function mChatSheet() {
  if (!state.chat.open) return '';
  return mSheet(chatBody('chat-close'), '18px 16px 20px');
}

/* Its own consent, and its own words. The estimate dialog promises that only a
   food description leaves the device; this one has to say plainly that the log
   does, notes and all, because that is what makes it able to answer. */
function chatConsentDialog() {
  if (!state.chatAsking) return '';
  /* Its own words, because it is a bigger ask than the meal estimate: that one
     promises only a food description leaves the device, and this sends the log
     itself. The shield rather than the chat mark — the question here is about
     privacy, not about chatting. */
  return lightbox({
    icon: 'shield',
    tone: 'var(--color-accent)',
    kicker: 'Before we do this',
    title: 'Send your log so it can answer?',
    closeAct: 'chat-consent-no',
    body: `
      <p>To answer questions about what you have tracked, the assistant is sent your last
      ${CHAT_DAYS} days — your activities, categories, amounts, and <strong>the notes you wrote on
      them</strong>. That is more than the meal estimates send, which is why this is a separate
      question.</p>
      <p>It goes to Anthropic's Claude API with each question and is not stored by us. Your name,
      your email and your password never go. The assistant can only read — it cannot add, change or
      delete anything. Close the chat and the conversation is gone.</p>`,
    actions: `
      <button class="btn btn-ghost" data-act="chat-consent-no">No thanks</button>
      <button class="btn btn-primary" data-act="chat-consent-yes">Yes, let it read my log</button>`
  });
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

/* Time the app has been open, kept on disk rather than in a variable. On a
   phone this counter almost never reached five minutes: iOS discards and
   reloads a backgrounded tab, and every reload put it back to zero — so the
   nudge needed five unbroken minutes in one page session, which browsing an
   app in short visits never gives you. */
const DONATE_MS_KEY = 'zimpan.donate.ms.v1';
const readOpenMs = () => {
  try {
    const held = JSON.parse(localStorage.getItem(DONATE_MS_KEY) || '{}');
    // Only today's tally counts; yesterday's patience is not banked.
    return held && held.d === iso(new Date()) ? Number(held.ms) || 0 : 0;
  } catch (err) { return 0; }
};
let openMs = readOpenMs();

const donateSeenOn = () => { try { return localStorage.getItem(DONATE_SEEN_KEY) || ''; } catch (err) { return ''; } };
const markDonateSeen = () => { try { localStorage.setItem(DONATE_SEEN_KEY, iso(new Date())); } catch (err) { /* private mode */ } };

function tickDonate() {
  if (!state.auth || state.donateOpen || (state.m && state.m.donateOpen)) return;
  // Never to a paying team. See mDonateCard().
  if (workMode()) return;
  // Still only counts while the tab is actually on screen — a window left in a
  // background tab for an hour has not been used for an hour.
  if (document.visibilityState !== 'visible') return;

  openMs += DONATE_TICK_MS;
  try {
    localStorage.setItem(DONATE_MS_KEY, JSON.stringify({ d: iso(new Date()), ms: openMs }));
  } catch (err) { /* private mode — the tally is a nicety, not a requirement */ }
  if (openMs < DONATE_AFTER_MS) return;
  // Recomputed rather than read from todayIso, which was fixed at load and
  // would be yesterday for anyone who left the app open past midnight.
  if (donateSeenOn() === iso(new Date())) return;

  markDonateSeen();
  /* The two layouts keep their sheets on different flags, and for a while this
     set only the desktop's — so the nudge never once appeared on a phone. */
  if (mobileOn()) { state.m.donateOpen = true; state.m.donateThanks = false; }
  else state.donateOpen = true;
  render();
}
setInterval(tickDonate, DONATE_TICK_MS);

/* The lightbox art. Drawn rather than photographed: the reference carries a
   stock photo of people, which is not ours to reproduce, so this is the same
   warmth in the brand's own hand — a coin dropped into an open palm on the
   time-to-money gradient, with the wordmark's own Z on the coin. */
const DONATE_HERO = `
  <div class="donate-hero" aria-hidden="true">
    <svg viewBox="0 0 460 172" preserveAspectRatio="xMidYMid slice" role="img">
      <defs>
        <linearGradient id="dhg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#8b5cf6"/><stop offset=".5" stop-color="#6d54f0"/><stop offset="1" stop-color="#16a394"/>
        </linearGradient>
        <radialGradient id="dhc" cx=".5" cy=".35" r=".75">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="460" height="172" fill="url(#dhg)"/>
      <rect width="460" height="172" fill="url(#dhc)"/>
      <g fill="#ffffff" opacity=".55">
        <circle cx="70" cy="40" r="2.4"/><circle cx="392" cy="52" r="3"/><circle cx="352" cy="28" r="1.8"/>
        <circle cx="104" cy="120" r="2"/><circle cx="412" cy="120" r="2.2"/><circle cx="50" cy="92" r="1.6"/>
        <path d="M304 38l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"/>
        <path d="M150 32l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3z"/>
      </g>
      <!-- the coin, mid-drop, carrying the wordmark Z -->
      <g transform="translate(230 60)">
        <ellipse cx="0" cy="34" rx="26" ry="7" fill="#3a2a68" opacity=".18"/>
        <circle r="30" fill="#ffd878" stroke="#eeb43a" stroke-width="3"/>
        <circle r="22.5" fill="none" stroke="#fff0c8" stroke-width="2"/>
        <path d="M-10 -11h20l-17 22h17" fill="none" stroke="#a9741a" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <!-- an open palm, cupped to catch it -->
      <g transform="translate(230 150)">
        <path d="M-62 -6 C -66 -20 -52 -28 -44 -20 C -46 -34 -30 -34 -28 -22 C -24 -34 -8 -32 -8 -20
                 C -4 -30 12 -26 10 -14 C 22 -18 34 -10 30 2 C 24 20 4 30 -18 30 C -42 30 -58 16 -62 -6 Z"
              fill="#f7e2c6"/>
        <path d="M-62 -6 C -66 -20 -52 -28 -44 -20 C -46 -34 -30 -34 -28 -22 C -24 -34 -8 -32 -8 -20
                 C -4 -30 12 -26 10 -14 C 22 -18 34 -10 30 2 C 24 20 4 30 -18 30 C -42 30 -58 16 -62 -6 Z"
              fill="none" stroke="#e0b988" stroke-width="2" opacity=".7"/>
        <path d="M-44 -20 C -40 -12 -34 -8 -28 -8 M-28 -22 C -24 -14 -18 -10 -12 -11
                 M-8 -20 C -4 -13 2 -11 8 -13" fill="none" stroke="#e6c79b" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
      </g>
    </svg>
  </div>`;

function donateSheet() {
  if (!state.donateOpen) return '';
  return `
  <div class="no-print donate-backdrop" data-donate-backdrop>
    <div class="donate-sheet" role="dialog" aria-modal="true" aria-labelledby="donate-title">
      <button class="donate-x" data-act="donate-close" aria-label="Close">×</button>
      ${DONATE_HERO}
      <div class="donate-body">
        <span class="donate-chip">A note from the maker</span>
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

/* Seven options where there were four. Past a month the control is wider than
   the column it sits in on a narrow screen, so it scrolls inside itself rather
   than forcing the labels down to initials — the same answer the landing nav
   and the phone's chip row already give to the same problem. */
/* The windows the page offers, in the order they read: shortest first, then
   the two calendar ones, then the long trailing counts, then everything.

   The labels are the definitions. "This Month" is this calendar month, not the
   last thirty days — the two differ by up to a day short of a month, and a
   control that said one and meant the other is worse than no control. */
const PAGE_RANGES = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['thismonth', 'This Month'],
  ['lastmonth', 'Last Month'],
  ...LONG_RANGES.map(([key, label]) => [key, label]),
  ['all', 'All Time']
];

/* `labels` is still accepted so the three callers can keep naming their own
   first option — "Yesterday" rather than "Day" on the lookback, which counts
   only finished days. Anything it does not override keeps the table's word. */
function segRange(name, labels) {
  const over = labels || [];
  const opt = (val, label) => `<label class="seg-opt"><input type="radio" name="${name}" data-act="range-${val}"${state.range === val ? ' checked' : ''}><span>${label}</span></label>`;
  return `<div class="seg">${PAGE_RANGES.map(([val, label], i) => opt(val, over[i] || label)).join('')}</div>`;
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
/* The bands people actually act on, in minutes.

   Under 6h30 is short; 6h30 to 7h is borderline; 7h to 9h is where most
   guidance settles; over 9h is worth noticing too, because long sleep is not
   simply more of a good thing. Boundaries land in the kinder band — seven hours
   exactly is a good night, not a borderline one. */
const sleepBandOf = (m) => (
  m < 390 ? { color: '#d92d20', label: 'under 6h 30m' }
    : m < 420 ? { color: '#e9a13b', label: '6h 30m – 7h' }
      : m <= 540 ? { color: '#0e9f6e', label: '7h – 9h' }
        : { color: '#241f30', label: 'over 9h' });

const isSleepName = (name) => /sleep|tulog|nap/i.test(String(name || ''));

/* Sleep, night by night, instead of a table of entries. Named apart from the
   report deck's sleepChart, which draws the same subject through the shared
   barChart helper and has no bands — two functions of one name in one file and
   the later declaration silently wins, which is how this first ran.

   A list answers "when did I sleep". The question anyone opening this has is
   "am I getting enough", and that is a shape rather than rows — so the entries
   stay underneath and the shape goes on top. Totals per day, because two
   entries on one night are one night's sleep. */
function sleepNightsChart(v) {
  const dates = (v.windowDates || []).slice().sort();
  if (!dates.length) return '';
  const inRange = new Set(dates);
  const byDate = {};
  state.entries.forEach((e) => {
    if (e.category !== v.focusName || !inRange.has(e.date)) return;
    byDate[e.date] = (byDate[e.date] || 0) + (span(e) || 0);
  });
  const days = dates.map((d) => ({ date: d, mins: byDate[d] || 0 }));
  if (!days.some((d) => d.mins)) return '';

  // Scaled to nine hours or the longest night, whichever is greater, so the
  // good band sits at a consistent height across windows.
  const top = Math.max(540, ...days.map((d) => d.mins));
  const logged = days.filter((d) => d.mins);
  const avg = Math.round(logged.reduce((a, d) => a + d.mins, 0) / (logged.length || 1));

  const bars = days.map((d) => {
    const band = d.mins ? sleepBandOf(d.mins) : null;
    const h = d.mins ? Math.max(3, Math.round((d.mins / top) * 100)) : 0;
    return `
        <div class="sleep-col" title="${esc(dayLabel(d.date))} · ${d.mins ? esc(dur(d.mins)) : 'nothing logged'}">
          <div class="sleep-track">
            ${d.mins
              ? `<div class="sleep-bar" style="height:${h}%;background:${band.color};"></div>`
              : '<div class="sleep-none"></div>'}
          </div>
          <span class="sleep-day">${new Date(d.date + 'T00:00:00').getDate()}</span>
        </div>`;
  }).join('');

  const key = [
    { color: '#d92d20', label: 'under 6h 30m' },
    { color: '#e9a13b', label: '6h 30m – 7h' },
    { color: '#0e9f6e', label: '7h – 9h' },
    { color: '#241f30', label: 'over 9h' }
  ].map((b) => `<span class="sleep-key"><i style="background:${b.color};"></i>${esc(b.label)}</span>`).join('');

  return `
      <div class="sleep-chart">
        <div class="sleep-chart-head">
          <span>Each night in ${esc(v.rangeLabel)}</span>
          ${logged.length ? `<span class="sleep-avg">${esc(dur(avg))} average across ${logged.length} ${logged.length === 1 ? 'night' : 'nights'}</span>` : ''}
        </div>
        <div class="sleep-cols">${bars}</div>
        <div class="sleep-keys">${key}</div>
      </div>`;
}

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
            ${isSleepName(v.focusName) ? sleepNightsChart(v) : ''}
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
              Syncs to your other devices with everything else.
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
  // Not this product's subject. See workMode().
  if (workMode()) return '';

  /* A thirty-day total on a dial scaled for one day reads as wildly over-eaten
     every time, so a multi-day range is averaged and says so. Every figure is
     divided by the same span, which leaves the balance between them — the
     reading this row exists to show — unchanged. */
  const days = Math.max(1, burn.days || 1);
  const per = (n) => Math.round(n / days);
  const burned = per(burn.kcal);
  const eaten = per(food.kcal);
  const rested = per(burn.restKcal);

  /* With nothing logged on either side there is no balance to draw, and
     printing one anyway would report a ~1,650 deficit at breakfast time purely
     because the day had not been logged yet. It says so rather than
     disappearing: a panel that silently comes and goes reads as a bug. The
     resting figure is still worth showing — it is true whatever you log. */
  if (!food.kcal && !burn.kcal) {
    return `
      <div class="cal-kicker">${days > 1 ? `Average day across ${days} days` : 'Daily calorie balance'}</div>
      <div class="cal-empty">
        Nothing to weigh up yet. Your body spends roughly
        <strong>${rested.toLocaleString('en-US')} kcal a day</strong> at rest, but a balance needs
        something on the other side — log a meal or a workout${stepDate
          ? `, or <button class="cal-link" data-act="steps-open" data-date="${esc(stepDate)}">add your steps</button>` : ''}.
      </div>`;
  }

  /* Everything out, less everything in. Positive is a deficit — more spent
     than eaten — which is the direction people are usually looking for, so it
     takes the green. */
  const net = burned + rested - eaten;
  const deficit = net >= 0;

  // One scale across all four, so the bars are comparable to each other rather
  // than each being full of itself.
  const top = Math.max(eaten, burned, rested, Math.abs(net), 1);
  const ARC = Math.PI * 42;

  /* Burned and eaten have a list behind them; resting and the net are
     arithmetic over the other two and have nothing to show. So only those two
     get the affordance — offering it on a dial that cannot answer is worse than
     not offering it.

     The affordance is its own small button rather than the whole dial, because
     two of these captions already contain buttons of their own — the steps link
     and the weight editor. A `<button>` start tag closes an open button, so
     wrapping the dial swallowed the three that followed it; and a control
     nested inside a control is unreachable with a screen reader either way. */
  const dial = (value, tone, glyph, cap, sub, kind) => {
    const dash = (Math.abs(value) / top) * ARC;
    return `
          <div class="cal-dial">
            <div class="cal-arc">
              <svg viewBox="0 0 110 62" aria-hidden="true" focusable="false">
                <path d="M13 55 A 42 42 0 0 1 97 55" fill="none" stroke="var(--track)" stroke-width="9" stroke-linecap="round"></path>
                <path d="M13 55 A 42 42 0 0 1 97 55" fill="none" stroke="${tone}" stroke-width="9" stroke-linecap="round"
                      stroke-dasharray="${dash.toFixed(2)} ${ARC.toFixed(2)}"></path>
              </svg>
              <span class="cal-glyph" style="color: ${tone};">${glyph}</span>
            </div>
            <div class="cal-value">~${Math.abs(value).toLocaleString('en-US')}</div>
            <div class="cal-cap">${esc(cap)}</div>
            ${sub ? `<div class="cal-sub">${sub}</div>` : ''}
            ${kind ? `<button type="button" class="cal-more" data-act="cal-open"
              data-kind="${esc(kind)}" data-scope="${esc(scope)}" aria-haspopup="dialog">See what made it up</button>` : ''}
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
            : (burn.steps ? `Includes ${burn.steps.toLocaleString('en-US')} steps across the range.` : ''), 'burn')}
        ${dial(eaten, 'var(--zg-donate)', CAL_ICONS.food, 'Calories consumed (food)',
          food.ai ? 'Calibrated by AI from what you wrote.' : '', 'food')}
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

          ${cashBlock(v)}
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
  /* The whole reading underneath this heading is about a body — what it ate,
     how it slept, whether it moved. A team's report has none of that to say,
     so the section goes rather than standing empty over its own subtitle.
     Both trackers head their reading from here, which is why one guard covers
     the money page too. See workMode(). */
  if (workMode()) return '';
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
  // Not this product's subject. See workMode().
  if (workMode()) return '';
  if (!food) return '';
  const ai = food.ai;
  const busy = state.aiBusy === scope;

  /* The AI figure replaces the local one rather than sitting beside it. Two
     different totals for the same meal is not a second opinion, it is a
     question the reader cannot answer — so the better one wins and says where
     it came from. The local reading stays available underneath. */
  const line = ai
    ? `Roughly ${ai.kcal.toLocaleString('en-US')} kcal — around ${ai.protein}g protein, ${ai.carbs}g carbs, ${ai.fat}g fat.`
    : food.nutrition;

  /* Two ways to ask for the same thing, because they answer different moments.
     The dialog catches you when the note is fresh, which is when it means most.
     This is for afterwards: a day you skipped, a day you said no to, or one you
     want read again now that the entry says more than it did.

     Offered on a single day only — across a week the text handed over is every
     meal of every day run together, a worse question than the local reading
     already answers and a much more expensive one. */
  const refine = !state.aiEstimates || !food.detail ? '' : `
            <div style="margin-top: 9px; display: flex; align-items: center; gap: 9px; flex-wrap: wrap;">
              ${canRefine ? `<button class="drawer-btn btn-refine" data-act="refine-food" data-scope="${esc(scope)}"${busy ? ' disabled' : ''}>
                ${busy ? '<span class="spinner"></span> Calibrating…' : (ai ? 'Calibrate again' : 'Calibrate with AI')}
              </button>` : ''}
              ${busy && !canRefine ? '<span style="font-size: 11px; color: var(--color-neutral-600); display: inline-flex; align-items: center; gap: 7px;"><span class="spinner"></span> Calibrating with AI…</span>' : ''}
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

/* ── net calories, drawn ──
   Bars from a zero line: above it a deficit, below it a surplus. Two scales
   rather than one, so the taller side fills its half and the shorter one is
   still visible — a fortnight of small deficits against one enormous surplus
   would otherwise be a flat line and a spike.

   Days with nothing logged draw no bar at all. A blank day is not a deficit of
   a whole day's resting burn; it is a day with no reading, and drawing it as
   the best day of the week would be a lie the chart tells confidently. */
/* The sentence naming the two ends of the run. Split out because there are
   three shapes of it and inlining them made the template unreadable: one day is
   not a range, and a run where every day came out the same has two ends that
   are the same number — saying "best" and "the other end" about identical
   figures reads as a bug rather than as a flat week. */
function netRange(shown, best, worst) {
  const side = (d) => `${Math.abs(d.net).toLocaleString('en-US')} ${d.net >= 0 ? 'deficit' : 'surplus'}`;
  if (shown.length === 1) {
    return `${esc(dayLabel(best.date))} is the only day with a reading, at ${side(best)}.`;
  }
  if (best.net === worst.net) {
    return `Every day with a reading came out at ${side(best)}.`;
  }
  return `Best day ${esc(dayLabel(best.date))} at ${side(best)};
    ${esc(dayLabel(worst.date))} was the other end at ${side(worst)}.`;
}

/* ── the report deck's donut ──

   Not the page's donut. That one is interactive, sits beside a legend and puts
   the total in the hole; this one stands alone above its own legend.

   The names live in the legend rather than around the ring. Radial labels need
   leader lines, a collision pass and a margin wide enough for the longest
   category, all of which shrink the ring to make room for text that reads
   better in a list anyway. Freed of them, the ring gets the whole width.

   The slices keep their share, printed on the arc — but only where the arc is
   wide enough to hold it. A number half off its own slice is worse than no
   number, and the legend below carries every figure regardless.

   Still folded to six and an "others": twelve slices means six slivers, and a
   sliver is not a share anybody can read whatever is written next to it. */
const DONUT_FOLD = 6;

/* White on a pale slice is barely there. The share is printed on the slice's
   own colour, and the palette runs from near-black violet to pale pink, so the
   ink is chosen from the background's luminance rather than assumed. Anything
   that is not a plain hex — a CSS variable, say — falls back to white, which is
   right for every colour this actually gets handed. */
function inkOn(color) {
  const h = String(color || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(v)) return '#ffffff';
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#16131f' : '#ffffff';
}
// Below this share the arc is narrower than the number it would carry.
const DONUT_LABEL_MIN = 0.07;

function donutParts(rows) {
  const total = rows.reduce((a, r) => a + r.mins, 0);
  if (total <= 0) return null;

  const head = rows.slice(0, DONUT_FOLD);
  const tail = rows.slice(DONUT_FOLD);
  const parts = head.map((r) => ({ name: r.name, color: r.color, mins: r.mins }));
  if (tail.length) {
    parts.push({
      // One folded category keeps its own name; folding it into "1 others"
      // would hide a name to save nothing.
      name: tail.length === 1 ? tail[0].name : `${tail.length} others`,
      color: '#b8b4c6',
      mins: tail.reduce((a, r) => a + r.mins, 0),
      folded: tail.length
    });
  }
  return { parts, total };
}

function deckDonut(rows, fmt) {
  if (!rows || !rows.length) return '';
  const built = donutParts(rows);
  if (!built) return '';
  const { parts, total } = built;

  /* Square and tight. With nothing printed outside the ring there is no margin
     to reserve, so the whole box is the donut. */
  const S = 220, CX = 110, CY = 110, R = 82, W = 34;
  const C = 2 * Math.PI * R;

  let acc = 0;
  const laid = parts.map((p) => {
    const frac = p.mins / total;
    const mid = acc + frac / 2;
    acc += frac;
    // -90° puts the first slice at twelve o'clock, matching the page's donut.
    const a = (-90 + 360 * mid) * Math.PI / 180;
    return {
      p, frac,
      dash: `${(frac * C).toFixed(2)} ${C.toFixed(2)}`,
      offset: (-(acc - frac) * C).toFixed(2),
      // Sat on the middle of the stroke band, where the slice is widest.
      x: CX + Math.cos(a) * R, y: CY + Math.sin(a) * R
    };
  });

  const arcs = laid.map((l) => `
        <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${esc(l.p.color)}" stroke-width="${W}"
          stroke-dasharray="${l.dash}" stroke-dashoffset="${l.offset}" transform="rotate(-90 ${CX} ${CY})">
          <title>${esc(l.p.name)} · ${Math.round(l.frac * 100)}% · ${esc(fmt(l.p.mins))}</title>
        </circle>`).join('');

  const onSlice = laid.filter((l) => l.frac >= DONUT_LABEL_MIN).map((l) => `
        <text class="dk-share" x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" fill="${inkOn(l.p.color)}"
          text-anchor="middle" dominant-baseline="central">${Math.round(l.frac * 100)}%</text>`).join('');

  const legend = laid.map((l) => `
        <li${l.p.folded ? ' class="is-folded"' : ''}>
          <i style="background: ${esc(l.p.color)};"></i>
          <span class="dk-key">${esc(l.p.name)}</span>
          <b>${Math.round(l.frac * 100)}%</b>
          <em>${esc(fmt(l.p.mins))}</em>
        </li>`).join('');

  return `
      <div class="deck-donut">
        <svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Share of the window by category">
          ${arcs}
          ${onSlice}
        </svg>
        <ul class="dk-legend">${legend}</ul>
      </div>`;
}

/* Bar labels have to fit in a column, and a column is the chart's width divided
   by however many days you asked for. Four digits do not fit in a month on a
   phone, so the number is shortened before it is ever asked to. */
const briefNum = (n) => {
  const v = Math.abs(Math.round(n));
  if (v >= 100000) return `${Math.round(v / 1000)}k`;
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
};
const briefCash = (n) => `${currency().symbol}${briefNum(n)}`;
/* "8h 20m" on a bar is four characters of precision nobody reads and twice the
   width that fits; "8.3h" says the same thing about a night's sleep and lets a
   fortnight keep its labels. The exact figure is in the tooltip and the average
   is spelled out under the chart. Module scope because the card hands the same
   formatter to the canvas — the shared image has to say what the card says. */
const briefHours = (m) => `${(m / 60).toFixed(1).replace(/\.0$/, '')}h`;

/* ── the diverging bar chart ──

   One drawing, two readings: calories put a deficit above the line and a
   surplus below it, money puts what came in above and what went out below.
   Both are "two quantities that oppose each other, per day", which is why they
   share a function rather than each growing their own.

   Two scales rather than one, so the taller side fills its half and the shorter
   one is still visible — a fortnight of small deficits against one enormous
   surplus would otherwise be a flat line and a spike. The trade is that the two
   halves are not comparable by height, which is what the printed numbers on the
   bars are for.

   Columns take `{date, up, down, logged}` with both magnitudes positive. Days
   with nothing logged draw nothing at all: a blank day is not a deficit of a
   whole day's resting burn, it is a day with no reading, and drawing it as the
   best day of the week would be a lie the chart tells confidently. */
function barChart(series, o) {
  if (!series || !series.length) return '';
  const shown = series.filter((d) => d.logged);
  if (!shown.length) return '';

  const maxUp = Math.max(0, ...shown.map((d) => d.up));
  const maxDown = Math.max(0, ...shown.map((d) => d.down));
  const zeroPct = Math.round((maxUp / ((maxUp + maxDown) || 1)) * 100);
  const fmt = o.fmt || briefNum;

  /* Past a certain count the columns are narrower than the numbers they would
     carry, and printing every one just overlaps them into a smear. Rather than
     go silent, the two peaks keep their labels — the question a crowded chart
     still gets asked is "how big was the biggest", and there is always room for
     two. The phone threshold is separate because the same month is half the
     width there.

     The count at which that happens belongs to the caller, because it is really
     a question about label width: "2.4k" fits where "8h 20m" does not, so a
     chart of durations gives out at half as many columns as one of calories. */
  const at = o.denseAt || [16, 9];
  const dense = series.length > at[0] ? ' is-dense' : '';
  const densePhone = series.length > at[1] ? ' is-dense-phone' : '';
  const peakUp = maxUp > 0 ? series.findIndex((d) => d.logged && d.up === maxUp) : -1;
  const peakDown = maxDown > 0 ? series.findIndex((d) => d.logged && d.down === maxDown) : -1;

  const cols = series.map((d, i) => {
    const up = d.logged && d.up > 0 ? Math.max(2, Math.round((d.up / (maxUp || 1)) * 100)) : 0;
    const down = d.logged && d.down > 0 ? Math.max(2, Math.round((d.down / (maxDown || 1)) * 100)) : 0;
    const tag = (peak) => (peak ? ' class="net-peak"' : '');
    return `
        <div class="net-col" title="${esc(o.title(d))}">
          <div class="net-half net-up" style="height: ${zeroPct}%;">
            ${up ? `<i style="height: ${up}%;"><b${tag(i === peakUp)}>${esc(fmt(d.up))}</b></i>` : ''}
          </div>
          <div class="net-half net-down" style="height: ${100 - zeroPct}%;">
            ${down ? `<i style="height: ${down}%;"><b${tag(i === peakDown)}>${esc(fmt(d.down))}</b></i>` : ''}
          </div>
        </div>`;
  }).join('');

  const missing = series.length - shown.length;
  return `
      <div class="net-chart">
        <div class="net-bars${dense}${densePhone}" style="--zero: ${zeroPct}%;">${cols}</div>
        <div class="net-axis">
          <span>${esc(dayLabel(series[0].date))}</span>
          <span>${esc(dayLabel(series[series.length - 1].date))}</span>
        </div>
        <div class="net-legend">
          <span><i class="net-key net-key-up"></i>${esc(o.upLabel)}</span>
          <!-- A one-sided chart has no second colour to explain. -->
          ${o.downLabel ? `<span><i class="net-key net-key-down"></i>${esc(o.downLabel)}</span>` : ''}
          <span class="net-avg">${esc(o.average)}</span>
        </div>
        <div class="net-note">
          ${o.note}
          ${missing ? `${missing} ${missing === 1 ? 'day has' : 'days have'} nothing logged and ${missing === 1 ? 'is' : 'are'} left blank.` : ''}
        </div>
      </div>`;
}

// Signed net folded into the two magnitudes the chart draws.
const netCols = (series) => series.map((d) => ({
  date: d.date, logged: d.logged,
  up: d.net > 0 ? d.net : 0, down: d.net < 0 ? -d.net : 0
}));

function netChart(series) {
  if (!series || !series.length) return '';
  const shown = series.filter((d) => d.logged);
  if (!shown.length) return '';

  const best = shown.reduce((a, d) => (d.net > a.net ? d : a), shown[0]);
  const worst = shown.reduce((a, d) => (d.net < a.net ? d : a), shown[0]);
  const avg = Math.round(shown.reduce((a, d) => a + d.net, 0) / shown.length);

  return barChart(netCols(series), {
    upLabel: 'Deficit',
    downLabel: 'Surplus',
    average: `${avg >= 0 ? '+' : '−'}${Math.abs(avg).toLocaleString('en-US')} kcal a day on average`,
    title: (d) => (!d.logged
      ? `${dayLabel(d.date)} · nothing logged`
      : `${dayLabel(d.date)} · ${(d.up || d.down).toLocaleString('en-US')} kcal ${d.up ? 'deficit' : 'surplus'}`),
    note: netRange(shown, best, worst)
  });
}

/* Hours slept, night by night. One-sided rather than diverging — there is no
   opposing quantity — so it reuses the bar chart with the down half empty and
   the zero line pinned to the floor. */
function sleepChart(nights, avgMins) {
  if (!nights || nights.length < 2) return '';
  const cols = nights.map((n) => ({ date: n.date, up: n.mins, down: 0, logged: true }));
  const best = nights.reduce((a, n) => (n.mins > a.mins ? n : a), nights[0]);
  const worst = nights.reduce((a, n) => (n.mins < a.mins ? n : a), nights[0]);

  return barChart(cols, {
    fmt: briefHours,
    denseAt: [13, 7],
    upLabel: 'Slept',
    downLabel: '',
    average: `${durShort(avgMins)} a night on average`,
    title: (d) => `${dayLabel(d.date)} · ${durShort(d.up)} slept`,
    note: best.mins === worst.mins
      ? `Every night logged came out at ${durShort(best.mins)}.`
      : `Longest was ${esc(dayLabel(best.date))} at ${durShort(best.mins)}; shortest ${esc(dayLabel(worst.date))} at ${durShort(worst.mins)}.`
  });
}

/* Money in against money out, day by day. Same drawing as the calories, and
   deliberately so: the question "which days did more leave than arrive" has the
   same shape as "which days did I eat more than I burned". */
function moneyChart(series) {
  if (!series || !series.length) return '';
  const shown = series.filter((d) => d.logged);
  if (!shown.length) return '';

  const outSum = shown.reduce((a, d) => a + d.down, 0);
  const inSum = shown.reduce((a, d) => a + d.up, 0);
  const heaviest = shown.reduce((a, d) => (d.down > a.down ? d : a), shown[0]);
  const net = inSum - outSum;

  const note = heaviest.down > 0
    ? `Heaviest day was ${esc(dayLabel(heaviest.date))} at ${esc(amount(heaviest.down))} out.
       Across the days with entries that is ${esc(amount(inSum))} in against ${esc(amount(outSum))} out,
       ${net >= 0 ? `leaving ${esc(amount(net))}` : `${esc(amount(-net))} short`}.`
    : `${esc(amount(inSum))} came in over these days and nothing went out.`;

  return barChart(series, {
    fmt: briefCash,
    upLabel: 'In',
    downLabel: 'Out',
    // Rounded: cents on an average across a fortnight are noise pretending to
    // be precision, and they cost the headline four characters it needs.
    average: `${amount(Math.round(outSum / shown.length))} a day out on average`,
    title: (d) => (!d.logged
      ? `${dayLabel(d.date)} · nothing logged`
      : `${dayLabel(d.date)} · ${amount(d.up)} in, ${amount(d.down)} out`),
    note
  });
}

/* Money in and money out as two lines over the window.

   The bar chart in the insights block answers "which day was heavy" — each day
   read on its own against the days beside it. Two lines answer a different
   question: whether what comes in and what goes out are converging, crossing or
   holding apart. Same series, and both are worth having; a bar chart cannot
   show a trend and a line chart cannot show a single day's weight.

   Drawn in a viewBox with no fixed pixel size, so it scales with its column
   rather than needing a breakpoint of its own. */
function moneyLines(series) {
  const pts = (series || []);
  // Two points make a line; one makes a dot that says nothing a tile does not.
  if (pts.length < 2) return '';
  if (!pts.some((d) => d.up || d.down)) return '';

  const W = 560, H = 190, L = 10, R = 10, T = 14, B = 26;
  const top = Math.max(1, ...pts.map((d) => Math.max(d.up, d.down)));
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (val) => T + (1 - val / top) * (H - T - B);
  const line = (key) => pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  const dots = (key, color) => pts.map((d, i) => (d.logged
    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.6" fill="${color}"></circle>` : '')).join('');

  const IN = '#16a394', OUT = '#d92d20';
  const inSum = pts.reduce((a, d) => a + d.up, 0);
  const outSum = pts.reduce((a, d) => a + d.down, 0);

  return `
          <div class="mline">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="mline-svg" role="img"
                 aria-label="Money in and money out for each day in this window">
              <line x1="${L}" y1="${(H - B).toFixed(1)}" x2="${W - R}" y2="${(H - B).toFixed(1)}" class="mline-axis"></line>
              <path d="${line('up')}" fill="none" stroke="${IN}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path>
              <path d="${line('down')}" fill="none" stroke="${OUT}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path>
              ${dots('up', IN)}${dots('down', OUT)}
            </svg>
            <div class="mline-foot">
              <span class="mline-key"><i style="background:${IN};"></i>In · ${esc(amount(inSum))}</span>
              <span class="mline-key"><i style="background:${OUT};"></i>Out · ${esc(amount(outSum))}</span>
              <span class="mline-span">${esc(dayLabel(pts[0].date))} – ${esc(dayLabel(pts[pts.length - 1].date))}</span>
            </div>
          </div>`;
}

/* The shape of the window, between the four totals and the prose. The tiles
   above it say what the fortnight came to; this says which days it came from,
   which is the part a single number cannot carry. Hidden on a one-day window,
   where a chart of one column is just the tile again. */
function cashBlock(v) {
  const chart = v.rangeCash ? moneyChart(v.rangeCash) : '';
  if (!chart) return '';
  return `
          <div class="net-block" style="margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--color-divider);">
            <div style="font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 8px;">In and out, day by day</div>
            ${chart}
          </div>`;
}

/* The night behind the day. Sits with the other readings rather than among the
   four pillars: sleep is not an activity, and a fifth card in a grid built for
   four would say it was. */
function sleepBlock(sleep, scope) {
  // Not this product's subject. See workMode().
  if (workMode()) return '';

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
  return lightbox({
    icon: 'plate',
    tone: 'var(--zg-donate)',
    kicker: 'Before we do this',
    title: 'Send this meal to be estimated?',
    closeAct: 'ai-decline',
    body: `
      <p>To get a closer figure, the text of what you ate is sent to Anthropic's Claude API, which
      returns an estimate. Only the food description goes — not your name, your account, your dates
      or anything else you track.</p>
      <p>Nothing is sent unless you press this button, and the answer is kept on this device so the
      same meal is never sent twice. You can carry on using the built-in estimate instead.</p>`,
    actions: `
      <button class="btn btn-ghost" data-act="ai-decline">No thanks</button>
      <button class="btn btn-primary" data-act="ai-accept">Yes, estimate it</button>`
  });
}

function todayCard(v) {
  // Part of the Insights section, which this product does not have. See
  // insightsHeading().
  if (workMode()) return '';
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
  // Same as the phone's: it only ever scaled the calorie burn. See workMode().
  if (workMode()) return '';
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
  // Part of the Insights section, which this product does not have. See
  // insightsHeading().
  if (workMode()) return '';
  return `
      <div class="blueprint" style="padding: 20px 22px 22px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;">
          <h4 style="margin: 0;">Looking back</h4>
          <!-- The same window the chart above runs on, reachable from down
               here too. "Yesterday" rather than "Day": this section only ever
               counts days that have finished. -->
          <div style="margin-left: auto;">${segRange('lookrange', ['Yesterday'])}</div>
        </div>
        <div style="font-size: 12px; color: var(--color-neutral-600); margin-bottom: 12px;">${esc(v.pastLabel)}</div>
        <div style="font-size: 13.5px; line-height: 1.6;">${esc(v.pastHeadline)}</div>
        ${v.pastBusiest ? `<div style="font-size: 12.5px; line-height: 1.6; color: var(--color-neutral-700); margin-top: 4px;">${esc(v.pastBusiest)}</div>` : ''}
        ${balanceGauges(v.pastFood, v.pastBurn, 'past', v.pastSingleDate)}
        ${v.pastNet ? `
        <div class="net-block">
          <div class="cal-kicker">Net calories, day by day</div>
          ${netChart(v.pastNet)}
        </div>` : ''}
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
          ${workMode()
            ? (teamIsAdmin()
              ? `<button data-act="team-open" style="border:0;background:transparent;padding:6px 4px;font:inherit;font-size:13px;color:var(--color-accent-700);cursor:pointer;">Manage projects +</button>`
              : '')
            : `<button data-act="open-new-cat" style="border:0;background:transparent;padding:6px 4px;font:inherit;font-size:13px;color:var(--color-accent-700);cursor:pointer;">Add a category +</button>`}
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

/* ── the timer ──

   One geometry in two skins. A running timer wears the brand gradient and
   announces itself; an idle one is an ordinary card. Same grid either way, so
   starting and stopping changes the card's colour rather than its shape — a
   layout that reflowed under the cursor at the moment of pressing Start would
   be the worst possible time for it.

   The gradient is the time-to-money sweep the app already owns rather than a
   new one invented for this card. */
function timerCard(v) {
  const on = !!state.timerStart;
  return `
      <div class="timer-card${on ? ' is-live' : ''}">
        <div class="timer-read">
          <div class="timer-kicker">
            ${on ? '<span class="timer-live-dot" aria-hidden="true"></span>' : ''}
            ${on ? 'Tracking now' : 'Real time tracking'}
          </div>
          <div data-clock class="timer-clock">${v.clock}</div>
          ${v.timerSince ? `<div class="timer-since${v.timerStale ? ' is-stale' : ''}">${esc(v.timerSince)}${v.timerStale ? ' · still running — did you forget to stop it?' : ''}</div>` : ''}
        </div>
        <div class="timer-fields">
          <div class="timer-name">
            <input data-k="timer-activity" data-sync="timerActivity" placeholder="What are you doing right now?" value="${esc(state.timerActivity)}"${state.formError.timer ? ' aria-invalid="true"' : ''}>
            <span class="timer-pencil" aria-hidden="true">${nodeIcon('pencil', 16)}</span>
          </div>
          ${fieldError('timer')}
          <!-- A list rather than a wall of chips. An account that has grown its
               own categories ran to two dozen here, which pushed the start
               button off the card and made the drawer below it necessary. -->
          ${pickerField('timer-cat', 'Category', pickCategories().map((c) => c.name), state.timerCategory, '+ New category')}
        </div>
        <button class="timer-btn" data-act="toggle-timer">${on ? 'Stop &amp; save' : 'Start'}</button>
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
          ${pickerField('category', 'Category', pickCategories().map((c) => c.name), state.form.category, '+ New category…')}
          <!-- From and To share a wrapper so they wrap as a pair. Left as
               siblings they split across lines the moment the row runs out of
               width, which reads as two unrelated fields. -->
          <div style="display: flex; gap: 10px; flex: 1 1 246px; min-width: 216px;">
            <div class="field" style="flex: 1 1 0; min-width: 0;"><label>From</label><input class="input" type="time" required data-k="form-from" data-sync="form.from" data-live-dur value="${esc(state.form.from)}"${state.formError.entry && !String(state.form.from || '').trim() ? ' aria-invalid="true"' : ''}></div>
            <div class="field" style="flex: 1 1 0; min-width: 0;"><label>To</label><input class="input" type="time" required data-k="form-to" data-sync="form.to" data-live-dur value="${esc(state.form.to)}"${state.formError.entry && !String(state.form.to || '').trim() ? ' aria-invalid="true"' : ''}></div>
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
  /* The filter narrows the list before the drawer counts it, so "3 more" means
     three more of what you are actually looking at. */
  const shown = logFiltered(v.dayList);
  const visible = state.drawers.activities || shown.length <= ROWS_COLLAPSED
    ? shown
    : shown.slice(0, ROWS_COLLAPSED);
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
                    <select class="entry-select" data-change="entry-category" data-id="${esc(e.id)}" style="${rowChipStyle(tint)}">${options(pickCategories().map((c) => c.name), e.category)}</select>
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

  /* The heading counts what is on screen. Reporting the day's whole total over
     a filtered list would be the one number on the card that does not match
     the rows under it. Summed the same way the day is — through resolveSpans —
     so a filtered total and the day total are the same kind of figure. */
  const count = state.logFilter
    ? (() => {
      const m = effective(resolveSpans(shown));
      return `${dur(shown.reduce((a, e) => a + m(e), 0))} in ${state.logFilter} · `
        + `${shown.length} of ${v.dayList.length} ${v.dayList.length === 1 ? 'entry' : 'entries'}`;
    })()
    : `${v.dayTotalLabel} logged across ${v.dayList.length} entries`;

  const empty = state.logFilter
    ? `Nothing in ${esc(state.logFilter)} on this day.`
    : 'Nothing logged yet — start the timer, or add a row above.';

  return `
      <div class="blueprint card-w-head">
        ${dayNav(v, count)}
        <div class="card-body">
          <div class="entry-list">${rows}</div>
          ${shown.length > ROWS_COLLAPSED ? drawerToggle('activities', shown.length - ROWS_COLLAPSED, 'entries') : ''}
          ${shown.length === 0 ? `<div style="padding: 22px 0 24px; text-align: center; font-size: 13px; color: var(--color-neutral-600);">${empty}</div>` : ''}
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
      <div data-sec="log">
        <div style="margin:0 0 14px;">${searchField({ tools: true, list: v.dayList })}</div>
        <div id="search-body">${String(state.searchQuery || '').trim() ? searchBody() : ''}</div>
        ${String(state.searchQuery || '').trim() ? '' : timeTableCard(v)}
      </div>
      <div data-sec="ins-head">${insightsHeading()}</div>
      <div data-sec="ins-today">${todayCard(v)}</div>
      <div data-sec="ins-past">${pastCard(v)}</div>
      <div data-sec="ins-weight">${weightCard(v)}</div>
    </div>

    <div class="col">

      <div class="blueprint card-w-head" data-sec="chart">
        ${cardHead('Where the time went', '', segRange('range'))}
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
  /* The same three controls the activity tracker carries above its table, in
     the same place and off the same state: search across everything logged,
     narrow the day to one purpose, and get back to today. searchRows() has
     always spanned both trackers, so the search half needed surfacing rather
     than building — money entries were findable, just not from here. */
  const shown = logFiltered(v.mDayList);
  const searching = !!String(state.searchQuery || '').trim();
  const rows = shown.map((e) => `
              <tr>
                <td data-col="activity"><input class="cell-input" data-k="mr-${esc(e.id)}-a" data-change="money-activity" data-id="${esc(e.id)}" value="${esc(e.activity)}"${e.note ? ` title="${esc(e.note)}"` : ''}><button class="cell-note" data-act="note-edit" data-kind="money" data-id="${esc(e.id)}" title="${e.note ? esc(e.note) : 'Add a note for this entry'}"${e.note ? ' data-has-note' : ''}>${e.note ? 'Note' : 'Add note'}</button></td>
                <td data-col="purpose"><select data-change="money-purpose" data-id="${esc(e.id)}" style="${rowChipStyle(purposeColor(e.purpose))}">${options(pickPurposes().map((p) => p.name), e.purpose)}</select></td>
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
          ${pickerField('purpose', 'Purpose', pickPurposes().map((p) => p.name), state.mForm.purpose, '+ New purpose…')}
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

      <div>
        <div style="margin:0 0 14px;">${searchField({ tools: true, list: v.mDayList })}</div>
        <div id="search-body">${searching ? searchBody() : ''}</div>
        ${searching ? '' : `
        <div class="blueprint" style="padding: 18px 22px 8px;">        ${dayNav(v, `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`)}
          <div class="rows-scroll">
          <table class="table rows">
            <thead><tr><th style="width: 34%">Activity</th><th style="width: 26%">Purpose</th><th style="width: 18%; text-align: right;">Received</th><th style="width: 18%; text-align: right;">Spent</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          </div>
          ${shown.length === 0 ? `<div style="padding: 26px 0 30px; text-align: center; font-size: 13px; color: var(--color-neutral-600);">${state.logFilter ? `Nothing in ${esc(state.logFilter)} on this day.` : 'Nothing logged for this day yet.'}</div>` : ''}
        </div>`}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 22px; min-width: 0;">
      <div class="blueprint" style="padding: 20px 22px 24px;">        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap;">
          <h4 style="margin: 0; margin-right: auto;">Where the money went</h4>
          ${segRange('mrange2')}
        </div>
        <div class="chart-row" style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          ${donut(v, 190, 34, 24)}
          <div style="display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0;">${legend(v)}</div>
        </div>
      </div>

      ${v.rangeCash && moneyLines(v.rangeCash) ? `
      <div class="blueprint" style="padding: 20px 22px 20px;">
        <h4 style="margin: 0 0 4px;">Money in and out</h4>
        <div style="font-size: 12px; color: var(--color-neutral-600); margin-bottom: 12px;">Whether the two are converging or holding apart, day by day.</div>
        ${moneyLines(v.rangeCash)}
      </div>` : ''}

      ${insightsHeading()}
      ${insightsCard(v)}

      <div class="blueprint" style="padding: 18px 22px 22px;">        <h4 style="margin: 0 0 14px;">Biggest purposes</h4>
        <div style="display: flex; flex-direction: column; gap: 13px;">${bars(v)}</div>
      </div>
    </div>
  </div>`;
}

/* ─────────────────────────── the report deck ───────────────────────────

   A swipeable run of cards rather than a sheet: on a phone the old report was
   a long scroll of tables nobody read to the end of. Each card is described as
   data — a kicker, a hero figure, a caption, optional ranked rows, a closing
   note — and three renderers read that same description: the deck on screen,
   the print stylesheet that turns it into a PDF, and the canvas that turns one
   card into a shareable image. One description means they cannot drift. */

/* `summary` is the written paragraph — locally phrased, replaced by the AI one
   when it lands. `donut` and `chart` are the two drawn things a card can hold;
   no card holds both. */
const card = (key, o) => Object.assign(
  { key, kicker: '', big: '', title: '', lines: [], rows: [], note: '', chart: null, donut: null,
    summary: '', closing: null, raw: '', effects: null }, o);

const DECK_RAW_SHOWN = 6;

/* ── the raw summary ──
   Every other card in the deck is an aggregate: a share, an average, a total.
   An aggregate is an argument about the day. This is the day — what you were
   doing, when, in the words you used at the time — and it goes first because
   it is the thing the rest is derived from.

   Six rows, then the remainder behind one button. The button toggles a class
   rather than re-rendering: a render rebuilds the deck and would throw the
   reader back to the first card, which is a steep price for a drawer. */
function deckRaw(rows) {
  if (!rows.length) return '';
  const line = (e, extra) => {
    const note = String(e.note || '').trim();
    const tint = colorOf(e.category);
    return `
      <li class="deck-raw-row${extra ? ' is-extra' : ''}" style="--row-tint: ${esc(tint)};">
        <span class="deck-raw-node" aria-hidden="true"></span>
        <div class="deck-raw-body">
          <div class="deck-raw-top">
            <span class="deck-raw-when">${esc(clock12(e.from))}<span class="deck-raw-arrow" aria-hidden="true">→</span>${esc(clock12(e.to))}</span>
            <span class="deck-raw-dur">${esc(durShort(span(e)))}</span>
          </div>
          <div class="deck-raw-said">${esc(e.activity || 'Something')}</div>
          ${note ? `<div class="deck-raw-note">${esc(note)}</div>` : ''}
          ${e.category ? `<span class="deck-raw-cat">${catIcon(e.category)} ${esc(e.category)}</span>` : ''}
        </div>
      </li>`;
  };
  const hidden = Math.max(0, rows.length - DECK_RAW_SHOWN);
  const label = `Show all ${rows.length}`;
  return `
    <div class="deck-raw">
      <ol class="deck-raw-list">${rows.map((e, i) => line(e, i >= DECK_RAW_SHOWN)).join('')}</ol>
      ${hidden ? `<button class="deck-raw-more no-print" data-act="deck-raw-more"
        data-more="${esc(label)}" aria-expanded="false"><span class="deck-raw-label">${esc(label)}</span><span aria-hidden="true">▾</span></button>` : ''}
    </div>`;
}

/* ── written summaries ──

   Two sources, one shape. The locally written versions below are what the cards
   say on their own: offline, signed out, AI switched off at the server, or in
   the second before the request lands. They are not placeholders — they are the
   floor, and a card is never allowed to be blank waiting for prose.

   When the AI summary arrives it replaces them, because it can say things
   arithmetic cannot: what a fortnight of Family Time and Focus Work suggests
   about a person, and what is worth saying to them about it. */
/* Whatever is cached for this window, fresh or not. A summary a few entries
   behind still reads true — the figures on the card around it are computed
   locally and always current — and showing it beats showing nothing while the
   replacement is written. */
const deckSummaries = (v) => {
  const hit = state.deckAi[deckKey(v)];
  return (hit && hit.s) || {};
};

const listOf = (names) => (names.length === 1 ? names[0]
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function localCover(v, days, lit) {
  const bits = [`You logged ${v.rangeTotal} across ${lit} of ${days} ${days === 1 ? 'day' : 'days'}, in ${v.reportEntryCount} ${v.reportEntryCount === 1 ? 'entry' : 'entries'}.`];
  if (v.reportRows[0]) bits.push(`${v.reportRows[0].name} took the largest share at ${v.reportRows[0].pct}.`);
  if (v.streak > 1) bits.push(`You are ${v.streak} days into a tracking streak.`);
  if (lit < days) bits.push(`${days - lit} ${days - lit === 1 ? 'day has' : 'days have'} nothing logged, so the totals describe what you recorded rather than the whole stretch.`);
  return bits.join(' ');
}

/* Deliberately gives no count of its own. The legend above it already says
   exactly how many were folded together, and this sentence used to count
   everything outside the top two — so a card could read "11 other categories"
   directly beneath a row labelled "7 others". Both were true and the pair was
   nonsense. One place states the number now. */
function localDonut(v) {
  const top = v.reportRows.slice(0, 2);
  if (!top.length) return '';
  const rest = v.reportRows.length - top.length;
  return `${listOf(top.map((r) => `${r.name} at ${r.pct}`))} account for the bulk of the window`
    + (rest > 0 ? '; the legend above breaks down the rest.' : '.');
}

function localProfile(v) {
  const three = v.reportRows.slice(0, 3);
  if (!three.length) return '';
  const share = Math.round(three.reduce((a, r) => a + r.mins, 0) / Math.max(1, v.rangeTotalMins) * 100);
  return `${listOf(three.map((r) => r.name))} together take ${share}% of everything you logged. `
    + (share >= 70
      ? 'That is a concentrated window — most of your recorded time went to a handful of things, which is what a stretch with a clear priority looks like.'
      : 'That is a fairly spread window — your recorded time went to a wide range of things rather than one dominant pursuit.');
}

function localPace(v, busyMins, quietest) {
  const gap = Math.max(0, busyMins - quietest.total);
  return `Your busiest logged day came to ${durShort(busyMins)}; your lightest, ${dayLabel(quietest.date)}, came to ${durShort(quietest.total)}. `
    + (gap > 240
      ? 'A wide gap between the two usually says more about which days you remembered to log than about which days were genuinely full.'
      : 'The two ends sit close together, which reads as a steady stretch rather than a lurching one.');
}

function localSleep(v, days) {
  const s = v.rangeSleep;
  const bits = [`${s.nights} of ${days} nights logged, averaging ${durShort(s.avgMins)}.`];
  if (s.nights > 1 && s.drift >= 120) bits.push(`Your bedtime moved by ${durShort(s.drift)} across the window.`);
  else if (s.nights > 1) bits.push('Your bedtime held reasonably steady across the nights you logged.');
  bits.push(s.headline);
  return bits.join(' ');
}

/* Quotes no figures, for the same reason the AI is told not to: the rows above
   carry the arithmetic and are recomputed every render, while a paragraph might
   be the cached one from this morning. Two numbers for the same thing, one of
   them stale, is worse than one number and a sentence explaining it. */
function localEnergy(net) {
  const size = Math.abs(weekWeightKg(net));
  if (size < 0.05) {
    return 'What you ate and what you burned came out close to level. Held at this rate your weight would sit roughly where it is. These are rough estimates from what you logged and your weight, not measurements.';
  }
  const pace = size >= 1 ? 'a brisk pace' : size >= 0.4 ? 'a steady pace' : 'a gentle pace';
  return `You were ${net >= 0 ? 'burning more than you ate' : 'eating more than you burned'} across these days — ${pace} if it held, as the row above works out. `
    + 'That is arithmetic on estimates drawn from what you logged, not a measurement or a promise.';
}

// Worded once, used by the card row and by the figures handed to the model.
function weekWeightLabel(netKcalPerDay) {
  const kg = weekWeightKg(netKcalPerDay);
  const size = Math.abs(kg);
  if (size < 0.05) return 'about level';
  return `~${size.toFixed(2)} kg ${kg >= 0 ? 'lost' : 'gained'}`;
}

/* ── what it may be doing to you ──

   The closing card used to talk about the app: days logged, streak length,
   which category won. All true, and all about the tracking rather than about
   the person doing it — which is the wrong note to finish on when the reason
   anyone logs a day is to find out what the days are doing to them.

   So it names effects, in the four dimensions the app already reads for:
   body, mind, emotions, spirit, plus sleep, which reaches all four. Every
   line is hedged, and hedged honestly rather than decoratively — "tends to",
   "is generally reckoned", "for most people" — because these are population
   tendencies read off a handful of self-logged entries, not a finding about
   this person. The disclaimer directly beneath says the same thing plainly,
   and neither is decoration: this is the one card that could talk someone
   into or out of seeing a doctor.

   A dimension with nothing logged gets a line about the absence of evidence,
   not a line about the absence of the thing. Zimpan cannot tell a week with
   no exercise from a week where nobody wrote it down, and saying otherwise
   would be the most damaging thing on the card. */
const SLEEP_EFFECTS = [
  [0, 360, 'Short nights',
    'Under six hours a night is where most people lose the edges first — attention, appetite signals and patience usually go before anything actually feels wrong, which is what makes it easy to attribute to something else.'],
  [360, 420, 'Just under',
    'Six to seven hours tends to show up as a shorter fuse and a heavier afternoon rather than as feeling tired. The cost is real and rarely gets blamed on the sleep.'],
  [420, 540, 'In the range',
    'Seven to nine hours is where recovery, mood and memory consolidation are generally reckoned to sit. Holding it steadily is worth more than anything else on the cards behind this one.'],
  [540, 9999, 'Long nights',
    'Consistently over nine hours can be honest recovery from hard training or illness. If it is new and nothing explains it, it is the kind of change worth mentioning to a doctor rather than tracking alone.']
];

function sleepEffect(v) {
  const s = v.rangeSleep;
  if (!s || !s.nights) {
    return { label: 'Sleep', value: 'not logged',
      text: 'Nothing logged to read. Sleep is the one input that reaches your body, mood, focus and appetite at once, so it is the most useful thing on this list to start recording.' };
  }
  const band = SLEEP_EFFECTS.find(([lo, hi]) => s.avgMins >= lo && s.avgMins < hi) || SLEEP_EFFECTS[2];
  let text = band[3];
  if (s.nights > 1 && s.drift >= 120) {
    text += ` Your bedtime also moved by ${durShort(s.drift)} across these nights; a body reads a moving bedtime as a moving night, and the first hour is usually the one that pays.`;
  }
  return { label: 'Sleep', value: `${durShort(s.avgMins)}${s.nights > 1 ? ' a night' : ''}`, text };
}

/* Keyed by dimension and by how well fed it is. `none` is deliberately about
   the record rather than about the person. */
const DIMENSION_EFFECTS = {
  physical: {
    none: 'Nothing logged that moves you. That may be a quiet stretch or it may be a gap in the record — Zimpan cannot tell those apart, and the difference matters more here than anywhere else on this card.',
    thin: 'Little logged movement. Low movement is more often felt as flat energy than as inactivity; circulation, sleep quality and mood are usually where it shows before the body does.',
    steady: 'A reasonable amount of movement logged. This is the input that tends to push on sleep, mood and energy together rather than one at a time.',
    strong: 'A strong amount of movement. For most people this is the single cheapest lever on how the rest of the week feels — and the one whose absence is noticed last.'
  },
  mental: {
    none: 'Nothing logged that asked much of your attention. Sustained focus behaves like a trained thing: it fades without use, and it comes back with it.',
    thin: 'Not much logged that asked for concentration. Attention is trainable and it does drift when it is not used, so a thin stretch is worth noticing even when it is a welcome one.',
    steady: 'A steady load of focused work. That is generally the range where attention holds without eating into the reserve sleep is meant to refill.',
    strong: 'A heavy load of focused work. It pays in output and it draws on the same reserve as sleep and mood — long stretches without a real break tend to cost more than they look like they cost.'
  },
  emotional: {
    none: 'No time logged with other people. Connection is among the more consistently supported predictors of how people feel over years rather than days — a thin stretch is nothing, a thin habit is worth catching early.',
    thin: 'Little time logged with other people. It is rarely urgent and it compounds quietly, which is exactly why it loses to whatever is urgent.',
    steady: 'A decent amount of time logged with other people. This is the part of a week that most reliably protects mood, and it seldom feels like maintenance while it is happening.',
    strong: 'A lot of time logged with people. That is generally the most protective single thing in a week, and worth defending when a busier one arrives.'
  },
  spiritual: {
    none: 'Nothing logged that was only for reflection. Even short deliberate quiet is associated with less rumination and a steadier read on what actually mattered in a day.',
    thin: 'A little time given to reflection. Small and regular tends to do more here than long and occasional.',
    steady: 'Regular time set aside for reflection. It tends to change how a stretch is remembered more than how it is spent.',
    strong: 'A lot of room made for reflection. That usually shows up as perspective on the rest of this report rather than as anything on it.'
  }
};

const EFFECT_LABEL = { physical: 'Body', mental: 'Mind', emotional: 'Emotions', spiritual: 'Spirit' };

function deckEffects(v) {
  const out = [sleepEffect(v)];
  (v.rangeReadings || []).forEach((r) => {
    const copy = DIMENSION_EFFECTS[r.key];
    if (!copy) return;
    out.push({
      label: EFFECT_LABEL[r.key] || r.label,
      value: r.total ? durShort(r.total) : 'not logged',
      text: copy[r.status] || copy.none,
      color: METER_COLOR[r.status]
    });
  });
  return out;
}

/* ── the team report's closing card ──

   The personal report ends on what a stretch like this tends to do to a body:
   how it slept, what it ate, whether it moved. A team report knows none of
   that and must not pretend to, so the same card is built from the only thing
   it does know — where the hours went.

   Four readings against the personal report's four, and each one a claim about
   the work rather than about a person. Every figure has already appeared on a
   card behind this one; nothing here is a new measurement. */

/* Which projects are time off. A guess from the name, because that is all a
   project is — but a guess worth making: "did the team stop" is a question the
   hours can answer, and a team that names a project Break Time means it. */
const BREAK_RE = /\b(break|lunch|rest|breather|downtime)\b/i;
const workBreakMins = (rows) => (rows || []).filter((r) => BREAK_RE.test(r.name))
  .reduce((a, r) => a + r.mins, 0);

function workEffects(v) {
  const rows = v.reportRows || [];
  const total = Math.max(1, v.rangeTotalMins);
  const days = Math.max(1, v.rangeDayCount);
  const top = rows[0];
  const focusPct = top ? Math.round((top.mins / total) * 100) : 0;
  const breaks = workBreakMins(rows);
  const perDay = Math.round(breaks / days);
  const graft = rows.filter((r) => !BREAK_RE.test(r.name));
  const lead = graft[0];

  return [{
    label: 'Focus',
    value: top ? `${focusPct}% to ${top.name}` : 'nothing logged',
    color: METER_COLOR[focusPct >= 55 ? 'strong' : focusPct >= 30 ? 'steady' : 'thin'],
    text: !top
      ? 'Nothing was logged against a project in this window, so there is no shape to read yet.'
      : focusPct >= 55
        ? 'Most of the stretch went to one project. Long runs at a single thing are where visible progress on it comes from — and they are also how everything else quietly slips.'
        : focusPct >= 30
          ? 'One project led without taking over. That is usually the shape of a stretch that moved something forward and still answered everything else.'
          : 'The hours spread thin, with nothing taking a clear lead. Sometimes that is the job. When it is not, it is the stretch where a lot got touched and little got finished.'
  }, {
    label: 'Break time',
    value: breaks ? `${durShort(breaks)} · ~${durShort(perDay)} a day` : 'none logged',
    color: METER_COLOR[!breaks ? 'none' : perDay >= 30 ? 'strong' : 'thin'],
    text: !breaks
      ? 'No break was logged in this stretch. It may only be missing from the record — but a run of days with no time off in it is worth checking against how the days actually felt.'
      : perDay >= 30
        ? 'Time off is in the record, and on most days. Breaks are what keeps the back half of a day worth as much as the front, and they only appear in a report when somebody bothers to log them.'
        : 'Some time off is logged, but not much of it. Short days carry that fine. Long ones tend to pay for it in the last hour.'
  }, {
    label: 'Projects in play',
    value: `${graft.length} ${graft.length === 1 ? 'project' : 'projects'}`,
    color: METER_COLOR[graft.length <= 1 ? 'thin' : graft.length <= 4 ? 'strong' : 'steady'],
    text: graft.length <= 1
      ? 'Everything went to one project. Nothing is lost to switching, which is the best case — as long as the other work is genuinely not waiting.'
      : graft.length <= 4
        ? 'A handful of projects, which is about as many as a stretch can hold before the moving between them starts costing more than the work.'
        : 'A lot of projects at once. Every switch has a cost that never appears as an entry, and the more of them there are the more of the day goes to it.'
  }, {
    label: 'Practice',
    value: lead ? `${durShort(lead.mins)} on ${lead.name}` : 'not yet',
    color: METER_COLOR[lead ? 'steady' : 'none'],
    text: lead
      ? 'Hours at one thing are the raw material skill is made from — this is how many went in. Not proof anyone improved, but the only figure a log can honestly offer about it.'
      : 'No hours are on a project yet, so there is nothing here to build on.'
  }];
}

function localWorkClosing(v, days, lit) {
  const bits = ['None of this is a verdict on anyone. It is a reading of where the hours went, set against what was written down.'];
  if (lit < days) {
    bits.push(`Time was logged on ${lit} of ${days} days, so read the gaps as gaps in the record rather than as days off.`);
  }
  const top = v.reportRows[0];
  if (top) bits.push(`Most of it went to ${top.name}, which is worth knowing whether or not that is where it was meant to go.`);
  const breaks = workBreakMins(v.reportRows);
  if (breaks) bits.push(`${durShort(breaks)} of the stretch was logged as time off.`);
  bits.push('The useful question is not whether the totals are high. It is whether this is the stretch the team meant to have — and that can only be asked about one somebody actually looked at.');
  return bits.join(' ');
}

function localClosing(v, days, lit) {
  const bits = [];
  bits.push('None of this is a verdict, and none of it is about you specifically — it is what these patterns tend to do to people, set against what you happened to write down.');
  if (lit < days) {
    bits.push(`You logged on ${lit} of ${days} days, so read the gaps as gaps in the record rather than as empty days.`);
  }
  if (v.reportRows[0]) bits.push(`Most of the time went to ${v.reportRows[0].name}, which is worth knowing whether or not it is where you meant it to go.`);
  bits.push('The useful question is not whether the numbers are good. It is whether the shape of this stretch is one you would choose again — and you can only ask that about a stretch you actually looked at.');
  return bits.join(' ');
}

function timeCards(v) {
  const out = [];
  const top = v.reportRows[0];
  const ai = deckSummaries(v);

  const days = Math.max(1, v.rangeDayCount);
  const lit = v.reportDays.length;
  const quietest = v.quietestDay;

  /* First card, before the totals that are derived from it — but only where
     it can be read in one sitting. A week of entries is not a summary. */
  if (days === 1 && v.rangeRows.length) out.push(card('raw', {
    kicker: 'Raw summary',
    title: 'How the day actually went',
    raw: deckRaw(v.rangeRows),
    note: `${v.rangeRows.length} ${v.rangeRows.length === 1 ? 'entry' : 'entries'}, in the order they happened.`
  }));

  out.push(card('cover', {
    kicker: v.reportRange,
    big: v.rangeTotal,
    title: 'tracked',
    lines: [`${v.reportEntryCount} ${v.reportEntryCount === 1 ? 'entry' : 'entries'} logged`],
    rows: [
      { label: 'Days Streak (actively time tracking)', value: v.streakLabel },
      // Steps are a body's measurement, not a team's. See workMode().
      v.rangeSteps && !workMode() ? { label: 'Steps walked', value: v.rangeSteps.toLocaleString('en-US') } : null
    ].filter(Boolean),
    note: v.reportHeadline,
    summary: ai.cover || localCover(v, days, lit)
  }));

  /* The donut replaces the list it used to sit next to. Every slice carries its
     own share and figure, which is the whole reason the list is gone. */
  if (v.reportRows.length) out.push(card('where', {
    kicker: 'Where the time went',
    donut: { rows: v.reportRows, fmt: durShort, html: deckDonut(v.reportRows, durShort) },
    summary: ai.donut || localDonut(v)
  }));

  if (top) out.push(card('top', {
    kicker: 'Your top three',
    big: top.pct,
    title: `of it went to ${top.name}`,
    rows: v.reportRows.slice(0, 3).map((r) => ({
      label: withIcon(r.name), value: durShort(r.mins), meta: r.pct, color: r.color
    })),
    accent: top.color,
    summary: ai.profile || localProfile(v)
  }));

  if (v.rangeBusiest && v.rangeBusiest.days > 1 && quietest) {
    const busyMins = v.reportDays.reduce((a, d) => Math.max(a, d.total), 0);
    const share = (m) => `${Math.round((m / Math.max(1, v.rangeTotalMins)) * 100)}%`;
    out.push(card('busiest', {
      kicker: 'Full tilt vs easy does it',
      big: v.rangeBusiest.value,
      title: `your busiest day, ${v.rangeBusiest.label}`,
      rows: [
        { label: `Busiest · ${v.rangeBusiest.label}`, value: durShort(busyMins), meta: share(busyMins) },
        { label: `Easy does it · ${dayLabel(quietest.date)}`, value: durShort(quietest.total), meta: share(quietest.total) },
        { label: 'Between the two', value: durShort(Math.max(0, busyMins - quietest.total)) }
      ],
      summary: ai.pace || localPace(v, busyMins, quietest)
    }));
  }

  /* Everything from here to the closing card reads a body: what the hours did
     for it, how it slept, what it ate and burned. A team report measures a
     team's work, and none of this is any of the team's business. See
     workMode(). */
  const fed = workMode() ? [] : v.rangeReadings.filter((r) => r.total > 0);
  if (fed.length) out.push(card('pillars', {
    kicker: 'How it fed you',
    rows: v.rangeReadings.map((r) => ({
      label: r.label, value: r.total ? durShort(r.total) : '—', meta: r.status, color: METER_COLOR[r.status]
    })),
    note: 'Partial credit is deliberate — an hour of chores is not an hour of exercise.'
  }));

  if (v.rangeSleep.nights && !workMode()) {
    const nights = v.rangeSleep.list;
    out.push(card('sleep', {
      kicker: 'How you slept',
      big: durShort(v.rangeSleep.avgMins),
      title: v.rangeSleep.nights > 1 ? 'a night' : 'that night',
      chart: nights.length > 1
        ? { cols: nights.map((n) => ({ date: n.date, up: n.mins, down: 0, logged: true })),
            fmt: briefHours, denseAt: [13, 7], html: sleepChart(nights, v.rangeSleep.avgMins) }
        : null,
      summary: ai.sleep || localSleep(v, days)
    }));
  }

  const b = v.rangeBurn, f = v.rangeFood;
  if ((b.kcal || f.kcal) && !workMode()) {
    const net = Math.round((b.kcal + b.restKcal - f.kcal) / Math.max(1, b.days));
    out.push(card('energy', {
      kicker: 'Energy',
      big: `~${Math.abs(net).toLocaleString('en-US')}`,
      title: `net calories a day · ${net >= 0 ? 'deficit' : 'surplus'}`,
      rows: [
        { label: 'Burned, workout and movement', value: `~${Math.round(b.kcal / Math.max(1, b.days)).toLocaleString('en-US')}` },
        { label: 'Burned at rest', value: `~${Math.round(b.restKcal / Math.max(1, b.days)).toLocaleString('en-US')}` },
        { label: 'Eaten', value: `~${Math.round(f.kcal / Math.max(1, b.days)).toLocaleString('en-US')}` },
        /* On the card rather than in the paragraph. It is the one figure here
           that appears nowhere else, and the paragraph is written once and then
           cached — a projection quoted there would drift out of step with the
           three rows above it. This is recomputed every render. */
        { label: 'If this rate held for a week', value: weekWeightLabel(net) }
      ],
      summary: ai.energy || localEnergy(net)
    }));
  }

  if (v.rangeNet && !workMode()) {
    const shown = v.rangeNet.filter((d) => d.logged);
    if (shown.length > 1) {
      const avg = Math.round(shown.reduce((a, d) => a + d.net, 0) / shown.length);
      out.push(card('netdaily', {
        kicker: 'Net calories, day by day',
        big: `${avg >= 0 ? '+' : '−'}${Math.abs(avg).toLocaleString('en-US')}`,
        title: `a day on average · ${avg >= 0 ? 'deficit' : 'surplus'}`,
        chart: { cols: netCols(v.rangeNet), fmt: briefNum, html: netChart(v.rangeNet) },
        note: `${shown.length} of ${v.rangeNet.length} days carry a reading. Green above the line is a deficit, red below it a surplus.`
      }));
    }
  }

  /* The last card is the one people actually finish on, so it is the one that
     should say something worth finishing on. No figures of its own — every
     number in it has already been shown on a card behind this one. */
  const work = workMode();
  out.push(card('closing', {
    kicker: 'Before you go',
    title: work ? 'What a stretch like this tends to cost' : 'What a stretch like this tends to do',
    /* Rendered from the readings every time, never from the AI cache. This is
       the part of the report that makes claims about a body, and it should say
       what the figures on the cards behind it actually support — not whatever
       was written about a different window an hour ago. */
    effects: work ? workEffects(v) : deckEffects(v),
    summary: work ? localWorkClosing(v, days, lit) : (ai.closing || localClosing(v, days, lit)),
    closing: true
  }));

  return out;
}

function moneyCards(v) {
  const out = [];
  const f = v.moneyInsight;
  const top = v.reportRows[0];

  const days = Math.max(1, v.rangeDayCount);
  const lit = v.reportDays.length;
  const heaviest = v.reportDays.length > 1
    ? v.reportDays.reduce((a, d) => (d.total > a.total ? d : a), v.reportDays[0]) : null;

  out.push(card('cover', {
    kicker: v.reportRange,
    big: v.moneyOut,
    title: 'went out',
    lines: [`${v.reportEntryCount} ${v.reportEntryCount === 1 ? 'entry' : 'entries'} logged`],
    rows: [
      { label: 'Days with an entry', value: `${lit} of ${days}` },
      { label: 'Out on an average day', value: amount(Math.round(v.rangeTotalMins / days)) },
      { label: v.reportRows.length === 1 ? 'Purpose in play' : 'Purposes in play', value: String(v.reportRows.length) },
      heaviest ? { label: `Heaviest day · ${dayLabel(heaviest.date)}`, value: amount(heaviest.total) } : null
    ].filter(Boolean),
    note: v.reportHeadline
  }));

  if (v.reportRows.length) out.push(card('where', {
    kicker: 'Where the money went',
    rows: v.reportRows.slice(0, 6).map((r) => ({ label: withIcon(r.name), value: r.time, meta: r.pct, color: r.color })),
    note: v.reportRows.length > 6
      ? `Top six of ${v.reportRows.length} purposes. The rest are in the day-by-day list behind this deck.`
      : 'Everything you logged, biggest first.'
  }));

  if (top) out.push(card('top', {
    kicker: 'Your headline',
    big: top.pct,
    title: `of it went to ${top.name}`,
    lines: [`${top.time} across ${top.count} ${top.count === 1 ? 'entry' : 'entries'}`],
    rows: [
      { label: 'Average entry', value: amount(Math.round(top.mins / Math.max(1, top.count))) },
      { label: 'On an average day', value: amount(Math.round(top.mins / days)) },
      v.reportRows[1]
        ? { label: `Next biggest · ${v.reportRows[1].name}`, value: v.reportRows[1].time, meta: v.reportRows[1].pct }
        : null
    ].filter(Boolean),
    accent: top.color
  }));

  /* The single biggest thing you paid for. Nothing else on the page says it,
     and it is usually the line people go looking for. */
  const biggest = v.mRangeList
    ? v.mRangeList.filter((e) => Number(e.out) > 0).sort((a, b) => Number(b.out) - Number(a.out))[0]
    : null;
  if (biggest) {
    const home = v.reportRows.find((r) => r.name === biggest.purpose);
    out.push(card('biggest', {
      kicker: 'Biggest single spend',
      big: amount(biggest.out),
      title: biggest.activity,
      lines: [`${withIcon(biggest.purpose)} · ${dayLabel(biggest.date)}`],
      rows: [
        { label: 'Share of everything spent', value: pct(biggest.out / Math.max(1, v.rangeTotalMins)) },
        home ? { label: `All of ${home.name}`, value: home.time, meta: home.pct } : null,
        { label: 'Entries in the window', value: String(v.moneyOutCount) }
      ].filter(Boolean),
      note: 'One purchase is not a pattern — but it is usually the one worth remembering.'
    }));
  }

  out.push(card('inout', {
    kicker: 'In, out, kept',
    rows: [
      { label: 'Money in', value: v.moneyIn },
      { label: 'Money out', value: v.moneyOut },
      { label: 'Net', value: v.moneyNet },
      { label: 'Kept', value: f ? f.rateLabel : '—' }
    ],
    note: v.netNote
  }));

  if (v.rangeCash) {
    const shown = v.rangeCash.filter((d) => d.logged);
    if (shown.length > 1) {
      const outSum = shown.reduce((a, d) => a + d.down, 0);
      out.push(card('cashdaily', {
        kicker: 'In and out, day by day',
        big: amount(Math.round(outSum / shown.length)),
        title: 'a day out, across the days you logged',
        chart: { cols: v.rangeCash, fmt: briefCash, html: moneyChart(v.rangeCash) },
        note: `${shown.length} of ${v.rangeCash.length} days carry an entry. Green above the line came in, red below it went out.`
      }));
    }
  }

  if (f && f.trendLabel) out.push(card('trend', {
    kicker: 'Against the window before',
    big: f.trendLabel,
    title: f.trendUp ? 'more than the previous stretch' : 'less than the previous stretch',
    lines: [f.headline],
    rows: [
      { label: `These ${f.days} days`, value: f.outLabel },
      { label: `The ${f.days} before them`, value: f.prevOutLabel },
      f.essentialLabel && f.discLabel
        ? { label: 'Essential vs discretionary', value: `${f.essentialLabel} · ${f.discLabel}` } : null
    ].filter(Boolean),
    note: f.coverageLabel
  }));

  if (f && f.observations && f.observations.length) out.push(card('stands', {
    kicker: 'What stands out',
    lines: f.observations.slice(0, 4),
    rows: f.advice && f.advice.length ? [] : [
      { label: 'Kept', value: f.rateLabel },
      { label: 'Net', value: f.netLabel }
    ],
    note: f.advice && f.advice.length ? f.advice[0] : ''
  }));

  return out;
}

const deckCards = (v) => (v.isMoney ? moneyCards(v) : timeCards(v));

/* The deck's own windows. "Today" and "Yesterday" are both a single day and
   differ only in which one, so a window is a length plus the day it ends on. */
const DECK_RANGES = [
  ['today', 'Today', 'day', 0],
  ['yesterday', 'Yesterday', 'day', 1],
  ['week', 'Week', 'week', 0],
  ['fortnight', '2 Weeks', 'fortnight', 0],
  ['month', 'Month', 'month', 0],
  ...LONG_RANGES.map(([key, label]) => [key, label, key, 0])
];

/* compute() reads the window off `state`, and the deck needs a different one
   from the page it is covering. Rather than thread a window through every
   derivation, the two fields are swapped for the length of the call and put
   back in a finally — compute only ever reads state, so nothing else notices,
   and the page's own range is untouched by whatever the deck is showing. */
function deckView() {
  const def = DECK_RANGES.find((r) => r[0] === state.deckRange) || DECK_RANGES[2];
  const prevRange = state.range, prevDate = state.selectedDate;
  const end = new Date();
  end.setDate(end.getDate() - def[3]);
  state.range = def[2];
  state.selectedDate = iso(end);
  try { return compute(); } finally { state.range = prevRange; state.selectedDate = prevDate; }
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

/* Says that the paragraph above is about to be replaced.

   Without it the card sits there reading fine, and then rewrites itself half a
   minute later with no warning — which reads as a glitch rather than as the
   better answer arriving. The local summary stays on screen underneath, because
   a card that blanks itself while it waits is worse than one that improves.

   A failure says so in the same place rather than disappearing quietly: the
   text on the card is still true, but "we tried and could not" is worth knowing
   when you were expecting it to change. */
function deckWriting(v) {
  const key = deckKey(v);
  if (state.deckAiBusy === key) {
    return `<div class="deck-writing no-print"><span class="spinner"></span>Writing a closer reading…</div>`;
  }
  if (state.deckAiError && !state.deckAi[key]) {
    return `<div class="deck-writing no-print is-off">${esc(state.deckAiError)} The reading above is the app's own.</div>`;
  }
  return '';
}

/* One wording, two places: the card on screen and the card as an image. Kept
   as a function rather than a constant because whether an AI wrote anything is
   a question about this session, not about the app.

   The AI is named only when an AI actually wrote the summaries. Saying
   "analysed by an AI agent" under prose this app composed itself would be a
   small lie told for flavour, and the whole point of a disclaimer is that it is
   the one part of the page you can rely on. */
function deckDisclaimer() {
  const wrote = state.aiEstimates && Object.keys(state.deckAi).length > 0;
  return 'Every figure in this report comes from what you chose to log, and the readings are estimates rather than measurements.'
    + (wrote ? ' The written sections were composed by an AI agent from those figures.' : '')
    + ' ZIMPAN is not a medical, nutritional or financial adviser — anything you act on, particularly with a health condition or medication involved, is worth putting to a qualified professional first.';
}

/* The tail of the closing card: where the reading came from, and the ask.

   The disclaimer names the AI only when an AI actually wrote the summaries.
   Saying "analysed by an AI agent" under prose this app composed itself would
   be a small lie told for flavour, and the whole point of a disclaimer is that
   it is the one part of the page you can rely on. */
function deckClosing() {
  return `
            <div class="deck-close">
              <p class="deck-disclaimer">${esc(deckDisclaimer())}</p>
              <p class="deck-ask">ZIMPAN is free, has no ads, and sells nothing. If it has been worth something to you, a small gift keeps it being built.</p>
              <a class="btn btn-donate deck-donate no-print" href="${DONATE_URL}" data-donate target="_blank" rel="noopener noreferrer">
                ${NAV_ICONS.donate}<span>Chip in for what comes next</span>
              </a>
            </div>`;
}

/* The deck. One card on screen at a time, snapping horizontally; the print
   stylesheet unrolls the same markup into a page each, followed by the detail
   pages below. */
function reportSheet() {
  if (!state.reportOpen) return '';
  // The deck reads its own window, not the page's.
  const v = deckView();
  const cards = deckCards(v);
  if (!cards.length) return '';

  const slide = (c, i) => `
        <section class="deck-slide" data-slide="${i}" data-key="${esc(c.key)}">
          <div class="deck-card"${c.accent ? ` style="--card-accent: ${esc(c.accent)};"` : ''}>
            <!-- Above the card, not under it. A card that fills its own height
                 pushed the hint off the bottom of a phone, so the one line
                 telling you the deck goes sideways was the one line you never
                 saw. The arrows carry the direction, not the words: "swipe
                 left" beside a right-pointing arrow reads as a contradiction
                 even though both describe the same gesture. -->
            <div class="deck-hint no-print">
              ${i > 0 ? '<span class="deck-hint-arrow">‹</span>' : ''}
              <span>Swipe for more</span>
              ${i < cards.length - 1 ? '<span class="deck-hint-arrow">›</span>' : ''}
            </div>
            <div class="deck-body">
            ${c.kicker ? `<div class="deck-kicker">${esc(c.kicker)}</div>` : ''}
            ${c.big ? `<div class="deck-big">${esc(c.big)}</div>` : ''}
            ${c.title ? `<div class="deck-title">${esc(c.title)}</div>` : ''}
            ${c.lines.length ? `<div class="deck-lines">${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : ''}
            ${c.donut ? c.donut.html : ''}
            ${c.raw || ''}
            ${c.effects ? `
            <div class="deck-effects">
              ${c.effects.map((e) => `
                <div class="deck-effect">
                  <div class="deck-effect-head">
                    ${e.color ? `<span class="deck-dot" style="background: ${esc(e.color)};"></span>` : ''}
                    <span class="deck-effect-label">${esc(e.label)}</span>
                    <span class="deck-effect-value">${esc(e.value)}</span>
                  </div>
                  <p class="deck-effect-text">${esc(e.text)}</p>
                </div>`).join('')}
            </div>` : ''}
            ${c.chart ? `<div class="deck-chart">${c.chart.html}</div>` : ''}
            ${c.rows.length ? `
            <div class="deck-rows">
              ${c.rows.map((r) => `
                <div class="deck-row">
                  ${r.color ? `<span class="deck-dot" style="background: ${esc(r.color)};"></span>` : ''}
                  <span class="deck-row-label">${esc(r.label)}</span>
                  ${r.meta ? `<span class="deck-row-meta">${esc(r.meta)}</span>` : ''}
                  <span class="deck-row-value">${esc(r.value)}</span>
                </div>`).join('')}
            </div>` : ''}
            ${c.note ? `<div class="deck-note deck-note-lead">${esc(c.note)}</div>` : ''}
            ${c.summary ? `<div class="deck-summary">${esc(c.summary)}</div>` : ''}
            ${c.summary ? deckWriting(v) : ''}
            ${c.closing ? deckClosing() : ''}
            </div>
            <div class="deck-mark">ZIMPAN<span>.</span> · ${esc(v.reportRange)}</div>
          </div>
        </section>`;

  return `
      <div class="deck-backdrop" data-report-backdrop>
        <div class="deck-shell">
          <div class="deck-bars no-print">
            ${cards.map((c, i) => `<button class="deck-bar${i === 0 ? ' is-on' : ''}" data-act="deck-go" data-i="${i}" aria-label="Card ${i + 1}"></button>`).join('')}
          </div>

          <button class="deck-x no-print" data-act="close-report" aria-label="Close">×</button>

          <div class="deck-ranges no-print">
            ${DECK_RANGES.map(([key, label]) => `
              <button class="deck-range${key === state.deckRange ? ' is-on' : ''}"
                data-act="deck-range" data-key="${key}" aria-pressed="${key === state.deckRange}">${label}</button>`).join('')}
          </div>

          <div class="deck-track" data-deck-track>
            ${cards.map(slide).join('')}
          </div>

          <button class="deck-arrow deck-prev no-print" data-act="deck-prev" aria-label="Previous">‹</button>
          <button class="deck-arrow deck-next no-print" data-act="deck-next" aria-label="Next">›</button>

          <div class="deck-foot no-print">
            <button class="btn btn-secondary" data-act="share-card">Share this card</button>
            <button class="btn btn-primary" data-act="export-pdf">Download PDF</button>
          </div>
        </div>

        <!-- Screen-hidden, printed last: the evidence behind the cards. -->
        <div class="deck-print">
          <h4>${esc(v.reportTitle)} · ${esc(v.reportRange)}</h4>
          <table class="table">
            <thead><tr><th>${esc(v.reportColLabel)}</th><th style="text-align: right;">Entries</th><th style="text-align: right;">${esc(v.reportAmountLabel)}</th><th style="text-align: right;">Share</th></tr></thead>
            <tbody>
              ${v.reportRows.map((r) => `
                <tr>
                  <td>${esc(withIcon(r.name))}</td>
                  <td style="text-align: right;">${r.count}</td>
                  <td style="text-align: right;">${esc(r.time)}</td>
                  <td style="text-align: right;">${esc(r.pct)}</td>
                </tr>`).join('')}
              <tr>
                <td style="font-weight: 700;">${esc(v.reportFooterRowLabel)}</td>
                <td style="text-align: right;">—</td>
                <td style="text-align: right;">${esc(v.reportFooterRowValue)}</td>
                <td style="text-align: right;">—</td>
              </tr>
            </tbody>
          </table>
          ${reportActivities(v)}
          <div style="margin-top: 22px; font-size: 11px; color: var(--color-neutral-600);">
            Generated by ZIMPAN · ${esc(v.geoLabel)} · ${esc(v.nowLabel)}
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

/* Which phone screen the last paint drew, so the next one can tell whether it
   is a new page or the same one again. See the note in render(). */
let mPaintedScreen = '';

function render() {
  // Bumped so per-render memos (dayFood) know their answers are stale.
  renderSeq += 1;
  /* Read and cleared together: cleared here so every path that paints
     something other than the phone app — the blog, the desktop layout, the
     splash — leaves nothing behind, and coming back to the phone counts as
     arriving rather than as staying. Only the phone branch below sets it. */
  const lastScreen = mPaintedScreen;
  mPaintedScreen = '';
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
  /* Ahead of the splash, which every other screen waits behind.

     The splash is there because nothing else on this site means anything until
     the session is known — whose entries, whose team. A blog post is the one
     page where that is not true: it is the same article for everybody, and a
     reader arriving from a search result should get it immediately rather than
     watching a spinner while /api/me decides they are a stranger. The sign-in
     panel still opens over it. */
  if (state.route === 'blogs') {
    const panel = state.authOpen || state.authMode === 'reset';
    root.innerHTML = (state.blogSlug ? blogPostPage() : blogIndex())
      + (panel ? authScreen() : '') + legalSheet() + helpDialog() + closeAccountDialog();
    if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    restoreFocus(f);
    if (panel) mountGoogleButton();
    return;
  }

  if (!state.booted && !state.account) { root.innerHTML = splashScreen(); return; }

  /* Ahead of the session gate on purpose. /teams is a page about a product,
     not a view of anyone's data — it should read the same whether you are
     signed in, signed out, or still waiting to find out which. The sign-in
     panel still opens over it, because every button on it eventually needs an
     account. */
  /* Nothing on screen can reach the money tracker in work mode, but a state
     saved before the account joined a team could arrive already on it. Put
     back rather than drawn. */
  /* A work account that has not built its team yet has exactly one thing to
     do, and nothing behind the sheet means anything until it is done. Raised
     once a session: dismissing it leaves the app alone, and the way back in is
     where it always is. */
  /* Not while an invitation is still being redeemed. They are seconds away
     from being on a team, and asking them to start one in the meantime is the
     confusion this whole path exists to avoid. */
  if (workMode() && state.team && !state.team.team && !pendingInviteToken()) {
    state.teamOpen = true;
    state.teamTab = 'people';
  }

  if (workMode() && state.app === 'money') state.app = 'time';
  if (workMode() && state.m.kind === 'money') state.m.kind = 'time';
  /* And the same for a category held from before. Filtering the picker stops
     a personal category being chosen; it does nothing about one already
     selected — the timer and the form each keep their own, and either could
     have been sitting on "Chores" since before the account joined a team.
     Left alone, the very next hour logged would go somewhere personal, which
     is the one thing this mode exists to prevent. */
  if (workMode()) {
    const live = pickCategories();
    if (live.length) {
      const ok = (n) => live.some((c) => c.name === n);
      if (!ok(state.timerCategory)) state.timerCategory = live[0].name;
      if (!ok(state.form.category)) state.form = Object.assign({}, state.form, { category: live[0].name });
      if (state.m.cat && !ok(state.m.cat)) state.m.cat = null;
    }
  }

  if (state.route === 'teams') {
    const teamPanel = state.authOpen || state.authMode === 'reset';
    root.innerHTML = teamsScreen() + (teamPanel ? authScreen() : '') + legalSheet() + helpDialog() + closeAccountDialog();
    if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    restoreFocus(f);
    if (teamPanel) mountGoogleButton();
    return;
  }

  if (state.booted && !state.auth) {
    // A reset link has to open its panel directly; there is no landing page
    // journey that leads to it.
    const panelOpen = state.authOpen || state.authMode === 'reset';
    root.innerHTML = (mobileOn() ? mSignin() : landingScreen()) + (panelOpen ? authScreen() : '') + legalSheet() + helpDialog() + closeAccountDialog();
    if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    restoreFocus(f);
    if (panelOpen) mountGoogleButton();
    return;
  }
  if (state.migrateOffer) { root.innerHTML = migrateScreen(); return; }

  /* The phone runs the logging flow instead of the reading layout — same rows
     underneath, a different question being asked of them. "Full view" in the
     account sheet sends it back here, and the desktop is never touched. */
  if (mobileOn()) {
    if (!mBooted) { mBoot(); mBooted = true; }
    /* Setup answers "has this account been through it", and a pull that lands
       after boot can answer it better than the boot did — so it is asked again
       here rather than only once. */
    if (state.m.screen === 'setup' && hasLocalData()) {
      state.setupDone = true;
      state.m.screen = 'home';
    }
    /* The draft as it was handed over, taken once per flow: every opener fills
       the draft in and then renders, so this is the first moment the whole of
       it is there to photograph. See mFlowDirty(). */
    if (state.m.screen === 'flow' && !state.m.mark) state.m.mark = mDraftSig();
    root.innerHTML = `<div id="zimpan-progress" class="topbar" style="display:none"><i></i></div>${mobileApp()}${legalSheet()}${helpDialog()}${closeAccountDialog()}`;
    /* A new screen begins at its own beginning.

       Every render puts the scroll position back, which is right for a render
       nobody asked for — a sync landing, a timer ticking — and wrong for a
       render that changed the page underneath it. Reading to the bottom of
       Home and tapping Insights left you at the bottom of Insights, looking at
       a footer and having to scroll up to find out where you were.

       Decided here rather than in the actions that navigate, because there are
       a dozen of them — the tab bar, the log flow, an entry, gap review, the
       way back from each — and one of them would eventually be written without
       it. The rule is about screens, so it lives where screens are painted. */
    const movedScreen = state.m.screen !== lastScreen;
    mPaintedScreen = state.m.screen;
    if (movedScreen) window.scrollTo(0, 0);
    else if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    restoreFocus(f);
    paintBusy();
    if (state.focusField) {
      const want = root.querySelector(`[data-k="${state.focusField}"]`);
      state.focusField = null;
      if (want) want.focus();
    }
    /* The picker's query lives outside the template, so any render that is not
       about the picker — a sync landing, a timer ticking — would put the full
       list back under a search box still reading "chor". The full layout has
       always done this; the phone returned before reaching it, so a background
       sync could wipe what you were typing mid-search. */
    const search = root.querySelector('[data-pick-search]');
    if (search) { search.value = state.pickQuery; filterPicker(search); }
    // The tree was just replaced, so the scroll-driven button has to be told.
    mPaintTop();
    mPaintBars();
    paintDeck();
    paintChatLog();
    paintTodo();
    paintPlan();
    paintTeamDrawer();
    teamLiveWatch();
    return;
  }

  const v = compute();
  const body = v.isMoney ? moneyDesktop(v) : timeDesktop(v);

  // data-app re-points the accent custom properties; see the theme block in index.html.
  root.innerHTML = `
<div id="zimpan-progress" class="topbar" style="display:none"><i></i></div>
<div data-app="${state.app}" style="min-height: 100vh; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); padding-bottom: ${isPhone() ? 'calc(96px + env(safe-area-inset-bottom, 0px))' : '48px'};">
  ${header(v)}
  ${stickyBar(v)}
  ${syncErrorBanner()}
  ${body}
  <div class="no-print" style="padding: 26px 28px 10px; display: flex; align-items: center; gap: 10px 18px; flex-wrap: wrap;">
    ${legalLinks('var(--color-neutral-600)')}
    <button class="btn btn-ghost" data-act="team-open" style="font-size:12.5px;padding:6px 0;">${state.team && state.team.team ? esc(state.team.team.name) : 'For teams'}</button>
    <button class="btn btn-ghost" data-act="prefs-open" style="font-size:12.5px;padding:6px 0;">Preferences</button>
    ${isPhone() && state.mClassic ? `<button class="btn btn-secondary" data-act="m-mobile" style="font-size: 12.5px; padding: 6px 14px;">Back to the mobile app</button>` : ''}
  </div>
  ${focusPanel(v)}
  ${pillarSheet(v)}
  ${stepsSheet()}
  ${state.reportOpen ? reportSheet() : ''}
  ${pickDeleteDialog()}
  ${notePromptDialog()}
  ${mealNoteDialog()}
  ${refineAskDialog()}
  ${chatDialog()}
  ${chatConsentDialog()}
  ${recapDialog()}
  ${prefsDialog()}
  ${teamSheet()}
  ${crossKindDialog()}
  ${calBreakdownDialog()}
  ${deductDialog()}
  ${donateSheet()}
  ${aiConsentDialog()}
  ${legalSheet()}
  ${helpDialog()}
  ${closeAccountDialog()}
  ${backToTop()}
  ${todoSheet()}
  ${planSheet()}
  ${todoWhyDialog()}
  ${mobileNav(v)}
</div>`;

  /* Before focus: restoring focus to a field can itself scroll the page, and
     that scroll is the one worth keeping. */
  if (scrollY && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  restoreFocus(f);
  paintBusy();
  // The tree was just replaced, so the scroll-driven classes have to be put back.
  paintScrollChrome();
  paintChatLog();
  paintTodo();
  paintPlan();
  paintTeamDrawer();
  teamLiveWatch();
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

  /* The picker's query lives outside the template, so a render triggered by
     something else — a sync landing, a timer stopping — would otherwise put
     the full list back under a search box that still reads "ver". */
  const search = root.querySelector('[data-pick-search]');
  if (search) { search.value = state.pickQuery; filterPicker(search); }
  if (pickJustOpened) { pickJustOpened = false; showPicker(); }
  paintDeck();
}

/* A panel that opens below the fold is a list you cannot see. Only the amount
   that is actually off-screen is scrolled away, so the field stays where the
   finger left it whenever there was already room. */
function showPicker() {
  const pop = root.querySelector('.pick-pop');
  if (!pop) return;
  /* The phone's bottom nav is fixed over the page, so the last rows of a panel
     scrolled to the viewport edge sit underneath it — visible space ends where
     the nav starts, not where the window does. */
  const nav = root.querySelector('.bottomnav');
  const floor = nav && getComputedStyle(nav).display !== 'none'
    ? nav.getBoundingClientRect().top : window.innerHeight;
  const gap = pop.getBoundingClientRect().bottom + 12 - floor;
  if (gap > 0) {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: gap, behavior: smooth ? 'smooth' : 'auto' });
  }
}

/* ── account actions ── */

/* Signed in successfully, but to the other product.

   Signing in is not refused — the account is theirs and it works — but landing
   in the personal app when you came from the pricing page, or in a work
   account when you came from the home page, is confusing enough to be worth a
   sentence. It says which account this is and what the other one would need,
   which is a different address; there is no switch to offer, because the two
   cannot be the same account. */
function noteWrongProduct(user) {
  const is = (user && user.kind) === 'work' ? 'work' : 'personal';
  const wanted = state.authFor === 'work' ? 'work' : 'personal';
  state.crossKind = is === wanted ? '' : is;
}

/* Where a successful sign-in leaves you.

   Two things that were only ever true by accident on the personal page. The
   panel was never closed on success — it just stopped being drawn, because
   render() skips the whole signed-out branch once there is a session. And the
   route was always 'home', so there was nothing to move.

   Neither holds on /teams. That page is drawn ahead of the session gate on
   purpose, so a product page reads the same signed in or out — which meant
   signing in there left you on the pricing page with the panel still open,
   looking for all the world like nothing had happened. Signing in is a request
   to go and use the thing, so this takes you there, and the address follows so
   Back does not bounce you into a page you have already left. */
function landAfterSignIn(user) {
  noteWrongProduct(user);
  state.authOpen = false;
  state.authError = '';
  state.authNotice = '';
  if (state.route !== 'home') {
    state.route = 'home';
    try { history.replaceState({ route: 'home' }, '', '/'); } catch (e) { /* file:// */ }
  }
}

function crossKindDialog() {
  if (!state.crossKind) return '';
  const isWork = state.crossKind === 'work';
  return lightbox({
    icon: isWork ? 'shield' : 'heart',
    tone: isWork ? 'var(--color-accent)' : 'var(--zg-donate)',
    kicker: isWork ? 'Zimpan for Teams' : 'Your personal Zimpan',
    title: isWork ? 'This is your team account' : 'This is your personal account',
    closeAct: 'cross-kind-close',
    body: `
      <p>${isWork
        ? 'You came in from the personal side, but this email belongs to a Zimpan for Teams account — hours against projects, and nothing about what you eat, spend or sleep.'
        : 'You came in from the team side, but this email belongs to a personal Zimpan — your own time, money, meals and sleep.'}</p>
      <p>${isWork
        ? 'A personal Zimpan has to be its own account, so it needs a different email address.'
        : 'A team account has to be its own, so it needs a different email address. Nothing here is part of a team.'}</p>`,
    actions: `<button class="btn btn-primary" data-act="cross-kind-close">Carry on</button>`,
    foot: 'One address, one product. It is what keeps a team out of your own diary.'
  });
}

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
      ? await API.register(email, password, state.authFor === 'work' ? 'work' : 'personal')
      : await API.login(email, password);
    state.authBusy = false;
    state.authPassword = '';
    state.auth = res.user;
    landAfterSignIn(res.user);
    /* Before afterSignIn rather than after it. A work account with no team yet
       has exactly one thing to do, and the sheet that says so is raised by
       render() — which afterSignIn calls. Until now only boot() loaded this,
       so a team account that had just signed up saw the app with nothing to
       log against and no prompt, and the offer only arrived on a reload. */
    await loadTeam();
    /* Before afterSignIn, because afterSignIn renders — and a render with an
       unredeemed invitation is the "Start a team" sheet in the face of
       somebody who was invited to one. */
    if (pendingInviteToken()) await acceptPendingInvite();
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
  /* Which product they were in, read before the session is dropped — after it,
     workMode() has nothing left to answer with. Signing out of a team account
     onto the personal landing page reads as being handed the wrong app, and
     the way back in is a Log In button that belongs to the other one. */
  const wasWork = workMode();
  // Anything still queued would be stranded — flush it before dropping the session.
  if (pendingCount()) { try { await syncNow(); } catch (e) { /* keep it locally */ } }
  try { await API.logout(); } catch (e) { /* the local session goes either way */ }
  // Without this Google silently signs them straight back in on the next visit.
  try { if (window.google) window.google.accounts.id.disableAutoSelect(); } catch (e) { /* not loaded */ }
  if (wasWork) {
    state.route = 'teams';
    state.blogSlug = '';
    try { history.pushState({ route: 'teams' }, '', '/teams'); } catch (e) { /* file:// */ }
  }
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
  /* Copied at every level on the way down rather than written through, so
     anything comparing object identity sees the change. The depth is walked
     instead of assumed to be two: the flow's typed times sit three deep, and
     the old version wrote the string over their container. */
  const at = (obj, i) => (i === parts.length - 1
    ? Object.assign({}, obj, { [parts[i]]: value })
    : Object.assign({}, obj, { [parts[i]]: at((obj || {})[parts[i]], i + 1) }));
  state[parts[0]] = at(state[parts[0]], 1);
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

/* A time field that has been emptied rather than changed. See the note on the
   entry-from/entry-to handlers. */
function editEntryTime(el, key) {
  if (!String(el.value || '').trim()) { scheduleRender(); return; }
  updateEntry(el.dataset.id, { [key]: parseHm(el.value) });
}

function updateEntry(id, patch) {
  /* A row moved to another category moves to that category's project, and off
     a project entirely if the new category is not one — which is how a member
     takes something back out of the team's sight. */
  state.entries = state.entries.map((e) => (e.id === id
    ? touch('entries', reproject(Object.assign({}, e, patch)))
    : e));
  save(); queueSync(); scheduleRender();
}
function updateMoney(id, patch) {
  state.money = state.money.map((e) => (e.id === id ? touch('money', Object.assign({}, e, patch)) : e));
  save(); queueSync(); scheduleRender();
}
function addCategoryIfNeeded(name) {
  /* A member cannot mint a category to file something personal under, and an
     admin's new one is a project, made in the team sheet where the rest of the
     team will see it. */
  if (workMode()) return;
  if (!name || state.categories.some((c) => c.name === name)) return;
  state.categories = state.categories.concat([touch('categories', {
    name, color: PALETTE[state.categories.length % PALETTE.length], position: state.categories.length
  })]);
}
// The same for the money side, which had no equivalent because purposes could
// only ever be named from their own panel.
function addPurposeIfNeeded(name) {
  if (!name || state.purposes.some((p) => p.name === name)) return;
  state.purposes = state.purposes.concat([touch('purposes', {
    name, color: MONEY_PALETTE[state.purposes.length % MONEY_PALETTE.length], position: state.purposes.length
  })]);
}

/* Debounced for the same reason the timer's field is, and it queues the push
   as well: a note is worth carrying to the other device, but not once per
   letter. */
let todoSaveTimer = null;
function queueTodoSave() {
  clearTimeout(todoSaveTimer);
  todoSaveTimer = setTimeout(() => { save(); queueSync(0); }, 500);
}

/* Notes made and left blank are swept when the pad closes. Pressing New note
   and thinking better of it should leave nothing behind — an empty card that
   comes back every time the pad opens is litter, and it would sync as a row. */
function todoTidy() {
  const empty = state.todos.filter((t) => !String(t.text || '').trim());
  if (!empty.length) return;
  state.todos = state.todos.filter((t) => String(t.text || '').trim());
  empty.forEach((t) => bury('todos', t.id));
  save(); queueSync(0);
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
    /* The live timer is synced state, so starting it is news for the other
       devices — the mobile layout already stamps and queues here, and the
       desktop was silently not, which is why a timer started on the laptop
       never appeared on the phone. */
    state.timerStart = Date.now();
    state.timerUpdatedAt = Date.now();
    state.dirty.timer = true;
    save(); queueSync(0); render(); return;
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
  state.entries = state.entries.concat([touch('entries', withProject(entry))]);
  state.timerStart = null;
  state.timerActivity = '';
  state.timerUpdatedAt = Date.now();
  state.dirty.timer = true;
  state.selectedDate = entry.date;
  // Stopping a timer is the natural moment to ask what it was — same rule as a
  // manual entry, including the "skipped this session" suppression.
  askFollowUp('entries', entry);
  save(); queueSync(0); render();
  if (!state.notePrompt) flash(`Saved · ${entry.activity}`);
}

function addEntry() {
  const from = String(state.form.from || '').trim();
  const to = String(state.form.to || '').trim();
  /* Both refusals used to be a silent `return`, which looked like the button
     was broken rather than like the form was incomplete. */
  if (!state.form.activity.trim()) {
    state.formError.entry = 'Activity is required — name what you did.';
    state.focusField = 'form-activity';
    render();
    return;
  }
  /* An empty time is not a time. parseHm reads a blank field as 0, which is
     midnight, so a missing To turned "washed the car at 9am" into fifteen
     hours ending at midnight and dated the following day — saved without a
     word, because a to-before-from is exactly how an overnight entry is
     written. Both are required, and the caret goes to whichever is missing. */
  if (!from || !to) {
    state.formError.entry = !from && !to
      ? 'From and To are required — say when it started and when it ended.'
      : !from
        ? 'From is required — say when it started.'
        : 'To is required — say when it ended.';
    state.focusField = !from ? 'form-from' : 'form-to';
    render();
    return;
  }
  const f = parseHm(from), t = parseHm(to);
  if (t === f) {
    state.formError.entry = 'From and To are the same time.';
    render();
    return;
  }
  state.formError.entry = '';
  /* To earlier than From means it ran past midnight, the same as the timer —
     and it lands on the morning it ended, not the evening it began. */
  const date = t < f ? nextDay(state.form.date) : state.form.date;
  const entry = touch('entries', withProject({ id: 'm' + Date.now(), date, activity: state.form.activity.trim(), category: state.form.category, from: f, to: t, note: '' }));
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
  // The note prompt has the floor if it wants it; the balance question waits
  // rather than stacking a second panel over the first.
  const asked = !state.notePrompt && askDeduct(row);
  save(); queueSync(0); render();
  if (!state.notePrompt && !asked) flash(`Added · ${row.activity}`);
}

/* What the panel says, in both layouts. The question first, then the answer —
   the panel does not close on being answered, because the answer is the part
   worth reading. */
function deductRow() {
  const ask = state.deductAsk;
  return ask ? state.money.find((r) => r.id === ask.id) || null : null;
}

function deductStatus() {
  return moneyStatus(moneyAll());
}

function deductCopy() {
  const row = deductRow();
  // The subject line is the same on both screens: the spend that raised the
  // question is the spend the answer is about, and repeating it is what ties
  // the second screen to the first.
  const spend = row ? amount(Number(row.out) || 0) : '';
  const sub = `${spend} has been logged.`;
  if (!state.deductAsk || !state.deductAsk.done) {
    return { title: 'Deduct this amount from Money In?', sub, spend };
  }
  const st = deductStatus();
  return {
    title: st.tone === 'over' ? 'You are past what came in' : st.tone === 'none' ? 'Nothing in to take it from' : 'Where that leaves you',
    sub, spend, st,
    // Named so the figures cannot be mistaken for the window on screen behind them.
    window: 'everything you have logged'
  };
}

/* Raised after a spend is saved. Nothing is asked for money coming in — there
   is nothing to take it off — and nothing is asked once the answer is standing,
   which is the whole point of the checkbox.

   A "no" is written onto the row rather than remembered separately: it is a
   fact about that spend, it has to survive a reload and reach the other device,
   and a preference that lived apart from the rows would quietly change old
   figures every time it was toggled. */
function askDeduct(row) {
  if (!row || mCents(row.out) <= 0) return false;
  if (state.deductAlways === false) markOffBudget(row.id, true);
  if (state.deductAlways !== null) return false;
  state.deductRemember = false;
  state.deductAsk = { id: row.id, done: false };
  return true;
}

function deductAnswer(take) {
  const ask = state.deductAsk;
  if (!ask) return;
  markOffBudget(ask.id, !take);
  if (state.deductRemember) state.deductAlways = take;
  state.deductAsk = { id: ask.id, done: true };
  state.deductRemember = false;
  save(); queueSync(0); render();
}

function markOffBudget(id, off) {
  state.money = state.money.map((r) => (r.id === id
    ? touch('money', Object.assign({}, r, { offBudget: off ? true : undefined }))
    : r));
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

/* ── being asked, rather than told ──

   Refining used to happen silently for anyone who had consented, with a button
   in the insights block for everyone else. Two ways in for one thing, and the
   quiet one gave no sign it had run.

   Now it asks, once, when the note that makes it worth asking has been
   written — and only for the two kinds of entry an estimate can say anything
   useful about. "Every time" is offered because this is a question that would
   otherwise arrive after every meal, which is the same reason the money-out
   question carries one.

   Nothing is spent twice: a day whose text is already in the cache never
   raises the ask at all. */
function askRefine(id) {
  if (!state.aiEstimates) return false;
  const row = state.entries.find((r) => r.id === id);
  if (!row) return false;
  const q = matchFollowUp(row);
  const kind = q && (q.key === 'food' || q.key === 'workout') ? q.key : null;
  if (!kind) return false;

  /* Each kind is gated on its own cache. Built fresh for food, never off the
     per-render memo: updateEntry defers its repaint through scheduleRender, so
     at this moment the memo still describes the day as it was before the note
     landed — asking from it spent a request on the old text and filed the
     answer under the old key. */
  if (kind === 'food') {
    const day = buildDayFood(row.date);
    if (!day || !day.detail || state.aiCache[day.key]) return false;
  } else {
    const k = burnKeyOf(row);
    if (!k || state.aiCache[k]) return false;
  }

  // A standing answer settles it without a dialog, either way.
  if (state.refineAlways === false) return false;
  if (state.refineAlways === true) { runRefine(kind, row); return false; }

  state.refineRemember = false;
  state.refineAsk = { id, date: row.date, kind, activity: row.activity || '' };
  return true;
}

function refineAnswer(yes) {
  const ask = state.refineAsk;
  if (!ask) return;
  if (state.refineRemember) state.refineAlways = yes;
  state.refineAsk = null;
  state.refineRemember = false;
  save();
  if (!yes) { render(); return; }
  // Consent is a separate question and still has to be asked first.
  if (!state.aiConsent) { state.aiAsking = 'auto'; state.aiPending = ask; render(); return; }
  runRefine(ask.kind, state.entries.find((r) => r.id === ask.id) || { date: ask.date });
}

// One door to both estimators, so every caller picks the right one by the
// kind of entry rather than by remembering which function to call.
function runRefine(kind, row) {
  if (!row) return;
  if (kind === 'workout') refineBurn(row.id);
  else refineDay(row.date);
}

function refineAskDialog() {
  const a = state.refineAsk;
  if (!a) return '';
  const food = a.kind === 'food';
  return lightbox({
    icon: food ? 'plate' : 'flame',
    tone: food ? 'var(--zg-donate)' : 'var(--zg-strong)',
    kicker: a.activity ? a.activity : (food ? 'Meal logged' : 'Workout logged'),
    title: food ? 'Get a closer calorie estimate?' : 'Get a closer estimate of that effort?',
    closeAct: 'refine-no',
    body: `
      <p>${food
        ? 'The built-in reading prices what you wrote against a table of typical servings. Claude reads the same words and usually gets nearer — brands, portions and dishes it can name.'
        : 'The built-in reading prices the activity and how long it ran. Claude reads what you wrote about it and usually gets nearer.'}</p>
      <button class="dq-switch" data-act="refine-remember" role="switch" aria-checked="${state.refineRemember}"
        style="margin:14px 0 0;">
        <span class="dq-track"><span class="dq-knob"></span></span>
        <span>Do this every time — stop asking</span>
      </button>`,
    actions: `
      <button class="btn btn-secondary" data-act="refine-no">Not now</button>
      <button class="btn btn-primary" data-act="refine-yes">Yes, calibrate it</button>`
  });
}

/* ═════════════════════════════ teams ═════════════════════════════

   A team login is separate from a personal one, so everything here is about
   hours and projects and nothing else. The server decides what may be seen and
   by whom; this half draws what it is given and asks for what it is allowed to
   ask for. Where a control is hidden by role it is hidden because showing a
   button that will be refused is a worse answer than not offering it — the
   refusal still happens server-side either way. */

const teamRole = () => (state.team && state.team.me ? state.team.me.role : null);
const teamIsAdmin = () => teamRole() === 'super' || teamRole() === 'admin';
const teamIsSuper = () => teamRole() === 'super';
const teamProjects = () => (state.team && state.team.projects) || [];
const projectName = (id) => {
  const p = teamProjects().find((x) => x.id === id);
  return p ? p.name : '';
};

/* Read once the session is known. A failure is not worth a banner: an account
   with no team is the ordinary case and looks exactly the same from here. */
/* Fetches whichever of the two blog pages the address is on.

   Both are public, so neither waits for a session and neither is retried on a
   401 — a reader who has never signed in is the normal case here, which is not
   true of anything else this file fetches. */
async function loadBlog() {
  const slug = state.blogSlug || '';
  state.blogBusy = true;
  state.blogError = '';
  render();
  try {
    if (slug) {
      state.blogPost = await API.blog.read(slug);
    } else {
      state.blogList = await API.blog.list();
    }
  } catch (err) {
    /* A 404 is not an error to apologise for — it is a wrong address, and the
       page says so in its own words. Anything else is worth naming, because
       "no posts yet" and "the server did not answer" look identical on screen
       and send the reader to do different things about it. */
    if (slug) state.blogPost = false;
    else state.blogList = false;
    if (err.status !== 404) state.blogError = err.message || 'Could not reach the blog.';
  }
  state.blogBusy = false;
  render();
}

async function loadTeam() {
  if (!state.auth) { state.team = null; return; }
  try {
    state.team = await API.team.get();
    mirrorProjects();
  } catch (err) {
    state.team = { team: null };
  }
}

/* The team's projects, made into this account's categories.

   A work login's categories are its projects — that is what the account is
   for — so rather than building a second picker, a second colour scheme and a
   second set of filters beside the ones that already work, the projects are
   put where the app already looks for things to log against. Everything
   downstream — the picker, the timer, the reports, the search — then works on
   them with no further change.

   One direction only. A project appearing gets a category; a category the
   member adds themselves is theirs and is not sent back as a project, because
   projects are the admin's to define. */
function mirrorProjects() {
  const live = teamProjects().filter((p) => !p.archived);
  if (!live.length) return;
  let added = 0;
  live.forEach((p, i) => {
    if (state.categories.some((c) => c.name === p.name)) return;
    state.categories = state.categories.concat([touch('categories', {
      name: p.name, color: p.color || PALETTE[i % PALETTE.length], position: state.categories.length + i
    })]);
    added += 1;
  });
  if (added) { save(); queueSync(0); }
}

/* Which project an entry belongs to, from the category it was filed under.
   Nothing when the name is not a project's — a member logging "Lunch" on a
   work account has logged something personal, and personal is exactly what an
   admin cannot see. */
function projectIdFor(categoryName) {
  const p = teamProjects().find((x) => !x.archived && x.name === categoryName);
  return p ? p.id : undefined;
}

/* Stamped at the moment an entry is minted, on both routes into one. */
function withProject(entry) {
  const id = projectIdFor(entry.category);
  return id ? Object.assign({}, entry, { project: id }) : entry;
}

/* Same, for a row that already exists. Distinct from withProject because this
   one has to be able to take a project OFF: withProject leaves an entry alone
   when no project matches, which is right when minting and wrong when the
   category has just been changed to something that is not a project. */
function reproject(entry) {
  const id = projectIdFor(entry.category);
  const out = Object.assign({}, entry);
  if (id) out.project = id; else delete out.project;
  return out;
}

/* Every team call goes through this: one place that shows it is working, keeps
   the error where the screen can say it, and reloads the roster afterwards so
   what is on screen is what the server actually holds rather than what the
   client hoped it would do. */
async function teamDo(what, fn, notice) {
  state.teamBusy = what;
  state.teamError = '';
  state.teamNotice = '';
  render();
  try {
    const out = await fn();
    await loadTeam();
    if (notice) state.teamNotice = notice;
    return out;
  } catch (err) {
    state.teamError = err.message || 'That did not work.';
    return null;
  } finally {
    state.teamBusy = '';
    render();
  }
}

/* An invitation arrives as ?invite=… on /teams. Held until there is an account
   to attach it to — accepting needs a signed-in session, and the address on
   the invitation has to be the address on the account. */
/* Read once, at load, and held here rather than re-read from the address.

   landAfterSignIn replaces the URL with "/" the moment a sign-in succeeds,
   which took the token with it: an invitee who followed their link, signed up
   on the spot and was sent to the app arrived with no invitation at all — and
   was then shown "Start a team", because as far as the app could tell they
   were a work account with no team. The invitation was still sitting in the
   database, unaccepted, and the link that would have redeemed it was gone from
   the address bar. */
let inviteHeld = (() => {
  try { return new URLSearchParams(location.search).get('invite') || ''; } catch (e) { return ''; }
})();

const pendingInviteToken = () => inviteHeld;

/* Arriving on an invitation link with nobody signed in. The account they are
   about to make has to be a work one, so the panel opens knowing that. */
function offerInviteSignup() {
  if (!pendingInviteToken() || state.auth) return;
  state.authFor = 'work';
  state.authOpen = true;
  state.authMode = 'register';
  state.authNotice = 'Create your work account to join the team. A personal Zimpan cannot join one.';
}

async function acceptPendingInvite() {
  const token = pendingInviteToken();
  if (!token || !state.auth) return;
  const out = await teamDo('accept', () => API.team.accept(token), 'You are on the team.');
  /* Cleared whatever happened. A token that has been tried and refused —
     already used, expired, sent to a different address — must not be tried
     again on the next render, or the error replaces itself forever and the
     reason never stays on screen long enough to read. teamDo has already put
     the server's words in state.teamError. */
  inviteHeld = '';
  try { history.replaceState({}, '', '/'); } catch (e) { /* file:// */ }
  state.route = 'home';
  render();
  return out;
}

/* Thirty days: long enough to be a picture of the month, short enough that a
   busy team's roster does not arrive as a thousand rows. */
const TEAM_WINDOW_DAYS = 30;
const teamWindow = () => [mShiftIso(iso(new Date()), -(TEAM_WINDOW_DAYS - 1)), iso(new Date())];

async function loadTeamHours() {
  if (!state.teamMemberId) return;
  const [from, to] = teamWindow();
  state.teamBusy = 'hours';
  state.teamError = '';
  render();
  try {
    state.teamRows = await API.team.entries(state.teamMemberId, from, to);
  } catch (err) {
    state.teamRows = [];
    state.teamError = err.message || 'Could not read those hours.';
  } finally {
    state.teamBusy = '';
    render();
  }
}

/* ── the live view ──

   Polled rather than pushed. A socket for a handful of admins watching a
   handful of timers is a second server to keep alive for a screen that is
   usually closed; thirty seconds is well inside the resolution of the thing
   being watched, which is measured in minutes.

   `quiet` is the poll: it leaves the last answer on screen while the next one
   is in flight and it does not report failure. A momentary network blip
   replacing a live roster with an error message would be worse than a figure
   that is thirty seconds stale, and the timestamp under it already says how
   old the reading is. */
/* What to say after an invitation goes out, or fails to.

   The link is shown whether or not the email went. When it did, it is the
   fallback for a spam folder; when it did not, it is the only way in. Showing
   it always is simpler than deciding, and an admin who can see the link is
   never stuck. */
function noteInvite(out, again) {
  state.teamInviteLink = out.link || '';
  state.teamMailed = !!out.delivered;
  state.teamNotice = out.delivered
    ? `${again ? 'Sent again' : 'Invited'} — ${out.email} has the email.`
    : `Invitation ${again ? 'renewed' : 'created'} for ${out.email}, but the email did not go: ${
      out.mailReason || 'the server could not send it'} Send them the link below.`;
  render();
}

async function loadTeamLive(quiet) {
  if (!teamIsAdmin() || !(state.team && state.team.team)) return;
  if (!quiet) { state.teamError = ''; state.teamLive = null; }
  try {
    state.teamLive = await API.team.now(todayIso);
    state.teamLiveAt = Date.now();
  } catch (err) {
    if (!quiet) state.teamError = err.message || 'Could not read who is working.';
  }
  render();
}

/* One interval, started when the Members tab is showing and stopped the moment
   it is not. Kept in a module variable rather than on state: a timer id is not
   something a render should be able to change, and two of them running would
   double the traffic and never be noticed. */
let teamLiveTimer = null;
const TEAM_LIVE_MS = 30000;

function teamLiveWatch() {
  const wanted = !!(state.teamOpen && state.teamTab === 'people'
    && teamIsAdmin() && state.team && state.team.team);
  if (wanted && !teamLiveTimer) {
    /* The interval is created BEFORE the first read, not after it.

       loadTeamLive renders when it finishes, either way, and render() calls
       back into here. With the guard still null at that moment this starts a
       second read, which renders, which starts a third — straight down to
       "Maximum call stack size exceeded". Setting the guard first makes that
       re-entry a no-op whether the read finishes on the next tick or before it
       has yielded at all. */
    teamLiveTimer = setInterval(() => {
      // A tab in the background is not being watched, so it is not polled.
      if (document.hidden) return;
      loadTeamLive(true);
    }, TEAM_LIVE_MS);
    loadTeamLive(false);
  } else if (!wanted && teamLiveTimer) {
    clearInterval(teamLiveTimer);
    teamLiveTimer = null;
    state.teamLive = null;
    state.teamLiveOpen = null;
  }
}

async function loadTeamDashboard() {
  const [from, to] = teamWindow();
  state.teamError = '';
  try {
    state.teamDash = await API.team.dashboard(from, to);
  } catch (err) {
    state.teamDash = null;
    state.teamError = err.message || 'Could not read the dashboard.';
  }
  render();
}

/* One field of one row. The local copy is updated from what the server
   confirms rather than from what was typed, so a refused edit shows the real
   value rather than the one that did not take. */
async function teamEdit(id, patch) {
  state.teamError = '';
  try {
    const out = await API.team.editEntry(id, patch);
    state.teamRows = state.teamRows.map((r) => (r.id === id ? Object.assign({}, r, out) : r));
  } catch (err) {
    state.teamError = err.message || 'That edit was refused.';
    await loadTeamHours();
    return;
  }
  render();
}

/* Billing is not in this list on purpose: it is the owner's errand rather than
   a view of the team, and it sits under the dialog's own buttons instead of
   competing with the four tabs that are about the work. */
const TEAM_TABS = [['people', 'Members'], ['projects', 'Categories/Projects'], ['hours', 'Team Hours'], ['dashboard', 'Dashboard']];

const teamStatusOf = () => (state.team && state.team.team && state.team.team.status) || 'trial';
const teamExpired = () => teamStatusOf() === 'expired';

/* ── billing ──

   The owner's tab, because the owner owns the payment. It shows what the team
   is on, and the five subscribe buttons.

   The team's name and id are shown next to them on purpose: PayPal reports an
   email and an amount and nothing else, so the only way a receipt is matched
   to a team is by somebody reading the two side by side. Quoting the id in a
   note makes that a lookup rather than a guess. */
function teamBillingTab() {
  const t = state.team.team;
  const status = teamStatusOf();
  const paid = status === 'active';

  const line = paid
    ? `On the <strong>${esc(t.planLabel)}</strong> plan — up to ${t.seatCap ? t.seatCap : 'any number of'} people.`
    : status === 'trial'
      ? `Free trial — <strong>${t.trialDaysLeft} ${t.trialDaysLeft === 1 ? 'day' : 'days'} left</strong>, up to 3 people.`
      : 'Your trial has ended. Everyone can still log their own hours; inviting, projects and the dashboard come back the moment a plan is on.';

  return `
    <div class="tm-bill-now tm-bill-${esc(status)}">${line}</div>

    <div class="tm-quote">
      <span>Quote this when you subscribe, so your payment finds your team:</span>
      <code>${esc(t.name)} · ${esc(t.id)}</code>
    </div>

    <div class="tm-plans">
      ${TEAM_PLANS.map(([key, label, nickname, seats, price, button]) => `
      <div class="tm-plan${t.plan === key ? ' is-on' : ''}${key === TEAM_POPULAR && t.plan !== key ? ' is-popular' : ''}">
        ${key === TEAM_POPULAR && t.plan !== key ? `<span class="tm-plan-flag">${nodeIcon('flame', 11)}Most popular</span>` : ''}
        <div class="tm-plan-head">
          <span class="tm-plan-name">${esc(label)}${nickname === label ? '' : `<span class="tm-plan-nick">${esc(nickname)}</span>`}</span>
          <span class="tm-plan-price">$${price}<span>/mo</span></span>
        </div>
        <div class="tm-plan-seats">${seats ? `Up to ${seats} people` : 'As many people as you like'}</div>
        ${t.plan === key
          ? '<div class="tm-plan-on">Your plan</div>'
          : paypalForm(button, 'Subscribe', 'tm-plan-go')}
      </div>`).join('')}
    </div>

    <p class="tm-foot">Subscriptions are handled by PayPal in USD and open in a new tab. A plan is switched on by hand once the payment is matched to your team, so it can take a little while — nothing stops in the meantime except while a trial is over.</p>`;
}

/* An empty tab that says what would fill it. The icon is the tab's own, so an
   empty Projects panel still looks like Projects rather than like a failure. */
const teamNothing = (icon, title, body) => `
  <div class="tm-none">
    <span class="tm-none-mark">${nodeIcon(icon, 20)}</span>
    <strong>${esc(title)}</strong>
    <p>${esc(body)}</p>
  </div>`;

/* What one person is doing this minute, drawn under their name.

   Three states, and they are not the same thing: running on one of the team's
   projects, running on something that is not the team's, and not running. The
   middle one is why the server sends `offTeam` rather than simply omitting the
   project — a timer going on a member's own account is not the team's to read,
   and "working, not on your projects" is the true answer where naming it would
   be a leak and silence would be a lie. */
function teamLiveRow(live) {
  if (!live) return '';
  if (!live.running) {
    return `<span class="tm-live tm-live-off">${live.loggedMin
      ? `${esc(durShort(live.loggedMin))} logged today`
      : 'nothing logged today'}</span>`;
  }
  const on = live.offTeam
    ? 'working · not on a team project'
    : `${live.activity || 'Untitled'}${live.project ? ` · ${live.project}` : ''}`;
  return `<span class="tm-live tm-live-on">
    <span class="tm-live-dot" aria-hidden="true"></span>
    <span class="tm-live-what">${esc(on)}</span>
    <span class="tm-live-for">${esc(durShort(live.elapsedMin))}</span>
  </span>`;
}

/* Today, in order, as a row of blocks scaled to the hours they took. Opened
   per person rather than drawn for everybody: five timelines at once is a
   wall, and the question an admin has is usually about one of them. */
function teamTimeline(live) {
  if (!live || !live.timeline.length) {
    return '<div class="tm-tl-empty">Nothing logged against a project today.</div>';
  }
  const total = live.timeline.reduce((a, e) => a + Math.max(1, e.to >= e.from ? e.to - e.from : e.to + 1440 - e.from), 0);
  return `
    <div class="tm-tl">
      <div class="tm-tl-bar">
        ${live.timeline.map((e) => {
          const mins = Math.max(1, e.to >= e.from ? e.to - e.from : e.to + 1440 - e.from);
          return `<span class="tm-tl-seg" style="flex-grow:${mins};background:${esc(e.color || 'var(--color-neutral-400)')};"
            title="${esc(e.activity)} · ${esc(clock12(e.from))}–${esc(clock12(e.to))}"></span>`;
        }).join('')}
      </div>
      ${live.timeline.map((e) => {
        const mins = Math.max(1, e.to >= e.from ? e.to - e.from : e.to + 1440 - e.from);
        return `
        <div class="tm-tl-row">
          <span class="tm-tl-dot" style="background:${esc(e.color || 'var(--color-neutral-400)')};"></span>
          <span class="tm-tl-name">${esc(e.activity || 'Untitled')}</span>
          <span class="tm-tl-proj">${esc(e.project || '—')}</span>
          <span class="tm-tl-when">${esc(clock12(e.from))}–${esc(clock12(e.to))}</span>
          <span class="tm-tl-mins">${esc(durShort(mins))}</span>
        </div>`;
      }).join('')}
      <div class="tm-tl-foot">${live.timeline.length} ${live.timeline.length === 1 ? 'entry' : 'entries'} · ${esc(durShort(total))} today</div>
    </div>`;
}

function teamPeopleTab() {
  const t = state.team;
  const cap = t.team.seatCap;
  const liveBy = new Map(((state.teamLive && state.teamLive.members) || []).map((m) => [m.userId, m]));
  const rows = t.members.map((m) => {
    const isMe = m.userId === t.me.userId;
    const canManage = teamIsSuper() ? m.role !== 'super' : (teamIsAdmin() && m.role === 'member' && !isMe);
    const live = teamIsAdmin() ? liveBy.get(m.userId) : null;
    const open = state.teamLiveOpen === m.userId;
    return `
    <div class="tm-row">
      <div class="tm-who">
        <span class="tm-name">${esc(m.name || m.email)}${isMe ? ' <span class="tm-you">you</span>' : ''}</span>
        <span class="tm-mail">${esc(m.email)}</span>
        ${teamLiveRow(live)}
      </div>
      ${live ? `<button class="tm-act" data-act="team-live-open" data-id="${esc(String(m.userId))}"
        aria-expanded="${open}">${open ? 'Hide today' : 'Today'}</button>` : ''}
      <span class="tm-role tm-role-${esc(m.role)}">${esc(m.role === 'super' ? 'Owner' : m.role)}</span>
      ${teamIsSuper() && m.role !== 'super' ? `
        <button class="tm-act" data-act="team-role" data-id="${esc(String(m.userId))}"
          data-v="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Make member' : 'Make admin'}</button>` : ''}
      ${canManage ? `<button class="tm-act tm-drop" data-act="team-remove" data-id="${esc(String(m.userId))}">Remove</button>` : ''}
    </div>
    ${open && live ? teamTimeline(live) : ''}`;
  }).join('');

  /* The server does not send these to a member, and this does not draw them
     either. Belt and braces on purpose: a list of who has been asked to join
     is an admin's business, and the client should not be the only thing
     standing between a member and it — nor the server. */
  const invites = (teamIsAdmin() ? t.invites : []).map((i) => `
    <div class="tm-row tm-pending">
      <div class="tm-who">
        <span class="tm-name">${esc(i.email)}</span>
        <span class="tm-mail">Invited · ${esc(i.role)}</span>
      </div>
      <button class="tm-act" data-act="team-resend" data-v="${esc(i.email)}"${
        state.teamBusy === 'resend' ? ' disabled' : ''}>${state.teamBusy === 'resend' ? 'Sending…' : 'Resend'}</button>
      <button class="tm-act tm-drop" data-act="team-revoke" data-v="${esc(i.email)}">Withdraw</button>
    </div>`).join('');

  return `
    ${teamIsAdmin() ? `
    <div class="tm-livehead">
      <span>${(() => {
        const on = ((state.teamLive && state.teamLive.members) || []).filter((m) => m.running).length;
        if (!state.teamLive) return 'Reading who is working…';
        return on ? `${on} working right now` : 'Nobody has a timer running';
      })()}</span>
      <button class="tm-act" data-act="team-live-refresh">Refresh</button>
    </div>` : ''}
    <div class="tm-cap">${t.seatsUsed} of ${cap ? cap : 'unlimited'} on the <strong>${esc(t.team.planLabel)}</strong> plan${
      t.team.status === 'trial' ? ` · ${t.team.trialDaysLeft} ${t.team.trialDaysLeft === 1 ? 'day' : 'days'} left` : ''}${
      t.team.status === 'expired' ? ' · ended' : ''}</div>
    <div class="tm-list">${rows}${invites}</div>
    ${teamIsAdmin() ? '' : `
    <p class="tm-seen">Your admins can see when you have a timer running, what it is on, and the hours you have logged against this team's projects today. Notes you write on an entry are never shown to them, and nothing you log outside this team is visible here at all.</p>`}`;
}

/* ── what stays put while the list scrolls ──

   The roster grows without limit and the invite field does not, so the field
   is the thing that must never be scrolled off. It sits below the drawer
   rather than at the end of the list it belongs to: a team of thirty is thirty
   rows between an admin and the only control on the tab.

   The link block rides with it for the same reason — it appears the moment an
   invitation is sent, and an admin who has to hunt for the link is an admin
   who will not send it on. */
function teamPeopleAdd() {
  if (!teamIsAdmin()) return '';
  return `
    <div class="tm-add">
      <input class="input" type="email" data-k="team-invite" data-sync="teamInviteEmail"
        value="${esc(state.teamInviteEmail)}" placeholder="Their work email" autocomplete="off">
      ${teamIsSuper() ? `
      <select class="input tm-as" data-change="team-invite-role">
        <option value="member"${state.teamInviteRole === 'member' ? ' selected' : ''}>as member</option>
        <option value="admin"${state.teamInviteRole === 'admin' ? ' selected' : ''}>as admin</option>
      </select>` : ''}
      <button class="btn btn-primary" data-act="team-invite"${state.teamBusy === 'invite' ? ' disabled' : ''}>${state.teamBusy === 'invite' ? 'Sending…' : 'Invite'}</button>
    </div>
    ${state.teamInviteLink ? `
    <div class="tm-link${state.teamMailed ? '' : ' tm-link-warn'}">
      <span>${state.teamMailed
        ? 'Emailed to them. If it does not arrive, this is the same link:'
        : 'Send them this link — it is the only way in until email works:'}</span>
      <code>${esc(state.teamInviteLink)}</code>
    </div>` : ''}`;
}

function teamProjectsTab() {
  const rows = teamProjects().map((p) => `
    <div class="tm-row">
      <span class="tm-dot" style="background:${esc(p.color || 'var(--color-accent)')};"></span>
      <div class="tm-who"><span class="tm-name">${esc(p.name)}</span></div>
      ${teamIsAdmin() ? `<button class="tm-act tm-drop" data-act="team-project-drop" data-v="${esc(p.id)}">Remove</button>` : ''}
    </div>`).join('');

  return `
    <div class="tm-list">${rows || teamNothing('clipboard', 'No projects yet',
      teamIsAdmin() ? 'Add the first one below. Members log their hours against these, so name them the way your team already talks about the work.'
        : 'An admin has not set any up yet. Until they do there is nothing to log against.')}</div>
`;
}

// Pinned under the drawer, for the same reason the invite field is.
function teamProjectsAdd() {
  if (!teamIsAdmin()) return '';
  return `
    <div class="tm-add">
      <input class="input" type="text" data-k="team-project" data-sync="teamProjectName"
        value="${esc(state.teamProjectName)}" placeholder="New project name" autocomplete="off">
      <button class="btn btn-primary" data-act="team-project-add"${state.teamBusy === 'project' ? ' disabled' : ''}>Add</button>
    </div>`;
}

/* An admin reading somebody's hours. Only entries against a project come back
   — the server will not send any other kind — so this cannot show a meal even
   if it wanted to. */
function teamHoursTab() {
  const t = state.team;
  const picker = `
    <select class="input tm-as" data-change="team-member">
      <option value="">Choose someone…</option>
      ${t.members.map((m) => `<option value="${esc(String(m.userId))}"${String(state.teamMemberId) === String(m.userId) ? ' selected' : ''}>${esc(m.name || m.email)}</option>`).join('')}
    </select>`;

  if (!state.teamMemberId) return picker + teamNothing('clock', 'Pick someone',
    'You will see the hours they logged against your projects over the last 30 days, and you can correct any of them. Nothing else of theirs is here.');
  if (state.teamBusy === 'hours') return `${picker}<p class="tm-empty">Reading…</p>`;
  if (!state.teamRows.length) return picker + teamNothing('clock', 'Nothing in this window',
    'They have logged no hours against a project in the last 30 days.');

  const opts = teamProjects();
  return `${picker}
    <div class="tm-hours">
      ${state.teamRows.map((r) => `
      <div class="tm-hrow">
        <input class="input tm-hact" type="text" value="${esc(r.activity)}" data-change="team-edit-activity" data-id="${esc(r.id)}">
        <input class="input tm-htime" type="time" value="${esc(hm(r.from))}" data-change="team-edit-from" data-id="${esc(r.id)}">
        <input class="input tm-htime" type="time" value="${esc(hm(r.to))}" data-change="team-edit-to" data-id="${esc(r.id)}">
        <select class="input tm-hproj" data-change="team-edit-project" data-id="${esc(r.id)}">
          ${opts.map((p) => `<option value="${esc(p.id)}"${p.id === r.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <span class="tm-hdate">${esc(dayLabel(r.date))}</span>
      </div>`).join('')}
    </div>
    <p class="tm-foot">Only hours logged against a project are here. What someone eats, spends or sleeps is never shown to an admin.</p>`;
}

function teamDashboardTab() {
  const d = state.teamDash;
  if (!d) return '<p class="tm-empty">Loading…</p>';
  const top = Math.max(1, ...d.byProject.map((p) => Number(p.minutes)), ...d.byMember.map((m) => Number(m.minutes)));
  const bar = (label, minutes, color) => `
    <div class="tm-bar">
      <span class="tm-blabel">${esc(label)}</span>
      <span class="tm-btrack"><span class="tm-bfill" style="width:${Math.round((Number(minutes) / top) * 100)}%;background:${esc(color || 'var(--color-accent)')};"></span></span>
      <span class="tm-bval">${esc(durShort(Number(minutes)))}</span>
    </div>`;

  return `
    <div class="tm-sub">By project</div>
    ${d.byProject.map((p) => bar(p.name, p.minutes, p.color)).join('') || '<p class="tm-empty">No projects yet.</p>'}
    ${d.byProject.length && d.byProject.every((p) => !Number(p.minutes))
      ? '<p class="tm-empty">Nothing logged against them yet — this fills in as the team tracks.</p>' : ''}
    <div class="tm-sub">By person</div>
    ${d.byMember.map((m) => bar(m.name || m.email, m.minutes, null)).join('')}
    <p class="tm-foot">Hours logged against your projects, over the last 30 days.</p>`;
}

function teamStartBody() {
  /* The server refuses this too, and its refusal is the one that counts. Said
     here as well because being told before you type is better than being told
     after — and because the answer is not "try again", it is "use a different
     email", which nobody guesses. */
  if (state.auth && state.auth.kind !== 'work') {
    return `
    <p>Zimpan for Teams runs on its own account, kept separate from this one. Your personal log — what you eat, spend and sleep — is not part of a team, and this account cannot be turned into one.</p>
    <p class="tm-foot">Sign out and create a team account with your work email. This Zimpan stays exactly as it is.</p>`;
  }
  return `
    <div class="tm-add" style="margin-top:2px;">
      <input class="input" type="text" data-k="team-name" data-sync="teamName"
        value="${esc(state.teamName)}" placeholder="What is the team called?" autocomplete="off">
      <button class="btn btn-primary" data-act="team-create"${state.teamBusy === 'create' ? ' disabled' : ''}>${state.teamBusy === 'create' ? 'Creating…' : 'Create'}</button>
    </div>
    <p style="margin-top:12px;">A team is a separate space for work hours: projects to log against, people you invite by email, and a reading of where the week went. Nothing personal from this account is part of it.</p>
    <p class="tm-foot">You will own it, and start on the trial plan — three people, including you.</p>`;
}

/* Each tab is a different job, so the dialog says which one you are in rather
   than wearing the same shield for all five. */
const TEAM_TAB_FACE = {
  people: ['shield', 'Building Your Team', 'var(--color-accent)', 'Invite Team Members'],
  projects: ['clipboard', 'What they log against', '#0e9f6e', 'Add Projects or Tasks Categories'],
  hours: ['clock', 'What was logged', '#4f46e5', "See members' activities"],
  dashboard: ['insights', 'Where the hours went', '#7856f5', 'Your teams productivity insights'],
  billing: ['scales', 'What it costs', 'var(--zg-donate)', 'Your plan and billing']
};

function teamSheet() {
  if (!state.teamOpen) return '';
  const has = state.team && state.team.team;

  const body = !has ? teamStartBody() : `
    <div class="seg tm-tabs">
      ${TEAM_TABS.filter(([k]) => (k !== 'dashboard' || teamIsSuper())
          && (k !== 'hours' || teamIsAdmin()))
        .map(([k, label]) => `
        <label class="seg-opt"><input type="radio" name="team-tab" data-act="team-tab" data-v="${k}"${state.teamTab === k ? ' checked' : ''}><span>${label}</span></label>`).join('')}
    </div>
    ${teamExpired() && state.teamTab !== 'billing' ? `
    <div class="tm-over">
      <span>Your trial has ended — inviting, projects and the dashboard are paused. Your hours are untouched.</span>
      ${teamIsSuper() ? '<button class="tm-act" data-act="team-tab" data-v="billing">See plans</button>' : ''}
    </div>` : ''}
    <div class="tm-body tm-drawer" data-tm-drawer>
      ${state.teamTab === 'projects' ? teamProjectsTab()
        : state.teamTab === 'hours' && teamIsAdmin() ? teamHoursTab()
        : state.teamTab === 'dashboard' && teamIsSuper() ? teamDashboardTab()
        : state.teamTab === 'billing' && teamIsSuper() ? teamBillingTab()
        : teamPeopleTab()}
    </div>
    ${state.teamError ? `<p class="tm-err">${esc(state.teamError)}</p>` : ''}
    ${state.teamNotice ? `<p class="tm-ok">${esc(state.teamNotice)}</p>` : ''}`;

  const face = TEAM_TAB_FACE[state.teamTab] || TEAM_TAB_FACE.people;
  /* Until the team exists there is nothing behind this sheet worth reaching:
     no projects to log against, no roster, no report with anything in it. It
     was dismissable and raised once a session, so it was possible to close it
     and be left in an app that could not be used and would not explain why.
     Now it stays until the team is made — no ✕, no backdrop, no Done. Signing
     out is still offered, because "I picked the wrong product" has to have an
     answer that is not clearing site data. */
  const locked = !has;
  return lightbox({
    icon: has ? face[0] : 'shield',
    tone: has ? face[2] : 'var(--color-accent)',
    kicker: has ? state.team.team.name : 'Zimpan for Teams',
    title: has ? face[1] : 'Start a team',
    sub: has ? face[3] : '',
    closeAct: locked ? '' : 'team-close',
    /* 600px once there is a team in it. The starting sheet is one field and a
       paragraph and looks stranded at that width; the tabbed one holds a
       roster, a timeline and a chart, all of which were being squeezed into a
       column meant for a yes/no question. */
    wide: !!has,
    body,
    pinned: has ? (state.teamTab === 'people' ? teamPeopleAdd()
      : state.teamTab === 'projects' ? teamProjectsAdd() : '') : '',
    actsClass: has && teamIsSuper() ? 'lb-stack' : '',
    actions: locked
      ? `<button class="btn btn-ghost" data-act="sign-out" style="font-size:13px;">Sign out</button>`
      : `<button class="btn btn-secondary" data-act="team-close">Done</button>${
        has && teamIsSuper() ? `
      <button class="btn btn-primary" data-act="team-tab" data-v="${state.teamTab === 'billing' ? 'people' : 'billing'}">${
          state.teamTab === 'billing' ? 'Back to the team' : 'Billing'}</button>` : ''}`
  });
}

/* ── the answers this app remembers ──

   Three of its questions can be settled once and never asked again: whether a
   spend comes off the balance, whether food and workouts are refined, and
   whether anything may be sent to a model at all. Each is a single tap inside
   a dialog you may never see twice — which is fine right up until you change
   your mind, and there is nowhere to go and say so.

   So every standing answer is gathered here, shown as what it currently is
   rather than as a switch whose state you have to infer, and each one can be
   put back to "ask me". Consent is the one that is revoked rather than
   toggled: turning it on here would be consent given to a settings screen
   instead of to the question that explains what is sent. */
/* ── typing the times instead of dragging them ──

   A bar is quick for "some time this evening" and hopeless for "quarter past
   nine, exactly". Both handles land on a whole minute, so the precision was
   always there — there was just no way to say it in numbers.

   type="time" rather than a text field parsed by hand: it is what the full
   layout's From and To already are, the platform supplies its own keypad and
   its own idea of 12- or 24-hour, and none of that has to be reinvented here.

   The span is derived the way a drag derives it — forwards from the start,
   wrapping past midnight, held to the same cap — so a typed entry and a
   dragged one cannot disagree about what is allowed. */
function mTimeDialog() {
  const t = state.m.timeEdit;
  if (!t) return '';
  const field = (key, label) => `
    <label style="flex:1 1 0;min-width:0;display:block;text-align:left;">
      <span style="display:block;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-neutral-600);margin-bottom:5px;">${esc(label)}</span>
      <input class="input" type="time" data-k="m-time-${key}" data-sync="m.timeEdit.${key}"
        value="${esc(t[key])}" style="width:100%;font-size:17px;min-height:46px;">
    </label>`;
  return lightbox({
    icon: 'clock',
    tone: 'var(--color-accent)',
    kicker: 'When was that?',
    title: 'Type the times',
    closeAct: 'm-time-close',
    body: `<div style="display:flex;gap:12px;margin-top:4px;">${field('from', 'Started')}${field('to', 'Ended')}</div>
      ${t.error ? `<p style="margin:10px 0 0;font-size:13px;color:#8a2f4a;">${esc(t.error)}</p>` : ''}`,
    actions: `
      <button class="btn btn-secondary" data-act="m-time-close">Cancel</button>
      <button class="btn btn-primary" data-act="m-time-save">Set them</button>`,
    foot: `An end before the start counts as the next morning. Anything longer than ${mDur(M_SPAN_MAX)} is trimmed to it.`
  });
}

function prefsRow(title, note, opts, act, now) {
  return `
    <div class="pref-row">
      <div class="pref-name">${esc(title)}</div>
      <p class="pref-note">${esc(note)}</p>
      <div class="seg pref-seg">
        ${opts.map(([val, label]) => `
        <label class="seg-opt"><input type="radio" name="${esc(act)}" data-act="${esc(act)}" data-v="${esc(String(val))}"${
          String(now) === String(val) ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}
      </div>
    </div>`;
}

function prefsDialog() {
  if (!state.prefsOpen) return '';
  const consented = state.aiConsent || state.chatConsent;
  const asking = state.deductAlways === null && state.refineAlways === null && !consented;

  return lightbox({
    icon: 'sliders',
    tone: 'var(--color-accent)',
    kicker: 'Preferences',
    title: 'What this app stops asking',
    closeAct: 'prefs-close',
    body: `
      ${prefsRow(
        'Money you spend',
        'Whether a spend comes off your balance or is kept aside.',
        [['ask', 'Ask each time'], ['true', 'Take it off'], ['false', 'Keep it aside']],
        'pref-deduct', state.deductAlways === null ? 'ask' : String(state.deductAlways))}
      ${prefsRow(
        'Calibrating food and workouts',
        'Whether a logged meal or effort is re-read by Claude for a closer figure.',
        [['ask', 'Ask each time'], ['true', 'Always'], ['false', 'Never']],
        'pref-refine', state.refineAlways === null ? 'ask' : String(state.refineAlways))}
      ${consented ? `
      <div class="pref-row">
        <div class="pref-name">What you have allowed to be sent</div>
        <p class="pref-note">Withdrawing this asks again the next time, with the explanation attached.</p>
        ${state.aiConsent ? `
        <button class="pref-revoke" data-act="pref-revoke-ai">
          <span>Meal and workout estimates</span><span class="pref-x">Withdraw</span>
        </button>` : ''}
        ${state.chatConsent ? `
        <button class="pref-revoke" data-act="pref-revoke-chat">
          <span>Ask Zimpan</span><span class="pref-x">Withdraw</span>
        </button>` : ''}
      </div>` : ''}`,
    actions: `
      <button class="btn btn-secondary" data-act="prefs-reset"${asking ? ' disabled' : ''}>${
        asking ? 'Nothing to reset' : 'Ask me everything again'}</button>
      <button class="btn btn-primary" data-act="prefs-close">Done</button>`,
    /* Checked rather than assumed: neither standing answer is in the sync
       payload, and consent is deliberately per-device. So this says the device,
       and does not promise a phone what a laptop was told. */
    foot: 'These are remembered on this device only. Another device asks you separately.'
  });
}

function closeFollowUp(saveIt) {
  const p = state.notePrompt;
  state.notePrompt = null;
  if (!p) { render(); return; }
  const text = state.noteDraft.trim();
  state.noteDraft = '';
  if (saveIt) {
    /* Saving means the question is welcome; it keeps being asked next time.

       An empty box is written when there was a note there before, which is how
       a note gets removed: clearing it and saving used to fall past this branch
       and leave the old text in place, so there was no way to take one back.
       Still nothing to do when there was no note and none was typed. */
    const had = ((findRow(p.kind, p.id) || {}).note || '').trim();
    if (text || had) {
      if (p.kind === 'entries') {
        updateEntry(p.id, { note: text.slice(0, 500) });
        // The note is what an estimate reads, so the moment it lands is the
        // moment there is something worth asking about.
        askRefine(p.id);
      } else {
        /* Raised before the write, because updateMoney renders — asking after
           it would set the state and then nobody would draw it.

           Without this a spend that happened to trigger a note prompt — a
           taxi, a lunch, which is a great many of them — would never be asked
           about at all and would quietly take the default. */
        askDeductAfterNote(p);
        updateMoney(p.id, { note: text.slice(0, 500) });
      }
      return; // updateEntry/updateMoney already save, sync and re-render
    }
  } else if (p.key) {
    // Skipped or dismissed: stop asking this particular question this session.
    state.noteSkipped[p.key] = true;
  }
  /* Nothing was written and nothing was there. For a meal that is not a
     no-op — it is the difference between a day read off the plate and a day of
     placeholders — so it gets said out loud before the dialog goes away. */
  if (mealNeedsFoods(p)) return;
  askDeductAfterNote(p);
  render();
}

/* The note prompt goes first when a spend triggers both — two panels at once is
   one too many — and this is the queue behind it. */
function askDeductAfterNote(p) {
  if (!p || p.kind !== 'money' || !p.key) return;
  askDeduct(state.money.find((r) => r.id === p.id));
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
  'app-time': () => { state.app = 'time'; state.logFilter = ''; clearFocus(); render(); },
  'app-money': () => {
    // There is no money tracker in a team account, so there is nothing to
    // switch to. Refused here as well as hidden: a hidden button is a drawing
    // decision, and this is what the product is.
    if (workMode()) return;
    state.app = 'money'; state.logFilter = ''; clearFocus(); render();
  },

  'range-day': () => { state.range = 'day'; render(); },
  'range-week': () => { state.range = 'week'; render(); },
  /* fortnight and month are no longer offered on the page, but the actions
     stay: a stored preference, a deck window and the "Read 2 weeks" button in
     the insights block all still name them, and an action that vanished would
     turn those into dead controls rather than into anything better. */
  'range-fortnight': () => { state.range = 'fortnight'; render(); },
  'range-month': () => { state.range = 'month'; render(); },
  'range-thismonth': () => { state.range = 'thismonth'; render(); },
  'range-lastmonth': () => { state.range = 'lastmonth'; render(); },
  'range-all': () => { state.range = 'all'; render(); },
  /* Toggles a class rather than re-rendering: a render rebuilds the deck and
     would throw the reader back to the first card, which is a steep price for
     a drawer. */
  'deck-raw-more': (el) => {
    const box = el.closest('.deck-raw');
    if (!box) return;
    const open = box.classList.toggle('is-open');
    // Only the label, not the button — writing textContent on the button would
    // take the caret with it, and the caret is what says which way this goes.
    const label = el.querySelector('.deck-raw-label') || el;
    label.textContent = open ? 'Show less' : (el.dataset.more || 'Show all');
    el.setAttribute('aria-expanded', String(open));
  },

  /* The filter survives a change of day on purpose — comparing one category
     across days is the reason to set it — but not a change of tracker, where
     the control that explains it is not on screen. */
  'go-today': () => { state.selectedDate = todayIso; render(); },

  'range-quarter': () => { state.range = 'quarter'; render(); },
  'range-half': () => { state.range = 'half'; render(); },
  'range-year': () => { state.range = 'year'; render(); },

  'prev-day': () => shiftDay(-1),
  'next-day': () => shiftDay(1),

  'toggle-timer': toggleTimer,
  'pick-timer-cat': (el) => { state.timerCategory = el.dataset.name; save(); render(); },

  'add-entry': addEntry,
  'add-money': addMoney,

  /* Both answers write the same two things — the row's own flag and, if the
     box is ticked, the standing preference — so the only difference between
     them is which way round. */
  'deduct-remember': () => { state.deductRemember = !state.deductRemember; render(); },
  'deduct-yes': () => deductAnswer(true),
  'deduct-no': () => deductAnswer(false),
  'deduct-close': () => { state.deductAsk = null; state.deductRemember = false; render(); },

  // Relabels every amount on the next render; the stored numbers are untouched.
  'set-currency': (el) => {
    state.currency = el.value;
    state.currencyUpdatedAt = Date.now();
    state.dirty.currency = true;
    save(); queueSync(0); render();
  },

  /* ── account ── */
  'auth-open': () => { state.authFor = 'personal'; state.authOpen = true; setAuthMode('login'); },
  /* The team page's own door. It opens on Create account rather than Sign in,
     because the whole point is that a team needs an account of its own — and
     someone who already has one will switch tabs in a second either way. */
  'auth-open-work': () => { state.authFor = 'work'; state.authOpen = true; setAuthMode('register'); },
  'auth-close': () => { state.authOpen = false; state.authError = ''; state.authNotice = ''; render(); },
  'cross-kind-close': () => { state.crossKind = ''; render(); },
  'auth-mode-login': () => { setAuthMode('login'); },
  'auth-mode-register': () => { setAuthMode('register'); },
  'auth-mode-forgot': () => { setAuthMode('forgot'); },
  'forgot-submit': submitForgot,
  'reset-submit': submitReset,
  'note-save': () => closeFollowUp(true),
  'note-skip': () => closeFollowUp(false),
  // Empties the box and saves, so removal goes through the one write path
  // rather than a second one that could drift from it.
  'note-remove': () => { state.noteDraft = ''; closeFollowUp(true); },
  'note-edit': (el) => editNote(el.dataset.kind, el.dataset.id),
  /* Back to the box, with the question un-skipped: asking to write this one
     down is not the answer of somebody who wants to stop being asked. editNote
     renders, and render() puts the cursor in the note. */
  'meal-note': () => {
    const a = state.mealAsk;
    state.mealAsk = null;
    if (!a) { render(); return; }
    delete state.noteSkipped.food;
    editNote('entries', a.id);
  },
  'meal-skip': () => {
    const a = state.mealAsk;
    state.mealAsk = null;
    if (a) state.noteSkipped.food = true;
    render();
  },

  'auth-submit': submitAuth,
  'sign-out': () => {
    state.menuOpen = false;
    if (state.m) state.m.accountOpen = false;
    // The phone flow re-runs its own first paint on the next sign-in.
    mBooted = false;
    signOut();
  },
  'scroll-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  'scroll-features': () => scrollToAnchor('features'),
  'scroll-pricing': () => scrollToAnchor('pricing'),

  /* Two real URLs rather than a tab, because /teams is a page people are meant
     to link to, land on from a search, and come back to. pushState keeps the
     single document — nothing is fetched — while the address bar and the back
     button both tell the truth. */
  'go-teams': () => goRoute('teams'),
  'go-blogs': () => goRoute('blogs'),
  'go-post': (el) => goRoute('blogs', el.dataset.slug),
  'go-home': () => goRoute('home'),

  'legal-privacy': () => { state.legalOpen = 'privacy'; render(); },
  'legal-terms': () => { state.legalOpen = 'terms'; render(); },
  'legal-faq': () => { state.legalOpen = 'faq'; render(); },

  /* Opened from the menus, toggled from the button beside Ask Zimpan. Both
     menus close behind it: they are the way in, not something to leave hanging
     over what they opened. */
  'todo-open': () => {
    state.todoOpen = true;
    state.menuOpen = false;
    if (state.m) state.m.accountOpen = false;
    render();
  },
  'todo-toggle': () => { state.todoOpen = !state.todoOpen; if (!state.todoOpen) todoTidy(); state.todoArm = ''; render(); },
  'todo-close': () => {
    if (!state.todoOpen) return;
    state.todoOpen = false;
    state.todoArm = '';
    todoTidy();
    render();
  },

  // The line under a stuck note, which is the way back into the same question.
  'todo-why': (el) => {
    const row = findRow('todos', el.dataset.id);
    if (!row) return;
    state.todoWhy = { id: row.id, draft: String(row.blocked || '') };
    state.focusField = 'todo-why-draft';
    render();
  },
  'todo-why-skip': () => { state.todoWhy = null; render(); },
  'todo-why-save': () => {
    const w = state.todoWhy;
    const row = w && findRow('todos', w.id);
    if (!row) { state.todoWhy = null; render(); return; }
    const said = String(w.draft || '').trim();
    // Saving nothing is the same as not saying, rather than an empty reason.
    if (said) row.blocked = said.slice(0, 500);
    else delete row.blocked;
    touch('todos', row);
    state.todoWhy = null;
    save(); queueSync(0); render();
  },
  'todo-why-clear': () => {
    const w = state.todoWhy;
    const row = w && findRow('todos', w.id);
    if (row) { delete row.blocked; touch('todos', row); save(); queueSync(0); }
    state.todoWhy = null;
    render();
  },

  'todo-add': () => {
    const row = touch('todos', { id: newTodoId(), text: '', status: 'pending', createdAt: Date.now() });
    state.todos = state.todos.concat([row]);
    state.todoOpen = true;
    state.todoArm = '';
    /* The caret goes into the note that was just made — this is the one place
       in the app where opening a field is exactly what was asked for. The list
       is put back to the top with it, since that is where the new note is. */
    state.focusField = `todo-${row.id}`;
    todoScroll = 0;
    /* Saved but not pushed. An empty note is not worth a round trip; the first
       thing typed into it queues one, and a note abandoned empty is swept up
       when the pad closes. */
    save();
    render();
  },

  'todo-del': (el) => {
    const id = String(el.dataset.id || '');
    const row = findRow('todos', id);
    if (!row) return;
    // Written notes take two presses; an empty one has nothing to lose.
    if ((row.text || '').trim() && state.todoArm !== id) { state.todoArm = id; render(); return; }
    state.todos = state.todos.filter((t) => t.id !== id);
    bury('todos', id);
    state.todoArm = '';
    save(); queueSync(0); render();
  },

  /* ── the money pad ── Same shape as the to-do actions above, because it is
     the same object doing a different job. */
  'plan-open': () => {
    state.planOpen = true;
    state.menuOpen = false;
    if (state.m) state.m.accountOpen = false;
    render();
  },
  'plan-toggle': () => { state.planOpen = !state.planOpen; if (!state.planOpen) planTidy(); state.planArm = ''; render(); },
  'plan-close': () => {
    if (!state.planOpen) return;
    state.planOpen = false;
    state.planArm = '';
    planTidy();
    render();
  },

  'plan-add': () => {
    const row = touch('plans', { id: newPlanId(), text: '', amount: 0, status: 'planned', createdAt: Date.now() });
    state.plans = state.plans.concat([row]);
    state.planOpen = true;
    state.planArm = '';
    // Same rule as todo-add: the caret goes where the writing goes.
    state.focusField = `plan-${row.id}`;
    planScroll = 0;
    save();
    render();
  },

  'plan-del': (el) => {
    const id = String(el.dataset.id || '');
    const row = findRow('plans', id);
    if (!row) return;
    // A line with something on it — words or a figure — takes two presses.
    if (((row.text || '').trim() || mCents(row.amount)) && state.planArm !== id) {
      state.planArm = id; render(); return;
    }
    state.plans = state.plans.filter((r) => r.id !== id);
    bury('plans', id);
    state.planArm = '';
    save(); queueSync(0); render();
  },

  /* Paying a line is the one place the pad writes to the ledger, and it writes
     a plain money-out entry: dated today, named after the line, filed under
     its purpose. The plan is then marked paid rather than deleted — a paid
     line is the record that the thing you planned for actually happened, and
     deleting it would make the pad look like the bill was never there.

     One direction only. Editing the entry afterwards does not reach back into
     the plan, and un-marking the plan does not remove the entry: the ledger is
     a record of what happened, and a pad cannot be allowed to rewrite it. */
  'plan-log': (el) => {
    const row = findRow('plans', String(el.dataset.id || ''));
    if (!row) return;
    const value = money2(row.amount);
    if (!value) return;
    const spent = touch('money', {
      id: 'mn' + Date.now(),
      date: todayIso,
      activity: String(row.text || '').trim().slice(0, 200) || 'Planned spend',
      /* The pad allows a line with no purpose yet and the ledger does not, so
         an unfiled line lands under the first purpose the account has — the
         same default the money form opens with. */
      purpose: row.purpose || (state.purposes[0] || {}).name || 'Other',
      in: 0, out: value, note: ''
    });
    state.money = state.money.concat([spent]);
    row.status = 'paid';
    touch('plans', row);
    state.selectedDate = todayIso;
    save(); queueSync(0);
    flash(`Logged · ${amount(value)}`);
    render();
  },

  'menu-toggle': () => { state.menuOpen = !state.menuOpen; render(); },
  'menu-close': () => { if (state.menuOpen) { state.menuOpen = false; render(); } },

  'close-account': () => {
    state.menuOpen = false;
    if (state.m) state.m.accountOpen = false;
    state.closing = { typed: '', busy: false, error: '', done: false };
    render();
  },
  'close-account-cancel': () => { state.closing = null; render(); },

  'close-account-go': () => {
    const c = state.closing;
    if (!c || c.busy) return;
    const email = (state.auth && state.auth.email) || '';
    if (String(c.typed || '').trim().toLowerCase() !== email.toLowerCase()) {
      state.closing = Object.assign({}, c, { error: 'Type the address exactly to confirm.' });
      render();
      return;
    }
    state.closing = Object.assign({}, c, { busy: true, error: '' });
    render();
    API.closeAccount()
      .then(() => {
        /* Local first, then the session. The server row is already gone; what
           is left here is a copy of something that no longer exists, and
           leaving it would be the exact resurrection this whole change is
           about. */
        resetLocal();
        state.account = null;
        state.accountId = null;
        state.auth = null;
        state.team = null;
        save();
        state.closing = { done: true };
        render();
      })
      .catch((err) => {
        state.closing = Object.assign({}, state.closing, {
          busy: false, error: err.message || 'That did not go through. Try again in a moment.'
        });
        render();
      });
  },

  'closed-done': () => {
    state.closing = null;
    state.route = 'home';
    try { history.replaceState({ route: 'home' }, '', '/'); } catch (e) { /* file:// */ }
    location.reload();
  },

  'help-open': () => {
    /* A fresh draft each time. Keeping the last one would mean a message
       already sent reappearing in the box, which reads as "it did not go". */
    state.help = { email: '', subject: '', body: '', busy: false, error: '', ref: '' };
    render();
  },
  'help-close': () => { state.help = null; render(); },

  'help-send': () => {
    const h = state.help;
    if (!h || h.busy) return;
    const email = state.auth ? state.auth.email : String(h.email || '').trim();
    if (!state.auth && !email) { state.help = Object.assign({}, h, { error: 'We need an email address to reply to.' }); render(); return; }
    if (!String(h.subject || '').trim()) { state.help = Object.assign({}, h, { error: 'What is it about?' }); render(); return; }
    if (!String(h.body || '').trim()) { state.help = Object.assign({}, h, { error: 'Tell us what is happening and we will look.' }); render(); return; }

    state.help = Object.assign({}, h, { busy: true, error: '' });
    render();
    API.support({ email, subject: h.subject, body: h.body })
      .then((out) => {
        /* Replaced by the receipt rather than closed: a dialog that vanishes
           takes the reference number with it, and that number is the only
           thing the sender has to quote. */
        state.help = { ref: out.ref, delivered: !!out.delivered, email, busy: false, error: '' };
        render();
      })
      .catch((err) => {
        state.help = Object.assign({}, state.help, {
          busy: false, error: err.message || 'That did not send. Try again in a moment.'
        });
        render();
      });
  },
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
    const pending = state.aiPending;
    state.aiConsent = true;
    state.aiAsking = null;
    state.aiPending = null;
    writeJson(AI_CONSENT_KEY, true);
    render();
    // 'auto' means the refine question raised this, and it remembers what it
    // was about — which entry, and which of the two estimators it needs.
    if (scope === 'auto') {
      if (pending) runRefine(pending.kind, state.entries.find((r) => r.id === pending.id) || { date: pending.date });
      return;
    }
    if (scope) refineFood(scope);
  },
  'ai-decline': () => { state.aiAsking = null; state.aiPending = null; render(); },

  'donate-close': () => { state.donateOpen = false; render(); },
  'donate-go': () => {
    noteDonateClick();
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
    /* One at a time. Two or three drawers open at once turned the page into a
       scroll with no landmarks — opening the next one now folds away the last,
       so what you just asked for is what is in front of you. */
    const accordion = opening;

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
    state.stepsAt[date] = Date.now();
    state.dirty.steps = true;
    state.stepsOpen = null; state.stepsDraft = '';
    save(); queueSync(0); render();
    flash(state.steps[date] ? `Saved · ${state.steps[date].toLocaleString('en-US')} steps` : 'Steps cleared');
  },
  'steps-clear': () => {
    if (state.stepsOpen) {
      delete state.steps[state.stepsOpen];
      // Stamped rather than forgotten: a deletion has to be able to win over
      // the count another device is still holding.
      state.stepsAt[state.stepsOpen] = Date.now();
      state.dirty.steps = true;
    }
    state.stepsOpen = null; state.stepsDraft = '';
    save(); queueSync(0); render(); flash('Steps cleared');
  },

  'open-report': () => {
    state.reportOpen = true; deckIndex = 0; deckScroll = 0; render();
    /* Remembered so the next visit can have the summary ready before it is
       asked for. Written on first use rather than assumed: the warm-up costs a
       call, and it should only ever be spent on someone who reads these. */
    if (!state.deckUsed) { state.deckUsed = true; writeJson(DECK_USED_KEY, true); }
    // After the render, so the deck is on screen while the prose is written.
    fetchDeckSummary(deckView());
  },
  'close-report': () => { state.reportOpen = false; render(); },
  'export-pdf': () => window.print(),

  /* Navigation moves the scroller, not the state: re-rendering the deck to
     change card would rebuild the track and lose the position it was being
     asked to change. */
  'deck-next': () => deckGo(deckIndex + 1),
  'deck-prev': () => deckGo(deckIndex - 1),
  'deck-go': (el) => deckGo(Number(el.dataset.i)),

  'deck-range': (el) => {
    if (state.deckRange === el.dataset.key) return;
    state.deckRange = el.dataset.key;
    // A different window is a different set of cards; the track is rebuilt at
    // the start rather than left pointing at a card that may no longer exist.
    deckIndex = 0; deckScroll = 0;
    save(); render();
    // Each window gets its own summaries, cached, so coming back is free.
    fetchDeckSummary(deckView());
  },

  'share-card': () => shareCard(),

  /* ── searchable picker ── */
  'pick-open': (el) => {
    const kind = el.dataset.pick;
    state.pickOpen = state.pickOpen === kind ? null : kind;
    state.pickQuery = '';
    // Opening lands the caret in the search box, or the search is a step away.
    if (state.pickOpen) { state.focusField = 'pick-search'; pickJustOpened = true; }
    render();
  },
  'pick-close': () => {
    state.pickOpen = null; state.pickQuery = '';
    state.pickNew = null; state.pickNewName = '';
    if (state.m) { state.m.pickNew = false; state.m.pickNewName = ''; }
    render();
  },
  'pick-choose': (el) => {
    const name = el.dataset.name;
    if (el.dataset.pick === 'purpose') state.mForm = Object.assign({}, state.mForm, { purpose: name });
    else if (el.dataset.pick === 'timer-cat') { state.timerCategory = name; save(); }
    else state.form = Object.assign({}, state.form, { category: name });
    state.pickOpen = null; state.pickQuery = '';
    render();
  },
  /* Opens the naming row inside the popover, seeded with whatever was typed
     into the search — someone who searched for a name that is not there has
     already told us what it should be called. */
  'pick-new': (el) => {
    state.pickNew = el.dataset.pick;
    state.pickNewName = state.pickQuery.trim();
    state.focusField = 'pick-new-name';
    render();
  },
  'chat-open': () => {
    if (!state.aiEstimates) return;
    state.chat.open = true; state.chat.error = '';
    // No focusField: opening the panel must not raise the keyboard. Typing is
    // one tap away and the mic is the point of it.
    render();
  },
  'chat-close': () => {
    state.chat.open = false;
    chatStopListening();
    stopSpeaking();
    render();
  },
  'chat-send': () => chatSend(),
  'chat-seed': (el) => chatSend(el.dataset.q || ''),
  'chat-listen': () => chatListen(),
  'chat-speak': () => {
    state.chat.speak = !state.chat.speak;
    writeJson(CHAT_SPEAK_KEY, state.chat.speak);
    if (!state.chat.speak) stopSpeaking();
    render();
  },
  'chat-consent-yes': () => {
    state.chatConsent = true;
    state.chatAsking = false;
    writeJson(CHAT_CONSENT_KEY, true);
    render();
    // Whatever was typed when the question was raised is still in the box.
    if (state.chat.draft.trim()) chatSend();
  },
  'chat-consent-no': () => { state.chatAsking = false; render(); },

  'refine-yes': () => refineAnswer(true),
  'refine-no': () => refineAnswer(false),
  'refine-remember': () => { state.refineRemember = !state.refineRemember; render(); },

  /* The standing answers, and the way back out of them. "ask" is the third
     state both of these have — null rather than false, since false is itself
     an answer ("never refine") and not the same as having none. */
  /* Opened from the readout itself, seeded with what the bar currently says —
     so the dialog starts as an edit of the times on screen, not as a blank. */
  'm-time-type': () => {
    const s2 = state.m;
    state.m.timeEdit = { from: hm(s2.startMin), to: hm((s2.startMin + s2.durMin) % 1440) };
    state.focusField = 'm-time-from';
    render();
  },
  'm-time-close': () => { state.m.timeEdit = null; render(); },
  'm-time-save': () => {
    const t = state.m.timeEdit;
    if (!t) return;
    /* A cleared field is not a time — parseHm would read it as midnight. The
       dialog stays open, and now says which one it is waiting for: a button
       that does nothing is indistinguishable from a broken one. */
    if (!t.from || !t.to) {
      state.m.timeEdit = Object.assign({}, t, {
        error: !t.from && !t.to ? 'Both times are needed.'
          : !t.from ? 'Say when it started.' : 'Say when it ended.'
      });
      state.focusField = `m-time-${!t.from ? 'from' : 'to'}`;
      render();
      return;
    }
    const start = Math.max(0, Math.min(1439, parseHm(t.from)));
    const span = ((parseHm(t.to) - start) + 1440) % 1440;
    state.m.startMin = start;
    state.m.durMin = Math.max(1, Math.min(M_SPAN_MAX, span));
    state.m.timeEdit = null;
    render();
  },

  /* ── team ── */
  'team-open': () => {
    state.teamOpen = true;
    state.teamError = ''; state.teamNotice = '';
    render();
    // Refreshed on open rather than trusted from boot: someone may have been
    // added or removed since this tab was loaded.
    loadTeam().then(render);
  },
  'team-close': () => {
    // Nothing behind it means anything yet. See teamSheet().
    if (workMode() && state.team && !state.team.team) return;
    teamDrawerScroll = 0;
    state.teamOpen = false;
    state.teamInviteLink = '';
    state.teamError = ''; state.teamNotice = '';
    render();
  },
  'team-tab': (el) => {
    state.teamTab = el.dataset.v;
    state.teamError = ''; state.teamNotice = '';
    // A different tab is a different list, so it starts at its own top.
    teamDrawerScroll = 0;
    render();
    if (state.teamTab === 'dashboard') loadTeamDashboard();
  },
  'team-create': () => {
    const name = state.teamName.trim();
    if (!name) { state.teamError = 'A team needs a name.'; render(); return; }
    teamDo('create', () => API.team.create(name), 'Team created.').then(() => { state.teamName = ''; render(); });
  },
  /* Both of these end the same way, so they say it in one place: whether the
     email actually went, and the link either way.

     The notice used to read "Invited them." whatever happened, which is how an
     admin ends up believing an email was sent when none was. */
  'team-invite': () => {
    const email = state.teamInviteEmail.trim();
    if (!email) { state.teamError = 'Who are you inviting?'; render(); return; }
    teamDo('invite', () => API.team.invite(email, state.teamInviteRole)).then((out) => {
      if (!out) return;
      state.teamInviteEmail = '';
      noteInvite(out);
    });
  },

  'team-resend': (el) => {
    const email = el.dataset.v;
    teamDo('resend', () => API.team.resend(email)).then((out) => {
      if (!out) return;
      noteInvite(out, true);
    });
  },
  'team-live-open': (el) => {
    const id = Number(el.dataset.id);
    state.teamLiveOpen = state.teamLiveOpen === id ? null : id;
    render();
  },
  'team-live-refresh': () => { loadTeamLive(false); },
  'team-revoke': (el) => teamDo('revoke', () => API.team.revoke(el.dataset.v), 'Invitation withdrawn.'),
  'team-role': (el) => teamDo('role', () => API.team.role(Number(el.dataset.id), el.dataset.v), 'Role changed.'),
  'team-remove': (el) => teamDo('remove', () => API.team.remove(Number(el.dataset.id)), 'Removed from the team.'),
  'team-project-add': () => {
    const name = state.teamProjectName.trim();
    if (!name) { state.teamError = 'A project needs a name.'; render(); return; }
    teamDo('project', () => API.team.project({ name, position: teamProjects().length }))
      .then(() => { state.teamProjectName = ''; render(); });
  },
  'team-project-drop': (el) => teamDo('project', () => API.team.dropProject(el.dataset.v), 'Project removed.'),

  'prefs-open': () => { state.prefsOpen = true; render(); },
  'prefs-close': () => { state.prefsOpen = false; render(); },
  'pref-deduct': (el) => {
    const v = el.dataset.v;
    state.deductAlways = v === 'ask' ? null : v === 'true';
    save();
    render();
  },
  'pref-refine': (el) => {
    const v = el.dataset.v;
    state.refineAlways = v === 'ask' ? null : v === 'true';
    save();
    render();
  },
  /* Withdrawn, never granted here. Consent belongs to the question that says
     what leaves the device; a settings toggle would be agreement to a label. */
  'pref-revoke-ai': () => { state.aiConsent = false; dropJson(AI_CONSENT_KEY); render(); },
  'pref-revoke-chat': () => { state.chatConsent = false; dropJson(CHAT_CONSENT_KEY); render(); },
  'prefs-reset': () => {
    state.deductAlways = null;
    state.refineAlways = null;
    state.aiConsent = false;
    state.chatConsent = false;
    dropJson(AI_CONSENT_KEY);
    dropJson(CHAT_CONSENT_KEY);
    save();
    flash('Every question is back');
    render();
  },

  'recap-yes': () => {
    markRecapSeen();
    state.recapAsk = false;
    state.deckRange = 'yesterday';
    state.reportOpen = true;
    deckIndex = 0; deckScroll = 0;
    render();
  },
  // Either answer settles the day. "Not now" means not now, not "ask again in
  // a minute", so it is marked seen exactly like a yes.
  'recap-no': () => { markRecapSeen(); state.recapAsk = false; render(); },

  'cal-open': (el) => {
    state.calOpen = { kind: el.dataset.kind, scope: el.dataset.scope };
    render();
  },
  'cal-close': () => { state.calOpen = null; render(); },

  'pick-rename': (el) => {
    state.pickRename = { kind: el.dataset.pick, name: el.dataset.name };
    state.pickRenameName = el.dataset.name || '';
    // Tapping "rename" is asking to type, so the caret belongs in the field.
    state.focusField = 'pick-rename-name';
    render();
  },
  'pick-rename-cancel': () => {
    state.pickRename = null; state.pickRenameName = ''; clearFocus(); render();
  },
  'pick-rename-save': () => renamePick(),

  'pick-del': (el) => {
    state.pickDelete = { kind: el.dataset.pick, name: el.dataset.name };
    render();
  },
  'pick-del-cancel': () => { state.pickDelete = null; render(); },
  'pick-del-confirm': () => {
    const t = state.pickDelete;
    if (!t) return;
    const money = t.kind === 'purpose';
    const kind = money ? 'money' : 'entries';
    // Every row under it goes, each tombstoned so the deletion travels rather
    // than the rows coming back on the next pull.
    (money ? state.money : state.entries)
      .filter((r) => (money ? r.purpose : r.category) === t.name)
      .forEach((r) => bury(kind, r.id));
    if (money) state.money = state.money.filter((r) => r.purpose !== t.name);
    else state.entries = state.entries.filter((r) => r.category !== t.name);

    const vocab = money ? 'purposes' : 'categories';
    state[vocab] = state[vocab].filter((c) => c.name !== t.name);
    bury(vocab, t.name);

    // Anything still pointing at the name it just lost.
    if (state.timerCategory === t.name) state.timerCategory = (state.categories[0] || {}).name || '';
    if (state.form.category === t.name) state.form = Object.assign({}, state.form, { category: state.timerCategory });
    if (state.mForm.purpose === t.name) state.mForm = Object.assign({}, state.mForm, { purpose: (state.purposes[0] || {}).name || '' });
    if (state.m && state.m.cat === t.name) state.m.cat = null;

    state.pickDelete = null;
    state.pickOpen = null; state.pickQuery = '';
    save(); queueSync(0); render();
    flash(`Deleted · ${t.name}`);
  },
  'pick-create': (el) => {
    const kind = el.dataset.pick || state.pickNew;
    const name = String(state.pickNewName || '').trim().slice(0, 60);
    if (!name) { state.pickNew = null; state.pickNewName = ''; render(); return; }
    if (kind === 'purpose') {
      addPurposeIfNeeded(name);
      state.mForm = Object.assign({}, state.mForm, { purpose: name });
    } else if (kind === 'timer-cat') {
      addCategoryIfNeeded(name);
      state.timerCategory = name;
    } else {
      addCategoryIfNeeded(name);
      state.form = Object.assign({}, state.form, { category: name });
    }
    state.pickNew = null; state.pickNewName = '';
    state.pickOpen = null; state.pickQuery = '';
    save(); queueSync(0); render();
  }
};

const CHANGES = {
  /* A select rather than a row of chips: four statuses is more than a toggle
     and less than a menu, it costs one tap, and it opens no keyboard. */
  /* The money pad's two selects. Status moves the line up or down the pad;
     purpose is what the spend will be filed under when it is paid, and is
     allowed to be nothing at all until then. */
  'plan-status': (el) => {
    const row = findRow('plans', el.dataset.id);
    const want = String(el.value || '');
    if (!row || row.status === want || !PLAN_STATUSES.some((o) => o.key === want)) return;
    row.status = want;
    touch('plans', row);
    state.planArm = '';
    save(); queueSync(0); render();
  },
  'plan-purpose': (el) => {
    const row = findRow('plans', el.dataset.id);
    if (!row) return;
    const want = String(el.value || '');
    if (want) row.purpose = want; else delete row.purpose;
    touch('plans', row);
    save(); queueSync(0); render();
  },

  'todo-status': (el) => {
    const row = findRow('todos', el.dataset.id);
    const want = String(el.value || '');
    if (!row || row.status === want || !TODO_STATUSES.some((o) => o.key === want)) return;
    row.status = want;
    touch('todos', row);
    state.todoArm = '';
    /* The status is set either way — the question is asked after the fact, not
       as a toll on the way through. Only when there is nothing on file: a note
       that goes back to being stuck for the reason it already names does not
       need asking again, and the line under it is there to edit. */
    if (want === 'stuck' && !String(row.blocked || '').trim()) {
      state.todoWhy = { id: row.id, draft: '' };
      state.focusField = 'todo-why-draft';
    }
    save(); queueSync(0); render();
  },

  'entry-activity': (el) => updateEntry(el.dataset.id, { activity: el.value }),
  'log-filter': (el) => { state.logFilter = el.value || ''; render(); },
  'entry-category': (el) => updateEntry(el.dataset.id, { category: el.value }),
  /* ── team ──
     Each edit goes straight to the server rather than into a local copy: these
     are somebody else's rows, they do not live in this device's state, and
     there is nothing here for the sync to carry. */
  'team-invite-role': (el) => { state.teamInviteRole = el.value; },
  'team-member': (el) => {
    state.teamMemberId = el.value || null;
    state.teamRows = [];
    if (state.teamMemberId) loadTeamHours();
    else render();
  },
  'team-edit-activity': (el) => teamEdit(el.dataset.id, { activity: el.value }),
  /* Clearing the box on a row that exists is the same mistake as leaving it
     blank on a new one, and would write midnight over a real time. The row
     keeps what it had; the re-render puts the old value back in the field,
     which is the only answer a cleared box needs. */
  'team-edit-from': (el) => (String(el.value || '').trim()
    ? teamEdit(el.dataset.id, { from: parseHm(el.value) }) : scheduleRender()),
  'team-edit-to': (el) => (String(el.value || '').trim()
    ? teamEdit(el.dataset.id, { to: parseHm(el.value) }) : scheduleRender()),
  'team-edit-project': (el) => teamEdit(el.dataset.id, { project: el.value }),

  'entry-from': (el) => editEntryTime(el, 'from'),
  'entry-to': (el) => editEntryTime(el, 'to'),
  'money-activity': (el) => updateMoney(el.dataset.id, { activity: el.value }),
  'money-purpose': (el) => updateMoney(el.dataset.id, { purpose: el.value }),
  'money-in': (el) => updateMoney(el.dataset.id, { in: money2(el.value) }),
  'money-out': (el) => updateMoney(el.dataset.id, { out: money2(el.value) })
};

/* ═════════════════════ mobile — progressive logging ═════════════════════

   One flow that logs both time and money in two or three taps a step, plus
   the day it lives in: a live timer, an end-of-day gap review, first-run
   setup, insights, entry detail and a donate path.

   It takes the whole viewport on a phone rather than sitting beside the
   desktop layout, because the two answer different questions — the desktop
   page is for reading a month, this is for logging ten seconds ago. The data
   underneath is the same: the same `entries` and `money` rows, the same
   client-minted ids, the same `updated_at` stamp, so anything logged here
   syncs and reads back there with no translation.

   The rule the whole flow is built around: nothing takes focus unless the
   user asked for a keyboard. Every closed field is a button, and only six
   affordances in the entire experience can mint a focused input. */

/* ── vocabulary ──
   What a brand-new account is offered at setup. Once it has categories of its
   own these are consulted for two things only: a sub-line for a name they
   recognise, and a starting colour. Everything else comes off the account. */
const M_CATS = [
  { name: 'Work', color: '#7856f5', sub: 'deep + shallow', acts: ['Client call', 'Focus block', 'Email', 'Standup'] },
  { name: 'Health', color: '#22a67a', sub: 'move + rest', acts: ['Gym', 'Walk', 'Run', 'Stretch'] },
  { name: 'Food', color: '#e0913a', sub: 'meals + prep', acts: ['Breakfast', 'Lunch', 'Dinner', 'Cooking'] },
  { name: 'Family', color: '#e05a8a', sub: 'people time', acts: ['Kids', 'Call home', 'Dinner out'] },
  { name: 'Learning', color: '#4f46e5', sub: 'books + courses', acts: ['Reading', 'Course', 'Practice'] },
  { name: 'Rest', color: '#9995ab', sub: 'sleep + idle', acts: ['Nap', 'Scrolling', 'TV'] }
];
const M_PURPOSES = [
  { name: 'Food', color: '#e0913a', sub: 'groceries, eating out', acts: ['Groceries', 'Coffee', 'Lunch out'] },
  { name: 'Transport', color: '#3f4bc4', sub: 'fares, fuel', acts: ['Grab', 'Jeepney', 'Fuel'] },
  { name: 'Bills', color: '#756f88', sub: 'rent, utilities', acts: ['Electric', 'Internet', 'Rent'] },
  { name: 'Health', color: '#22a67a', sub: 'meds, checkups', acts: ['Pharmacy', 'Clinic'] },
  { name: 'Fun', color: '#e05a8a', sub: 'going out', acts: ['Movie', 'Drinks'] },
  { name: 'Income', color: '#7856f5', sub: 'salary, gigs', acts: ['Salary', 'Freelance'] }
];
// Setup offers these four; only the first two are on to begin with, because
// they are the two the app is actually built out of.
const M_TRACKS = [
  { key: 'time', name: 'Time', sub: 'Hours by activity' },
  { key: 'money', name: 'Money', sub: 'In and out' },
  { key: 'steps', name: 'Steps', sub: 'From your phone' },
  { key: 'meals', name: 'Meals', sub: 'What you ate' }
];
/* The picker's order, which is not the storage order in CURRENCIES — the
   dirham leads here because it is the default a new account is offered. */
const M_CURRENCIES = [
  { code: 'AED', glyph: 'Dhs' }, { code: 'USD', glyph: '$' }, { code: 'PHP', glyph: '₱' },
  { code: 'EUR', glyph: '€' }, { code: 'SGD', glyph: 'S$' }, { code: 'HKD', glyph: 'HK$' }
];

/* ── the look ──
   Values rather than classes only where the design system has no equivalent:
   the gradient is a token, the two chip states are used by a dozen controls,
   and repeating either by hand is how they drift apart. */
const M_GRAD = 'var(--grad-brand)';
const M_GRAD_FLAT = 'linear-gradient(115deg,#8b5cf6,#4f46e5)';
const M_HAIR = '1px solid rgba(47,28,102,.08)';
const M_SHADOW_SM = '0 1px 2px rgba(47,28,102,.09)';
const M_SHADOW_MD = '0 4px 14px rgba(47,28,102,.09)';
const M_LIFT = '0 14px 34px rgba(79,70,229,.3)';

// Chips, pills and cards all pick a side of the same two-state switch.
const mChip = (on) => on
  ? `background:${M_GRAD_FLAT};color:#fff;border:1px solid transparent;`
  : 'background:#fff;color:#3b3648;border:1px solid rgba(47,28,102,.12);';
// The uppercase micro-label that heads nearly every group in the flow.
const mLabel = (text, right) => `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">
    <span style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;">${esc(text)}</span>
    ${right || ''}
  </div>`;
const mHead = (title, hint) => `
  <h3 style="margin:0 0 6px;font-family:var(--font-heading);font-weight:700;font-size:26px;line-height:1.15;color:#16131f;">${esc(title)}</h3>
  <p style="margin:0 0 20px;font-size:14px;color:#756f88;line-height:1.45;">${esc(hint)}</p>`;

/* ── formatting ──
   Minutes since midnight are the currency of this whole file; they become
   text here and nowhere else. */

// 9am, 10:45am — the minutes only when there are some, which is how a time is
// said out loud.
const mClock = (min) => {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + pad(m) : ''}${h >= 12 ? 'pm' : 'am'}`;
};
const mDur = (min) => {
  const n = Math.max(0, Math.round(min));
  const h = Math.floor(n / 60), m = n % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
};
const mRange = (start, dur) => `${mClock(start)} – ${mClock(start + dur)}`;

/* Money is summed in minor units and divided once at the end. Adding a column
   of floats drifts; adding a column of integers cannot. */
const mCents = (n) => Math.round((Number(n) || 0) * 100);
const mSumCents = (rows, key) => rows.reduce((a, r) => a + mCents(r[key]), 0);

/* ── the running balance ──
   Read by both layouts, which is why it lives in one place: what came in, how
   much of the spending counts against it, and what is left.

   Every row ever logged, not the window on screen. This is an account, not a
   report: money in one week is still there the next, and spending is a
   withdrawal against the whole of it. Scoped to a window the figure would
   reset every Monday and read as money appearing out of nowhere.

   A spend marked off-budget is still logged and still in every other total.
   It is held out of this one only, because "have I spent more than came in"
   is a different question from "what did I spend" — a reimbursed expense or
   money drawn from savings answers the second and not the first.

   Summed in minor units and divided once at the end: these are the figures
   someone checks against a bank app, and cents that drift are worse than no
   figure at all. */
// Everything live. Deleted rows are removed from state on delete, so there is
// nothing here to filter — the tombstone lives elsewhere.
const moneyAll = () => state.money;

function moneyBalance(rows) {
  const inCents = mSumCents(rows, 'in');
  const outCents = mSumCents(rows, 'out');
  const asideCents = rows.reduce((a, r) => a + (r.offBudget ? mCents(r.out) : 0), 0);
  const countedCents = outCents - asideCents;
  return {
    inCents, outCents, asideCents, countedCents,
    leftCents: inCents - countedCents,
    asideCount: rows.filter((r) => r.offBudget && mCents(r.out) > 0).length
  };
}

/* The sentence that goes with it. One writer for both layouts — the formatter
   is passed in rather than the wording duplicated, so the phone and the laptop
   cannot end up saying different things about the same numbers. */
function moneyStatus(rows) {
  const b = moneyBalance(rows);
  const f = (cents) => amount(Math.abs(cents) / 100);
  const aside = b.asideCents
    ? ` ${f(b.asideCents)} is held aside across ${b.asideCount} ${b.asideCount === 1 ? 'entry' : 'entries'}.`
    : '';
  if (!b.inCents) {
    return Object.assign(b, {
      tone: 'none',
      short: `nothing in to take it from`,
      line: `Nothing logged coming in yet, so ${f(b.countedCents)} out has nothing to come from.${aside}`
    });
  }
  if (b.leftCents >= 0) {
    return Object.assign(b, {
      tone: 'left',
      short: `${f(b.leftCents)} left of ${f(b.inCents)} in`,
      line: `${f(b.leftCents)} left — ${f(b.inCents)} in, ${f(b.countedCents)} out.${aside}`
    });
  }
  return Object.assign(b, {
    tone: 'over',
    short: `${f(b.leftCents)} past what came in`,
    line: `${f(b.leftCents)} past what came in — ${f(b.countedCents)} out against ${f(b.inCents)} in.${aside}`
  });
}
const mMoney = (n) => amount(n);
// The bare glyph for the tiles, without the dirham's trailing space.
const mGlyph = () => currency().symbol.trim();

const mShiftIso = (isoDate, delta) => {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return iso(d);
};
const mLongDate = (isoDate) => new Date(isoDate + 'T00:00:00')
  .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const mKicker = (isoDate) => new Date(isoDate + 'T00:00:00')
  .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

/* ── the account's own vocabulary ──
   The grids are drawn from `categories` and `purposes`, in the order the
   account keeps them, not from the authored lists above. */
const mVocab = (money) => {
  const all = (money ? state.purposes : state.categories).slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0) || byName(a, b));
  if (money || !workMode()) return all;
  // Same rule as pickCategories, for the phone's own picker.
  const names = new Set(teamProjects().filter((p) => !p.archived).map((p) => p.name));
  return all.filter((c) => names.has(c.name));
};

const mAuthored = (name, money) => (money ? M_PURPOSES : M_CATS).find((c) => c.name === name);

const mColor = (name, money) => {
  const row = (money ? state.purposes : state.categories).find((c) => c.name === name);
  if (row && row.color) return row.color;
  const a = mAuthored(name, money);
  return a ? a.color : '#9995ab';
};

/* The "usual ones" pills. Drawn from what this account actually logs under
   that name, most-used first, and only topped up from the authored list when
   there is not enough history to fill the row — a suggestion that is really a
   suggestion beats four that were written by someone else. */
function mActs(name, money) {
  const rows = (money ? state.money : state.entries)
    .filter((r) => (money ? r.purpose : r.category) === name);
  const seen = {};
  rows.forEach((r) => {
    const a = String(r.activity || '').trim();
    if (a) seen[a] = (seen[a] || 0) + 1;
  });
  const mine = Object.keys(seen)
    .sort((a, b) => seen[b] - seen[a] || a.localeCompare(b))
    .slice(0, 4);
  const authored = mAuthored(name, money);
  const pad2 = authored ? authored.acts.filter((a) => !mine.includes(a)) : [];
  return mine.concat(pad2).slice(0, 4);
}

// The card's sub-line: the authored reading when the name is one of ours,
// otherwise the two things most often logged under it.
function mSub(name, money) {
  const a = mAuthored(name, money);
  if (a) return a.sub;
  const acts = mActs(name, money);
  return acts.length ? acts.slice(0, 2).join(' + ').toLowerCase() : 'your own';
}

/* ── reading the day ──
   Every figure on Today is derived from the rows, so an empty day is empty
   rather than zeroed-out placeholder. */

// Where the day stops for gap review. Null means nobody has said, and 10pm is
// the assumption the flow was designed against.
const mDayEnd = () => (state.sleepMin == null ? 1320 : state.sleepMin);

/* ── the window ──
   The five spans Today can be read over. DECK_RANGES is the source rather than
   a second list of the same five: the report deck already defines them, and two
   lists of windows are two chances for them to disagree about what "2 Weeks"
   means. */
const mRangeKey = () => state.m.range || 'today';
const mRangeDef = (key) => DECK_RANGES.find((r) => r[0] === (key || mRangeKey())) || DECK_RANGES[0];

function mRangeDates(key) {
  const def = mRangeDef(key);
  const days = RANGE_DAYS[def[2]] || 1;
  const end = mShiftIso(todayIso, -def[3]);
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(mShiftIso(end, -i));
  return out;
}
const mIsSingleDay = (key) => mRangeDates(key).length === 1;
// The one day a per-day reading applies to. Only meaningful on the two
// single-day windows; the gap banner and review are hidden on the others.
const mSelectedDay = () => mRangeDates()[mRangeDates().length - 1];

const mRangeHeading = (key) => {
  const k = key || mRangeKey();
  if (k === 'today') return 'Today';
  if (k === 'yesterday') return 'Yesterday';
  return { week: 'This week', fortnight: 'Last 2 weeks', month: 'This month',
    quarter: 'Last 3 months', half: 'Last 6 months', year: 'Last 12 months' }[k] || 'This week';
};
const mRangeKicker = (key) => {
  const dates = mRangeDates(key);
  if (dates.length === 1) return mKicker(dates[0]);
  const from = dates[0], to = dates[dates.length - 1];
  /* A year's window runs from one August to the next, and "Aug 22 — Aug 21"
     reads as a day short of nothing at all. Once the two ends fall in
     different years, both of them say which. */
  const label = from.slice(0, 4) === to.slice(0, 4)
    ? dayLabel
    : (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${label(from)} — ${label(to)}`;
};

// Every reading below takes the window as a list of dates, so one day and
// thirty are the same code path rather than two that can drift.
/* A Set rather than indexOf on the array. These are called once per day of
   the window and once per bucket on top of that, so a linear scan of the dates
   for every row was fine at 30 days and quadratic at 365: a year's window over
   a couple of thousand entries came to nine figures of string comparisons per
   render, which is a phone locking up rather than a chart appearing. */
const mRowsIn = (list, dates) => {
  const set = dates instanceof Set ? dates : new Set(dates);
  return list.filter((e) => set.has(e.date));
};
const mTimeRows = (dates) => mRowsIn(state.entries, dates);
/* One choke point for every money figure the phone draws: the day list, the
   bars, the range totals and the food report all come through here. A team
   account cannot log money, but a state saved before the account joined one
   still carries rows — and a spend showing up in a day of work hours is the
   one thing this product is separated to prevent. See workMode(). */
const mMoneyRows = (dates) => (workMode() ? [] : mRowsIn(state.money, dates));

/* One list, timed rows in clock order and the money after them — money has no
   position on a clock, and interleaving it by insertion time made the day read
   as though it had happened out of order. */
function mDayList(dates) {
  const time = mTimeRows(dates).slice()
    .sort((a, b) => (Number(a.from) || 0) - (Number(b.from) || 0))
    .map((e) => ({
      kind: 'time', id: e.id, date: e.date, title: e.activity, cat: e.category,
      start: Number(e.from) || 0, dur: span(e), note: e.note || ''
    }));
  const money = mMoneyRows(dates).map((e) => ({
    kind: 'money', id: e.id, date: e.date, title: e.activity, cat: e.purpose,
    dir: mCents(e.in) > 0 ? 'in' : 'out',
    amount: mCents(e.in) > 0 ? Number(e.in) : Number(e.out), note: e.note || ''
  }));
  return time.concat(money);
}

/* A month of entries is hundreds of rows, and every one of them sits between
   you and the donate card at the foot of the page. The most recent few days
   are shown and the rest folds away — the count on the button says how much is
   behind it, so nothing is hidden without saying so. */
const M_DAYS_SHOWN = 4;

function mEntryDrawer(groups) {
  const open = !!state.drawers.mEntries;
  const shown = open ? groups : groups.slice(0, M_DAYS_SHOWN);
  const rest = groups.length - shown.length;
  const day = (g) => `
    <div style="margin-bottom:18px;">
      <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;margin-bottom:8px;">${esc(mKicker(g.date))}</div>
      <div style="display:flex;flex-direction:column;gap:9px;">${g.rows.map(mEntryRow).join('')}</div>
    </div>`;
  const buried = groups.slice(shown.length).reduce((a, g) => a + g.rows.length, 0);
  return shown.map(day).join('') + (rest > 0 || open ? `
    <button data-act="m-entries-more" aria-expanded="${open}"
      style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:46px;border-radius:14px;cursor:pointer;
             font-family:var(--font-body);font-size:13.5px;font-weight:600;color:#7450e4;background:#fff;border:1px solid rgba(120,86,245,.3);">
      ${open ? 'Show fewer days' : `Show ${rest} more ${rest === 1 ? 'day' : 'days'} · ${buried} ${buried === 1 ? 'entry' : 'entries'}`}
      <span aria-hidden="true">${open ? '▲' : '▼'}</span>
    </button>` : '');
}

/* Over a window, the day is the outer sort and the clock the inner one:
   newest day first, because a month of entries is read from this end. */
function mGroupedList(dates) {
  const rows = mDayList(dates);
  const byDate = {};
  rows.forEach((r) => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  return dates.slice().reverse()
    .filter((d) => byDate[d] && byDate[d].length)
    .map((d) => ({ date: d, rows: byDate[d] }));
}

const mLoggedMins = (dates) => mTimeRows(dates).reduce((a, e) => a + span(e), 0);
const mOutToday = (dates) => mSumCents(mMoneyRows(dates), 'out') / 100;
// The other half of the same window. Out is the number a day is judged by, so
// it keeps the headline; in is what makes out mean anything.
const mInToday = (dates) => mSumCents(mMoneyRows(dates), 'in') / 100;

/* The day-split bar. One segment per category sized by its minutes, tinted at
   descending opacity largest-first, and whatever is left of the day as a faint
   remainder — which on an empty day is the only thing there is. */
function mDayBars(dates) {
  const byCat = {};
  mTimeRows(dates).forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + span(e); });
  const names = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const logged = names.reduce((a, k) => a + byCat[k], 0);
  const bars = names.map((k, i) => ({
    grow: byCat[k], color: `rgba(255,255,255,${Math.max(0.3, 0.94 - i * 0.13).toFixed(2)})`
  }));
  /* The remainder — the part of the day nothing was logged against — is the
     point of this bar on a single day: 24 hours is a budget you can read
     against. Over a week it is not. Nobody logs sleep, so the unlogged share
     of any multi-day window is most of it, and the bar collapses into a sliver
     of colour against a wash of nothing whatever the person actually did.

     So the budget framing belongs to one day. Over a window the bar shows how
     the logged time divided, which is the question a week is actually asking. */
  if (dates.length === 1) {
    const capacity = 1440;
    if (logged < capacity) bars.push({ grow: capacity - logged, color: 'rgba(255,255,255,.22)' });
  }
  return bars;
}

/* Unlogged stretches, walking a cursor from 6am to bedtime. Overlapping
   entries move the cursor by whichever ends later, so two things logged over
   each other do not invent a gap between them. Anything under half an hour is
   not worth being asked about. */
function mGaps(dateIso) {
  const end = mDayEnd();
  const spans = mTimeRows([dateIso])
    .map((e) => ({ a: Number(e.from) || 0, b: (Number(e.from) || 0) + span(e) }))
    .sort((x, y) => x.a - y.a);
  const out = [];
  let cursor = 360;
  spans.forEach((t) => {
    if (t.a - cursor >= 30) out.push({ a: cursor, b: Math.min(t.a, end) });
    cursor = Math.max(cursor, t.b);
  });
  if (end - cursor >= 30) out.push({ a: cursor, b: end });
  return out.filter((g) => g.b - g.a >= 30);
}
const mGapTotal = (list) => list.reduce((a, g) => a + (g.b - g.a), 0);

/* ── reading the week ── */

// Which window Insights is read over. Its own, not Today's: one is for logging
// a day and the other for reading a stretch, and a control that moved both
// would keep answering a question you had not asked.
const mInsightKey = () => state.m.insightRange || 'week';
const mInsightDates = () => mRangeDates(mInsightKey());
/* How the written line names its own window. Two forms, because the sentences
   need different grammar: one follows "took 48% of …" and has to be a noun,
   the other follows "of your spending …" and has to be a time. Using the noun
   in both is what produced "of your spending your logged month". */
const mInsightPhrase = () => ({
  today: 'today', yesterday: 'yesterday', week: 'your logged week',
  fortnight: 'your last two weeks', month: 'your logged month',
  quarter: 'your last three months', half: 'your last six months', year: 'your logged year'
}[mInsightKey()] || 'your logged week');
const mInsightWhen = () => ({
  today: 'today', yesterday: 'yesterday', week: 'this week',
  fortnight: 'over the last two weeks', month: 'this month',
  quarter: 'over the last three months', half: 'over the last six months', year: 'over the last year'
}[mInsightKey()] || 'this week');

/* The bars. Over several days that is one bar per day; over a single day a
   day-by-day chart would be one bar and six blanks, so it becomes one bar per
   category instead — the same question, asked at the only resolution the
   window can answer it. */
/* Past a month a bar per day is a picket fence — 365 columns nobody can read
   and no shape you could call a pattern. So the window is bucketed at the
   grain the question is actually asked at: a bar per week over three months,
   a bar per month over six or twelve. Under a month it stays a bar per day,
   which is what "was Tuesday heavy" needs.

   Weeks start on Monday, which is where the working week starts for most
   people who would ask this of a tracker. */
const mGrain = (n) => (n <= 31 ? 'day' : n <= 100 ? 'week' : 'month');

const mMonday = (d) => {
  const t = new Date(d + 'T00:00:00');
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return iso(t);
};

/* Buckets of dates, each with the label its bar wears. A day gets its weekday
   initial, a week the date it starts on, a month its short name — every one of
   them short enough to sit under a 26px column. */
function mBuckets(dates) {
  const grain = mGrain(dates.length);
  const at = (d) => new Date(d + 'T00:00:00');
  if (grain === 'day') {
    return dates.map((d) => ({ key: d, label: at(d).toLocaleDateString('en-GB', { weekday: 'narrow' }), dates: [d] }));
  }
  const out = [];
  let cur = null;
  dates.forEach((d) => {
    const key = grain === 'month' ? d.slice(0, 7) : mMonday(d);
    if (!cur || cur.key !== key) {
      cur = {
        key, dates: [],
        label: grain === 'month'
          ? at(key + '-01').toLocaleDateString('en-GB', { month: 'short' })
          : String(at(key).getDate())
      };
      out.push(cur);
    }
    cur.dates.push(d);
  });
  return out;
}

function mRangeSeries(money) {
  const dates = mInsightDates();
  if (dates.length > 1) {
    return mBuckets(dates).map((b) => ({
      label: b.label,
      v: money ? mSumCents(mMoneyRows(b.dates), 'out') / 100 : mLoggedMins(b.dates),
      color: null
    }));
  }
  const totals = {};
  if (money) mMoneyRows(dates).forEach((e) => { totals[e.purpose] = (totals[e.purpose] || 0) + mCents(e.out); });
  else mTimeRows(dates).forEach((e) => { totals[e.category] = (totals[e.category] || 0) + span(e); });
  return Object.keys(totals)
    .filter((k) => totals[k] > 0)
    .sort((a, b) => totals[b] - totals[a])
    .slice(0, 7)
    .map((k) => ({
      // Long names do not fit under a 45px bar; the colour carries the rest,
      // and the row beneath spells every one of them out in full.
      label: k.length > 6 ? k.slice(0, 5) + '…' : k,
      v: money ? totals[k] / 100 : totals[k],
      color: mColor(k, money)
    }));
}

// Where it went: totals by category or purpose across the chosen window,
// largest first, capped at the rows that fit a phone.
function mWeekSplit(money) {
  const totals = {};
  mInsightDates().forEach((d) => {
    if (money) mMoneyRows([d]).forEach((e) => { totals[e.purpose] = (totals[e.purpose] || 0) + mCents(e.out); });
    else mTimeRows([d]).forEach((e) => { totals[e.category] = (totals[e.category] || 0) + span(e); });
  });
  return Object.keys(totals)
    .filter((k) => totals[k] > 0)
    .sort((a, b) => totals[b] - totals[a])
    .slice(0, 5)
    .map((k) => ({
      name: k, raw: totals[k], color: mColor(k, money),
      value: money ? mMoney(totals[k] / 100) : mDur(totals[k])
    }));
}

/* The one written observation. Sentences rather than a stat grid, because a
   grid is something to decode and this is something to read — and it says
   nothing at all rather than something hollow when the week is too thin. */
function mNotice(money) {
  const split = mWeekSplit(money);
  if (!split.length) {
    return money
      ? `Nothing spent ${mInsightWhen()} — or nothing logged, which Zimpan cannot tell apart yet.`
      : 'Not enough logged in this stretch to see a pattern yet. A few more days and there will be one.';
  }
  const total = split.reduce((a, r) => a + r.raw, 0);
  const top = split[0];
  const share = Math.round((top.raw / total) * 100);
  const window = mInsightDates();
  const series = window.map((d) => ({ date: d, v: money ? mSumCents(mMoneyRows([d]), 'out') / 100 : mLoggedMins([d]) }));
  const busiest = series.slice().sort((a, b) => b.v - a.v)[0];
  /* Over a week or two the heaviest day is worth naming by its weekday: it is
     a claim about Tuesdays. Over three months it is a claim about one date in
     March that happens to be a Tuesday, and calling it "Tuesday" says
     something the numbers do not — so past a month it gets its date. */
  const busiestDay = window.length > 31
    ? dayLabel(busiest.date)
    : new Date(busiest.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });

  if (money) {
    const dates = window;
    const inCents = dates.reduce((a, d) => a + mSumCents(mMoneyRows([d]), 'in'), 0);
    // Every purpose, not the handful the card had room for.
    const outCents = dates.reduce((a, d) => a + mSumCents(mMoneyRows([d]), 'out'), 0);
    const covered = outCents > 0 && inCents >= outCents;
    return `${top.name} is ${share}% of your spending ${mInsightWhen()}, and ${busiestDay} was the heaviest day of it. `
      + (covered
        ? `What came in more than covered what went out.`
        : `Nothing logged coming in to set against it.`);
  }
  const days = window.filter((d) => mLoggedMins([d]) > 0).length;
  return `${top.name} took ${share}% of ${mInsightPhrase()}, spread over ${days} ${days === 1 ? 'day' : 'days'}. `
    + `${busiestDay} was your longest day at ${mDur(busiest.v)}.`;
}

/* ── session state ──
   Everything the flow is holding but has not committed. Draft fields are flat
   so the shared `data-sync` input handler can reach them; nothing here is
   persisted, because a half-finished entry is not something to restore. */
const mDefaultStart = () => {
  const n = new Date();
  const at = Math.floor((n.getHours() * 60 + n.getMinutes()) / 15) * 15;
  // No floor at 6am any more: opening the flow at 1am should offer 1am.
  return Math.max(0, Math.min(1439, at));
};

state.m = {
  screen: 'home', step: 1, setupStep: 1,
  // draft
  kind: null, day: 'today', earlierIso: '', calMonth: '', skip: [], timed: false,
  /* The draft as it was when the flow opened, and whether the way out is being
     questioned. Both per-session: a draft does not survive a reload. */
  mark: '', quitAsk: false,
  cat: null, activity: null, typing: false, activityText: '',
  dir: 'out', amount: '', startMin: mDefaultStart(), durMin: 60,
  note: '', noteOpen: false,
  // the row being re-edited, if this is an edit rather than a new entry
  editId: null, editKind: null,
  // detail
  selected: null, selectedKind: null,
  // setup
  setupName: '', nameTyping: false, setupCurrency: 'USD',
  setupCats: ['Work', 'Health', 'Food', 'Rest'], customCats: [],
  catTyping: false, catText: '', weight: '', sleep: '',
  // the rest
  range: 'today', reviewDay: '',
  insightTab: 'time', insightRange: 'week', accountOpen: false,
  stepsOpen: false, stepsDraft: '', weightOpen: false, weightDraft: '',
  pickNew: false, pickNewName: '',
  donateOpen: false, donateThanks: false,
  /* Which calorie dial has its breakdown open: 'burn', 'food', or nothing. */
  calOpen: null,
  /* The typed times, while that dialog is open: { from, to } as "HH:MM". */
  timeEdit: null
};

/* Which screen the phone opens on. Signed out is the sign-in screen; signed in
   with nothing set up and nothing logged is setup; everything else is Today.
   An account that already has rows has plainly been through setup, whatever
   this particular device remembers. */
function mBoot() {
  if (state.setupDone || hasLocalData()) { state.setupDone = true; state.m.screen = 'home'; return; }
  /* Setup asks a personal account what it wants to watch and which categories
     to start with. A work account has neither question: it tracks hours, and
     the categories are the team's projects. Skipped rather than answered with
     defaults nobody chose — and the thing it actually needs, a team, is what
     it is asked for instead. */
  if (workMode()) {
    state.setupDone = true;
    state.m.screen = 'home';
    save();
    return;
  }
  state.m.screen = 'setup';
  state.m.setupStep = 1;
  // AED is what the picker opens on; `state.currency` is only ever PHP here,
  // which is the storage fallback rather than anybody's answer.
  state.m.setupCurrency = DEFAULT_CURRENCY;
}

/* ── 1. sign in ──
   Both buttons lead to the same place. Google accounts need a currency,
   categories and a bedtime exactly as much as email ones do — only the
   credential differs — so both open the real auth panel and both land in
   setup once it closes. */
function mSignin() {
  /* The same artwork the desktop opens on, layered the same way: the banner
     first, the two brand washes under it, the ground under those. If
     ds/home-bg.jpg is missing the gradients are what show, so this never
     falls to white — which is the whole reason the desktop stacks them.

     A phone crops a landscape banner to its middle and loses the clear half
     the headline was meant to sit on, so a scrim goes over the top, exactly
     as the landing's own phone rules do. Fixed rather than on the panel: the
     list makes this taller than one screen on a small handset, and `cover`
     on a scrolling element would scale the artwork to the scroll height. */
  const art = `
  <div aria-hidden="true" style="position:fixed;inset:0;z-index:0;pointer-events:none;background:
    linear-gradient(180deg,rgba(248,247,251,.74) 0%,rgba(248,247,251,.9) 52%,#f8f7fb 78%),
    url('/ds/home-bg.jpg') center right / cover no-repeat,
    radial-gradient(1100px 620px at 88% -8%,rgba(74,36,88,.18),transparent 62%),
    radial-gradient(760px 520px at 6% 4%,rgba(42,139,125,.12),transparent 60%),
    #f8f7fb;"></div>`;

  const checks = LANDING_CHECKS.map((t) => `
    <li style="display:flex;align-items:center;gap:10px;font-size:14.5px;color:#3b3648;">
      <span style="display:flex;flex:none;color:#5f3ac9;">${nodeIcon('check', 19)}</span>${esc(t)}
    </li>`).join('');

  return `
<div style="position:relative;min-height:100dvh;display:flex;flex-direction:column;justify-content:center;gap:24px;
            padding:34px 28px calc(34px + env(safe-area-inset-bottom));">
  ${art}
  <div style="position:relative;z-index:1;display:flex;flex-direction:column;gap:24px;">
    <div style="display:flex;align-items:center;gap:13px;">
      <span style="filter:drop-shadow(0 10px 24px rgba(79,70,229,.34));display:block;">${LOGO_BADGE(56)}</span>
      <span>
        <span style="display:block;font-family:var(--font-heading);font-weight:600;font-size:30px;letter-spacing:.02em;line-height:1;color:#16131f;">ZIMPAN<span style="color:#5f3ac9;">.</span></span>
        <span style="display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#756f88;margin-top:5px;">Track What Matters</span>
      </span>
    </div>
    <div>
      <!-- No manual line break: the old title was two short lines and could be
           broken by hand, this one is not, and a <br> in the middle of it would
           split differently on every handset width. -->
      <div style="font-family:var(--font-heading);font-weight:700;font-size:34px;line-height:1.1;letter-spacing:-.01em;color:#16131f;">Your Tracking Center for Everything</div>
      <p style="margin:14px 0 0;font-size:15.5px;line-height:1.5;color:#575168;max-width:33ch;">Log your day in seconds and watch the pattern appear. Zimpan turns what you actually do with your time and money into something you can read — and act on.</p>
    </div>
    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;">${checks}</ul>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-primary" data-act="m-signup"
        style="width:100%;min-height:52px;font-size:16px;box-shadow:0 6px 18px rgba(79,70,229,.34);">Create an account</button>
      <button class="btn btn-secondary" data-act="m-signin"
        style="width:100%;min-height:52px;font-size:16px;">Continue with Google</button>
      <!-- The way back in for someone who already has an account. It opens the
           same panel the Google button does — that panel is where both the
           Google button and the email form live — but it is the wording people
           look for, and looking for it under a button that says "Google" is
           how a returning user decides the app has forgotten them. -->
      <div style="text-align:center;font-size:13.5px;color:#756f88;margin-top:2px;">
        Already have an account?
        <button data-act="m-signin"
          style="border:0;background:transparent;padding:4px 2px;font:inherit;font-weight:600;color:#5f3ac9;
                 text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:32px;">Log in</button>
      </div>
    </div>
    <div style="font-size:12.5px;color:#756f88;line-height:1.5;">Free forever · no ads · your data stays yours</div>
  </div>
</div>`;
}

/* ── shared chrome ──
   Setup and the add flow wear the same hat: a back chevron, a step count, and
   a progress bar with one segment per step. */
function mStepChrome(o) {
  const seg = (i) => `<div style="flex:1;height:4px;border-radius:999px;background:${i <= o.step ? 'linear-gradient(90deg,#8b5cf6,#4f46e5)' : '#e0dce9'};"></div>`;
  let bars = '';
  for (let i = 1; i <= o.total; i++) bars += seg(i);
  return `
<div style="position:sticky;top:0;z-index:5;padding:2px 22px 0;background:#f8f7fb;">
  <div style="display:flex;align-items:center;justify-content:space-between;min-height:44px;">
    <button data-act="${esc(o.back)}" aria-label="Back"
      style="border:0;background:transparent;cursor:pointer;font-size:20px;color:#575168;padding:6px 8px 6px 0;min-width:22px;min-height:44px;">${o.hideBack ? '' : '←'}</button>
    <span style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;font-weight:600;">${esc(o.label)}</span>
    ${o.close
      ? `<button data-act="${esc(o.close)}" aria-label="Close" style="border:0;background:transparent;cursor:pointer;font-size:19px;color:#575168;padding:6px 0 6px 8px;min-height:44px;">✕</button>`
      : '<span style="width:22px;"></span>'}
  </div>
  <div style="display:flex;gap:5px;margin:8px 0 4px;">${bars}</div>
</div>`;
}

/* The one gate that a keystroke can open, repainted by hand.

   Everything else the footer waits on is settled by a tap, and a tap renders.
   A typed name is not: text fields feed state without re-rendering so the
   caret is never rebuilt out from under the typing, which left Continue greyed
   out over an answer that was already there — the field said one thing and the
   button said another until some unrelated render caught up. Same treatment as
   data-live-dur on the desktop form. */
function mPaintNext() {
  const btn = root.querySelector('[data-act="m-flow-next"]');
  if (!btn) return;
  const can = mCanAdvance() || state.m.step === 5;
  btn.style.opacity = can ? 1 : 0.42;
  if (can) btn.removeAttribute('aria-disabled');
  else btn.setAttribute('aria-disabled', 'true');
  const hint = root.querySelector('[data-name-hint]');
  if (hint) hint.hidden = !!mActivityName();
}

/* The pinned action. Never a hard block: an unmet requirement dims the button
   and makes it do nothing, which says "not yet" without an error message. */
function mFooter(o) {
  return `
<div style="position:fixed;left:0;right:0;bottom:0;z-index:6;padding:10px 22px 26px;background:linear-gradient(180deg,rgba(248,247,251,0),#f8f7fb 30%);">
  <button class="btn btn-primary" data-act="${esc(o.act)}"${o.can ? '' : ' aria-disabled="true"'}
    style="width:100%;min-height:54px;font-size:16.5px;box-shadow:0 6px 18px rgba(79,70,229,.32);opacity:${o.can ? 1 : 0.42};">${esc(o.label)}</button>
  ${o.skip ? `<button data-act="${esc(o.skip)}"
    style="width:100%;min-height:40px;border:0;background:transparent;cursor:pointer;font-size:13.5px;font-weight:600;color:#756f88;margin-top:4px;font-family:var(--font-body);">${esc(o.skipLabel)}</button>` : ''}
</div>`;
}

/* ── 2. first-run setup ── */

const M_SETUP_COPY = {
  1: ['First, the basics', 'Two things and we are done with settings.'],
  2: ['What do you want to watch?', 'Pick what Zimpan asks you about. Change it any time.'],
  3: ['Two optional extras', 'Both can stay empty — nothing here is required.']
};

const mSetupCan = () => {
  const s = state.m;
  if (s.setupStep === 1) return !!s.setupCurrency;
  if (s.setupStep === 2) return M_TRACKS.some((t) => state.tracks[t.key]);
  return true;
};

function mSetupStep1() {
  const s = state.m;
  return `
${mLabel('Your name')}
${s.nameTyping
    ? `<input class="input" type="text" data-k="m-name" data-sync="m.setupName" value="${esc(s.setupName)}"
        placeholder="What should we call you?" autocomplete="name"
        style="min-height:50px;padding:10px 16px;font-size:15px;border:1.5px solid #7856f5;border-radius:16px;box-shadow:0 0 0 3px rgba(120,86,245,.18);margin-bottom:22px;">`
    : `<button data-act="m-name-open"
        style="width:100%;min-height:50px;padding:0 16px;border-radius:16px;cursor:pointer;font-family:var(--font-body);font-size:15px;font-weight:600;color:${s.setupName ? '#16131f' : '#756f88'};background:#fff;border:1px solid rgba(47,28,102,.12);text-align:left;margin-bottom:22px;">${esc(s.setupName || 'Add your name')}</button>`}
${mLabel('Currency for money tracking')}
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
  ${M_CURRENCIES.map((c) => `
    <button data-act="m-currency" data-code="${esc(c.code)}"
      style="min-height:46px;border-radius:14px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;${mChip(s.setupCurrency === c.code)}">${esc(c.glyph)} ${esc(c.code)}</button>`).join('')}
</div>`;
}

function mSetupStep2() {
  const s = state.m;
  const names = M_CATS.map((c) => ({ name: c.name, color: c.color }))
    .concat(s.customCats.map((n) => ({ name: n, color: '#5f3ac9' })));
  return `
<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">
  ${M_TRACKS.map((t) => {
    const on = !!state.tracks[t.key];
    return `
    <button data-act="m-track" data-key="${esc(t.key)}" aria-pressed="${on}"
      style="display:flex;align-items:center;gap:14px;width:100%;padding:15px;border-radius:16px;cursor:pointer;text-align:left;background:${on ? '#f2eefe' : '#fff'};border:1.5px solid ${on ? '#7856f5' : 'rgba(47,28,102,.1)'};">
      <span style="width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:13px;background:${on ? M_GRAD_FLAT : '#e8e6ef'};color:#fff;">${on ? '✓' : ''}</span>
      <span style="flex:1;">
        <span style="display:block;font-family:var(--font-heading);font-weight:700;font-size:16px;color:#16131f;">${esc(t.name)}</span>
        <span style="display:block;font-size:12.5px;margin-top:2px;color:${on ? '#5f3ac9' : '#756f88'};">${esc(t.sub)}</span>
      </span>
    </button>`;
  }).join('')}
</div>
${mLabel('Starting categories')}
<div style="display:flex;flex-wrap:wrap;gap:8px;">
  ${names.map((c) => {
    const on = s.setupCats.indexOf(c.name) >= 0;
    return `
    <button data-act="m-setup-cat" data-name="${esc(c.name)}" aria-pressed="${on}"
      style="display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;${mChip(on)}">
      <span style="width:9px;height:9px;border-radius:50%;background:${on ? '#fff' : esc(c.color)};"></span>${esc(c.name)}
    </button>`;
  }).join('')}
  ${s.catTyping ? '' : `
  <button data-act="m-newcat-open"
    style="padding:9px 15px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;background:transparent;color:#7450e4;border:1px dashed rgba(120,86,245,.55);">+ Add category</button>`}
</div>
${s.catTyping ? `
<div style="display:flex;gap:8px;margin-top:10px;">
  <input class="input" type="text" data-k="m-newcat" data-sync="m.catText" data-enter="m-newcat-add" value="${esc(s.catText)}"
    placeholder="Name your category"
    style="flex:1;min-height:46px;padding:10px 14px;font-size:15px;border:1.5px solid #7856f5;border-radius:14px;box-shadow:0 0 0 3px rgba(120,86,245,.18);">
  <button class="btn btn-primary" data-act="m-newcat-add"
    style="flex:none;min-height:46px;padding:0 18px;border-radius:14px;font-size:14.5px;">Add</button>
</div>` : ''}`;
}

function mSetupStep3() {
  const s = state.m;
  const field = (key, sync, label, hint, placeholder, extra, suffix) => `
<div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;margin-bottom:5px;">${esc(label)}</div>
<p style="margin:0 0 10px;font-size:13px;color:#9995ab;">${esc(hint)}</p>
<div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
  <input class="input" type="text" data-k="${key}" data-sync="${sync}" value="${esc(s[sync.split('.')[1]])}"
    placeholder="${esc(placeholder)}"${extra}
    style="flex:1;min-height:50px;padding:10px 16px;font-size:15.5px;border-radius:16px;">
  ${suffix ? `<span style="flex:none;font-size:14.5px;font-weight:600;color:#756f88;">${esc(suffix)}</span>` : ''}
</div>`;
  return field('m-weight', 'm.weight', 'Weight', 'Only used to estimate calories burned.', 'e.g. 68', ' inputmode="decimal"', 'kg')
    + field('m-sleep', 'm.sleep', 'What time do you usually sleep?', 'Sets where Zimpan stops counting your day.', 'e.g. 10:30pm', '', '');
}

function mSetup() {
  const s = state.m;
  const copy = M_SETUP_COPY[s.setupStep] || ['', ''];
  const last = s.setupStep >= 3;
  return `
<div style="min-height:100vh;padding-bottom:140px;">
${mStepChrome({ step: s.setupStep, total: 3, label: `Step ${s.setupStep} of 3`, back: 'm-setup-back', hideBack: s.setupStep <= 1 })}
<div style="padding:18px 22px 12px;">
  ${mHead(copy[0], copy[1])}
  ${s.setupStep === 1 ? mSetupStep1() : ''}
  ${s.setupStep === 2 ? mSetupStep2() : ''}
  ${s.setupStep === 3 ? mSetupStep3() : ''}
</div>
${mFooter({
    act: 'm-setup-next', can: mSetupCan(), label: last ? 'Start tracking' : 'Continue',
    skip: last ? 'm-setup-skip' : '', skipLabel: 'Skip both'
  })}
</div>`;
}

/* ── 3. Today ── */

function mTimerCard() {
  if (!state.timerStart) {
    return `
<button class="m-timer-idle" data-act="m-timer-start"
  style="width:100%;display:flex;align-items:center;gap:14px;padding:18px;border-radius:20px;cursor:pointer;text-align:left;border:0;background:${M_GRAD};box-shadow:${M_LIFT};color:#fff;margin-bottom:14px;">
  <span style="width:46px;height:46px;flex:none;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;">${nodeIcon('play', 21)}</span>
  <span style="flex:1;">
    <span style="display:block;font-family:var(--font-heading);font-weight:700;font-size:21px;line-height:1.1;">Start timer</span>
    <span style="display:block;font-size:13px;opacity:.82;margin-top:3px;">Track it live, name it after</span>
  </span>
</button>`;
  }
  const startD = new Date(state.timerStart);
  const startMin = startD.getHours() * 60 + startD.getMinutes();
  const secs = mElapsedSec();
  return `
<div class="m-timer" style="margin-bottom:14px;">
  <span class="m-timer-dot"></span>
  <span style="flex:1;min-width:0;">
    <span id="m-elapsed" style="display:block;font-family:var(--font-heading);font-weight:700;font-size:30px;line-height:1;color:#16131f;font-variant-numeric:tabular-nums;">${esc(mElapsedLabel(secs))}</span>
    <span style="display:block;font-size:12.5px;color:#756f88;margin-top:4px;">Tracking since ${esc(mClock(startMin))}</span>
    <span id="m-timer-long" style="display:${secs > 4 * 3600 ? 'block' : 'none'};font-size:12.5px;color:#a8631a;margin-top:4px;">Still going? You can trim it when you stop.</span>
  </span>
  <button class="btn btn-primary" data-act="m-timer-stop"
    style="flex:none;min-height:44px;padding:0 20px;font-size:14.5px;box-shadow:0 5px 14px rgba(79,70,229,.3);">Stop</button>
</div>`;
}

function mEntryRow(e, opts) {
  const o = opts || {};
  const money = e.kind === 'money';
  const value = money
    ? (e.dir === 'in' ? '+' : '−') + mMoney(e.amount)
    : mDur(e.dur);
  const base = money
    ? `${e.cat} · money ${e.dir}`
    : `${e.cat} · ${mRange(e.start, e.dur)}`;
  // A search result is only useful with the day on it; a row in today's list
  // already knows what day it is.
  const dated = o.showDate ? `${dayLabel(e.date)} · ${base}` : base;
  /* When the only reason a row matched is something written in its note, say
     so. Without it a search for "met" turns up "Database Error" and looks
     like a bug rather than a note that mentions metabase. */
  const q = String(o.hint || '').trim().toLowerCase();
  const inNote = q && (e.note || '').toLowerCase().indexOf(q) >= 0
    && `${e.title} ${e.cat}`.toLowerCase().indexOf(q) < 0;
  const meta = inNote ? `${dated} · “${e.note}”` : dated;
  /* Which of the two things this is, at a glance. The tints are the ones the
     quick actions and the kind cards already use, so a row and the button that
     created it read as the same family.

     The money glyph is the active currency, which is not always one character:
     "Dhs" and "HK$" have to sit in the same 26px tile as "$", so the type size
     follows the glyph rather than the tile growing to fit it. */
  const glyph = money ? mGlyph() : '';
  const glyphSize = glyph.length > 2 ? 8.5 : glyph.length > 1 ? 10 : 13;
  const tile = `
  <span aria-hidden="true" style="width:26px;height:26px;flex:none;border-radius:9px;display:grid;place-items:center;
    background:${money ? '#eceefe' : '#f2eefe'};color:${money ? '#3f4bc4' : '#5f3ac9'};
    font-size:${glyphSize}px;font-weight:700;line-height:1;">${money ? esc(glyph) : nodeIcon('clock', 15)}</span>`;
  return `
<button class="card" data-act="${esc(o.act || 'm-open-entry')}" data-id="${esc(e.id)}" data-kind="${money ? 'money' : 'time'}"
  style="flex-direction:row;align-items:center;gap:10px;width:100%;padding:13px 14px;border-radius:16px;box-shadow:${M_SHADOW_SM};cursor:pointer;text-align:left;">
  <span style="width:9px;height:38px;border-radius:999px;flex:none;background:${esc(mColor(e.cat, money))};"></span>
  ${tile}
  <span style="flex:1;min-width:0;">
    <span style="display:block;font-weight:600;font-size:15px;color:#16131f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(e.title)}</span>
    <span style="display:block;font-size:12.5px;color:#756f88;margin-top:2px;">${esc(meta)}</span>
  </span>
  <span style="font-family:var(--font-heading);font-weight:700;font-size:15px;white-space:nowrap;color:${money && e.dir === 'in' ? '#1c8a63' : '#16131f'};">${esc(value)}</span>
</button>`;
}

/* The way into the report deck. The deck itself is the desktop's — a stack of
   written cards you swipe — and it needed no porting: it is a self-contained
   overlay that reads its own window and draws over whatever is behind it. All
   this does is give it a door on the phone. */
function mReportCard(money) {
  return `
<div class="card" style="border-radius:20px;padding:18px;border:1px solid rgba(120,86,245,.25);box-shadow:0 4px 14px rgba(47,28,102,.08);gap:0;margin-bottom:14px;">
  <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#7450e4;margin-bottom:7px;">Your report</div>
  <div style="font-family:var(--font-heading);font-weight:700;font-size:19px;color:#16131f;">${money ? 'Where the money went' : 'Where the time went'}</div>
  <p style="margin:7px 0 14px;font-size:14px;line-height:1.5;color:#575168;">A short stack of cards, written out in sentences rather than charts. Swipe through them, and pick the stretch they cover once you are in.</p>
  <button class="btn btn-primary" data-act="m-report-open"
    style="width:100%;min-height:48px;font-size:15px;box-shadow:0 5px 16px rgba(79,70,229,.3);">Open the report</button>
</div>`;
}

/* Steps and weight: the two numbers the calorie estimates need that the flow
   never asks for, because neither is an entry. They sit under the day's gaps
   because that is where the reckoning of a day already happens.

   Closed, each is a button. Only tapping one mints an input, which is the same
   rule every other field in this flow follows. */
function mBodyCard(day) {
  const s = state.m;
  const steps = Number(state.steps[day]) || 0;
  const kg = Number(state.weightKg) || 0;

  const field = (open, act, key, sync, label, shown, placeholder, suffix) => `
  <div style="flex:1;min-width:0;">
    <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;margin-bottom:6px;">${esc(label)}</div>
    ${open
      ? `<div style="display:flex;gap:6px;">
          <input class="input" type="text" inputmode="numeric" data-k="${key}" data-sync="${sync}"
            value="${esc(String(state.m[sync.split('.')[1]] || ''))}" placeholder="${esc(placeholder)}" data-enter="${esc(act)}-save"
            style="flex:1;min-width:0;min-height:42px;padding:8px 12px;font-size:15px;border-radius:12px;border:1.5px solid #7856f5;box-shadow:0 0 0 3px rgba(120,86,245,.18);">
          <button class="btn btn-primary" data-act="${esc(act)}-save" style="flex:none;min-height:42px;padding:0 14px;font-size:14px;border-radius:12px;">Save</button>
        </div>`
      : `<button data-act="${esc(act)}-open"
          style="width:100%;min-height:42px;padding:0 12px;border-radius:12px;cursor:pointer;text-align:left;font-family:var(--font-body);font-size:15px;font-weight:600;
                 background:#fff;border:1px solid rgba(47,28,102,.12);color:${shown ? '#16131f' : '#756f88'};">${esc(shown ? shown + (suffix || '') : placeholder)}</button>`}
  </div>`;

  /* Steps and weight exist to scale the calorie burn, and there is no calorie
     burn in a work account — asking for them would be collecting a body
     measurement that nothing on the screen uses. See workMode(). */
  if (workMode()) return '';

  return `
<div class="card" style="border-radius:16px;padding:14px;gap:12px;flex-direction:row;box-shadow:${M_SHADOW_SM};margin-bottom:22px;">
  ${field(s.stepsOpen, 'm-steps', 'm-steps-input', 'm.stepsDraft', 'Steps', steps ? steps.toLocaleString('en-US') : '', 'Add steps', '')}
  ${field(s.weightOpen, 'm-weight', 'm-weight-input', 'm.weightDraft', 'Weight', kg ? String(kg) : '', 'Add weight', ' kg')}
</div>`;
}

/* ── the calorie balance ──

   The same four readings the desktop draws, from the same two functions, so a
   day read on the phone and the same day read on the laptop cannot disagree.
   What changes is the shape: four dials in a row need about 110px each and a
   phone has 350, so they sit two by two.

   The figures are the window's own totals. An earlier version divided them by
   the span, on the theory that a month's intake would swamp a dial scaled for
   one day — but these dials are not scaled for a day. All four share one scale
   taken from the largest of them, so they grow together and the balance
   between them, which is the whole reading, is the same either way. Given
   that, a total is what "this month" means, and the average was answering a
   question nobody asked. The per-day figure is still worth having, so it goes
   in the line underneath rather than on the dial. */
const M_CAL_ARC = Math.PI * 38;

/* Protein, carbs and fat in the order people say them, short enough to sit
   under a half-width dial. Grams rather than percentages: a gram is a thing you
   can picture and compare to a target, where "34% of energy from fat" is a
   sentence you have to do arithmetic on before it means anything. */
const M_MACRO_TONES = { protein: '#3f4bc4', carbs: '#e9a13b', fat: '#c0567a' };

const mMacroLine = (n, size) => {
  if (!n || (!n.protein && !n.carbs && !n.fat)) return '';
  const part = (key, label, value) => `<span style="color:${M_MACRO_TONES[key]};font-weight:700;">${label}</span> ${value}g`;
  return `
  <span style="display:inline-flex;flex-wrap:wrap;justify-content:center;gap:2px 7px;font-size:${size || 10.5}px;color:#756f88;
               font-variant-numeric:tabular-nums;line-height:1.4;">
    ${part('protein', 'P', n.protein)}
    ${part('carbs', 'C', n.carbs)}
    ${part('fat', 'F', n.fat)}
  </span>`;
};

function mCalDial(value, tone, glyph, cap, top, kind, extra) {
  const dash = (Math.abs(value) / Math.max(top, 1)) * M_CAL_ARC;
  /* Only two of the four have a list behind them. Rest is a formula and net is
     arithmetic on the other three — neither has items to show, and a tile that
     opened an empty panel would be worse than one that does not open. So the
     two that do are buttons and say so, rather than all four looking alike and
     half of them doing nothing. */
  const tag = kind ? 'button' : 'div';
  return `
  <${tag}${kind ? ` data-act="m-cal-open" data-kind="${esc(kind)}" aria-haspopup="dialog"` : ''}
    style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;
           padding:12px 8px 11px;border-radius:16px;background:#fff;border:1px solid rgba(47,28,102,.09);
           ${kind ? 'cursor:pointer;font-family:var(--font-body);' : ''}">
    <div style="position:relative;width:100%;max-width:104px;">
      <svg viewBox="0 0 96 52" style="display:block;width:100%;height:auto;" aria-hidden="true">
        <path d="M10 46 A 38 38 0 0 1 86 46" fill="none" stroke="#ece9f4" stroke-width="8" stroke-linecap="round"></path>
        <path d="M10 46 A 38 38 0 0 1 86 46" fill="none" stroke="${tone}" stroke-width="8" stroke-linecap="round"
          stroke-dasharray="${dash.toFixed(2)} ${M_CAL_ARC.toFixed(2)}"></path>
      </svg>
      <span style="position:absolute;left:50%;bottom:2px;transform:translateX(-50%);color:${tone};">${nodeIcon(glyph, 17)}</span>
    </div>
    <div data-cal-val style="font-family:var(--font-heading);font-weight:700;font-size:19px;line-height:1.1;color:#16131f;margin-top:6px;
                font-variant-numeric:tabular-nums;">~${Math.abs(value).toLocaleString('en-US')}</div>
    <div data-cal-cap style="font-size:11.5px;color:#756f88;margin-top:3px;text-align:center;line-height:1.3;">${esc(cap)}</div>
    ${extra ? `<div data-cal-macros style="margin-top:5px;">${extra}</div>` : ''}
    ${kind ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-top:auto;padding-top:6px;font-size:11px;font-weight:600;color:${tone};">See items<span aria-hidden="true">›</span></span>` : ''}
  </${tag}>`;
}

/* What actually fed a dial. Built the same way burnFor and foodReport build
   their totals — resolved minutes for the burn, nutritionFor per row for the
   food — so the list is the working, not a second opinion.

   Entries too vague to price are listed rather than dropped. A meal that reads
   as nothing is exactly the thing someone opening this panel is looking for:
   the answer to "why is my Eaten so low" is usually sitting in it. */
function mCalItems(dates, kind) {
  const rows = mTimeRows(dates);
  if (kind === 'food') {
    return rows.filter(isEatenRow).map((e) => {
      const n = nutritionFor([e]);
      return {
        name: e.activity || 'Meal',
        meta: e.note ? String(e.note).trim() : 'nothing written down',
        when: `${clock12(e.from)} · ${dayLabel(e.date)}`,
        kcal: n.kcal, macros: n, vague: !n.kcal
      };
    }).sort((a, b) => b.kcal - a.kcal);
  }

  const kg = Number(state.weightKg) || DEFAULT_WEIGHT_KG;
  const effMins = effective(resolveSpans(rows));
  const out = [];
  rows.forEach((e) => {
    const hit = metHit(e);
    if (!hit) return;
    const mins = effMins(e);
    if (!mins) return;
    out.push({
      name: e.activity || 'Activity',
      meta: `${e.category || 'Uncategorised'} · ${mDur(mins)}`,
      when: `${clock12(e.from)} · ${dayLabel(e.date)}`,
      kcal: Math.round(hit.met * kg * (mins / 60))
    });
  });
  /* Steps ride with the workout figure rather than beside it, so they belong
     in this list — they are usually the largest line in it. */
  const steps = stepsIn(dates);
  const fromSteps = stepsKcal(steps, state.weightKg);
  if (fromSteps) {
    out.push({ name: 'Steps', meta: `${steps.toLocaleString('en-US')} counted, priced as walking`, when: '', kcal: fromSteps });
  }
  return out.sort((a, b) => b.kcal - a.kcal);
}

/* The phone's rendering of the same question. A sheet rather than a dialog,
   which is what every other panel on this layout is, and no backdrop dismissal
   while the question is unanswered — tapping past it would leave the spend in
   a state nobody chose. */
function mDeductSheet() {
  if (!state.deductAsk) return '';
  const c = deductCopy();
  return mSheet(state.deductAsk.done ? deductResult(c) : deductQuestion(c), '24px 18px 28px');
}

/* The breakdown behind a calorie dial: what actually contributed to it, listed.
   Written for the phone first and now shared, because the desktop's dials had
   nothing behind them at all — the same figure with no way to ask what it was
   made of. Everything it used to read off the phone's own state is a parameter,
   so the two layouts cannot end up describing different meals. */
/* Shares of a whole, rounded so they still add up to it.

   Rounding each share on its own leaves the rows a few short of the total
   printed above them, and a reader who adds up what is on screen is entitled
   to arrive at that number. The remainder goes to the largest fractions, one
   each, which is the ordinary way and the only one that cannot hand a row more
   than it is owed. */
function apportion(parts, whole) {
  const sum = parts.reduce((a, n) => a + n, 0);
  if (!sum || !whole) return parts.map(() => 0);
  const exact = parts.map((n) => (n * whole) / sum);
  const out = exact.map((n) => Math.floor(n));
  let left = Math.round(whole) - out.reduce((a, n) => a + n, 0);
  exact
    .map((n, i) => [n - Math.floor(n), i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  return out;
}

function calBreakdown(kind, dates, report, scope, closeAct) {
  if (kind !== 'burn' && kind !== 'food') return '';
  const read = mCalItems(dates, kind);
  const food = kind === 'food';
  const tone = food ? '#e9a13b' : '#0e9f6e';
  const localTotal = read.reduce((a, r) => a + r.kcal, 0);
  const counted = read.filter((r) => !r.vague).length;
  /* Grams for the window. When an AI estimate exists it replaces the local
     reading here exactly as it does on the dial — the two showing different
     totals for the same meals is not a second opinion, it is a question the
     reader cannot answer. The local figure stays, named, underneath. */
  const ai = report && report.ai;

  /* This panel is a breakdown of the figure on the dial, so that is the figure
     it adds up to. Everything below shares it out.

     It did not. The header showed the day's estimate and every meal under it
     showed a separate reading, so a day estimated at 3,073 was itemised as
     three meals adding to 4,622 — two answers to one question, on one screen,
     with a footnote admitting it. Two things caused that, and both are fixed
     by the same rule:

     A calibration is asked for a day's worth of text in one request, so what
     it knows is the day's total. The rows kept the table's reading while the
     header took the model's, and the entry cards in the log — which had
     already been taught to apportion — agreed with neither.

     And even with no calibration the two disagreed, because the header prices
     every meal as one piece of text while the rows price each meal alone, and
     a table read twice over does not give the same answer both times.

     So the rows are shares of the headline, in proportion to what each one
     weighed when read on its own. Each macro is shared on its own ratio, since
     a model redistributes protein and fat rather than merely scaling them. */
  const headline = food && report ? Math.max(0, Math.round(report.kcal)) : localTotal;
  const total = headline;
  const grams = ai
    ? { protein: ai.protein, carbs: ai.carbs, fat: ai.fat }
    : (report && report.local
      ? { protein: report.local.protein, carbs: report.local.carbs, fat: report.local.fat }
      : read.reduce((a, r) => ({
        protein: a.protein + ((r.macros && r.macros.protein) || 0),
        carbs: a.carbs + ((r.macros && r.macros.carbs) || 0),
        fat: a.fat + ((r.macros && r.macros.fat) || 0)
      }), { protein: 0, carbs: 0, fat: 0 }));
  const macroTotal = food && counted ? grams : null;

  const priced = read.filter((r) => !r.vague);
  const items = !food || !report || !priced.length || !localTotal || !headline ? read : (() => {
    const kcals = apportion(priced.map((r) => r.kcal), headline);
    const shares = ['protein', 'carbs', 'fat'].reduce((acc, key) => {
      acc[key] = apportion(priced.map((r) => (r.macros && r.macros[key]) || 0), grams[key] || 0);
      return acc;
    }, {});
    let i = -1;
    return read.map((r) => {
      if (r.vague) return r;
      i += 1;
      return Object.assign({}, r, {
        kcal: kcals[i],
        macros: r.macros ? Object.assign({}, r.macros, {
          protein: shares.protein[i], carbs: shares.carbs[i], fat: shares.fat[i]
        }) : r.macros
      });
    });
  })();

  /* Offered on a single day only, which is the same rule the desktop follows:
     across a week the text handed over is every meal of every day run
     together, a worse question than the local reading already answers and a
     much more expensive one. */
  const canRefine = food && state.aiEstimates && report && report.detail && dates.length === 1;
  const busy = state.aiBusy === scope;
  // The desktop's button, in the phone's shape. The dialog still asks at the
  // moment the note is written; this is the way back to it afterwards.
  const refine = !canRefine && !busy && !ai && !state.aiError ? '' : `
  <div style="margin:14px 0 0;display:flex;flex-direction:column;gap:8px;">
    ${canRefine ? `<button class="btn btn-secondary" data-act="refine-food" data-scope="${esc(scope)}"${busy ? ' disabled' : ''}
      style="width:100%;min-height:46px;font-size:14.5px;display:inline-flex;align-items:center;justify-content:center;gap:9px;">
      ${busy ? '<span class="spinner"></span> Calibrating…' : (ai ? 'Calibrate again' : 'Calibrate with AI')}
    </button>` : ''}
    ${busy && !canRefine ? '<span style="font-size:12px;color:#756f88;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:8px;"><span class="spinner"></span> Calibrating with AI…</span>' : ''}
    ${ai ? `<span style="font-size:11.5px;color:#9995ab;text-align:center;">Local reading was ${localTotal.toLocaleString('en-US')} kcal.</span>` : ''}
    ${state.aiError && !busy ? `<span style="font-size:11.5px;color:#8a2f4a;text-align:center;">${esc(state.aiError)}</span>` : ''}
  </div>`;

  const row = (r) => `
    <div style="display:flex;align-items:baseline;gap:10px;padding:11px 0;border-top:1px solid rgba(47,28,102,.08);">
      <span style="flex:1;min-width:0;">
        <span style="display:block;font-weight:600;font-size:14.5px;color:#16131f;">${esc(r.name)}</span>
        <span style="display:block;font-size:12px;color:#756f88;margin-top:2px;line-height:1.4;">${esc(r.meta)}</span>
        ${r.when ? `<span style="display:block;font-size:11.5px;color:#9995ab;margin-top:2px;">${esc(r.when)}</span>` : ''}
        ${r.macros && !r.vague ? `<span style="display:block;margin-top:4px;">${mMacroLine(r.macros, 11)}</span>` : ''}
      </span>
      <span style="flex:none;font-family:var(--font-heading);font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;
                   color:${r.vague ? '#9995ab' : tone};">${r.vague ? 'not read' : `~${r.kcal.toLocaleString('en-US')}`}</span>
    </div>`;

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;">
    <span style="display:flex;align-items:center;gap:9px;">
      <span style="width:34px;height:34px;flex:none;border-radius:11px;display:grid;place-items:center;
                   background:${food ? '#fdf1de' : '#e3f5ed'};color:${tone};">${nodeIcon(food ? 'plate' : 'flame', 18)}</span>
      <span style="font-family:var(--font-heading);font-weight:700;font-size:20px;color:#16131f;">${food ? 'What you ate' : 'What burned it'}</span>
    </span>
    <button data-act="${esc(closeAct)}" aria-label="Close"
      style="flex:none;border:0;background:transparent;cursor:pointer;font-size:19px;color:#575168;min-width:40px;min-height:40px;">✕</button>
  </div>
  ${macroTotal ? `
  <div style="display:flex;gap:8px;margin:2px 0 14px;">
    ${[['protein', 'Protein', macroTotal.protein], ['carbs', 'Carbs', macroTotal.carbs], ['fat', 'Fat', macroTotal.fat]].map(([key, label, g]) => `
      <div data-macro="${key}" style="flex:1 1 0;min-width:0;text-align:center;padding:10px 6px;border-radius:14px;
                  background:${M_MACRO_TONES[key]}14;">
        <div style="font-family:var(--font-heading);font-weight:700;font-size:19px;line-height:1.1;color:${M_MACRO_TONES[key]};
                    font-variant-numeric:tabular-nums;">${g.toLocaleString('en-US')}<span style="font-size:12px;">g</span></div>
        <div style="font-size:11px;color:#756f88;margin-top:3px;">${label}</div>
      </div>`).join('')}
  </div>` : ''}
  <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#756f88;">
    ${items.length
      ? `${counted} ${counted === 1 ? 'entry' : 'entries'} came to about <strong style="color:#16131f;">${total.toLocaleString('en-US')} kcal</strong>${dates.length > 1
        ? ` across ${dates.length} days — about ${Math.round(total / dates.length).toLocaleString('en-US')} a day.`
        : '.'}${ai ? ' Estimated by AI from what you wrote.' : ''}`
      : food
        ? 'No meals logged in the activity tracker for this window. Calories are read from there alone — paying for a meal is not the same as eating it.'
        : 'Nothing logged here reads as movement, and no steps were counted.'}
  </p>
  <div>${items.map(row).join('')}</div>
  ${ai && ai.items && ai.items.length ? `
  <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(47,28,102,.08);">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9995ab;margin-bottom:7px;">What it read</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;">
      ${ai.items.map((i) => `<span style="padding:3px 8px;border-radius:8px;background:#fdf1de;color:#8a5a10;font-size:11px;font-weight:600;">${esc(i.name)} ~${i.kcal}</span>`).join('')}
    </div>
  </div>` : ''}
  ${refine}
  <p style="margin:14px 0 0;font-size:11.5px;line-height:1.5;color:#9995ab;">
    ${food
      ? `Calories and grams are read from what you wrote in each entry, against a table of typical servings. An entry with nothing written down cannot be priced, which is what “not read” means. The day is read as a whole${ai ? ' — by AI, from what you wrote —' : ''} and shared across the meals in proportion to what each one weighs, so the figures here add up to the total above.`
      : 'Priced from the activity and how long it ran, against your weight. Overlapping entries are counted once.'}
  </p>`;
}

/* The phone's frame around it — a sheet, like every other panel on that layout. */
function mCalSheet() {
  const kind = state.m.calOpen;
  if (kind !== 'burn' && kind !== 'food') return '';
  const dates = mRangeDates();
  return mSheet(calBreakdown(kind, dates, kind === 'food' ? mFood() : null, 'm', 'm-sheet-close'), '22px 20px 30px');
}

/* The laptop's frame around the same thing. The dials on this layout showed a
   figure and offered no way to ask what was in it; the phone has had that
   since the gauges were added. Same list, same wording, in the dialog shape
   this layout already uses.

   `scope` names which of the two blocks was asked — the page draws them twice,
   for today and for the window behind it, and they describe different days. */
function calBreakdownDialog() {
  const o = state.calOpen;
  if (!o) return '';
  const v = compute();
  const today = o.scope === 'today';
  const dates = today ? [todayIso] : ((v.pastBurn && v.pastBurn.dates) || []);
  /* Only the food dial has a report behind it. Passing it whatever was asked
     for meant the burn dialog read the food estimate: its header showed the
     day's eating as the figure that had been burned, "What it read" listed the
     meals, and the real burn survived only as the "local reading" underneath.
     The phone's frame has always passed null here. */
  const report = o.kind === 'food' ? (today ? v.todayFood : v.pastFood) : null;
  return `
    <div style="position:fixed;inset:0;background:color-mix(in srgb, var(--color-neutral-900) 55%, transparent);display:flex;align-items:safe center;justify-content:safe center;padding:20px;z-index:60;overflow:auto;"
         data-backdrop="cal-close">
      <div class="blueprint" style="width:460px;max-width:100%;margin:auto;padding:22px 24px 24px;background:var(--color-bg);">
        ${calBreakdown(o.kind, dates, report, o.scope, 'cal-close')}
      </div>
    </div>`;
}

/* The food reading for the window on screen. Same function the desktop calls,
   handed the phone's dates. */
function mFood() {
  const dates = mRangeDates();
  return foodReport(mTimeRows(dates), mMoneyRows(dates), dates.length);
}

function mCalCard(dates) {
  // Not this product's subject. See workMode().
  if (workMode()) return '';

  const days = Math.max(1, dates.length);
  const rows = mTimeRows(dates);
  const burn = burnFor(rows, state.weightKg, days, dates);
  const food = foodReport(rows, mMoneyRows(dates), days);

  /* The same source the kcal figure came from — a refined estimate replaces
     the local one everywhere or nowhere — and on the same footing, so the
     grams and the calories above them cover the same span. */
  const macros = food.ai || food.local || null;
  const burned = Math.round(burn.kcal);
  const eaten = Math.round(food.kcal);
  const rested = Math.round(burn.restKcal);
  const kicker = days > 1 ? `Total across ${days} days` : 'Daily calorie balance';

  const shell = (inner) => `
<div style="margin-bottom:22px;">
  <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;margin-bottom:8px;">${esc(kicker)}</div>
  ${inner}
</div>`;

  /* With nothing logged on either side there is no balance to draw, and
     drawing one anyway would report a large deficit at breakfast time purely
     because the day had not been logged yet. It says so rather than
     disappearing: a card that silently comes and goes reads as a fault. The
     resting figure is still worth showing — it is true whatever you log. */
  if (!food.kcal && !burn.kcal) {
    return shell(`
  <div class="card" style="border-radius:16px;padding:16px;gap:0;box-shadow:${M_SHADOW_SM};">
    <div style="font-size:14px;line-height:1.5;color:#575168;">
      Nothing to weigh up yet. Your body spends roughly
      <strong style="color:#16131f;">${Math.round(rested / days).toLocaleString('en-US')} kcal a day</strong> at rest, but a balance
      needs something on the other side — log a meal or a workout${days === 1
        ? `, or <button data-act="m-steps-open" style="border:0;background:transparent;padding:0;font:inherit;color:#5f3ac9;font-weight:600;text-decoration:underline;cursor:pointer;">add your steps</button>` : ''}.
    </div>
  </div>`);
  }

  /* Everything out, less everything in. Positive is a deficit — more spent
     than eaten — which is the direction people are usually looking for, so it
     takes the green. */
  const net = burned + rested - eaten;
  const deficit = net >= 0;
  // One scale across all four, so the dials are comparable to each other
  // rather than each being full of itself.
  const top = Math.max(eaten, burned, rested, Math.abs(net), 1);

  const stepLine = days === 1
    ? `${burn.steps ? `${burn.steps.toLocaleString('en-US')} steps counted. ` : ''}`
    : (burn.steps ? `${burn.steps.toLocaleString('en-US')} steps across the window. ` : '');
  /* The average belongs somewhere — it is the figure that compares one window
     to another — just not on a dial labelled with a span. */
  const perDayLine = days > 1
    ? `That is about ${Math.round(net / days).toLocaleString('en-US')} kcal a day ${deficit ? 'in deficit' : 'in surplus'}. `
    : '';

  return shell(`
  <div style="display:flex;gap:10px;margin-bottom:10px;">
    ${mCalDial(burned, '#0e9f6e', 'flame', 'Burned moving', top, 'burn')}
    ${mCalDial(eaten, '#e9a13b', 'plate', 'Eaten', top, 'food', mMacroLine(macros, 10.5))}
  </div>
  <div style="display:flex;gap:10px;">
    ${mCalDial(rested, '#5f3ac9', 'pulse', 'Burned at rest', top)}
    ${mCalDial(net, deficit ? '#0e9f6e' : '#d92d20', 'scales', `Net ${deficit ? 'deficit' : 'surplus'}`, top)}
  </div>
  <p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;color:#9995ab;">
    ${esc(perDayLine)}${esc(stepLine)}Rest is worked out from ${burn.assumedWeight
      ? `a default ${DEFAULT_WEIGHT_KG} kg — `
      : `your ${esc(String(state.weightKg))} kg — `}<button data-act="m-weight-open"
      style="border:0;background:transparent;padding:0;font:inherit;color:#5f3ac9;font-weight:600;text-decoration:underline;cursor:pointer;">${burn.assumedWeight ? 'add your weight' : 'edit it'}</button>.
    Every figure here is a rough estimate from what you logged, useful for a direction rather than to count on.
  </p>`);
}

function mDonateCard() {
  /* A team is paying for this. Asking them for a dollar on top, under a
     heading that calls the app free, contradicts the plan they are on and the
     billing tab that sold it to them. See workMode(). */
  if (workMode()) return '';
  return `
<div class="card" style="border-radius:20px;padding:18px;border:1px solid rgba(120,86,245,.25);box-shadow:0 4px 14px rgba(47,28,102,.08);gap:0;margin-top:22px;">
  <div style="font-family:var(--font-heading);font-weight:700;font-size:19px;color:#16131f;">Zimpan is free, and stays free</div>
  <p style="margin:7px 0 14px;font-size:14px;line-height:1.5;color:#575168;">No ads, no paid tier, and nothing you log is ever sold. If it has been worth something to you, a small gift keeps it being built.</p>
  <a class="btn btn-primary" href="${DONATE_URL}" data-donate target="_blank" rel="noopener noreferrer"
    style="width:100%;min-height:48px;font-size:15px;box-shadow:0 5px 16px rgba(79,70,229,.3);">Donate</a>
</div>`;
}

/* The mark, on the two screens that are destinations rather than steps. Setup
   and the add flow deliberately go without: each is one job with a way out,
   and a logo on them is only a second thing to look at. The avatar moves up
   here too, which hands the day's heading the full width it was drawn for. */
function mBrandBar() {
  /* Sticky, and bled out to the screen edges with negative margins: the column
     it sits in carries 22px of padding, and without the bleed the page would
     scroll visibly through the gutters either side of the bar. */
  return `
<div style="position:sticky;top:0;z-index:15;background:#f8f7fb;margin:0 -22px 14px;padding:6px 22px 10px;display:flex;align-items:center;justify-content:space-between;">
  <span style="display:flex;align-items:center;gap:9px;">
    ${LOGO_BADGE(26)}
    <span style="font-family:var(--font-heading);font-weight:600;font-size:19px;letter-spacing:.02em;line-height:1;color:#16131f;">ZIMPAN<span style="color:#5f3ac9;">.</span></span>
  </span>
  <span style="display:flex;align-items:center;gap:8px;">
<button data-act="m-account-open" aria-label="Account"
      style="width:38px;height:38px;flex:none;border:0;border-radius:50%;background:#e4dcfd;display:grid;place-items:center;font-family:var(--font-body);font-weight:600;font-size:14px;color:#472b97;cursor:pointer;">${esc(mInitials())}</button>
  </span>
</div>`;
}

/* The five windows, as a row that scrolls rather than wraps: five chips do not
   fit across 393px at a tappable size, and a second line of them pushes the
   day's figures below the fold. */
/* A bar's figure, short enough to sit over a 26px column. Hours lose their
   minutes and money loses its currency: at this size the label is a sense of
   scale, and the total above the chart is where the exact number lives. */
function mBarValue(v, money) {
  if (!v) return '';
  if (money) return v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v));
  const h = v / 60;
  return h >= 10 ? Math.round(h) + 'h' : (Math.round(h * 10) / 10) + 'h';
}

/* The row scrolls, and the clipped chip at its edge is the only thing that
   says so — easy to miss, and the last two windows sit past it. */
/* Right-aligned, because that is the edge it is pointing at. On the left it
   sat as far as it could get from the content that runs off the screen, and
   read as a caption for the row rather than as an instruction about it. */
const mScrollHint = (text) => `
  <div style="display:flex;align-items:center;justify-content:flex-end;gap:5px;font-size:11px;color:#9995ab;font-weight:600;margin-bottom:6px;">
    <span>${esc(text)}</span><span aria-hidden="true">›</span>
  </div>`;

function mRangeChips(act, on) {
  return `
${mScrollHint('Scroll for more')}
<div class="m-chiprow" style="display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin-bottom:16px;padding-bottom:2px;">
  ${DECK_RANGES.map(([key, label]) => `
    <button data-act="${esc(act || 'm-range')}" data-key="${key}" aria-pressed="${key === on}"
      style="flex:none;padding:9px 15px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;white-space:nowrap;min-height:40px;${mChip(key === on)}">${esc(label)}</button>`).join('')}
</div>`;
}

function mHome() {
  const dates = mRangeDates();
  const single = dates.length === 1;
  const day = dates[dates.length - 1];
  const list = mDayList(dates);
  const logged = mLoggedMins(dates);
  const bars = mDayBars(dates);
  /* A gap is a hole in one day's clock. Over a fortnight the idea does not
     survive — every night would read as an eight-hour gap — so the banner and
     the review it opens belong to the two single-day windows only. */
  const gaps = single ? mGaps(day) : [];
  const capacity = dates.length * 1440;
  // A query takes the section over: the results answer what is on screen, so
  // showing the day underneath them would be two lists at once.
  const searching = !!String(state.searchQuery || '').trim();
  return `
<div style="padding:6px 22px 108px;">
  ${mBrandBar()}
  <div style="margin-bottom:16px;">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#7450e4;font-weight:600;">${esc(mRangeKicker())}</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:29px;line-height:1.1;color:#16131f;margin-top:3px;">${esc(mRangeHeading())}</div>
  </div>
  ${mRangeChips('m-range', mRangeKey())}

  <div style="border-radius:20px;padding:18px;background:var(--grad-time-money);box-shadow:${M_LIFT};color:#fff;margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <div>
        <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.78;">${single ? 'Logged today' : 'Logged'}</div>
        <div style="font-family:var(--font-heading);font-weight:700;font-size:32px;line-height:1.1;margin-top:4px;">${esc(mDur(logged))}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.78;">${workMode() ? 'Projects' : 'Money out'}</div>
        <div style="font-family:var(--font-heading);font-weight:700;font-size:32px;line-height:1.1;margin-top:4px;">${
          workMode() ? String(new Set(list.map((e) => e.category).filter(Boolean)).size) : esc(mMoney(mOutToday(dates)))}</div>
        <!-- Under the figure it belongs to rather than above the label: a
             heading, its number, then the smaller fact about it reads down in
             one line of sight. Money in is a slower number than money out —
             a salary lands once, lunch is bought every day — so it is the
             footnote and not the headline, but it is on the card, because
             spending with nothing to weigh it against is half a sentence. -->
        ${workMode() ? '' : `
        <div style="font-size:12px;margin-top:5px;opacity:.85;white-space:nowrap;">
          <span style="opacity:.8;">Money in</span> ${esc(mMoney(mInToday(dates)))}
        </div>`}
      </div>
    </div>
    <div style="display:flex;gap:3px;margin-top:16px;height:9px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.22);">
      ${bars.map((b) => `<div style="height:100%;flex-basis:0;border-radius:999px;background:${b.color};flex-grow:${b.grow};"></div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:9px;font-size:11.5px;opacity:.85;">
      <span>${single ? `${esc(mDur(Math.max(0, capacity - logged)))} unlogged` : `${esc(mDur(logged))} across ${dates.length} days`}</span>
      <span>${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span>
    </div>
    <!-- The account balance, shown only once there is one to show. With
         nothing logged coming in it would be a line saying the spending has
         nothing to come off, on every empty day, forever.

         Labelled, because everything above it on this card is the window on
         screen and this is not — an unlabelled figure here would read as
         today's. -->
    ${(() => {
      // Nothing in this product puts money on the account. See workMode().
      if (workMode()) return '';
      const st = moneyStatus(moneyAll());
      if (!st.inCents && !st.asideCents) return '';
      return `<div style="display:flex;gap:8px;margin-top:8px;padding-top:9px;border-top:1px solid rgba(255,255,255,.22);font-size:12px;opacity:.92;">
        <span style="flex:none;letter-spacing:.08em;text-transform:uppercase;font-size:10.5px;opacity:.8;padding-top:1px;">Balance</span>
        <span>${esc(st.tone === 'left' ? `${amount(st.leftCents / 100)} left` : st.short)}${
          st.asideCents ? ` · ${esc(amount(st.asideCents / 100))} aside` : ''}</span>
      </div>`;
    })()}
  </div>

  ${mRangeKey() === 'today' ? mTimerCard() : ''}

  <div style="display:flex;gap:10px;margin-bottom:22px;">
    ${[['m-log-time', '#f2eefe', '#5f3ac9', nodeIcon('clock', 17), workMode() ? 'Log work' : 'Log time', '15px']]
      .concat(workMode() ? [] : [['m-log-money', '#eceefe', '#3f4bc4', esc(mGlyph()), 'Log money', '13px']]).map((q) => `
      <button class="card" data-act="${q[0]}"
        style="flex:1;flex-direction:column;gap:6px;align-items:flex-start;padding:14px;border-radius:16px;box-shadow:${M_SHADOW_SM};cursor:pointer;text-align:left;">
        <span style="width:30px;height:30px;border-radius:10px;background:${q[1]};display:grid;place-items:center;font-size:${q[5]};font-weight:700;color:${q[2]};">${q[3]}</span>
        <span style="font-family:var(--font-heading);font-weight:700;font-size:15px;color:#16131f;">${esc(q[4])}</span>
      </button>`).join('')}
  </div>

  ${gaps.length ? `
  <button data-act="m-go-review" data-day="${day}"
    style="display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border-radius:16px;cursor:pointer;text-align:left;background:#efedf6;border:1px solid rgba(120,86,245,.22);margin-bottom:22px;">
    <span class="m-hatch-tile" style="width:34px;height:34px;flex:none;border-radius:11px;"></span>
    <span style="flex:1;">
      <span style="display:block;font-family:var(--font-body);font-weight:600;font-size:14.5px;color:#16131f;">${esc(mDur(mGapTotal(gaps)))} unaccounted for</span>
      <span style="display:block;font-size:12.5px;color:#756f88;margin-top:2px;">Review the day and fill the blanks</span>
    </span>
    <span style="font-size:17px;color:#7450e4;">→</span>
  </button>` : ''}

  ${single ? mBodyCard(day) : ''}

  ${mCalCard(dates)}

  ${searchField()}

  <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
    <h4 style="margin:0;font-family:var(--font-heading);font-weight:700;font-size:19px;color:#16131f;">${searching ? 'Found' : single ? 'Your day' : 'Your entries'}</h4>
    <span style="font-size:12.5px;color:#756f88;">${searching ? '' : `${list.length} ${list.length === 1 ? 'entry' : 'entries'}`}</span>
  </div>

  <div id="search-body">${searching ? searchBody() : ''}</div>

  ${searching ? '' : list.length ? (single
    ? `<div style="display:flex;flex-direction:column;gap:9px;">${list.map(mEntryRow).join('')}</div>`
    : mEntryDrawer(mGroupedList(dates)))
    : `
  <div style="padding:30px 24px;border-radius:20px;background:#fff;border:1px dashed rgba(120,86,245,.35);text-align:center;">
    <div style="width:46px;height:46px;margin:0 auto;border-radius:14px;background:#f2eefe;display:grid;place-items:center;color:#5f3ac9;">${nodeIcon('clock', 21)}</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:19px;color:#16131f;margin-top:14px;">Nothing logged ${single ? 'yet' : 'in this stretch'}</div>
    <p style="margin:7px 0 0;font-size:14px;color:#756f88;line-height:1.45;">${single
      ? 'Start a timer for what you are doing now, or log something that already happened.'
      : 'Nothing was logged across these days. Pick a shorter window, or start filling one in.'}</p>
  </div>`}

  ${mDonateCard()}
</div>`;
}

/* ── 4. the add flow ── */

const M_FLOW_COPY = {
  1: ['What are you logging?', 'Pick one — you can add the details next.'],
  2: { time: ['What were you doing?', 'Choose a category, then the activity.'], money: ['How much?', 'Tap the amount. No keyboard needed.'] },
  /* Money going out and money coming in are the same question asked in
     opposite directions, and one wording cannot do both: asking what a salary
     was "for" reads as an accusation, and "purpose" is not what anybody calls
     where their money came from. The list underneath is the same list — it is
     the vocabulary the balance is split by, whichever way the money moved. */
  3: {
    time: ['When was that?', 'Drag either end of the bar, or tap the times to type them.'],
    money: ['What was it for?', 'Purpose keeps the weekly split honest.'],
    moneyIn: ['Where did it come from?', 'The source is what makes the balance readable.']
  },
  4: ['Look right?', 'Tap anything to change it.']
};

/* Which of those to show. Steps 1 and 4 ask the same thing either way, step 2
   only splits time from money, and step 3 splits all three. */
const mFlowCopy = (step, money, dir) => {
  const at = M_FLOW_COPY[step];
  if (!at) return ['', ''];
  if (Array.isArray(at)) return at;
  if (!money) return at.time;
  return (dir === 'in' && at.moneyIn) || at.money;
};

/* What the middle field is called, in each direction. Purposes on the money
   side, categories on the time side; a source when the money is arriving. */
const mVocabWord = (money, dir) => (money ? (dir === 'in' ? 'source' : 'purpose') : 'category');

/* What was named on step 2: typed beats tapped, because the box is only open
   when somebody chose to type in it. */
const mActivityName = () => (state.m.activityText || '').trim() || state.m.activity || '';

/* What the entry will be called. The category still stands in behind it — the
   money side names a spend after its purpose, and a row from the day review is
   written straight to the log without walking the flow at all — so the
   fallback stays where it is rather than letting anything reach the log
   called "Untitled". */
const mDraftLabel = () => mActivityName() || state.m.cat || '';

const mIsMoney = () => state.m.kind === 'money';

/* Which steps this particular draft has to walk. Normally all four; a draft
   handed over by a running timer already knows its kind and already measured
   its start and length, so those two steps are dropped rather than asked over
   again. The numbering and the progress bar follow the sequence, so a flow
   that skips two steps says "1 of 2" instead of opening on "step 2 of 4". */
const mFlowSteps = () => [1, 2, 3, 4].filter((n) => (state.m.skip || []).indexOf(n) < 0);
const mStepAt = () => Math.max(0, mFlowSteps().indexOf(state.m.step));

/* ── leaving without saving ──

   Everything typed into the flow lives in state.m and nothing reaches the log
   until the last step, so closing it throws the lot away. That was a single
   silent tap: the ✕ at the top, or Back off the first step. Worst on a timed
   entry, where what is discarded is a measurement that cannot be taken again —
   m-timer-stop clears the running timer the moment it hands over, so there is
   nothing left to go back to.

   Asked only when there is something to lose. A draft is compared against
   itself as it was when the flow opened, rather than against an empty one:
   opening the logger and closing it changes nothing, and neither does opening
   an entry to edit and thinking better of it. The mark is taken at the first
   paint, which is after every opener has finished filling the draft in. */
const M_DRAFT_FIELDS = ['kind', 'cat', 'activity', 'activityText', 'dir', 'amount',
  'day', 'earlierIso', 'startMin', 'durMin', 'note'];
const mDraftSig = () => JSON.stringify(M_DRAFT_FIELDS.map((k) => state.m[k]));

function mFlowDirty() {
  const s = state.m;
  // Saved already. The draft still differs from its mark, and nothing is at risk.
  if (s.step === 5) return false;
  /* A timed draft is dirty from the moment it arrives. The measurement is the
     work — it was made by waiting, and no amount of retyping brings it back. */
  if (s.timed) return true;
  return !!s.mark && s.mark !== mDraftSig();
}

function mCanAdvance() {
  const s = state.m;
  if (s.step === 1) return !!s.kind;
  /* A category is not an answer to "what were you doing?". Logging an hour
     against "Chores" and nothing else saved an entry called Chores, which
     tells you the shape of the week and nothing about the hour — and it is the
     hour the estimates, the search and the day review all read. Timing first
     and naming after is the whole point of the timer handover, so the naming
     is now required rather than merely offered. */
  if (s.step === 2) return mIsMoney() ? Number(s.amount) > 0 : !!(s.cat && mActivityName());
  if (s.step === 3) return mIsMoney() ? !!s.cat : s.durMin > 0;
  return true;
}

/* The date the draft lands on. Today and Yesterday cover almost everything;
   "Pick a date" opens a calendar, which is a date picker made of taps rather
   than a field that summons a keyboard. */
function mDraftIso() {
  const s = state.m;
  if (s.day === 'today') return todayIso;
  if (s.day === 'yesterday') return mShiftIso(todayIso, -1);
  return s.earlierIso || mShiftIso(todayIso, -2);
}
const mDayChipLabel = () => {
  const s = state.m;
  if (s.day === 'today') return 'Today';
  if (s.day === 'yesterday') return 'Yesterday';
  return dayLabel(mDraftIso());
};

/* ── the calendar ──
   Money may be dated forwards: a bill you have already committed to is a real
   thing to record before it lands. Time may not — hours you have not spent yet
   are not hours, and a tracker that let you log them would be measuring
   intention rather than fact. So the future is open on one kind and closed on
   the other, and the grid greys out what it will not take. */
const mCalMax = () => (mIsMoney() ? mShiftIso(todayIso, 365) : todayIso);

const mMonthOf = (isoDate) => isoDate.slice(0, 7);
const mCalCursor = () => state.m.calMonth || mMonthOf(mDraftIso());
const mShiftMonth = (ym, delta) => {
  const d = new Date(ym + '-01T00:00:00');
  d.setMonth(d.getMonth() + delta);
  return iso(d).slice(0, 7);
};

function mCalendar() {
  const cursor = mCalCursor();
  const selected = mDraftIso();
  const max = mCalMax();
  const first = new Date(cursor + '-01T00:00:00');
  // Monday-first, which is how a week is written everywhere the app is used.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const date = `${cursor}-${pad(d)}`;
    const on = date === selected;
    const today = date === todayIso;
    const beyond = date > max;
    cells.push(`
      <button data-act="m-cal-pick" data-iso="${date}"${beyond ? ' aria-disabled="true"' : ''}
        aria-pressed="${on}" aria-label="${esc(mLongDate(date))}"
        style="min-height:40px;border-radius:11px;cursor:${beyond ? 'default' : 'pointer'};font-family:var(--font-body);
               font-size:13.5px;font-weight:${on || today ? 700 : 500};border:1px solid ${on ? 'transparent' : today ? 'rgba(120,86,245,.45)' : 'transparent'};
               background:${on ? M_GRAD_FLAT : 'transparent'};
               color:${on ? '#fff' : beyond ? '#c9c5d4' : today ? '#5f3ac9' : '#3b3648'};
               opacity:${beyond ? 0.55 : 1};">${d}</button>`);
  }
  // Stepping past the last allowed month has nothing to show.
  const nextBlocked = mShiftMonth(cursor, 1) > mMonthOf(max);

  return `
<div class="card" style="margin-top:10px;padding:14px;border-radius:16px;gap:0;box-shadow:${M_SHADOW_SM};">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <button data-act="m-cal-step" data-d="-1" aria-label="Previous month"
      style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(120,86,245,.35);background:#fff;color:#5f3ac9;font-size:15px;line-height:1;cursor:pointer;">‹</button>
    <span style="font-family:var(--font-heading);font-weight:700;font-size:15.5px;color:#16131f;">${esc(monthLabel)}</span>
    <button data-act="m-cal-step" data-d="1"${nextBlocked ? ' aria-disabled="true"' : ''} aria-label="Next month"
      style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(120,86,245,.35);background:#fff;color:#5f3ac9;font-size:15px;line-height:1;cursor:pointer;opacity:${nextBlocked ? 0.4 : 1};">›</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;">
    ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span style="text-align:center;font-size:10.5px;font-weight:600;color:#9995ab;">${d}</span>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">${cells.join('')}</div>
</div>`;
}

/* The when-chips, shared by the kind step and money's amount step: a payment
   is dated as often as it is counted, and having to walk back a step to say so
   is what makes people give up and leave it on today. */
const mDayChip = (day, label) => `
  <button data-act="m-day" data-day="${esc(day)}" aria-pressed="${state.m.day === day}"
    style="padding:9px 16px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;${mChip(state.m.day === day)}">${esc(label)}</button>`;

function mFlowKind() {
  const s = state.m;
  const card = (kind, mark, title, sub, tileBg, tileFg) => {
    const on = s.kind === kind;
    return `
    <button data-act="m-kind" data-kind="${kind}" aria-pressed="${on}"
      style="display:flex;align-items:center;gap:14px;width:100%;padding:16px;border-radius:18px;cursor:pointer;text-align:left;background:${on ? M_GRAD_FLAT : '#fff'};border:1.5px solid ${on ? 'transparent' : 'rgba(47,28,102,.1)'};box-shadow:${on ? '0 10px 26px rgba(79,70,229,.3)' : M_SHADOW_SM};">
      <span style="width:44px;height:44px;flex:none;border-radius:14px;display:grid;place-items:center;font-size:19px;font-weight:700;background:${on ? 'rgba(255,255,255,.2)' : tileBg};color:${on ? '#fff' : tileFg};">${mark}</span>
      <span style="flex:1;">
        <span style="display:block;font-family:var(--font-heading);font-weight:700;font-size:17px;color:${on ? '#fff' : '#16131f'};">${esc(title)}</span>
        <span style="display:block;font-size:13px;margin-top:2px;color:${on ? 'rgba(255,255,255,.82)' : '#756f88'};">${esc(sub)}</span>
      </span>
    </button>`;
  };
  const chip = mDayChip;
  return `
<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">
  ${card('time', nodeIcon('clock', 22), workMode() ? 'Work' : 'Activity', workMode() ? 'Time against a project' : 'Something you did', '#f2eefe', '#5f3ac9')}
  ${workMode() ? '' : card('money', esc(mGlyph()), 'Money', 'Something you spent or earned', '#eceefe', '#3f4bc4')}
</div>
${mLabel('When')}
<div style="display:flex;flex-wrap:wrap;gap:8px;">
  ${chip('today', 'Today')}${chip('yesterday', 'Yesterday')}${chip('earlier', s.day === 'earlier' ? esc(dayLabel(mDraftIso())) : 'Pick a date')}
</div>
${s.day === 'earlier' ? mCalendar() : ''}`;
}

/* The category grid, shared by time's step 2 and money's step 3. Drawn from the
   account's own categories, with the activity pills under it drawn from what
   has actually been logged under the one that is selected. */
/* A list rather than a grid of cards. The grid was drawn against the six
   categories the handoff proposed; an account that has grown its own runs to a
   dozen or more, and a dozen 86px cards is a screen and a half of scrolling
   before the question can even be answered.

   The popover, its filtering, its backdrop and its Escape key are the ones the
   desktop already uses — same classes, same generic `filterPicker`. What
   differs is the caret: the desktop lands it in the search box on open, and
   here it does not. A keyboard that appears over a list you were about to tap
   is the thing this whole flow is built to avoid, so search is a field you
   choose to tap, sitting above a list you can thumb through instead. */
function mFlowCategory() {
  const s = state.m;
  const money = mIsMoney();
  const rows = mVocab(money);
  const acts = s.cat ? mActs(s.cat, money) : [];
  const open = state.pickOpen === 'm-cat';
  const label = mVocabWord(money, s.dir);
  /* Held open by the text as well as by the tap. Continuing closes the box —
     it does not empty it — so coming back to this step from the review used to
     show an untouched row of chips over an answer that was still there and
     still counting. Now the answer is on screen wherever it is being read
     from. No focus is taken by drawing it: only m-type-open asks for that. */
  const typed = s.typing || !!(s.activityText || '').trim();
  // Said where the gap is, rather than by a Continue button that stops working.
  // Drawn whenever the question is being asked and hidden when it is answered,
  // rather than drawn on demand: typing does not re-render, so what changes on
  // a keystroke has to already be in the tree for mPaintNext to reach it.
  const asksName = !money && !!s.cat;
  return `
<div class="pick-field m-pick" data-pick-field="m-cat" style="margin-bottom:22px;">
  <div class="pick-anchor">
  <button type="button" class="pick-btn" data-act="m-pick-open"
    aria-haspopup="listbox" aria-expanded="${open}"
    style="width:100%;min-height:50px;padding:0 14px;border-radius:16px;background:#fff;
      border:1.5px solid ${s.cat ? '#7856f5' : 'rgba(47,28,102,.12)'};font-family:var(--font-body);font-size:15px;">
    ${s.cat
      ? `<span style="width:11px;height:11px;flex:none;border-radius:50%;background:${esc(mColor(s.cat, money))};"></span>
         <span style="flex:1;min-width:0;font-weight:600;color:#16131f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.cat)}</span>`
      : `<span style="flex:1;color:#756f88;font-weight:600;">Choose a ${label}</span>`}
    <span class="pick-caret" aria-hidden="true" style="color:#7450e4;">▾</span>
  </button>
  ${open ? `
  <div class="pick-pop" role="listbox" style="border-radius:16px;">
    <input class="input pick-search" data-k="m-pick-search" data-pick-search="m-cat"
      type="text" placeholder="Search ${esc(label)}…" autocomplete="off"
      aria-label="Search ${esc(label)}" style="min-height:42px;font-size:15px;">
    <div class="pick-list" data-pick-list style="max-height:46vh;">
      ${rows.map((c) => (renamingPick(money ? 'purpose' : 'category', c.name) ? `
        <span class="pick-row is-editing">
          <input class="input pick-rename" data-k="pick-rename-name" data-sync="pickRenameName"
            value="${esc(state.pickRenameName)}" data-enter="pick-rename-save"
            aria-label="Rename ${esc(c.name)}" autocomplete="off" style="min-height:42px;font-size:15px;">
          <button type="button" class="pick-del pick-ok" data-act="pick-rename-save" aria-label="Save the new name">✓</button>
          <button type="button" class="pick-del" data-act="pick-rename-cancel" aria-label="Cancel renaming">✕</button>
        </span>` : `
        <span class="pick-row">
          <button type="button" class="pick-opt${c.name === s.cat ? ' is-on' : ''}" role="option"
            aria-selected="${c.name === s.cat}" data-act="m-pick-choose"
            data-name="${esc(c.name)}" data-find="${esc(c.name.toLowerCase())}">
            <span style="width:9px;height:9px;flex:none;border-radius:50%;background:${esc(mColor(c.name, money))};"></span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</span>
          </button>
          <button type="button" class="pick-del" data-act="pick-rename" data-pick="${money ? 'purpose' : 'category'}"
            data-name="${esc(c.name)}" aria-label="Rename ${esc(c.name)}">✎</button>
          <button type="button" class="pick-del" data-act="pick-del" data-pick="${money ? 'purpose' : 'category'}"
            data-name="${esc(c.name)}" aria-label="Delete ${esc(c.name)}">✕</button>
        </span>`)).join('')}
      <div class="pick-empty" hidden style="padding:12px 10px;font-size:14px;color:#756f88;">Nothing matches that.</div>
    </div>
    ${state.m.pickNew
      ? `<div class="pick-create">
          <input class="input" data-k="m-pick-new" data-sync="m.pickNewName" value="${esc(state.m.pickNewName)}"
            placeholder="Name it" autocomplete="off" data-enter="m-pick-create"
            style="min-height:42px;font-size:15px;">
          <button class="btn btn-primary" data-act="m-pick-create" style="min-height:42px;padding-inline:16px;font-size:14px;">Add</button>
        </div>`
      : `<button type="button" class="pick-new" data-act="m-pick-new">+ New ${esc(label)}</button>`}
  </div>
  <div class="pick-shade" data-backdrop="pick-close"></div>` : ''}
  </div>
</div>
${mLabel(s.cat ? `${s.cat} — usual ones` : `Pick a ${label} first`)}
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
  ${acts.map((a) => `
    <button data-act="m-act" data-name="${esc(a)}" aria-pressed="${s.activity === a}"
      style="padding:9px 15px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;${mChip(s.activity === a)}">${esc(a)}</button>`).join('')}
  ${typed ? '' : `
  <button data-act="m-type-open"
    style="padding:9px 15px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;background:transparent;color:#7450e4;border:1px dashed rgba(120,86,245,.55);">Type it</button>`}
</div>
${typed ? `
<input class="input" type="text" data-k="m-activity" data-sync="m.activityText" value="${esc(s.activityText)}"
  placeholder="${money && s.dir === 'in' ? 'Where from?' : 'What was it?'}"${money ? '' : ' data-live-name'}
  style="min-height:46px;padding:10px 14px;font-size:15px;border:1.5px solid #7856f5;border-radius:14px;box-shadow:0 0 0 3px rgba(120,86,245,.18);">` : ''}
${asksName ? `
<p data-name-hint${mActivityName() ? ' hidden' : ''} style="margin:10px 2px 0;font-size:12.5px;color:#756f88;line-height:1.45;">
  Tap one or type it — an entry needs a name of its own. “${esc(s.cat)}” says which part of the day it was, not what you did.</p>` : ''}`;
}

// Money's step 2. Every digit is a tap: the numpad is the whole point, and a
// real number field here would put a keyboard over the amount it is setting.
function mFlowAmount() {
  const s = state.m;
  const has = Number(s.amount) > 0;
  const opt = (dir, label) => `
    <label class="seg-opt" style="flex:1;justify-content:center;min-height:40px;border-radius:999px;border-left:0;font-family:var(--font-heading);font-weight:700;font-size:14px;color:${s.dir === dir ? '#fff' : '#575168'};">
      <input type="radio" name="m-dir" data-act="m-dir" data-dir="${dir}"${s.dir === dir ? ' checked' : ''}><span>${label}</span>
    </label>`;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  return `
<div class="seg" style="display:flex;width:100%;gap:6px;padding:4px;background:#e8e6ef;border-color:transparent;margin-bottom:18px;">
  ${opt('out', 'Money out')}${opt('in', 'Money in')}
</div>
<div style="text-align:center;padding:6px 0 18px;">
  <div style="font-family:var(--font-heading);font-weight:700;font-size:52px;line-height:1;letter-spacing:-.01em;color:${has ? (s.dir === 'in' ? '#1c8a63' : '#16131f') : '#c3bfd0'};">${esc(currency().symbol + (s.amount || '0'))}</div>
  <div style="font-size:12.5px;color:#756f88;margin-top:6px;">${s.dir === 'in' ? 'Coming in' : 'Going out'}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:18px;">
  ${keys.map((k) => `
    <button class="m-key" data-act="m-key" data-key="${k === '.' ? 'dot' : k === '⌫' ? 'del' : k}"
      style="min-height:56px;border-radius:16px;cursor:pointer;font-family:var(--font-heading);font-weight:700;font-size:22px;color:#16131f;background:#fff;border:${M_HAIR};box-shadow:${M_SHADOW_SM};">${esc(k)}</button>`).join('')}
</div>
${mLabel('When')}
<div style="display:flex;flex-wrap:wrap;gap:8px;">
  ${mDayChip('today', 'Today')}${mDayChip('yesterday', 'Yesterday')}
  ${mDayChip('earlier', s.day === 'earlier' ? dayLabel(mDraftIso()) : 'Pick a date')}
</div>
${s.day === 'earlier' ? mCalendar() : ''}`;
}

/* Time's step 3. The drag track is the centrepiece and everything else on the
   screen is another way of saying the same two numbers — every control moves
   the handle, and the handle moves every control. */
/* ── when it ran ──
   One bar with two handles. This step used to carry five separate controls —
   hour chips, a minute stepper, minute chips, length chips and a second rail —
   which between them said the same two numbers five ways and filled the screen
   doing it. A start and an end is all the information there is, so the bar
   holds both and nothing else does.

   A run past midnight puts the end handle to the left of the start, and the
   fill breaks into two pieces across the ends of the bar — which is what
   crossing midnight looks like on a day-long rail. */

// The longest a single session is allowed to be, which is also what keeps
// dragging an end past the other side from inventing a twenty-three hour entry.
const M_SPAN_MAX = 720;

function mFlowWhen() {
  const s = state.m;
  /* Only a measured length gets the "long stretch" warning. It exists for a
     timer left running after the thing it was timing stopped, and its wording
     says so — shown against a span someone has just dragged by hand it accuses
     them of an accident they did not have, and every night's sleep would trip
     it. */
  const long = s.timed && s.durMin > 240;
  const crosses = s.startMin + s.durMin > 1440;
  /* The handoff copy promised a split across the two days; the app has always
     kept a run past midnight as one row dated the morning it ended, which is
     what makes last night's sleep show up on today. The behaviour is the older
     of the two and the one the rest of the app reads, so the sentence gives
     way rather than the storage. */
  const warning = long
    ? 'That is a long stretch. If the timer kept running after you stopped, trim it here.'
    : (crosses ? 'This crosses midnight — Zimpan will file it on the morning it ends.' : '');

  const endMin = (s.startMin + s.durMin) % 1440;
  const pct = (m) => (m / 1440) * 100;
  const wraps = s.startMin + s.durMin > 1440;
  // Two pieces when it wraps, one when it does not.
  const fills = wraps
    ? [[pct(s.startMin), 100 - pct(s.startMin)], [0, pct(endMin)]]
    : [[pct(s.startMin), pct(endMin) - pct(s.startMin)]];

  return `
${warning ? `
<div style="display:flex;gap:11px;align-items:flex-start;padding:13px 14px;border-radius:16px;background:#fdf3e6;border:1px solid rgba(224,145,58,.35);margin-bottom:14px;">
  <span style="font-size:15px;line-height:1.3;color:#a8631a;">!</span>
  <span style="flex:1;font-size:13.5px;line-height:1.45;color:#7a4a13;">${esc(warning)}</span>
  <button data-act="m-halve"
    style="flex:none;min-height:34px;padding:0 13px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:12.5px;font-weight:600;color:#7a4a13;background:#fff;border:1px solid rgba(224,145,58,.5);">Halve it</button>
</div>` : ''}
<div class="card" style="border-radius:20px;padding:18px;box-shadow:${M_SHADOW_MD};gap:0;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;">
    <button id="m-range" data-act="m-time-type" aria-label="Type the times instead"
      style="border:0;background:transparent;padding:0;cursor:pointer;text-align:left;font-family:var(--font-heading);font-weight:700;font-size:26px;color:#16131f;border-bottom:1.5px dashed rgba(116,80,228,.45);">${esc(mRange(s.startMin, s.durMin))}</button>
    <span id="m-durlabel" style="font-size:13px;color:#7450e4;font-weight:600;">${esc(mDur(s.durMin))}</span>
  </div>
  <div class="m-track" data-m-track="range" style="height:44px;margin-top:14px;">
    <div class="m-rail" style="top:17px;"></div>
    ${fills.map(([l, w]) => `<div class="m-fill" style="top:17px;left:${l}%;width:${Math.max(0, w)}%;"></div>`).join('')}
    <div class="m-handle" data-handle="start" style="top:8px;left:${pct(s.startMin)}%;"></div>
    <div class="m-handle" data-handle="end" style="top:8px;left:${pct(endMin)}%;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:10.5px;color:#9995ab;margin-top:2px;">
    <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
    <span style="font-size:12.5px;color:#756f88;">Drag either end, or tap the times.</span>
    <button data-act="m-now"
      style="border:0;background:transparent;cursor:pointer;font-family:var(--font-body);font-size:12.5px;font-weight:600;color:#7450e4;padding:0;">Start now</button>
  </div>
</div>`;
}

function mFlowReview() {
  const s = state.m;
  const money = mIsMoney();
  const rows = money
    ? [['What', mDraftLabel() || 'Untitled', 3], ['Amount', (s.dir === 'in' ? '+' : '−') + mMoney(s.amount), 2],
      [s.dir === 'in' ? 'Source' : 'Purpose', s.cat || '—', 3], ['When', mDayChipLabel(), 1]]
    : [['What', mDraftLabel() || 'Untitled', 2], ['Category', s.cat || '—', 2],
      ['Time', mRange(s.startMin, s.durMin), 3], ['When', mDayChipLabel(), 1]];
  return `
<div class="card" style="border-radius:20px;padding:18px;box-shadow:0 4px 14px rgba(47,28,102,.1);gap:13px;margin-bottom:14px;">
  ${rows.map((r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;">
      <span style="font-size:13px;color:#756f88;">${esc(r[0])}</span>
      <button data-act="m-jump" data-step="${r[2]}"
        style="border:0;background:transparent;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:14.5px;color:#16131f;text-align:right;padding:0;">${esc(r[1])} <span style="color:#7450e4;font-size:12.5px;font-weight:600;">edit</span></button>
    </div>`).join('')}
</div>
${s.noteOpen
    ? `<textarea class="input" data-k="m-note" data-sync="m.note" placeholder="Anything worth remembering?"
        style="min-height:88px;padding:12px 14px;font-size:14.5px;border:1.5px solid #7856f5;border-radius:16px;box-shadow:0 0 0 3px rgba(120,86,245,.18);">${esc(s.note)}</textarea>`
    : `<button data-act="m-note-open"
        style="width:100%;padding:14px;border-radius:16px;cursor:pointer;font-family:var(--font-body);font-size:14px;font-weight:600;color:#7450e4;background:transparent;border:1px dashed rgba(120,86,245,.5);text-align:left;">+ Add a note</button>`}`;
}

function mFlowDone() {
  const money = mIsMoney();
  const logged = mLoggedMins([todayIso]);
  const sub = money
    ? `That is ${mMoney(mOutToday([todayIso]))} out today. Zimpan folded it into your week.`
    : `You have logged ${mDur(logged)} today. ${mDur(1440 - logged)} still unaccounted for.`;
  return `
<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 0 10px;animation:zPop .3s ease both;">
  <div style="width:78px;height:78px;border-radius:50%;background:${M_GRAD_FLAT};box-shadow:0 14px 32px rgba(79,70,229,.35);display:grid;place-items:center;font-size:34px;color:#fff;">✓</div>
  <div style="font-family:var(--font-heading);font-weight:700;font-size:26px;color:#16131f;margin-top:20px;">${money ? 'Money logged' : 'Time logged'}</div>
  <p style="margin:8px 0 0;font-size:14.5px;color:#575168;line-height:1.5;max-width:28ch;">${esc(sub)}</p>
</div>`;
}

/* The question on the way out. Yes and no, both named after what they do: a
   dialog whose buttons are the bare words is one you have to read twice to be
   sure which way is which, and this one is asked at the moment somebody is
   already leaving. */
function mQuitDialog() {
  const s = state.m;
  if (!s.quitAsk) return '';
  const timed = !!s.timed;
  const editing = !!s.editId;
  const money = mIsMoney();
  return lightbox({
    icon: timed ? 'clock' : 'trash',
    tone: 'var(--zg-alert)',
    kicker: timed ? `${esc(mDur(Math.max(1, s.durMin)))} timed` : 'Not saved yet',
    title: editing ? 'Leave without saving your changes?' : 'Leave without saving this log?',
    closeAct: 'm-quit-no',
    body: timed
      ? `<p>You timed <strong>${esc(mDur(Math.max(1, s.durMin)))}</strong> and have not written it down yet.
         The clock has already been stopped, so leaving now throws the measurement away — there is no
         way to take it again.</p>`
      : editing
        ? `<p>What you changed here has not been saved. Leaving now keeps the ${money ? 'spend' : 'entry'}
           exactly as it was.</p>`
        : `<p>This ${money ? 'spend' : 'entry'} has not been saved. Leaving now discards what you have
           filled in so far.</p>`,
    /* No last, which is where the safe answer belongs in both layouts: the
       action row reverses under 720px so the last button sits on top, right
       under the thumb that has just missed the ✕. The delete dialogs put the
       destructive answer there because pressing Delete is already a decision;
       this one can be reached by a mis-tap, so the default is to keep. */
    actions: `
      <button class="btn" data-act="m-quit-yes"
        style="background:#8a2f4a;color:#fff;border-color:#8a2f4a;">Yes, leave it</button>
      <button class="btn btn-secondary" data-act="m-quit-no">No, keep it</button>`
  });
}

function mFlowBody() {
  const s = state.m;
  const money = mIsMoney();
  if (s.step === 5) return mFlowDone();
  if (s.step === 1) return mFlowKind();
  if (s.step === 2) return money ? mFlowAmount() : mFlowCategory();
  if (s.step === 3) return money ? mFlowCategory() : mFlowWhen();
  return mFlowReview();
}

function mFlow() {
  const s = state.m;
  const money = mIsMoney();
  const copy = s.step >= 5 ? ['', ''] : mFlowCopy(s.step, money, s.dir);
  const can = mCanAdvance();
  const done = s.step === 5;
  const seq = mFlowSteps();
  const at = mStepAt();
  const last = at === seq.length - 1;
  return `
<div style="min-height:100vh;padding-bottom:140px;">
${mStepChrome({
    step: at + 1, total: seq.length, label: done ? 'Saved' : `Step ${at + 1} of ${seq.length}`,
    back: 'm-flow-back', hideBack: at === 0 || done, close: 'm-flow-close'
  })}
<div style="padding:18px 22px 12px;">
  <div style="animation:zStep .28s ease both;">
    ${copy[0] ? mHead(copy[0], copy[1]) : ''}
    <div id="m-step-body">${mFlowBody()}</div>
  </div>
</div>
${mFooter({
    act: 'm-flow-next', can: can || done,
    label: done ? 'Back to today' : last ? 'Save entry' : 'Continue',
    skip: last && !done && !s.noteOpen ? 'm-flow-skip' : '', skipLabel: 'Skip for now'
  })}
</div>`;
}

/* ── 5. day review ── */

function mReview() {
  const day = state.m.reviewDay || todayIso;
  const gaps = mGaps(day);
  const total = mGapTotal(gaps);
  return `
<div style="padding:6px 22px 34px;">
  <button data-act="m-go-home"
    style="border:0;background:transparent;cursor:pointer;font-family:var(--font-body);font-size:14px;color:#7450e4;padding:6px 0;font-weight:600;">← ${esc(mRangeHeading())}</button>
  <div style="margin:12px 0 20px;">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#7450e4;font-weight:600;">${day === todayIso ? 'Close out the day' : esc(mKicker(day))}</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:28px;line-height:1.1;color:#16131f;margin-top:4px;">${esc(mDur(total))} unaccounted for</div>
    <p style="margin:8px 0 0;font-size:14px;color:#756f88;line-height:1.45;">${gaps.length} ${gaps.length === 1 ? 'stretch' : 'stretches'} with nothing logged. Fill what you remember, mark the rest untracked.</p>
  </div>
  ${gaps.length ? `
  <div style="display:flex;flex-direction:column;gap:11px;">
    ${gaps.map((g) => `
    <div class="card" style="padding:16px;border-radius:18px;box-shadow:${M_SHADOW_SM};gap:0;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-family:var(--font-heading);font-weight:700;font-size:19px;color:#16131f;">${esc(mClock(g.a))} – ${esc(mClock(g.b))}</span>
        <span style="font-size:13px;font-weight:600;color:#7450e4;">${esc(mDur(g.b - g.a))}</span>
      </div>
      <div style="height:8px;border-radius:999px;background:#e8e6ef;margin:12px 0 14px;overflow:hidden;">
        <div class="m-hatch" style="height:100%;border-radius:999px;width:${Math.min(100, Math.round(((g.b - g.a) / 240) * 100))}%;"></div>
      </div>
      <div style="display:flex;gap:9px;">
        <button class="btn btn-primary" data-act="m-gap-fill" data-a="${g.a}" data-b="${g.b}" data-day="${day}"
          style="flex:1;min-height:44px;font-size:14px;box-shadow:0 4px 12px rgba(79,70,229,.28);">Fill this in</button>
        <button data-act="m-gap-skip" data-a="${g.a}" data-b="${g.b}" data-day="${day}"
          style="flex:none;min-height:44px;padding:0 16px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;color:#575168;background:#fff;border:1px solid rgba(47,28,102,.14);">Untracked</button>
      </div>
    </div>`).join('')}
  </div>`
    : `
  <div style="padding:26px;border-radius:20px;background:#efedf6;text-align:center;">
    <div style="font-size:30px;">✓</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:20px;color:#16131f;margin-top:10px;">Nothing left open</div>
    <p style="margin:6px 0 0;font-size:14px;color:#575168;">Every stretch from 6am is accounted for.</p>
  </div>`}
</div>`;
}

/* ── 8. entry detail ── */

function mDetail() {
  const s = state.m;
  const money = s.selectedKind === 'money';
  const row = findRow(money ? 'money' : 'entries', s.selected);
  if (!row) return mHome();
  const cat = money ? row.purpose : row.category;
  const dir = money ? (mCents(row.in) > 0 ? 'in' : 'out') : '';
  const amt = money ? (dir === 'in' ? Number(row.in) : Number(row.out)) : 0;
  const rows = money
    ? [[dir === 'in' ? 'Source' : 'Purpose', cat], ['Direction', dir === 'in' ? 'Money in' : 'Money out'],
      ['Date', mLongDate(row.date)], ['Note', row.note || '—']]
    : [['Category', cat], ['Started', mClock(Number(row.from) || 0)],
      ['Ended', mClock(Number(row.to) || 0)], ['Date', mLongDate(row.date)], ['Note', row.note || '—']];
  return `
<div style="padding:6px 22px 34px;">
  <button data-act="m-go-home"
    style="border:0;background:transparent;cursor:pointer;font-family:var(--font-body);font-size:14px;color:#7450e4;padding:6px 0;font-weight:600;">← Today</button>
  <div class="card" style="margin-top:14px;border-radius:22px;box-shadow:0 4px 14px rgba(47,28,102,.1);padding:20px;gap:0;">
    <div><span class="tag ${money ? 'tag-accent-2' : 'tag-accent'}" style="padding:4px 11px;">${money ? 'Money' : 'Activity'} · ${esc(cat)}</span></div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:27px;line-height:1.15;color:#16131f;margin-top:12px;">${esc(row.activity)}</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:40px;line-height:1.1;margin-top:6px;color:${money && dir === 'in' ? '#1c8a63' : '#16131f'};">${esc(money ? (dir === 'in' ? '+' : '−') + mMoney(amt) : mDur(span(row)))}</div>
    <div style="height:1px;background:rgba(22,19,31,.12);margin:18px 0;"></div>
    <div style="display:flex;flex-direction:column;gap:13px;">
      ${rows.map((r) => `
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;">
          <span style="color:#756f88;">${esc(r[0])}</span>
          <span style="font-weight:600;color:#16131f;text-align:right;">${esc(r[1])}</span>
        </div>`).join('')}
    </div>
  </div>
  <div style="display:flex;gap:10px;margin-top:16px;">
    <button class="btn btn-secondary" data-act="m-detail-edit" style="flex:1;min-height:48px;font-size:15px;">Edit</button>
    <button class="btn" data-act="m-detail-delete"
      style="flex:1;min-height:48px;font-size:15px;color:#8a2f4a;background:#fff;border:1px solid rgba(138,47,74,.3);">Delete</button>
  </div>
</div>`;
}

/* ── 6. insights ── */

function mInsights() {
  // Nothing to chart, and no way to have logged any. See workMode().
  const money = !workMode() && state.m.insightTab === 'money';
  const series = mRangeSeries(money);
  const byCategory = !!(series[0] && series[0].color);
  const max = Math.max.apply(null, series.map((w) => w.v).concat([1]));
  /* Where a phone's card gives out. It is not a column count but a width: a
     row of weekday initials packs tighter than a row of month names, so the
     test asks how much room these particular labels need rather than assuming
     they are all one letter. Past the card's ~300px the row scrolls. */
  const labelled = series.some((w) => String(w.label).length > 2);
  const wide = series.length * (labelled ? 34 : 24) > 300;
  const split = mWeekSplit(money);
  const splitMax = split.length ? split[0].raw : 1;
  const total = money
    ? mMoney(series.reduce((a, w) => a + mCents(w.v), 0) / 100)
    : mDur(series.reduce((a, w) => a + w.v, 0));
  const opt = (tab, label) => `
    <label class="seg-opt" style="flex:1;justify-content:center;min-height:38px;border-radius:999px;border-left:0;font-family:var(--font-heading);font-weight:700;font-size:14px;color:${(state.m.insightTab === tab) ? '#fff' : '#575168'};">
      <input type="radio" name="m-insight" data-act="m-insight-tab" data-tab="${tab}"${state.m.insightTab === tab ? ' checked' : ''}><span>${label}</span>
    </label>`;
  return `
<div style="padding:6px 22px 108px;">
  ${mBrandBar()}
  <div style="margin-bottom:18px;">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#7450e4;font-weight:600;">${esc(mRangeKicker(mInsightKey()))}</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:29px;line-height:1.1;color:#16131f;margin-top:3px;">The pattern</div>
  </div>
  ${mRangeChips('m-insight-range', mInsightKey())}
  <div class="seg" style="display:flex;width:100%;gap:6px;padding:4px;background:#e8e6ef;border-color:transparent;margin-bottom:18px;">
    ${opt('time', workMode() ? 'Work' : 'Activity')}${workMode() ? '' : opt('money', 'Money')}
  </div>

  ${mReportCard(money)}

  <div class="card" style="border-radius:20px;box-shadow:${M_SHADOW_MD};padding:18px;gap:0;margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;">
      <span style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;">${byCategory ? (money ? 'Spent by purpose' : 'Hours by category') : (money ? 'Spent per day' : 'Hours logged per day')}</span>
      <span style="font-family:var(--font-heading);font-weight:700;font-size:22px;color:#16131f;">${esc(total)}</span>
    </div>
    <!-- A week's worth of columns divides the card up happily; a month's does
         not, and the day letters under them will not shrink past their own
         width, so the row simply ran off the right of the screen. Past a dozen
         columns they take a fixed width and the row scrolls inside the card
         instead — the card stays put, and the page never scrolls sideways. -->
    ${wide ? mScrollHint(`Scroll for all ${series.length}`) : ''}
    <div class="m-bars${wide ? ' is-wide' : ''}" data-bars="${esc(mInsightKey() + ':' + (money ? 'money' : 'time') + ':' + series.length)}"
      style="display:flex;align-items:flex-end;gap:${wide ? 6 : 8}px;height:132px;${wide ? 'overflow-x:auto;overflow-y:hidden;' : ''}">
      ${series.map((w, i) => `
        <div style="${wide ? 'flex:0 0 26px;' : 'flex:1;'}display:flex;flex-direction:column;align-items:center;gap:5px;justify-content:flex-end;height:100%;">
          <!-- The figure above its own bar. Heights say which is biggest; only
               a number says by how much, and a chart nobody can read a value
               off is decoration. -->
          <span style="font-size:${wide ? 8.5 : 10}px;font-weight:600;color:${w.v > 0 ? '#575168' : '#c9c5d4'};white-space:nowrap;">${esc(mBarValue(w.v, money))}</span>
          <div style="width:100%;border-radius:8px 8px 4px 4px;min-height:5px;height:${Math.round((w.v / max) * 100)}%;background:${w.color ? esc(w.color) : i === series.length - 1 ? 'linear-gradient(180deg,#8b5cf6,#4f46e5)' : '#e4dcfd'};"></div>
          <span style="font-size:10.5px;color:#9995ab;font-weight:500;">${esc(w.label)}</span>
        </div>`).join('')}
    </div>
  </div>

  ${split.length ? `
  <div class="card" style="border-radius:20px;box-shadow:${M_SHADOW_MD};padding:18px;gap:14px;margin-bottom:14px;">
    <span style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;">Where it went</span>
    ${split.map((r) => `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;">
          <span style="font-weight:600;color:#16131f;">${esc(r.name)}</span>
          <span style="color:#756f88;">${esc(r.value)}</span>
        </div>
        <div style="height:8px;border-radius:999px;background:#e8e6ef;overflow:hidden;">
          <div style="height:100%;border-radius:999px;background:${esc(r.color)};width:${Math.round((r.raw / splitMax) * 100)}%;"></div>
        </div>
      </div>`).join('')}
  </div>` : ''}

  <div style="border-radius:20px;padding:18px;background:#efedf6;border:1px solid rgba(47,28,102,.07);margin-bottom:14px;">
    <div style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#7450e4;margin-bottom:7px;">Noticed</div>
    <p style="margin:0;font-size:14.5px;line-height:1.5;color:#3b3648;">${esc(mNotice(money))}</p>
  </div>

  ${mDonateCard()}
</div>`;
}

/* ── 9. tab bar, sheets ── */

/* Shown only once there is something to come back from — toggled by a scroll
   listener rather than a render, since scrolling is not a state change. */
function mTopButton() {
  return `
<button id="m-top" data-act="m-scroll-top" aria-label="Back to top"
  style="display:none;position:fixed;right:18px;bottom:104px;z-index:12;width:44px;height:44px;border-radius:50%;
         border:1px solid rgba(120,86,245,.3);background:#fff;color:#5f3ac9;font-size:17px;line-height:1;
         box-shadow:0 6px 18px rgba(47,28,102,.18);cursor:pointer;display:none;place-items:center;">${nodeIcon('up', 19)}</button>`;
}

/* Two either side of the button that logs. Adding Ask left the row with one
   tab on the left and two on the right, which read as lopsided because it was:
   the + is centred, so the tabs have to be even or it leans.

   Donate takes the fourth slot rather than something invented to fill it — it
   already had a home on the phone (the nudge sheet) and no way in from the
   chrome. It keeps the amber it wears everywhere else instead of taking the
   violet of a nav item, because it is not one: the other four move you around
   the app, and this one leaves it. */
function mTabs() {
  const on = state.m.screen;
  const tab = (act, glyph, label, active, tone) => `
    <button data-act="${act}"${active ? ' aria-current="page"' : ''}
      style="border:0;background:transparent;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:var(--font-body);font-size:11px;font-weight:600;min-width:52px;min-height:46px;color:${tone || (active ? '#7450e4' : '#9995ab')};">
      <span style="line-height:1;">${glyph}</span>${label}
    </button>`;
  /* The two sides are their own flex boxes with the button between them, rather
     than five children sharing one space-around. That is what actually holds
     the + in the middle: Ask is only drawn where the server has a key for it,
     so counting on the tabs to come out even leans the row the other way on an
     install without one. Each side spreads its own, whatever it holds.

     Padding pulled in and the tabs narrowed, because five items plus a 58px
     button do not fit a 320px screen at the old 26px inset. */
  const side = (inner) => `<div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:space-around;">${inner}</div>`;
  return `
<div style="position:fixed;left:0;right:0;bottom:0;z-index:10;height:92px;display:flex;align-items:center;padding:0 10px 22px;background:linear-gradient(180deg,rgba(248,247,251,0),rgba(248,247,251,.96) 42%);backdrop-filter:blur(8px);">
  ${side(`
    ${tab('m-go-home', nodeIcon('home', 21), 'Home', on === 'home')}
    ${workMode() ? '' : tab('m-donate-open', nodeIcon('heart', 21), 'Donate', false, '#e08a1e')}`)}
  <button data-act="m-flow-open" aria-label="Log something"
    style="width:58px;height:58px;flex:none;border:0;border-radius:50%;cursor:pointer;background:${M_GRAD_FLAT};box-shadow:0 10px 24px rgba(79,70,229,.4);color:#fff;font-size:26px;font-weight:300;line-height:1;margin-bottom:12px;">+</button>
  ${side(`
    ${tab('m-go-insights', nodeIcon('insights', 21), 'Insights', on === 'insights')}
    ${state.aiEstimates ? tab('chat-open', nodeIcon('pulse', 21), 'Ask', state.chat.open) : ''}`)}
</div>`;
}

/* The panel is capped and scrolls inside itself. Without the cap a sheet
   taller than the screen overflowed the top of a flex-end column — off the
   viewport, with nothing able to scroll back to it, so the title and the
   figures under it simply could not be reached. The food sheet with a long AI
   breakdown was the one that grew past the screen and found it.

   overscroll-behavior keeps a flick at the end of the list from carrying on
   into the page behind the sheet. */
const mSheet = (inner, pad) => `
<div data-backdrop="m-sheet-close" style="position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(36,31,48,.5);">
  <div style="background:#fff;border-radius:28px 28px 0 0;padding:${pad};box-shadow:0 -18px 44px rgba(47,28,102,.24);animation:zStep .26s ease both;
              max-height:calc(100dvh - 18px);overflow-y:auto;overscroll-behavior:contain;">${inner}</div>
</div>`;

/* ── 7. donate ──
   The button is a real link to PayPal, which reports nothing back. Tapping it
   records interest — donate_clicks — and nothing more; the money itself is
   reconciled by hand into `donations`, and the two must not be confused. */
function mDonateSheet() {
  const s = state.m;
  if (s.donateThanks) {
    return mSheet(`
  <div style="text-align:center;">
    <div style="width:66px;height:66px;margin:0 auto;border-radius:50%;background:${M_GRAD_FLAT};display:grid;place-items:center;color:#fff;box-shadow:0 12px 28px rgba(79,70,229,.34);">${nodeIcon('heart', 28)}</div>
    <div style="font-family:var(--font-heading);font-weight:700;font-size:23px;color:#16131f;margin-top:18px;">Thank you</div>
    <p style="margin:8px auto 20px;font-size:14px;line-height:1.5;color:#575168;max-width:30ch;">You will get a receipt by email. Nothing about your app changes — that is the point.</p>
    <button class="btn btn-primary" data-act="m-donate-close" style="width:100%;min-height:50px;font-size:15.5px;">Back to Zimpan</button>
  </div>`, '30px 22px 34px');
  }
  return mSheet(`
  <div style="margin:-24px -20px 0;position:relative;">
    <button data-act="m-donate-close" aria-label="Close"
      style="position:absolute;top:12px;right:14px;z-index:2;width:30px;height:30px;border:0;border-radius:50%;cursor:pointer;
             background:rgba(36,31,48,.42);color:#fff;font-size:19px;line-height:1;display:grid;place-items:center;">✕</button>
    <div style="height:150px;border-radius:24px 24px 0 0;overflow:hidden;">${DONATE_HERO}</div>
    <div style="margin-top:-14px;border-radius:22px 22px 0 0;background:#fbf3e4;padding:20px 20px 4px;text-align:center;">
      <span style="display:inline-block;margin-bottom:12px;padding:5px 13px;border:1px solid rgba(184,137,46,.34);border-radius:999px;
                   font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:#9a6f22;background:rgba(242,215,154,.26);">A note from the maker</span>
      <div style="font-family:var(--font-heading);font-weight:700;line-height:1.04;">
        <div style="font-size:clamp(24px,7.4vw,30px);color:#14a05c;white-space:nowrap;">HELP US IMPROVE</div>
        <div style="font-size:clamp(24px,7.4vw,30px);color:#1d6f8f;white-space:nowrap;">DONATE A DOLLAR</div>
      </div>
      <p style="margin:12px 0 18px;font-size:13.5px;line-height:1.6;color:#6b5f4a;">Zimpan is free, carries no ads, and never sells what you log. A dollar covers the server it runs on and the next feature you have been asking for.</p>
      <a class="btn" href="${DONATE_URL}" data-donate data-m-donate target="_blank" rel="noopener noreferrer"
        style="display:inline-flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:52px;border-radius:999px;
               background:linear-gradient(180deg,#f2c552,#d99a1f);color:#3d2c05;font-family:var(--font-body);font-size:16px;font-weight:700;
               box-shadow:0 4px 14px rgba(160,110,10,.34);border:0;">${nodeIcon('heart', 18)}<span>Donate Now</span></a>
      <button data-act="m-donate-close"
        style="width:100%;min-height:42px;border:0;background:transparent;cursor:pointer;font-family:var(--font-body);font-size:12.5px;font-weight:600;color:#9a6f22;text-decoration:underline;margin-top:10px;">Maybe later</button>
    </div>
  </div>`, '24px 20px 0');
}

/* The avatar's sheet. Not in the design, and it is here for two things the
   nine screens have no other home for: signing out, and getting back to the
   full layout on a phone. */
function mAccountSheet() {
  const open = todoOpenCount();
  const team = state.team && state.team.team;
  return mSheet(`
  <div class="mn-grab" aria-hidden="true"></div>
  <div class="mn-top">
    ${wordmark(26, 19)}
    <button class="mn-x" data-act="m-sheet-close" aria-label="Close">✕</button>
  </div>
  ${menuWho()}
  <div class="mn-list">
    ${menuRow({ act: 'todo-open', icon: 'todo', label: 'To Do', badge: open || '' })}
    <!-- Both, because the phone has no tracker to be on: hours and money are
         one app here, and a pad that appeared only while the money tab of
         Insights happened to be open would be a pad nobody could find. -->
    ${workMode() ? '' : menuRow({ act: 'plan-open', icon: 'scales', label: 'Money Plan', badge: planOpenCount() || '' })}
    ${menuRow({ act: 'm-classic', icon: 'layout', label: 'Full view' })}
    ${menuRow({ act: 'team-open', icon: 'people', label: team ? team.name : 'Start a team' })}
    ${menuRow({ act: 'prefs-open', icon: 'sliders', label: 'Preferences' })}
    ${menuRow({ act: 'go-blogs', icon: 'article', label: 'Blog' })}
  </div>
  ${menuExit()}
  <!-- The phone app had no route to any of these at all, which is not a thing
       to ship to strangers. Kept at the foot, as one line of small print. -->
  <div class="mn-legal">
    <button data-act="legal-privacy">Privacy</button><i></i>
    <button data-act="legal-terms">Terms of Use</button><i></i>
    <button data-act="legal-faq">FAQs</button><i></i>
    <button data-act="help-open">Help</button>
  </div>`, '14px 20px 26px');
}

/* The whole phone experience, assembled. */
function mobileApp() {
  const s = state.m;
  const tabbed = s.screen === 'home' || s.screen === 'insights';
  return `
<div style="min-height:100vh;background:#f8f7fb;color:#16131f;font-family:var(--font-body);">
  ${s.screen === 'setup' ? mSetup() : ''}
  ${s.screen === 'home' ? mHome() : ''}
  ${s.screen === 'insights' ? mInsights() : ''}
  ${s.screen === 'flow' ? mFlow() : ''}
  ${s.screen === 'review' ? mReview() : ''}
  ${s.screen === 'detail' ? mDetail() : ''}
  ${tabbed ? mTabs() + mTopButton() : ''}
  ${s.accountOpen ? mAccountSheet() : ''}
  ${todoSheet()}
  ${planSheet()}
  ${todoWhyDialog()}
  ${s.donateOpen ? mDonateSheet() : ''}
  ${mCalSheet()}
  ${mTimeDialog()}
  ${mDeductSheet()}
  <!-- The consent sheet is the desktop's, unchanged. Nothing is sent without
       it, so it has to reach every layout that can ask — and it is already
       responsive, so there is nothing to rebuild. -->
  ${aiConsentDialog()}
  ${refineAskDialog()}
  ${mChatSheet()}
  ${chatConsentDialog()}
  ${recapDialog()}
  ${prefsDialog()}
  ${teamSheet()}
  ${crossKindDialog()}
  <!-- Same reasoning, and it was missing: toggleTimer is shared with this
       layout and raises a note prompt when it stops, so the phone could set a
       prompt that nothing here drew — the question was asked and then swallowed,
       and with it the only way to take a note back off an entry. -->
  ${notePromptDialog()}
  ${mealNoteDialog()}
  ${mQuitDialog()}
  ${state.reportOpen ? reportSheet() : ''}
  ${pickDeleteDialog()}
</div>`;
}

/* ── odds and ends the screens lean on ── */

const mElapsedSec = () => (state.timerStart ? Math.floor((Date.now() - state.timerStart) / 1000) : 0);
const mElapsedLabel = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
  return `${h ? h + ':' + pad(m) : m}:${pad(sec)}`;
};

function mInitials() {
  const from = state.displayName || (state.auth && state.auth.email) || '';
  const words = from.replace(/@.*$/, '').split(/[^A-Za-z]+/).filter(Boolean);
  if (!words.length) return 'Z';
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

/* "10:30pm", "22:30", "10.30 pm" — a bedtime typed the way people type one.
   With no am/pm an evening hour is read as the evening, because that is what
   the question asked; midnight typed as 12 is read as midnight. */
function mParseClock(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\./g, ':');
  if (!t) return null;
  const hit = t.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!hit) return null;
  let h = Number(hit[1]);
  const mins = Number(hit[2] || 0);
  if (h > 23 || mins > 59) return null;
  const ap = hit[3];
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && h === 12) h = 0;
  else if (!ap && h >= 6 && h <= 11) h += 12;
  return h * 60 + mins;
}

// The phone takes the whole app unless it has been sent back to the full
// layout by hand.
const mobileOn = () => isPhone() && !state.mClassic;

const mDraftDayFromRange = () => (mRangeKey() === 'yesterday' ? 'yesterday' : 'today');

function mResetDraft() {
  Object.assign(state.m, {
    step: 1, kind: null, day: 'today', earlierIso: '', calMonth: '', skip: [], timed: false,
    cat: null, activity: null, typing: false, activityText: '',
    dir: 'out', amount: '', startMin: mDefaultStart(), durMin: 60,
    note: '', noteOpen: false, editId: null, editKind: null,
    // Retaken at the first paint of the next flow. See mFlowDirty().
    mark: '', quitAsk: false
  });
}

/* ── writing it down ──
   The one place the draft becomes a row. Ids are minted here rather than
   asked for, so this works with no network at all; `touch` stamps updated_at
   and drops the row in the outbox, which is what makes the sync resolve. */
function mCommit() {
  const s = state.m;
  const date = mDraftIso();
  const label = (mDraftLabel() || (mIsMoney() ? 'Money' : 'Activity')).slice(0, 200);
  const note = s.note.trim().slice(0, 500);

  if (mIsMoney()) {
    /* Parsed through minor units so what was tapped is what is stored: the
       column is DECIMAL and 0.1 + 0.2 has no business anywhere near it. */
    const value = Math.round(Number(s.amount || 0) * 100) / 100;
    const patch = {
      date, activity: label, purpose: s.cat,
      in: s.dir === 'in' ? value : 0, out: s.dir === 'in' ? 0 : value, note
    };
    if (s.editId) {
      state.money = state.money.map((r) => (r.id === s.editId ? touch('money', Object.assign({}, r, patch)) : r));
    } else {
      const row = touch('money', Object.assign({ id: 'mn' + Date.now() }, patch));
      state.money = state.money.concat([row]);
      // Editing an existing spend does not re-ask: it was answered once already.
      askDeduct(row);
    }
  } else {
    const from = s.startMin;
    const dur = Math.max(1, Math.min(1439, s.durMin));
    const to = (from + dur) % 1440;
    /* Past midnight the entry belongs to the morning it ended, which is the
       rule the rest of the app already reads `to < from` by. */
    const patch = { date: to < from ? nextDay(date) : date, activity: label, category: s.cat, from, to, note };
    if (s.editId) {
      state.entries = state.entries.map((r) => (r.id === s.editId ? touch('entries', withProject(Object.assign({}, r, patch))) : r));
    } else {
      state.entries = state.entries.concat([touch('entries', withProject(Object.assign({ id: 'm' + Date.now() }, patch)))]);
    }
  }
  state.selectedDate = date;
  state.m.step = 5;
  save();
  queueSync(0);
  render();
}

/* Setup's one write. Everything it collected lands at once, and the taxonomy
   is replaced rather than added to — setup only ever runs on an account with
   nothing logged, so there is nothing to orphan. */
function mFinishSetup() {
  const s = state.m;
  const at = Date.now();

  if (s.setupCurrency && s.setupCurrency !== state.currency
      && CURRENCIES.some((c) => c.code === s.setupCurrency)) {
    state.currency = s.setupCurrency;
    state.currencyUpdatedAt = at;
    state.dirty.currency = true;
  }
  const name = s.setupName.trim();
  if (name) { state.displayName = name.slice(0, 120); state.nameUpdatedAt = at; state.dirty.name = true; }

  const kg = Math.round(Number(s.weight));
  if (kg >= 20 && kg <= 400) { state.weightKg = kg; state.weightUpdatedAt = at; state.dirty.weight = true; }

  const sleep = mParseClock(s.sleep);
  if (sleep != null) { state.sleepMin = sleep; state.sleepUpdatedAt = at; state.dirty.sleep = true; }

  state.tracksUpdatedAt = at;
  state.dirty.tracks = true;

  // Categories: what was picked, in the order it was offered.
  const chosen = s.setupCats.slice();
  state.categories.slice().forEach((c) => {
    if (chosen.indexOf(c.name) < 0) {
      state.categories = state.categories.filter((x) => x.name !== c.name);
      bury('categories', c.name);
    }
  });
  chosen.forEach((nm, i) => {
    const color = (M_CATS.find((c) => c.name === nm) || {}).color || '#5f3ac9';
    const held = state.categories.find((c) => c.name === nm);
    if (held) { held.color = color; held.position = i; touch('categories', held); }
    else state.categories = state.categories.concat([touch('categories', { name: nm, color, position: i })]);
  });

  // Purposes are not offered at setup, so the six the flow asks about are
  // seeded whole. Same rule: nothing has been logged against what is here.
  const wanted = M_PURPOSES.map((p) => p.name);
  state.purposes.slice().forEach((p) => {
    if (wanted.indexOf(p.name) < 0) {
      state.purposes = state.purposes.filter((x) => x.name !== p.name);
      bury('purposes', p.name);
    }
  });
  M_PURPOSES.forEach((p, i) => {
    const held = state.purposes.find((x) => x.name === p.name);
    if (held) { held.color = p.color; held.position = i; touch('purposes', held); }
    else state.purposes = state.purposes.concat([touch('purposes', { name: p.name, color: p.color, position: i })]);
  });

  state.setupDone = true;
  state.m.screen = 'home';
  save();
  queueSync(0);
  render();
}

/* ── the drag track ──
   Pointer events on the window rather than the element, because a finger that
   leaves the 38px hit area mid-drag is still dragging. The rect is measured
   once on the way down: the track does not move, and measuring it on every
   move would read a layout this very handler is busy changing. */
let mDrag = null;
let mDragFrame = 0;

function mDragTo(x) {
  if (!mDrag || !mDrag.width) return;
  const pct = Math.min(1, Math.max(0, (x - mDrag.left) / mDrag.width));

  // Midnight to midnight across the bar, at the resolution of a minute.
  const at = Math.max(0, Math.min(1439, Math.round(pct * 1440)));
  const s = state.m;
  const endMin = (s.startMin + s.durMin) % 1440;

  if (mDrag.handle === 'end') {
    /* The span is measured forwards from the start and wraps past midnight, so
       an end earlier on the bar than the start reads as the next morning
       rather than as a negative length. Capped so dragging an end all the way
       round cannot quietly invent a twenty-three hour entry. */
    const span = ((at - s.startMin) + 1440) % 1440;
    const next = Math.max(1, Math.min(M_SPAN_MAX, span));
    if (next === s.durMin) return;
    s.durMin = next;
  } else {
    if (at === s.startMin) return;
    // Moving the start leaves the end where it was and the length absorbs it.
    const span = ((endMin - at) + 1440) % 1440;
    s.startMin = at;
    s.durMin = Math.max(1, Math.min(M_SPAN_MAX, span));
  }

  /* Only the step's own body is redrawn. A full render would replace the shell
     and replay the step animation on every frame of the drag — and every
     control on this step is inside the body anyway, so the chips and the
     readouts still follow the handle. */
  const body = document.getElementById('m-step-body');
  if (body) body.innerHTML = mFlowWhen();
}

function mDragWire() {
  root.addEventListener('pointerdown', (ev) => {
    const track = ev.target.closest('[data-m-track]');
    if (!track) return;
    const r = track.getBoundingClientRect();
    /* Which handle answers depends on where the press landed, decided once on
       the way down and held for the whole gesture — recomputing it per frame
       would hand the drag to the other handle the moment it was overtaken.
       Distance is measured the short way round the clock, so a press just
       after midnight reaches an end handle sitting at 11pm. */
    const pct = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const at = Math.round(pct * 1440);
    const endMin = (state.m.startMin + state.m.durMin) % 1440;
    const away = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1440 - d); };
    const handle = away(at, state.m.startMin) <= away(at, endMin) ? 'start' : 'end';
    mDrag = { left: r.left, width: r.width, kind: track.dataset.mTrack || 'start', handle };
    // The press itself moves that handle, so a tap on the bar counts as a drag.
    mDragTo(ev.clientX);
  });
  window.addEventListener('pointermove', (ev) => {
    if (!mDrag) return;
    ev.preventDefault();
    if (mDragFrame) return;
    const x = ev.clientX;
    mDragFrame = requestAnimationFrame(() => { mDragFrame = 0; mDragTo(x); });
  }, { passive: false });
  const end = () => { mDrag = null; };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/* The running timer repaints its own two lines every second. Re-rendering for
   a clock would rebuild the screen underneath whatever the user was reaching
   for, once a second, forever. */
function mTick() {
  if (!state.timerStart || !mobileOn() || state.m.screen !== 'home') return;
  const secs = mElapsedSec();
  const el = document.getElementById('m-elapsed');
  if (el) el.textContent = mElapsedLabel(secs);
  const warn = document.getElementById('m-timer-long');
  if (warn) warn.style.display = secs > 4 * 3600 ? 'block' : 'none';
}

/* ── actions ── */

/* Which screen the phone opens on is decided once per session, and again if
   the account changes underneath it. */
let mBooted = false;

const mGo = (screen) => { state.m.screen = screen; render(); };
const mSet = (patch) => { Object.assign(state.m, patch); render(); };

const M_ACTIONS = {
  /* sign in — both buttons open the real credential panel, and both land in
     setup once it closes, exactly as the design intends. */
  'm-signup': () => { state.authOpen = true; setAuthMode('register'); },
  'm-signin': () => { state.authOpen = true; setAuthMode('login'); },

  /* setup */
  // Step 1 has nothing behind it — the account already exists by then — so the
  // chevron is not drawn there and this only ever steps back.
  'm-setup-back': () => {
    if (state.m.setupStep <= 1) return;
    mSet({ setupStep: state.m.setupStep - 1, nameTyping: false, catTyping: false });
  },
  'm-setup-next': () => {
    if (!mSetupCan()) return;
    if (state.m.setupStep >= 3) { mFinishSetup(); return; }
    mSet({ setupStep: state.m.setupStep + 1, nameTyping: false, catTyping: false });
  },
  // "Skip both" leaves the two optional fields empty and finishes anyway.
  'm-setup-skip': () => { state.m.weight = ''; state.m.sleep = ''; mFinishSetup(); },
  'm-name-open': () => { state.focusField = 'm-name'; mSet({ nameTyping: true }); },
  'm-currency': (el) => mSet({ setupCurrency: el.dataset.code }),
  'm-track': (el) => {
    const key = el.dataset.key;
    state.tracks = Object.assign({}, state.tracks, { [key]: !state.tracks[key] });
    render();
  },
  'm-setup-cat': (el) => {
    const name = el.dataset.name;
    const held = state.m.setupCats;
    mSet({ setupCats: held.indexOf(name) >= 0 ? held.filter((n) => n !== name) : held.concat([name]) });
  },
  'm-newcat-open': () => { state.focusField = 'm-newcat'; mSet({ catTyping: true }); },
  'm-newcat-add': () => {
    const name = state.m.catText.trim().slice(0, 60);
    // An empty submit is a change of mind, not an error.
    if (!name) { mSet({ catTyping: false, catText: '' }); return; }
    const known = M_CATS.some((c) => c.name === name) || state.m.customCats.indexOf(name) >= 0;
    mSet({
      customCats: known ? state.m.customCats : state.m.customCats.concat([name]),
      setupCats: state.m.setupCats.indexOf(name) >= 0 ? state.m.setupCats : state.m.setupCats.concat([name]),
      catText: '', catTyping: false
    });
  },

  /* getting about */
  'm-scroll-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  'm-entries-more': () => {
    state.drawers.mEntries = !state.drawers.mEntries;
    save(); render();
  },

  /* Steps and weight. Both write through the same stamps the desktop uses, so
     a count entered on the phone merges with one entered on the laptop rather
     than one of them quietly winning. */
  'm-steps-open': () => {
    const day = mSelectedDay();
    state.focusField = 'm-steps-input';
    mSet({ stepsOpen: true, stepsDraft: String(state.steps[day] || ''), weightOpen: false });
  },
  'm-steps-save': () => {
    const day = mSelectedDay();
    const n = Math.round(Number(state.m.stepsDraft));
    // Blank or zero clears the day rather than storing a nought — the stamp
    // stays, so the clearing itself is what travels to the other devices.
    if (Number.isFinite(n) && n > 0) state.steps[day] = Math.min(200000, n);
    else delete state.steps[day];
    state.stepsAt[day] = Date.now();
    state.dirty.steps = true;
    state.m.stepsOpen = false;
    state.m.stepsDraft = '';
    save(); queueSync(0); render();
  },
  'm-weight-open': () => {
    state.focusField = 'm-weight-input';
    mSet({ weightOpen: true, weightDraft: state.weightKg ? String(state.weightKg) : '', stepsOpen: false });
  },
  'm-weight-save': () => {
    const n = Math.round(Number(state.m.weightDraft));
    // The server takes 20–400kg or nothing; anything else is a typo, and a
    // typo should leave what is already stored alone.
    if (Number.isFinite(n) && n >= 20 && n <= 400) {
      state.weightKg = n;
      state.weightUpdatedAt = Date.now();
      state.dirty.weight = true;
    } else if (!String(state.m.weightDraft).trim()) {
      state.weightKg = null;
      state.weightUpdatedAt = Date.now();
      state.dirty.weight = true;
    }
    state.m.weightOpen = false;
    state.m.weightDraft = '';
    save(); queueSync(0); render();
  },
  'm-go-home': () => mGo('home'),
  'm-go-insights': () => mGo('insights'),
  'm-range': (el) => mSet({ range: el.dataset.key }),
  'm-insight-range': (el) => mSet({ insightRange: el.dataset.key }),
  'm-go-review': (el) => mSet({ reviewDay: (el && el.dataset.day) || todayIso, screen: 'review' }),
  // Refused as well as hidden, the same way the money tracker is: a hidden
  // control is a drawing decision, and this is what the product is.
  'm-insight-tab': (el) => {
    if (workMode() && el.dataset.tab === 'money') return;
    mSet({ insightTab: el.dataset.tab });
  },
  'm-open-entry': (el) => mSet({ screen: 'detail', selected: el.dataset.id, selectedKind: el.dataset.kind }),
  'm-account-open': () => mSet({ accountOpen: true }),
  'm-cal-open': (el) => mSet({ calOpen: el.dataset.kind }),
  'm-sheet-close': () => {
    // An unanswered balance question is not dismissed by tapping past it —
    // that would leave the spend in a state nobody chose.
    if (state.deductAsk && state.deductAsk.done) state.deductAsk = null;
    mSet({ accountOpen: false, donateOpen: false, donateThanks: false, calOpen: null });
  },
  'm-classic': () => { state.mClassic = true; state.m.accountOpen = false; save(); render(); },
  'm-mobile': () => { state.mClassic = false; save(); render(); },

  /* the flow */
  /* Opening the flow from a day you are reading defaults the draft to that
     day — logging into yesterday while looking at yesterday should not need
     the WHEN chip changed as well. A multi-day window has no one day to mean,
     so those fall back to today. */
  'm-flow-open': () => { mResetDraft(); mSet({ screen: 'flow', day: mDraftDayFromRange() }); },
  'm-log-time': () => { mResetDraft(); mSet({ screen: 'flow', kind: 'time', step: 2, skip: [1], day: mDraftDayFromRange() }); },
  'm-log-money': () => { mResetDraft(); mSet({ screen: 'flow', kind: 'money', step: 2, skip: [1], day: mDraftDayFromRange() }); },
  /* Both ways out of the flow ask first when there is something to lose, and
     go straight out when there is not. See mFlowDirty(). */
  'm-flow-close': () => {
    if (mFlowDirty()) { mSet({ quitAsk: true }); return; }
    mResetDraft(); mGo('home');
  },
  'm-flow-back': () => {
    const seq = mFlowSteps(), at = mStepAt();
    if (at > 0) { mSet({ step: seq[at - 1], typing: false }); return; }
    // Back off the first step is the same door as the ✕.
    if (mFlowDirty()) { mSet({ quitAsk: true }); return; }
    mResetDraft(); mGo('home');
  },
  'm-quit-no': () => mSet({ quitAsk: false }),
  'm-quit-yes': () => { mResetDraft(); mGo('home'); },
  'm-flow-next': () => {
    const s = state.m;
    if (s.step === 5) { mResetDraft(); mGo('home'); return; }
    if (!mCanAdvance()) return;
    const seq = mFlowSteps(), at = mStepAt();
    if (at === seq.length - 1) { mCommit(); return; }
    mSet({ step: seq[at + 1], typing: false });
  },
  // "Skip for now" skips the note, not the entry — the entry still saves.
  'm-flow-skip': () => mCommit(),
  /* Jumping from the review is how a skipped step is reached deliberately —
     the timer got the length wrong, say — so arriving at one puts it back in
     the sequence rather than bouncing straight out of it again. */
  'm-jump': (el) => {
    const step = Number(el.dataset.step) || 1;
    mSet({ step, typing: false, skip: (state.m.skip || []).filter((n) => n !== step) });
  },

  'm-kind': (el) => {
    if (workMode() && el.dataset.kind === 'money') return;
    mSet({ kind: el.dataset.kind, cat: null, activity: null, activityText: '', typing: false });
  },
  'm-day': (el) => mSet({ day: el.dataset.day }),
  'm-cal-step': (el) => {
    const next = mShiftMonth(mCalCursor(), Number(el.dataset.d));
    if (next > mMonthOf(mCalMax())) return;
    mSet({ calMonth: next });
  },
  'm-cal-pick': (el) => {
    const date = el.dataset.iso;
    if (date > mCalMax()) return;
    mSet({ earlierIso: date, calMonth: mMonthOf(date) });
  },
  'm-cat': (el) => mSet({ cat: el.dataset.name, activity: null, activityText: '', typing: false }),
  /* Deliberately no `focusField` here, unlike the desktop's `pick-open`: the
     list opens ready to be tapped, and the keyboard waits to be asked for. */
  'm-pick-open': () => {
    state.pickOpen = state.pickOpen === 'm-cat' ? null : 'm-cat';
    state.pickQuery = '';
    state.m.pickNew = false;
    state.m.pickNewName = '';
    render();
  },
  'm-pick-new': () => {
    state.focusField = 'm-pick-new';
    mSet({ pickNew: true, pickNewName: state.pickQuery.trim() });
  },
  'm-pick-create': () => {
    const name = String(state.m.pickNewName || '').trim().slice(0, 60);
    if (!name) { mSet({ pickNew: false, pickNewName: '' }); return; }
    if (mIsMoney()) addPurposeIfNeeded(name); else addCategoryIfNeeded(name);
    Object.assign(state.m, {
      cat: name, activity: null, activityText: '', typing: false,
      pickNew: false, pickNewName: ''
    });
    state.pickOpen = null;
    state.pickQuery = '';
    save(); queueSync(0); render();
  },
  'm-pick-choose': (el) => {
    state.pickOpen = null;
    state.pickQuery = '';
    mSet({ cat: el.dataset.name, activity: null, activityText: '', typing: false });
  },
  // Picking a pill clears what was typed, and typing clears the pill: the two
  // are the same field entered two ways, not two fields.
  'm-act': (el) => mSet({ activity: el.dataset.name, typing: false, activityText: '' }),
  'm-type-open': () => { state.focusField = 'm-activity'; mSet({ typing: true, activity: null }); },
  'm-note-open': () => { state.focusField = 'm-note'; mSet({ noteOpen: true }); },

  'm-dir': (el) => mSet({ dir: el.dataset.dir }),
  'm-key': (el) => {
    const k = el.dataset.key;
    const held = state.m.amount;
    if (k === 'del') { mSet({ amount: held.slice(0, -1) }); return; }
    // One decimal point, and a bare "." opens with the zero it implies.
    if (k === 'dot') { if (held.indexOf('.') < 0) mSet({ amount: (held || '0') + '.' }); return; }
    // Eight digits is more money than any of these currencies needs on a phone.
    if (held.replace(/[^0-9]/g, '').length >= 8) return;
    // Two decimal places is the whole minor unit; a third has nowhere to go.
    const dot = held.indexOf('.');
    if (dot >= 0 && held.length - dot > 2) return;
    mSet({ amount: held === '0' ? k : held + k });
  },

  // Choosing how long something ran must not move when it started. It used to
  // pull the start back so the two fitted inside one day, which silently
  // rewrote 11pm into the afternoon the moment you asked for seven hours.
  'm-now': () => {
    const n = new Date();
    mSet({ startMin: n.getHours() * 60 + n.getMinutes(), durMin: state.m.durMin });
  },
  // Half of it, landed on the nearest quarter hour — the shape of a trim
  // someone makes by eye when a timer ran on past the thing it was timing.
  'm-halve': () => mSet({ durMin: Math.max(15, Math.round(state.m.durMin / 2 / 15) * 15) }),

  /* the timer */
  'm-timer-start': () => {
    state.timerStart = Date.now();
    state.timerUpdatedAt = Date.now();
    state.dirty.timer = true;
    save(); queueSync(0); render();
  },
  /* Stopping does not save anything. It opens the flow at step 2 with the
     start and the length already filled in, so the only work left is saying
     what it was — which is the whole point of timing first and naming after. */
  'm-timer-stop': () => {
    const started = new Date(state.timerStart);
    const mins = Math.max(1, Math.min(1439, Math.round(mElapsedSec() / 60)));
    state.timerStart = null;
    state.timerUpdatedAt = Date.now();
    state.dirty.timer = true;
    mResetDraft();
    /* The day the timer STARTED, not the day it stopped.

       mCommit reads this field as the entry's start day and pushes a wrapping
       one forward itself — `to < from` means it ended the following morning.
       Handing it the stop day made it shift a night that had already been
       shifted: sleep timed from 11PM Monday to 7AM Tuesday was filed against
       Wednesday, a day that had not happened yet, so Tuesday's sleep reading
       found nothing and the night was never recorded where it belonged.

       Derived from the start timestamp the same way m-gap-fill derives its
       day, so a timer left running for more than one night lands correctly
       too rather than only the one-night case being patched. */
    const startedIso = iso(started);
    /* The kind is settled and the clock has already been read, so those two
       steps are dropped: the only thing left is to say what it was, which is
       the whole point of timing first and naming after. */
    Object.assign(state.m, {
      screen: 'flow', kind: 'time', step: 2, skip: [1, 3], timed: true,
      day: startedIso === todayIso ? 'today'
        : startedIso === mShiftIso(todayIso, -1) ? 'yesterday' : 'earlier',
      earlierIso: startedIso,
      startMin: Math.max(0, Math.min(1439, started.getHours() * 60 + started.getMinutes())),
      durMin: mins
    });
    save(); queueSync(0); render();
  },

  /* day review */
  'm-gap-fill': (el) => {
    const a = Number(el.dataset.a), b = Number(el.dataset.b);
    const on = el.dataset.day || todayIso;
    mResetDraft();
    Object.assign(state.m, {
      screen: 'flow', kind: 'time', step: 2, skip: [1, 3], startMin: a, durMin: b - a,
      day: on === todayIso ? 'today' : on === mShiftIso(todayIso, -1) ? 'yesterday' : 'earlier',
      earlierIso: on
    });
    render();
  },
  /* "Untracked" is still an entry. A stretch nobody can account for is a fact
     about the day, and writing it down is what stops the review asking again. */
  'm-gap-skip': (el) => {
    const a = Number(el.dataset.a), b = Number(el.dataset.b);
    const rest = state.categories.find((c) => c.name === 'Rest');
    if (!rest) {
      state.categories = state.categories.concat([touch('categories', {
        name: 'Rest', color: '#9995ab', position: state.categories.length
      })]);
    }
    state.entries = state.entries.concat([touch('entries', {
      id: 'g' + Date.now(), date: el.dataset.day || todayIso, activity: 'Unlogged',
      category: 'Rest', from: a, to: b % 1440, note: 'Marked as untracked'
    })]);
    save(); queueSync(0); render();
  },

  /* entry detail */
  'm-detail-edit': () => {
    const s = state.m;
    const money = s.selectedKind === 'money';
    const row = findRow(money ? 'money' : 'entries', s.selected);
    if (!row) { mGo('home'); return; }
    mResetDraft();
    const held = {
      screen: 'flow', step: 4, kind: money ? 'money' : 'time',
      editId: row.id, editKind: s.selectedKind,
      cat: money ? row.purpose : row.category,
      activityText: row.activity, typing: true,
      note: row.note || '', noteOpen: !!row.note,
      day: row.date === todayIso ? 'today'
        : row.date === mShiftIso(todayIso, -1) ? 'yesterday' : 'earlier',
      earlierIso: row.date
    };
    if (money) {
      const income = mCents(row.in) > 0;
      held.dir = income ? 'in' : 'out';
      held.amount = String(money2(income ? row.in : row.out));
    } else {
      held.startMin = Number(row.from) || 0;
      held.durMin = span(row);
    }
    Object.assign(state.m, held);
    render();
  },
  'm-detail-delete': () => {
    const s = state.m;
    if (s.selectedKind === 'money') {
      state.money = state.money.filter((e) => e.id !== s.selected);
      bury('money', s.selected);
    } else {
      state.entries = state.entries.filter((e) => e.id !== s.selected);
      bury('entries', s.selected);
    }
    state.m.selected = null;
    state.m.screen = 'home';
    save(); queueSync(0); render();
  },

  /* the report deck */
  /* `deckCards` branches on state.app, which the desktop drives from its
     tracker switch. On the phone the Insights tab is that same choice, so it
     is pointed at the deck before the existing action opens it — everything
     after that (the warm-up flag, the summary fetch, the card index) is the
     desktop's and is reused whole. */
  'm-report-open': () => {
    state.app = state.m.insightTab === 'money' ? 'money' : 'time';
    /* The deck opens on the window Insights is already showing. Both read the
       same five spans off DECK_RANGES, so handing one to the other is a
       straight assignment rather than a translation. */
    state.deckRange = mInsightKey();
    ACTIONS['open-report']();
  },

  /* donate */
  'm-donate-open': () => {
    // A paying team is never asked for a gift. See mDonateCard().
    if (workMode()) return;
    mSet({ donateOpen: true, donateThanks: false });
  },
  'm-donate-close': () => mSet({ donateOpen: false, donateThanks: false }),
};

/* PayPal reports nothing back, so the thanks state is put up on the way out
   and stands in for the return trip. Deliberately not an action: the delegate
   cancels the default on anything it handles, and cancelling this one would
   mean the tap never reached PayPal at all. */
root.addEventListener('click', (ev) => {
  if (!ev.target.closest('[data-m-donate]')) return;
  state.m.donateThanks = true;
  scheduleRender();
});

Object.assign(ACTIONS, M_ACTIONS);


/* ═════════════════════════ search ═════════════════════════

   One engine and one panel, opened from the phone's brand bar and from the
   desktop header. Searching is the same question on both — "when did I last
   do that" — and the answer is a list of entries with dates on them, which is
   not a thing either layout already knows how to draw.

   It looks across everything ever logged rather than the window on screen.
   A search that could only find what you were already looking at would be a
   filter, and the list is right there. */

const SEARCH_SUGGESTIONS = 6;
const SEARCH_RESULTS = 40;

/* Everything logged, flattened into the one shape the results list draws.
   Built per keystroke rather than cached: a few thousand rows is nothing next
   to the render that follows, and a stale index after an edit is a bug that
   only shows up for the person who just made the edit. */
function searchRows() {
  const time = state.entries.map((e) => ({
    kind: 'time', id: e.id, date: e.date, title: e.activity || '', cat: e.category || '',
    note: e.note || '', start: Number(e.from) || 0, dur: span(e)
  }));
  const money = state.money.map((e) => ({
    kind: 'money', id: e.id, date: e.date, title: e.activity || '', cat: e.purpose || '',
    note: e.note || '', dir: mCents(e.in) > 0 ? 'in' : 'out',
    amount: mCents(e.in) > 0 ? Number(e.in) : Number(e.out)
  }));
  return time.concat(money);
}

/* The words this account actually uses, with how often and how recently each
   was used. That is the whole of the prediction: no model, no corpus, just the
   fact that someone who types "met" has almost certainly written the rest of
   it before. */
function searchVocabulary() {
  const seen = new Map();
  const add = (raw, kind, date) => {
    const term = String(raw || '').trim();
    if (!term) return;
    const key = kind + ' ' + term.toLowerCase();
    const held = seen.get(key);
    if (held) {
      held.count += 1;
      if (date > held.last) held.last = date;
      return;
    }
    seen.set(key, { term, kind, count: 1, last: date || '' });
  };
  state.entries.forEach((e) => { add(e.activity, 'activity', e.date); add(e.category, 'category', e.date); });
  state.money.forEach((e) => { add(e.activity, 'activity', e.date); add(e.purpose, 'purpose', e.date); });
  return [...seen.values()];
}

/* Ranked so that the obvious answer is first. A prefix match outranks a match
   buried mid-word — someone typing "met" means Meta Ads, not "Set up meeting"
   — then how often the term is used, then how recently. Frequency before
   recency on purpose: the thing you log every day should beat the thing you
   logged once, yesterday. */
function searchSuggest(query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 1) return [];
  const scored = [];
  searchVocabulary().forEach((v) => {
    const at = v.term.toLowerCase().indexOf(q);
    if (at < 0) return;
    // An exact match is not a suggestion, it is what is already typed.
    if (v.term.toLowerCase() === q) return;
    scored.push({
      term: v.term, kind: v.kind,
      score: (at === 0 ? 10000 : 0) + Math.min(v.count, 200) * 20 + (v.last ? Number(v.last.replace(/-/g, '')) / 1e6 : 0)
    });
  });
  scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  // One row per word, whichever kind it came from — "Food" being both a
  // category and a purpose is one thing to search for, not two.
  const out = [];
  const taken = {};
  scored.forEach((s) => {
    const key = s.term.toLowerCase();
    if (taken[key] || out.length >= SEARCH_SUGGESTIONS) return;
    taken[key] = true;
    out.push(s);
  });
  return out;
}

/* Title, category and note all count: a note is where the detail that makes an
   entry findable usually ended up.

   Scoped to the window on screen. Searching from Yesterday and being shown the
   same activity from four other days is not an answer to the question that was
   asked — the window is part of the question. What falls outside is counted,
   not hidden, and one tap widens to everything. */
function searchMatches(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { rows: [], beyond: 0 };
  const hits = searchRows()
    .filter((r) => `${r.title} ${r.cat} ${r.note}`.toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.start || 0) - (a.start || 0)));

  if (state.searchAll) return { rows: hits.slice(0, SEARCH_RESULTS), beyond: 0 };
  const win = searchWindow();
  const inside = hits.filter((r) => r.date >= win.from && r.date <= win.to);
  return { rows: inside.slice(0, SEARCH_RESULTS), beyond: hits.length - inside.length };
}

/* The window the search sits inside, whichever layout is asking. The two keep
   their ranges in different places — the phone on its own Home range, the
   desktop on `range` plus the day it is parked on — so this is the one spot
   that has to know about both. Bounds rather than a list of dates: a year is a
   comparison against two strings instead of 365. */
function searchWindow() {
  if (mobileOn()) {
    const days = mRangeDates();
    return { from: days[0], to: days[days.length - 1] };
  }
  const days = RANGE_DAYS[state.range] || 1;
  return { from: windowStart(state.selectedDate, days), to: state.selectedDate };
}

/* The suggestions and the results, which are the only parts that change per
   keystroke. Kept apart from the panel so typing can repaint them without
   rebuilding the field the caret is in. */
function searchBody() {
  const q = state.searchQuery || '';
  const suggestions = searchSuggest(q);
  const hits = searchMatches(q);

  if (!q.trim()) {
    return `
    <div style="padding:26px 4px;text-align:center;color:#756f88;font-size:14px;line-height:1.5;">
      Search everything you have logged — an activity, a category, or something you wrote in a note.
    </div>`;
  }

  const chips = suggestions.length ? `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      ${suggestions.map((s) => `
        <button data-act="search-suggest" data-term="${esc(s.term)}"
          style="display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:600;background:#fff;color:#3b3648;border:1px solid rgba(47,28,102,.12);">
          <span style="width:7px;height:7px;border-radius:50%;flex:none;background:${s.kind === 'activity' ? '#cbbcfa' : esc(mColor(s.term, s.kind === 'purpose'))};"></span>
          ${esc(s.term)}
        </button>`).join('')}
    </div>` : '';

  /* What falls outside the window is counted, never silently dropped: a search
     that finds nothing here but four elsewhere has to say so, or it reads as
     though the entry is gone. */
  const widen = hits.beyond > 0 ? `
    <button data-act="search-all"
      style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin-top:12px;padding:12px 14px;border-radius:14px;cursor:pointer;text-align:left;background:#efedf6;border:1px solid rgba(120,86,245,.22);">
      <span style="font-size:13.5px;font-weight:600;color:#16131f;">${hits.beyond} more outside ${esc(searchRangeLabel())}</span>
      <span style="font-size:12.5px;font-weight:600;color:#7450e4;white-space:nowrap;">Search all →</span>
    </button>` : '';

  if (!hits.rows.length) {
    return `${chips}
    <div style="padding:22px 4px;text-align:center;color:#756f88;font-size:14px;line-height:1.5;">
      Nothing ${state.searchAll ? 'you have logged' : 'in ' + esc(searchRangeLabel())} matches “${esc(q.trim())}”.
    </div>
    ${widen}`;
  }

  return `${chips}
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:9px;">
    <span style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#756f88;">
      ${hits.rows.length}${hits.rows.length >= SEARCH_RESULTS ? '+' : ''} ${hits.rows.length === 1 ? 'entry' : 'entries'}
    </span>
    <span style="font-size:11.5px;font-weight:600;color:${state.searchAll ? '#7450e4' : '#756f88'};">${state.searchAll ? 'everything' : 'in ' + esc(searchRangeLabel())}</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:9px;">
    ${hits.rows.map((r) => mEntryRow(r, { showDate: true, act: 'search-result', hint: q })).join('')}
  </div>
  ${widen}`;
}

// What the window is called, so the scope can be stated rather than implied.
function searchRangeLabel() {
  if (mobileOn()) return String((mRangeDef(mRangeKey()) || [])[1] || 'this window').toLowerCase();
  const named = { day: 'this day', week: 'this week', fortnight: 'this fortnight', month: 'this month',
    quarter: 'these 3 months', half: 'these 6 months', year: 'this year' };
  return named[state.range] || 'this window';
}

/* The field, sitting directly above the entries it searches rather than in
   the header. Unfocused until tapped: it is on screen at all times now, and a
   field that grabbed the caret on every render would put a keyboard over the
   list on the way past. */
/* The categories worth offering: the ones actually in front of you. A list of
   every category ever named would mostly be options that empty the table, and
   an option that shows nothing is indistinguishable from a bug. The one
   exception is the filter currently set — it stays on the list even after a
   move to a day it does not appear on, or the control would disagree with what
   it is doing. */
/* The money tracker files a row under a purpose where the activity tracker
   files it under a category. Same control, same state, different field — so
   the field is a parameter rather than a second copy of all of this. */
const logFilterKey = () => (state.app === 'money' ? 'purpose' : 'category');

function logFilterNames(list) {
  const key = logFilterKey();
  const seen = [];
  list.forEach((e) => { if (e[key] && seen.indexOf(e[key]) < 0) seen.push(e[key]); });
  if (state.logFilter && seen.indexOf(state.logFilter) < 0) seen.push(state.logFilter);
  return seen.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// The rows left after the pill. Used by both tables, so "3 more" in either
// drawer counts what you are actually looking at rather than the whole day.
function logFiltered(list) {
  const key = logFilterKey();
  return state.logFilter ? list.filter((e) => e[key] === state.logFilter) : list;
}

function searchField(o) {
  const q = state.searchQuery || '';
  /* Two shapes for one field. The phone's is a rule under a line of type —
     asked for, and right there: a bordered box stacked above a list of
     bordered boxes is one border too many on a 393px screen. The desktop's
     is a pill in a row with the two controls that narrow the same list, and a
     bare underline beside two bordered pills would read as the odd one out. */
  if (!(o && o.tools)) {
    return `
<div style="position:relative;margin-bottom:12px;">
  <input class="input" type="text" data-k="search-q" value="${esc(q)}"
    placeholder="Search everything you have logged" autocomplete="off"
    style="width:100%;min-height:46px;padding:10px 42px 10px 30px;font-size:15px;
           background:transparent;border:0;border-bottom:1px solid rgba(47,28,102,.18);border-radius:0;box-shadow:none;">
  <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);color:#9995ab;pointer-events:none;">${nodeIcon('search', 17)}</span>
  ${q ? `<button data-act="search-clear" aria-label="Clear search"
    style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;cursor:pointer;font-size:16px;color:#756f88;width:34px;height:34px;border-radius:50%;">✕</button>` : ''}
</div>`;
  }

  const onToday = state.selectedDate === todayIso;
  const names = logFilterNames(o.list || []);
  /* The date control says which day you are on rather than saying "Today"
     while you are three days back — and tapping it is what brings you home.
     A button that named the destination instead of the state would leave the
     line with nothing on it that answers "where am I". */
  const dateLabel = onToday ? 'Today'
    : state.selectedDate === mShiftIso(todayIso, -1) ? 'Yesterday'
    : dayLabel(state.selectedDate);
  return `
<div class="log-tools">
  <div class="log-search${q ? ' has-q' : ''}">
    <span class="log-search-icon" aria-hidden="true">${nodeIcon('search', 17)}</span>
    <input type="text" data-k="search-q" value="${esc(q)}"
      placeholder="Search everything you have logged…" autocomplete="off">
    ${q ? `<button class="log-search-clear" data-act="search-clear" aria-label="Clear search">✕</button>` : ''}
  </div>
  <div class="log-pill${state.logFilter ? ' is-on' : ''}">
    <span aria-hidden="true">${nodeIcon('funnel', 15)}</span>
    <span class="log-pill-leg">${state.app === 'money' ? 'Purpose' : 'Category'}:</span>
    <select data-change="log-filter" aria-label="Filter the day by ${state.app === 'money' ? 'purpose' : 'category'}">
      <option value=""${state.logFilter ? '' : ' selected'}>All</option>
      ${names.map((n) => `<option value="${esc(n)}"${n === state.logFilter ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <span class="log-pill-caret" aria-hidden="true">▾</span>
  </div>
  <button class="log-pill log-pill-btn" data-act="go-today" aria-disabled="${onToday}"
    title="${onToday ? 'Already on today' : 'Back to today'}">
    <span aria-hidden="true">${nodeIcon('calendar', 15)}</span>
    <span class="log-pill-leg">Date:</span>
    <span class="log-pill-val">${esc(dateLabel)}</span>
  </button>
</div>`;
}

/* Typing repaints the two lists and nothing else. A full render would rebuild
   the input the caret is sitting in, which is the same reason the category
   picker filters by hand rather than re-rendering. */
function paintSearch() {
  const box = document.getElementById('search-body');
  if (box) box.innerHTML = searchBody();
}

const SEARCH_ACTIONS = {
  'search-clear': () => { state.searchQuery = ''; state.searchAll = false; render(); },
  'search-all': () => { state.searchAll = true; paintSearch(); },
  'search-suggest': (el) => {
    state.searchQuery = el.dataset.term || '';
    const field = root.querySelector('[data-k="search-q"]');
    if (field) { field.value = state.searchQuery; field.focus(); }
    paintSearch();
  },
  /* A result is a place as much as a row: it moves the app to the day the
     entry is on, so closing the panel leaves you where you searched to get. */
  'search-result': (el) => {
    const id = el.dataset.id, kind = el.dataset.kind;
    const row = findRow(kind === 'money' ? 'money' : 'entries', id);
    state.searchQuery = '';
    if (!row) { render(); return; }
    state.selectedDate = row.date;
    state.app = kind === 'money' ? 'money' : 'time';
    if (mobileOn()) {
      // The phone has a screen for one entry; the desktop shows it in place.
      state.m.range = row.date === todayIso ? 'today'
        : row.date === mShiftIso(todayIso, -1) ? 'yesterday' : 'month';
      Object.assign(state.m, { screen: 'detail', selected: id, selectedKind: kind === 'money' ? 'money' : 'time' });
    }
    render();
  }
};

// Registered here rather than alongside the mobile module's: that runs first,
// and a `const` cannot be named before the line that declares it has run.
Object.assign(ACTIONS, SEARCH_ACTIONS);


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

/* The donate links are ordinary anchors — they have to be, so the browser opens
   PayPal in a new tab and a long-press still offers "copy link". That puts them
   outside the action system, so the click is noticed here instead and the
   navigation is left completely alone. */
root.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-donate]')) noteDonateClick();
});

/* Anywhere but the menu closes it. Registered before the action handler and
   on the same phase, so a click on one of its own items still runs the action
   — the menu closes because that item's action re-renders without it, not
   because this fired first. */
root.addEventListener('click', (ev) => {
  if (!state.menuOpen) return;
  if (ev.target.closest('.appbar-menu')) return;
  state.menuOpen = false;
  scheduleRender();
});

/* And for the pad, which is a panel rather than a dialog: nothing dims behind
   it, so the page underneath is still there to be clicked, and a click on it
   means "not now". The column is excluded whole — the button that opens the
   pad lives in it, and closing from here would fight its own toggle. An armed
   delete is disarmed on the way out. */
root.addEventListener('click', (ev) => {
  if (!state.todoOpen || isPhone()) return;
  if (ev.target.closest('.fabs')) return;
  // The stuck question is the pad's own dialog, wherever it happens to sit.
  if (state.todoWhy || ev.target.closest('.lb-back')) return;
  state.todoOpen = false;
  state.todoArm = '';
  todoTidy();
  scheduleRender();
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

/* The picker filters by hiding rows, not by re-rendering. A render per
   keystroke would rebuild the very input the caret is in, and the list is
   already in the DOM — there is nothing to fetch, only something to hide. */
/* One-shot, like focusField: the scroll belongs to the tap that opened the
   panel, not to every render that happens while it is open. */
let pickJustOpened = false;

function filterPicker(el) {
  const q = el.value.trim().toLowerCase();
  const list = el.parentElement.querySelector('[data-pick-list]');
  if (!list) return;
  let hits = 0;
  list.querySelectorAll('.pick-opt').forEach((opt) => {
    const match = !q || opt.dataset.find.includes(q);
    /* Hide the whole row, not just the name: the delete beside it belongs to
       the option and would otherwise be left behind on its own. */
    (opt.closest('.pick-row') || opt).hidden = !match;
    if (match) hits++;
  });
  const empty = list.querySelector('.pick-empty');
  if (empty) empty.hidden = hits > 0;
}

root.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset || !el.dataset.pickSearch) return;
  state.pickQuery = el.value;
  filterPicker(el);
});

root.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset || el.dataset.k !== 'search-q') return;
  const was = !!String(state.searchQuery || '').trim();
  state.searchQuery = el.value;
  // Widening belongs to one search; a new query starts inside the window again.
  state.searchAll = false;
  const now = !!String(state.searchQuery || '').trim();
  /* The section changes shape the moment a query starts or ends — the heading
     renames and the day's own list steps aside — and neither of those lives
     inside the block a targeted repaint replaces. Only that first and last
     keystroke needs the whole tree; every one in between repaints the results
     alone, so the caret is left where it is. render() puts focus and selection
     back on the way through. */
  if (was !== now) { render(); return; }
  paintSearch();
});

// Text fields feed state without re-rendering, so typing is never interrupted.
root.addEventListener('input', (ev) => {
  const el = ev.target;
  /* A note writes into its own row rather than through setDeep, and never
     re-renders: rebuilding the pad on every keystroke would put a new textarea
     under the caret. The box grows with what is in it, the store is written on
     a debounce, and the push waits for a pause in the typing. */
  if (el.dataset && el.dataset.todoText) {
    const row = findRow('todos', el.dataset.todoText);
    if (row) {
      row.text = el.value;
      touch('todos', row);
      if (el.hasAttribute('data-todo-grow')) {
        el.style.height = 'auto';
        el.style.height = `${Math.max(24, el.scrollHeight)}px`;
      }
      queueTodoSave();
    }
    return;
  }
  // The money pad's line, on exactly the same terms.
  if (el.dataset && el.dataset.planText) {
    const row = findRow('plans', el.dataset.planText);
    if (row) {
      row.text = el.value;
      touch('plans', row);
      if (el.hasAttribute('data-todo-grow')) {
        el.style.height = 'auto';
        el.style.height = `${Math.max(24, el.scrollHeight)}px`;
      }
      queueTodoSave();
    }
    return;
  }
  /* The figure on a line. Read leniently — a stray comma or a currency symbol
     typed out of habit is not a reason to refuse the number — and stored as a
     number rather than as what was typed, so the pad's arithmetic and the
     ledger both get something they can add up.

     Repainted rather than re-rendered: this is the one field in the app whose
     every keystroke changes a total on screen, and rebuilding the pad under
     the caret to show it would be the flicker the pad already learned not to
     do. paintPlanSum redraws the strip and nothing else. */
  if (el.dataset && el.dataset.planAmount) {
    const row = findRow('plans', el.dataset.planAmount);
    if (row) {
      row.amount = money2(String(el.value || '').replace(/[^0-9.]/g, ''));
      touch('plans', row);
      paintPlanSum();
      queueTodoSave();
    }
    return;
  }
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
  if (el.hasAttribute('data-live-name')) mPaintNext();
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
  /* Enter in the picker's search takes the first row still showing, which is
     what typing three letters and pressing Enter is asking for. */
  if (el.dataset && el.dataset.pickSearch) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      // Dispatch the row's own action rather than the desktop's by name —
      // there are two pickers now, and they commit to different places.
      /* The filter hides the row now, not the option inside it, so asking for
         a visible option would happily return the first one in a hidden row —
         which is how Enter came to pick whatever sat at the top of the list
         rather than what had been searched for. */
      const hit = el.parentElement.querySelector('.pick-row:not([hidden]) .pick-opt')
        || el.parentElement.querySelector('.pick-opt:not([hidden])');
      if (hit) { const pick = ACTIONS[hit.dataset.act]; if (pick) pick(hit); }
      return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); state.pickOpen = null; state.pickQuery = ''; render(); return; }
  }
  // Topmost first: the follow-up dialog sits above the report sheet.
  if (ev.key === 'Escape' && state.refineAsk) { ACTIONS['refine-no'](); return; }
  if (ev.key === 'Escape' && state.chat.open) { ACTIONS['chat-close'](); return; }
  if (ev.key === 'Escape' && state.calOpen) { ACTIONS['cal-close'](); return; }
  if (ev.key === 'Escape' && state.pickDelete) { ACTIONS['pick-del-cancel'](); return; }
  if (ev.key === 'Escape' && String(state.searchQuery || '').trim()) { ACTIONS['search-clear'](); return; }
  if (ev.key === 'Escape' && state.notePrompt) { closeFollowUp(false); return; }
  if (ev.key === 'Escape' && state.donateOpen) { state.donateOpen = false; render(); return; }
  if (ev.key === 'Escape' && state.todoWhy) { state.todoWhy = null; render(); return; }
  if (ev.key === 'Escape' && state.todoOpen) { ACTIONS['todo-close'](); return; }
  if (ev.key === 'Escape' && state.menuOpen) { state.menuOpen = false; render(); return; }
  if (ev.key === 'Escape' && state.legalOpen) { state.legalOpen = null; render(); return; }
  if (ev.key === 'Escape' && state.authOpen && state.authMode !== 'reset') { state.authOpen = false; render(); return; }
  if (ev.key === 'Escape' && state.stepsOpen) { state.stepsOpen = null; state.stepsDraft = ''; render(); return; }
  if (ev.key === 'Escape' && state.pillarOpen) { state.pillarOpen = null; render(); return; }
  if (state.reportOpen && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
    ev.preventDefault();
    deckGo(deckIndex + (ev.key === 'ArrowRight' ? 1 : -1));
    return;
  }
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
/* ── the deck's scroller ──
   The active card is scroll position, not state. Tracking it here rather than
   in `state` keeps a swipe from triggering a render, which would rebuild the
   track under the finger doing the swiping. */
let deckIndex = 0;
/* How far down the card you had read. The companion to deckIndex: that one
   survives a render, this one is where the same unbidden render used to drop
   you — same card, back at the top, halfway through a sentence. A long card
   scrolls inside its own .deck-body, so the page-level restore in render()
   never touched it. */
let deckScroll = 0;

function deckGo(i) {
  const track = root.querySelector('[data-deck-track]');
  if (!track) return;
  const slides = track.querySelectorAll('.deck-slide');
  const n = Math.max(0, Math.min(slides.length - 1, i));
  /* Where you asked to be, recorded before the glide rather than after it.
     The scroll is animated, and paintDeck repaints the track at whatever index
     it holds — so a summary landing while the deck was still gliding used to
     cancel the move and put you back on the card you had just left. The dots
     move with it, which is the honest feedback anyway. */
  deckIndex = n;
  deckScroll = 0;
  track.scrollTo({ left: slides[n].offsetLeft, behavior: 'smooth' });
}

/* Which card you are on has to survive a render, and renders arrive unbidden:
   the written summaries are fetched after the deck is already open, and the
   one that lands is what threw a reader on card five back to card one.

   `deckIndex` was already being kept — it just never made it back into the
   DOM, because every render builds a fresh track scrolled to its start.
   Instant rather than smooth: this is putting the deck back where it was, not
   moving it, and an animation would draw the eye to a journey that did not
   happen. Clamped, because a window with fewer cards may no longer have the
   one that was being read; open-report and deck-range both zero the index
   themselves, so a deliberate change still starts at the beginning. */
function paintDeck() {
  const track = root.querySelector('[data-deck-track]');
  if (!track) return;
  const slides = track.querySelectorAll('.deck-slide');
  if (!slides.length) return;
  deckIndex = Math.max(0, Math.min(slides.length - 1, deckIndex));
  if (deckIndex) track.scrollLeft = slides[deckIndex].offsetLeft;
  // And back to the line you were on, not just the card it was on.
  if (deckScroll) {
    const body = slides[deckIndex].querySelector('.deck-body');
    if (body) body.scrollTop = deckScroll;
  }
  root.querySelectorAll('.deck-bar').forEach((b, i) => b.classList.toggle('is-on', i === deckIndex));
}

/* ── keeping your place in the chat ──

   .chat-log is an inner scroller and render() replaces the tree beneath it, so
   its scrollTop went back to zero on every render — and a render arrives on
   its own while the panel is open, from the sync heartbeat. Mid-answer that
   threw the reader back to the first line of a long reply.

   Pinning to the end is the other half of it. A render that nobody asked for
   must not move the reader, so the pin follows wherever they scrolled to. A
   new turn does re-take it, and should: a turn only ever appears because they
   just asked something, and the answer to it is the thing they want to see. */
let chatScroll = 0;
let chatPinned = true;
let chatTurns = 0;

/* The team drawer keeps its place across a render.

   render() replaces the whole tree, so a scroller inside it starts at the top
   again every time — and this dialog re-renders on every invite, resend, role
   change and thirty-second live poll. An admin scrolled halfway down a roster
   would be thrown back to the first row by a poll they never asked for, which
   is the same bug the chat log and the report deck each had to be taught out
   of separately.

   The fade at the bottom is driven from here too: it should say "there is more
   below", so it goes away once there is not. */
let teamDrawerScroll = 0;
function paintTeamDrawer() {
  const el = root.querySelector('[data-tm-drawer]');
  if (!el) { teamDrawerScroll = 0; return; }
  if (teamDrawerScroll) el.scrollTop = teamDrawerScroll;
  const more = el.scrollHeight - el.clientHeight - el.scrollTop > 4;
  if (more) el.setAttribute('data-more', '');
  else el.removeAttribute('data-more');
}

function paintChatLog() {
  const log = root.querySelector('[data-chat-log]');
  if (!log) { chatScroll = 0; chatPinned = true; chatTurns = 0; return; }
  const turns = state.chat.messages.length + (state.chat.busy ? 1 : 0);
  if (turns !== chatTurns) { chatTurns = turns; chatPinned = true; }
  if (chatPinned) log.scrollTop = log.scrollHeight;
  else log.scrollTop = chatScroll;
  chatScroll = log.scrollTop;
}

/* Bound once, filtered to the deck: the track only exists while the report is
   open, and re-binding on every render would stack listeners. */
root.addEventListener('scroll', (ev) => {
  const track = ev.target;
  /* Reading back through the conversation. "At the end" has slack in it
     because a scroller sitting on a fractional height never reports an exact
     zero, and an off-by-one pixel would silently drop the pin. */
  if (track.matches && track.matches('.chat-log')) {
    chatScroll = track.scrollTop;
    chatPinned = track.scrollHeight - track.scrollTop - track.clientHeight < 40;
    return;
  }
  /* Reading down a card. Recorded here rather than read off the DOM at render
     time, because by then the tree that held it is already gone. */
  if (track.matches && track.matches('.deck-body')) { deckScroll = track.scrollTop; return; }
  // Same reasoning, for the team dialog's drawer. See paintTeamDrawer().
  // Same reasoning again, for the to-do pad. See paintTodo().
  if (track.matches && track.matches('[data-todo-list]')) { todoScroll = track.scrollTop; return; }
  if (track.matches && track.matches('[data-plan-list]')) { planScroll = track.scrollTop; return; }
  if (track.matches && track.matches('[data-tm-drawer]')) {
    teamDrawerScroll = track.scrollTop;
    const more = track.scrollHeight - track.clientHeight - track.scrollTop > 4;
    if (more) track.setAttribute('data-more', '');
    else track.removeAttribute('data-more');
    return;
  }
  if (!track.matches || !track.matches('[data-deck-track]')) return;
  const slides = [...track.querySelectorAll('.deck-slide')];
  if (!slides.length) return;
  const mid = track.scrollLeft + track.clientWidth / 2;
  let best = 0, bestD = Infinity;
  slides.forEach((sl, i) => {
    const d = Math.abs(sl.offsetLeft + sl.offsetWidth / 2 - mid);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best === deckIndex) return;
  deckIndex = best;
  // A different card starts at its own beginning; carrying the last card's
  // depth over would open this one part-way down for no reason.
  deckScroll = 0;
  // Painted directly; a render here would fight the scroll that caused it.
  root.querySelectorAll('.deck-bar').forEach((b, i) => b.classList.toggle('is-on', i === deckIndex));
}, true);

/* ── one card, as an image ──
   Drawn rather than screenshotted, so it carries the brand at a size worth
   sending and does not depend on what the viewport happened to be. */
const CARD_W = 1080, CARD_H = 1350;

/* Laid out in two passes: the first measures with nothing drawn, the second
   draws with the block centred on what the first measured. Wrapping depends on
   the font metrics of the real context, so the same context does both — every
   paint is simply gated on `draw`. */
function paintCard(x, c, v, draw, offsetY) {
  const accent = v.isMoney ? '#10756c' : '#5f3ac9';
  const tint = c.accent || accent;
  const M = 64, R = 44;
  const cw = CARD_W - M * 2, ch = CARD_H - M * 2;
  const L = M + 66, RW = cw - 132;

  if (draw) {
    const grad = x.createLinearGradient(0, 0, CARD_W, CARD_H);
    if (v.isMoney) { grad.addColorStop(0, '#2bb8a5'); grad.addColorStop(.55, '#16a394'); grad.addColorStop(1, '#0f766e'); }
    else { grad.addColorStop(0, '#8b5cf6'); grad.addColorStop(.55, '#6d54f0'); grad.addColorStop(1, '#4f46e5'); }
    x.fillStyle = grad; x.fillRect(0, 0, CARD_W, CARD_H);
    x.fillStyle = '#ffffff';
    x.beginPath();
    if (x.roundRect) x.roundRect(M, M, cw, ch, R); else x.rect(M, M, cw, ch);
    x.fill();
  }

  let y = (offsetY || 0);
  const top = y;

  if (c.kicker) {
    x.font = '600 30px Barlow, sans-serif';
    if (draw) { x.fillStyle = tint; x.fillText(c.kicker.toUpperCase(), L, y); }
    y += 66;
  }
  if (c.big) {
    const size = Math.max(60, Math.min(150, Math.floor(RW / (String(c.big).length * 0.56))));
    x.font = `700 ${size}px "Playfair Display", Georgia, serif`;
    if (draw) { x.fillStyle = '#16131f'; x.fillText(c.big, L, y + size * 0.78); }
    y += size + 22;
  }
  if (c.title) {
    x.font = '400 40px Barlow, sans-serif';
    wrapText(x, c.title, RW).slice(0, 3).forEach((ln) => {
      if (draw) { x.fillStyle = '#3b3648'; x.fillText(ln, L, y); }
      y += 50;
    });
    y += 12;
  }
  c.lines.forEach((ln) => {
    x.font = '400 32px Barlow, sans-serif';
    wrapText(x, ln, RW).forEach((t) => {
      if (draw) { x.fillStyle = '#575168'; x.fillText(t, L, y); }
      y += 42;
    });
    y += 10;
  });
  /* The chart card would otherwise share as a headline with nothing under it.
     Same two-scale layout and the same printed numbers the DOM chart uses, so
     the image and the card on screen say the same thing. */
  if (c.chart) {
    const cols = c.chart.cols;
    const fmt = c.chart.fmt || briefNum;
    const H = 300, gap = 4, LAB = 26;
    const shown = cols.filter((d) => d.logged);
    const maxUp = Math.max(0, ...shown.map((d) => d.up));
    const maxDown = Math.max(0, ...shown.map((d) => d.down));
    /* Inset by a label's height at each end, the way the DOM chart's padding
       does it — otherwise the tallest bar's number is drawn off the card. */
    const top = y + LAB, floor = y + H - LAB;
    const zeroY = top + Math.round((maxUp / ((maxUp + maxDown) || 1)) * (floor - top));
    const cw = (RW - gap * (cols.length - 1)) / cols.length;
    /* Same judgement the CSS makes, in the one unit the canvas actually knows.
       Too tight for every label still leaves room for the two peaks. */
    const all = cw >= 44;
    const peakUp = maxUp > 0 ? cols.findIndex((d) => d.logged && d.up === maxUp) : -1;
    const peakDown = maxDown > 0 ? cols.findIndex((d) => d.logged && d.down === maxDown) : -1;

    if (draw) {
      x.textAlign = 'center';
      cols.forEach((d, i) => {
        if (!d.logged) return;
        const bx = L + i * (cw + gap), mid = bx + cw / 2;
        if (d.up > 0) {
          const h = Math.max(3, Math.round((d.up / (maxUp || 1)) * (zeroY - top)));
          x.fillStyle = '#0e9f6e'; x.fillRect(bx, zeroY - h, cw, h);
          if (all || i === peakUp) {
            x.font = `${all ? 600 : 700} 19px Barlow, sans-serif`;
            x.fillText(fmt(d.up), mid, zeroY - h - 7);
          }
        }
        if (d.down > 0) {
          const h = Math.max(3, Math.round((d.down / (maxDown || 1)) * (floor - zeroY)));
          x.fillStyle = '#d92d20'; x.fillRect(bx, zeroY, cw, h);
          if (all || i === peakDown) {
            x.font = `${all ? 600 : 700} 19px Barlow, sans-serif`;
            x.fillText(fmt(d.down), mid, zeroY + h + 21);
          }
        }
      });
      x.textAlign = 'left';
      x.strokeStyle = '#b8b4c6'; x.beginPath(); x.moveTo(L, zeroY); x.lineTo(L + RW, zeroY); x.stroke();
      x.fillStyle = '#756f88'; x.font = '400 24px Barlow, sans-serif';
      x.fillText(dayLabel(cols[0].date), L, y + H + 34);
      x.textAlign = 'right';
      x.fillText(dayLabel(cols[cols.length - 1].date), L + RW, y + H + 34);
      x.textAlign = 'left';
    }
    y += H + 78;
  }

  /* The donut, drawn rather than traced from the SVG. Same fold, same share on
     each slice, same legend underneath — the card people send has to be the
     card they were looking at, not a simplified stand-in. */
  if (c.donut) {
    const fmt = c.donut.fmt || durShort;
    const built = donutParts(c.donut.rows);
    if (built) {
      const { parts, total } = built;
      const R = 150, W = 62, CX = L + RW / 2;
      const RING = R * 2 + W;            // the ring's full outer diameter
      const ROW = 46;                    // one legend line
      const CY = y + RING / 2;
      const legendTop = y + RING + 44;

      let acc = 0;
      const laid = parts.map((p) => {
        const frac = p.mins / total;
        const a = (-90 + 360 * (acc + frac / 2)) * Math.PI / 180;
        const seg = { p, frac, from: acc, to: acc + frac,
          x: CX + Math.cos(a) * R, ty: CY + Math.sin(a) * R };
        acc += frac;
        return seg;
      });

      if (draw) {
        x.lineWidth = W;
        laid.forEach((l) => {
          x.strokeStyle = l.p.color;
          x.beginPath();
          x.arc(CX, CY, R, (-90 + l.from * 360) * Math.PI / 180, (-90 + l.to * 360) * Math.PI / 180);
          x.stroke();
        });

        // The share, on the arc, wherever the arc is wide enough to hold it.
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = '700 26px Barlow, sans-serif';
        laid.forEach((l) => {
          if (l.frac < DONUT_LABEL_MIN) return;
          x.fillStyle = inkOn(l.p.color);
          x.fillText(`${Math.round(l.frac * 100)}%`, l.x, l.ty);
        });
        x.textBaseline = 'alphabetic';
        x.textAlign = 'left';

        // The legend: swatch, name, share, figure — one line each.
        let ly = legendTop;
        laid.forEach((l) => {
          x.fillStyle = l.p.color;
          x.fillRect(L, ly - 15, 18, 18);
          x.font = '400 27px Barlow, sans-serif';
          const share = `${Math.round(l.frac * 100)}%`;
          const figure = fmt(l.p.mins);
          const fw = x.measureText(figure).width;
          x.fillStyle = '#16131f';
          x.fillText(clipText(x, l.p.name, RW - fw - 130), L + 30, ly);
          x.textAlign = 'right';
          x.fillStyle = '#756f88'; x.fillText(figure, L + RW, ly);
          x.fillStyle = '#3b3648'; x.font = '600 27px Barlow, sans-serif';
          x.fillText(share, L + RW - fw - 22, ly);
          x.textAlign = 'left';
          ly += ROW;
        });
      }
      // Last baseline, plus room for the paragraph that follows to breathe.
      y = legendTop + ROW * (laid.length - 1) + 44;
    }
  }

  if (c.rows.length) {
    y += 14;
    c.rows.slice(0, 6).forEach((r) => {
      x.font = '400 34px Barlow, sans-serif';
      const vw = x.measureText(r.value).width;
      if (draw) {
        if (r.color) { x.fillStyle = r.color; x.fillRect(L, y - 24, 20, 20); }
        x.fillStyle = '#16131f';
        // The label gives way to the value and the share, which are fixed width.
        x.fillText(clipText(x, r.label, RW - vw - (r.meta ? 150 : 40) - (r.color ? 34 : 0)), L + (r.color ? 34 : 0), y);
        x.textAlign = 'right';
        x.fillStyle = '#16131f'; x.fillText(r.value, L + RW, y);
        if (r.meta) {
          x.font = '400 26px Barlow, sans-serif';
          x.fillStyle = '#756f88';
          // Placed off the measured value rather than a guessed offset, which
          // ran the two into each other on "11 hr 15 min".
          x.fillText(r.meta, L + RW - vw - 26, y);
        }
        x.textAlign = 'left';
      }
      y += 30;
      if (draw) { x.strokeStyle = '#e8e6ef'; x.beginPath(); x.moveTo(L, y); x.lineTo(L + RW, y); x.stroke(); }
      y += 40;
    });
  }
  /* The note leads, the paragraph follows — the same order the card uses. The
     note is the one-line headline the figures already imply; the summary is the
     reading of it, and a reading before its headline is back to front. */
  if (c.note) {
    y += 8;
    x.font = '400 27px Barlow, sans-serif';
    wrapText(x, c.note, RW).slice(0, 5).forEach((ln) => {
      if (draw) { x.fillStyle = '#575168'; x.fillText(ln, L, y); }
      y += 37;
    });
  }

  /* Given more room than the note above it — the closing card is nothing but
     this, and a 250-word send-off truncated at five lines would be the one card
     that ends mid-sentence. */
  if (c.summary) {
    y += 12;
    x.font = '400 27px Barlow, sans-serif';
    wrapText(x, c.summary, RW).slice(0, c.closing ? 20 : 8).forEach((ln) => {
      if (draw) { x.fillStyle = '#3b3648'; x.fillText(ln, L, y); }
      y += 37;
    });
  }

  /* The closing card's tail. The donate button is a link, and a link in a
     picture is just words — so the image carries the address rather than
     pretending to be a button that cannot be pressed. */
  if (c.closing) {
    y += 14;
    if (draw) { x.strokeStyle = '#e8e6ef'; x.beginPath(); x.moveTo(L, y); x.lineTo(L + RW, y); x.stroke(); }
    y += 30;
    x.font = '400 22px Barlow, sans-serif';
    wrapText(x, `${deckDisclaimer()} ZIMPAN is free and sells nothing; a small gift keeps it being built.`, RW)
      .slice(0, 8).forEach((ln) => {
        if (draw) { x.fillStyle = '#756f88'; x.fillText(ln, L, y); }
        y += 30;
      });
  }

  if (draw) {
    // Pinned rather than flowed, so it sits identically on every card.
    x.fillStyle = tint; x.font = '700 34px "Playfair Display", Georgia, serif';
    x.fillText('ZIMPAN.', L, CARD_H - M - 56);
    x.fillStyle = '#756f88'; x.font = '400 26px Barlow, sans-serif';
    x.fillText(v.reportRange, L, CARD_H - M - 18);
  }

  return y - top;
}

async function shareCard() {
  const v = deckView();
  const cards = deckCards(v);
  const c = cards[Math.max(0, Math.min(cards.length - 1, deckIndex))];
  if (!c) return;

  try { await document.fonts.ready; } catch (err) { /* fonts are best-effort */ }

  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const x = cv.getContext('2d');
  /* Measure, then centre what was measured between the card's top edge and its
     footer — a three-line card pinned to the top reads as a mistake. */
  const h = paintCard(x, c, v, false, 0);
  const boxTop = 64 + 70, boxBottom = CARD_H - 64 - 110;
  const offset = Math.max(boxTop + 40, boxTop + Math.round(((boxBottom - boxTop) - h) / 2));
  paintCard(x, c, v, true, offset);

  const name = `zimpan-${v.isMoney ? 'money' : 'time'}-${c.key}.png`;
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) return;

  /* The phone's own share sheet where there is one — that is what makes this
     worth sending. A download is the fallback, not the intent. */
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  flash('Card saved');
}

/* ─────────────────────────── boot ─────────────────────────── */

// The running clock and the "now" stamp tick without a full re-render.
function tickLive() {
  /* Before anything reads the date: past midnight the whole view is about the
     wrong day, and a repaint of stale text would only make it look current. */
  if (rollDay()) { render(); return; }

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

mDragWire();

/* The back-to-top button appears past a screen and a half of scrolling. Bound
   once and driven straight off the scroll position: a render per scroll frame
   would be an absurd price for one button changing its mind. */
/* A month of bars opens at the far end rather than the far past: the newest
   day is the one being asked about, and it is the one the gradient marks. The
   fade on the right edge is dropped once there is nothing left to scroll to.

   Where it is scrolled to survives a render, which it has to: every render
   replaces the row, and a sync landing while someone is looking at the middle
   of the month would otherwise snap the chart back to today under their
   thumb. Only a genuinely different row — another window, the other tracker —
   starts at the end again, which is what the key is for. */
let mBarsAt = { key: '', left: 0 };

function mPaintBars() {
  const bars = document.querySelector('.m-bars.is-wide');
  if (!bars) return;
  const key = bars.dataset.bars || '';
  bars.scrollLeft = key === mBarsAt.key ? mBarsAt.left : bars.scrollWidth;
  mBarsAt = { key, left: bars.scrollLeft };
  const atEnd = () => {
    mBarsAt = { key, left: bars.scrollLeft };
    bars.classList.toggle('at-end', bars.scrollLeft + bars.clientWidth >= bars.scrollWidth - 2);
  };
  atEnd();
  bars.addEventListener('scroll', atEnd, { passive: true });
}

function mPaintTop() {
  const el = document.getElementById('m-top');
  if (!el) return;
  // grid, not block: the arrow inside is an SVG that centres by place-items.
  el.style.display = window.scrollY > 600 ? 'grid' : 'none';
}
window.addEventListener('scroll', mPaintTop, { passive: true });

setInterval(tickLive, 1000);
setInterval(mTick, 1000);

/* Crossing the phone breakpoint swaps the whole experience, so the app has to
   be told rather than left showing the layout for a width it no longer has. */
try {
  window.matchMedia(PHONE_QUERY).addEventListener('change', () => render());
} catch (err) { /* older Safari — the layout still resolves on the next render */ }

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
