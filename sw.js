/* Tuska-aikataulun service worker — offline-tuki festarialueen heikossa kentässä.
 *
 * Strategiat:
 *  - data.json: network-first → online saa aina tuoreen ohjelman (myös korjaukset),
 *    offline putoaa viimeksi tallennettuun versioon.
 *  - muut tiedostot (app shell, ikonit): cache-first + taustapäivitys
 *    (stale-while-revalidate) → nopea avaus ja toimii ilman verkkoa.
 *
 * YLLÄPITO: nosta CACHE-versionumeroa aina kun julkaiset muutoksen, jotta vanha
 * välimuisti tyhjennetään asennuksen yhteydessä (esim. "tuska-v2").
 */
const CACHE = "tuska-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./data.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // data.json: network-first
  if (url.pathname.endsWith("/data.json")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // muut: cache-first + taustapäivitys
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
