/* Pieni QR-koodigeneraattori (byte mode, ECC-taso M, versiot 1–10).
 *
 * Kirjoitettu tälle projektille, jotta sovellus pysyy täysin offlinena ja
 * riippuvuuksitta (ei CDN:ää, ei buildia). Algoritmi seuraa ISO/IEC 18004
 * -spesifikaatiota; rakenne mukailee tunnettua referenssitoteutusta
 * (segmentti -> koodisanat -> RS-lohkot -> lomitus -> sijoittelu -> maskaus).
 *
 * Julkinen rajapinta: qrEncode(text) -> boolean[][] (true = tumma moduuli).
 * Heittää virheen, jos teksti ei mahdu versioon 10 (~210 tavua).
 *
 * Oikeellisuus varmistetaan testissä tests/qr.test.js, joka purkaa koodin
 * takaisin itsenäisellä lukijalla (formaatti-BCH, RS-syndroomat, hyötykuorma).
 */
"use strict";

const qrEncode = (function () {
  // --- GF(256), primitiivipolynomi 0x11D ---
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

  // --- ECC-taso M: taulukot versioille 1..10 (indeksi = versio) ---
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS    = [0,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5];
  // Kohdistuskuvioiden keskipisteet (molemmat akselit; kolme finderin kulmaa ohitetaan).
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
                 [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // Koodisanojen kokonaismäärä johdetaan kaavasta (ei muistinvaraista taulukkoa).
  function totalCodewords(ver) {
    let bits = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const na = Math.floor(ver / 7) + 2;
      bits -= (25 * na - 10) * na - 55;
      if (ver >= 7) bits -= 36;
    }
    return Math.floor(bits / 8);
  }

  // --- Reed-Solomon (jakojäännös generaattoripolynomilla) ---
  function rsDivisor(degree) {
    const result = new Array(degree - 1).fill(0);
    result.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gmul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gmul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gmul(coef, factor); });
    }
    return result;
  }

  // --- Maskit (r = rivi, c = sarake) ---
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

  return function qrEncode(text) {
    const bytes = (typeof TextEncoder !== "undefined")
      ? new TextEncoder().encode(text)
      : Uint8Array.from(String(text).split("").map((ch) => ch.charCodeAt(0) & 0xFF));

    // Pienin versio johon data mahtuu (4 bit mode + pituuskenttä + data).
    let ver = 0, dataCw = 0;
    for (let v = 1; v <= 10; v++) {
      dataCw = totalCodewords(v) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];
      const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCw * 8) { ver = v; break; }
    }
    if (!ver) throw new Error("qrEncode: data too long for version 10");

    // --- Bittipuskuri: mode, pituus, data, terminaattori, täytetavut ---
    const bb = [];
    const appendBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
    };
    appendBits(4, 4); // byte mode = 0100
    appendBits(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) appendBits(b, 8);
    appendBits(0, Math.min(4, dataCw * 8 - bb.length));
    appendBits(0, (8 - (bb.length % 8)) % 8);
    for (let pad = 0xEC; bb.length < dataCw * 8; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

    const dataBytes = [];
    for (let i = 0; i < bb.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bb[i + j];
      dataBytes.push(v);
    }

    // --- RS-lohkot ja lomitus ---
    const numBlocks = NUM_BLOCKS[ver];
    const eccLen = ECC_PER_BLOCK[ver];
    const raw = totalCodewords(ver);
    const numShort = numBlocks - (raw % numBlocks);
    const shortLen = Math.floor(raw / numBlocks); // lyhyen lohkon kokonaispituus
    const divisor = rsDivisor(eccLen);
    const blocks = [];
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
      const dat = dataBytes.slice(k, k + datLen);
      k += datLen;
      blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
    }
    const codewords = [];
    const maxDat = shortLen - eccLen + 1;
    for (let j = 0; j < maxDat; j++) {
      for (const b of blocks) if (j < b.dat.length) codewords.push(b.dat[j]);
    }
    for (let j = 0; j < eccLen; j++) {
      for (const b of blocks) codewords.push(b.ecc[j]);
    }

    // --- Matriisi ja kiinteät kuviot ---
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fun = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => { mod[r][c] = !!dark; fun[r][c] = true; };

    // Ajoituskuviot
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    // Etsintäkuviot erottimineen (keskipisteet kolmessa kulmassa)
    const finder = (r, c) => {
      for (let dr = -4; dr <= 4; dr++) {
        for (let dc = -4; dc <= 4; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          set(rr, cc, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3); finder(3, size - 4); finder(size - 4, 3);
    // Kohdistuskuviot (5x5), kolme finderien päälle osuvaa ohitetaan
    const ap = ALIGN[ver];
    for (let i = 0; i < ap.length; i++) {
      for (let j = 0; j < ap.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) ||
            (i === ap.length - 1 && j === 0)) continue;
        const r0 = ap[i], c0 = ap[j];
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            set(r0 + dr, c0 + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
          }
        }
      }
    }

    // Formaattitieto: 5 databittiä (ECC M = 00 + maski) + BCH(15,5), XOR 0x5412.
    function drawFormatBits(mask) {
      const data = mask; // M-tason ECC-bitit ovat 00, joten data = 00xxx = maski
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      // kopio 1 (vasemman yläkulman ympäri)
      for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
      set(7, 8, bit(6));
      set(8, 8, bit(7));
      set(8, 7, bit(8));
      for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
      // kopio 2 (oikea ylä + vasen ala)
      for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
      for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
      set(size - 8, 8, true); // pysyvästi tumma moduuli
    }

    // Versiotieto (18 bittiä, BCH(18,6)) versiosta 7 alkaen.
    function drawVersion() {
      if (ver < 7) return;
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(b, a, dark);
        set(a, b, dark);
      }
    }

    drawFormatBits(0); // varaa formaattialueet ennen datan sijoittelua
    drawVersion();

    // --- Datan sijoittelu: 2 saraketta kerrallaan oikealta, käärmeenä ---
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const upward = ((right + 1) & 2) === 0;
          const r = upward ? size - 1 - vert : vert;
          if (!fun[r][c]) {
            // Bittien loputtua jäännösbitit ovat nollia (spesifikaation mukaan).
            mod[r][c] = bi < codewords.length * 8
              ? ((codewords[bi >> 3] >>> (7 - (bi & 7))) & 1) !== 0
              : false;
            bi++;
          }
        }
      }
    }

    // --- Maskin valinta sakkopisteillä ---
    const applyMask = (m) => {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!fun[r][c] && MASKS[m](r, c)) mod[r][c] = !mod[r][c];
        }
      }
    };

    function penaltyScore() {
      let score = 0;
      const lineScore = (bits) => {
        let s = 0, run = 1;
        for (let j = 1; j <= bits.length; j++) {
          if (j < bits.length && bits[j] === bits[j - 1]) { run++; continue; }
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
        // finderin näköinen kuvio, jonka jommallakummalla puolella >= 4 vaaleaa
        for (let j = 0; (j = bits.indexOf("1011101", j)) !== -1; j++) {
          const beforeOk = bits.slice(Math.max(0, j - 4), j) === "0".repeat(Math.min(4, j));
          const afterOk = bits.slice(j + 7, j + 11) === "0".repeat(Math.min(4, bits.length - j - 7));
          if (beforeOk || afterOk) s += 40;
        }
        return s;
      };
      let dark = 0;
      for (let i = 0; i < size; i++) {
        let row = "", col = "";
        for (let j = 0; j < size; j++) {
          row += mod[i][j] ? "1" : "0";
          col += mod[j][i] ? "1" : "0";
          if (mod[i][j]) dark++;
        }
        score += lineScore(row) + lineScore(col);
      }
      for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
          if (mod[r][c] === mod[r][c + 1] && mod[r][c] === mod[r + 1][c] &&
              mod[r][c] === mod[r + 1][c + 1]) score += 3;
        }
      }
      const total = size * size;
      score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return score;
    }

    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormatBits(m);
      const s = penaltyScore();
      if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m); // XOR kahdesti = kumoaa
    }
    applyMask(best);
    drawFormatBits(best);

    return mod;
  };
})();

/* Node-testejä varten; selaimessa jää globaaliksi qrEncode-funktioksi. */
if (typeof module !== "undefined" && module.exports) module.exports = qrEncode;
