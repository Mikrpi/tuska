#!/usr/bin/env node
/* Tests for qr.js: decodes the generated matrix back with an INDEPENDENT
 * reader and verifies it end to end:
 *   - finder/timing pattern structure
 *   - both format-info copies agree and pass the BCH(15,5) check
 *   - Reed-Solomon syndromes of every block are zero (independent GF math,
 *     bitwise multiply — not the encoder's log tables)
 *   - the unmasked, de-interleaved bitstream parses back to the input text
 *
 * A QR that passes all of this is what a real scanner reads (the scanner
 * additionally corrects errors, which zero syndromes make unnecessary).
 *
 * Run:  node tests/qr.test.js
 */
"use strict";

const path = require("path");
const qrEncode = require(path.join(__dirname, "..", "qr.js"));

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };

// --- Riippumaton GF(256)-kertolasku (bittisiirroin, ei enkooderin tauluja) ---
function gmulSlow(a, b) {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11D;
    b >>= 1;
  }
  return r;
}
function gpow(base, e) { let r = 1; for (let i = 0; i < e; i++) r = gmulSlow(r, base); return r; }

// Samat versiotaulukot kuin spesifikaatiossa (ECC-taso M, versiot 1..10).
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS    = [0,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
               [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
function totalCodewords(ver) {
  let bits = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    bits -= (25 * na - 10) * na - 55;
    if (ver >= 7) bits -= 36;
  }
  return Math.floor(bits / 8);
}
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// Funktiomoduulikartta rakennettuna spesifikaation aluekuvauksesta (ei
// enkooderin piirtojärjestyksestä): kulma-alueet, ajoitus, kohdistus, versiotieto.
function functionMap(ver, size) {
  const fun = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (r <= 8 && c <= 8) fun[r][c] = true;                    // vasen ylä + formaatti
      if (r <= 8 && c >= size - 8) fun[r][c] = true;             // oikea ylä + formaatti
      if (r >= size - 8 && c <= 8) fun[r][c] = true;             // vasen ala + formaatti + tumma moduuli
      if (r === 6 || c === 6) fun[r][c] = true;                  // ajoitus
    }
  }
  const ap = ALIGN[ver];
  for (let i = 0; i < ap.length; i++) {
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) ||
          (i === ap.length - 1 && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) fun[ap[i] + dr][ap[j] + dc] = true;
      }
    }
  }
  if (ver >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      fun[b][a] = true;
      fun[a][b] = true;
    }
  }
  return fun;
}

// Purkaa matriisin: palauttaa { text, ver, mask, ecc } tai heittää virheen.
function decode(mod) {
  const size = mod.length;
  const ver = (size - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1) throw new Error("bad size " + size);
  const bit = (r, c) => (mod[r][c] ? 1 : 0);

  // Molemmat formaattikopiot
  const f1 = [];
  for (let i = 0; i <= 5; i++) f1.push(bit(i, 8));
  f1.push(bit(7, 8), bit(8, 8), bit(8, 7));
  for (let i = 9; i < 15; i++) f1.push(bit(8, 14 - i));
  const f2 = [];
  for (let i = 0; i < 8; i++) f2.push(bit(8, size - 1 - i));
  for (let i = 8; i < 15; i++) f2.push(bit(size - 15 + i, 8));
  if (f1.join("") !== f2.join("")) throw new Error("format copies differ");

  let fbits = 0;
  for (let i = 0; i < 15; i++) fbits |= f1[i] << i;
  fbits ^= 0x5412;
  // BCH(15,5)-tarkistus: koko 15-bittisen sanan jakojäännöksen on oltava 0.
  let rem = fbits;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  if (rem !== 0) throw new Error("format BCH check failed");
  const data5 = fbits >>> 10;
  const ecc = data5 >>> 3; // 00 = M
  const mask = data5 & 7;

  if (!mod[size - 8][8]) throw new Error("dark module missing");

  // Versiotieto (ver >= 7): BCH(18,6)
  if (ver >= 7) {
    let vbits = 0;
    for (let i = 0; i < 18; i++) {
      vbits |= bit(Math.floor(i / 3), size - 11 + (i % 3)) << i;
    }
    let vrem = vbits;
    for (let i = 17; i >= 12; i--) {
      if ((vrem >>> i) & 1) vrem ^= 0x1F25 << (i - 12);
    }
    if (vrem !== 0) throw new Error("version BCH check failed");
    if ((vbits >>> 12) !== ver) throw new Error("version info mismatch");
  }

  // Maskin poisto ja käärmelukujärjestys
  const fun = functionMap(ver, size);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!fun[r][c]) bits.push(bit(r, c) ^ (MASKS[mask](r, c) ? 1 : 0));
      }
    }
  }
  const raw = totalCodewords(ver);
  if (bits.length < raw * 8) throw new Error("too few data modules");
  const codewords = [];
  for (let i = 0; i < raw; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    codewords.push(v);
  }

  // Lomituksen purku
  const numBlocks = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
  const numShort = numBlocks - (raw % numBlocks);
  const shortDat = Math.floor(raw / numBlocks) - eccLen;
  const blocks = Array.from({ length: numBlocks }, (_, i) => ({
    dat: new Array(shortDat + (i < numShort ? 0 : 1)),
    ecc: new Array(eccLen),
  }));
  let idx = 0;
  for (let j = 0; j <= shortDat; j++) {
    for (const b of blocks) if (j < b.dat.length) b.dat[j] = codewords[idx++];
  }
  for (let j = 0; j < eccLen; j++) {
    for (const b of blocks) b.ecc[j] = codewords[idx++];
  }

  // RS-syndroomat: C(alpha^i) = 0 kaikilla i = 0..eccLen-1, joka lohkolle.
  for (const b of blocks) {
    const poly = b.dat.concat(b.ecc); // korkein aste ensin
    for (let i = 0; i < eccLen; i++) {
      const x = gpow(2, i);
      let s = 0;
      for (const cw of poly) s = gmulSlow(s, x) ^ cw;
      if (s !== 0) throw new Error("nonzero RS syndrome");
    }
  }

  // Bittivirran jäsennys: mode + pituus + tavut
  const stream = [];
  for (const b of blocks) for (const cw of b.dat) {
    for (let j = 7; j >= 0; j--) stream.push((cw >>> j) & 1);
  }
  const take = (n, at) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | stream[at + i];
    return v;
  };
  const mode = take(4, 0);
  if (mode !== 4) throw new Error("mode is not byte (" + mode + ")");
  const lenBits = ver <= 9 ? 8 : 16;
  const len = take(lenBits, 4);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8, 4 + lenBits + i * 8));
  return { text: Buffer.from(out).toString("utf8"), ver, mask, ecc };
}

