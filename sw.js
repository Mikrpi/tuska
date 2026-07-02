/* Tuska-aikataulun service worker — offline-tuki festarialueen heikossa kentässä.
 *
 * Strategiat:
 *  - *.json (festari-indeksi + datatiedostot): network-first → online saa aina
 *    tuoreen ohjelman (myös korjaukset), offline putoaa viimeksi tallennettuun.
 *  - muut tiedostot (app shell, ikonit): cache-first + taustapäivitys
 *    (stale-while-revalidate) → nopea avaus ja toimii ilman verkkoa.
 *
 * YLLÄPITO: nosta CACHE-versionumeroa aina kun julkaiset muutoksen, jotta vanha
 * välimuisti tyhjennetään asennuksen yhteydessä (esim. "tuska-v3").
 */
const CACHE = "tuska-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./qr.js",
  "./festivals.json",
  "./data-ruisrock2026.json",
  "./data-ilosaarirock2026.json",
  "./data-tuska2026.json",
  "./data-hellsinki2026.json",
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

  // festari-indeksi ja datatiedostot (*.json): network-first
  // Vain onnistuneet vastaukset tallennetaan — virhesivu (esim. 404/500) ei saa
  // korvata toimivaa offline-kopiota. Virhevastauksella pudotaan välimuistiin.
  if (url.pathname.endsWith(".json")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (!res.ok) return caches.match(req).then((cached) => cached || res);
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // muut: cache-first + taustapäivitys (vain onnistunut vastaus välimuistiin)
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
