/* Makes the one keypair this server's notifications are signed with.
 *
 *   node push-keys.mjs
 *
 * Run it once, paste the two lines into the environment, restart. Run it again
 * and every browser already subscribed goes silent — their subscriptions are
 * bound to the old public key and there is no way to move them, so a second
 * pair means asking everybody for permission again.
 *
 * The private half is printed to the terminal and written nowhere. It does not
 * belong in this repository, in a log, or in anything that gets copied to the
 * server by the deploy.
 */
import { newVapidKeys } from './push.js';

const { publicKey, privateKey } = newVapidKeys();
console.log(`
Paste these into cPanel → Setup Node.js App → Environment variables,
then restart the application. Keep the private one to yourself.

VAPID_PUBLIC=${publicKey}
VAPID_PRIVATE=${privateKey}
VAPID_SUBJECT=mailto:admin@bigcavestudios.com
`);
