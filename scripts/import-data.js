#!/usr/bin/env node
/* Imports a festival line-up from a CSV/TSV table into data-<id>.json,
 * numbering act ids automatically (0..N-1, MAINTENANCE.md critical rule 1).
 * No dependencies.
 *
 * Usage:  node scripts/import-data.js <festival-id> <input.csv> [--prune] [--dry-run]
 *
 * Input: a header row with the columns day,stage,start,end,name (any order,
 * extra columns ignored), then one row per act. The delimiter (tab, semicolon
 * or comma) is detected from the header, so pasting from a spreadsheet works.
 * Times accept 14:30 and 14.30; quoted fields ("Pitch, Match") are supported.
 *
 * Fresh import: festival name, info URL and day metadata are asked
 * interactively. Update (data-<id>.json exists): existing act order and ids
 * are preserved, changed acts are updated in place and new acts appended to
 * the end — published links stay valid unless the act count changes, which is
 * reported. Acts missing from the input are kept unless --prune is given.
 * The festival is also registered in festivals.json and the sw.js ASSETS
 * precache list (with a CACHE bump) if missing, and validate-data.js runs at
 * the end. --dry-run reports everything but writes nothing.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Samat aikasäännöt kuin index.html:ssä ja validate-data.js:ssä.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const DAY_CUTOFF = 12 * 60; // ennen klo 12 = saman festari-illan aamuyötä
const eveMin = (t) => { const m = toMin(t); return m < DAY_CUTOFF ? m + 1440 : m; };

// --- Parsing ---------------------------------------------------------------

// Hyväksy 14:30, 14.30, 9:05 → normalisoi "HH:MM"; muu → null.
function normTime(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return null;
  const t = `${m[1].padStart(2, "0")}:${m[2]}`;
  return HHMM.test(t) ? t : null;
}

// Yksi rivi soluiksi; tukee "..."-lainauksen (sisällä "" = lainausmerkki).
function splitLine(line, delim) {
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"' && cur === "") {
      inQ = true;
    } else if (ch === delim) {
      cells.push(cur.trim()); cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const REQUIRED = ["day", "stage", "start", "end", "name"];

/* Parsii CSV/TSV-tekstin. Erotin tunnistetaan otsikkorivistä: se ehdokas
 * (sarkain, puolipiste, pilkku), jolla kaikki vaaditut otsikot löytyvät.
 * Palauttaa { rows, warnings, errors }; rows-alkiot { day, stage, start, end,
 * name, line } syötteen rivijärjestyksessä. */
function parseTable(text) {
  const errors = [], warnings = [];
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);

  let hi = 0;
  while (hi < lines.length && !lines[hi].trim()) hi++;
  if (hi >= lines.length) return { rows: [], warnings, errors: ["input is empty"] };

  let delim = null, header = null;
  for (const d of ["\t", ";", ","]) {
    const cells = splitLine(lines[hi], d).map((c) => c.toLowerCase());
    if (REQUIRED.every((r) => cells.includes(r))) { delim = d; header = cells; break; }
  }
  if (!delim) {
    return { rows: [], warnings, errors: [
      `line ${hi + 1}: header must contain the columns ${REQUIRED.join(",")} ` +
      `(tab-, semicolon- or comma-separated); got: ${lines[hi].trim()}`,
    ] };
  }
  const extra = header.filter((h) => !REQUIRED.includes(h));
  if (extra.length) warnings.push(`ignoring extra column(s): ${extra.join(", ")}`);
  const col = {};
  for (const r of REQUIRED) col[r] = header.indexOf(r);

  const rows = [];
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const where = `line ${i + 1}`;
    const cells = splitLine(lines[i], delim);
    const row = { line: i + 1 };
    for (const r of REQUIRED) row[r] = cells[col[r]] || "";

    let ok = true;
    for (const r of ["day", "stage", "name"]) {
      if (!row[r]) { errors.push(`${where}: empty "${r}"`); ok = false; }
    }
    for (const r of ["start", "end"]) {
      const t = normTime(row[r]);
      if (!t) { errors.push(`${where}: "${r}" ("${row[r]}") must be HH:MM (24h)`); ok = false; }
      else row[r] = t;
    }
    if (ok && eveMin(row.start) >= eveMin(row.end)) {
      errors.push(`${where}: start must be before end (${row.start}–${row.end}; ` +
        `times before 12:00 count as the night's early hours)`);
      ok = false;
    }
    if (ok) rows.push(row);
  }
  if (!rows.length && !errors.length) errors.push("no act rows after the header");
  return { rows, warnings, errors };
}

