/* ZIMPAN API + static host.

   Static files are served from an explicit allow-list rather than by pointing
   express.static at the project root — server/ sits inside that root, and a
   catch-all would publish the database credentials along with the app. */

import express from 'express';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { query, one, now, migrate, HERE } from './db.js';
import {
  hashPassword, verifyPassword, createSession, userForToken, destroySession,
  parseCookies, setSessionCookie, clearSessionCookie, rateLimit, retryLabel, COOKIE
} from './auth.js';
import { changesSince, applyChanges, Invalid, CURRENCIES } from './sync.js';
import { verifyGoogleIdToken } from './google.js';
import { sendResetEmail } from './mail.js';
import { estimateNutrition, summariseDeck, aiConfigured } from './ai.js';
import {
  overview as adminOverview, users as adminUsers, donationsFor,
  setRole, addDonation, removeDonation, noteDonateClick, touchSeen, isAdminRole, ROLES
} from './admin.js';

const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
// Passenger and cPanel sit in front of this, so the client IP arrives in a header.
if (PROD) app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

/* Cookies are SameSite=Lax, which already blocks cross-site form posts. This
   closes the remaining gap: a cross-origin caller cannot set a custom header
   without passing CORS preflight, and no CORS origins are allowed. */
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (req.get('X-Zimpan-Client') !== '1') return res.status(403).json({ error: 'Missing client header.' });

  /* Compare hosts, not whole origins. Behind Apache, req.protocol only reports
     https when trust proxy is enabled, so comparing full origins rejects every
     write on a correctly configured HTTPS site the moment that setting is off.
     The host is what identifies the site; the scheme adds nothing here. */
  const origin = req.get('Origin');
  if (origin) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* malformed header */ }
    if (originHost !== req.get('Host')) {
      console.error(`[zimpan] refused cross-origin write: Origin ${origin} vs Host ${req.get('Host')}`);
      return res.status(403).json({ error: 'Cross-origin request refused.' });
    }
  }
  next();
});

// Express 4 does not catch rejected promises from handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── database readiness ──

   The app used to refuse to listen until migrate() resolved, which meant a
   database that was merely unreachable took the entire site down — including
   index.html and app.js, which need no database at all. Since the client keeps
   its data locally and syncs, a visitor could have carried on working through
   an outage if only the page had loaded.

   So the listener comes up first and the database is prepared behind it. Until
   that succeeds the app is served normally and the endpoints that genuinely
   need MySQL answer 503, which the client reads as "paused" rather than
   "broken". Preparation retries for as long as it takes. */

let dbReady = false;
let dbAttempt = 0;
const RETRY_MS = [2000, 5000, 10000, 20000, 30000];

async function prepareDatabase() {
  try {
    await migrate();
    dbReady = true;
    dbAttempt = 0;
    console.log('[zimpan] database ready');
  } catch (err) {
    dbReady = false;
    const wait = RETRY_MS[Math.min(dbAttempt, RETRY_MS.length - 1)];
    dbAttempt += 1;
    console.error(`[zimpan] database not ready (attempt ${dbAttempt}): ${err.message} — retrying in ${wait / 1000}s`);
    setTimeout(prepareDatabase, wait);
  }
}

/* The endpoints that hold up without MySQL. Everything else under /api/ needs
   it, so the guard below is a deny-list of one line rather than a decoration on
   every route — a new route is protected by default. */
const DB_FREE = new Set(['/api/config', '/api/currencies', '/api/health']);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || DB_FREE.has(req.path) || dbReady) return next();
  res.set('Retry-After', '30');
  res.status(503).json({
    error: 'The database is temporarily unavailable, so signing in and syncing are paused. Anything you log is kept on this device and goes up by itself once the connection is back.',
    retry: true
  });
});

/* Says whether the database is the problem without needing shell access — the
   question that took a while to answer the last time this went down. The
   underlying error stays in the log: it names the host and user. */
app.get('/api/health', (req, res) => {
  res.status(dbReady ? 200 : 503).json({ ok: dbReady, database: dbReady ? 'ready' : 'unavailable' });
});

