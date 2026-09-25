/* Makes the one keypair this server's notifications are signed with.
 *
 *   node push-keys.js
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

/* Printed as a name column and a value column rather than as NAME=value lines.
   cPanel's environment editor has two fields, and a printed `NAME=value` is an
   invitation to paste the whole line into the value one — which produces a key
   that decodes to nine bytes and a failure that only shows up at the first
   send. The layout is the fix. */
const rows = [
  ['VAPID_PUBLIC', publicKey],
  ['VAPID_PRIVATE', privateKey],
  ['VAPID_SUBJECT', 'mailto:admin@bigcavestudios.com']
];
console.log('\nIn cPanel → Setup Node.js App → Environment variables, add these three.');
console.log('Each NAME goes in the name field and each VALUE in the value field —');
console.log('the value is what follows the colon, with no name and no spaces.\n');
for (const [name, value] of rows) console.log(`  ${name.padEnd(14)}: ${value}`);
console.log(`
The public value is 87 characters and the private one 43. Restart the app
afterwards. Keep the private one to yourself — it is a signing key, and this
is the only time it is ever shown.
`);