// --- Merging ----------------------------------------------------------------

// Sama esiintyjä voi soittaa kahdesti samana päivänä, joten avaimen osumat
// paritetaan järjestyksessä (1. syöterivi ↔ 1. olemassa oleva jne.).
const actKey = (a) => `${a.day}\u0000${a.name.trim().toLowerCase()}`;

/* Yhdistää uudet rivit olemassa oleviin acteihin. Kriittinen sääntö: julkaistua
 * järjestystä ei muuteta — vanhat actit pitävät paikkansa (ja siten bittimaski-
 * indeksinsä), uudet lisätään loppuun. Id:t numeroidaan lopuksi 0..N-1.
 * Palauttaa { acts, report: { added, updated, unchanged, missing, pruned } }. */
function mergeActs(existing, rows, opts = {}) {
  const bucket = new Map(); // key → jono uusia rivejä
  for (const r of rows) {
    const k = actKey(r);
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(r);
  }

  const report = { added: [], updated: [], unchanged: [], missing: [], pruned: [] };
  const kept = [];
  for (const a of existing) {
    const q = bucket.get(actKey(a));
    const r = q && q.length ? q.shift() : null;
    if (!r) {
      (opts.prune ? report.pruned : report.missing).push(a.name);
      if (!opts.prune) kept.push({ ...a });
      continue;
    }
    const changed = a.stage !== r.stage || a.start !== r.start || a.end !== r.end || a.name !== r.name;
    kept.push({ ...a, name: r.name, stage: r.stage, start: r.start, end: r.end });
    (changed ? report.updated : report.unchanged).push(r.name);
  }
  for (const r of rows) { // lisäykset syötteen järjestyksessä
    const q = bucket.get(actKey(r));
    if (q.length && q[0] === r) { q.shift(); report.added.push(r.name); kept.push(r); }
  }

  const acts = kept.map((a, i) => ({ id: i, name: a.name, day: a.day, stage: a.stage, start: a.start, end: a.end }));
  return { acts, report };
}

