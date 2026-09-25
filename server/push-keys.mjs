/* Makes the one keypair this server's notifications are signed with.
 *
 *   node push-keys.mjs
 *
 * "bash: node: command not found" in cPanel's terminal is expected rather than
 * broken: node lives inside the application's virtual environment, not on the
 * PATH. Setup Node.js App shows the `source .../bin/activate` line to run
 * first. docs/reminders.md has that, and an openssl recipe for a box where
 * node cannot be found at all.
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
