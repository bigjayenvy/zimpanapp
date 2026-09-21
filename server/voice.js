/* The voice agent's door.

   ElevenLabs runs the conversation itself — speech in, the model between, speech
   out. This file does one thing: hand the browser a way to open that session
   without ever handing it the key.

   Two shapes, because which one an account has is a choice made on ElevenLabs
   rather than here. A public agent needs nothing but its id, and the browser can
   hold that: it is not a secret, it is an address. A private one needs a
   short-lived signed URL, minted here, because minting it in the browser would
   mean shipping the key to the browser.

   The rule is the simpler of the two to reason about: if there is a key, a
   signed URL is minted, which works for either kind of agent. With no key the id
   is handed over as-is, which works only if the agent was made public. So an
   install that sets both gets the safe path by default. */

const AGENT_ID = (process.env.ELEVENLABS_AGENT_ID || '').trim();
const KEY = (process.env.ELEVENLABS_API_KEY || '').trim();
const SIGN_URL = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url';
const TOKEN_URL = 'https://api.elevenlabs.io/v1/convai/conversation/token';
const TIMEOUT_MS = Number(process.env.ELEVENLABS_TIMEOUT_MS) || 10000;

/* On when there is an agent to talk to. The key is optional — see above — so it
   is deliberately not part of this test, or an install with a public agent would
   be told the feature is off while it is perfectly able to run it. */
export const voiceConfigured = () => !!AGENT_ID;

/* One call to ElevenLabs, with the reason it failed kept rather than thrown away.

   A refusal here is nearly always a key that is valid but not scoped for
   Conversational AI, and the difference between that and a wrong key is in the
   body, not the status. So the body goes to the log: whoever is reading it in
   cPanel is trying to answer "which of my three guesses is it", and a bare 401
   answers none of them. */
async function ask(url) {
  let res;
  try {
    res = await fetch(`${url}?agent_id=${encodeURIComponent(AGENT_ID)}`, {
      headers: { 'xi-api-key': KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    /* Logged in full and reported in outline, like every other outbound call
       here: a timeout and a DNS failure are the same sentence to the person
       holding the phone, and different lines in the log. */
    console.error(`[zimpan] voice session could not reach ElevenLabs: ${err.message}`);
    throw new Error('Could not reach the voice service.');
  }

  const text = await res.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { /* not json, the text will do */ }
  return { ok: res.ok, status: res.status, body, text: text.slice(0, 400) };
}

/* What the browser needs to start one conversation, and nothing else.

   Never the key, and never anything about the account: the caller already knows
   who it is, and the variables the agent is given are assembled on the client
   from what the client already holds. This is the address and the ticket.

   Two kinds of ticket, because the two ways of connecting do not take the same
   one. WebRTC wants a conversation token; the older WebSocket path wants a
   signed URL. The token is asked for first and the signed URL is the fallback,
   so an account whose API does not offer one still gets the other, and the
   browser is told which it is holding rather than left to guess. */
export async function voiceSession() {
  if (!AGENT_ID) throw new Error('The voice agent is not configured on this server.');
  if (!KEY) return { agentId: AGENT_ID };

  const tok = await ask(TOKEN_URL);
  if (tok.ok) {
    const token = tok.body && (tok.body.token || tok.body.conversation_token);
    if (typeof token === 'string' && token) return { conversationToken: token };
    console.error('[zimpan] voice token came back without a token, falling back to a signed url');
  } else if (tok.status === 401 || tok.status === 403) {
    /* Not retried against the other endpoint. The same key would be refused the
       same way, and a second identical failure in the log helps nobody. */
    console.error(`[zimpan] voice session refused (${tok.status}): ${tok.text}`);
    throw new Error('The voice service refused our credentials.');
  } else {
    console.error(`[zimpan] voice token unavailable (${tok.status}): ${tok.text}`);
  }

  const sig = await ask(SIGN_URL);
  if (!sig.ok) {
    console.error(`[zimpan] voice session refused (${sig.status}): ${sig.text}`);
    throw new Error(sig.status === 401 || sig.status === 403
      ? 'The voice service refused our credentials.'
      : 'The voice service could not start a session.');
  }

  /* Their field has been spelled both ways across versions of this API, so both
     are read rather than guessed at. A reply with neither is a reply we cannot
     use, and saying so beats handing the browser undefined. */
  const url = sig.body && (sig.body.signed_url || sig.body.signedUrl);
  if (typeof url !== 'string' || !url) {
    console.error('[zimpan] voice session came back without a signed url');
    throw new Error('The voice service returned something unusable.');
  }
  return { signedUrl: url };
}
