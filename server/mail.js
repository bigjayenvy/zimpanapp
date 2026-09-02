/* Outbound mail, through the domain's own cPanel mailbox rather than a
   third-party service.

   With no SMTP configured the mailer stays disabled. Outside production it then
   prints the reset link to the console so the flow can be exercised locally
   without a mail server; in production it refuses instead, because writing
   password-reset links into a log file would hand over accounts to anyone who
   can read it. */

import nodemailer from 'nodemailer';

const PROD = process.env.NODE_ENV === 'production';
const HOST = process.env.SMTP_HOST || '';
const FROM = process.env.MAIL_FROM || '';

export const mailerConfigured = () => Boolean(HOST && FROM);

let cached = null;
function transport() {
  if (cached) return cached;
  const local = /^(localhost|127\.0\.0\.1)$/i.test(HOST);
  cached = nodemailer.createTransport({
    host: HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' }
      : undefined,
    // cPanel's loopback MTA usually presents a certificate for the server's own
    // hostname, which will not match "localhost". Relaxed only for the loopback
    // interface, where the traffic never leaves the machine anyway.
    tls: local ? { rejectUnauthorized: false } : undefined
  });
  return cached;
}

/* The frame both letters sit in. Written once because two mails that drift
   apart look like two products, and inline styles because an email client is
   the one place a stylesheet cannot be relied on. */
const SHELL = (body) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1d1f20;max-width:520px;">
  <p style="font-weight:600;font-size:18px;margin:0 0 4px;">ZIMPAN</p>
  <p style="margin:0 0 18px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a7a7d;">Track What Matters</p>
  ${body}
</div>`;

const BUTTON = (link, label) => `
  <p style="margin:22px 0;">
    <a href="${link}" style="background:#416180;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;display:inline-block;">${label}</a>
  </p>`;

const TEXT = (link) => `Someone asked to reset the password for your ZIMPAN account.

Open this link to choose a new one:
${link}

The link works once and expires in one hour. If this was not you, ignore this
message — nothing has changed and your current password still works.`;

const HTML = (link) => SHELL(`
  <p>Someone asked to reset the password for your ZIMPAN account.</p>
  ${BUTTON(link, 'Choose a new password')}
  <p style="color:#5d5d60;font-size:13px;">The link works once and expires in one hour.</p>
  <p style="color:#5d5d60;font-size:13px;">If this was not you, ignore this message — nothing has changed and your current password still works.</p>
  <p style="color:#8a8a8d;font-size:12px;word-break:break-all;">${link}</p>`);

/* ── the team invitation ──

   Sent when an admin adds somebody to a team. It has to say three things a
   reset email does not: who is inviting them, that a team account is its own
   login rather than a personal Zimpan, and that the link expires.

   The "sign up with this address" instruction is not decoration. acceptInvite
   refuses an invitation whose address does not match the account accepting it,
   so somebody who signs up with a different mailbox will be turned away by the
   server with no idea why. */
const INVITE_TEXT = (link, team, from, days, to) =>
  `${from ? `${from} has invited you` : 'You have been invited'} to join ${team} on Zimpan for Teams.

Zimpan for Teams tracks hours against projects — what the team worked on and
where the week went. It is separate from a personal Zimpan: nothing you log
outside the team is visible in it.

Open this link to accept:
${link}

Sign up with this address, ${to} — an invitation only works for the mailbox it
was sent to. The link expires in ${days} days.

If you were not expecting this, ignore it. Nothing has been created in your name.`;

const INVITE_HTML = (link, team, from, days, to) => SHELL(`
  <p>${from ? `<strong>${from}</strong> has invited you` : 'You have been invited'} to join <strong>${team}</strong> on Zimpan for Teams.</p>
  <p style="color:#5d5d60;font-size:13.5px;">Zimpan for Teams tracks hours against projects — what the team worked on and where the week went. It is separate from a personal Zimpan: nothing you log outside the team is visible in it.</p>
  ${BUTTON(link, 'Accept the invitation')}
  <p style="color:#5d5d60;font-size:13px;">Sign up with <strong>${to}</strong> — an invitation only works for the mailbox it was sent to.</p>
  <p style="color:#5d5d60;font-size:13px;">The link expires in ${days} days.</p>
  <p style="color:#5d5d60;font-size:13px;">If you were not expecting this, ignore it. Nothing has been created in your name.</p>
  <p style="color:#8a8a8d;font-size:12px;word-break:break-all;">${link}</p>`);

/* Never throws. An invitation whose email failed is recoverable — the admin
   can copy the link off their own screen, which is why the route hands it back
   — and an invitation that was refused because the mail server hiccuped is
   not. So the outcome is reported rather than raised, and the caller says so
   on screen instead of pretending it went. */
export async function sendInviteEmail(to, link, { team, from, days } = {}) {
  const name = team || 'a team';
  const asker = from || '';
  const life = days || 14;
  if (!mailerConfigured()) {
    if (!PROD) console.log(`\n[zimpan] mail is not configured — invite link for ${to}:\n${link}\n`);
    return { delivered: false, reason: 'Mail is not configured on this server.' };
  }
  try {
    await transport().sendMail({
      from: FROM,
      to,
      subject: `${asker ? `${asker} invited you` : 'You are invited'} to ${name} on ZIMPAN`,
      text: INVITE_TEXT(link, name, asker, life, to),
      html: INVITE_HTML(link, name, asker, life, to)
    });
    return { delivered: true };
  } catch (err) {
    console.error(`[zimpan] invite email to ${to} failed: ${err.message}`);
    return { delivered: false, reason: err.message };
  }
}

export async function sendResetEmail(to, link) {
  if (!mailerConfigured()) {
    if (PROD) throw new Error('Mail is not configured on this server.');
    console.log(`\n[zimpan] mail is not configured — reset link for ${to}:\n${link}\n`);
    return { delivered: false, logged: true };
  }
  await transport().sendMail({
    from: FROM,
    to,
    subject: 'Reset your ZIMPAN password',
    text: TEXT(link),
    html: HTML(link)
  });
  return { delivered: true };
}
