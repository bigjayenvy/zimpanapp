/* ZIMPAN — help requests.

   Somebody writes a subject and a message; it reaches whoever reads the
   support mailbox, and a copy with a reference number goes back to them.

   The conversation after that is email, on both sides. Nothing here stores a
   reply, a status or a thread — the moment it did, this table would be
   pretending to be a helpdesk while the real exchange happened in a mailbox it
   cannot see, and a ticket that says "open" three weeks after it was answered
   is worse than one that says nothing at all. The dashboard lists what came
   in, read-only, and the answering happens where the answering happens. */

import { query, one, now } from './db.js';

export class SupportError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

export const SUPPORT_TO = (process.env.SUPPORT_EMAIL || 'admin@bigcavestudios.com').trim();

/* zimp0001, zimp0002, … The row's own id, which AUTO_INCREMENT guarantees is
   never handed out twice — not even after a delete, which is exactly what a
   count-the-rows scheme would get wrong the first time one was removed.
   Padded to four and allowed to outgrow it rather than wrapping. */
export const refFor = (id) => `zimp${String(Number(id) || 0).padStart(4, '0')}`;

/* Where a request has got to. Stored as the key, labelled in the dashboard, so
   renaming one later is a change in one file rather than a migration.

   Ordered as a request usually travels, which is what the dropdown shows —
   Stuck last because it is the exception rather than the end. */
export const TICKET_STATUSES = [
  ['unanswered', 'Unanswered'],
  ['replied', 'Replied'],
  ['wip', 'WIP'],
  ['resolved', 'Resolved'],
  ['stuck', 'Stuck']
];
const STATUS_KEYS = TICKET_STATUSES.map(([k]) => k);
export const isStatus = (v) => STATUS_KEYS.includes(String(v || ''));

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const cleanEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 190);

/* One message per address per minute, and twenty a day. Held in memory rather
   than in the table: this is about the shape of a flood, not a fact worth
   keeping, and a restart clearing it is the right trade against a query on
   every send. */
const seen = new Map();
const MINUTE = 60000, DAY = 86400000;
const DAILY_CAP = 20;

function rateCheck(email) {
  const t = Date.now();
  const rec = seen.get(email) || { last: 0, day: [] };
  if (t - rec.last < MINUTE) {
    throw new SupportError('You just sent one. Give it a minute before sending another.', 429);
  }
  rec.day = rec.day.filter((x) => t - x < DAY);
  if (rec.day.length >= DAILY_CAP) {
    throw new SupportError('That is a lot of messages for one day. Reply to the email you already have and we will pick it up there.', 429);
  }
  rec.last = t;
  rec.day.push(t);
  seen.set(email, rec);
  /* Bounded, so a stream of made-up addresses cannot grow this without limit.
     Oldest first, which is the least useful to keep. */
  if (seen.size > 5000) {
    const oldest = [...seen.entries()].sort((a, b) => a[1].last - b[1].last).slice(0, 1000);
    oldest.forEach(([k]) => seen.delete(k));
  }
  return true;
}

/* Stored first, sent second, and the send cannot undo the store.

   If the mail fails the person still has a reference number and the dashboard
   still shows what they wrote — which is recoverable, because somebody can
   read it and reply. Refusing the whole thing because SMTP hiccuped would lose
   the message entirely, and they would have no way of knowing it had not
   arrived. `delivered` records which happened. */
export async function fileTicket({ email, userId, subject, body }, send) {
  const addr = cleanEmail(email);
  if (!EMAIL.test(addr)) throw new SupportError('We need an email address to reply to.');

  const subj = String(subject || '').trim().slice(0, 200);
  if (!subj) throw new SupportError('What is it about?');

  const text = String(body || '').trim().slice(0, 8000);
  if (!text) throw new SupportError('Tell us what is happening and we will look.');

  rateCheck(addr);

  const t = now();
  const res = await query(
    'INSERT INTO support_tickets (ref, email, user_id, subject, body, delivered, created_at) VALUES (?,?,?,?,?,0,?)',
    ['', addr, userId || null, subj, text, t]);
  const ref = refFor(res.insertId);
  await query('UPDATE support_tickets SET ref = ? WHERE id = ?', [ref, res.insertId]);

  let delivered = false;
  if (typeof send === 'function') {
    const out = await send({ ref, email: addr, subject: subj, body: text, at: t });
    delivered = !!(out && out.delivered);
    if (delivered) await query('UPDATE support_tickets SET delivered = 1 WHERE id = ?', [res.insertId]);
  }
  return { ref, delivered };
}

/* For the dashboard. Newest first, and the body comes with them — the point of
   the list is to read what people said, and a click-through to fetch one
   message would be a second route for no benefit. */
export async function listTickets(limit) {
  const take = Math.min(200, Math.max(1, Number(limit) || 50));
  return query(
    `SELECT t.id, t.ref, t.email, t.subject, t.body, t.delivered, t.created_at AS createdAt,
            t.status, t.status_at AS statusAt, t.status_by AS statusBy,
            u.role AS senderRole
       FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.id DESC LIMIT ${take}`);
}

/* Moving one along.

   Who and when are recorded with it, and the dashboard shows them. A status
   is a claim about work happening somewhere this table cannot see — the
   mailbox — so the only honest thing it can offer is who last said so and how
   long ago. Without that, "Replied" three weeks stale looks exactly like
   "Replied" this morning, which is the failure mode worth designing against.

   The actor's own address, not their id: it is what the next person reading
   the row wants, and an id would need a join to be of any use. */
export async function setTicketStatus(actor, id, status) {
  const key = String(status || '');
  if (!isStatus(key)) throw new SupportError('That is not a status.');
  const res = await query(
    'UPDATE support_tickets SET status = ?, status_at = ?, status_by = ? WHERE id = ?',
    [key, now(), (actor && actor.email) || null, Number(id) || 0]);
  if (!res.affectedRows) throw new SupportError('No such ticket.', 404);
  return { id: Number(id), status: key, statusAt: now(), statusBy: (actor && actor.email) || null };
}
