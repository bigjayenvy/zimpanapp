/* ZIMPAN API + static host.

   Static files are served from an explicit allow-list rather than by pointing
   express.static at the project root — server/ sits inside that root, and a
   catch-all would publish the database credentials along with the app. */

import express from 'express';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { query, one, now, migrate, HERE } from './db.js';
import {
  hashPassword, verifyPassword, createSession, userForToken, destroySession,
  parseCookies, setSessionCookie, clearSessionCookie, rateLimit, retryLabel, COOKIE
} from './auth.js';
import { changesSince, applyChanges, Invalid, CURRENCIES, watermark } from './sync.js';
import { verifyGoogleIdToken } from './google.js';
import { sendResetEmail, sendInviteEmail, sendTicketEmails, sendSignupEmail, mailerConfigured, mailerProblem } from './mail.js';
import {
  BlogError, listPosts, readPost, publishedSlugs,
  adminList, adminRead, createPost, updatePost, deletePost
} from './blog.js';
import { SupportError, SUPPORT_TO, fileTicket, listTickets, setTicketStatus, TICKET_STATUSES } from './support.js';
import { estimateNutrition, estimateBurn, summariseDeck, chatReply, aiConfigured, warmAI } from './ai.js';
import {
  overview as adminOverview, users as adminUsers, donationsFor,
  setRole, addDonation, removeDonation, deleteAccount, noteDonateClick, touchSeen, isAdminRole, ROLES
} from './admin.js';
import {
  TeamError, membershipFor, createTeam, teamOverview, inviteMember, revokeInvite,
  acceptInvite, setMemberRole, removeMember, saveProject, deleteProject,
  memberEntries, editMemberEntry, teamDashboard, teamNow, setTeamPlan, resendInvite, PLANS
} from './teams.js';

const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT) || 3000;

/* What a brand new account is created with. Only ever read on the INSERT: an
   account that already exists keeps whatever is in its row, because the
   amounts logged under it were entered in that currency and relabelling them
   would rewrite what every past entry meant. Mirrors DEFAULT_CURRENCY in
   app.js — the two are the same decision made on both sides of the wire. */
/* For the one place this server writes HTML rather than serving a file: the
   meta tags on a blog post's page. Both quote styles as well as the angle
   brackets, because every one of these lands inside a double-quoted attribute
   and a title with a quote in it would otherwise close it. */
const htmlAttr = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DEFAULT_CURRENCY = 'USD';
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
const DB_FREE = new Set(['/api/config', '/api/currencies', '/api/health', '/api/ready', '/api/team/plans']);

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
   underlying error stays in the log: it names the host and user.

   Two endpoints because there are two questions, and answering both with one
   status code is what turned a partial outage into a total one.

   Liveness: is this process up and serving? That is what a gateway's health
   check is asking, and the answer is yes whenever this handler runs at all —
   so it is always 200. It used to return 503 while the database was away,
   which is exactly when the design above is busy keeping the site usable
   without one. A gateway polling it would mark the upstream down and serve 502
   for everything, including index.html and app.js, which need no database.
   The 200 carries the database's real state in the body, so nothing is hidden.

   Readiness: can this process do the work that needs MySQL? That is what a
   deploy gate or an alert wants, and it is a different question with its own
   path, still answering 503 so a check can fail on it deliberately. */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: dbReady ? 'ready' : 'unavailable', ready: dbReady });
});

