import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "public/styles.css"), "utf8");
const js = readFileSync(join(root, "public/app.js"), "utf8");
const html = readFileSync(join(root, "public/index.html"), "utf8");

function block(src, selector) {
  const re = new RegExp(selector.replace(".", "\\.") + "\\s*\\{([^}]+)\\}");
  const m = src.match(re);
  assert.ok(m, `missing CSS block ${selector}`);
  return m[1];
}

test("the app shell is locked to the visual viewport height", () => {
  assert.match(html, /--vvh/);
  assert.match(js, /--vvh/);
  assert.match(js, /visualViewport/);
  assert.match(js, /function syncViewportFrame/);
  const app = block(css, "#app");
  assert.match(app, /--vvh/);
  assert.match(app, /overflow:\s*hidden/);
  const shell = block(css, "html, body");
  assert.match(shell, /overflow:\s*hidden/);
});

test("in-game primary controls sit in a non-scrolling dock and the table shrinks to fit", () => {
  const dock = block(css, ".table-dock");
  assert.doesNotMatch(dock, /overflow-y:\s*auto/);
  assert.match(dock, /overflow-y:\s*hidden/);
  assert.match(dock, /flex:\s*0 0 auto/);
  const wrap = block(css, ".circle-wrap");
  assert.match(wrap, /flex:\s*1 1 auto/);
  const min = wrap.match(/min-height:\s*(\d+)px/);
  assert.ok(min, "circle-wrap should have a compact min-height");
  assert.ok(Number(min[1]) <= 180, `table min-height ${min[1]}px is too tall to keep bids and the hand on screen`);
});

test("home cover shrinks to leave room for 開房, join, and 遊戲規則", () => {
  const cover = block(css, ".brand-cover");
  assert.match(cover, /svh/);
  assert.doesNotMatch(cover, /34vh|280px|300px/);
  assert.match(css, /\.home-foot/);
  assert.match(js, /class="home-foot"/);
});

test("lobby keeps the room code and start actions outside the scrolling list", () => {
  const idx = js.indexOf("function renderLobby");
  const chunk = js.slice(idx, idx + 4500);
  const hero = chunk.indexOf("code-hero");
  const scroll = chunk.indexOf("lobby-scroll");
  const actions = chunk.indexOf("lobby-actions");
  assert.ok(hero > 0 && scroll > hero, "room code should stay pinned above the scrolling list");
  assert.ok(actions > scroll, "start / ready actions should stay after the list");
});
