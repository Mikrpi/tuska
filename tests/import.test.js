#!/usr/bin/env node
/* Unit tests for the pure functions in scripts/import-data.js: table parsing,
 * act merging (id stability!), day sorting, stage collection, output format
 * and the registration helpers. The interactive CLI layer is not tested here.
 *
 * Run:  node tests/import.test.js
 */
"use strict";

const {
  normTime, parseTable, mergeActs, sortDays, collectStages,
  formatData, registerFestival, addToPrecache,
} = require("../scripts/import-data.js");

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };

// --- normTime ---

t("normTime pads and accepts a dot", normTime("9.05") === "09:05" && normTime("14.30") === "14:30");
t("normTime keeps HH:MM", normTime("23:59") === "23:59");
t("normTime rejects junk", normTime("25:00") === null && normTime("14h30") === null && normTime("") === null);

// --- parseTable: delimiters and columns ---

const csv = "day,stage,start,end,name\nfri,Main,14:30,15:25,Band A\nfri,Main,16:00,17:00,Band B\n";
let r = parseTable(csv);
t("comma CSV parses", r.errors.length === 0 && r.rows.length === 2 && r.rows[0].name === "Band A");

r = parseTable("day\tstage\tstart\tend\tname\nfri\tMain\t14:30\t15:25\tBand A\n");
t("tab TSV auto-detected", r.errors.length === 0 && r.rows[0].stage === "Main");

r = parseTable("day;stage;start;end;name\nfri;Main;14:30;15:25;Band A\n");
t("semicolon auto-detected", r.errors.length === 0 && r.rows[0].name === "Band A");

r = parseTable("name,start,end,stage,day\nBand A,14:30,15:25,Main,fri\n");
t("column order is free", r.errors.length === 0 && r.rows[0].day === "fri" && r.rows[0].name === "Band A");

r = parseTable("day,stage,start,end,name,notes\nfri,Main,14:30,15:25,Band A,great\n");
t("extra column ignored with a warning", r.errors.length === 0 && r.warnings.length === 1 && !("notes" in r.rows[0]));

r = parseTable('day,stage,start,end,name\nfri,Main,14:30,15:25,"Pitch, Match"\n');
t("quoted field with delimiter", r.errors.length === 0 && r.rows[0].name === "Pitch, Match");

r = parseTable('day,stage,start,end,name\nfri,Main,14:30,15:25,"Say ""hi"""\n');
t("escaped quotes", r.rows[0].name === 'Say "hi"');

r = parseTable("﻿day,stage,start,end,name\r\nfri,Main,14.30,15.25,Band A\r\n\r\n");
t("BOM, CRLF, dot-times, blank lines", r.errors.length === 0 && r.rows.length === 1 && r.rows[0].start === "14:30");

// --- parseTable: errors carry line numbers ---

r = parseTable("artist,when\nBand A,14:30\n");
t("missing headers rejected", r.errors.length === 1 && /line 1/.test(r.errors[0]));

r = parseTable("day,stage,start,end,name\nfri,Main,14:30,15:25,Band A\nfri,,14:30,15:25,Band B\n");
t("empty cell reported with line", r.errors.length === 1 && /line 3.*"stage"/.test(r.errors[0]));

r = parseTable("day,stage,start,end,name\nfri,Main,14:70,15:25,Band A\n");
t("bad time reported with line", r.errors.length === 1 && /line 2/.test(r.errors[0]));

r = parseTable("day,stage,start,end,name\nfri,Main,16:00,15:00,Band A\n");
t("start after end rejected", r.errors.length === 1 && /before end/.test(r.errors[0]));

r = parseTable("day,stage,start,end,name\nfri,Main,23:30,00:15,Band A\n");
t("over-midnight set accepted", r.errors.length === 0);

r = parseTable("day,stage,start,end,name\n");
t("header only rejected", r.errors.length === 1);

// --- mergeActs: the id rules ---

const act = (id, name, day, stage, start, end) => ({ id, name, day, stage, start, end });
const row = (day, stage, start, end, name) => ({ day, stage, start, end, name });

// Tuore tuonti: id:t 0..N-1 syötteen järjestyksessä.
let m = mergeActs([], [row("fri", "Main", "14:30", "15:25", "A"), row("fri", "Main", "16:00", "17:00", "B")]);
t("fresh import numbers 0..N-1", m.acts.length === 2 && m.acts[0].id === 0 && m.acts[1].id === 1 && m.acts[0].name === "A");
t("fresh import reported as added", m.report.added.length === 2);

// Päivitys: aikamuutos ei siirrä actia eikä muuta sen id:tä.
const existing = [act(0, "A", "fri", "Main", "14:30", "15:25"), act(1, "B", "fri", "Main", "16:00", "17:00")];
m = mergeActs(existing, [row("fri", "Main", "16:30", "17:30", "B"), row("fri", "Main", "14:30", "15:25", "A")]);
t("update keeps order and ids", m.acts[0].name === "A" && m.acts[0].id === 0 && m.acts[1].name === "B" && m.acts[1].id === 1);
t("changed time updated in place", m.acts[1].start === "16:30" && m.report.updated.length === 1 && m.report.unchanged.length === 1);

