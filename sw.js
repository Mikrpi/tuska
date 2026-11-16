/* Tuska-aikataulun service worker — offline-tuki festarialueen heikossa kentässä.
 *
 * Strategiat:
 *  - *.json (festari-indeksi + datatiedostot): network-first aikakatkaisulla →
 *    online saa aina tuoreen ohjelman (myös korjaukset). Jos verkko ei vastaa
 *    NET_TIMEOUT_MS:n kuluessa ja kopio on tallessa, vastataan välimuistista
 *    heti — festarialueen "lie-fi" (yhteys näyttää olevan, mutta mitään ei
 *    tule) ei saa jumittaa käynnistystä. Haku jatkuu taustalla ja päivittää
 *    välimuistin seuraavaa kertaa varten.
 *  - sovelluksen avaus (navigaatio): sama app shell kyselyparametreista
 *    riippumatta (?f=…, ?now=…). Sivun osoitteessa on aina ?f=, joten ilman
 *    tätä offline-avaus toimisi vain täsmälleen sillä osoitteella, jolla sivu
 *    on joskus ladattu verkossa (esim. festarin vaihto tai kaverin linkki ei).
 *  - muut tiedostot (qr.js, ikonit): cache-first + taustapäivitys
 *    (stale-while-revalidate) → nopea avaus ja toimii ilman verkkoa.
 * Vain onnistuneet (2xx) vastaukset tallennetaan — virhesivu ei voi korvata
 * toimivaa offline-kopiota.
 *
 * YLLÄPITO: nosta CACHE-versionumeroa aina kun julkaiset muutoksen, jotta vanha
 * välimuisti tyhjennetään asennuksen yhteydessä (esim. "tuska-v3"). Azure-deploy
 * leimaa version automaattisesti (scripts/build-site.sh) — ks. MAINTENANCE.md.
 */
const CACHE = "tuska-v22";
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

// Kuinka kauan JSON-haku saa kestää ennen kuin vastataan välimuistikopiolla.
const NET_TIMEOUT_MS = 3000;

// App shellin välimuistiavain navigaatioille. "./" eikä "./index.html": palvelin
// voi ohjata index.html:n juureen, eikä uudelleenohjattua vastausta saa käyttää
// navigaation vastauksena.
const SHELL = "./";
const SCOPE_PATH = new URL("./", self.location.href).pathname;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Kiinteä, käsin ylläpidetty lista precachetaan all-or-nothing: jos se ei
    // onnistu, asennuksen kuuluukin epäonnistua.
    await c.addAll(ASSETS);
    // Datatiedostojen lista generoidaan lisäksi festivals.jsonista, jolloin
    // uusi festari päätyy precacheen vaikka ASSETS-listan päivitys unohtuisi.
    // Nämä lisätään yksitellen ja virhesietoisesti: yksi rekisteriin listattu
    // mutta deployamatta jäänyt (404) datatiedosto ei saa kaataa koko
    // asennusta — muuten yksikään uusi SW-versio ei asentuisi ja käyttäjät
    // jäisivät pysyvästi vanhaan app-shelliin.
    try {
      const reg = await (await fetch("./festivals.json", { cache: "no-cache" })).json();
      const dataFiles = (reg.festivals || [])
        .map((f) => f && typeof f.data === "string" ? "./" + f.data : null)
        .filter(Boolean)
        .filter((u) => !ASSETS.includes(u));
      await Promise.allSettled(dataFiles.map((u) => c.add(u)));
    } catch (err) { /* offline tms. — kiinteä lista riittää */ }
  })());
});

// Päivityspalkin "Reload" pyytää odottavaa workeria aktivoitumaan; sivu lataa
// itsensä uudelleen vasta controllerchange-tapahtumasta (ks. index.html).
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Onnistunut vastaus välimuistiin taustalla. waitUntil pitää workerin hengissä,
// kunnes tallennus on valmis (vastaus on voinut jo lähteä sivulle).
function store(e, key, res) {
  const copy = res.clone();
  e.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)));
}

// Network-first aikakatkaisulla (ks. yläkommentti). Ratkeaa ensimmäiseen
// käyttökelpoiseen: verkon 2xx-vastaus, tai välimuistikopio kun verkko on
// hidas, palauttaa virheen tai ei vastaa lainkaan.
function networkFirst(e, req) {
  const network = fetch(req).then((res) => {
    if (res.ok) store(e, req, res);
    return res;
  });
  e.waitUntil(network.catch(() => {})); // taustapäivitys saa valmistua aikakatkaisun jälkeenkin
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => {
      if (done || !res) return; // ei kopiota aikakatkaisussa -> jatka verkon odottamista
      done = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => caches.match(req).then(finish), NET_TIMEOUT_MS);
    network.then(
      (res) => res.ok ? finish(res) : caches.match(req).then((cached) => finish(cached || res)),
      () => caches.match(req).then((cached) => finish(cached || Response.error()))
    );
  });
}

// Cache-first + taustapäivitys. key = välimuistiavain (navigaatioille SHELL,
// muuten pyyntö itse). Uudelleenohjattua vastausta ei tallenneta (ks. SHELL).
function staleWhileRevalidate(e, req, key) {
  const network = fetch(req).then((res) => {
    if (res.ok && !res.redirected) store(e, key, res);
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  return caches.match(key).then((cached) =>
    cached || network.catch(() => Response.error()));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.endsWith(".json")) {
    e.respondWith(networkFirst(e, req));
    return;
  }

  const isShell = req.mode === "navigate" &&
    (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + "index.html");
  e.respondWith(staleWhileRevalidate(e, req, isShell ? SHELL : req));
});
