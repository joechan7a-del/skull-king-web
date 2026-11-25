import { test } from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, qrSvg } from "../public/qr.js";

function hasFinder(mod, r0, c0) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const want = edge || core ? 1 : 0;
      if (mod[r0 + r][c0 + c] !== want) return false;
    }
  }
  return true;
}

test("qr matrix has finders, dark module, and a room-sized svg", () => {
  const url = "https://onepieceking.up.railway.app/r/ABC123";
  const { modules, size, version } = qrMatrix(url);
  assert.equal(modules.length, size);
  assert.ok(version >= 3 && version <= 5);
  const n = size;
  assert.ok(hasFinder(modules, 0, 0));
  assert.ok(hasFinder(modules, 0, n - 7));
  assert.ok(hasFinder(modules, n - 7, 0));
  assert.equal(modules[n - 8][8], 1);
  const svg = qrSvg(url);
  assert.match(svg, /<svg /);
  assert.match(svg, /掃碼加入|二維碼/);
  assert.match(svg, /d="M/);
});