// Päivät aikajärjestykseen labelin päivämäärän mukaan (validator varoittaa muusta).
function sortDays(days) {
  const key = (d) => {
    const m = String(d.label || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : Infinity;
  };
  return days.slice().sort((a, b) => key(a) - key(b));
}

// Lavat: vanha järjestys säilyy (se on By stage -näkymän esitysjärjestys),
// uudet lavat perään siinä järjestyksessä kuin syöte ne ensi kertaa mainitsee.
function collectStages(existingStages, acts) {
  const stages = [...existingStages];
  const seen = new Set(stages);
  for (const a of acts) {
    if (!seen.has(a.stage)) { seen.add(a.stage); stages.push(a.stage); }
  }
  return stages;
}

// --- Output formatting ------------------------------------------------------

// Sama muotoilu kuin käsin ylläpidetyissä datatiedostoissa: stages yhdellä
// rivillä, days ja acts yksi olio per rivi.
function formatData(d) {
  const j = JSON.stringify;
  const one = (o) => `    { ${Object.entries(o).map(([k, v]) => `${j(k)}: ${j(v)}`).join(", ")} }`;
  const lines = [`  "festival": ${j(d.festival)}`];
  if (d.infoUrl) lines.push(`  "infoUrl": ${j(d.infoUrl)}`);
  lines.push(`  "stages": [${d.stages.map((s) => j(s)).join(", ")}]`);
  lines.push(`  "days": [\n${d.days.map(one).join(",\n")}\n  ]`);
  // Tyhjä rivi päivien väliin kuten käsin ylläpidetyissä tiedostoissa.
  const acts = d.acts.map((a, i) =>
    (i && a.day !== d.acts[i - 1].day ? "\n" : "") + one(a)).join(",\n");
  lines.push(`  "acts": [\n${acts}\n  ]`);
  return `{\n${lines.join(",\n")}\n}\n`;
}

// --- Registration (festivals.json + sw.js) ----------------------------------

// Lisää festarin festivals.json-listaan (loppuun — ensimmäinen on oletus,
// eikä työkalu ota kantaa siihen). Palauttaa uuden sisällön tai null jos jo on.
function registerFestival(regText, entry) {
  const reg = JSON.parse(regText);
  if (reg.festivals.some((f) => f.id === entry.id)) return null;
  reg.festivals.push({ id: entry.id, name: entry.name, data: entry.data });
  const rows = reg.festivals.map((f) =>
    "    " + JSON.stringify(f).replace(/([{,])"/g, '$1 "').replace(/:"/g, ': "').replace(/}$/, " }"));
  return `{\n  "festivals": [\n${rows.join(",\n")}\n  ]\n}\n`;
}

/* Lisää datatiedoston sw.js:n ASSETS-listaan ja nostaa CACHE-versiota (sw.js
 * muuttuu, joten versio on nostettava — ks. MAINTENANCE.md). Palauttaa
 * { text, cache } tai null jos tiedosto on jo listalla. */
function addToPrecache(swText, dataFile) {
  if (swText.includes(`"./${dataFile}"`)) return null;
  const block = swText.match(/const ASSETS = \[([\s\S]*?)\]/);
  if (!block) throw new Error("sw.js: could not find the ASSETS list");
  const dataLines = [...block[1].matchAll(/^(\s*)"\.\/data-[^"]+",\s*$/gm)];
  if (!dataLines.length) throw new Error("sw.js: no data-*.json entries in ASSETS to anchor on");
  const last = dataLines[dataLines.length - 1];
  const insertAt = swText.indexOf(block[1]) + last.index + last[0].length;
  let text = swText.slice(0, insertAt) + `\n${last[1]}"./${dataFile}",` + swText.slice(insertAt);

  const cm = text.match(/const CACHE = "(.+?-v)(\d+)"/);
  if (!cm) throw new Error("sw.js: could not find the CACHE constant to bump");
  const cache = `${cm[1]}${+cm[2] + 1}`;
  text = text.replace(cm[0], `const CACHE = "${cache}"`);
  return { text, cache };
}

module.exports = { normTime, splitLine, parseTable, mergeActs, sortDays, collectStages, formatData, registerFestival, addToPrecache, eveMin };

// --- CLI ---------------------------------------------------------------------

if (require.main === module) main();

async function main() {
  const args = process.argv.slice(2);
  const prune = args.includes("--prune");
  const dryRun = args.includes("--dry-run");
  const pos = args.filter((a) => !a.startsWith("--"));
  const [id, input] = pos;
  if (pos.length !== 2) {
    console.error("Usage: node scripts/import-data.js <festival-id> <input.csv> [--prune] [--dry-run]");
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error(`festival id "${id}" must be URL-safe lowercase ([a-z0-9-]) — it is used in ?f= and localStorage keys`);
    process.exit(1);
  }

  let text;
  try { text = fs.readFileSync(input, "utf8"); }
  catch (e) { console.error(`cannot read ${input}: ${e.message}`); process.exit(1); }

  const { rows, warnings, errors } = parseTable(text);
  for (const w of warnings) console.log(`WARN  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`);
    process.exit(1);
  }

  const dataFile = `data-${id}.json`;
  const dataPath = path.join(ROOT, dataFile);
  const prev = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : null;
  console.log(prev
    ? `Updating ${dataFile} (${prev.acts.length} existing acts — order and ids are preserved)`
    : `Creating ${dataFile}`);

  // Omaa rivipuskurointia: readline pudottaa putkitetut rivit, jotka saapuvat
  // kahden question()-kutsun välissä, joten skriptattu syöte (printf ... |)
  // jäisi muuten jumiin. 'line'-kuuntelija jonottaa etuajassa tulleet rivit.
  const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
  const pendingLines = [], waiters = [];
  let stdinClosed = false;
  rl.on("line", (l) => { const w = waiters.shift(); w ? w(l) : pendingLines.push(l); });
  rl.on("close", () => { stdinClosed = true; for (const w of waiters.splice(0)) w(null); });
  const question = (q) => {
    process.stdout.write(q);
    if (pendingLines.length) return Promise.resolve(pendingLines.shift());
    if (stdinClosed) return Promise.resolve(null);
    return new Promise((res) => waiters.push(res));
  };
  const ask = async (q, validate, dflt) => {
    for (;;) {
      const line = await question(dflt ? `${q} [${dflt}]: ` : `${q}: `);
      if (line === null) { // stdin loppui kesken — ei hiljaista onnistumista
        console.error("\nERROR input ended before all prompts were answered");
        process.exit(1);
      }
      const raw = line.trim() || dflt || "";
      const v = validate(raw);
      if (v !== null && v !== undefined) return v;
      console.log("  invalid, try again");
    }
  };

  // Metatiedot: uudelle festarille kysytään, päivityksessä vanhat säilyvät.
  const suggestedName = id.replace(/(\d{4})$/, " $1").replace(/(^|[ -])[a-z]/g, (c) => c.toUpperCase());
  const festival = prev ? prev.festival
    : await ask("Festival display name", (s) => s || null, suggestedName);
  const infoUrl = prev ? prev.infoUrl
    : await ask("Info URL (Enter to skip)", (s) => (!s || /^https?:\/\//.test(s)) ? s : null) || undefined;

  // Uudet päivät: label (d.m.yyyy pakollinen, sääntö 2) ja porttiajat (sääntö 5).
  const days = prev ? [...prev.days] : [];
  const known = new Set(days.map((d) => d.id));
  for (const r of rows) {
    if (known.has(r.day)) continue;
    known.add(r.day);
    console.log(`New day "${r.day}":`);
    const label = await ask(`  label with a d.m.yyyy date (e.g. "Friday 25.6.2027")`, (s) => {
      const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!m) return null;
      const dt = new Date(+m[3], +m[2] - 1, +m[1]);
      return (dt.getDate() === +m[1] && dt.getMonth() === +m[2] - 1) ? s : null;
    });
    const gatesOpen = await ask("  gates open (HH:MM)", normTime);
    const gatesClose = await ask("  gates close (HH:MM)", (s) => {
      const t = normTime(s);
      return t && eveMin(t) > eveMin(gatesOpen) ? t : null;
    });
    days.push({ id: r.day, label, gatesOpen, gatesClose });
  }
  rl.close();

  const { acts, report } = mergeActs(prev ? prev.acts : [], rows, { prune });
  const data = {
    festival, infoUrl,
    stages: collectStages(prev ? prev.stages : [], acts),
    days: sortDays(days),
    acts,
  };

  console.log(`\n${report.added.length} added, ${report.updated.length} updated, ` +
    `${report.unchanged.length} unchanged` +
    (report.missing.length ? `, ${report.missing.length} missing from input (kept: ${report.missing.join(", ")})` : "") +
    (report.pruned.length ? `, ${report.pruned.length} pruned: ${report.pruned.join(", ")}` : ""));
  if (prev && acts.length !== prev.acts.length) {
    console.log(`NOTE  act count changed ${prev.acts.length} → ${acts.length}: ` +
      `already-shared links will be rejected with a notice (see MAINTENANCE.md)`);
  }

  // Rekisteröinti: festivals.json + sw.js:n precache-lista.
  const regPath = path.join(ROOT, "festivals.json");
  const newReg = registerFestival(fs.readFileSync(regPath, "utf8"), { id, name: festival, data: dataFile });
  const swPath = path.join(ROOT, "sw.js");
  const newSw = addToPrecache(fs.readFileSync(swPath, "utf8"), dataFile);

  if (dryRun) {
    console.log(`\nDry run — would write ${dataFile} (${acts.length} acts)` +
      (newReg ? `, register in festivals.json` : "") +
      (newSw ? `, add to sw.js ASSETS and bump CACHE to "${newSw.cache}"` : ""));
    process.exit(0);
  }

  fs.writeFileSync(dataPath, formatData(data));
  console.log(`Wrote ${dataFile} (${acts.length} acts)`);
  if (newReg) {
    fs.writeFileSync(regPath, newReg);
    console.log(`Registered "${id}" in festivals.json (added last — reorder manually if it should be the default; a "theme" can also be added there, see MAINTENANCE.md)`);
  }
  if (newSw) {
    fs.writeFileSync(swPath, newSw.text);
    console.log(`Added ${dataFile} to sw.js ASSETS and bumped CACHE to "${newSw.cache}"`);
  }

  // Lopuksi sama tarkistus, jonka CI ajaa — virheet näkyvät heti tässä ajossa.
  console.log("\nRunning validate-data.js …");
  const res = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "validate-data.js")], { stdio: "inherit" });
  process.exit(res.status || 0);
}
