// Offline support. The app shell and the knowledge base are cached on install so
// a bookmarked AstroBot opens and reads charts with no network at all.
//
// Bump CACHE when shipping a change, or clients keep the old files.

const CACHE = 'astrobot-v9';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/js/app.js',
  'assets/js/model.js',
  'assets/js/kb.js',
  'assets/js/engine.js',
  'assets/js/chartview.js',
  'assets/js/library.js',
  'assets/js/birth.js',
  'assets/js/edits.js',
  'assets/js/astro/time.js',
  'assets/js/astro/dasha.js',
  'assets/js/astro/ayanamsa.js',
  'assets/js/astro/ascendant.js',
  'assets/js/astro/compute.js',
  'assets/js/astro/rectify.js',
  'assets/vendor/astronomy.js',
  'assets/data/places-in.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'knowledge/index.json',
  'knowledge/base/planets.json',
  'knowledge/base/rashis.json',
  'knowledge/base/houses.json',
  'knowledge/base/sources.json',
  'knowledge/rules/planet-in-house/su.json',
  'knowledge/rules/planet-in-house/mo.json',
  'knowledge/rules/planet-in-house/ma.json',
  'knowledge/rules/planet-in-house/me.json',
  'knowledge/rules/planet-in-house/ju.json',
  'knowledge/rules/planet-in-house/ve.json',
  'knowledge/rules/planet-in-house/sa.json',
  'knowledge/rules/planet-in-house/ra.json',
  'knowledge/rules/planet-in-house/ke.json',
  'knowledge/rules/lord-in-house/general.json',
  'knowledge/rules/yogas.json',
  'knowledge/rules/combustion.json',
  'knowledge/rules/dasha.json',
  'knowledge/rules/conjunctions.json',
  'knowledge/rules/aspects.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any single file 404s, which would leave
      // the app with no offline support at all. Add them one at a time instead.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // never touch github.com traffic

  // Knowledge files: prefer the network so an updated rule shows up without a
  // reinstall, but fall back to the cache when offline.
  const isKnowledge = url.pathname.includes('/knowledge/');

  if (isKnowledge) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // The page itself is network-first.
  //
  // Serving the document from the cache lets the HTML and the scripts drift
  // apart: a stale index.html can be handed to a page whose app.js is current,
  // the new code looks for an element the old markup has not got, and the whole
  // boot throws. That is not hypothetical - it happened on the first deploy
  // after the kundali work, and bumping the cache name does not prevent it,
  // because the install itself can race the CDN and cache the old page.
  //
  // One document per visit is a small price for never shipping a mismatched
  // pair. Offline still works: the cached copy is the fallback.
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            caches.open(CACHE).then((c) => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html'))),
    );
    return;
  }

  // Everything else: serve the cached copy at once and refresh it in the
  // background, so a deploy reaches the device on the next load. Cache-first
  // without the revalidation would pin users to whatever they first installed.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            caches.open(CACHE).then((c) => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() => hit || caches.match('index.html'));
      return hit || fresh;
    }),
  );
});
