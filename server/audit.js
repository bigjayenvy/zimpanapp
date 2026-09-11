/* What an admin did, and to whom.

   "An admin can edit a member's time" is a reasonable thing for a timesheet to
   allow and an unreasonable thing to do silently. This is the other half of
   that permission: every write an admin makes to somebody else's record, or to
   who is on the team and what they may do, lands here first — and every member
   can read it, not only the people who can write to it. A log only the powerful
   can see is not an audit trail.

   Three rules.

   Append-only. Nothing in this file updates or deletes. A trail that can be
   edited is worth as much as the record it is meant to vouch for.

   Never in the way. record() is called beside the write it describes rather
   than inside its transaction, and a failure to write the trail is logged and
   swallowed: an admin correcting a typo at the end of a month should not be
   told the correction failed because a logging table was busy. The trade is
   deliberate and it is the right way round — a missing line is a gap somebody
   can notice, a refused edit is work somebody has to redo.

   Nothing personal. The only entries an admin can reach are the ones carrying
   a project, so the before-and-after of an hour edit is the team's own record.
   Nothing here reads a category, a note, a meal or a payment, and no route
   that writes to this table can see one. */

import { query, one, now } from './db.js';

/* The kinds, and how each is read back. Keeping the phrasing here rather than
   in the client means the trail says the same thing wherever it is read, and
   an action with no phrasing is a bug that shows up as a blank line rather
   than as a plausible sentence about the wrong thing. */
export const AUDIT_ACTIONS = {
  'team.create': 'created the team',
  'team.plan': 'changed the plan',
  'team.subscribe': 'started a subscription to',
  'member.invite': 'invited',
  'member.invite.revoke': 'revoked the invitation for',
  'member.invite.resend': 'sent the invitation again to',
  'member.join': 'joined the team',
  'member.role': 'changed the role of',
  'member.remove': 'removed',
  'project.create': 'added the project',
  'project.rename': 'renamed the project',
  'project.archive': 'archived the project',
  'project.restore': 'brought back the project',
  'project.delete': 'deleted the project',
  'entry.edit': 'edited a logged hour'
};

const MAX_PAGE = 200;

/* Written beside the change, never inside its transaction. See the note above:
   a trail that can refuse a write is a trail that can stop work. */
export function record({ teamId, actorId, actorLabel, action, subject, detail }) {
  if (!teamId || !action) return Promise.resolve();
  return query(
    'INSERT INTO team_audit (team_id, actor_id, actor_label, action, subject, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    [String(teamId), actorId || null, String(actorLabel || 'unknown').slice(0, 190),
      String(action).slice(0, 40), subject == null ? null : String(subject).slice(0, 190),
      detail == null ? null : JSON.stringify(detail), now()]
  ).catch((err) => {
    console.error(`[zimpan] audit write failed (${action}): ${err.message}`);
  });
}

/* Only the fields that actually moved, and both sides of each.

   Called with what the row was and what was asked of it, so a patch that
   repeats a value it already had records nothing for that field — "changed the
   date from the 3rd to the 3rd" is noise in a log somebody reads to find the
   one change that matters. */
export function changed(before, after) {
  const out = {};
  Object.keys(after || {}).forEach((k) => {
    const was = before ? before[k] : undefined;
    if (String(was == null ? '' : was) !== String(after[k] == null ? '' : after[k])) {
      out[k] = { from: was == null ? null : was, to: after[k] == null ? null : after[k] };
    }
  });
  return out;
}

/* Newest first, because the question is nearly always "what just happened".
   Paged by id rather than by offset: rows are only ever appended, so an id is
   a stable place to carry on from, and an offset would skip a row whenever one
   arrived between two pages. */
export async function list(teamId, { limit = 50, before } = {}) {
  const size = Math.min(MAX_PAGE, Math.max(1, Number(limit) || 50));
  const args = [String(teamId)];
  let where = 'team_id = ?';
  if (before) { where += ' AND id < ?'; args.push(Number(before) || 0); }

  const rows = await query(
    `SELECT a.id, a.actor_id AS actorId, a.actor_label AS actor, a.action, a.subject,
            a.detail, a.created_at AS at, u.display_name AS actorName
       FROM team_audit a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where}
      ORDER BY a.id DESC
      LIMIT ${size + 1}`,
    args);

  const more = rows.length > size;
  return {
    rows: rows.slice(0, size).map((r) => ({
      id: Number(r.id),
      at: Number(r.at),
      actor: r.actorName || r.actor,
      actorId: r.actorId == null ? null : Number(r.actorId),
      action: r.action,
      /* Named here rather than in the page, so the trail reads the same
         wherever it is shown and an unknown action is visibly unknown rather
         than quietly plausible. */
      says: AUDIT_ACTIONS[r.action] || r.action,
      subject: r.subject,
      detail: r.detail == null ? null : (typeof r.detail === 'string' ? safeParse(r.detail) : r.detail)
    })),
    // The id to carry on from, or nothing when this was the last page.
    next: more ? Number(rows[size - 1].id) : null
  };
}

const safeParse = (t) => { try { return JSON.parse(t); } catch { return null; } };

// How many lines the team has, for the tab to say so before it is opened.
export async function count(teamId) {
  const row = await one('SELECT COUNT(*) AS n FROM team_audit WHERE team_id = ?', [String(teamId)]);
  return Number(row && row.n) || 0;
}
