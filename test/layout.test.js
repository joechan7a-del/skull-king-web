import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "public/styles.css"), "utf8");
const js = readFileSync(join(root, "public/app.js"), "utf8");
const html = readFileSync(join(root, "public/index.html"), "utf8");
const cards = readFileSync(join(root, "public/cards.js"), "utf8");

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

test("in-game primary controls overlay a reserved dock and do not shrink the table", () => {
  const dock = block(css, ".table-dock");
  assert.doesNotMatch(dock, /overflow-y:\s*auto/);
  assert.match(dock, /overflow-y:\s*hidden/);
  assert.match(dock, /position:\s*absolute/);
  assert.match(dock, /bottom:\s*0/);
  const screen = block(css, ".table-screen");
  assert.match(screen, /--dock-reserve/);
  assert.match(screen, /--cue-reserve/);
  const wrap = block(css, ".circle-wrap");
  assert.match(wrap, /flex:\s*1 1 auto/);
  assert.match(wrap, /--dock-reserve/);
  const min = wrap.match(/min-height:\s*(\d+)px/);
  assert.ok(min, "circle-wrap should have a compact min-height");
  assert.ok(Number(min[1]) <= 180, `table min-height ${min[1]}px is too tall to keep bids and the hand on screen`);
});

test("the felt keeps a locked mid-trick proportion on every in-game screen", () => {
  const screen = block(css, ".table-screen");
  assert.match(screen, /--cue-reserve:\s*60px/);
  assert.match(screen, /--dock-reserve:\s*208px/);
  const slot = block(css, ".table-top-slot");
  assert.match(slot, /flex:\s*0 0 var\(--cue-reserve\)/);
  assert.match(slot, /height:\s*var\(--cue-reserve\)/);
  assert.match(slot, /max-height:\s*var\(--cue-reserve\)/);
  const wrap = block(css, ".circle-wrap");
  assert.match(wrap, /margin:\s*2px 0 var\(--dock-reserve, 208px\) 0/);
  const render = js.slice(js.indexOf("function renderTable"), js.indexOf("function handOverlap"));
  assert.match(render, /class="table-top-slot"/);
  assert.match(render, /table-top-slot">\$\{bidTotalChipHTML\(v\)\}\$\{tableCuesRowHTML\(v\)\}</);
  assert.match(render, /circleTableHTML\(v\)/);
  const dockChunk = render.slice(render.indexOf("table-dock"), render.indexOf("pendingTigress"));
  assert.doesNotMatch(dockChunk, /circleTableHTML/);
  assert.match(html, /app\.js\?v=c27/);
  // overlays must stay out of the table flex flow
  assert.match(css, /\.confirm-bar\s*\{[^}]*position:\s*absolute/s);
  const banner = block(css, ".banner");
  assert.match(banner, /position:\s*absolute/);
  const fl = block(css, ".flourish-overlay");
  assert.match(fl, /position:\s*absolute/);
  const dock = block(css, ".table-dock");
  assert.match(dock, /position:\s*absolute/);
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
  const end = js.indexOf("\nfunction signed", idx);
  const chunk = js.slice(idx, end > idx ? end : idx + 16000);
  const hero = chunk.indexOf("code-hero");
  const scroll = chunk.indexOf("lobby-scroll");
  const actions = chunk.indexOf("lobby-actions");
  assert.ok(hero > 0 && scroll > hero, "room code should stay pinned above the scrolling list");
  assert.ok(actions > scroll, "start / ready actions should stay after the list");
});

test("the table uses the full wrap and seats sit near the outer edge", () => {
  const table = block(css, ".circle-table");
  assert.match(table, /width:\s*100%/);
  assert.match(table, /height:\s*100%/);
  assert.doesNotMatch(table, /aspect-ratio:\s*1\s*\/\s*1/);
  const fn = js.slice(js.indexOf("function seatRadii"), js.indexOf("function seatRadii") + 400);
  assert.match(fn, /rx:\s*40/);
  assert.match(fn, /ry:\s*39/);
});

test("played cards stay on the rim and cues stay off the felt", () => {
  assert.match(css, /--card-in/);
  const card = block(css, ".seat-card");
  assert.match(card, /var\(--card-in\)/);
  assert.doesNotMatch(card, /translateY\(-5[08]px\)/);
  const feltIdx = js.indexOf("table-felt felt-rich");
  const feltLine = js.slice(feltIdx, feltIdx + 220);
  assert.doesNotMatch(feltLine, /lastTrickCueHTML/);
  assert.match(js, /function tableCuesRowHTML/);
  assert.match(js, /function midTrickCueHTML/);
  assert.match(css, /\.table-cues-row/);
  assert.match(css, /\.seat\.place-top/);
  assert.match(css, /\.seat\.place-bottom-left/);
  assert.match(css, /\.seat\.place-top-right/);
  const seat = block(css, ".seat");
  assert.match(seat, /width:\s*0/);
  assert.match(js, /function seatPlace/);
  assert.match(js, /bottom-left/);
  assert.match(js, /dock-status-row/);
});

test("the bulky follow-suit banner is gone; a corner hint and led-suit tint remain", () => {
  assert.doesNotMatch(js, /turn-banner mine/);
  assert.doesNotMatch(js, /turn-banner wait/);
  assert.match(js, /function yourTurnHintHTML/);
  assert.match(js, /your-turn-hint/);
  assert.match(js, /輪到你出牌/);
  assert.match(js, /function ledSuitActive/);
  assert.match(js, /function followSuitHintHTML/);
  assert.match(js, /呢個回合要跟黑色（骷髏旗）/);
  assert.match(js, /呢個回合要跟黃色/);
  assert.match(js, /呢個回合要跟綠色（鸚鵡）/);
  assert.match(js, /呢個回合要跟紫色/);
  assert.match(js, /follow-suit-hint/);
  assert.match(js, /followSuitHintHTML\(v\)/);
  assert.match(js, /led-\$\{ledClass\}/);
  assert.match(css, /\.follow-suit-hint/);
  assert.match(css, /\.table-screen\.led-black/);
  assert.match(css, /\.table-felt\.suit-black/);
  const blackFelt = block(css, ".table-felt.suit-black");
  assert.match(blackFelt, /#121216|#060608|#2a2a32/);
  assert.doesNotMatch(js, /createOscillator/);
});

test("every game sound reuses the soft UI click", () => {
  assert.match(js, /function playCardFlip\(\) \{ playSound\("click"\); \}/);
  assert.match(js, /function playUiClick\(\) \{ playSound\("click"\); \}/);
  assert.match(js, /function playTurnChime\(\) \{ playUiClick\(\); \}/);
  assert.match(js, /function playBeepSequence\(\) \{ playUiClick\(\); \}/);
  assert.match(js, /function playFlourishSting\(\) \{ playUiClick\(\); \}/);
  assert.match(js, /function playMakeChime\(\) \{ playUiClick\(\); \}/);
  assert.match(js, /function playLobbyTick\(\) \{ playUiClick\(\); \}/);
  assert.match(js, /playSound\("click"\)/);
  assert.doesNotMatch(js, /playSound\("flip"\)/);
  assert.doesNotMatch(js, /createOscillator/);
});

test("tableArrowsSVG uses one thin clockwise arc without a 順時針 label", () => {
  const fn = js.slice(js.indexOf("function tableArrowsSVG"), js.indexOf("function resetTrickAnim"));
  assert.doesNotMatch(fn, /const count = 3/);
  assert.doesNotMatch(fn, /const n = 8/);
  assert.doesNotMatch(fn, /stroke-width="4\.4"/);
  assert.doesNotMatch(fn, /stroke-width="7\.2"/);
  assert.match(fn, /A \$\{rx\} \$\{ry\} 0 \$\{large\} 1/);
  assert.match(fn, /stroke-width="1\.6"/);
  assert.doesNotMatch(js, /arrow-hint">順時針/);
  assert.doesNotMatch(js, /順時針出牌/);
  assert.match(css, /\.table-arrows/);
});

test("trick and round results are overlay dialogs and do not shrink the table", () => {
  assert.match(js, /function trickResultOverlayHTML/);
  assert.match(js, /trick-result-overlay/);
  assert.match(js, /showTrickExplanation/);
  assert.match(js, /trick-result-cards/);
  assert.match(js, /data-featured="\$\{kind\}"/);
  assert.match(js, /void-cause/);
  assert.match(js, /win \? "winner"/);
  const render = js.slice(js.indexOf("function renderTable"), js.indexOf("function handOverlap"));
  assert.match(render, /\$\{trickResultOverlayHTML\(v\)\}/);
  assert.doesNotMatch(render, /class="next-trick"/);
  assert.doesNotMatch(render, /tablePromptHTML/);
  const overlayFn = js.slice(js.indexOf("function trickResultOverlayHTML"), js.indexOf("function myBidTrackHTML"));
  assert.doesNotMatch(overlayFn, /class="overlay center trick-result-overlay"/);
  assert.match(css, /\.trick-result-overlay/);
  const bar = block(css, ".trick-result-overlay");
  assert.match(bar, /position:\s*absolute/);
  assert.match(bar, /bottom:\s*var\(--dock-reserve/);
  assert.match(bar, /background:\s*none/);
  const winCard = css.slice(css.indexOf(".seat-card.winner .sk-card"));
  assert.match(winCard.slice(0, 500), /scale\(1\.12\)/);
  assert.match(winCard.slice(0, 500), /aspect-ratio:\s*784\s*\/\s*1100/);
  const score = js.slice(js.indexOf("function scoreHTML"), js.indexOf("function renderRules"));
  assert.match(score, /class="overlay center"/);
  assert.match(score, /下一局/);
  assert.match(html, /app\.js\?v=c27/);
});

test("AI plays and post-win pauses are modestly longer", () => {
  const rooms = readFileSync(join(root, "server/rooms.js"), "utf8");
  const ai = rooms.match(/const AI_PAUSE_MS = (\d+)/);
  const trick = rooms.match(/const TRICK_PAUSE_MS = (\d+)/);
  const review = rooms.match(/export const TRICK_REVIEW_MS = (\d+)/);
  const flourish = rooms.match(/export const FLOURISH_HOLD_MS = (\d+)/);
  assert.ok(ai, "AI_PAUSE_MS");
  assert.ok(trick, "TRICK_PAUSE_MS");
  assert.ok(review, "TRICK_REVIEW_MS");
  assert.ok(flourish, "FLOURISH_HOLD_MS");
  assert.ok(Number(ai[1]) >= 1100 && Number(ai[1]) <= 1800, `AI play pause ${ai[1]}`);
  assert.ok(Number(trick[1]) >= 3500 && Number(trick[1]) <= 5500, `trick pause ${trick[1]}`);
  assert.ok(Number(review[1]) >= 1500 && Number(review[1]) <= 2000, `trick review ${review[1]}`);
  assert.equal(Number(flourish[1]), 1050);
});

test("the confirm-to-play bar overlays the dock and does not shrink the table", () => {
  const bar = block(css, ".confirm-bar");
  assert.match(bar, /position:\s*absolute/);
  assert.doesNotMatch(bar, /margin:\s*0 0 8px/);
  assert.match(js, /function confirmBarHTML/);
  const dock = block(css, ".table-dock");
  assert.match(dock, /position:\s*absolute/);
  const barParent = block(css, ".table-dock");
  assert.match(barParent, /bottom:\s*0/);
});

test("reconnect banner and special-play flourish are overlays and do not shrink the table", () => {
  const banner = block(css, ".banner");
  assert.match(banner, /position:\s*absolute/);
  assert.doesNotMatch(banner, /position:\s*sticky/);
  assert.match(js, /function bannerHTML/);
  assert.match(js, /正在重新連接/);
  assert.match(css, /\.flourish-overlay/);
  const fl = block(css, ".flourish-overlay");
  assert.match(fl, /position:\s*absolute/);
  const render = js.slice(js.indexOf("function renderTable"), js.indexOf("function handOverlap"));
  assert.match(render, /flourishBannerHTML/);
  const felt = render.slice(render.indexOf("table-felt felt-rich"), render.indexOf("table-felt felt-rich") + 180);
  assert.doesNotMatch(felt, /flourishBannerHTML/);
});

test("hand cards no longer show a question-mark badge", () => {
  assert.doesNotMatch(js, /class="card-info"/);
  assert.doesNotMatch(js, /aria-label="睇牌義">\?</);
  assert.match(js, /data-act="inspect"/);
  assert.match(js, /function openInspect/);
});

test("a selected hand card keeps its size and stacks above its neighbours", () => {
  assert.match(js, /z-index:\$\{selected \? 40 : i\}/);
  assert.match(css, /\.hand \.sk-wrap\.selected/);
  const sel = css.slice(css.indexOf(".hand .sk-wrap.selected"));
  const chunk = sel.slice(0, 900);
  assert.match(chunk, /z-index:\s*40/);
  assert.doesNotMatch(chunk, /scale\(1\.1\)/);
  assert.doesNotMatch(chunk, /scale\(1\.06\)/);
  assert.match(chunk, /scale\(1\)/);
  assert.match(chunk, /aspect-ratio:\s*784\s*\/\s*1100/);
});

test("bid buttons pulse a gentle border until the player has bid", () => {
  assert.match(js, /bid-need-pick/);
  assert.match(js, /bid-need-confirm/);
  assert.match(js, /needFirstBid && state\.bidValue == null/);
  assert.match(css, /@keyframes bid-need-pulse/);
  assert.match(css, /\.bid-grid\.bid-need-pick button/);
  assert.match(css, /\.btn\.bid-need-confirm/);
  const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduce, /bid-need-pick/);
  assert.match(reduce, /bid-need-confirm/);
  assert.match(css, /animation:\s*bid-need-pulse 1\.7s/);
});

test("match format is five rounds dealing 6 through 10 cards", () => {
  const game = readFileSync(join(root, "server/game.js"), "utf8");
  assert.match(game, /export const TOTAL_ROUNDS = 5/);
  assert.match(game, /return cardsDealtForRound\(this\.round\)/);
  assert.match(game, /round \+ 5/);
  assert.match(js, /一共 5 局。第 1 局每人 6 張/);
  assert.match(js, /第 5 局各 10 張/);
  assert.match(js, /第 \$\{v\.round\} 局／\$\{totalRounds\(v\)\}/);
});

test("player-facing copy says 回合, not 墩, and the bid title is exact", () => {
  assert.match(js, /預測會贏幾多回合？/);
  assert.doesNotMatch(js, /你估會贏幾墩？/);
  assert.doesNotMatch(js, /你估會贏幾回合？/);
  const cards = readFileSync(join(root, "public/cards.js"), "utf8");
  const game = readFileSync(join(root, "server/game.js"), "utf8");
  const rules = readFileSync(join(root, "server/rules.js"), "utf8");
  for (const [name, src] of [["app", js], ["cards", cards], ["game", game], ["rules", rules]]) {
    assert.equal(src.includes("墩"), false, `${name} still contains 墩`);
  }
  assert.match(js, /一共 5 局/);
});

test("avatar colors follow a stable seat index, not a hashed name or id", () => {
  const fn = js.slice(js.indexOf("function avatarStyle"), js.indexOf("function phoneLandscape"));
  assert.match(fn, /colorIndex/);
  assert.doesNotMatch(fn, /charCodeAt/);
  assert.doesNotMatch(fn, /2166136261/);
  assert.match(js, /avatarStyle\(p\.colorIndex \?\? playerIndex\)/);
  assert.match(css, /background:\s*var\(--av-bg/);
  const gold = css.slice(css.indexOf(".avatar.tone.gold"));
  assert.match(gold.slice(0, 400), /--av-bg/);
  assert.doesNotMatch(gold.slice(0, 280), /background:\s*var\(--gold\)/);
});

test("cardFaceHTML uses compressed house-rule art and does not overlay a second rank", () => {
  assert.match(js, /from "\.\/cards\.js"/);
  const cards = readFileSync(join(root, "public/cards.js"), "utf8");
  assert.match(cards, /export function cardArtUrl/);
  assert.match(cards, /export function cardFaceHTML/);
  assert.match(cards, /sk-card-art/);
  assert.match(cards, /\/cards\/escape\.webp/);
  assert.match(cards, /\/cards\/black-14-1\.webp/);
  assert.doesNotMatch(cards, /sk-rank/);
  assert.match(css, /\.sk-card-art/);
  assert.match(css, /object-fit:\s*contain/);
  const sk = css.slice(css.indexOf("\n.sk-card {"), css.indexOf("\n.sk-card.compact"));
  assert.match(sk, /aspect-ratio:\s*784\s*\/\s*1100/);
});

test("rules copy describes the 74-card house deck", () => {
  assert.match(js, /74 張牌嘅家規組牌/);
  assert.match(js, /2 張母老虎/);
  assert.match(js, /黑 14 兩張/);
  assert.doesNotMatch(js, /牌組 72 張：/);
});

test("cache bust is c27 and the site uses a licensed HK webfont", () => {
  assert.match(html, /app\.js\?v=c27/);
  assert.match(html, /styles\.css\?v=c27/);
  assert.match(html, /fonts\.googleapis\.com/);
  assert.match(html, /Chiron\+Hei\+HK/);
  assert.match(css, /"Chiron Hei HK"/);
  assert.match(css, /"PingFang HK"/);
  assert.match(css, /"Noto Sans TC"/);
});

test("the format is locked to five players with no seat picker", () => {
  const home = js.slice(js.indexOf("function renderHome"), js.indexOf("function renderLobby"));
  assert.doesNotMatch(home, /data-act="set-seats"/);
  assert.doesNotMatch(home, /2–6/);
  const lobby = js.slice(js.indexOf("function renderLobby"), js.indexOf("\nfunction signed"));
  assert.match(lobby, /呢個玩法只開五人桌/);
  assert.match(lobby, /五人玩法/);
  assert.doesNotMatch(lobby, /data-act="set-seats"/);
  assert.doesNotMatch(lobby, /2–6/);
});

test("夠分 seats get a green made frame, not when busted, and 0/0 counts", () => {
  assert.match(js, /const busted = p\.tricksWon > p\.bid;/);
  assert.match(js, /const made = !busted && p\.tricksWon === p\.bid;/);
  assert.match(js, /seat-bidline\$\{busted \? " busted" : made \? " made" : ""\}/);
  assert.match(css, /\.seat-bidline\.made/);
  assert.match(css, /#4ad88a/);
  assert.doesNotMatch(js, /made && busted/);
});

test("the current winning card is highlighted and 而家最大 stays", () => {
  assert.match(js, /而家最大：/);
  assert.match(js, /function midTrickCueHTML/);
  assert.match(js, /leading-now/);
  assert.match(css, /\.seat-card\.leading-now/);
  const lead = css.slice(css.indexOf(".seat-card.leading-now .sk-card"), css.indexOf(".seat-card.leading-now .sk-card") + 280);
  assert.doesNotMatch(lead, /scale\(/);
  assert.match(lead, /box-shadow/);
});

test("removed mid-trick chrome is gone from the playing surface, except 而家最大", () => {
  const table = js.slice(js.indexOf("function renderTable"), js.indexOf("function handOverlap"));
  assert.doesNotMatch(table, /prevTrickButtonHTML/);
  assert.doesNotMatch(table, /playWaitHTML/);
  assert.doesNotMatch(table, /myBidTrackHTML/);
  assert.doesNotMatch(table, /上一回合/);
  assert.doesNotMatch(table, /呢局各回合/);
  assert.doesNotMatch(table, /收起手牌/);
  assert.doesNotMatch(table, /已經夠回合/);
  assert.doesNotMatch(table, /仲等：/);
  assert.match(js, /而家最大：/);
  assert.match(table, /tableCuesRowHTML/);
});

test("match-start opening draw overlay exists and does not shrink the table", () => {
  assert.match(js, /function openingDrawHTML/);
  assert.match(js, /抽邊個出先/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(css, /\.opening-draw-overlay/);
  const ov = block(css, ".opening-draw-overlay");
  assert.match(ov, /position:\s*absolute/);
  assert.match(ov, /inset:\s*0/);
  const wrap = block(css, ".circle-wrap");
  assert.match(wrap, /--dock-reserve/);
});

test("a single tap on a hand card opens the large preview, not a long-press", () => {
  const table = js.slice(js.indexOf("function renderTable"), js.indexOf("function handOverlap"));
  assert.match(table, /playable/);
  assert.match(table, /data-act="inspect"/);
  assert.doesNotMatch(table, /data-act="select-card"/);
  assert.doesNotMatch(js, /function bindCardLongPress/);
  assert.match(js, /function openInspect/);
  assert.match(js, /function inspectPlayButtonsHTML/);
  assert.match(js, /confirm-inspect-play/);
  assert.match(css, /inspect-card-sheet/);
  const card = block(css, ".inspect-sheet.inspect-card-sheet .inspect-card .sk-card");
  assert.match(card, /76vw|58dvh|440px/);
  assert.match(card, /aspect-ratio:\s*784 \/ 1100/);
});

test("知道喇 is gone from the playing UI", () => {
  assert.doesNotMatch(js, /知道喇/);
  assert.doesNotMatch(js, /知道啦/);
  const inspectFn = js.slice(js.indexOf("function inspectHTML"), js.indexOf("function renderHome"));
  assert.match(inspectFn, /取消/);
  assert.doesNotMatch(inspectFn, /知道喇/);
});

test("assets preload behind a Loading screen with a progress bar", () => {
  assert.match(html, /id="asset-loader"/);
  assert.match(html, />Loading</);
  assert.match(html, /icon-192\.png/);
  assert.match(html, /asset-loader-bar/);
  assert.match(js, /function startAssetPreload/);
  assert.match(js, /allCardArtUrls/);
  assert.match(js, /function bindAssetLoader/);
  assert.match(css, /\.asset-loader/);
  assert.match(css, /\.asset-loader-word/);
  assert.match(cards, /export function allCardArtUrls/);
  assert.match(cards, /CARD_ART_FILES/);
});

test("輪到你出牌 sits in the hand tray and pulses, not in the top cue row", () => {
  const cues = js.slice(js.indexOf("function tableCuesRowHTML"), js.indexOf("function submitLobbyName"));
  assert.doesNotMatch(cues, /yourTurnHintHTML/);
  assert.match(js, /hand-tray-mid/);
  const table = js.slice(js.indexOf("function renderTable"), js.indexOf("function handOverlap"));
  assert.match(table, /hand-tray-mid/);
  assert.match(table, /yourTurnHintHTML\(v\)/);
  assert.match(table, /followSuitHintHTML\(v\)/);
  assert.match(css, /@keyframes your-turn-pulse/);
  assert.match(css, /\.your-turn-hint/);
  assert.match(css, /\.hand-tray-mid/);
});

test("preview, hand, and table cards are static still images with no card animation", () => {
  const inspectFn = js.slice(js.indexOf("function inspectHTML"), js.indexOf("function renderHome"));
  assert.doesNotMatch(inspectFn, /animated:\s*true/);
  assert.doesNotMatch(js, /animated:\s*true/);
  assert.doesNotMatch(cards, /animated = false/);
  assert.doesNotMatch(cards, /sk-card-bob/);
  assert.doesNotMatch(cards, /sk-card-vfx/);
  assert.doesNotMatch(cards, /is-preview-live/);
  assert.doesNotMatch(css, /@keyframes card-char-bob/);
  assert.doesNotMatch(css, /@keyframes card-vfx-spin/);
  assert.doesNotMatch(css, /sk-card-bob/);
  assert.doesNotMatch(js, /\.gif/i);
  assert.doesNotMatch(cards, /\.gif/i);
});

test("corner badges sit inside the frame and colour-suit ranks stay bold", () => {
  const opt = readFileSync(join(root, "scripts/optimize-card-art.py"), "utf8");
  assert.match(opt, /FRAME_PAD/);
  assert.match(opt, /WIDE_NAMES/);
  assert.match(opt, /bolden_rank_numbers/);
  assert.match(opt, /COLOR_SUITS/);
  assert.doesNotMatch(opt, /CORNER_SHIFT = 26/);
});