const clientIp = (req) => req.ip || req.socket.remoteAddress || 'unknown';
const currentUser = (req) => userForToken(parseCookies(req.get('Cookie'))[COOKIE]);

const requireUser = wrap(async (req, res, next) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  req.user = user;
  next();
});

/* Roles are checked here rather than in the dashboard.

   A page can hide a button; it cannot stop a request. Manager is read-only
   because every writing route below asks for superadmin, not because the page
   declines to draw the form.

   404 rather than 403 for someone with no role at all: the dashboard is not
   something an ordinary account should be able to detect the existence of. */
const requireRole = (...allowed) => wrap(async (req, res, next) => {
  const user = await currentUser(req);
  if (!user || !isAdminRole(user.role)) {
    return res.status(404).json({ error: 'No such endpoint.' });
  }
  if (!allowed.includes(user.role)) {
    return res.status(403).json({ error: 'Your role can view this but not change it.' });
  }
  req.user = user;
  next();
});
const requireAdmin = requireRole('manager', 'superadmin');
const requireSuper = requireRole('superadmin');

/* ── accounts ── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 10;

function readCredentials(body) {
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  if (password.length > 400) return { error: 'Password is too long.' };
  return { email, password };
}

app.post('/api/register', wrap(async (req, res) => {
  const limited = rateLimit({ key: `reg:${clientIp(req)}`, limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many sign-ups from here. Try again ${retryLabel(limited.retryAfterMs)}.` });
  const creds = readCredentials(req.body);
  if (creds.error) return res.status(400).json({ error: creds.error });

  if (await one('SELECT 1 AS x FROM users WHERE email = ?', [creds.email])) {
    return res.status(409).json({ error: 'That email is already registered.' });
  }

  const t = now();
  const result = await query(
    'INSERT INTO users (email, password_hash, currency, created_at, updated_at) VALUES (?,?,?,?,?)',
    [creds.email, hashPassword(creds.password), 'PHP', t, t]);

  const { token, expiresAt } = await createSession(result.insertId);
  setSessionCookie(res, token, expiresAt, PROD);
  res.status(201).json({ user: { email: creds.email, currency: 'PHP' }, fresh: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  const limited = rateLimit({ key: `login:${clientIp(req)}`, limit: 10, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many attempts. Try again ${retryLabel(limited.retryAfterMs)}.` });
  const creds = readCredentials(req.body);
  // Deliberately vague: a precise message would confirm which emails exist.
  const reject = () => res.status(401).json({ error: 'Email or password is incorrect.' });
  if (creds.error) return reject();

  const user = await one('SELECT id, email, password_hash, currency, role FROM users WHERE email = ?', [creds.email]);
  if (!user || !verifyPassword(creds.password, user.password_hash)) return reject();

  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt, PROD);
  res.json({ user: { email: user.email, currency: user.currency, role: user.role } });
}));

app.post('/api/logout', wrap(async (req, res) => {
  await destroySession(parseCookies(req.get('Cookie'))[COOKIE]);
  clearSessionCookie(res, PROD);
  res.json({ ok: true });
}));

app.get('/api/me', wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  const counts = await one(`
    SELECT (SELECT COUNT(*) FROM entries WHERE user_id = ? AND deleted = 0) AS entries,
           (SELECT COUNT(*) FROM money_entries WHERE user_id = ? AND deleted = 0) AS money`,
    [user.id, user.id]);
  // The role is what lets the app offer the dashboard link at all; it says
  // nothing an ordinary account could not already work out about itself.
  res.json({ user: { email: user.email, currency: user.currency, role: user.role }, counts });
}));

/* ── password reset ── */

const RESET_MS = 60 * 60 * 1000;
const resetHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

