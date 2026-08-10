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

const TEXT = (link) => `Someone asked to reset the password for your ZIMPAN account.

Open this link to choose a new one:
${link}

The link works once and expires in one hour. If this was not you, ignore this
message — nothing has changed and your current password still works.`;

const HTML = (link) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1d1f20;max-width:520px;">
  <p style="font-weight:600;font-size:18px;margin:0 0 4px;">ZIMPAN</p>
  <p style="margin:0 0 18px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a7a7d;">Track What Matters</p>
  <p>Someone asked to reset the password for your ZIMPAN account.</p>
  <p style="margin:22px 0;">
    <a href="${link}" style="background:#416180;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;display:inline-block;">Choose a new password</a>
  </p>
  <p style="color:#5d5d60;font-size:13px;">The link works once and expires in one hour.</p>
  <p style="color:#5d5d60;font-size:13px;">If this was not you, ignore this message — nothing has changed and your current password still works.</p>
  <p style="color:#8a8a8d;font-size:12px;word-break:break-all;">${link}</p>
</div>`;

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
