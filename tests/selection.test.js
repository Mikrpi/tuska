#!/usr/bin/env node
/* Unit tests for the selection encode/decode/restore logic in index.html.
 * The app script is extracted from index.html and run in a vm sandbox with
 * stubbed browser APIs, so the logic is tested exactly as shipped — no build
 * step, no test framework, no dependencies.
 *
 * Run:  node tests/selection.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("FAIL: could not extract <script> from index.html"); process.exit(1); }
// init() käynnistyy DOMContentLoaded-tapahtumasta; testit ajavat funktioita suoraan.
const src = m[1].replace(/document\.addEventListener\("DOMContentLoaded", init\);/, "");

// Selain-APIen tyngät: vain se mitä ylätason koodi ja testattavat funktiot koskevat.
const state = { confirmAnswer: true, confirmCalls: [], store: {} };
const stubEl = () => ({
  setAttribute() {}, appendChild() {}, style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
});
const ctx = {
  document: {
    addEventListener() {}, getElementById: stubEl, createElement: stubEl,
    querySelector: () => null, documentElement: { dataset: {} }, title: "",
    body: { classList: { toggle() {} } },
  },
  location: { search: "", hash: "", pathname: "/" },
  history: { replaceState() {} },
  localStorage: {
    getItem: (k) => (k in state.store ? state.store[k] : null),
    setItem: (k, v) => { state.store[k] = v; },
  },
  navigator: {},
  window: { addEventListener() {} },
  confirm: (msg) => { state.confirmCalls.push(msg); return state.confirmAnswer; },
  setInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
  fetch: () => Promise.reject(new Error("network disabled in tests")),
  console, Uint8Array, Math, JSON, state,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  // atob joka hylkää roskasyötteen kuten selaimen atob (Bufferin oma on liian salliva).
  atob: (s) => {
    const b = Buffer.from(s, "base64");
    if (b.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) throw new Error("bad base64");
    return b.toString("binary");
  },
};
vm.createContext(ctx);

// String.raw: testikoodi kulkee vm:ään merkilleen sellaisenaan (escapeja ei
// prosessoida tässä ulommassa tiedostossa, vasta sisemmässä skriptissä).
const tests = String.raw`
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };

DATA = { acts: Array.from({length:60},(_,i)=>({id:i})), days: [] };

// --- encode/decode ---

// round-trip uudella "<count>.<mask>"-muodolla
selected.clear(); [0,5,33,59].forEach(i=>selected.add(i));
const code = encodeSelection();
t("encode has count prefix", code.startsWith("60."));
const back = decodeToSet(code);
t("round-trip", back && back.size===4 && [0,5,33,59].every(i=>back.has(i)));

// tyhjä valinta <-> tyhjä koodi
selected.clear();
t("empty selection -> empty code", encodeSelection()==="");
t("empty code -> empty set", decodeToSet("").size===0);

// legacy-koodi (ei count-etuliitettä) hyväksytään ilman tarkistusta
const legacyBytes = new Uint8Array(8); legacyBytes[0]=0b100001; // idt 0 ja 5
let legacyBin = ""; for (const b of legacyBytes) legacyBin += String.fromCharCode(b);
const legacy = btoa(legacyBin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const l = decodeToSet(legacy);
t("legacy decode", l && l.size===2 && l.has(0) && l.has(5));

// väärä actien määrä -> null (ohjelma muuttunut linkin luonnin jälkeen)
selected.clear(); selected.add(1);
const c60 = encodeSelection();
DATA = { acts: Array.from({length:61},(_,i)=>({id:i})), days: [] };
t("count mismatch -> null", decodeToSet(c60)===null);
DATA = { acts: Array.from({length:60},(_,i)=>({id:i})), days: [] };

// viallinen syöte -> null (ei hiljaista tyhjää valintaa)
t("corrupt new-format -> null", decodeToSet("60.!!!")===null);
t("corrupt legacy -> null", decodeToSet("%%%")===null);

// --- restoreSelection: jaettu linkki vs. oma varmuuskopio (vertailutila) ---

activeFestival = "test";

// ristiriita -> vertailutila: omat jäävät voimaan, kaverin valinnat compare-tilaan
selected.clear(); [1,2].forEach(i=>selected.add(i));
state.store["festival-picks:test"] = encodeSelection(); // oma: {1,2}
selected.clear(); [3,4,5].forEach(i=>selected.add(i));
location.hash = "#s=" + encodeSelection() + "&n=" + encodeURIComponent("Mikon lauantai"); // jaettu
compare = null;
restoreSelection();
t("conflict -> own kept", selected.size===2 && selected.has(1) && selected.has(2));
t("conflict -> compare mode entered", compare && compare.picks.size===3 && compare.picks.has(3));
t("compare carries the shared name", compare && compare.name==="Mikon lauantai");

// mineIds: vertailutilassa unioni, muuten omat
t("mineIds is union in compare mode", mineIds().length===5);
compare = null;
t("mineIds is own picks normally", mineIds().length===2);

// linkki identtinen oman kanssa -> ei vertailutilaa; myös aiempi vertailu
// päättyy (hashchange-polku: uusi liitetty linkki korvaa edellisen vertailun)
selected.clear(); [1,2].forEach(i=>selected.add(i));
state.store["festival-picks:test"] = encodeSelection();
compare = { picks: new Set([9]), name: "old" }; // jäänne edellisestä vertailusta
location.hash = "#s=" + encodeSelection();
restoreSelection();
t("no compare when same", compare===null && selected.size===2);

// oma valinta tyhjä -> jaettu otetaan käyttöön ilman vertailua
state.store["festival-picks:test"] = "";
selected.clear(); selected.add(7);
location.hash = "#s=" + encodeSelection();
restoreSelection();
t("empty own -> shared adopted, no compare", compare===null && selected.has(7));

// eri ohjelmaversion linkki -> hylätään, omat säilyvät
selected.clear(); [1,2].forEach(i=>selected.add(i));
state.store["festival-picks:test"] = encodeSelection();
location.hash = "#s=61.AAAB";
restoreSelection();
t("stale link -> own kept", compare===null && selected.size===2 && selected.has(1));

// tyhjän valinnan linkki ei pyyhi omia valintoja
location.hash = "#s=60.AAAAAAAAAA";
restoreSelection();
t("empty shared -> own kept", compare===null && selected.size===2 && selected.has(1));

// ei linkkiä -> oma varmuuskopio
location.hash = "";
selected.clear();
restoreSelection();
t("no link -> local backup", selected.size===2 && selected.has(2));

// ennen count-etuliitettä tallennettu varmuuskopio kelpaa yhä
state.store["festival-picks:test"] = legacy; // idt 0 ja 5
location.hash = "";
restoreSelection();
t("legacy localStorage backup accepted", selected.size===2 && selected.has(0) && selected.has(5));

// --- nimi jaetussa linkissä (#...&n=...) ---

location.hash = "#s=60.AAAB&n=" + encodeURIComponent("Ääkkös & <nimi>");
t("nameParam decodes", nameParam()==="Ääkkös & <nimi>");
location.hash = "#s=60.AAAB";
t("nameParam empty when absent", nameParam()==="");
location.hash = "#n=" + "x".repeat(200) + "&s=60.AAAB";
t("nameParam is length-capped", nameParam().length===60);
t("hashCode finds s after n", hashCode()==="60.AAAB");
location.hash = "#s=60.AAAB&n=%E0%A4%A"; // rikkinäinen URI-koodaus
t("broken name encoding -> empty, no throw", nameParam()==="");

// syncUrl kirjoittaa nimen hashiin vain kun valintoja on
let writtenUrl = "";
history.replaceState = (a, b, url) => { writtenUrl = url; };
myName = "Testi Nimi";
selected.clear(); selected.add(1);
syncUrl();
t("syncUrl writes name", writtenUrl.includes("&n=Testi%20Nimi"));
selected.clear();
syncUrl();
t("syncUrl omits name without picks", !writtenUrl.includes("&n="));
myName = "";

// --- artistihaku ---

searchQuery = "mega";
t("search matches case-insensitively", matchesSearch({name:"Megadeth"}));
t("search rejects non-match", !matchesSearch({name:"Pain"}));
searchQuery = "";
t("empty search matches all", matchesSearch({name:"Anything"}));

// --- ICS-vienti ---

DATA = {
  festival: "Test Fest 2026",
  stages: ["Main"],
  days: [
    { id:"fri", label:"Friday 26.6.2026", gatesOpen:"14:00", gatesClose:"01:00" },
  ],
  acts: [
    { id:0, name:"Band; A, B\\C", day:"fri", stage:"Main", start:"22:00", end:"23:00" },
    { id:1, name:"Nightcap", day:"fri", stage:"Main", start:"00:30", end:"01:00" },
  ],
};
activeFestival = "testfest";
selected.clear(); selected.add(0); selected.add(1);
const ics = buildIcs();
t("ICS has calendar wrapper", ics.startsWith("BEGIN:VCALENDAR") && ics.trimEnd().endsWith("END:VCALENDAR"));
t("ICS has both events", (ics.match(/BEGIN:VEVENT/g)||[]).length===2);
t("ICS escapes special chars", ics.includes("SUMMARY:Band\\; A\\, B\\\\C"));
t("ICS event time correct", ics.includes("DTSTART:20260626T220000") && ics.includes("DTEND:20260626T230000"));
t("ICS after-midnight act on next calendar day", ics.includes("DTSTART:20260627T003000"));
t("ICS uses CRLF", ics.includes("\r\n"));
t("ICS location has stage and festival", ics.includes("LOCATION:Main\\, Test Fest 2026"));

// --- clash-logiikka (yön yli menevät ajat) ---

DATA = { acts: [
  { id:0, name:"A", day:"fri", stage:"S", start:"22:00", end:"23:30" },
  { id:1, name:"B", day:"fri", stage:"T", start:"23:00", end:"00:30" }, // limittyy A:n kanssa
  { id:2, name:"C", day:"fri", stage:"U", start:"00:30", end:"01:30" }, // aamuyö, ei limity
  { id:3, name:"D", day:"sat", stage:"S", start:"22:30", end:"23:30" }, // eri päivä
], days: [] };
selected.clear(); [0,1,2,3].forEach(i=>selected.add(i));
const clash = clashingIds();
t("overlap across midnight detected", clash.has(0) && clash.has(1));
t("non-overlapping early-hours act not flagged", !clash.has(2));
t("different day not flagged", !clash.has(3));

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exitCode = 1;
`;

ctx.process = { exitCode: 0, get exit() { return undefined; } };
vm.runInContext(src + "\n" + tests, ctx);
process.exitCode = ctx.process.exitCode;
