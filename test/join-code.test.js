import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractJoinCode, normalizeJoinCode, ROOM_CODE_CHARS, ROOM_CODE_LENGTH } from "../public/join-code.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server/rooms.js"), "utf8");
const app = readFileSync(join(root, "public/app.js"), "utf8");
const html = readFileSync(join(root, "public/index.html"), "utf8");

test("client room-code alphabet matches the server generator", () => {
  const m = server.match(/const CODE_CHARS = "([A-Z0-9]+)"/);
  assert.ok(m, "server CODE_CHARS");
  assert.equal(ROOM_CODE_CHARS, m[1]);
  assert.doesNotMatch(ROOM_CODE_CHARS, /[IO01]/);
});

test("normalizeJoinCode strips junk and only keeps the official alphabet", () => {
  assert.equal(normalizeJoinCode(""), "");
  assert.equal(normalizeJoinCode(null), "");
  assert.equal(normalizeJoinCode("ab-3k;2p"), "AB3K");
  assert.equal(normalizeJoinCode(";;I;"), "");
  assert.equal(normalizeJoinCode("i i I | ;"), "");
  assert.equal(normalizeJoinCode("AB3K2P99"), "AB3K");
  assert.equal(normalizeJoinCode("IO10XY"), "XY");
  assert.equal(normalizeJoinCode("房號：t7w4qm"), "T7W4");
});

test("extractJoinCode reads a pasted share link or a bare code, not a homepage URL", () => {
  assert.equal(extractJoinCode("https://onepieceking.up.railway.app/r/ab3k2p"), "AB3K");
  assert.equal(extractJoinCode("https://onepieceking.up.railway.app"), "");
  assert.equal(extractJoinCode("  t7w4qm  "), "T7W4");
  assert.equal(extractJoinCode("房號 T7W4QM 一齊玩"), "T7W4");
  assert.equal(extractJoinCode(";;I;"), "");
});

test("home room-code boxes start empty, lock autofill, and sanitize on bind", () => {
  assert.match(app, /from "\.\/join-code\.js"/);
  assert.match(app, /normalizeJoinCode\(prefill\)/);
  assert.match(app, /readonly/);
  assert.match(app, /data-lpignore="true"/);
  assert.match(app, /data-1p-ignore="true"/);
  assert.match(app, /sweepAutofill|sweepCodeBoxes/);
  assert.match(app, /removeAttribute\("readonly"\)/);
  assert.match(html, /app\.js\?v=c27/);
});

test("room codes are always four characters and the home form has four boxes", () => {
  assert.equal(ROOM_CODE_LENGTH, 4);
  assert.match(app, /length: ROOM_CODE_LENGTH/);
  assert.match(app, /maxlength="\$\{ROOM_CODE_LENGTH\}"/);
  assert.doesNotMatch(app, /length: 6/);
  assert.match(server, /const len = 4;/);
  assert.match(server, /attempt < 256/);
  assert.doesNotMatch(server, /len <= 6/);
  assert.doesNotMatch(server, /for \(let len = 4;/);
});
