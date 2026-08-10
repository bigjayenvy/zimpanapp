/* Verification of Google ID tokens, on Node's crypto alone.

   The browser hands us a JWT signed by Google. Trusting its contents without
   checking the signature would let anyone sign in as anyone, so every token is
   verified against Google's published keys and then every claim that matters is
   checked: who signed it, who it was issued for, and whether it is still valid.

   Google rotates the signing keys, so the key set is cached only for as long as
   Google's own Cache-Control header allows. */

import crypto from 'node:crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SKEW_SECONDS = 300;

let cache = { keys: null, expires: 0 };

async function signingKeys() {
  if (cache.keys && Date.now() < cache.expires) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Could not reach Google to verify the sign-in.');
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error('Google returned an unusable key set.');
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  cache = { keys: body.keys, expires: Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000 };
  return cache.keys;
}

const fromB64Url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('That Google sign-in token is malformed.');

  let header, payload;
  try {
    header = JSON.parse(fromB64Url(parts[0]).toString('utf8'));
    payload = JSON.parse(fromB64Url(parts[1]).toString('utf8'));
  } catch {
    throw new Error('That Google sign-in token could not be read.');
  }

  // Pinned to RS256: accepting whatever the token asks for is how "alg: none"
  // and HMAC-confusion attacks get in.
  if (header.alg !== 'RS256') throw new Error('Unexpected signing algorithm on the Google token.');

  const jwk = (await signingKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('The Google token was signed with an unrecognised key.');

  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    fromB64Url(parts[2])
  );
  if (!verified) throw new Error('The Google token signature did not check out.');

  const nowSec = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(payload.iss)) throw new Error('The Google token came from an unexpected issuer.');
  // Without this check a token minted for someone else's app would be accepted.
  if (payload.aud !== clientId) throw new Error('That Google token was issued for a different application.');
  if (!payload.sub) throw new Error('The Google token identifies no account.');
  if (Number(payload.exp) <= nowSec) throw new Error('That Google sign-in has expired. Try again.');
  if (Number(payload.iat) > nowSec + SKEW_SECONDS) throw new Error('The Google token is not valid yet.');

  return {
    sub: String(payload.sub),
    email: String(payload.email || '').trim().toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name ? String(payload.name).slice(0, 120) : null
  };
}
