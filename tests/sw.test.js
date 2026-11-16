#!/usr/bin/env node
/* Tests for sw.js: the service worker is run as shipped in a vm sandbox with
 * fake caches, fetch and timers, and its install/fetch handlers are driven
 * directly. Covers the offline-critical paths:
 *   - opening the app (navigation) with any ?f=/?now= query works offline
 *   - *.json is network-first, but falls back to the cached copy on failure,
 *     on an error response and when the network is too slow (timeout)
 *   - only successful, non-redirected responses are cached
 *   - install tolerates a registry entry whose data file is missing
 *
 * Run:  node tests/sw.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const ORIGIN = "https://fest.example";
const SW_URL = ORIGIN + "/sw.js";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };

class FakeResponse {
  constructor(body, { status = 200, redirected = false, type = "basic" } = {}) {
    this.body = body; this.status = status; this.redirected = redirected; this.type = type;
  }
  get ok() { return this.status >= 200 && this.status < 300; }
  clone() { return new FakeResponse(this.body, this); }
  async json() { return JSON.parse(this.body); }
  static error() { return new FakeResponse(null, { status: 0, type: "error" }); }
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((r) => setImmediate(r));

// Uusi, eristetty SW-ympäristö jokaiselle testille.
function makeEnv() {
  const handlers = {};
  const stores = new Map(); // välimuistin nimi -> Map(url -> FakeResponse)
  const timers = [];
  const keyOf = (r) => new URL(typeof r === "string" ? r : r.url, SW_URL).href;
  const env = {
    handlers, stores, timers,
    // fetch-toteutus vaihdetaan testikohtaisesti: (url) => Promise<FakeResponse>
    net: () => Promise.reject(new TypeError("offline")),
    fetched: [],
  };
  const cacheObj = (name) => {
    const m = stores.get(name);
    return {
      match: async (r) => m.get(keyOf(r)),
      put: async (r, res) => { m.set(keyOf(r), res); },
      add: async (r) => {
        const res = await ctx.fetch(r);
        if (!res.ok) throw new TypeError("bad status " + res.status);
        m.set(keyOf(r), res);
      },
      addAll: async (list) => {
        const res = await Promise.all(list.map((r) => ctx.fetch(r)));
        if (res.some((x) => !x.ok)) throw new TypeError("addAll failed");
        list.forEach((r, i) => m.set(keyOf(r), res[i]));
      },
    };
  };
  const ctx = {
    self: {
      location: new URL(SW_URL),
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting() {}, clients: { claim: async () => {} },
    },
    caches: {
      open: async (name) => { if (!stores.has(name)) stores.set(name, new Map()); return cacheObj(name); },
      match: async (r) => {
        for (const m of stores.values()) { const hit = m.get(keyOf(r)); if (hit) return hit; }
        return undefined;
      },
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    fetch: (r) => { const url = keyOf(r); env.fetched.push(url); return env.net(url); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { timers[id - 1] = null; },
    URL, Response: FakeResponse, Promise, console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  env.cacheName = vm.runInContext("CACHE", ctx);
  env.fireTimers = () => { const fns = timers.splice(0); for (const f of fns) if (f) f(); };
  env.seed = async (url, body) => {
    const c = await ctx.caches.open(env.cacheName);
    await c.put(url, new FakeResponse(body));
  };
  env.cached = (url) => {
    const m = stores.get(env.cacheName);
    return (m && m.get(keyOf(url))) || null;
  };
  env.cachedBody = (url) => (env.cached(url) || {}).body;
  // Lähettää fetch-tapahtuman; palauttaa vastauslupauksen ja waitUntil-lupaukset.
  env.request = (url, mode = "no-cors") => {
    const waits = [];
    let response = null;
    const e = {
      request: { url: new URL(url, SW_URL).href, method: "GET", mode },
      respondWith: (p) => { response = Promise.resolve(p); },
      waitUntil: (p) => { waits.push(p); },
    };
    handlers.fetch(e);
    return { response, settled: async () => { for (let i = 0; i < waits.length; i++) await waits[i]; } };
  };
  return env;
}

(async () => {
  // --- Navigaatio: app shell kyselyparametreista riippumatta ---

  let env = makeEnv();
  await env.seed("./", "<shell v1>");
  let r = env.request("/?f=tuska2026", "navigate");
  t("offline navigation with ?f= gets the cached shell", ((await r.response) || {}).body === "<shell v1>");

  r = env.request("/index.html?f=ruisrock2026&now=2026-07-04T20:00", "navigate");
  t("offline navigation to index.html?… gets the cached shell", ((await r.response) || {}).body === "<shell v1>");

  env = makeEnv();
  await env.seed("./", "<shell v1>");
  env.net = async () => new FakeResponse("<shell v2>");
  r = env.request("/?f=hellsinki2026", "navigate");
  t("online navigation is served from cache first", ((await r.response) || {}).body === "<shell v1>");
  await r.settled();
  t("background refresh updates the shell entry", env.cachedBody("./") === "<shell v2>");
  t("background refresh does not store a per-query copy", !env.cached("/?f=hellsinki2026"));

  env = makeEnv();
  env.net = async () => new FakeResponse("<shell fresh>");
  r = env.request("/?f=tuska2026", "navigate");
  t("first visit (no cache) navigation goes to the network", ((await r.response) || {}).body === "<shell fresh>");
  await r.settled();
  t("first visit stores the shell for offline use", env.cachedBody("./") === "<shell fresh>");

  env = makeEnv();
  env.net = async () => new FakeResponse("<redirected>", { redirected: true });
  r = env.request("/index.html", "navigate");
  await r.response; await r.settled();
  t("redirected response is not cached as the shell", !env.cached("./"));

  env = makeEnv();
  r = env.request("/?f=tuska2026", "navigate");
  t("offline with nothing cached -> network error response, no throw", ((await r.response) || {}).type === "error");

  // --- Muut tiedostot: cache-first, ei shell-kohtelua ---

  env = makeEnv();
  await env.seed("./qr.js", "qr v1");
  await env.seed("./", "<shell>");
  r = env.request("/qr.js");
  t("asset served from cache", ((await r.response) || {}).body === "qr v1");
  env.net = async () => new FakeResponse("<shell>", { status: 404 });
  r = env.request("/icon-192.png");
  t("non-navigation request never gets the shell", ((await r.response) || {}).status === 404);
  await r.settled();
  t("error response is not cached", !env.cached("./icon-192.png"));

  // --- *.json: network-first aikakatkaisulla ---

  env = makeEnv();
  await env.seed("./data-tuska2026.json", '{"v":1}');
  env.net = async () => new FakeResponse('{"v":2}');
  r = env.request("/data-tuska2026.json");
  t("json online -> fresh network copy", ((await r.response) || {}).body === '{"v":2}');
  await r.settled();
  t("json online -> cache updated", env.cachedBody("./data-tuska2026.json") === '{"v":2}');

  env = makeEnv();
  await env.seed("./festivals.json", "cached");
  r = env.request("/festivals.json");
  t("json offline -> cached copy", ((await r.response) || {}).body === "cached");

  env = makeEnv();
  await env.seed("./festivals.json", "cached");
  env.net = async () => new FakeResponse("server error", { status: 500 });
  r = env.request("/festivals.json");
  t("json 500 -> cached copy", ((await r.response) || {}).body === "cached");
  await r.settled();
  t("json 500 does not replace the cached copy", env.cachedBody("./festivals.json") === "cached");

  env = makeEnv();
  env.net = async () => new FakeResponse("not found", { status: 404 });
  r = env.request("/data-missing.json");
  t("json error without a cached copy -> the error response", ((await r.response) || {}).status === 404);

  env = makeEnv();
  r = env.request("/data-missing.json");
  t("json offline without a cached copy -> network error response", ((await r.response) || {}).type === "error");

  // Hidas verkko ("lie-fi"): vastataan välimuistista aikakatkaisun jälkeen,
  // ja myöhässä saapuva vastaus päivittää välimuistin taustalla.
  env = makeEnv();
  await env.seed("./data-tuska2026.json", "stale");
  let slow = deferred();
  env.net = () => slow.promise;
  r = env.request("/data-tuska2026.json");
  let answered = null;
  r.response.then((res) => { answered = res; });
  await flush();
  t("slow json: still waiting before the timeout", answered === null && env.timers.length === 1);
  env.fireTimers(); await flush();
  t("slow json: cached copy served after the timeout", answered && answered.body === "stale");
  slow.resolve(new FakeResponse("fresh")); await r.settled();
  t("slow json: late network response refreshes the cache", env.cachedBody("./data-tuska2026.json") === "fresh");

  // Hidas verkko ilman välimuistikopiota: odotetaan verkkoa aikakatkaisun yli.
  env = makeEnv();
  slow = deferred();
  env.net = () => slow.promise;
  r = env.request("/data-new.json");
  answered = null;
  r.response.then((res) => { answered = res; });
  env.fireTimers(); await flush();
  t("slow json without cache: keeps waiting after the timeout", answered === null);
  slow.resolve(new FakeResponse("first")); await flush(); await flush();
  t("slow json without cache: network response delivered", answered && answered.body === "first");

  // Nopea verkko: aikakatkaisu perutaan (ei turhaa välimuistihakua myöhemmin).
  env = makeEnv();
  env.net = async () => new FakeResponse("quick");
  r = env.request("/festivals.json");
  await r.response;
  t("fast json clears its timeout", env.timers.every((f) => f === null));

  // --- Install: precache + rekisteristä generoidut datatiedostot ---

  env = makeEnv();
  const registry = { festivals: [
    { id: "a", data: "data-tuska2026.json" },   // jo ASSETS-listalla
    { id: "b", data: "data-new2027.json" },     // puuttuu ASSETSista -> lisätään
    { id: "c", data: "data-notdeployed.json" }, // 404 -> ohitetaan, asennus ei kaadu
  ] };
  env.net = async (url) => {
    if (url.endsWith("/festivals.json")) return new FakeResponse(JSON.stringify(registry));
    if (url.endsWith("/data-notdeployed.json")) return new FakeResponse("nope", { status: 404 });
    return new FakeResponse("ok " + url);
  };
  let installed = null;
  env.handlers.install({ waitUntil: (p) => { installed = p; } });
  let installOk = true;
  try { await installed; } catch (e) { installOk = false; }
  t("install succeeds despite a missing registry data file", installOk);
  t("install precaches the shell", !!env.cached("./"));
  t("install adds registry data files missing from ASSETS", !!env.cached("./data-new2027.json"));
  t("install skips the 404 data file", !env.cached("./data-notdeployed.json"));

  console.log(pass + " passed, " + fail + " failed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
