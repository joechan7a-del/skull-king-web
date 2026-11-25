/** Compact QR encoder (byte mode, versions 1–6, EC level M) for short room links. */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function rsGenerator(nsym) {
  let poly = [1];
  for (let i = 0; i < nsym; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, nsym) {
  const gen = rsGenerator(nsym);
  const ecc = new Array(nsym).fill(0);
  for (const byte of data) {
    const coef = byte ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    if (!coef) continue;
    for (let i = 0; i < nsym; i++) ecc[i] ^= gfMul(gen[i + 1], coef);
  }
  return ecc;
}

/** Version 1–6, level M: [dataCodewords, ecPerBlock, blocks] */
const M_CAP = {
  1: [16, 10, 1],
  2: [28, 16, 1],
  3: [44, 26, 1],
  4: [64, 18, 2],
  5: [86, 24, 2],
  6: [108, 16, 4],
};

const ALIGN_POS = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

function versionFor(len) {
  for (let v = 1; v <= 6; v++) {
    const [data] = M_CAP[v];
    // mode 4 + count 8 + data + terminator, in bytes
    if (len + 2 <= data) return v;
  }
  return 0;
}

function setBit(buf, bit, value) {
  if (value) buf[bit >> 3] |= 1 << (7 - (bit & 7));
}

function encodeData(text, version) {
  const bytes = new TextEncoder().encode(text);
  const [dataCount] = M_CAP[version];
  const totalBits = dataCount * 8;
  const buf = new Uint8Array(dataCount);
  let bit = 0;
  const write = (value, n) => {
    for (let i = n - 1; i >= 0; i--) {
      if (bit >= totalBits) return;
      setBit(buf, bit, (value >> i) & 1);
      bit++;
    }
  };
  write(0b0100, 4);
  write(bytes.length, 8);
  for (const b of bytes) write(b, 8);
  write(0, Math.min(4, totalBits - bit));
  bit = Math.ceil(bit / 8) * 8;
  let pad = 0;
  while (bit < totalBits) {
    write(pad % 2 === 0 ? 0xec : 0x11, 8);
    pad++;
  }
  return buf;
}

function interleave(data, version) {
  const [dataCount, ecPer, blocks] = M_CAP[version];
  const base = Math.floor(dataCount / blocks);
  const extra = dataCount % blocks; // last `extra` blocks have one more data byte
  const groups = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const size = base + (i >= blocks - extra ? 1 : 0);
    const block = Array.from(data.slice(offset, offset + size));
    offset += size;
    groups.push({ data: block, ecc: rsEncode(block, ecPer) });
  }
  const out = [];
  const maxData = Math.max(...groups.map((g) => g.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const g of groups) if (i < g.data.length) out.push(g.data[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const g of groups) out.push(g.ecc[i]);
  }
  return out;
}

function moduleCount(version) {
  return 21 + 4 * (version - 1);
}

function inFinder(r, c, n) {
  const inBox = (x, y) => r >= x && r < x + 7 && c >= y && c < y + 7;
  return inBox(0, 0) || inBox(0, n - 7) || inBox(n - 7, 0);
}

function inSeparator(r, c, n) {
  const near = (x, y) => r >= x - 1 && r <= x + 7 && c >= y - 1 && c <= y + 7 && !inFinder(r, c, n) && r >= 0 && c >= 0 && r < n && c < n;
  return near(0, 0) || near(0, n - 7) || near(n - 7, 0);
}

function inTiming(r, c) {
  return r === 6 || c === 6;
}

function alignmentCenters(version) {
  return ALIGN_POS[version] || [];
}

function inAlignment(r, c, version) {
  const pos = alignmentCenters(version);
  if (!pos.length) return false;
  for (const ar of pos) {
    for (const ac of pos) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === pos[pos.length - 1]) || (ar === pos[pos.length - 1] && ac === 6)) {
        continue;
      }
      if (r >= ar - 2 && r <= ar + 2 && c >= ac - 2 && c <= ac + 2) return true;
    }
  }
  return false;
}

