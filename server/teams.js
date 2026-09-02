/* ── teams ──

   A team login is separate from a personal one, so nothing personal lives on
   this side: no meals, no sleep, no money. What a team holds is hours against
   projects and who may touch them.

   Two rules carry the whole design, and every function here is written so that
   breaking one of them requires deleting a line rather than forgetting one:

   1. The team is read from the caller's own membership row, never from the
      request. A caller cannot name a team and be believed, so there is no
      shape of request that reaches another team's data.

   2. An entry is visible to an admin only if it carries a project. That is the
      privacy line the product promises, expressed as a predicate on the row
      itself rather than as a filter someone has to remember to apply — see
      ADMIN_ENTRY_WHERE, which is the only way this file reads entries. */

import crypto from 'node:crypto';
import { query, one, now } from './db.js';

export class TeamError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

/* ── plans ──
   Set by hand once payment clears: there is no webhook, by design, and a plan
   nobody has paid for is the trial. `cap` 0 is the unlimited plan. */
export const PLANS = {
  trial: { label: 'Trial', cap: 3, price: 0 },
  team6: { label: 'Team of 6', nickname: 'Starter', cap: 6, price: 9, paypal: 'L2TA54N2MGAEC' },
  team12: { label: 'Team of 12', nickname: 'Squad', cap: 12, price: 15, paypal: 'LWSN5Y8ETFSSJ' },
  team20: { label: 'Team of 20', nickname: 'Business', cap: 20, price: 22, paypal: 'NYRHVDWH6SXN8' },
  team50: { label: 'Team of 50', nickname: 'Max', cap: 50, price: 30, paypal: 'AZBJMFGCVEK98' },
  unlimited: { label: 'Unlimited', nickname: 'Unlimited', cap: 0, price: 100, paypal: 'C7ZHCA5ZMUG8G' }
};

/* ── the trial, and what running out of it means ──

   Fourteen days from the day the team is made. Billing is reconciled by hand,
   so an expiry that locked people out of their own hours would punish a team
   for the time it takes somebody to match a PayPal receipt to a team name —
   and their hours are their work record, not a hostage.

   So an expired trial stops the team from being a team: no inviting, no new
   projects, no reading anyone else's hours, no dashboard. Everyone keeps
   logging their own time and reading their own cards, and nothing is deleted.
   Setting any paid plan makes all of it work again, whenever that happens. */
export const TRIAL_DAYS = 14;

export const TRIAL_OVER =
  'Your trial has ended. Subscribe to a plan and your team is back to normal — nothing has been lost, and everyone can still log their own hours.';

/* 'active' once anything has been paid for, whatever the dates say — a plan
   set by hand is the record of payment, and it outranks the clock. */
export function teamStatus(team) {
  if (!team) return 'none';
  if (team.plan && team.plan !== 'trial') return 'active';
  const ends = Number(team.trialEndsAt || team.trial_ends_at || 0);
  if (!ends) return 'trial';
  return now() < ends ? 'trial' : 'expired';
}

export const ROLES = ['super', 'admin', 'member'];

/* What a new team starts with. Named for the shape of a working week rather
   than for anything clever — "Project 1" is meant to be renamed, and its being
   obviously a placeholder is the instruction. */
export const DEFAULT_PROJECTS = [
  ['Admin Works', '#7856f5'],
  ['Project 1', '#0e9f6e'],
  ['Break Time', '#e9a13b'],
  ['Meetings', '#4f46e5']
];
const RANK = { super: 3, admin: 2, member: 1 };

/* ── the pure rules ──
   Separated from the queries deliberately: these are the decisions worth
   testing exhaustively, and they need no database to be wrong in. */

export const atLeast = (role, needed) => (RANK[role] || 0) >= (RANK[needed] || 99);

/* Who may hand out which role. A super runs the team and can make admins; an
   admin can bring in members and no more — an admin who could mint admins
   could mint one who removes them, which is not a hierarchy. */
