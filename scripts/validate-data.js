#!/usr/bin/env node
/* Validates festivals.json, every data-<id>.json and the sw.js precache list
 * against the critical rules in MAINTENANCE.md. No dependencies.
 *
 * Run from anywhere:  node scripts/validate-data.js
 * Exit code 0 = OK (warnings allowed), 1 = errors found.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
// Sama vuorokausiraja kuin index.html:ssä: ennen klo 12 = saman festari-illan
// aamuyötä (seuraava kalenteripäivä), joten siihen lisätään 24 h vertailuissa.
const DAY_CUTOFF = 12 * 60;
const eveMin = (t) => { const m = toMin(t); return m < DAY_CUTOFF ? m + 1440 : m; };

function readJson(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { err(file, "file does not exist"); return null; }
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    return null;
  }
}

// --- festivals.json -------------------------------------------------------

const REG_FILE = "festivals.json";
const reg = readJson(REG_FILE);
const festivals = (reg && Array.isArray(reg.festivals)) ? reg.festivals : null;
if (reg && !festivals) err(REG_FILE, `"festivals" must be a non-empty array`);
if (festivals && !festivals.length) err(REG_FILE, `"festivals" is empty — the app cannot start`);

// Teemat luetaan index.html:stä: :root = steel + jokainen [data-theme="..."]-lohko.
const knownThemes = new Set(["steel"]);
try {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const m of html.matchAll(/\[data-theme="([^"]+)"\]/g)) knownThemes.add(m[1]);
} catch (e) {
  warn("index.html", `could not read for theme check: ${e.message}`);
}

const seenIds = new Set();
for (const f of festivals || []) {
  const where = `${REG_FILE} (id "${f.id}")`;
  if (!f.id || typeof f.id !== "string") { err(REG_FILE, `festival entry without a string "id": ${JSON.stringify(f)}`); continue; }
  if (seenIds.has(f.id)) err(REG_FILE, `duplicate festival id "${f.id}"`);
  seenIds.add(f.id);
  if (!/^[a-z0-9-]+$/.test(f.id)) warn(where, `id should be URL-safe lowercase ([a-z0-9-]) — it is used in ?f= and localStorage keys`);
  if (!f.name || typeof f.name !== "string") err(where, `missing "name"`);
  if (!f.data || typeof f.data !== "string") err(where, `missing "data" file reference`);
  if (f.theme && !knownThemes.has(f.theme)) {
    warn(where, `theme "${f.theme}" has no matching [data-theme] block in index.html — falls back to steel`);
  }
}

// --- data-<id>.json -------------------------------------------------------

function validateData(file) {
  const d = readJson(file);
  if (!d) return;

  if (!d.festival || typeof d.festival !== "string") err(file, `missing "festival" name`);

  // Lavat
  const stages = Array.isArray(d.stages) ? d.stages : null;
  if (!stages || !stages.length) err(file, `"stages" must be a non-empty array`);
  const stageSet = new Set(stages || []);
  if (stages && stageSet.size !== stages.length) err(file, `"stages" contains duplicates`);

  // Päivät
  const days = Array.isArray(d.days) ? d.days : null;
  if (!days || !days.length) err(file, `"days" must be a non-empty array`);
  const dayIds = new Set();
  const dayById = {};
  let prevDate = null;
  for (const day of days || []) {
    const where = `${file} (day "${day.id}")`;
    if (!day.id) { err(file, `day without "id": ${JSON.stringify(day)}`); continue; }
    if (dayIds.has(day.id)) err(file, `duplicate day id "${day.id}"`);
    dayIds.add(day.id);
    dayById[day.id] = day;

    // Sääntö 2: labelissa on oltava päivämäärä d.m.yyyy (past/live-logiikka lukee sen).
    const m = String(day.label || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!m) {
      err(where, `label "${day.label}" must contain a date in d.m.yyyy format`);
    } else {
      const date = new Date(+m[3], +m[2] - 1, +m[1]);
      if (date.getDate() !== +m[1] || date.getMonth() !== +m[2] - 1) {
        err(where, `label date "${m[0]}" is not a real calendar date`);
      } else {
        if (prevDate && date <= prevDate) warn(where, `days are not in chronological order`);
        prevDate = date;
      }
    }

    // Sääntö 5: gatesOpen/gatesClose joka päivällä, HH:MM.
    for (const k of ["gatesOpen", "gatesClose"]) {
      if (!HHMM.test(day[k] || "")) err(where, `"${k}" ("${day[k]}") must be HH:MM (24h)`);
    }
    if (HHMM.test(day.gatesOpen || "") && HHMM.test(day.gatesClose || "") &&
        eveMin(day.gatesClose) <= eveMin(day.gatesOpen)) {
      err(where, `gates window is empty or negative (${day.gatesOpen}–${day.gatesClose})`);
    }
  }

  // Actit
  const acts = Array.isArray(d.acts) ? d.acts : null;
  if (!acts || !acts.length) err(file, `"acts" must be a non-empty array`);
  const usedStages = new Set();
  const seenSlots = new Set();
  (acts || []).forEach((a, i) => {
    const where = `${file} (act ${i} "${a.name}")`;
    // Sääntö 1: id = taulukon indeksi, 0..N-1 ilman aukkoja. Jaettava linkki on
    // bittimaski näiden id:iden yli — poikkeama rikkoo kaikki jaetut linkit.
    if (a.id !== i) err(where, `id is ${a.id}, must equal array index ${i} (contiguous 0..N-1)`);
    if (!a.name || typeof a.name !== "string") err(`${file} (act ${i})`, `missing "name"`);

    // Sääntö 4: day-viittaus olemassa olevaan päivään.
    if (!dayIds.has(a.day)) err(where, `references unknown day "${a.day}"`);

    // Sääntö 3: lava löytyy stages-listasta.
    if (!stageSet.has(a.stage)) err(where, `stage "${a.stage}" is not in "stages" — act won't show in the By stage view`);
    usedStages.add(a.stage);

    // Sääntö 6: ajat HH:MM, ja alku ennen loppua yön yli -logiikalla.
    const timesOk = HHMM.test(a.start || "") && HHMM.test(a.end || "");
    if (!timesOk) err(where, `start/end ("${a.start}"–"${a.end}") must be HH:MM (24h)`);
    if (timesOk && eveMin(a.start) >= eveMin(a.end)) {
      err(where, `start must be before end (${a.start}–${a.end}; times before 12:00 count as the night's early hours)`);
    }

    // Porttien ulkopuolella soittava acti on todennäköisesti näppäilyvirhe.
    const day = dayById[a.day];
    if (timesOk && day && HHMM.test(day.gatesOpen || "") && HHMM.test(day.gatesClose || "")) {
      if (eveMin(a.start) < eveMin(day.gatesOpen) || eveMin(a.end) > eveMin(day.gatesClose)) {
        warn(where, `plays outside gates (${a.start}–${a.end} vs gates ${day.gatesOpen}–${day.gatesClose})`);
      }
    }

    // Sama lava, sama päivä, päällekkäinen aika = varmuudella virhe datassa.
    const slot = `${a.day}|${a.stage}`;
    for (const s of seenSlots) {
      const [k, st, en] = s.split("~");
      if (k === slot && timesOk && eveMin(a.start) < +en && +st < eveMin(a.end)) {
        err(where, `overlaps another act on the same stage/day (${a.start}–${a.end})`);
      }
    }
    if (timesOk) seenSlots.add(`${slot}~${eveMin(a.start)}~${eveMin(a.end)}`);
  });

  for (const s of stageSet) {
    if (!usedStages.has(s)) warn(file, `stage "${s}" is listed but no act uses it`);
  }
}

for (const f of festivals || []) {
  if (f.data && typeof f.data === "string") validateData(f.data);
}

// Datatiedosto ilman festivals.json-merkintää ei näy sovelluksessa — luultavasti unohdus.
const registered = new Set((festivals || []).map((f) => f.data));
for (const file of fs.readdirSync(ROOT)) {
  if (/^data-.*\.json$/.test(file) && !registered.has(file)) {
    warn(file, `not registered in ${REG_FILE} — the festival is invisible in the app`);
  }
}

// --- sw.js precache list --------------------------------------------------

const SW_FILE = "sw.js";
try {
  const sw = fs.readFileSync(path.join(ROOT, SW_FILE), "utf8");
  const block = sw.match(/const ASSETS = \[([\s\S]*?)\]/);
  if (!block) {
    err(SW_FILE, "could not find the ASSETS precache list");
  } else {
    const assets = new Set([...block[1].matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]));
    for (const need of ["index.html", REG_FILE]) {
      if (!assets.has(need)) err(SW_FILE, `ASSETS is missing "${need}"`);
    }
    for (const f of festivals || []) {
      if (f.data && !assets.has(f.data)) {
        err(SW_FILE, `ASSETS is missing "${f.data}" — that festival won't be browsable offline (see MAINTENANCE.md)`);
      }
    }
    for (const a of assets) {
      if (!fs.existsSync(path.join(ROOT, a))) err(SW_FILE, `ASSETS references "${a}" which does not exist — install of the whole precache fails`);
    }
  }
} catch (e) {
  err(SW_FILE, `could not read: ${e.message}`);
}

// --- Report ---------------------------------------------------------------

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