function inFormat(r, c, n) {
  if (r === 8 && (c <= 8 || c >= n - 8)) return true;
  if (c === 8 && (r <= 8 || r >= n - 7)) return true;
  return false;
}

function isReserved(r, c, n, version) {
  if (inFinder(r, c, n) || inSeparator(r, c, n)) return true;
  if (inTiming(r, c) && !inFinder(r, c, n) && !inAlignment(r, c, version)) return true;
  if (inAlignment(r, c, version)) return true;
  if (inFormat(r, c, n)) return true;
  if (r === n - 8 && c === 8) return true; // dark module
  return false;
}

function paintFinder(mod, r0, c0) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      mod[r0 + r][c0 + c] = edge || core ? 1 : 0;
    }
  }
}

function paintAlignment(mod, ar, ac) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const d = Math.max(Math.abs(r), Math.abs(c));
      mod[ar + r][ac + c] = d !== 1 ? 1 : 0;
    }
  }
}

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return ((r + c) & 1) === 0;
    case 1: return (r & 1) === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return ((r >> 1) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0;
    case 7: return ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0;
    default: return false;
  }
}

function formatBits(mask) {
  // EC level M = 00
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= gen << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
}

function placeFormat(mod, n, mask) {
  const bits = formatBits(mask);
  const set = (r, c, i) => {
    mod[r][c] = (bits >> i) & 1;
  };
  // Horizontal, around top-left finder: c = 0..5, 7, 8 (skip timing col 6)
  const horiz = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 0; i < 8; i++) set(8, horiz[i], 14 - i);
  // Vertical, top-left: r = 8,7,5,4,3,2,1,0 (bit 6 already placed at 8,8?)
  // Format bits 0-14 from LSB:
  // Positions (standard):
  // bit 0 at (8,0)? I'll use the well-known map:
  const coordsA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) set(coordsA[i][0], coordsA[i][1], 14 - i);
  // Second copy: top-right / bottom-left
  for (let i = 0; i < 8; i++) set(n - 1 - i, 8, i);
  for (let i = 0; i < 7; i++) set(8, n - 7 + i, 14 - 8 - i);
  // Wait, let me redo second copy carefully:
  // bits 0-6 vertical bottom-left going up from (n-1, 8) to (n-7, 8)
  // bits 7-14 horizontal top-right from (8, n-8) to (8, n-1)
}

function placeFormatFixed(mod, n, mask) {
  const bits = formatBits(mask);
  const put = (r, c, i) => {
    mod[r][c] = (bits >> i) & 1;
  };
  // Copy 1 (around top-left), bit 14 ... 0:
  // (8,0) bit14 ... (8,5) bit9, (8,7) bit8, (8,8) bit7,
  // (7,8) bit6, (5,8) bit5 ... (0,8) bit0
  const copy1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) put(copy1[i][0], copy1[i][1], 14 - i);
  // Copy 2: bits 0-6 at (n-1,8)..(n-7,8); bits 7-14 at (8,n-8)..(8,n-1)
  for (let i = 0; i <= 6; i++) put(n - 1 - i, 8, i);
  for (let i = 0; i <= 7; i++) put(8, n - 8 + i, 7 + i);
}

function buildReserved(version) {
  const n = moduleCount(version);
  const reserved = Array.from({ length: n }, () => new Uint8Array(n));
  const paint = (r, c) => {
    if (r >= 0 && c >= 0 && r < n && c < n) reserved[r][c] = 1;
  };
  const markFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) paint(r0 + r, c0 + c);
  };
  markFinder(0, 0);
  markFinder(0, n - 7);
  markFinder(n - 7, 0);
  for (let i = 0; i < n; i++) {
    paint(6, i);
    paint(i, 6);
  }
  const pos = alignmentCenters(version);
  for (const ar of pos) {
    for (const ac of pos) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === pos[pos.length - 1]) || (ar === pos[pos.length - 1] && ac === 6)) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) paint(ar + r, ac + c);
    }
  }
  for (let i = 0; i <= 8; i++) {
    paint(8, i);
    paint(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    paint(8, n - 8 + i);
    paint(n - 8 + i, 8);
  }
  paint(n - 8, 8); // dark module already in column 8
  return reserved;
}