// --- Rakenteelliset tarkistukset ---
function checkStructure(mod, name) {
  const size = mod.length;
  // Etsintäkuvion tarkka kuvio kolmessa kulmassa (7x7: reunat tummat,
  // rengas vaalea, keskusta 3x3 tumma) + vaalea erotin.
  const finderAt = (r0, c0) => {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        if (mod[r0 + dr][c0 + dc] !== (d !== 2)) return false;
      }
    }
    return true;
  };
  t(`${name}: finder top-left`, finderAt(0, 0));
  t(`${name}: finder top-right`, finderAt(0, size - 7));
  t(`${name}: finder bottom-left`, finderAt(size - 7, 0));
  // Ajoituskuvion vuorottelu
  let timingOk = true;
  for (let i = 8; i < size - 8; i++) {
    if (mod[6][i] !== (i % 2 === 0) || mod[i][6] !== (i % 2 === 0)) timingOk = false;
  }
  t(`${name}: timing pattern`, timingOk);
}

// --- Testitapaukset ---
const cases = [
  ["A", 1],
  ["https://example.com/?f=tuska2026#s=60.QQAIACAgAA", null],
  // tyypillinen jaettava linkki nimineen (UTF-8-merkit mukana)
  ["https://lemon-water-0df805303.azurestaticapps.net/?f=ilosaarirock2026#s=77.AAECAwQFBgcICQ&n=Mikon%20lauantai", null],
  // pitkä syöte: pakottaa isompaan versioon (myös 16-bittinen pituuskenttä v10:ssä)
  ["x".repeat(150) + " ääkkösiä ja €-merkki lopussa", null],
];

for (const [text, expectVer] of cases) {
  const label = JSON.stringify(text.length > 40 ? text.slice(0, 37) + "..." : text);
  let mod;
  try {
    mod = qrEncode(text);
  } catch (e) {
    t(`${label}: encodes`, false);
    continue;
  }
  t(`${label}: encodes`, true);
  checkStructure(mod, label);
  try {
    const d = decode(mod);
    t(`${label}: decodes back to input`, d.text === text);
    t(`${label}: ECC level is M`, d.ecc === 0);
    if (expectVer) t(`${label}: version ${expectVer}`, d.ver === expectVer);
    t(`${label}: valid mask 0..7`, d.mask >= 0 && d.mask <= 7);
  } catch (e) {
    t(`${label}: decodes back to input (${e.message})`, false);
  }
}

// Jokainen versio 1..10 tulee testatuksi sopivan mittaisilla syötteillä.
// Versiokohtaiset databittikapasiteetit (M): lasketaan ja täytetään lähes täyteen.
for (let v = 1; v <= 10; v++) {
  const dataCw = totalCodewords(v) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];
  const capacity = Math.floor((dataCw * 8 - 4 - (v <= 9 ? 8 : 16)) / 8);
  const s = "Q".repeat(capacity); // täsmälleen täysi -> pienin mahdollinen on v
  try {
    const mod = qrEncode(s);
    const d = decode(mod);
    t(`v${v} at full capacity (${capacity} bytes)`, d.text === s && d.ver === v);
  } catch (e) {
    t(`v${v} at full capacity (${capacity} bytes): ${e.message}`, false);
  }
}

// Liian pitkä syöte heittää virheen
let threw = false;
try { qrEncode("y".repeat(500)); } catch (e) { threw = true; }
t("over-capacity input throws", threw);

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exitCode = 1;
