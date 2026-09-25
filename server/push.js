/* ── Web Push, without a dependency ──

   Sending a push notification is two pieces of cryptography and one POST. The
   usual answer is the `web-push` package; this file is that package's job done
   with node:crypto instead, for one practical reason: the server is deployed by
   copying files onto shared hosting, and a new dependency means somebody has to
   remember to run an install in cPanel's Node app screen before the next boot
   stops failing. Nothing here needs compiling, installing, or updating.

   The two pieces:

   VAPID (RFC 8292) is how the push service knows who is asking. A keypair is
   generated once and lives in the environment; every request carries a short
   JWT signed with the private half, and the browser subscribed with the public
   half. It is not encryption — it is a signature that ties this server to the
   subscriptions it created.

   The payload encryption (RFC 8291) is what keeps the message from the push
   service itself. Google and Mozilla run the delivery, and they are not meant
   to be able to read what they deliver: the browser hands over a public key and
   a shared secret when it subscribes, and the body is sealed to those. Which
   also means a lost subscription cannot be recovered — there is nothing to
   re-send to, only a new subscription to collect. */

import { createHmac, createECDH, createPrivateKey, createCipheriv,
  createDecipheriv, randomBytes, sign as signRaw } from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');

/* ── the keypair ──

   Generated once by `node push-keys.js` and pasted into the environment. The
   public half is handed to browsers and is not a secret; the private half signs,
   and a server that leaks it has handed somebody else the ability to send
   notifications as this app. */
const PUBLIC = (process.env.VAPID_PUBLIC || '').trim();
const PRIVATE = (process.env.VAPID_PRIVATE || '').trim();
/* Who to complain to. Push services want a way to reach the sender when
   something is wrong with the traffic, and reject the request outright if this
   is neither a mailto: nor an https: URL. */
const SUBJECT = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:admin@bigcavestudios.com';

export const pushConfigured = () => !!PUBLIC && !!PRIVATE;
// Handed to the browser so it can subscribe to this server and no other.
export const pushPublicKey = () => PUBLIC || null;

/* ── VAPID: proving who is sending ──

   A JWT signed with ES256 over P-256, which node can do natively. The one trap
   is the signature format: node emits DER by default and JOSE wants the bare
   r||s pair, so the encoding is asked for explicitly rather than unpicked
   afterwards. */
const P256_PKCS8_PREFIX = Buffer.from(
  '308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex');

/* The private half arrives as 32 raw bytes, which is how every VAPID tool
   prints it and what the browser-side ecosystem passes around. Node will only
   load a structured key, so the bytes are wrapped in the smallest PKCS#8 that
   holds them. */