export function canGrant(actorRole, targetRole) {
  if (targetRole === 'super') return false;      // ownership transfers by its own route
  if (targetRole === 'admin') return actorRole === 'super';
  if (targetRole === 'member') return atLeast(actorRole, 'admin');
  return false;
}

/* Who may act on whom. Nobody may act on someone at or above their own rank,
   which stops an admin removing another admin or the owner. Acting on
   yourself is a separate question every caller answers for itself. */
export const canActOn = (actorRole, targetRole) => (RANK[actorRole] || 0) > (RANK[targetRole] || 0);

export const capFor = (plan) => (PLANS[plan] || PLANS.trial).cap;

/* Room for one more? An unlimited plan always has room; every other plan is
   counted against seats already taken plus invitations still outstanding,
   because an invitation is a seat somebody is holding. */
export function hasSeat(plan, members, pendingInvites) {
  const cap = capFor(plan);
  if (!cap) return true;
  return (Number(members) || 0) + (Number(pendingInvites) || 0) < cap;
}

/* The only fields an admin may change on someone else's entry: when it was,
   what it was, and which project it belongs to. Not the note — a note is the
   member's own words — and not the id, the owner or the team. */
export const ADMIN_EDITABLE = ['date', 'from', 'to', 'activity', 'project'];

export function cleanEntryPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if (typeof patch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) out.date = patch.date;
  for (const k of ['from', 'to']) {
    if (patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isInteger(n) || n < 0 || n > 1439) throw new TeamError(`${k} must be a minute of the day.`);
    out[k] = n;
  }
  if (typeof patch.activity === 'string') {
    const a = patch.activity.trim();
    if (!a) throw new TeamError('An entry needs a name.');
    out.activity = a.slice(0, 200);
  }
  /* A project may be moved to another project, never cleared: clearing it
     would turn a team entry into a personal one and carry it out of the
     admin's reach — and out of the team's records — in a single edit. */
  if (patch.project !== undefined) {
    const p = String(patch.project || '').trim();
    if (!p) throw new TeamError('An entry has to stay on a project.');
    out.project = p.slice(0, 64);
  }
  return out;
}

export const normaliseEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 190);
export const validEmail = (e) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(normaliseEmail(e));

const newId = () => crypto.randomBytes(16).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const INVITE_DAYS = 14;

/* ── the predicate the whole privacy promise rests on ──
   Every read and every write of a member's entry in this file goes through it.
   An entry with no project is personal, and personal is not the team's. */
const ADMIN_ENTRY_WHERE = 'team_id = ? AND project_id IS NOT NULL AND deleted = 0';

/* ── the wall between the two products ──

   A personal account cannot become a team account. Not "should not" — the two
   are different products with different subjects, and an account that has been
   somebody's diary is the wrong vessel for their employer's records. The one
   moment a kind is decided is sign-up, so joining a team means signing up
   again with a work address.

   Read from the database rather than from the session, because this is the
   check the whole separation rests on and a stale session is a bad reason to
   let an account through. */
export const WORK_ACCOUNT_NEEDED =
  'Zimpan for Teams needs its own account. Sign up again with your work email — a personal Zimpan cannot become a team one.';

export async function requireWorkAccount(userId) {
  const row = await one('SELECT kind FROM users WHERE id = ?', [userId]);
  if (!row) throw new TeamError('No such account.', 404);
  if (row.kind !== 'work') throw new TeamError(WORK_ACCOUNT_NEEDED, 409);
  return true;
}

/* ── membership ──
   The first call of every route. It answers "who is this, and in whose team",
   and it is the only place a team id enters the request. */
export async function membershipFor(userId) {
  if (!userId) return null;
  return one(
    `SELECT tm.team_id AS teamId, tm.role, t.name, t.plan, t.seat_cap AS seatCap, t.trial_ends_at AS trialEndsAt
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?`, [userId]);
}

async function requireMembership(userId, needed) {
  const m = await membershipFor(userId);
  if (!m) throw new TeamError('You are not in a team.', 403);
  if (needed && !atLeast(m.role, needed)) throw new TeamError('That is not yours to do.', 403);
  return m;
}