function paintFunction(mod, version) {
  const n = moduleCount(version);
  paintFinder(mod, 0, 0);
  paintFinder(mod, 0, n - 7);
  paintFinder(mod, n - 7, 0);
  for (let i = 0; i < n; i++) {
    if (mod[6][i] == null || !inFinder(6, i, n)) mod[6][i] = i % 2 === 0 ? 1 : 0;
    if (mod[i][6] == null || !inFinder(i, 6, n)) mod[i][6] = i % 2 === 0 ? 1 : 0;
  }
  const pos = alignmentCenters(version);
  for (const ar of pos) {
    for (const ac of pos) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === pos[pos.length - 1]) || (ar === pos[pos.length - 1] && ac === 6)) continue;
      paintAlignment(mod, ar, ac);
    }
  }
  mod[n - 8][8] = 1;
}

function placeData(mod, reserved, bits) {
  const n = mod.length;
  let bi = 0;
  let upward = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let i = 0; i < n; i++) {
      const r = upward ? n - 1 - i : i;
      for (const cc of [c, c - 1]) {
        if (reserved[r][cc]) continue;
        const bit = bi < bits.length ? bits[bi] : 0;
        bi++;
        mod[r][cc] = bit;
      }
    }
    upward = !upward;
  }
}

function bitsFromCodewords(codewords) {
  const bits = [];
  for (const b of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  return bits;
}

function applyMask(mod, reserved, mask) {
  const n = mod.length;
  const out = mod.map((row) => row.slice());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (reserved[r][c]) continue;
      if (maskBit(mask, r, c)) out[r][c] ^= 1;
    }
  }
  return out;
}

function penalty(mod) {
  const n = mod.length;
  let score = 0;
  const runPenalty = (run) => {
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (mod[r][c] === mod[r][c - 1]) run++;
      else {
        runPenalty(run);
        run = 1;
      }
    }
    runPenalty(run);
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (mod[r][c] === mod[r - 1][c]) run++;
      else {
        runPenalty(run);
        run = 1;
      }
    }
    runPenalty(run);
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = mod[r][c];
      if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) score += 3;
    }
  }
  const pat = (get, len) => {
    for (let i = 0; i <= len - 11; i++) {
      const slice = [];
      for (let k = 0; k < 11; k++) slice.push(get(i + k));
      const s = slice.join("");
      if (s === "10111010000" || s === "00001011101") score += 40;
    }
    for (let i = 0; i <= len - 7; i++) {
      // also classic 1:1:3:1:1 with 4 light modules on either side, covered by 11-bit above for most cases
    }
  };
  for (let r = 0; r < n; r++) pat((c) => mod[r][c], n);
  for (let c = 0; c < n; c++) pat((r) => mod[r][c], n);
  let dark = 0;
  for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) dark += mod[r][cc];
  const percent = (100 * dark) / (n * n);
  score += 10 * Math.floor(Math.abs(percent - 50) / 5);
  return score;
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (!version) throw new Error("文字太長，製作唔到二維碼");
  const data = encodeData(text, version);
  const codewords = interleave(data, version);
  const bits = bitsFromCodewords(codewords);
  const n = moduleCount(version);
  const reserved = buildReserved(version);
  const base = Array.from({ length: n }, () => new Array(n).fill(0));
  placeData(base, reserved, bits);
  paintFunction(base, version);
  let best = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(base, reserved, mask);
    paintFunction(masked, version);
    placeFormatFixed(masked, n, mask);
    const score = penalty(masked);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
      bestMask = mask;
    }
  }
  return { modules: best, version, mask: bestMask, size: n };
}

export function qrSvg(text, { size = 180, margin = 2, alt = "二維碼" } = {}) {
  const { modules, size: n } = qrMatrix(text);
  const dim = n + margin * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg class="join-qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${size}" height="${size}" role="img" aria-label="${escapeAttr(alt)}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path fill="#111" d="${path}"/></svg>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