app.post('/api/forgot', wrap(async (req, res) => {
  // Two separate caps. The per-IP one stops the endpoint being used to spray
  // mail at arbitrary addresses; the per-address one below stops a single
  // mailbox being buried. A typo or an unknown address costs nothing, because
  // the address cap is only charged when an email is genuinely about to go out.
  const limited = rateLimit({ key: `forgot-ip:${clientIp(req)}`, limit: 15, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many reset requests from here. Try again ${retryLabel(limited.retryAfterMs)}.` });
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  // One message for every outcome below, so the endpoint cannot be used to
  // discover which addresses have accounts.
  const generic = { ok: true, message: 'If that address has an account, a reset link is on its way.' };
  if (!EMAIL_RE.test(email) || email.length > 254) return res.json(generic);

  const user = await one('SELECT id, email, password_hash, google_sub FROM users WHERE email = ?', [email]);
  if (!user) return res.json(generic);

  // Deliberate exception to the rule above: telling a Google user to use the
  // Google button is worth confirming the account exists, because otherwise
  // they wait for an email that could never help them.
  if (!user.password_hash && user.google_sub) {
    return res.json({ ok: true, google: true, message: 'This account signs in with Google. Use the Google button instead — there is no password to reset.' });
  }

  const perAddress = rateLimit({ key: `forgot-mail:${email}`, limit: 4, windowMs: 60 * 60 * 1000 });
  if (!perAddress.ok) {
    return res.status(429).json({ error: `A reset link has already been sent for that address. Check your inbox and spam folder, or try again ${retryLabel(perAddress.retryAfterMs)}.` });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  // Any earlier link for this account stops working the moment a new one is issued.
  await query('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
  await query('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    [resetHash(token), user.id, t, t + RESET_MS]);

  const base = (process.env.APP_URL || `${req.protocol}://${req.get('Host')}`).replace(/\/+$/, '');
  try {
    await sendResetEmail(user.email, `${base}/?reset=${token}`);
  } catch (err) {
    console.error('[zimpan] reset email failed', err);
    return res.status(500).json({ error: 'Could not send the email just now. Please try again shortly.' });
  }
  res.json(generic);
}));

app.post('/api/reset', wrap(async (req, res) => {
  const limited = rateLimit({ key: `reset:${clientIp(req)}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many attempts. Try again ${retryLabel(limited.retryAfterMs)}.` });
  const token = String((req.body || {}).token || '');
  const password = String((req.body || {}).password || '');
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  if (password.length > 400) return res.status(400).json({ error: 'Password is too long.' });

  const row = await one('SELECT token_hash, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?', [resetHash(token)]);
  const expired = !row || row.used_at || Number(row.expires_at) < now();
  if (expired) return res.status(400).json({ error: 'That reset link has expired or has already been used. Request a new one.' });

  const t = now();
  await query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(password), t, row.user_id]);
  await query('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [t, row.token_hash]);
  // Whoever asked for this reset may not be who is currently signed in, so every
  // existing session for the account is dropped.
  await query('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);

  const user = await one('SELECT id, email, currency, role FROM users WHERE id = ?', [row.user_id]);
  const { token: sessionToken, expiresAt } = await createSession(user.id);
  setSessionCookie(res, sessionToken, expiresAt, PROD);
  res.json({ user: { email: user.email, currency: user.currency, role: user.role } });
}));

/* ── sync ── */

app.get('/api/sync', requireUser, wrap(async (req, res) => {
  const since = Number(req.query.since) || 0;
  /* Not awaited: "when was this account last seen" is bookkeeping for a
     dashboard, and a sync should never be slower or fail because of it. */
  touchSeen(req.user.id, req.user.lastSeenAt).catch(() => {});
  res.json({ serverTime: now(), changes: await changesSince(req.user.id, since) });
}));

app.post('/api/sync', requireUser, wrap(async (req, res) => {
  const since = Number((req.body && req.body.since) || 0);
  try {
    const applied = await applyChanges(req.user.id, req.body && req.body.changes);
    // Read after the write, so the client sees its own rows echoed back and can
    // settle on one canonical version.
    res.json({ serverTime: now(), applied, changes: await changesSince(req.user.id, since) });
  } catch (err) {
    if (err instanceof Invalid) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

/* ── google sign-in ──
   Gated on GOOGLE_CLIENT_ID: with none set the endpoint refuses and the client
   never draws the button, so the app runs perfectly well unconfigured. */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

app.post('/api/auth/google', wrap(async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  const limited = rateLimit({ key: `google:${clientIp(req)}`, limit: 20, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many attempts. Try again ${retryLabel(limited.retryAfterMs)}.` });

  let claims;
  try {
    claims = await verifyGoogleIdToken((req.body || {}).credential, GOOGLE_CLIENT_ID);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const t = now();
  let user = await one('SELECT id, email, currency FROM users WHERE google_sub = ?', [claims.sub]);
  let fresh = false;

  // Returning by email rather than by sub means this Google account has not
  // been linked yet. Only link when Google vouches for the address — otherwise
  // an unverified address would be enough to walk into someone's account.
  if (!user && claims.email) {
    const byEmail = await one('SELECT id, email, currency FROM users WHERE email = ?', [claims.email]);
    if (byEmail) {
      if (!claims.emailVerified) {
        return res.status(403).json({ error: 'Google has not verified this email address, so it cannot be linked to the existing account.' });
      }
      await query('UPDATE users SET google_sub = ?, display_name = COALESCE(display_name, ?), updated_at = ? WHERE id = ?',
        [claims.sub, claims.name, t, byEmail.id]);
      user = byEmail;
    }
  }

  if (!user) {
    if (!claims.email) return res.status(400).json({ error: 'Google did not supply an email address.' });
    if (!claims.emailVerified) return res.status(403).json({ error: 'Google has not verified this email address.' });
    try {
      const result = await query(
        'INSERT INTO users (email, password_hash, google_sub, display_name, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [claims.email, null, claims.sub, claims.name, 'PHP', t, t]);
      user = { id: result.insertId, email: claims.email, currency: 'PHP' };
      fresh = true;
    } catch (err) {
      // Two sign-ins racing on the same address: whoever lost just re-reads.
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      user = await one('SELECT id, email, currency, role FROM users WHERE email = ? OR google_sub = ?', [claims.email, claims.sub]);
      if (!user) throw err;
    }
  }

  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt, PROD);
  res.json({ user: { email: user.email, currency: user.currency, role: user.role || 'user' }, fresh });
}));

/* ── nutrition estimates ──

   Behind a session and a rate limit: the key is ours to pay for, so it is not
   left open to anyone who can reach the domain. The cap is per user rather
   than per IP, since a household behind one address is not one person. */

app.post('/api/estimate', requireUser, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI estimates are not configured on this server.' });

  const limited = rateLimit({ key: `estimate:${req.user.id}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `That is a lot of estimates. Try again ${retryLabel(limited.retryAfterMs)}.` });

  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Nothing to estimate.' });
  if (text.length > 1200) return res.status(400).json({ error: 'That is too much text to estimate in one go.' });

  try {
    res.json({ estimate: await estimateNutrition(text) });
  } catch (err) {
    // The reason is already in the log; the message here is safe to show.
    res.status(502).json({ error: err.message });
  }
}));

/* The report deck's prose, one window at a time.

   A tighter limit than the estimates: this is a much larger request, and the
   client caches per window, so a person reading their own report honestly needs
   a handful an hour rather than dozens. The body is the summarised figures the
   cards already show — capped by size rather than parsed field by field, since
   what it contains is the client's own output and the model sees it as data. */
app.post('/api/deck-summary', requireUser, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI summaries are not configured on this server.' });

  const limited = rateLimit({ key: `deck:${req.user.id}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `That is a lot of reports. Try again ${retryLabel(limited.retryAfterMs)}.` });

  const facts = (req.body || {}).facts;
  if (!facts || typeof facts !== 'object') return res.status(400).json({ error: 'Nothing to summarise.' });
  const size = JSON.stringify(facts).length;
  if (size > 12000) return res.status(400).json({ error: 'That is too much to summarise in one go.' });

  try {
    res.json({ summaries: await summariseDeck(facts) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

/* ── the admin dashboard ──

   Every route is behind a role. Reading is manager or superadmin; writing is
   superadmin only, checked here rather than trusted to the page.

   Nothing below returns anything a user wrote. Counts, dates and email
   addresses — the queries in admin.js do not select a single activity, note or
   amount, so there is nothing for a mistake in the page to spill. */

app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
  res.json({ overview: await adminOverview(), role: req.user.role });
}));

app.get('/api/admin/users', requireAdmin, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  res.json(await adminUsers({
    q, sort: String(req.query.sort || 'recent'),
    limit: req.query.limit, offset: req.query.offset
  }));
}));

app.get('/api/admin/users/:id/donations', requireAdmin, wrap(async (req, res) => {
  res.json({ donations: await donationsFor(Number(req.params.id)) });
}));

app.post('/api/admin/role', requireSuper, wrap(async (req, res) => {
  const { email, role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
  try {
    res.json({ ok: true, ...(await setRole(req.user.id, email, role)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.post('/api/admin/donations', requireSuper, wrap(async (req, res) => {
  try {
    res.json({ ok: true, ...(await addDonation(req.user.id, req.body || {})) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.delete('/api/admin/donations/:id', requireSuper, wrap(async (req, res) => {
  try {
    await removeDonation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

/* Interest, recorded as interest. Fire-and-forget from the app, so it answers
   with nothing worth waiting for and never blocks the click it describes. */
app.post('/api/donate-click', requireUser, wrap(async (req, res) => {
  const limited = rateLimit({ key: `donate:${req.user.id}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (limited.ok) await noteDonateClick(req.user.id);
  res.json({ ok: true });
}));

// Lets the client decide whether to draw the Google button and the refine
// button at all. Says only whether the feature exists, never the key.
app.get('/api/config', (req, res) => res.json({
  googleClientId: GOOGLE_CLIENT_ID || null,
  aiEstimates: aiConfigured()
}));

app.get('/api/currencies', (req, res) => res.json({ currencies: CURRENCIES }));

/* ── static ── */

const sendRoot = (file) => (req, res) => res.sendFile(join(ROOT, file));
app.get('/', sendRoot('index.html'));
app.get('/index.html', sendRoot('index.html'));
app.get('/app.js', sendRoot('app.js'));

/* Named explicitly, like everything else here: this is an allowlist, not a
   directory, so a file existing at the project root is not enough to make it
   reachable. Without these two routes a crawler asking for the sitemap gets the
   404 below, which Search Console reports as "Couldn't fetch". */
app.get('/sitemap.xml', sendRoot('sitemap.xml'));
app.get('/robots.txt', sendRoot('robots.txt'));

/* The admin dashboard is a separate page, so it needs its own entries here for
   the same reason the sitemap did: a file at the project root is not reachable
   until it is named. The page itself is public HTML — everything it displays
   arrives from the API routes above, every one of which is behind a role. */
app.get('/admin', sendRoot('admin.html'));
app.get('/admin.html', sendRoot('admin.html'));
app.get('/admin.js', sendRoot('admin.js'));
app.use('/ds', express.static(join(ROOT, 'ds'), { fallthrough: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No such endpoint.' });
  res.status(404).type('text/plain').send('Not found');
});

app.use((err, req, res, _next) => {
  /* A missing static file arrives here as a 404-shaped error. Reporting it as
     500 makes a typo'd asset path look like the server is broken. */
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('[zimpan]', err);
  if (status === 404) {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No such endpoint.' });
    return res.status(404).type('text/plain').send('Not found');
  }
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our end.' : 'That request could not be handled.' });
});

/* Listen first, prepare the database second. A failure to bind is still fatal —
   nothing can be served without a socket — but a database that is away is not,
   because the app and its assets do not need one. */
const server = app.listen(PORT, () => {
  console.log(`ZIMPAN listening on http://localhost:${PORT}  (${PROD ? 'production' : 'development'})`);
});

server.on('error', (err) => {
  console.error('[zimpan] could not start the server:', err.message);
  process.exit(1);
});

prepareDatabase();