/* For the things a team does as a team. Reading and logging your own hours
   never comes through here — that is yours whatever the billing says. */
async function requireLive(userId, needed) {
  const m = await requireMembership(userId, needed);
  if (teamStatus(m) === 'expired') throw new TeamError(TRIAL_OVER, 402);
  return m;
}

const countMembers = async (teamId) =>
  (await one('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', [teamId])).n;

const countPending = async (teamId) =>
  (await one('SELECT COUNT(*) AS n FROM team_invites WHERE team_id = ? AND accepted_at IS NULL AND expires_at > ?',
    [teamId, now()])).n;

/* ── creating one ──
   Whoever creates it owns it. A user already in a team cannot create a second:
   a work login belongs to one workplace. */
export async function createTeam(userId, name) {
  await requireWorkAccount(userId);
  const existing = await membershipFor(userId);
  if (existing) throw new TeamError('You are already in a team.', 409);
  const clean = String(name || '').trim().slice(0, 120);
  if (!clean) throw new TeamError('A team needs a name.');

  const id = newId();
  const t = now();
  await query(
    'INSERT INTO teams (id, name, plan, seat_cap, trial_ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, clean, 'trial', capFor('trial'), t + TRIAL_DAYS * 86400000, t, t]);
  await query('INSERT INTO team_members (team_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, 'super', t, t]);

  /* Something to log against from the first minute. An empty team is a timer
     with nowhere to put the hour, and the first thing anybody does is start
     the timer — so the four a working week actually divides into are there,
     ready to be renamed into whatever this team calls them. */
  for (let i = 0; i < DEFAULT_PROJECTS.length; i++) {
    const [name, color] = DEFAULT_PROJECTS[i];
    await query(
      'INSERT INTO team_projects (team_id, id, name, color, position, archived, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 0, ?, 0)',
      [id, newId(), name, color, i, t]);
  }

  return { id, name: clean, plan: 'trial', role: 'super' };
}

/* Everything the caller is allowed to know about their own team. Members see
   the roster too — knowing who you work with is not a privilege — but nothing
   about what anyone logged. */
export async function teamOverview(userId) {
  const m = await requireMembership(userId);
  const members = await query(
    `SELECT tm.user_id AS userId, tm.role, tm.joined_at AS joinedAt, u.email, u.display_name AS name
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY FIELD(tm.role, 'super', 'admin', 'member'), u.email`, [m.teamId]);
  const projects = await query(
    'SELECT id, name, color, position, archived FROM team_projects WHERE team_id = ? AND deleted = 0 ORDER BY position, name',
    [m.teamId]);
  /* Outstanding invitations are an admin's business: they are seats in use,
     and a member seeing a list of who has been asked to join is a small leak
     for no benefit. */
  const invites = atLeast(m.role, 'admin')
    ? await query('SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt FROM team_invites WHERE team_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
      [m.teamId, now()])
    : [];

  const plan = PLANS[m.plan] || PLANS.trial;
  const status = teamStatus(m);
  const ends = Number(m.trialEndsAt || 0);
  return {
    team: {
      id: m.teamId, name: m.name, plan: m.plan, planLabel: plan.label, seatCap: plan.cap,
      status,
      trialEndsAt: ends || null,
      // Floored at zero rather than going negative, which reads as nonsense.
      trialDaysLeft: status === 'trial' && ends ? Math.max(0, Math.ceil((ends - now()) / 86400000)) : 0
    },
    me: { userId, role: m.role },
    members, projects, invites,
    seatsUsed: members.length + invites.length
  };
}

/* ── invitations ──
   The only door into a team. Returns the token so the caller can put it in the
   email; only its hash is stored, so a leaked table is not a set of keys. */
export async function inviteMember(userId, email, role) {
  const m = await requireLive(userId, 'admin');
  const want = ROLES.includes(role) ? role : 'member';
  if (!canGrant(m.role, want)) throw new TeamError('That is not yours to grant.', 403);

  const addr = normaliseEmail(email);
  if (!validEmail(addr)) throw new TeamError('That does not look like an email address.');

  const already = await one(
    `SELECT tm.user_id FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? AND u.email = ?`, [m.teamId, addr]);
  if (already) throw new TeamError('They are already on this team.', 409);

  if (!hasSeat(m.plan, await countMembers(m.teamId), await countPending(m.teamId))) {
    throw new TeamError(`Your plan covers ${capFor(m.plan)} people. Move up a plan to add more.`, 409);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  const id = newId();
  /* Re-inviting replaces rather than adds: two live invitations for one
     address is two seats held for one person, and the older token would go on
     working after the newer one was sent. */
  await query(
    `INSERT INTO team_invites (id, team_id, email, role, token_hash, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = VALUES(id), role = VALUES(role), token_hash = VALUES(token_hash),
       invited_by = VALUES(invited_by), created_at = VALUES(created_at), expires_at = VALUES(expires_at),
       accepted_at = NULL`,
    [id, m.teamId, addr, want, hashToken(token), userId, t, t + INVITE_DAYS * 86400000]);

  /* The team's name and the inviter's address go back with the token, because
     the letter needs them and the route has neither: membershipFor is the only
     thing that knows which team this is, and it is called in here. */
  const asker = await one('SELECT email FROM users WHERE id = ?', [userId]);
  return {
    email: addr, role: want, token,
    expiresAt: t + INVITE_DAYS * 86400000,
    team: m.name, from: asker ? asker.email : '', days: INVITE_DAYS
  };
}

/* ── sending it again ──

   The first send can fail for reasons nobody sees: no SMTP configured, a
   mailbox that bounced, a spam filter. Without this the only remedy is to
   revoke and re-invite, which is two steps that both look like mistakes.

   A fresh token every time, replacing the old one. Re-sending the same link
   would be friendlier to somebody who kept the first email, but it would also
   mean an invitation that leaked once stays valid forever — and the person who
   needs a resend is by definition the one who never got the first.

   No seat check: the seat is already held by the pending row, and refusing to
   resend an invitation the team is already paying for would be absurd. */
export async function resendInvite(userId, email) {
  const m = await requireLive(userId, 'admin');
  const addr = normaliseEmail(email);
  const inv = await one(
    'SELECT id, role, accepted_at AS acceptedAt FROM team_invites WHERE team_id = ? AND email = ?',
    [m.teamId, addr]);
  if (!inv) throw new TeamError('There is no invitation for that address.', 404);
  if (inv.acceptedAt) throw new TeamError('They have already joined.', 409);

  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  await query(
    `UPDATE team_invites SET token_hash = ?, created_at = ?, expires_at = ?, invited_by = ?
      WHERE team_id = ? AND email = ?`,
    [hashToken(token), t, t + INVITE_DAYS * 86400000, userId, m.teamId, addr]);

  const asker = await one('SELECT email FROM users WHERE id = ?', [userId]);
  return {
    email: addr, role: inv.role, token,
    expiresAt: t + INVITE_DAYS * 86400000,
    team: m.name, from: asker ? asker.email : '', days: INVITE_DAYS
  };
}

export async function revokeInvite(userId, email) {
  const m = await requireMembership(userId, 'admin');
  await query('DELETE FROM team_invites WHERE team_id = ? AND email = ?', [m.teamId, normaliseEmail(email)]);
  return { ok: true };
}

/* Accepting binds the invitation to the signed-in account. The address on the
   invitation has to be the address on the account: an invitation forwarded to
   somebody else is not a way in. */
export async function acceptInvite(userId, userEmail, token) {
  await requireWorkAccount(userId);
  const existing = await membershipFor(userId);
  if (existing) throw new TeamError('You are already in a team.', 409);

  const inv = await one(
    'SELECT id, team_id AS teamId, email, role, expires_at AS expiresAt, accepted_at AS acceptedAt FROM team_invites WHERE token_hash = ?',
    [hashToken(token || '')]);
  if (!inv || inv.acceptedAt) throw new TeamError('That invitation is not valid.', 404);
  if (inv.expiresAt < now()) throw new TeamError('That invitation has expired. Ask for another.', 410);
  if (normaliseEmail(userEmail) !== inv.email) {
    throw new TeamError('That invitation was sent to a different address.', 403);
  }

  // The cap is checked again here: seats can fill between sending and accepting.
  const team = await one('SELECT plan FROM teams WHERE id = ?', [inv.teamId]);
  if (!team) throw new TeamError('That team no longer exists.', 404);
  if (!hasSeat(team.plan, await countMembers(inv.teamId), 0)) {
    throw new TeamError('That team is full.', 409);
  }

  const t = now();
  await query('INSERT INTO team_members (team_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [inv.teamId, userId, inv.role, t, t]);
  await query('UPDATE team_invites SET accepted_at = ? WHERE id = ?', [t, inv.id]);
  return { teamId: inv.teamId, role: inv.role };
}

/* ── roles ──
   Only the owner moves people between roles, and the team can never be left
   without an owner. */
export async function setMemberRole(userId, targetUserId, role) {
  const m = await requireMembership(userId, 'super');
  if (!ROLES.includes(role)) throw new TeamError('That is not a role.');
  if (Number(targetUserId) === Number(userId)) throw new TeamError('You cannot change your own role.', 409);

  const target = await one('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', [m.teamId, targetUserId]);
  if (!target) throw new TeamError('They are not on this team.', 404);
  if (role === 'super') throw new TeamError('Transfer ownership rather than adding a second owner.', 409);
  if (!canGrant(m.role, role)) throw new TeamError('That is not yours to grant.', 403);

  await query('UPDATE team_members SET role = ?, updated_at = ? WHERE team_id = ? AND user_id = ?',
    [role, now(), m.teamId, targetUserId]);
  return { userId: Number(targetUserId), role };
}

export async function removeMember(userId, targetUserId) {
  const m = await requireMembership(userId, 'admin');
  if (Number(targetUserId) === Number(userId)) throw new TeamError('Leave the team rather than removing yourself.', 409);

  const target = await one('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', [m.teamId, targetUserId]);
  if (!target) throw new TeamError('They are not on this team.', 404);
  if (!canActOn(m.role, target.role)) throw new TeamError('That is not yours to do.', 403);

  /* Their hours stay. A team's record of what a project cost should not change
     because somebody left, so the rows are unhooked from the person rather
     than deleted — team_id and project survive, the membership does not. */
  await query('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [m.teamId, targetUserId]);
  return { ok: true };
}

/* ── projects ── */
export async function saveProject(userId, project) {
  const m = await requireLive(userId, 'admin');
  const name = String((project && project.name) || '').trim().slice(0, 120);
  if (!name) throw new TeamError('A project needs a name.');
  const id = String((project && project.id) || '').trim().slice(0, 64) || newId();
  const color = /^#[0-9a-f]{6}$/i.test((project && project.color) || '') ? project.color : null;
  const position = Number.isFinite(Number(project && project.position)) ? Number(project.position) : 0;
  const archived = project && project.archived ? 1 : 0;

  await query(
    `INSERT INTO team_projects (team_id, id, name, color, position, archived, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name), color = VALUES(color), position = VALUES(position),
       archived = VALUES(archived), updated_at = VALUES(updated_at), deleted = 0`,
    [m.teamId, id, name, color, position, archived, now()]);
  return { id, name, color, position, archived: !!archived };
}

export async function deleteProject(userId, projectId) {
  const m = await requireLive(userId, 'admin');
  /* Buried rather than dropped, like every other row this app deletes: the
     hours logged against it are still real, and a project row that vanishes
     turns them into time nobody can account for. */
  const res = await query('UPDATE team_projects SET deleted = 1, updated_at = ? WHERE team_id = ? AND id = ?',
    [now(), m.teamId, String(projectId || '')]);
  if (!res.affectedRows) throw new TeamError('No such project.', 404);
  return { ok: true };
}

/* ── a member's hours ──
   Both of these read through ADMIN_ENTRY_WHERE and nothing else. */
export async function memberEntries(userId, targetUserId, from, to) {
  const m = await requireLive(userId, 'admin');
  const target = await one('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', [m.teamId, targetUserId]);
  if (!target) throw new TeamError('They are not on this team.', 404);

  return query(
    `SELECT id, user_id AS userId, date, activity, from_min AS \`from\`, to_min AS \`to\`, project_id AS project, updated_at AS updatedAt
       FROM entries
      WHERE ${ADMIN_ENTRY_WHERE} AND user_id = ? AND date BETWEEN ? AND ?
      ORDER BY date DESC, from_min`,
    [m.teamId, targetUserId, String(from || '0000-01-01'), String(to || '9999-12-31')]);
}

/* ── who is working right now ──

   An admin's view of the team as it stands this minute: who has a timer
   running, on what, since when, and what each person has already logged today.

   Three rules hold it to the same line everything else in this file is on.

   The timer is a single row on `users` — the same one sync.js reads back to
   its owner — so the only thing this adds is who may look at it. The project
   is resolved against the team's own list rather than trusted from the row: a
   timer started before the account joined, or against a category that is not a
   project, is work this team has no claim to see, so it reports as running
   without naming what it is on.

   Today's entries come through ADMIN_ENTRY_WHERE like every other admin read,
   which is what keeps a personal entry out of it — an entry with no project_id
   is not the team's, whoever logged it.

   And notes never leave the database. cleanEntryPatch already refuses to write
   one; this refuses to read one. What a member wrote to themselves about an
   hour is not part of the hour. */
export async function teamNow(userId, todayIso) {
  const m = await requireLive(userId, 'admin');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || '')) ? String(todayIso) : null;
  if (!day) throw new TeamError('A date is needed.');

  const rows = await query(
    `SELECT tm.user_id AS userId, tm.role, u.email, u.display_name AS name,
            u.timer_start AS timerStart, u.timer_cat AS timerCat, u.timer_activity AS timerActivity
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY FIELD(tm.role, 'super', 'admin', 'member'), u.email`, [m.teamId]);

  const entries = await query(
    `SELECT id, user_id AS userId, activity, from_min AS \`from\`, to_min AS \`to\`, project_id AS project
       FROM entries
      WHERE ${ADMIN_ENTRY_WHERE} AND date = ?
      ORDER BY user_id, from_min`, [m.teamId, day]);

  const projects = await query(
    'SELECT id, name, color FROM team_projects WHERE team_id = ? AND deleted = 0', [m.teamId]);
  const byId = new Map(projects.map((p) => [String(p.id), p]));
  const byName = new Map(projects.map((p) => [p.name, p]));

  const timeline = new Map();
  entries.forEach((e) => {
    const list = timeline.get(e.userId) || [];
    const p = byId.get(String(e.project));
    list.push({
      id: e.id, activity: e.activity, from: Number(e.from), to: Number(e.to),
      project: p ? p.name : null, color: p ? p.color : null
    });
    timeline.set(e.userId, list);
  });

  const at = now();
  return {
    at,
    date: day,
    members: rows.map((r) => {
      const started = Number(r.timerStart) || 0;
      /* Only a project this team owns is named. Anything else is a timer
         running on something that is not the team's business, and saying so is
         the honest half of the answer. */
      const onProject = started && r.timerCat ? byName.get(r.timerCat) || null : null;
      const list = timeline.get(r.userId) || [];
      return {
        userId: r.userId, role: r.role, email: r.email, name: r.name,
        running: !!started,
        // Clamped at zero: a clock a few seconds ahead should not read as
        // having started in the future.
        since: started || null,
        elapsedMin: started ? Math.max(0, Math.round((at - started) / 60000)) : 0,
        activity: started ? (r.timerActivity || '') : '',
        project: onProject ? onProject.name : null,
        color: onProject ? onProject.color : null,
        offTeam: !!started && !onProject,
        loggedMin: list.reduce((a, e) => a + (e.to >= e.from ? e.to - e.from : e.to + 1440 - e.from), 0),
        timeline: list
      };
    })
  };
}

export async function editMemberEntry(userId, entryId, patch) {
  const m = await requireLive(userId, 'admin');
  const fields = cleanEntryPatch(patch);
  if (!Object.keys(fields).length) throw new TeamError('Nothing to change.');

  const row = await one(`SELECT user_id AS userId FROM entries WHERE ${ADMIN_ENTRY_WHERE} AND id = ?`,
    [m.teamId, String(entryId || '')]);
  if (!row) throw new TeamError('No such entry on this team.', 404);

  if (fields.project) {
    const p = await one('SELECT id FROM team_projects WHERE team_id = ? AND id = ? AND deleted = 0',
      [m.teamId, fields.project]);
    if (!p) throw new TeamError('No such project on this team.', 404);
  }

  const col = { date: 'date', from: 'from_min', to: 'to_min', activity: 'activity', project: 'project_id' };
  const sets = Object.keys(fields).map((k) => `${col[k]} = ?`).concat('updated_at = ?');
  const args = Object.keys(fields).map((k) => fields[k]).concat(now(), m.teamId, String(entryId));
  /* The team id is in the WHERE of the write as well as the read. A check that
     happened only on the way in is a check that stops being true the moment
     anything runs between the two. */
  await query(`UPDATE entries SET ${sets.join(', ')} WHERE ${ADMIN_ENTRY_WHERE} AND id = ?`, args);
  return { id: String(entryId), ...fields };
}

/* ── the owner's dashboard ──
   Hours by project and hours by person, over a window. Nothing but hours. */
export async function teamDashboard(userId, from, to) {
  const m = await requireLive(userId, 'super');
  const range = [m.teamId, String(from || '0000-01-01'), String(to || '9999-12-31')];

  const byProject = await query(
    `SELECT p.id, p.name, p.color, COALESCE(SUM(e.to_min - e.from_min), 0) AS minutes, COUNT(e.id) AS entries
       FROM team_projects p
       LEFT JOIN entries e ON e.project_id = p.id AND e.team_id = p.team_id AND e.deleted = 0 AND e.date BETWEEN ? AND ?
      WHERE p.team_id = ? AND p.deleted = 0
      GROUP BY p.id, p.name, p.color ORDER BY minutes DESC`,
    [range[1], range[2], m.teamId]);

  const byMember = await query(
    `SELECT tm.user_id AS userId, u.email, u.display_name AS name, tm.role,
            COALESCE(SUM(e.to_min - e.from_min), 0) AS minutes, COUNT(e.id) AS entries
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       LEFT JOIN entries e ON e.user_id = tm.user_id AND e.team_id = tm.team_id
            AND e.project_id IS NOT NULL AND e.deleted = 0 AND e.date BETWEEN ? AND ?
      WHERE tm.team_id = ?
      GROUP BY tm.user_id, u.email, u.display_name, tm.role ORDER BY minutes DESC`,
    [range[1], range[2], m.teamId]);

  return { from: range[1], to: range[2], byProject, byMember };
}

/* Set by hand once payment clears — there is no webhook. Called from the site
   admin surface, never by a team's own owner, who would otherwise be one
   request away from the unlimited plan. */
export async function setTeamPlan(teamId, plan) {
  if (!PLANS[plan]) throw new TeamError('No such plan.');
  const res = await query('UPDATE teams SET plan = ?, seat_cap = ?, updated_at = ? WHERE id = ?',
    [plan, capFor(plan), now(), String(teamId || '')]);
  if (!res.affectedRows) throw new TeamError('No such team.', 404);
  return { teamId, plan, cap: capFor(plan) };
}