// Uusi acti aina listan loppuun (kriittinen sääntö: ei uudelleenjärjestelyä).
m = mergeActs(existing, [
  row("fri", "Main", "12:30", "13:25", "Opener"),
  row("fri", "Main", "14:30", "15:25", "A"),
  row("fri", "Main", "16:00", "17:00", "B"),
]);
t("new act appended to the end", m.acts.length === 3 && m.acts[2].name === "Opener" && m.acts[2].id === 2);
t("existing ids untouched by append", m.acts[0].name === "A" && m.acts[0].id === 0);

// Syötteestä puuttuva acti säilyy oletuksena, --prune poistaa ja tiivistää id:t.
m = mergeActs(existing, [row("fri", "Main", "14:30", "15:25", "A")]);
t("missing act kept by default", m.acts.length === 2 && m.report.missing[0] === "B");
m = mergeActs(existing, [row("fri", "Main", "16:00", "17:00", "B")], { prune: true });
t("prune removes and renumbers", m.acts.length === 1 && m.acts[0].name === "B" && m.acts[0].id === 0 && m.report.pruned[0] === "A");

// Nimen kirjainkoko: osuma löytyy, uusi kirjoitusasu voittaa.
m = mergeActs([act(0, "band a", "fri", "Main", "14:30", "15:25")], [row("fri", "Main", "14:30", "15:25", "Band A")]);
t("case-insensitive match, new spelling wins", m.acts.length === 1 && m.acts[0].name === "Band A" && m.report.updated.length === 1);

// Sama esiintyjä kahdesti samana päivänä (kaksi settiä) — paritus järjestyksessä.
const twoSets = [act(0, "DJ X", "fri", "Kvlt", "18:00", "19:00"), act(1, "DJ X", "fri", "Kvlt", "23:00", "00:30")];
m = mergeActs(twoSets, [row("fri", "Kvlt", "18:00", "19:00", "DJ X"), row("fri", "Kvlt", "23:30", "01:00", "DJ X")]);
t("double set pairs by order", m.acts.length === 2 && m.acts[0].start === "18:00" && m.acts[1].start === "23:30");

// Sama nimi eri päivänä on eri acti.
m = mergeActs([act(0, "A", "fri", "Main", "14:30", "15:25")], [row("sat", "Main", "14:30", "15:25", "A")]);
t("same name on another day is a new act", m.acts.length === 2 && m.report.added.length === 1 && m.report.missing.length === 1);

// --- sortDays / collectStages ---

const sorted = sortDays([
  { id: "sun", label: "Sunday 28.6.2026", gatesOpen: "14:00", gatesClose: "00:00" },
  { id: "fri", label: "Friday 26.6.2026", gatesOpen: "14:00", gatesClose: "01:00" },
]);
t("days sorted by label date", sorted[0].id === "fri" && sorted[1].id === "sun");

const stages = collectStages(["Main", "Second"], [
  { stage: "Kvlt" }, { stage: "Main" }, { stage: "Kvlt" },
]);
t("stages keep old order, new appended once", stages.join("|") === "Main|Second|Kvlt");

// --- formatData ---

const data = {
  festival: "Test 2027", infoUrl: "https://example.com",
  stages: ["Main"],
  days: [{ id: "fri", label: "Friday 25.6.2027", gatesOpen: "14:00", gatesClose: "01:00" }],
  acts: [act(0, "A", "fri", "Main", "14:30", "15:25")],
};
const out = formatData(data);
const parsed = JSON.parse(out);
t("formatData round-trips", parsed.festival === "Test 2027" && parsed.acts[0].id === 0 && parsed.days[0].gatesClose === "01:00");
t("formatData one act per line", /\n    \{ "id": 0, "name": "A"/.test(out));
t("formatData omits empty infoUrl", !("infoUrl" in JSON.parse(formatData({ ...data, infoUrl: undefined }))));

// --- registerFestival / addToPrecache ---

const regText = `{\n  "festivals": [\n    { "id": "old", "name": "Old", "data": "data-old.json" }\n  ]\n}\n`;
const reg = registerFestival(regText, { id: "new2027", name: "New 2027", data: "data-new2027.json" });
const regParsed = JSON.parse(reg);
t("registerFestival appends last", regParsed.festivals.length === 2 && regParsed.festivals[1].id === "new2027");
t("registerFestival keeps existing entries", regParsed.festivals[0].data === "data-old.json");
t("registerFestival is idempotent", registerFestival(regText, { id: "old", name: "Old", data: "data-old.json" }) === null);

const swText = `const CACHE = "tuska-v17";\nconst ASSETS = [\n  "./",\n  "./index.html",\n  "./data-old.json",\n  "./manifest.webmanifest",\n];\n`;
const sw = addToPrecache(swText, "data-new2027.json");
t("addToPrecache inserts after last data file", /"\.\/data-old\.json",\n  "\.\/data-new2027\.json",\n  "\.\/manifest/.test(sw.text));
t("addToPrecache bumps CACHE", sw.cache === "tuska-v18" && sw.text.includes('const CACHE = "tuska-v18"'));
t("addToPrecache is idempotent", addToPrecache(sw.text, "data-new2027.json") === null);

// --- Report ---

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
