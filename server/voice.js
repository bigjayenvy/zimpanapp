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
const TIMEOUT_MS = Number(process.env.ELEVENLABS_TIMEOUT_MS) || 10000;

/* On when there is an agent to talk to. The key is optional — see above — so it
   is deliberately not part of this test, or an install with a public agent would
   be told the feature is off while it is perfectly able to run it. */
export const voiceConfigured = () => !!AGENT_ID;

/* What the browser needs to start one conversation, and nothing else.

   Never the key, and never anything about the account: the caller already knows
   who it is, and the variables the agent is given are assembled on the client
   from what the client already holds. This is the address and the ticket. */
export async function voiceSession() {
  if (!AGENT_ID) throw new Error('The voice agent is not configured on this server.');
  if (!KEY) return { agentId: AGENT_ID };

  let res;
  try {
    res = await fetch(`${SIGN_URL}?agent_id=${encodeURIComponent(AGENT_ID)}`, {
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
  if (!res.ok) {
    console.error(`[zimpan] voice session refused (${res.status})`);
    throw new Error(res.status === 401 || res.status === 403
      ? 'The voice service refused our credentials.'
      : 'The voice service could not start a session.');
  }

  const body = await res.json().catch(() => null);
  /* Their field has been spelled both ways across versions of this API, so both
     are read rather than guessed at. A reply with neither is a reply we cannot
     use, and saying so beats handing the browser undefined. */
  const url = body && (body.signed_url || body.signedUrl);
  if (typeof url !== 'string' || !url) {
    console.error('[zimpan] voice session came back without a signed url');
    throw new Error('The voice service returned something unusable.');
  }
  return { signedUrl: url };
}
