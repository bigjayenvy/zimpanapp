/* ── the service worker ──

   Here to make Zimpan installable and to let it open with no signal. Not here
   to serve yesterday's build.

   That distinction is the whole design. A deploy is a person pressing a button
   in cPanel, and a worker that answered from its cache first would go on
   serving the version it happened to catch - for as long as the cache lived,
   with no way for anybody to tell. So the network is asked first for
   everything and the cache only answers when the network cannot. Online, this
   file changes nothing about what anybody sees; offline, the app opens and
   reads the log it already has in localStorage.

   Nothing from /api is ever written down. Those answers are somebody's log and
   their session, they go stale the moment they are stored, and a cache of them
   is a copy of private data sitting in a place nothing here would think to
   clear. */

const CACHE = 'zimpan-shell-v1';

/* Enough to open the app and have it draw itself. The log is not in here -
   that lives in localStorage, which needs no help from this file. */
const SHELL = ['/', '/app.js', '/ds/styles.css', '/ds/favicon.svg'];

self.addEventListener('install', (e) => {
  /* Failures are swallowed on purpose: a missing file should leave the app
     working without a worker, not leave the worker stuck half-installed. */
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Older versions of this cache go, or a rename would leave them for ever.
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never the log, never the session, never anything that answers differently
  // to two people.
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      /* Only a real answer is kept. An error page cached as the app is how a
         bad minute on the server becomes a permanently broken install. */
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => { /* full, or private mode */ });
      }
      return fresh;
    } catch (err) {
      const held = await caches.match(req);
      if (held) return held;
      /* A navigation with nothing cached for that exact URL still gets the
         app: every route here is drawn by the same page, so the shell is the
         right answer to "/insights" as much as to "/". */
      if (req.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

/* ── notifications ──

   The payload arrives sealed to this browser and nobody else — the push service
   that carried it cannot read it, and neither can this file until the browser
   has opened it. What comes out is the object the server composed.

   The catch is that a browser will only deliver a push event if something
   visible follows it. Skipping showNotification on a malformed payload does not
   quietly do nothing; it gets the permission revoked. So every path here ends
   in a notification, including the path where the payload made no sense. */
self.addEventListener('push', (e) => {
  let note = {};
  try { note = (e.data && e.data.json()) || {}; } catch (err) { /* not ours, or not JSON */ }
  const title = note.title || 'ZIMPAN';
  e.waitUntil(self.registration.showNotification(title, {
    body: note.body || 'Open Zimpan to see today.',
    icon: '/ds/icon-192.png',
    // The small monochrome mark Android puts in the status bar.
    badge: '/ds/badge-72.png',
    /* One tag for the daily reminder, so a phone that was off for two days
       shows the newer one rather than a stack of stale mornings. */
    tag: note.tag || 'zimpan',
    renotify: true,
    data: { url: note.url || '/' }
  }));
});

/* Tapping it should land on the app that is already open, not a second copy of
   it. A window belonging to this origin is focused where there is one, and only
   a person with no Zimpan open gets a new one. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        /* Focused rather than navigated. navigate() reloads, and an app holding
           a half-typed entry is better brought to the front as it is than
           reloaded onto the same screen with that entry gone. */
        await c.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
