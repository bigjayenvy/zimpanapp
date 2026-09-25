# Reminders (Web Push)

One notification a day, per browser, at an hour the person chose, about what
that day holds. Off until it is switched on, and switched on per device: a
phone can be subscribed while a laptop is not, because that is how browsers
grant the permission and pretending otherwise would be a lie about which
screen the notification is going to land on.

Nothing in here needs an npm install. The Web Push protocol is implemented in
`server/push.js` with `node:crypto` alone.

## Setting it up

Three things, once.

### 1. The keypair

On the server, in cPanel's terminal:

```
cd ~/zimpan/server && node push-keys.mjs
```

It prints three lines. Paste them into **cPanel → Setup Node.js App →
Environment variables** and restart the app.

**Generate this once and keep it.** A browser's subscription is bound to the
key it subscribed with, and there is no way to move one to a new key. A second
keypair silently unsubscribes everybody who had already said yes, and they are
not asked again — the app believes they are still subscribed.

`VAPID_SUBJECT` has to be a `mailto:` or an `https:` URL. Google and Mozilla
both reject a token without one.

The private half is a signing key. Anybody holding it can send notifications
that this app's users will see as coming from Zimpan. It belongs in the
environment and nowhere else.

### 2. The cron

Nothing is sent until something asks for a round. **cPanel → Cron Jobs**, every
ten minutes (`*/10 * * * *`):

```
curl -fsS -m 60 -X POST -H "X-Zimpan-Cron: $PUSH_CRON_SECRET" \
  https://www.zimpan.com/api/push/run >/dev/null
```

Set `PUSH_CRON_SECRET` to a long random string in the same environment
variables screen, and write it into the cron line. With it unset the endpoint
answers 404 to everybody, the cron included.

The round works out what time it is *on each device* and sends to the ones
whose chosen minute has just passed. So the cron's interval is the only thing
deciding how late a reminder can be: every ten minutes is inside what anybody
notices, hourly would mean an 8am reminder arriving some time before nine.

### 3. Nothing

The table is created by the ordinary migration on the next boot. There is no
step three.

## What it sends

`server/remind.js` decides, and it sends nothing on a day with nothing to say.
In order:

| The day has | The notification says |
| --- | --- |
| money due | `₱2,349 due today` — with up to three names, then `and N more` |
| things planned | `3 planned for today`, or the one thing by name |
| both | one notification, money first |
| nothing logged yet, and nothing due | `Nothing logged yet today` |
| nothing logged, and something due | the due line, with the nudge appended |
| something logged, nothing due | **nothing at all** |

That last row is the point rather than an optimisation of it. A notification
somebody swipes away is worse than no notification: the next one gets swiped
faster, and the one after that gets the permission revoked.

## When nothing arrives

Push fails silently at every layer, which is why there is a **Send one now**
button in Preferences. Use it first — it either produces a notification or
names the refusal.

| What you see | What it is |
| --- | --- |
| The switch will not move, "blocked in your browser settings" | The permission was denied. It cannot be re-asked from the page; it has to be allowed in the browser's own site settings. |
| The test says the push service would not take it | The server reached the push service and was refused. The reason is in the app's stderr log — a 403 is nearly always `VAPID_SUBJECT` missing or the keypair having been regenerated. |
| Nothing at all, on an iPhone | iOS only delivers push to an app that has been **added to the home screen**. In Safari's own tab it will never arrive, and the switch will not even be offered — iOS has no PushManager in a tab. |
| Nothing at all, on Android, but the test works | The round has not run. Check the cron, and that the secret in the cron line matches the environment. |
| It arrives hours late | `PUSH_LATE_MIN` (default 120) is the window after the chosen minute in which a reminder is still worth sending. The cron's interval decides the rest. |

`POST /api/push/run` answers with a tally — `{ considered, sent, quiet,
dropped, failed }` — which is the quickest way to tell "the round ran and
nobody was due" from "the round never ran". `quiet` is devices whose day had
nothing worth saying.

## Housekeeping

Subscriptions are dropped, not retried forever:

- **404 or 410** from the push service means the subscription is finished — an
  uninstalled app, a cleared browser, a revoked permission. The row goes
  immediately.
- **Three consecutive failures** of any other kind and the row goes too. Not on
  the first: a push service having an outage is not a person who left.

## What is not here

Push is one-way and carries no data worth reading. It does not sync, it does
not carry the log, and the payload is sealed to the subscribing browser — the
push service that delivers it cannot read it, which is what RFC 8291 is for
and what `srv-push/rfc.mjs` checks against the specification's own example.
