/* ZIMPAN API + static host.

   Static files are served from an explicit allow-list rather than by pointing
   express.static at the project root — server/ sits inside that root, and a
   catch-all would publish the database credentials along with the app. */

import express from 'express';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { query, one, now, migrate, migrateAt, dbVia, HERE } from './db.js';
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
import { voiceSession, voiceConfigured } from './voice.js';
import { sendPush, pushConfigured, pushPublicKey } from './push.js';
import { dayAhead, composeReminder, composeTest, localDate, pushDue } from './remind.js';
import {
  overview as adminOverview, users as adminUsers, donationsFor,
  setRole, addDonation, removeDonation, deleteAccount, noteDonateClick, touchSeen, isAdminRole, ROLES
} from './admin.js';
import { demoStatus, buildDemo, removeDemo } from './demo.js';
import { teamsHead, teamsPrerender } from './teamspage.js';
import { swapHead } from './head.js';
import {
  TeamError, membershipFor, createTeam, teamOverview, inviteMember, revokeInvite,
  acceptInvite, setMemberRole, removeMember, saveProject, deleteProject,
  memberEntries, editMemberEntry, teamDashboard, teamNow, setTeamPlan, resendInvite, PLANS,
  teamHoursExport, teamAudit, recordSubscription, teamSubscriptions
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
/* Why it is not ready, in a form that can be shown to whoever is asking.

   The code and the step, never the message. A driver's message names the host
   and the user it tried them with — that is why it has always stayed in the
   log — but the code is a fixed identifier (ER_ACCESS_DENIED_ERROR, ECONNREFUSED,
   ER_CANT_CREATE_TABLE) and the step is a line out of this repository. Between
   them they say which of the handful of things went wrong, which is the whole
   question, and neither can carry a secret. */
let dbFault = null;
const RETRY_MS = [2000, 5000, 10000, 20000, 30000];

async function prepareDatabase() {
  try {
    await migrate();
    dbReady = true;
    dbAttempt = 0;
    dbFault = null;
    console.log('[zimpan] database ready');
  } catch (err) {
    dbReady = false;
    dbFault = {
      code: String(err.code || err.name || 'UNKNOWN').slice(0, 40),
      step: migrateAt(),
      // Which way it tried, never where: "tcp" and "socket" name no host.
      via: dbVia,
      attempts: dbAttempt + 1
    };
    const wait = RETRY_MS[Math.min(dbAttempt, RETRY_MS.length - 1)];
    dbAttempt += 1;
    console.error(`[zimpan] database not ready (attempt ${dbAttempt}) at ${migrateAt()}: ${err.message} — retrying in ${wait / 1000}s`);
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
/* The fault travels with the answer. "unavailable" told you the database was
   the problem and then sent you to a log file for which problem, which is the
   half of the question that actually takes the time — and on shared hosting
   that log is several clicks into a file manager, if it is readable at all. */
/* When the code on this machine was last written.

   "I deployed and nothing changed" is a sentence with two very different
   causes behind it, and no way from outside to tell them apart: the change is
   wrong, or the change is not there. Three rounds of it went by before anyone
   thought to ask which. A file's own timestamp answers it without a build
   step, a version file or a git checkout to read — if this is older than the
   deploy you just ran, the deploy is what to look at, and nothing else here is
   worth reading yet. Read once: the file cannot change under a running
   process, and a restart is what a deploy does last. */
const BUILT_AT = (() => {
  try { return statSync(join(ROOT, 'server', 'server.js')).mtime.toISOString(); } catch { return null; }
})();

app.get('/api/health', (req, res) => {
  res.json(Object.assign(
    { ok: true, database: dbReady ? 'ready' : 'unavailable', ready: dbReady, built: BUILT_AT },
    dbReady || !dbFault ? {} : { fault: dbFault }
  ));
});

app.get('/api/ready', (req, res) => {
  res.status(dbReady ? 200 : 503).json(Object.assign(
    { ok: dbReady, database: dbReady ? 'ready' : 'unavailable' },
    dbReady || !dbFault ? {} : { fault: dbFault }
  ));
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

/* PayPal's own client id, which is public by design: it is in the URL of the
   script tag on every page that takes a payment. It is read from the
   environment anyway so a sandbox app can be pointed at without a deploy, with
   the live one as the default so an install that sets nothing still sells. */
const PAYPAL_CLIENT_ID = (process.env.PAYPAL_CLIENT_ID
  || 'AX2QT6OPgpUEtMc3U-BG5Nk-L_7tfXJQVE-MLUiGeWK0Bsrmb_xAsQH4EfwViZ1XGWaKU2HvgpG7lWw3').trim();

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
  /* Which of the two assistants answers. Anything but the how-to section is
     read as the log one — an old client that knows nothing about the split
     sends no mode and means the log, which is all it ever asked for. */
  const mode = body.mode === 'app' ? 'app' : 'log';
  if (JSON.stringify(history).length > 20000) return res.status(400).json({ error: 'That conversation is too long to send in one go.' });
  if (JSON.stringify(facts).length > 60000) return res.status(400).json({ error: 'That is more log than we can send in one go.' });

  try {
    // Asked out loud: the answer is going to a speaker, not a screen.
    res.json({ reply: await chatReply(history, facts, mode, body.brief === true) });
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

/* ── the demo account ──

   A real login holding a fictional person's log, so the app can be shown to
   somebody without showing them a real user's life. Reading its state is a
   manager's business; building or removing it is a superadmin's, because both
   write to a user row.

   The password is supplied by the admin and only ever leaves here as a hash.
   Nothing stores the plaintext, so the dashboard says it once and cannot be
   asked again — rebuilding with a new one is the way back. */
app.get('/api/admin/demo', requireAdmin, wrap(async (req, res) => {
  res.json(await demoStatus());
}));

app.post('/api/admin/demo', requireSuper, wrap(async (req, res) => {
  const password = String((req.body || {}).password || '');
  const existing = await demoStatus();
  // Only a first build insists on one: a rebuild that leaves the password
  // alone is how the log is refreshed without invalidating what was handed out.
  if (!existing.exists && password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  if (password && password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  if (password.length > 400) return res.status(400).json({ error: 'Password is too long.' });
  try {
    res.json({ ok: true, ...(await buildDemo({ password: password || null })) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.delete('/api/admin/demo', requireSuper, wrap(async (req, res) => {
  res.json({ ok: true, ...(await removeDemo()) });
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
  paypalClientId: PAYPAL_CLIENT_ID || null,
  aiEstimates: aiConfigured(),
  voiceAgent: voiceConfigured('log'),
  voiceAskAgent: voiceConfigured('ask'),
  /* The key is the browser's half of subscribing and is not a secret — it is
     what ties a subscription to this server rather than any other. Null when
     push is not set up, which is what the app reads to decide whether to offer
     reminders at all. */
  pushKey: pushPublicKey()
}));

/* A ticket to one voice conversation.

   POST rather than GET because it is not a read: with a key set it mints a
   short-lived signed URL at ElevenLabs, and a URL somebody can mint by visiting
   a link is a URL a prefetcher can mint.

   Rated tightly. Every session started is metered conversation time on somebody
   else's bill, so a loop that reconnects on error — which is the shape every
   connection bug takes — has a ceiling on what it can spend before it stops. */
app.post('/api/voice/session', requireUser, wrap(async (req, res) => {
  // Which of the two: the one that writes entries, or the one that answers
  // questions about them. Anything unrecognised is the logging one.
  const kind = (req.body && req.body.agent) === 'ask' ? 'ask' : 'log';
  if (!voiceConfigured(kind)) return res.status(503).json({ error: 'The voice agent is not set up on this server.' });
  /* One ceiling across both, deliberately. The cost is conversation minutes on
     somebody else's bill either way, and two counters would be twice the
     spend for a loop that found whichever one was emptier. */
  const limited = rateLimit({ key: `voice:${req.user.id}`, limit: 40, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `That is a lot of conversations. Try again ${retryLabel(limited.retryAfterMs)}.` });
  try {
    res.json(await voiceSession(kind));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not start a voice session.' });
  }
}));

/* ── reminders ──

   One notification a day per browser, at an hour that browser chose, about what
   that day holds. See remind.js for what it says and why it sometimes says
   nothing at all.

   Everything here is keyed on the endpoint the push service handed the browser.
   It is the subscription's identity, it is not guessable, and it is not a
   credential for anything else — but it is the ability to interrupt somebody,
   so a request may only ever touch a row belonging to the account making it. */
const endpointId = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex');

/* What the browser sends is what the PushManager gave it, unchanged. It is
   validated rather than trusted: an endpoint has to be an https URL, and the
   two keys have to be the sizes the encryption needs, or every send to this row
   would fail later with nothing to point at.

   The clock comes over on the same call, because the browser is the only thing
   that knows what time it is where the person is. */
function readSubscription(body) {
  const b = body || {};
  const endpoint = String(b.endpoint || '').trim();
  const keys = b.keys || {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 512) return { error: 'That is not a push endpoint.' };
  if (Buffer.from(p256dh, 'base64url').length !== 65) return { error: 'The browser sent an unusable key.' };
  if (Buffer.from(auth, 'base64url').length !== 16) return { error: 'The browser sent an unusable secret.' };
  /* Clamped rather than rejected. A minute outside the day or an offset outside
     the ones that exist is a clock this server cannot argue with, and refusing
     the subscription over it would turn a strange timezone into no reminders. */
  const at = Math.min(24 * 60 - 1, Math.max(0, Math.round(Number(b.at)) || 0));
  const tz = Math.min(840, Math.max(-720, Math.round(Number(b.tz)) || 0));
  return { endpoint, p256dh, auth, at, tz };
}

app.post('/api/push/subscribe', requireUser, wrap(async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Reminders are not set up on this server.' });
  const sub = readSubscription(req.body);
  if (sub.error) return res.status(400).json({ error: sub.error });
  const t = now();
  /* An upsert on the endpoint, so re-subscribing on a browser that already had
     permission moves the row rather than making a second one — and so a device
     handed on to somebody else follows the account that subscribed last.

     last_date is deliberately not cleared: somebody who changes the hour at
     noon, having already had today's reminder, is asking about tomorrow. */
  await query(
    `INSERT INTO push_subs (user_id, endpoint, endpoint_id, p256dh, auth, at_min, tz_offset, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint),
       p256dh = VALUES(p256dh), auth = VALUES(auth), at_min = VALUES(at_min),
       tz_offset = VALUES(tz_offset), fails = 0, updated_at = VALUES(updated_at)`,
    [req.user.id, sub.endpoint, endpointId(sub.endpoint), sub.p256dh, sub.auth, sub.at, sub.tz, t, t]);
  res.json({ ok: true, at: sub.at });
}));

app.post('/api/push/unsubscribe', requireUser, wrap(async (req, res) => {
  const endpoint = String((req.body || {}).endpoint || '').trim();
  if (!endpoint) return res.status(400).json({ error: 'No subscription named.' });
  await query('DELETE FROM push_subs WHERE user_id = ? AND endpoint_id = ?',
    [req.user.id, endpointId(endpoint)]);
  res.json({ ok: true });
}));

/* One notification, now, to the device asking for it.

   This exists because everything about push fails silently. Permission can be
   granted and the worker still not registered; a key can be right and the
   subject rejected; a phone can be in a battery mode that holds notifications
   until it is unlocked. A button that either produces a notification or names
   the refusal turns all of that into one answer. */
app.post('/api/push/test', requireUser, wrap(async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Reminders are not set up on this server.' });
  const endpoint = String((req.body || {}).endpoint || '').trim();
  const row = endpoint && await one(
    'SELECT * FROM push_subs WHERE user_id = ? AND endpoint_id = ?', [req.user.id, endpointId(endpoint)]);
  if (!row) return res.status(404).json({ error: 'This browser is not subscribed.' });
  const limited = rateLimit({ key: `push-test:${req.user.id}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return res.status(429).json({ error: `That is a lot of tests. Try again ${retryLabel(limited.retryAfterMs)}.` });

  const day = await dayAhead(req.user.id, localDate(row.tz_offset), req.user.currency);
  const out = await sendPush(row, composeTest(day));
  if (out.gone) await query('DELETE FROM push_subs WHERE id = ?', [row.id]);
  if (!out.ok) return res.status(502).json({ error: out.error || 'The push service would not take it.' });
  res.json({ ok: true });
}));

/* ── the round ──

   Called by a scheduler, not by a person: cPanel's cron, every ten minutes.
   Guarded by a shared secret rather than a session, because there is nobody
   signed in at four in the morning.

   It walks every subscription, works out what time it is on that device, and
   sends to the ones whose chosen minute has passed and who have not already had
   today's. Which means the cron's interval sets the lateness and nothing else:
   run it hourly and a reminder set for 08:00 arrives some time before 09:00. */
const PUSH_CRON_SECRET = (process.env.PUSH_CRON_SECRET || '').trim();
/* How late a reminder may be and still be worth sending. A server that was down
   from seven until noon should not greet everybody with a reminder about a
   morning that has gone; it should skip them and be on time tomorrow. */
const PUSH_LATE_MIN = Number(process.env.PUSH_LATE_MIN) || 120;

app.post('/api/push/run', wrap(async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Reminders are not set up on this server.' });
  if (!PUSH_CRON_SECRET) return res.status(503).json({ error: 'PUSH_CRON_SECRET is not set.' });
  const given = String(req.get('X-Zimpan-Cron') || (req.query && req.query.key) || '');
  /* Compared in constant time, and only once the lengths match — timingSafeEqual
     throws on a mismatch, which would itself be a timing signal. */
  const ok = given.length === PUSH_CRON_SECRET.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PUSH_CRON_SECRET));
  if (!ok) return res.status(404).json({ error: 'No such endpoint.' });

  const at = Date.now();
  const rows = await query(
    `SELECT p.*, u.currency FROM push_subs p JOIN users u ON u.id = p.user_id ORDER BY p.id`);
  let sent = 0, quiet = 0, dropped = 0, failed = 0;

  for (const row of rows) {
    const date = pushDue(row, at, PUSH_LATE_MIN);
    if (!date) continue;

    const note = composeReminder(await dayAhead(row.user_id, date, row.currency));
    if (!note) {
      /* Marked as done for the day even though nothing went out, so a quiet
         morning is not re-examined every ten minutes until lunchtime. */
      quiet++;
      await query('UPDATE push_subs SET last_date = ? WHERE id = ?', [date, row.id]);
      continue;
    }
    const out = await sendPush(row, note);
    if (out.ok) {
      sent++;
      await query('UPDATE push_subs SET last_date = ?, fails = 0 WHERE id = ?', [date, row.id]);
    } else if (out.gone) {
      dropped++;
      await query('DELETE FROM push_subs WHERE id = ?', [row.id]);
    } else {
      failed++;
      /* Three bad days in a row and the row goes. Not on the first: a push
         service having an outage is not a person who uninstalled the app. */
      const fails = Number(row.fails || 0) + 1;
      if (fails >= 3) await query('DELETE FROM push_subs WHERE id = ?', [row.id]);
      else await query('UPDATE push_subs SET fails = ? WHERE id = ?', [fails, row.id]);
      console.error(`[zimpan] push to subscription ${row.id} failed: ${out.error}`);
    }
  }
  res.json({ ok: true, considered: rows.length, sent, quiet, dropped, failed });
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

/* The whole team's hours over a window, for the spreadsheet an admin builds a
   timesheet or an invoice from. JSON rather than a text/csv response: the
   client already knows how to write a CSV — it writes two of them for the
   personal log — and one place that knows the format is better than two that
   can disagree about quoting. */
app.get('/api/team/export', requireUser, team((req) =>
  teamHoursExport(req.user.id, req.query.from, req.query.to).then((rows) => ({ rows }))));

/* The browser reporting a subscription PayPal has just approved, so the money
   and the team are written down in the same place. It grants nothing — see
   recordSubscription() — and only an owner may call it. */
app.post('/api/team/subscription', requireUser, team((req) => {
  const b = req.body || {};
  return recordSubscription(req.user.id, b.subscription, b.plan);
}));

app.get('/api/team/subscriptions', requireUser, team((req) =>
  teamSubscriptions(req.user.id).then((rows) => ({ rows }))));

/* What was done to this team's records, and by whom. requireUser and nothing
   more: every member may read it, which is the point of keeping it. */
app.get('/api/team/audit', requireUser, team((req) =>
  teamAudit(req.user.id, { limit: req.query.limit, before: req.query.before })));

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
  return setTeamPlan(b.teamId, b.plan, { email: req.user.email });
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
   a route that is not in it is the 404 below however real the page is.

   It arrives filled in, though. This is the product's shop window: it is meant
   to be searched for, linked to and unfurled in a chat, and all three read the
   markup they are served rather than the page a browser eventually builds. So
   the head is replaced with the page's own, and the body carries a plain
   reading of it — which app.js throws away on its first render, long before
   anybody looks. See teamspage.js.

   A failure to read the file falls back to sending it untouched, the same way
   the blog routes do: an unfilled page is a page, and no page is not. */
app.get('/teams', wrap(async (req, res) => {
  const file = join(ROOT, 'index.html');
  let html;
  try { html = await readFile(file, 'utf8'); } catch (err) { return res.sendFile(file); }
  res.type('html').send(swapHead(html, teamsHead())
    .replace('<div id="app"></div>', `<div id="app">${teamsPrerender()}</div>`));
}));
app.get('/blogs', wrap(async (req, res) => {
  const file = join(ROOT, 'index.html');
  let html;
  try { html = await readFile(file, 'utf8'); } catch (err) { return res.sendFile(file); }
  const title = 'Read articles about time, money, tasks, and self management — the ZIMPAN blog';
  const desc = 'Plain writing on productivity, financial freedom, and running your time '
    + 'and money like they belong to you.';
  const head = [
    `<title>${htmlAttr(title)}</title>`,
    `<meta name="description" content="${htmlAttr(desc)}">`,
    `<link rel="canonical" href="https://zimpan.com/blogs">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${htmlAttr(title)}">`,
    `<meta property="og:description" content="${htmlAttr(desc)}">`,
    `<meta property="og:url" content="https://zimpan.com/blogs">`
  ].join('\n  ');
  res.type('html').send(swapHead(html, head));
}));

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
     and a crawler picks the first, which would be the app's. See swapHead()
     for the rest of the head. */
  res.type('html').send(swapHead(html, head));
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

/* The two files that make this installable.

   Named routes like everything else at the root. The worker is served from the
   root deliberately: a service worker may only control what sits at or below
   its own path, and this one has to answer for the whole site.

   It is also the one file that must never be held in a browser cache for long.
   A worker cached for a day is a worker that cannot be replaced for a day -
   including a worker with a bug in it - so it is asked for every time. */
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(join(ROOT, 'manifest.webmanifest'));
});
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(join(ROOT, 'sw.js'));
});

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

/* ── the 502 that never reaches this log ──

   Node hangs up on an idle keep-alive connection after five seconds. The proxy
   in front of this app — nginx, then Passenger — holds those connections open
   and reuses them, and its own idle timeout is far longer than five seconds.
   So the proxy is routinely holding a socket this app has already decided to
   close, and a request sent down it in the moment between that decision and
   the FIN arriving lands on a reset. The proxy has no request to retry and no
   app to blame, so it answers 502.

   Every symptom follows from that. It is intermittent, because it needs the
   request to fall inside a window of milliseconds. It is commonest on a quiet
   site, where connections sit idle long enough to reach the timeout at all.
   It always clears on a retry, because the retry opens a fresh connection.
   And nothing appears below in stderr.log, because this process never saw the
   request — which is why a 502 with a silent log points here rather than at
   anything the app did.

   The rule is that whatever sits behind the proxy must hang up last. 76
   seconds clears nginx's default keepalive_timeout of 75. headersTimeout has
   to be longer again, or the socket can be closed while a request line is
   still on its way in — which would trade this bug for a rarer one. Both are
   settable, because the proxy in front is not this app's to know. */
server.keepAliveTimeout = Number(process.env.KEEPALIVE_MS) || 76000;
server.headersTimeout = Number(process.env.HEADERS_MS) || 80000;

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
