/* ── what a reminder says ──

   One notification a day per device, and the whole product decision is in this
   file: a notification somebody swipes away is worse than no notification,
   because the next one gets swiped away faster and the one after that gets the
   permission revoked. So it goes out once, at an hour the person chose, and it
   only goes out when it has something to say.

   Having something to say means one of three things today: money going out,
   something planned, or a day with nothing logged on it yet. A day with none of
   those does not get a notification at all — which is the point of the check
   rather than an optimisation of it. */

import { query } from './db.js';

/* The device's own date, from the offset it reported. Everything below is asked
   in terms of this rather than the server's day: a phone in Manila is on
   tomorrow while the server is still on yesterday, and "due today" that means
   the server's today is wrong for exactly the people who use the app daily. */
export function localDate(tzOffsetMin, at) {
  const d = new Date((at || Date.now()) + (tzOffsetMin || 0) * 60000);
  return d.toISOString().slice(0, 10);
}
export const localMinutes = (tzOffsetMin, at) => {
  const d = new Date((at || Date.now()) + (tzOffsetMin || 0) * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/* Whether this device is owed a reminder at this instant.

   Three questions, in the order that makes them cheap: has it already had
   today's, has its chosen minute passed, and has it passed by so long that the
   morning is gone. The last one is what keeps a server that was down until noon
   from greeting everybody at once with a reminder about a morning they have
   already had — it skips them and is on time tomorrow.

   Pure, and separated from the round that calls it, because this is the whole
   of the scheduling and every part of it is a thing to get wrong. */
export function pushDue(row, at, lateMin) {
  const date = localDate(row.tz_offset, at);
  if (row.last_date === date) return null;
  const mins = localMinutes(row.tz_offset, at);
  if (mins < row.at_min) return null;
  if (mins - row.at_min > (lateMin || 120)) return null;
  return date;
}

const money = (n, currency) => {
  const v = Number(n) || 0;
  const whole = Math.round(v) === v;
  return `${currency || ''}${whole ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* A list of names, trimmed to something a notification can hold. Android shows
   about two lines collapsed and iOS fewer, so three names and a count beats six
   names nobody sees. */
function names(rows, limit) {
  const kept = rows.slice(0, limit).map((r) => String(r.body || '').trim()).filter(Boolean);
  const rest = rows.length - kept.length;
  if (!kept.length) return '';
  return rest > 0 ? `${kept.join(', ')} and ${rest} more` : kept.join(', ');
}

/* Everything today holds, in one round trip each. Read per device rather than
   per person because the date is the device's. */
export async function dayAhead(userId, date, currency) {
  const [due, planned, logged] = await Promise.all([
    query(`SELECT body, amount FROM plans
            WHERE user_id = ? AND deleted = 0 AND due_date = ? AND status <> 'paid' AND dir = 'out'
            ORDER BY amount DESC`, [userId, date]),
    query(`SELECT body FROM todos
            WHERE user_id = ? AND deleted = 0 AND plan_date = ? AND status <> 'done'
            ORDER BY created_at`, [userId, date]),
    query(`SELECT
             (SELECT COUNT(*) FROM entries WHERE user_id = ? AND deleted = 0 AND date = ?) AS hours,
             (SELECT COUNT(*) FROM money_entries WHERE user_id = ? AND deleted = 0 AND date = ?) AS spends`,
    [userId, date, userId, date])
  ]);
  const owed = due.reduce((n, r) => n + Number(r.amount || 0), 0);
  const first = logged[0] || {};
  return {
    due, planned,
    owed,
    entries: Number(first.hours || 0) + Number(first.spends || 0),
    currency: currency || ''
  };
}

/* The message itself, or null for a day that has nothing to interrupt anybody
   about.

   The title carries the one fact worth reading from a lock screen and the body
   carries the detail. Money leads when there is money, because a bill missed
   costs something and an unlogged hour does not. */
export function composeReminder(day) {
  const lines = [];
  if (day.due.length) {
    lines.push(`${money(day.owed, day.currency)} due today — ${names(day.due, 3)}`);
  }
  if (day.planned.length) {
    lines.push(day.planned.length === 1
      ? `Planned: ${names(day.planned, 1)}`
      : `${day.planned.length} things planned — ${names(day.planned, 3)}`);
  }
  if (!lines.length && day.entries === 0) {
    // The quiet case, and the only one that is a nudge rather than a fact.
    return { title: 'Nothing logged yet today', body: 'A minute now beats reconstructing it tonight.', tag: 'zimpan-day' };
  }
  if (!lines.length) return null;

  const title = day.due.length
    ? `${money(day.owed, day.currency)} due today`
    : `${day.planned.length} planned for today`;
  /* The nudge is appended rather than sent on its own, so a day with a bill on
     it is still one notification and not two. */
  if (day.entries === 0) lines.push('Nothing logged yet today.');
  return { title, body: lines.join('\n'), tag: 'zimpan-day' };
}

/* What a "send me one now" button gets. Always says something, because the
   thing being tested is whether notifications arrive at all, and a test that
   stays silent on a quiet day is a test that reads as broken. */
export function composeTest(day) {
  return composeReminder(day) || {
    title: 'Notifications are working',
    body: 'Nothing due and nothing planned today — this is what a quiet day looks like.',
    tag: 'zimpan-test'
  };
}