function vapidPrivateKey() {
  const raw = unb64(PRIVATE);
  if (raw.length !== 32) throw new Error('VAPID_PRIVATE must be 32 bytes, base64url encoded.');
  return createPrivateKey({ key: Buffer.concat([P256_PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });
}

/* The audience is the push service's origin and nothing more — not the endpoint
   path, which identifies one subscriber and has no business in a token that
   covers a whole batch. */
export function vapidHeaders(endpoint, ttl) {
  const aud = new URL(endpoint).origin;
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  /* Twelve hours. The ceiling is 24 and the token is minted per send, so this
     is only wide enough to survive a clock that disagrees with the push
     service's by a few hours — which, on shared hosting, happens. */
  const claims = b64(JSON.stringify({
    aud, sub: SUBJECT, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60
  }));
  const signed = `${header}.${claims}`;
  const sig = signRaw('sha256', Buffer.from(signed), { key: vapidPrivateKey(), dsaEncoding: 'ieee-p1363' });
  return {
    Authorization: `vapid t=${signed}.${b64(sig)}, k=${PUBLIC}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl)
  };
}

/* ── RFC 8291: sealing the payload ──

   The whole key schedule, in the order the spec derives it. Every step is an
   HMAC used as HKDF, and the only subtlety is that the first one is keyed by
   the subscription's auth secret rather than by the salt — which is what binds
   the result to this subscriber and not merely to this conversation. */
const hkdf = (salt, ikm, info, len) => {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
};

function schedule(ecdhSecret, authSecret, uaPublic, asPublic, salt) {
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), uaPublic, asPublic
  ]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  return {
    cek: hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce: hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  };
}

/* One record, which is all a notification ever needs: the ceiling is 4096 bytes
   and these messages are a line of text. The 0x02 on the end is the spec's
   "this is the last record" marker, and it is inside the ciphertext rather than
   beside it so that truncation cannot go unnoticed. */
export function encryptPayload(plaintext, uaPublicB64, authSecretB64, opts) {
  const o = opts || {};
  const uaPublic = unb64(uaPublicB64);
  const authSecret = unb64(authSecretB64);
  const salt = o.salt || randomBytes(16);

  const ecdh = createECDH('prime256v1');
  if (o.asPrivate) ecdh.setPrivateKey(o.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const { cek, nonce } = schedule(ecdh.computeSecret(uaPublic), authSecret, uaPublic, asPublic, salt);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])])),
    cipher.final(), cipher.getAuthTag()
  ]);

  // salt | record size | length of the key that follows | that key
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(o.recordSize || 4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/* The other direction, which exists so the tests can prove the schedule against
   the specification's own example rather than only against itself. Nothing in
   the running server calls it: only the subscriber's browser ever decrypts. */
export function decryptPayload(sealed, uaPrivate, authSecretB64) {
  const salt = sealed.subarray(0, 16);
  const idlen = sealed[20];
  const asPublic = sealed.subarray(21, 21 + idlen);
  const body = sealed.subarray(21 + idlen);

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const { cek, nonce } = schedule(ecdh.computeSecret(asPublic), unb64(authSecretB64), uaPublic, asPublic, salt);

  const tag = body.subarray(body.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  // Trailing 0x02 and any padding zeroes before it.
  let end = out.length - 1;
  while (end >= 0 && out[end] === 0) end--;
  return out.subarray(0, end).toString('utf8');
}

/* ── the send ──

   The return is the outcome rather than an exception, because the caller is a
   loop over every subscription on the server and one dead browser is not a
   reason to stop.

   `gone` is the one that matters. A 404 or a 410 is the push service saying the
   subscription no longer exists — an uninstalled app, a cleared browser, a
   revoked permission — and it will never work again, so the row is deleted
   rather than retried forever. Everything else is a bad day for the network. */
const PUSH_TIMEOUT_MS = Number(process.env.PUSH_TIMEOUT_MS) || 10000;

export async function sendPush(sub, payload, ttl) {
  if (!pushConfigured()) return { ok: false, gone: false, error: 'Push is not set up on this server.' };
  let res;
  const sealed = encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: vapidHeaders(sub.endpoint, ttl || 12 * 60 * 60),
      body: sealed,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
    });
  } catch (err) {
    return { ok: false, gone: false, error: err.message || 'The push service did not answer.' };
  }
  if (res.ok) return { ok: true, gone: false, status: res.status };
  /* The body is read on a refusal and only on a refusal. It is the only place
     the reason is ever written down — a 403 from a key that does not match the
     subscription reads exactly like a 403 from a malformed token otherwise. */
  const why = await res.text().catch(() => '');
  return {
    ok: false,
    gone: res.status === 404 || res.status === 410,
    status: res.status,
    error: `${res.status} ${(why || res.statusText || '').slice(0, 200)}`.trim()
  };
}

/* Generating the pair. Exported rather than inlined in the script so the shape
   of what goes into the environment is stated once.

   Through ECDH rather than generateKeyPair, because what has to come out is the
   raw point and the raw scalar — the two forms every VAPID tool prints — and
   this is the one API that hands them over without a DER structure to unpick.

   The scalar is padded. A key with a leading zero byte comes back 31 bytes
   long, which happens on about one generation in 256 and produces a keypair
   that works everywhere until something reads it back expecting 32. */
export function newVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = Buffer.alloc(32);
  ecdh.getPrivateKey().copy(priv, 32 - ecdh.getPrivateKey().length);
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(priv) };
}