app.get('/api/ready', (req, res) => {
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

/* Somebody is told when an account appears.

   Deliberately not awaited. The account exists the moment the row is written,
   and whether a notice about it reached a mailbox is no business of the reply
   the person signing up is waiting on — so this runs beside the response and
   swallows its own failures, which is also what stops a slow SMTP handshake
   from holding up a sign-up.

   The count is read here rather than kept, because it is only ever wanted at
   this moment and a stored tally is a thing that can be wrong. */
function noteSignup(account) {
  one('SELECT COUNT(*) AS n FROM users')
    .then((row) => sendSignupEmail(Object.assign({ total: row && Number(row.n) }, account)))
    .catch((err) => console.error(`[zimpan] sign-up notice failed: ${err.message}`));
}

app.post('/api/register', wrap(async (req, res) => {
  const limited = rateLimit({ key: `reg:${clientIp(req)}`, limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many sign-ups from here. Try again ${retryLabel(limited.retryAfterMs)}.` });
  const creds = readCredentials(req.body);
  if (creds.error) return res.status(400).json({ error: creds.error });

  const taken = await one('SELECT kind FROM users WHERE email = ?', [creds.email]);
  if (taken) {
    const asked = (req.body || {}).kind === 'work' ? 'work' : 'personal';
    const has = taken.kind === 'work' ? 'work' : 'personal';
    return res.status(409).json({
      error: has === asked
        ? 'That email is already registered — sign in instead.'
        : has === 'personal'
          ? 'That email already has a personal Zimpan. A team account has to be its own, so use a different email.'
          : 'That email already belongs to a Zimpan for Teams account. Your personal Zimpan has to be its own, so use a different email.'
    });
  }

  /* Which product this account is for, decided here and never again. Anything
     that is not the word "work" is a personal account, so a malformed or
     missing field lands on the safe side rather than quietly creating a team
     login. */
  const kind = (req.body || {}).kind === 'work' ? 'work' : 'personal';

  const t = now();
  const result = await query(
    'INSERT INTO users (email, password_hash, currency, kind, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [creds.email, hashPassword(creds.password), DEFAULT_CURRENCY, kind, t, t]);

  const { token, expiresAt } = await createSession(result.insertId);
  setSessionCookie(res, token, expiresAt, PROD);
  noteSignup({ email: creds.email, kind, how: 'password', at: t });
  res.status(201).json({ user: { id: result.insertId, email: creds.email, currency: DEFAULT_CURRENCY, kind }, fresh: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  const limited = rateLimit({ key: `login:${clientIp(req)}`, limit: 10, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `Too many attempts. Try again ${retryLabel(limited.retryAfterMs)}.` });
  const creds = readCredentials(req.body);
  // Deliberately vague: a precise message would confirm which emails exist.
  const reject = () => res.status(401).json({ error: 'Email or password is incorrect.' });
  if (creds.error) return reject();

  const user = await one('SELECT id, email, password_hash, currency, role, kind FROM users WHERE email = ?', [creds.email]);
  if (!user || !verifyPassword(creds.password, user.password_hash)) return reject();

  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt, PROD);
  res.json({ user: { id: user.id, email: user.email, currency: user.currency, role: user.role, kind: user.kind } });
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
  res.json({ user: { id: user.id, email: user.email, currency: user.currency, role: user.role, kind: user.kind }, counts });
}));

/* ── closing your own account ──

   The same rules the dashboard's delete follows, minus the ones that only make
   sense between two people: nobody has to type anybody else's address, and a
   superadmin closing their own account is their business.

   The team rule stays, and it is the important one. An owner walking out of a
   team with people still in it would leave their projects, hours and
   invitations attached to a team with nobody who can administer it — so they
   are told to hand it over or empty it first. A team of one goes with them.

   The users row cascades: entries, money, sessions, tokens, memberships, all
   of it. Which is what the privacy policy already promises, and what makes
   "deleted" mean deleted rather than "hidden until you sign up again". */
app.delete('/api/me', requireUser, wrap(async (req, res) => {
  const id = req.user.id;
  const member = await one('SELECT team_id AS teamId, role FROM team_members WHERE user_id = ?', [id]);
  let emptied = null;
  if (member) {
    const left = await one('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', [member.teamId]);
    const others = Number(left.n) - 1;
    if (member.role === 'super' && others > 0) {
      return res.status(409).json({
        error: `You own a team with ${others} other ${others === 1 ? 'person' : 'people'} in it. Make somebody else the owner, or remove them, before closing your account.`
      });
    }
    if (others === 0) emptied = member.teamId;
  }

  await query('DELETE FROM users WHERE id = ?', [id]);
  if (emptied) await query('DELETE FROM teams WHERE id = ?', [emptied]);
  clearSessionCookie(res, PROD);
  res.json({ ok: true, teamRemoved: !!emptied });
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
  res.json({ user: { id: user.id, email: user.email, currency: user.currency, role: user.role } });
}));

/* ── sync ── */

/* Both sync routes stamp the account as seen.

   POST is the one that matters: the app pushes and pulls in a single call and
   never issues the GET, so putting the stamp only there left every account
   reading "never synced" no matter how much they used it. GET keeps it too —
   it is a sync either way, and a stamp that depends on which verb a future
   client picks is a stamp that will go wrong again.

   Never awaited: this is bookkeeping for a dashboard, and a sync should not be
   slower, or fail, because of it. */
app.get('/api/sync', requireUser, wrap(async (req, res) => {
  const since = Number(req.query.since) || 0;
  touchSeen(req.user.id, req.user.lastSeenAt).catch(() => {});
  /* The mark is taken before the read, and held a little behind the clock —
     see watermark(). Both halves matter: taken after, a row written during the
     read would be stamped below a mark the client is about to adopt. */
  const mark = watermark();
  res.json({ serverTime: mark, changes: await changesSince(req.user.id, since) });
}));

app.post('/api/sync', requireUser, wrap(async (req, res) => {
  const since = Number((req.body && req.body.since) || 0);
  touchSeen(req.user.id, req.user.lastSeenAt).catch(() => {});
  try {
    const applied = await applyChanges(req.user.id, req.body && req.body.changes);
    // Read after the write, so the client sees its own rows echoed back and can
    // settle on one canonical version.
    const mark = watermark();
    res.json({ serverTime: mark, applied, changes: await changesSince(req.user.id, since) });
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

  /* Which product the account is for, on the same rule as /api/register: only
     the exact word makes a work account. It applies to a NEW account only —
     signing in to one that exists never changes what it is, which is the whole
     point of the column. */
  const wantKind = (req.body || {}).kind === 'work' ? 'work' : 'personal';

  const t = now();
  let user = await one('SELECT id, email, currency, role, kind FROM users WHERE google_sub = ?', [claims.sub]);
  let fresh = false;

  // Returning by email rather than by sub means this Google account has not
  // been linked yet. Only link when Google vouches for the address — otherwise
  // an unverified address would be enough to walk into someone's account.
  if (!user && claims.email) {
    const byEmail = await one('SELECT id, email, currency, role, kind FROM users WHERE email = ?', [claims.email]);
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
        'INSERT INTO users (email, password_hash, google_sub, display_name, currency, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [claims.email, null, claims.sub, claims.name, DEFAULT_CURRENCY, wantKind, t, t]);
      user = { id: result.insertId, email: claims.email, currency: DEFAULT_CURRENCY, kind: wantKind };
      fresh = true;
      noteSignup({ email: claims.email, kind: wantKind, how: 'google', name: claims.name, at: t });
    } catch (err) {
      // Two sign-ins racing on the same address: whoever lost just re-reads.
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      user = await one('SELECT id, email, currency, role, kind FROM users WHERE email = ? OR google_sub = ?', [claims.email, claims.sub]);
      if (!user) throw err;
    }
  }

  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt, PROD);
  res.json({
    user: { id: user.id, email: user.email, currency: user.currency, role: user.role || 'user', kind: user.kind || 'personal' },
    fresh
  });
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

/* The other half of the ledger. Same shape and same limit as the nutrition
   estimate — it is the same kind of request about the same kind of text, and
   sharing the ceiling keeps one from starving the other. */
app.post('/api/estimate-burn', requireUser, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI estimates are not configured on this server.' });

  const limited = rateLimit({ key: `estimate:${req.user.id}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `That is a lot of estimates. Try again ${retryLabel(limited.retryAfterMs)}.` });

  const body = req.body || {};
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Nothing to estimate.' });
  if (text.length > 1200) return res.status(400).json({ error: 'That is too much text to estimate in one go.' });

  try {
    const estimate = await estimateBurn(text, body.weightKg, body.minutes);
    // null means it came back outside what is physically plausible; the local
    // MET reading is still there and still valid, so this is not an error.
    if (!estimate) return res.status(422).json({ error: 'That estimate did not look right, so it was not used.' });
    res.json({ estimate });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

/* "Chat with Zimpan".

   Rate limited harder than either of the others per request, because a
   conversation is many requests where a report is one: sixty an hour is a busy
   afternoon of asking and nowhere near a way to spend the key.

   The body carries the whole conversation and the log it is answered from. Both
   are capped by size rather than validated field by field — it is the client's
   own output coming back, and the model is given it as data inside a tag rather
   than as instructions. Nothing is stored: the transcript lives in the browser,
   so this endpoint holds no history and a closed chat is a gone chat. */
app.post('/api/chat', requireUser, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'Chat is not configured on this server.' });

  const limited = rateLimit({ key: `chat:${req.user.id}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `That is a lot of questions. Try again ${retryLabel(limited.retryAfterMs)}.` });

  const body = req.body || {};
  const history = body.history;
  if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'Nothing to answer.' });
  if (history.length > 40) return res.status(400).json({ error: 'That conversation is too long to send in one go.' });

  const facts = body.facts && typeof body.facts === 'object' ? body.facts : {};
  if (JSON.stringify(history).length > 20000) return res.status(400).json({ error: 'That conversation is too long to send in one go.' });
  if (JSON.stringify(facts).length > 60000) return res.status(400).json({ error: 'That is more log than we can send in one go.' });

  try {
    res.json({ reply: await chatReply(history, facts) });
  } catch (err) {
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

/* Irreversible, so it is a superadmin route and it takes the address as well
   as the id — see deleteAccount for why both. */
app.delete('/api/admin/users/:id', requireSuper, wrap(async (req, res) => {
  try {
    res.json(await deleteAccount(req.user.id, req.params.id, (req.body || {}).email));
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

/* ── teams ──

   Every one of these takes the team from the caller's own membership row
   inside teams.js; not one of them reads a team id from the request, so there
   is no shape of request that reaches another team. The handlers here do the
   HTTP and nothing else — a TeamError carries the status it deserves. */
const team = (fn) => wrap(async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof TeamError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

app.get('/api/team', requireUser, team(async (req) => {
  const m = await membershipFor(req.user.id);
  // Not being in a team is an answer, not a failure: the client draws the
  // "start a team" screen from it.
  if (!m) return { team: null };
  return teamOverview(req.user.id);
}));

app.post('/api/team', requireUser, team((req) => createTeam(req.user.id, (req.body || {}).name)));

/* An invitation is created, then emailed, then reported on — in that order,
   and the middle step cannot undo the first.

   This route used to stop after the first step. It built the link, handed it
   back, and the comment above it said the token "goes out by email" — which it
   never did, for anybody, because nothing here sent one. The link on the
   admin's screen was the only way an invitation ever reached a person.

   Delivery is reported rather than assumed: the client says "emailed to them"
   or "we could not email them — send this link" depending on what actually
   happened, and the link comes back either way so a failure is recoverable
   without a second round trip. */
const inviteReply = async (req, invite) => {
  const link = `${req.protocol}://${req.get('Host')}/teams?invite=${encodeURIComponent(invite.token)}`;
  const sent = await sendInviteEmail(invite.email, link, {
    team: invite.team, from: invite.from, days: invite.days
  });
  return {
    email: invite.email, role: invite.role, expiresAt: invite.expiresAt, link,
    delivered: !!sent.delivered,
    // Named for the admin, not for the log: "not configured" is something they
    // can act on, an SMTP error string is not.
    mailReason: sent.delivered ? ''
      : (mailerConfigured() ? `The mail server refused it: ${sent.reason || 'no reason given'}` : mailerProblem())
  };
};

app.post('/api/team/invite', requireUser, team(async (req) => {
  const b = req.body || {};
  return inviteReply(req, await inviteMember(req.user.id, b.email, b.role));
}));

app.post('/api/team/invite/resend', requireUser, team(async (req) =>
  inviteReply(req, await resendInvite(req.user.id, (req.body || {}).email))));

app.post('/api/team/invite/revoke', requireUser, team((req) => revokeInvite(req.user.id, (req.body || {}).email)));

app.post('/api/team/accept', requireUser, team((req) =>
  acceptInvite(req.user.id, req.user.email, (req.body || {}).token)));

app.post('/api/team/role', requireUser, team((req) => {
  const b = req.body || {};
  return setMemberRole(req.user.id, b.userId, b.role);
}));

app.post('/api/team/remove', requireUser, team((req) => removeMember(req.user.id, (req.body || {}).userId)));

app.post('/api/team/project', requireUser, team((req) => saveProject(req.user.id, req.body || {})));
app.post('/api/team/project/delete', requireUser, team((req) => deleteProject(req.user.id, (req.body || {}).id)));

app.get('/api/team/member/:userId/entries', requireUser, team((req) =>
  memberEntries(req.user.id, req.params.userId, req.query.from, req.query.to)));

app.post('/api/team/entry/:id', requireUser, team((req) =>
  editMemberEntry(req.user.id, req.params.id, req.body || {})));

app.get('/api/team/dashboard', requireUser, team((req) =>
  teamDashboard(req.user.id, req.query.from, req.query.to)));

/* Polled while the Members tab is open, so the date comes from the caller: the
   server has no idea what day it is where the team is sitting, and a timezone
   guessed here would put a whole office's morning on yesterday. Validated as a
   date inside teamNow before it reaches any query. */
app.get('/api/team/now', requireUser, team((req) => teamNow(req.user.id, req.query.date)));

/* The manual half of billing. Site admins only — a team's own owner reaching
   this would be one request away from the unlimited plan. */
app.post('/api/admin/team-plan', requireUser, team(async (req) => {
  if (!isAdminRole(req.user.role)) throw new TeamError('Not yours to do.', 403);
  const b = req.body || {};
  return setTeamPlan(b.teamId, b.plan);
}));

app.get('/api/team/plans', (req, res) => res.json({ plans: PLANS }));

/* ── help ──

   Open to anyone, signed in or not: the footer this is reached from is on the
   landing page, and somebody who cannot sign in is exactly the person most
   likely to need it. A session, where there is one, supplies the address and
   is trusted over anything typed — a signed-in person asking us to reply to
   somebody else's mailbox is not a case worth supporting.

   The rate limiting lives in support.js and applies per address either way. */
app.post('/api/support', wrap(async (req, res) => {
  const b = req.body || {};
  const user = await currentUser(req);
  try {
    const out = await fileTicket({
      email: user ? user.email : b.email,
      userId: user ? user.id : null,
      subject: b.subject,
      body: b.body
    }, (ticket) => sendTicketEmails(SUPPORT_TO, {
      ...ticket,
      who: user ? `signed in${user.role && user.role !== 'user' ? ` · ${user.role}` : ''}` : 'not signed in'
    }));
    res.json(out);
  } catch (err) {
    if (err instanceof SupportError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/* Read-only, and deliberately so — replying happens in the mailbox, which is
   the only place that can see the rest of the conversation. */
app.get('/api/admin/support', requireAdmin, wrap(async (req, res) => {
  res.json({ tickets: await listTickets(req.query.limit), statuses: TICKET_STATUSES });
}));

/* The one thing that is not read-only. Still no reply box: the answering
   happens in the mailbox, and this only records where somebody says it got to. */
app.post('/api/admin/support/:id/status', requireAdmin, wrap(async (req, res) => {
  try {
    res.json(await setTicketStatus(req.user, req.params.id, (req.body || {}).status));
  } catch (err) {
    if (err instanceof SupportError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/* ── the blog ──
   Reading is open to anyone; every write is behind requireAdmin. The two
   halves call different functions in blog.js rather than one function with a
   flag, so "may this caller see a draft" is answered by which route was hit
   rather than by a parameter that could arrive wrong. */
const blog = (fn) => wrap(async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof BlogError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

app.get('/api/blog', blog((req) => listPosts({ limit: req.query.limit, before: req.query.before })));
app.get('/api/blog/:slug', blog((req) => readPost(req.params.slug)));

app.get('/api/admin/blog', requireAdmin, blog(() => adminList().then((posts) => ({ posts }))));
app.get('/api/admin/blog/:id', requireAdmin, blog((req) => adminRead(req.params.id)));
app.post('/api/admin/blog', requireAdmin, blog((req) =>
  createPost({ id: req.user.id, email: req.user.email }, req.body || {})));
app.put('/api/admin/blog/:id', requireAdmin, blog((req) => updatePost(req.params.id, req.body || {})));
app.delete('/api/admin/blog/:id', requireAdmin, blog((req) => deletePost(req.params.id)));

/* ── static ── */

const sendRoot = (file) => (req, res) => res.sendFile(join(ROOT, file));
app.get('/', sendRoot('index.html'));
app.get('/index.html', sendRoot('index.html'));
/* The team page is the same document — app.js reads the path and draws the
   other page — so it is another name for index.html rather than a file of its
   own. Named explicitly, like everything else here: this is an allowlist, and
   a route that is not in it is the 404 below however real the page is. */
app.get('/teams', sendRoot('index.html'));
app.get('/blogs', sendRoot('index.html'));

/* A post's own page, with its own title and description written into the HTML
   before it is sent.

   The rest of this app is one document that decides what to draw once
   JavaScript runs, which is fine for pages nobody links to. A blog post is the
   opposite: its whole purpose is to be found and shared, and a crawler or a
   chat preview reads the markup it is served, not the page the browser
   eventually builds. So this one route fills the head in before it goes.

   A miss falls through to the same document unfilled rather than 404ing — the
   client draws its own "no such post" and an unpublished draft should look
   like a wrong address, not like a page that exists and is being withheld. */
app.get('/blogs/:slug', wrap(async (req, res) => {
  const file = join(ROOT, 'index.html');
  let post = null;
  try { post = await readPost(req.params.slug); } catch (err) { /* unfilled is fine */ }
  if (!post) return res.sendFile(file);

  const html = await readFile(file, 'utf8');
  const url = `https://zimpan.com/blogs/${encodeURIComponent(post.slug)}`;
  /* The meta fields when they were written, the post's own when they were not.
     Resolved here rather than stored as a copy: a meta title saved as a
     duplicate of the title stops following it the first time the title is
     edited, and nobody sees the drift until they look at a search result.

     The <title> tag carries the ZIMPAN suffix only when it is the post's title
     standing in — a meta title is written to be the whole thing. */
  const metaTitle = post.metaTitle || `${post.title} — ZIMPAN`;
  const metaDesc = post.metaDesc || post.excerpt || '';
  const head = [
    `<title>${htmlAttr(metaTitle)}</title>`,
    `<meta name="description" content="${htmlAttr(metaDesc)}">`,
    post.metaWords ? `<meta name="keywords" content="${htmlAttr(post.metaWords)}">` : '',
    `<link rel="canonical" href="${htmlAttr(url)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${htmlAttr(post.metaTitle || post.title)}">`,
    `<meta property="og:description" content="${htmlAttr(metaDesc)}">`,
    `<meta property="og:url" content="${htmlAttr(url)}">`,
    post.cover ? `<meta property="og:image" content="${htmlAttr(post.cover)}">` : '',
    `<meta name="twitter:card" content="${post.cover ? 'summary_large_image' : 'summary'}">`
  ].filter(Boolean).join('\n  ');

  /* The document's own <title> is replaced rather than added to — two titles
     and a crawler picks the first, which would be the app's. */
  res.type('html').send(html.replace(/<title>[\s\S]*?<\/title>/i, head));
}));
app.get('/app.js', sendRoot('app.js'));

/* Named explicitly, like everything else here: this is an allowlist, not a
   directory, so a file existing at the project root is not enough to make it
   reachable. Without these two routes a crawler asking for the sitemap gets the
   404 below, which Search Console reports as "Couldn't fetch". */
/* Generated rather than served, now that some of the URLs are rows.

   The file on disk is still the source for the fixed pages — it is easier to
   edit and it is what a person expects to find — and the published posts are
   appended to it. If the database cannot answer, the file goes out as it is:
   a sitemap missing its blog posts is a small loss, and a 500 on this URL is
   reported in Search Console as a site that cannot be crawled. */
app.get('/sitemap.xml', wrap(async (req, res) => {
  const file = join(ROOT, 'sitemap.xml');
  let xml;
  try { xml = await readFile(file, 'utf8'); } catch (err) { return res.sendFile(file); }
  let posts = [];
  try { posts = await publishedSlugs(); } catch (err) { /* the fixed pages still go */ }

  const entries = posts.map((post) => `  <url>
    <loc>https://zimpan.com/blogs/${htmlAttr(encodeURIComponent(post.slug))}</loc>
    <lastmod>${new Date(Number(post.updatedAt) || Date.now()).toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

  const index = posts.length ? `  <url>
    <loc>https://zimpan.com/blogs</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>\n` : '';

  res.type('application/xml').send(
    entries || index
      ? xml.replace('</urlset>', `${index}${entries}\n</urlset>`)
      : xml);
}));
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

/* ── the two ways a process dies without saying why ──

   Node kills the process on an unhandled promise rejection. Every route here
   goes through wrap(), so a rejecting handler reaches Express rather than the
   default handler — but wrap() cannot cover a promise nobody awaited: a
   setTimeout callback, a fire-and-forget write, a listener. One of those ends
   the process, Passenger serves 502 until something restarts it, and the log
   says nothing about it.

   Rejections are logged and survived. The alternative is dying for a stray
   promise in a background task while every request in flight was fine, and a
   web server that stops answering is worse than one carrying an unhandled
   rejection it has told you about.

   Uncaught exceptions are logged and then fatal, deliberately. By that point
   the stack has unwound through unknown code and state is no longer
   trustworthy; a clean exit lets Passenger start a fresh process, which is a
   recovery, where limping on is a guess. The listener is closed first so
   requests in flight are allowed to finish. */
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error(`[zimpan] unhandled rejection: ${err.message}\n${err.stack || ''}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[zimpan] uncaught exception, exiting: ${err.message}\n${err.stack || ''}`);
  // Never hang on a wedged socket: exit anyway if the drain does not finish.
  const bail = setTimeout(() => process.exit(1), 5000);
  if (typeof bail.unref === 'function') bail.unref();
  server.close(() => process.exit(1));
});

prepareDatabase();

/* Settles whether the AI features are really available before anyone asks.
   Separate from prepareDatabase() and never awaited: the site serves with or
   without it, and holding the boot on an optional feature is how an optional
   feature becomes a required one. */
warmAI();
