import { cardFaceHTML, cardBackHTML, iconSVG, escapeHtml, CARD_HELP, SPECIAL_INFO, SUIT_INFO, cardHelpText, suitLabel } from "./cards.js";

const TOKEN_KEY = "sk_token";
const NAME_KEY = "sk_name";
const ROOM_KEY = "sk_room";
const MUTE_KEY = "sk_mute";
const A2HS_KEY = "sk_a2hs";

const state = {
  screen: "home", // home | lobby | play | rules
  rulesReturn: "home",
  ws: null,
  token: localStorage.getItem(TOKEN_KEY) || "",
  playerId: "",
  code: "",
  view: null,
  name: localStorage.getItem(NAME_KEY) || "",
  joinCode: "",
  bidValue: null,
  inspect: null,
  selectedCardId: null,
  trickAnimReady: false,
  seenTrickCardIds: new Set(),
  animatingPlayIds: new Set(),
  seenBustKeys: new Set(),
  explodingBustKeys: new Set(),
  scorePeek: false,
  prevTrickPeek: false,
  muted: localStorage.getItem(MUTE_KEY) === "1",
  leaveConfirm: false,
  showRoomCode: false,
  a2hsDismissed: localStorage.getItem(A2HS_KEY) === "1",
  announcedTurnKey: "",
  longPressFired: false,
  scrolledTurnKey: "",
  lastDealtKey: "",
  dealingKey: "",
  dealStartedAt: 0,
  flyKey: "",
  flyStartedAt: 0,
  flyDone: false,
  flyTimer: 0,
  seenGameOverKey: "",
  lastRound: 1,
  error: "",
  toast: "",
  toastTimer: 0,
  lanUrls: [],
  conn: "idle", // idle | connecting | open | reconnecting | closed
  pendingRoom: "",
  flourish: null,
  flourishTimer: 0,
  bidRevealKey: "",
  bidRevealStartedAt: 0,
  scoreFloatKey: "",
  scoreFloatStartedAt: 0,
  makeToastKeys: new Set(),
  makeReady: false,
  lobbySeen: false,
  lobbySnapshot: null,
  codeBoxFocus: null,
  autoJoinLock: false,
};

const app = document.getElementById("app");

const SOUND_SRCS = {
  flip: ["/sounds/card-flip.ogg", "/sounds/card-flip.mp3"],
  click: ["/sounds/ui-click.ogg", "/sounds/ui-click.mp3"],
};
const soundBank = {
  flip: { buffer: null, start: 0, fallback: [], volume: 0.55 },
  click: { buffer: null, start: 0, fallback: [], volume: 0.32 },
};
let audioCtx = null;
let soundsLoading = false;

function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function audibleStart(buffer, threshold = 0.012) {
  const ch = buffer.getChannelData(0);
  const minOff = Math.min(ch.length, Math.floor(buffer.sampleRate * 0.08));
  for (let i = 0; i < minOff; i++) {
    if (Math.abs(ch[i]) > threshold) return Math.max(0, i / buffer.sampleRate);
  }
  return 0;
}

async function decodeSound(urls) {
  const ctx = getAudioCtx();
  if (!ctx) return null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const raw = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(raw.slice(0));
      return { buffer, start: audibleStart(buffer) };
    } catch {
      /* try next format */
    }
  }
  return null;
}

function makeFallbackAudio(urls) {
  const a = new Audio();
  const preferMp3 = a.canPlayType("audio/mpeg");
  a.src = preferMp3 ? (urls.find((u) => u.endsWith(".mp3")) || urls[0]) : urls[0];
  a.preload = "auto";
  return a;
}

function loadSounds() {
  if (soundsLoading) return;
  soundsLoading = true;
  getAudioCtx();
  Object.keys(SOUND_SRCS).forEach((key) => {
    decodeSound(SOUND_SRCS[key]).then((decoded) => {
      if (decoded) {
        soundBank[key].buffer = decoded.buffer;
        soundBank[key].start = decoded.start;
      }
    }).catch(() => {});
  });
}

function unlockAudio() {
  getAudioCtx();
  loadSounds();
}

function playSound(key) {
  try {
    if (state.muted) return;
    unlockAudio();
    const entry = soundBank[key];
    if (!entry) return;
    const ctx = audioCtx;
    if (ctx && entry.buffer) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = entry.buffer;
      gain.gain.value = entry.volume;
      src.connect(gain).connect(ctx.destination);
      src.start(0, entry.start);
      return;
    }
    let a = entry.fallback.find((x) => x.paused || x.ended);
    if (!a) {
      if (entry.fallback.length >= 3) a = entry.fallback[0];
      else {
        a = makeFallbackAudio(SOUND_SRCS[key]);
        entry.fallback.push(a);
      }
    }
    a.volume = entry.volume;
    const skip = entry.start || 0;
    try { a.currentTime = skip; } catch { /* some browsers block until loaded */ }
    a.play().catch(() => {});
  } catch {
    /* never block the game */
  }
}

function playCardFlip() { playSound("flip"); }
function playUiClick() { playSound("click"); }

function playTurnChime() {
  try {
    if (state.muted) return;
    unlockAudio();
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch {
    /* never block the game */
  }
}

function maybeAnnounceTurn(v) {
  if (!v || !v.inGame) return;
  const me = (v.players || []).find((p) => p.id === v.yourId);
  let key = "";
  if (v.phase === "bidding" && me && !me.hasBid) key = "bid:" + v.round;
  else if (v.phase === "playing" && v.isMyTurn) key = "play:" + v.round + ":" + (v.trickNumber || 0);
  if (!key || key === state.announcedTurnKey) return;
  state.announcedTurnKey = key;
  playTurnChime();
  haptic(22);
}

const FLOURISH_TEXT = {
  mermaid: "人魚出咗！",
  pirate: "海盜出咗！",
  skullKing: "骷髏王出咗！",
  kraken: "八爪魚出咗！",
  whiteWhale: "白鯨出咗！",
};

function playBeepSequence(notes, { type = "sine", peak = 0.07, attack = 0.02, decay = 0.22, step = 0.09 } = {}) {
  try {
    if (state.muted) return;
    unlockAudio();
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const start = now + i * step;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + decay + 0.02);
    });
  } catch {
    /* never block the game */
  }
}

function playFlourishSting(kind) {
  if (kind === "mermaid") playBeepSequence([659.25, 830.61, 987.77], { type: "triangle", peak: 0.08, decay: 0.28, step: 0.08 });
  else if (kind === "pirate") playBeepSequence([196, 246.94, 392], { type: "sawtooth", peak: 0.05, decay: 0.2, step: 0.1 });
  else if (kind === "skullKing") playBeepSequence([110, 82.41, 55], { type: "square", peak: 0.045, decay: 0.32, step: 0.12 });
  else if (kind === "kraken") playBeepSequence([65.41, 49, 98], { type: "sawtooth", peak: 0.055, decay: 0.36, step: 0.11 });
  else if (kind === "whiteWhale") playBeepSequence([174.61, 220, 349.23], { type: "sine", peak: 0.07, decay: 0.34, step: 0.12 });
}

function playMakeChime() {
  playBeepSequence([659.25, 830.61, 987.77, 1318.51], { type: "triangle", peak: 0.075, attack: 0.015, decay: 0.26, step: 0.07 });
}

function playLobbyTick() {
  playBeepSequence([784.0], { type: "sine", peak: 0.04, attack: 0.01, decay: 0.12, step: 0 });
}

function flourishKindForPlay(played) {
  if (!played?.card) return "";
  if (played.card.special === "tigress") return played.tigressAsPirate ? "pirate" : "";
  const kind = played.card.special;
  return FLOURISH_TEXT[kind] ? kind : "";
}

function maybeSpecialFlourish(played) {
  const kind = flourishKindForPlay(played);
  if (!kind) return;
  const text = FLOURISH_TEXT[kind];
  state.flourish = { text, kind, startedAt: performance.now() };
  playFlourishSting(kind);
  clearTimeout(state.flourishTimer);
  state.flourishTimer = setTimeout(() => {
    state.flourish = null;
    state.flourishTimer = 0;
    render();
  }, 1050);
}

function flourishBannerHTML() {
  if (!state.flourish) return "";
  const elapsed = performance.now() - (state.flourish.startedAt || 0);
  if (elapsed >= 1100) return "";
  return `<div class="flourish-banner" data-kind="${escapeHtml(state.flourish.kind)}" role="status">${escapeHtml(state.flourish.text)}</div>`;
}

function maybeCelebrateMake(v) {
  if (!v || !v.inGame) return;
  const me = (v.players || []).find((p) => p.id === v.yourId);
  if (!me || !v.bidsRevealed || me.bid == null) {
    if (v.inGame) state.makeReady = true;
    return;
  }
  const key = `${v.round}:${me.id}`;
  const made = me.bid > 0 && me.tricksWon === me.bid && me.tricksWon <= me.bid;
  if (!state.makeReady) {
    if (made) state.makeToastKeys.add(key);
    state.makeReady = true;
    return;
  }
  if (!made || state.makeToastKeys.has(key)) return;
  if (v.phase === "bidding") return;
  state.makeToastKeys.add(key);
  showToast("估中喇！", { defer: true });
  playMakeChime();
  haptic(20);
}

function maybeLobbyToasts(v) {
  if (!v || v.inGame || v.phase !== "lobby") {
    if (v?.inGame) {
      state.lobbySeen = false;
      state.lobbySnapshot = null;
    }
    return;
  }
  const players = v.lobbyPlayers || [];
  const snap = players.map((p) => ({ id: p.id, name: p.name, ready: !!p.ready }));
  if (!state.lobbySeen || state.conn === "reconnecting" || state.conn === "connecting") {
    state.lobbySeen = true;
    state.lobbySnapshot = snap;
    return;
  }
  const prevMap = new Map((state.lobbySnapshot || []).map((p) => [p.id, p]));
  const nextMap = new Map(snap.map((p) => [p.id, p]));
  const me = v.yourId;
  let msg = "";
  for (const p of snap) {
    if (p.id === me) continue;
    const old = prevMap.get(p.id);
    if (!old) msg = `${p.name}入咗房`;
    else if (!old.ready && p.ready) msg = `${p.name}已準備`;
    else if (old.ready && !p.ready) msg = `${p.name}取消準備`;
  }
  for (const old of state.lobbySnapshot || []) {
    if (old.id === me) continue;
    if (!nextMap.has(old.id)) msg = `${old.name}離開咗`;
  }
  state.lobbySnapshot = snap;
  if (msg) {
    showToast(msg, { defer: true });
    playLobbyTick();
  }
}

function playerConnected(p, v) {
  if (!p) return true;
  if (p.isAI) return true;
  const list = v?.lobbyPlayers || [];
  const h = list.find((x) => x.id === p.id);
  if (!h) return true;
  return h.connected !== false;
}

function handStackHTML(count) {
  const n = Math.max(0, Math.min(Number(count) || 0, 5));
  if (!n) return "";
  const layers = Array.from({ length: n }, (_, i) => `<i style="--s:${i}"></i>`).join("");
  return `<span class="hand-stack" aria-hidden="true">${layers}</span>`;
}

function bidRevealAttr(v, visualIndex) {
  if (!v?.bidsRevealed) return { cls: "", style: "" };
  const key = String(v.round);
  const n = (v.players || []).length;
  const total = 70 * Math.max(0, n - 1) + 430;
  if (state.bidRevealKey !== key) {
    state.bidRevealKey = key;
    state.bidRevealStartedAt = performance.now();
  }
  const elapsed = performance.now() - state.bidRevealStartedAt;
  if (elapsed >= total) return { cls: "", style: "" };
  return {
    cls: " bid-reveal",
    style: `--reveal-i:${visualIndex};--reveal-base:${(-elapsed).toFixed(0)}ms`,
  };
}

function scoreFloaterHTML(v, playerId, visualIndex) {
  if (!v || (v.phase !== "roundResult" && v.phase !== "gameOver")) return "";
  const latest = (v.scores || [])[v.scores.length - 1];
  if (!latest) return "";
  const key = v.phase === "gameOver" ? `go:${v.round}` : `rr:${v.round}`;
  if (state.scoreFloatKey !== key) {
    state.scoreFloatKey = key;
    state.scoreFloatStartedAt = performance.now();
  }
  const elapsed = performance.now() - state.scoreFloatStartedAt;
  if (elapsed >= 1500) return "";
  const row = (latest.rows || []).find((r) => r.playerId === playerId);
  if (!row || row.roundTotal == null) return "";
  const cls = row.roundTotal < 0 ? "neg" : "pos";
  const label = row.roundTotal > 0 ? `+${row.roundTotal}` : String(row.roundTotal);
  const delay = (-elapsed + visualIndex * 60).toFixed(0);
  return `<div class="score-floater ${cls}" style="--float-base:${delay}ms">${escapeHtml(label)}</div>`;
}

function roundRailHTML(v) {
  if (!v || !v.round) return "";
  const cur = Math.min(10, Math.max(1, v.round));
  const segs = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const cls = n < cur ? "done" : n === cur ? "current" : "future";
    return `<span class="round-seg ${cls}"></span>`;
  }).join("");
  return `<div class="round-rail" aria-label="進度：第 ${cur}／10 局">${segs}</div>`;
}

function normalizeJoinCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function maybeAutoJoin(code) {
  const raw = normalizeJoinCode(code);
  if (raw.length !== 6) return false;
  if (state.autoJoinLock) return false;
  if (state.screen !== "home") return false;
  state.autoJoinLock = true;
  joinRoom(raw);
  setTimeout(() => { state.autoJoinLock = false; }, 1200);
  return true;
}

function codeBoxesHTML(prefill) {
  const code = normalizeJoinCode(prefill);
  const boxes = Array.from({ length: 6 }, (_, i) => {
    const ch = code[i] || "";
    return `<input class="code-box" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="1" data-box="${i}" value="${escapeHtml(ch)}" aria-label="房號第 ${i + 1} 個字" spellcheck="false">`;
  }).join("");
  return `
    <label class="field-label" for="code-input">房號</label>
    <input id="code-input" class="code-input-sr" maxlength="6" value="${escapeHtml(code)}" autocapitalize="characters" autocomplete="off" inputmode="text" enterkeyhint="go" spellcheck="false" />
    <div class="join-row">
      <div class="code-boxes" role="group" aria-label="房號">${boxes}</div>
      <button type="button" class="btn btn-ghost" data-act="paste-code">貼上</button>
      <button type="button" class="btn btn-ghost" data-act="join">加入</button>
    </div>`;
}

function bindCodeBoxes() {
  if (state.screen !== "home") return;
  const hidden = app.querySelector("#code-input");
  const boxes = [...app.querySelectorAll(".code-box")];
  if (!boxes.length) return;

  const readBoxes = () => normalizeJoinCode(boxes.map((b) => b.value || "").join(""));

  const sync = (code, { focusIndex, joinIfFull } = {}) => {
    const raw = normalizeJoinCode(code);
    state.joinCode = raw;
    boxes.forEach((b, i) => {
      if (b.value !== (raw[i] || "")) b.value = raw[i] || "";
    });
    if (hidden && hidden.value !== raw) hidden.value = raw;
    if (typeof focusIndex === "number" && boxes[focusIndex]) {
      boxes[focusIndex].focus();
      boxes[focusIndex].select();
      state.codeBoxFocus = focusIndex;
    }
    if (joinIfFull) maybeAutoJoin(raw);
  };

  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      const typed = normalizeJoinCode(box.value);
      if (typed.length > 1) {
        const prefix = readBoxes().slice(0, i);
        sync(prefix + typed, { focusIndex: Math.min(5, (prefix + typed).length), joinIfFull: true });
        return;
      }
      const chars = boxes.map((b, j) => (j === i ? typed.slice(-1) : (b.value || "")));
      const raw = normalizeJoinCode(chars.join(""));
      box.value = typed.slice(-1);
      sync(raw, { focusIndex: typed ? Math.min(5, i + 1) : i, joinIfFull: true });
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) {
        e.preventDefault();
        boxes[i - 1].value = "";
        sync(readBoxes(), { focusIndex: i - 1 });
      } else if (e.key === "Enter") {
        e.preventDefault();
        joinRoom();
      } else if (e.key === "ArrowLeft" && i > 0) {
        e.preventDefault();
        boxes[i - 1].focus();
        boxes[i - 1].select();
        state.codeBoxFocus = i - 1;
      } else if (e.key === "ArrowRight" && i < 5) {
        e.preventDefault();
        boxes[i + 1].focus();
        boxes[i + 1].select();
        state.codeBoxFocus = i + 1;
      }
    });
    box.addEventListener("paste", (e) => {
      const raw = e.clipboardData?.getData("text") || "";
      if (!raw) return;
      e.preventDefault();
      const prefix = readBoxes().slice(0, i);
      const next = normalizeJoinCode(prefix + raw);
      sync(next, { focusIndex: Math.min(5, Math.max(0, next.length - 1)), joinIfFull: true });
    });
    box.addEventListener("focus", () => {
      state.codeBoxFocus = i;
    });
  });

  if (hidden) {
    hidden.addEventListener("input", () => {
      sync(hidden.value, { focusIndex: Math.min(5, normalizeJoinCode(hidden.value).length), joinIfFull: true });
    });
  }
}

function haptic(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

function muteToggleHTML() {
  const muted = !!state.muted;
  const label = muted ? "開聲" : "靜音";
  const icon = muted
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm10.5 3c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A6.9 6.9 0 0 0 19 12c0-3.83-2.62-7.04-6.2-7.93v2.06c2.89.86 5 3.54 5 6.87zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.9 8.9 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3z"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
  return `<button type="button" class="mute-btn" data-act="toggle-mute" aria-label="${label}" aria-pressed="${muted ? "true" : "false"}" title="${label}">${icon}</button>`;
}

function toggleMute() {
  state.muted = !state.muted;
  try { localStorage.setItem(MUTE_KEY, state.muted ? "1" : "0"); } catch { /* ignore */ }
  if (!state.muted) playUiClick();
  haptic(10);
  render();
}

async function shareRoom() {
  const code = state.code || state.view?.code || "";
  if (!code) return;
  const url = shareUrl(code);
  const text = `一齊嚟玩骷髏王！房號 ${code}\n${url}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "骷髏王", text, url });
    } catch (err) {
      const msg = String(err?.name || "") + " " + String(err?.message || "");
      const cancelled = /AbortError|cancel|abort/i.test(msg);
      if (!cancelled) copyText(url);
    }
    return;
  }
  copyText(url);
}

let wakeLockSentinel = null;

async function requestWakeLock() {
  try {
    if (!navigator.wakeLock?.request) return;
    if (document.visibilityState !== "visible") return;
    if (state.screen !== "lobby" && state.screen !== "play") return;
    if (wakeLockSentinel) return;
    const lock = await navigator.wakeLock.request("screen");
    wakeLockSentinel = lock;
    lock.addEventListener("release", () => {
      if (wakeLockSentinel === lock) wakeLockSentinel = null;
    });
  } catch {
    wakeLockSentinel = null;
  }
}

async function releaseWakeLock() {
  const lock = wakeLockSentinel;
  wakeLockSentinel = null;
  if (!lock) return;
  try { await lock.release(); } catch { /* ignore */ }
}

function syncWakeLock() {
  if (state.screen === "lobby" || state.screen === "play") requestWakeLock();
  else releaseWakeLock();
}

const SUIT_ORDER = { yellow: 0, green: 1, purple: 2, black: 3 };
const SPECIAL_ORDER = { escape: 0, tigress: 1, mermaid: 2, pirate: 3, skullKing: 4, kraken: 5, whiteWhale: 6 };

function sortHand(cards) {
  return cards.slice().sort((a, b) => {
    const as = a.special ? 1 : 0;
    const bs = b.special ? 1 : 0;
    if (as !== bs) return as - bs;
    if (a.special) return (SPECIAL_ORDER[a.special] ?? 9) - (SPECIAL_ORDER[b.special] ?? 9);
    const su = (SUIT_ORDER[a.suit] ?? 9) - (SUIT_ORDER[b.suit] ?? 9);
    if (su) return su;
    return (b.rank || 0) - (a.rank || 0);
  });
}

function suitPip(suit) {
  if (!suit || !SUIT_INFO[suit]) return "";
  return `<span class="suit-pip suit-${suit}" title="${escapeHtml(suitLabel(suit))}" aria-hidden="true"></span>`;
}

function pathCode() {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/i);
  return m ? m[0].slice(3).toUpperCase() : "";
}

function shareUrl(code) {
  return `${location.origin}/r/${code}`;
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function setToken(token, code) {
  state.token = token || "";
  state.code = code || state.code;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (code) localStorage.setItem(ROOM_KEY, code);
}

function showToast(msg, { defer = false } = {}) {
  state.toast = msg;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 1800);
  if (!defer) render();
}

function setError(msg) {
  state.error = msg || "";
  render();
}

function send(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    setError("尚未連上伺服器，請稍等再試。");
    return false;
  }
  state.ws.send(JSON.stringify(payload));
  return true;
}

function goHome({ clearToken = false } = {}) {
  state.screen = "home";
  state.view = null;
  state.error = "";
  state.pendingRoom = "";
  state.selectedCardId = null;
  state.inspect = null;
  state.scorePeek = false;
  state.prevTrickPeek = false;
  state.leaveConfirm = false;
  state.showRoomCode = false;
  state.flourish = null;
  clearTimeout(state.flourishTimer);
  state.lobbySeen = false;
  state.lobbySnapshot = null;
  state.makeReady = false;
  state.autoJoinLock = false;
  resetTrickAnim();
  releaseWakeLock();
  if (clearToken) {
    setToken("", "");
    localStorage.removeItem(ROOM_KEY);
    state.playerId = "";
  }
  if (location.pathname !== "/") history.pushState({}, "", "/");
  render();
}

function enterRoomPath(code) {
  const path = `/r/${code}`;
  if (location.pathname !== path) history.pushState({ code }, "", path);
}

let retryAt = 0;
let retryTimer = 0;
let retryDelay = 600;

function connect({ onOpen } = {}) {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    if (state.ws.readyState === WebSocket.OPEN && onOpen) onOpen();
    else if (onOpen) state._onOpen = onOpen;
    return;
  }
  state.conn = state.token && (state.code || pathCode()) ? "reconnecting" : "connecting";
  render();
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  ws.addEventListener("open", () => {
    retryDelay = 600;
    state.conn = "open";
    state.error = "";
    const cb = onOpen || state._onOpen;
    state._onOpen = null;
    if (cb) cb();
    render();
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    onMessage(msg);
  });
  ws.addEventListener("close", () => {
    if (state.ws === ws) {
      state.ws = null;
      state.conn = state.screen === "home" ? "closed" : "reconnecting";
      state.lobbySeen = false;
      render();
      scheduleReconnect();
    }
  });
  ws.addEventListener("error", () => {
    // close handler will retry
  });
}

function scheduleReconnect() {
  if (state.screen === "home" && !state.token) return;
  if (!state.token && !state.pendingRoom) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    connect({
      onOpen() {
        if (state.token) send({ type: "reconnect", token: state.token });
      },
    });
  }, retryDelay);
  retryDelay = Math.min(5000, retryDelay * 1.6);
}

function onMessage(msg) {
  if (msg.type === "error") {
    setError(msg.message);
    // If reconnect failed, stay on home with the message.
    if (state.screen !== "home" && /房間已經散|找不到之前|房號唔啱/.test(msg.message || "")) {
      goHome({ clearToken: true });
      state.error = msg.message;
      render();
    }
    return;
  }
  if (msg.type === "welcome") {
    setToken(msg.token, msg.code);
    state.playerId = msg.playerId;
    state.code = msg.code;
    enterRoomPath(msg.code);
    return;
  }
  if (msg.type === "left") {
    goHome({ clearToken: msg.dropped !== false });
    return;
  }
  if (msg.type === "pong") return;
  if (msg.type === "state") {
    const prevRound = state.view?.round;
    state.view = msg;
    state.code = msg.code;
    state.error = "";
    if (msg.phase === "lobby" || !msg.inGame) {
      state.screen = state.screen === "rules" ? "rules" : "lobby";
      if (state.screen !== "rules") state.rulesReturn = "lobby";
      state.trickAnimReady = false;
      state.seenTrickCardIds = new Set();
      state.animatingPlayIds = new Set();
      state.seenBustKeys = new Set();
      state.explodingBustKeys = new Set();
      state.scorePeek = false;
      state.prevTrickPeek = false;
      state.lastDealtKey = "";
      state.flourish = null;
      clearTimeout(state.flourishTimer);
      state.makeReady = false;
      state.makeToastKeys = new Set();
      state.bidRevealKey = "";
      state.scoreFloatKey = "";
      resetFlyAnim();
      maybeLobbyToasts(msg);
    } else {
      state.screen = state.screen === "rules" ? "rules" : "play";
      if (state.screen !== "rules") state.rulesReturn = "play";
      if (prevRound && msg.round !== prevRound) {
        state.bidValue = null;
        state.seenBustKeys = new Set();
        state.explodingBustKeys = new Set();
        state.flourish = null;
        clearTimeout(state.flourishTimer);
        if (msg.round < prevRound) {
          state.makeToastKeys = new Set();
          state.bidRevealKey = "";
          state.scoreFloatKey = "";
        }
      }
      if (msg.phase === "bidding" && state.bidValue != null && state.bidValue > msg.cardsDealt) state.bidValue = null;
      if (msg.phase !== "playing" || !msg.isMyTurn) state.selectedCardId = null;
      else if (state.selectedCardId && !(msg.legalCardIds || []).includes(state.selectedCardId)) {
        state.selectedCardId = null;
      }
      maybeLobbyToasts(msg);
      maybeCelebrateMake(msg);
      maybeAnnounceTurn(msg);
    }
    render();
  }
}

function openRules() {
  state.rulesReturn = state.screen === "rules" ? state.rulesReturn : state.screen;
  state.screen = "rules";
  render();
}

function closeRules() {
  state.screen = state.rulesReturn || "home";
  render();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("已複製");
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("已複製");
      return true;
    } catch {
      showToast("複製唔到，請手動揀");
      return false;
    }
  }
}

async function pasteCode() {
  try {
    const raw = (await navigator.clipboard.readText() || "").trim().toUpperCase();
    const match = raw.match(/[A-Z0-9]{4,8}/);
    const code = match ? match[0].slice(0, 6) : "";
    if (!code) {
      showToast("剪貼板冇房號");
      return;
    }
    state.joinCode = code;
    state.error = "";
    if (code.length === 6) {
      maybeAutoJoin(code);
      return;
    }
    showToast("已貼上 " + code);
    render();
  } catch {
    showToast("請手動輸入房號，或先複製再試");
  }
}

function shouldShowA2hs() {
  if (state.a2hsDismissed) return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (standalone) return false;
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  const ua = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return narrow || ua;
}

function a2hsHTML() {
  if (!shouldShowA2hs()) return "";
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const how = ios
    ? "喺 Safari 撳底部分享掣，再揀「加到主畫面」，下次一撳就開。"
    : "用瀏覽器選單揀「加到主畫面」或「安裝應用程式」，下次一撳就開。";
  return "<div class=\"a2hs-tip\" role=\"status\"><p>想更似應用程式？" + how + "</p><button type=\"button\" class=\"btn-text\" data-act=\"dismiss-a2hs\">知喇</button></div>";
}

function dismissA2hs() {
  state.a2hsDismissed = true;
  try { localStorage.setItem(A2HS_KEY, "1"); } catch { /* ignore */ }
  render();
}

function leaveConfirmHTML() {
  if (!state.leaveConfirm) return "";
  return "<div class=\"overlay center\" data-act=\"cancel-leave\"><div class=\"sheet\" data-stop=\"1\">" +
    "<h2>確定離開？</h2>" +
    "<p>牌局仲進行緊。用同一部電話重新打開呢個連結就可以返嚟繼續。</p>" +
    "<div class=\"confirm-actions\"><button type=\"button\" class=\"btn btn-sheet\" data-act=\"cancel-leave\">繼續玩</button>" +
    "<button type=\"button\" class=\"btn btn-ink\" data-act=\"confirm-leave\">離開</button></div></div></div>";
}

function showCodeHTML(code) {
  if (!state.showRoomCode || !code) return "";
  return "<div class=\"overlay center show-code-overlay\" data-act=\"close-show-code\">" +
    "<div class=\"sheet show-code-sheet\" data-stop=\"1\">" +
    "<p class=\"label\">把房號出示俾朋友</p>" +
    "<div class=\"giant-code\">" + escapeHtml(code) + "</div>" +
    "<p class=\"show-code-url\">" + escapeHtml(shareUrl(code)) + "</p>" +
    "<p class=\"sub\">朋友輸入呢個號，或者打開上面條連結，就可以加入。</p>" +
    "<button type=\"button\" class=\"btn btn-gold\" data-act=\"copy-code\">複製房號</button>" +
    "<button type=\"button\" class=\"btn btn-sheet\" data-act=\"close-show-code\">關閉</button>" +
    "</div></div>";
}

function bindCardLongPress() {
  app.querySelectorAll(".sk-wrap .sk-play, .seat-card[data-act='inspect']").forEach((btn) => {
    let timer = 0;
    const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    btn.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      state.longPressFired = false;
      const id = btn.dataset.id;
      if (!id) return;
      const why = btn.dataset.why || "";
      const x0 = e.clientX, y0 = e.clientY;
      const move = (ev) => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) clear();
      };
      const stop = () => {
        clear();
        btn.removeEventListener("pointermove", move);
        btn.removeEventListener("pointerup", stop);
        btn.removeEventListener("pointercancel", stop);
      };
      btn.addEventListener("pointermove", move);
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointercancel", stop);
      timer = window.setTimeout(() => {
        timer = 0;
        state.longPressFired = true;
        haptic(10);
        openInspect(id, why);
      }, 420);
    });
    btn.addEventListener("click", (e) => {
      if (state.longPressFired) {
        e.preventDefault();
        e.stopImmediatePropagation();
        state.longPressFired = false;
      }
    }, true);
  });
}

function scrollPlayableIntoView() {
  const v = state.view;
  if (state.screen !== "play" || !v || !v.isMyTurn || v.phase !== "playing") return;
  const key = v.round + ":" + (v.trickNumber || 0) + ":" + (v.legalCardIds || []).join(",");
  if (state.scrolledTurnKey === key) return;
  state.scrolledTurnKey = key;
  const el = app.querySelector(".sk-wrap.selected") || app.querySelector(".sk-wrap.playable");
  if (el) el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function createRoom() {
  const name = state.name.trim();
  if (name) localStorage.setItem(NAME_KEY, name);
  connect({
    onOpen() {
      send({ type: "createRoom", name });
    },
  });
}

function joinRoom(code) {
  const raw = (code || state.joinCode || pathCode()).trim().toUpperCase();
  if (!raw) {
    setError("請輸入房號。");
    return;
  }
  const name = state.name.trim();
  if (name) localStorage.setItem(NAME_KEY, name);
  state.pendingRoom = raw;
  connect({
    onOpen() {
      send({ type: "joinRoom", code: raw, name, token: state.token });
    },
  });
}

function savedRoomCode() {
  return pathCode() || localStorage.getItem(ROOM_KEY) || "";
}

function tryResume() {
  if (pathCode()) state.joinCode = pathCode();
  // Opening a share link should drop you back into the room.
  // On the home page, let the player choose to return, so they are not yanked into a mid-game session.
  if (pathCode() && state.token) {
    state.code = pathCode();
    connect({
      onOpen() {
        send({ type: "reconnect", token: state.token });
      },
    });
  }
}

function resumeSavedGame() {
  const code = savedRoomCode();
  if (!state.token || !code) {
    setError("搵唔到之前嘅牌局。");
    return;
  }
  state.code = code;
  connect({
    onOpen() {
      send({ type: "reconnect", token: state.token });
    },
  });
}

function discardSavedGame() {
  setToken("", "");
  localStorage.removeItem(ROOM_KEY);
  state.playerId = "";
  state.error = "";
  render();
}

// Event delegation
app.addEventListener("pointerdown", () => { unlockAudio(); syncWakeLock(); }, { passive: true });
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  // Only ignore backdrop taps that land inside the sheet; 知道喇 itself must still close.
  if (t.classList.contains("overlay") && e.target.closest("[data-stop]")) return;
  const act = t.dataset.act;
  const view = state.view;
  if (act === "toggle-mute") {
    toggleMute();
    return;
  }
  const cardActs = act === "inspect" || act === "select-card" || act === "play-card";
  const silentActs = t.classList.contains("overlay") && (act === "close-inspect" || act === "close-score-peek" || act === "close-prev-trick" || act === "close-show-code" || act === "cancel-leave");
  if (!cardActs && !silentActs) playUiClick();
  if (act === "create") createRoom();
  else if (act === "join") joinRoom();
  else if (act === "rules") openRules();
  else if (act === "close-rules") closeRules();
  else if (act === "resume") resumeSavedGame();
  else if (act === "discard-session") discardSavedGame();
  else if (act === "inspect") {
    e.stopPropagation();
    if (!e.target.closest(".card-info")) playCardFlip();
    openInspect(t.dataset.id, t.dataset.why || "");
    return;
  }
  else if (act === "close-inspect") { state.inspect = null; render(); return; }
  else if (act === "card-legend") { state.inspect = { type: "legend" }; state.scorePeek = false; state.prevTrickPeek = false; render(); return; }
  else if (act === "score-peek") { state.inspect = null; state.prevTrickPeek = false; state.scorePeek = true; render(); return; }
  else if (act === "close-score-peek") { state.scorePeek = false; render(); return; }
  else if (act === "prev-trick") { state.inspect = null; state.scorePeek = false; state.prevTrickPeek = true; render(); return; }
  else if (act === "close-prev-trick") { state.prevTrickPeek = false; render(); return; }
  else if (act === "share-room") { shareRoom(); return; }
  else if (act === "copy-code") copyText(state.code);
  else if (act === "copy-link") copyText(shareUrl(state.code));
  else if (act === "seats-inc") send({ type: "setSeats", count: (view?.seats || 4) + 1 });
  else if (act === "seats-dec") send({ type: "setSeats", count: (view?.seats || 4) - 1 });
  else if (act === "ai-fill") send({ type: "setAiFill", enabled: t.dataset.on !== "1" });
  else if (act === "ready") send({ type: "ready", ready: t.dataset.on !== "1" });
  else if (act === "start") send({ type: "startGame" });
  else if (act === "leave") {
    if (view?.inGame) {
      state.leaveConfirm = true;
      render();
      return;
    }
    send({ type: "leave" });
  }
  else if (act === "confirm-leave") {
    state.leaveConfirm = false;
    send({ type: "leave" });
    if (view?.inGame) goHome({ clearToken: false });
  }
  else if (act === "cancel-leave") {
    state.leaveConfirm = false;
    render();
    return;
  }
  else if (act === "paste-code") { pasteCode(); return; }
  else if (act === "dismiss-a2hs") { dismissA2hs(); return; }
  else if (act === "show-code") { state.showRoomCode = true; render(); return; }
  else if (act === "close-show-code") { state.showRoomCode = false; render(); return; }
  else if (act === "bid-pick") { state.bidValue = Number(t.dataset.n); render(); }
  else if (act === "bid-submit") {
    if (state.bidValue == null) { setError("請先揀你叫幾多墩。"); return; }
    haptic(16);
    send({ type: "bid", value: state.bidValue });
  }
  else if (act === "select-card" || act === "play-card") {
    const id = t.dataset.id;
    const legal = new Set(view?.legalCardIds || []);
    state.inspect = null;
    playCardFlip();
    if (view?.phase !== "playing" || !view?.isMyTurn || !legal.has(id)) {
      openInspect(id, t.dataset.why || "");
      return;
    }
    haptic(12);
    state.selectedCardId = state.selectedCardId === id ? null : id;
    render();
    return;
  }
  else if (act === "confirm-play") {
    if (!state.selectedCardId) return;
    const id = state.selectedCardId;
    state.selectedCardId = null;
    state.inspect = null;
    haptic(18);
    send({ type: "play", cardId: id });
  }
  else if (act === "confirm-tig-pirate") {
    if (!state.selectedCardId) return;
    const id = state.selectedCardId;
    state.selectedCardId = null;
    state.inspect = null;
    haptic(18);
    send({ type: "play", cardId: id, tigressAsPirate: true });
  }
  else if (act === "confirm-tig-escape") {
    if (!state.selectedCardId) return;
    const id = state.selectedCardId;
    state.selectedCardId = null;
    state.inspect = null;
    haptic(18);
    send({ type: "play", cardId: id, tigressAsPirate: false });
  }
  else if (act === "cancel-play") {
    state.selectedCardId = null;
    render();
    return;
  }
  else if (act === "tig-pirate") send({ type: "resolveTigress", asPirate: true });
  else if (act === "tig-escape") send({ type: "resolveTigress", asPirate: false });
  else if (act === "tig-cancel") send({ type: "cancelTigress" });
  else if (act === "continue") send({ type: "continueRound" });
  else if (act === "play-again") send({ type: "playAgain" });
  else if (act === "back-lobby") send({ type: "backToLobby" });
});

app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "name-input") {
    state.name = t.value;
  } else if (t.id === "code-input") {
    state.joinCode = t.value.toUpperCase();
  }
});

app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "code-input") joinRoom();
  else if (e.target.id === "name-input" && state.screen === "home") {
    if ((state.joinCode || pathCode()).trim()) joinRoom();
  }
});

window.addEventListener("popstate", () => {
  const code = pathCode();
  if (!code) {
    if (state.view?.inGame) {
      state.screen = "play";
      enterRoomPath(state.code);
      render();
      return;
    }
    goHome({ clearToken: false });
  } else if (state.token) {
    joinRoom(code);
  } else {
    state.joinCode = code;
    state.screen = "home";
    render();
  }
});

function bannerHTML() {
  if (state.conn === "reconnecting" || state.conn === "closed") {
    return `<div class="banner warn reconnect" role="status">連線斷咗，正在重新連接。請稍等，唔好離開呢頁。</div>`;
  }
  if (state.conn === "connecting") {
    return `<div class="banner info reconnect" role="status">連線緊，請稍等…</div>`;
  }
  return "";
}

function toastHTML() {
  return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : "";
}


function openInspect(cardId, why) {
  const v = state.view;
  if (!v) return;
  let card = (v.myHand || []).find((c) => c.id === cardId);
  let tigressAsPirate = null;
  if (!card) {
    const played = (v.trick || []).find((p) => p.card?.id === cardId)
      || (v.previousTrick?.cards || []).find((p) => p.card?.id === cardId);
    if (played) {
      card = played.card;
      tigressAsPirate = played.tigressAsPirate;
    }
  }
  if (!card) return;
  state.scorePeek = false;
  state.prevTrickPeek = false;
  const legal = new Set(v.legalCardIds || []);
  state.inspect = {
    type: "card",
    card,
    tigressAsPirate,
    why: why || cardPlayWhy(card, v) || "",
    canPlay: v.isMyTurn && v.phase === "playing" && legal.has(card.id),
  };
  render();
}

function cardPlayWhy(card, v) {
  if (!v || !card) return "";
  if (v.phase === "bidding") return "要先叫牌，叫完先輪到出牌。";
  if (v.phase === "trickResult") return "等呢墩結果完咗，先出下一張。";
  if (v.phase === "choosingTigress") return "請先揀母老虎當海盜定逃脫。";
  if (v.phase !== "playing") return "";
  const legal = new Set(v.legalCardIds || []);
  if (legal.has(card.id)) return "";
  if (!v.isMyTurn) {
    const cur = (v.players || [])[v.currentPlayerIndex];
    return `仲未到你出牌，而家輪到${cur?.name || "其他玩家"}。`;
  }
  if (v.ledSuit && SUIT_INFO[v.ledSuit]) {
    return `而家要跟${suitLabel(v.ledSuit)}。你手上有呢種花，所以唔可以出其他顏色嘅數字牌；特殊牌就隨時可出。`;
  }
  return "呢張牌而家唔可以出。";
}

function bidHint(cardsDealt, value) {
  if (value == null) return "睇完手牌先叫。叫 0 即係估一墩都唔贏。";
  if (value === 0) return `叫 0：估一墩都唔贏。估中加 ${10 * cardsDealt} 分，一旦贏咗墩就要扣 ${10 * cardsDealt} 分。`;
  return `叫 ${value} 墩：估中加 ${20 * value} 分；估錯就差幾墩，每差 1 墩扣 10 分。`;
}

function inspectHTML() {
  const ins = state.inspect;
  if (!ins) return "";
  if (ins.type === "legend") {
    const items = Object.entries(CARD_HELP)
      .map(([key, text]) => {
        const name = SPECIAL_INFO[key]?.chineseName || key;
        return `<div class="legend-item"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(text)}</p></div>`;
      })
      .join("");
    return `<div class="overlay center" data-act="close-inspect">
      <div class="sheet inspect-sheet" data-stop="1">
        <h2>特殊牌係咩？</h2>
        <p>特殊牌隨時可以出，唔使跟花。撳手牌右上角嘅「？」可以隨時再睇。</p>
        <div class="legend-list">${items}</div>
        <button class="btn btn-sheet" data-act="close-inspect">知道喇</button>
      </div>
    </div>`;
  }
  const card = ins.card;
  const help = cardHelpText(card, { tigressAsPirate: ins.tigressAsPirate });
  const title = card.special
    ? (SPECIAL_INFO[card.special]?.chineseName || "")
    : `${SUIT_INFO[card.suit]?.chineseName || ""} ${card.rank}`;
  return `<div class="overlay center" data-act="close-inspect">
    <div class="sheet inspect-sheet" data-stop="1">
      <div class="inspect-card">${cardFaceHTML(card, { tigressAsPirate: ins.tigressAsPirate })}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(help)}</p>
      ${ins.why ? `<p class="why-line">${escapeHtml(ins.why)}</p>` : ""}
      ${ins.canPlay ? `<button class="btn btn-gold" data-act="select-card" data-id="${escapeHtml(card.id)}">出呢張</button><div style="height:10px"></div>` : ""}
      <button class="btn btn-sheet" data-act="close-inspect">知道喇</button>
    </div>
  </div>`;
}

function renderHome() {
  const prefill = state.joinCode || pathCode();
  const lan = state.lanUrls.length
    ? `<div class="lan-box">同一 Wi-Fi 嘅電話請打開：${state.lanUrls.map((u) => `<code>${escapeHtml(u)}</code>`).join("")}</div>`
    : "";
  return `
    ${bannerHTML()}
    <div class="screen home">
      <div class="home-tools">${muteToggleHTML()}</div>
      <div class="brand">
        <div class="brand-cover">
          <img src="/cover.jpg" width="858" height="1200" alt="One Piece Skull King 封面" />
        </div>
        <h1>骷髏王</h1>
        <div class="en">Skull King</div>
      </div>
      ${state.token && savedRoomCode() && !pathCode() ? `
        <div class="resume-bar">
          <p>你仲有一場未完嘅牌局（房號 ${escapeHtml(savedRoomCode())}）。</p>
          <button class="btn btn-gold" data-act="resume">返回牌局</button>
          <button class="btn btn-ghost" data-act="discard-session">開始新遊戲</button>
        </div>` : ""}
      <div class="home-card">
        <label class="field-label" for="name-input">你嘅名</label>
        <input id="name-input" maxlength="12" placeholder="你（唔填就叫「你」）" value="${escapeHtml(state.name)}" autocomplete="nickname" />
        <div style="height:14px"></div>
        <button class="btn btn-gold" data-act="create">開房</button>
        <div class="or-row">或者加入</div>
        ${codeBoxesHTML(prefill)}
        <p class="home-hint">開房之後把房號或連結傳俾朋友，佢哋輸入同一個號就可以一齊玩。第一次玩可以先睇遊戲規則。</p>
        <div class="error-line">${escapeHtml(state.error)}</div>
      </div>
      <div>
        <button class="btn-text" data-act="rules">遊戲規則</button>
        <div class="footer-note">基本規則 · 八爪魚同白鯨 · 10 局 · 暫時唔包括贓物牌</div>
        ${location.hostname === "localhost" || location.hostname === "127.0.0.1" ? lan : ""}
        ${a2hsHTML()}
      </div>
    </div>
    ${toastHTML()}
  `;
}

function renderLobby() {
  const v = state.view;
  if (!v) return renderHome();
  const humans = v.lobbyPlayers || [];
  const ai = v.previewAI || [];
  const host = v.youAreHost;
  const me = humans.find((p) => p.id === v.yourId);
  const othersReady = humans.filter((h) => !h.isHost).every((h) => h.ready);
  const canStart = host && othersReady && (v.aiFill ? v.seats >= 2 : humans.length >= 2);

  const rows = [
    ...humans.map((h) => {
      const tags = [];
      if (h.isHost) tags.push(`<span class="pill">房主</span>`);
      if (h.ready) tags.push(`<span class="pill">已準備</span>`);
      if (!h.connected) tags.push(`<span class="pill down">已斷線</span>`);
      return `<div class="player-row">
        <div class="avatar ${h.isHost ? "gold" : ""}">${escapeHtml(h.name.slice(0, 1))}</div>
        <div class="meta">
          <div class="name">${escapeHtml(h.name)}${h.id === v.yourId ? "（你）" : ""}</div>
        </div>
        ${tags.join("")}
      </div>`;
    }),
    ...ai.map((a) => `<div class="player-row">
      <div class="avatar ai">${escapeHtml(a.name.slice(0, 1))}</div>
      <div class="meta">
        <div class="name">${escapeHtml(a.name)}</div>
        <div class="sub">電腦對手 · 開始後入座</div>
      </div>
      <span class="pill muted">電腦</span>
    </div>`),
  ];

  return `
    ${bannerHTML()}
    <div class="screen lobby-screen">
      <div class="lobby-scroll">
      <div class="topbar">
        <button class="btn-text" data-act="leave">離開</button>
        <h2>大廳</h2>
        <div class="topbar-right">${muteToggleHTML()}<button class="btn-text" data-act="rules">規則</button></div>
      </div>
      <div class="code-hero">
        <div class="label">房號 · 撳下去出示俾朋友</div>
        <button type="button" class="code" data-act="show-code" aria-label="出示房號">${escapeHtml(v.code)}</button>
        <div class="code-actions">
          <button class="btn btn-gold" data-act="show-code">出示房號</button>
          <button class="btn btn-ghost" data-act="share-room">分享俾朋友</button>
        </div>
        <div class="code-actions secondary">
          <button class="btn btn-ghost" data-act="copy-code">複製房號</button>
          <button class="btn btn-ghost" data-act="copy-link">複製連結</button>
        </div>
        <div class="share-url">${escapeHtml(shareUrl(v.code))}</div>
      </div>
      ${host ? `
        <div class="panel">
          <h3>桌子設定</h3>
          <div class="seat-row">
            <span>玩家人數（2–6）</span>
            <div class="stepper">
              <button data-act="seats-dec" aria-label="減少">−</button>
              <span class="n">${v.seats}</span>
              <button data-act="seats-inc" aria-label="增加">+</button>
            </div>
          </div>
          <div style="height:12px"></div>
          <div class="toggle-row">
            <span>用電腦補滿空位</span>
            <button class="switch ${v.aiFill ? "on" : ""}" data-act="ai-fill" data-on="${v.aiFill ? "1" : "0"}" role="switch" aria-checked="${v.aiFill}">
              <i></i>
            </button>
          </div>
        </div>
      ` : `
        <div class="panel">
          <h3>桌子設定</h3>
          <div class="seat-row"><span>玩家人數</span><strong>${v.seats} 人</strong></div>
          <div style="height:8px"></div>
          <div class="toggle-row"><span>電腦補位</span><strong>${v.aiFill ? "開" : "關"}</strong></div>
        </div>
      `}
      <div class="panel">
        <h3>玩家</h3>
        <div class="player-list">${rows.join("") || "<div class='sub'>等緊人加入…</div>"}</div>
      </div>
      <div class="status">${escapeHtml(v.statusMessage || "")}</div>
      <div class="error-line">${escapeHtml(state.error)}</div>
      </div>
      <div class="lobby-actions">
        ${!host ? `<p class="start-hint">${me?.ready ? "你已準備好，等房主開始遊戲。" : "撳下面「準備好」，房主先開得局。"}</p>
        <button class="btn ${me?.ready ? "btn-ghost" : "btn-gold"}" data-act="ready" data-on="${me?.ready ? "1" : "0"}">${me?.ready ? "取消準備" : "準備好"}</button>` : ""}
        ${host ? `${!canStart ? `<p class="start-hint">${(() => {
          const waiting = humans.filter((h) => !h.isHost && !h.ready).map((h) => h.name);
          if (waiting.length) return `等 ${waiting.join("、")} 撳「準備好」先可以開始。`;
          if (!v.aiFill && humans.length < 2) return "至少再等多一個人加入，或者開電腦補位。";
          return "設定好人數就可以開始。";
        })()}</p>` : `<p class="start-hint">人齊喇，可以開始。把房號傳俾未入嚟嘅朋友。</p>`}
        <button class="btn btn-gold" data-act="start" ${canStart ? "" : "disabled"}>開始遊戲</button>` : ""}
      </div>
    </div>
    ${showCodeHTML(v.code)}
    ${toastHTML()}
  `;
}

function signed(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}


function playerSeatStatus(p, v) {
  if (!p.isAI && v.lobbyPlayers) {
    const h = v.lobbyPlayers.find((x) => x.id === p.id);
    if (h && !h.connected) return "已斷線";
  }
  const bidding = v.phase === "bidding";
  if (bidding) return p.hasBid ? "已叫牌" : "考慮緊…";
  if (v.bidsRevealed) return "";
  return `${p.handCount} 張`;
}

function seatBidLine(p, v) {
  if (!v.bidsRevealed || p.bid == null) {
    return { html: "", busted: false, explode: false };
  }
  const busted = p.tricksWon > p.bid;
  const explode = busted && markBustExplode(p, v);
  const reveal = bidRevealAttr(v, p._visualIndex || 0);
  const html = `<div class="seat-bidline${busted ? " busted" : ""}${reveal.cls}" style="${reveal.style}" aria-label="叫 ${p.bid} 贏 ${p.tricksWon}${busted ? "，爆咗" : ""}">
    <span class="bid-call">叫 ${p.bid}</span>
    <span class="bid-sep">／</span>
    <span class="bid-won">贏 ${p.tricksWon}</span>
    ${busted ? `<span class="bust-tag">爆咗</span>` : ""}
  </div>`;
  return { html, busted, explode };
}

function isPlayerThinking(p, v) {
  if (v.phase === "bidding") return !p.hasBid;
  return !!p.isTurn;
}

function tableArrowsSVG() {
  const cx = 50;
  const cy = 50;
  const rx = 34;
  const ry = 31;
  const n = 8;
  const heads = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const a = (90 + t * 360) * Math.PI / 180;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    const rot = Math.atan2(ry * Math.cos(a), -rx * Math.sin(a)) * 180 / Math.PI;
    heads.push(
      `<polygon points="0,0 -3.4,-2 -3.4,2" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(2)})" />`,
    );
  }
  return `<svg class="table-arrows" viewBox="0 0 100 100" aria-hidden="true">
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(237,191,89,0.55)" stroke-width="0.85" />
    <g fill="#edbf59">${heads.join("")}</g>
  </svg>`;
}

function resetTrickAnim() {
  state.trickAnimReady = false;
  state.seenTrickCardIds = new Set();
  state.animatingPlayIds = new Set();
  state.seenBustKeys = new Set();
  state.explodingBustKeys = new Set();
  resetFlyAnim();
}

function resetFlyAnim() {
  clearTimeout(state.flyTimer);
  state.flyTimer = 0;
  state.flyKey = "";
  state.flyStartedAt = 0;
  state.flyDone = false;
}

function trickFlyKey(v) {
  if (!v || v.phase !== "trickResult" || v.lastTrickDestroyed) return "";
  const ids = (v.trick || []).map((p) => p.card?.id).join(",");
  if (!ids) return "";
  return `${v.round}:${ids}:${v.lastWinnerIndex}`;
}

function applyFlyAnim(v) {
  if (!v || v.phase !== "trickResult" || v.lastTrickDestroyed) {
    if (state.flyKey) resetFlyAnim();
    return;
  }
  const key = trickFlyKey(v);
  if (!key) return;
  const table = app.querySelector(".circle-table");
  if (!table) return;
  const winnerSeat = table.querySelector(".seat.winner");
  const winnerCard = winnerSeat?.querySelector(".seat-card");
  if (!winnerCard) return;
  const cards = [...table.querySelectorAll(".seat-card")].filter((el) => !el.classList.contains("empty"));
  const wr = winnerCard.getBoundingClientRect();
  const now = performance.now();
  if (state.flyKey !== key) {
    clearTimeout(state.flyTimer);
    state.flyTimer = 0;
    state.flyKey = key;
    state.flyStartedAt = now;
    state.flyDone = false;
  }
  const beat = 400;
  const dur = 480;
  const elapsed = now - state.flyStartedAt;
  cards.forEach((card) => {
    if (card === winnerCard) return;
    const cr = card.getBoundingClientRect();
    card.style.setProperty("--fly-dx", `${(wr.left - cr.left).toFixed(1)}px`);
    card.style.setProperty("--fly-dy", `${(wr.top - cr.top).toFixed(1)}px`);
    card.classList.remove("fly-win", "flown-win");
    if (elapsed >= beat + dur || state.flyDone) {
      card.classList.add("flown-win");
    } else {
      card.style.setProperty("--fly-delay", `${((beat - elapsed) / 1000).toFixed(3)}s`);
      card.classList.add("fly-win");
    }
  });
  if (elapsed >= beat + dur) {
    state.flyDone = true;
    return;
  }
  if (!state.flyTimer) {
    state.flyTimer = setTimeout(() => {
      state.flyTimer = 0;
      state.flyDone = true;
      app.querySelectorAll(".seat-card.fly-win").forEach((c) => {
        c.classList.remove("fly-win");
        c.classList.add("flown-win");
      });
    }, Math.max(16, beat + dur - elapsed));
  }
}

function markBustExplode(p, v) {
  const key = `${v.round}:${p.id}`;
  if (state.explodingBustKeys.has(key)) return true;
  if (state.seenBustKeys.has(key)) return false;
  state.seenBustKeys.add(key);
  state.explodingBustKeys.add(key);
  haptic(28);
  setTimeout(() => state.explodingBustKeys.delete(key), 800);
  return true;
}

function syncTrickAnim(v) {
  const ids = (v.trick || []).map((played) => played.card.id);
  if (!ids.length) {
    state.seenTrickCardIds = new Set();
    return;
  }
  if (!state.trickAnimReady) {
    state.seenTrickCardIds = new Set(ids);
    state.trickAnimReady = true;
  }
}

function isJustPlayed(cardId) {
  if (!cardId) return false;
  if (state.animatingPlayIds.has(cardId)) return true;
  if (state.seenTrickCardIds.has(cardId)) return false;
  state.seenTrickCardIds.add(cardId);
  state.animatingPlayIds.add(cardId);
  playCardFlip();
  setTimeout(() => state.animatingPlayIds.delete(cardId), 500);
  return true;
}

function circleTableHTML(v) {
  const players = v.players || [];
  const n = Math.max(players.length, 1);
  const found = players.findIndex((p) => p.id === v.yourId);
  const myIndex = found >= 0 ? found : 0;
  const bidding = v.phase === "bidding";
  const destroyed = v.phase === "trickResult" && v.lastTrickDestroyed;
  const trickByPlayer = new Map((v.trick || []).map((played) => [played.playerIndex, played]));
  const rx = n === 2 ? 0 : n >= 6 ? 36 : 37;
  const ry = n === 2 ? 30 : n >= 5 ? 30 : 31;

  const showSlots = v.phase === "playing" || v.phase === "choosingTigress" || v.phase === "trickResult";
  syncTrickAnim(v);
  const seats = players.map((_, i) => {
    const playerIndex = (myIndex + i) % n;
    const p = players[playerIndex];
    const angleDeg = 90 + i * (360 / n);
    const rad = (angleDeg * Math.PI) / 180;
    const x = 50 + Math.cos(rad) * rx;
    const y = 50 + Math.sin(rad) * ry;
    const rot = i * (360 / n);
    const played = trickByPlayer.get(playerIndex);
    const thinking = isPlayerThinking(p, v);
    const isMe = p.id === v.yourId;
    const win = v.phase === "trickResult" && !destroyed && playerIndex === v.lastWinnerIndex;
    const st = playerSeatStatus(p, v);
    p._visualIndex = i;
    const bidLine = seatBidLine(p, v);
    const connected = playerConnected(p, v);
    const leadIndex = (v.trick || []).length
      ? v.trick[0].playerIndex
      : (v.phase === "playing" && !(v.trick || []).length ? v.currentPlayerIndex : -1);
    const isLead = leadIndex === playerIndex;
    const leadTag = !isLead || bidding ? "" : ((v.trick || []).length ? "領牌" : "先出");
    let card = "";
    if (played) {
      const justPlayed = isJustPlayed(played.card.id);
      if (justPlayed) maybeSpecialFlourish(played);
      const slam = justPlayed ? " slam" : "";
      card = `<button class="seat-card ${win ? "winner" : ""} ${destroyed ? "voided" : ""}${slam}" data-act="inspect" data-id="${escapeHtml(played.card.id)}" aria-label="睇呢張牌">
           ${cardFaceHTML(played.card, { tigressAsPirate: played.tigressAsPirate, compact: true })}
           ${win ? `<div class="seat-win">贏</div>` : ""}
         </button>`;
    } else if (showSlots) {
      card = `<div class="seat-card empty"><div class="card-slot" aria-hidden="true"></div></div>`;
    }
    const celebrate = win ? " winner-celebrate" : "";
    const bustCls = bidLine.busted ? " busted" : "";
    const boomCls = bidLine.explode ? " bust-explode" : "";
    const z = bidLine.explode ? 8 : win ? 7 : thinking ? 6 : 2;
    return `<div class="seat ${thinking ? "thinking" : ""} ${isMe ? "is-me" : ""} ${win ? "winner" : ""}${celebrate}${bustCls}${boomCls} ${p.isAI ? "ai-seat" : ""}"
      style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--rot:${rot}deg;z-index:${z}">
      ${card}
      ${bidLine.explode ? `<div class="bust-burst" aria-hidden="true"></div>` : ""}
      ${scoreFloaterHTML(v, p.id, i)}
      <div class="seat-info">
        <div class="avatar-wrap">
          <div class="avatar ${thinking ? "gold" : p.isAI ? "ai" : ""} ${win ? "win-ring" : ""}${bidLine.busted ? " bust-avatar" : ""}">${escapeHtml(p.name.slice(0, 1))}</div>
          <span class="conn-dot ${connected ? "on" : "off"}" title="${connected ? (p.isAI ? "電腦" : "已連線") : "已斷線"}" aria-label="${connected ? (p.isAI ? "電腦" : "已連線") : "已斷線"}"></span>
        </div>
        <div class="seat-meta">
          <div class="nm-row">
            <span class="nm">${escapeHtml(p.name)}${isMe ? "（你）" : ""}</span>
            ${leadTag ? `<span class="seat-lead">${leadTag}</span>` : ""}
            ${thinking ? `<span class="seat-thinking">諗緊</span>` : ""}
          </div>
          ${bidLine.html}
          <div class="seat-sub">${st ? `<span class="st">${escapeHtml(st)}</span>` : ""}${!bidding && v.phase !== "roundResult" && v.phase !== "gameOver" && v.phase !== "lobby" ? handStackHTML(p.handCount) : ""}<span class="sc">${p.score} 分</span></div>
        </div>
      </div>
    </div>`;
  }).join("");

  let center = "";
  const midTrick = (v.phase === "playing" || v.phase === "choosingTigress") && (v.trick || []).length;
  const lead = midTrick ? v.currentTrickLead : null;
  if (destroyed) center = `<div class="table-center void">呢墩作廢，無人贏</div>`;
  else if (!(v.trick || []).length && bidding) center = `<div class="table-center dim">叫牌中<br /><span class="arrow-hint">順時針出牌</span></div>`;
  else if (!(v.trick || []).length) center = `<div class="table-center dim">呢墩尚未出牌<br /><span class="arrow-hint">順時針出牌</span></div>`;
  else if (lead?.destroyed) center = `<div class="table-center lead void-soon">呢墩快將作廢</div>`;
  else if (lead && lead.leading === false) center = `<div class="table-center lead dim">尚未有人領先</div>`;
  else if (lead && (lead.playerName || lead.cardLabel)) {
    const who = escapeHtml(lead.playerName || "");
    const card = escapeHtml(lead.cardLabel || "");
    const label = who && card ? `${who} · ${card}` : (who || card);
    center = `<div class="table-center lead">而家最大：${label}</div>`;
  } else center = `<div class="table-center dim"><span class="arrow-hint">順時針</span></div>`;

  const suitClass = v.ledSuit && (v.phase === "playing" || v.phase === "choosingTigress" || v.phase === "trickResult")
    ? ` suit-${v.ledSuit}`
    : "";
  return `<div class="circle-wrap">
    <div class="circle-table n-${n} ${destroyed ? "destroyed" : ""}" role="group" aria-label="牌桌，出牌順序順時針">
      <div class="table-felt${suitClass}">${tableArrowsSVG()}${center}${flourishBannerHTML()}</div>
      ${seats}
    </div>
  </div>`;
}


function tablePromptHTML(v, { bidding, alreadyBid } = {}) {
  if (bidding) return "";
  if (v.phase === "trickResult") {
    const details = (!v.lastTrickDestroyed && (v.lastTrickDetails || []).length)
      ? `<div class="bonus-banner" role="status">${(v.lastTrickDetails || []).map((d) => `<span class="bonus-chip">${escapeHtml(d)}</span>`).join("")}</div>`
      : "";
    return `<div class="turn-banner result">${escapeHtml(v.statusMessage || "")}</div>${details}`;
  }
  if (v.phase === "playing" && v.isMyTurn) {
    let text = "輪到你出牌。";
    if (v.ledSuit) text += `而家要跟${suitLabel(v.ledSuit)}。你有呢種花就要跟；特殊牌隨時可出。`;
    else if (!(v.trick || []).length) text += "由你先出呢一墩。第一張有花色嘅牌會定花；特殊牌先出就冇得跟花。";
    else text += "呢墩由特殊牌先出，冇得跟花，可以出任何牌。";
    return `<div class="turn-banner mine">${suitPip(v.ledSuit)}<span>${escapeHtml(text)}</span></div>`;
  }
  if (v.phase === "playing" || v.phase === "choosingTigress") {
    const cur = (v.players || [])[v.currentPlayerIndex];
    const name = cur?.name || "對手";
    let text;
    if (v.phase === "choosingTigress") text = `等${name}揀母老虎當海盜定逃脫。`;
    else if (v.ledSuit) text = `輪到${name}出牌。而家要跟${suitLabel(v.ledSuit)}。`;
    else if (!(v.trick || []).length) text = `輪到${name}出牌。等佢出第一張先定花。`;
    else text = `輪到${name}出牌。呢墩冇得跟花。`;
    return `<div class="turn-banner wait">${suitPip(v.ledSuit)}<span>${escapeHtml(text)}</span></div>`;
  }
  return "";
}

function myBidTrackHTML(v) {
  const me = (v.players || []).find((p) => p.id === v.yourId);
  if (!me || !v.bidsRevealed || me.bid == null) return "";
  if (v.phase === "bidding" || v.phase === "roundResult" || v.phase === "gameOver") return "";
  const busted = me.tricksWon > me.bid;
  let text;
  if (busted) text = `你已爆咗：叫 ${me.bid} 贏 ${me.tricksWon}`;
  else if (me.tricksWon === me.bid) text = `你：叫 ${me.bid} 贏 ${me.tricksWon}，已經夠墩`;
  else text = `你：叫 ${me.bid} 贏 ${me.tricksWon}，仲差 ${me.bid - me.tricksWon} 墩`;
  return `<div class="my-bid-track${busted ? " busted" : ""}">${escapeHtml(text)}</div>`;
}

function scorePeekHTML(v) {
  if (!state.scorePeek || !v) return "";
  const rows = (v.players || []).map((p) => {
    const mine = p.id === v.yourId;
    let bid = "—";
    if (v.bidsRevealed && p.bid != null) bid = `叫 ${p.bid}／贏 ${p.tricksWon}`;
    else if (mine && p.hasBid && p.bid != null) bid = `你叫咗 ${p.bid}`;
    else if (v.phase === "bidding") bid = p.hasBid ? "已叫" : "未叫";
    return `<tr class="${mine ? "me" : ""}"><td>${escapeHtml(p.name)}${mine ? "（你）" : ""}</td><td>${escapeHtml(bid)}</td><td><strong>${p.score}</strong></td></tr>`;
  }).join("");
  return `<div class="overlay center" data-act="close-score-peek">
    <div class="sheet" data-stop="1">
      <h2>而家分數</h2>
      <p>呢個係到而家嘅總分；一局打完先會再計呢局得失。</p>
      <div class="score-wrap">
        <table class="score-table">
          <thead><tr><th>玩家</th><th>叫／贏</th><th>總分</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="btn btn-sheet" data-act="close-score-peek">返去牌桌</button>
    </div>
  </div>`;
}

function prevTrickButtonHTML(v) {
  if (!v?.previousTrick || v.phase === "trickResult") return "";
  if (v.phase === "roundResult" || v.phase === "gameOver") return "";
  return `<div class="prev-trick-bar"><button type="button" class="btn btn-ghost prev-trick-btn" data-act="prev-trick">上一墩</button></div>`;
}

function prevTrickSheetHTML(v) {
  if (!state.prevTrickPeek || !v?.previousTrick) return "";
  const t = v.previousTrick;
  const winner = t.winnerIndex != null ? (v.players || [])[t.winnerIndex] : null;
  const winnerName = winner?.name || t.cards.find((c) => c.playerIndex === t.winnerIndex)?.playerName || "";
  let result;
  if (t.destroyed) result = "呢墩作廢，無人贏（八爪魚或白鯨）。";
  else result = `${winnerName || "有人"}贏咗呢墩。`;
  const plays = (t.cards || []).map((played) => {
    const mine = (v.players || [])[played.playerIndex]?.id === v.yourId;
    const name = escapeHtml(played.playerName || (v.players || [])[played.playerIndex]?.name || "");
    const won = !t.destroyed && played.playerIndex === t.winnerIndex;
    return `<div class="prev-play${won ? " won" : ""}">
      <div class="prev-who">${name}${mine ? "（你）" : ""}${won ? " · 贏" : ""}</div>
      <div class="prev-card" data-act="inspect" data-id="${escapeHtml(played.card.id)}">${cardFaceHTML(played.card, { tigressAsPirate: played.tigressAsPirate, compact: true })}</div>
    </div>`;
  }).join("");
  const details = (!t.destroyed && (t.details || []).length)
    ? `<div class="bonus-banner">${t.details.map((d) => `<span class="bonus-chip">${escapeHtml(d)}</span>`).join("")}</div>`
    : "";
  return `<div class="overlay center" data-act="close-prev-trick">
    <div class="sheet inspect-sheet" data-stop="1">
      <h2>上一墩</h2>
      <p>${escapeHtml(result)}</p>
      ${details}
      <div class="prev-plays">${plays}</div>
      <button class="btn btn-sheet" data-act="close-prev-trick">知道喇</button>
    </div>
  </div>`;
}

function podiumHTML(v) {
  const players = [...(v.players || [])].sort((a, b) => b.score - a.score || 0);
  if (!players.length) return "";
  let lastScore = null;
  let lastPlace = 0;
  let seen = 0;
  const rows = players.map((p) => {
    seen += 1;
    if (lastScore === null || p.score !== lastScore) {
      lastPlace = seen;
      lastScore = p.score;
    }
    const mine = p.id === v.yourId;
    const label = lastPlace === 1 ? "冠軍" : lastPlace === 2 ? "亞軍" : lastPlace === 3 ? "季軍" : `第 ${lastPlace} 名`;
    return `<div class="podium-row place-${lastPlace}${mine ? " you" : ""}">
      <span class="podium-place">${label}</span>
      <span class="podium-name">${escapeHtml(p.name)}${mine ? "（你）" : ""}</span>
      <span class="podium-score">${p.score} 分</span>
    </div>`;
  }).join("");
  return `<div class="podium" role="list">${rows}</div>`;
}

function confirmBarHTML(v) {
  if (!v.isMyTurn || v.phase !== "playing" || !state.selectedCardId) return "";
  const card = (v.myHand || []).find((c) => c.id === state.selectedCardId);
  if (!card) return "";
  const name = card.special
    ? (SPECIAL_INFO[card.special]?.chineseName || "")
    : `${SUIT_INFO[card.suit]?.shortName || ""}${card.rank}`;
  if (card.special === "tigress") {
    return `<div class="confirm-bar">
      <p>已揀<strong>母老虎</strong>。請宣布點出，確定之後先會出牌。</p>
      <div class="confirm-actions">
        <button class="btn btn-sheet" data-act="cancel-play">取消</button>
        <button class="btn btn-gold" data-act="confirm-tig-pirate">確定當海盜出</button>
        <button class="btn btn-ink" data-act="confirm-tig-escape">確定當逃脫出</button>
      </div>
    </div>`;
  }
  return `<div class="confirm-bar">
    <p>已揀<strong>${escapeHtml(name)}</strong>。確定之後先會出牌。</p>
    <div class="confirm-actions">
      <button class="btn btn-sheet" data-act="cancel-play">取消</button>
      <button class="btn btn-gold" data-act="confirm-play">確定出牌</button>
    </div>
  </div>`;
}

function renderTable() {

  const v = state.view;
  if (!v) return renderHome();
  const me = v.players?.find((p) => p.id === v.yourId);
  const bidding = v.phase === "bidding";
  const myBid = me?.bid;
  const alreadyBid = bidding && me?.hasBid;

  let bidPanel = "";
  if (bidding) {
    const n = v.cardsDealt;
    const btns = Array.from({ length: n + 1 }, (_, i) => {
      const on = state.bidValue === i ? "on" : "";
      const zero = i === 0 ? " bid-zero" : "";
      const label = i === 0 ? `<span class="bid-n">0</span><span class="bid-cue">估唔贏</span>` : String(i);
      return `<button type="button" class="${on}${zero}" data-act="bid-pick" data-n="${i}">${label}</button>`;
    }).join("");
    const bidCount = (v.players || []).filter((p) => p.hasBid).length;
    const bidTotal = (v.players || []).length;
    bidPanel = `<div class="bid-panel">
      <h3>${alreadyBid ? "已叫牌，等其他人" : "你估會贏幾墩？"}</h3>
      <p class="bid-progress">已叫 ${bidCount}／${bidTotal} 人</p>
      ${(() => {
        const waitingBid = (v.players || []).filter((p) => !p.hasBid);
        if (!waitingBid.length) return '<p class="bid-wait done">所有人都叫咗。</p>';
        return '<div class="bid-wait" aria-live="polite"><span>仲等</span> ' + waitingBid.map((p) => '<span class="bid-wait-name">' + escapeHtml(p.name) + (p.id === v.yourId ? '（你）' : '') + '</span>').join('') + '</div>';
      })()}
      <p>${alreadyBid ? `你叫咗 ${myBid} 墩。等其他人一齊叫完先揭曉。` : `睇完手牌先叫，可以叫 0 到 ${n}。其他人叫咩要等齊先睇到。`}</p>
      ${alreadyBid ? "" : `<p class="bid-hint">${escapeHtml(bidHint(n, state.bidValue))}</p>
        <div class="bid-grid">${btns}</div>
        <button class="btn btn-gold" data-act="bid-submit" ${state.bidValue == null ? "disabled" : ""}>${state.bidValue == null ? "請先揀叫幾多墩" : `確定叫 ${state.bidValue} 墩`}</button>`}
    </div>`;
  }

  const legal = new Set(v.legalCardIds || []);
  const canPlay = v.isMyTurn && v.phase === "playing";
  const handCards = sortHand(v.myHand || []);
  const overlap = handOverlap(handCards.length);
  const dealKey = `${v.round}:${handCards.map((c) => c.id).join(",")}`;
  let dealing = false;
  let dealBaseMs = 0;
  if (handCards.length) {
    if (dealKey !== state.lastDealtKey) {
      state.lastDealtKey = dealKey;
      if (v.phase === "bidding") {
        state.dealingKey = dealKey;
        state.dealStartedAt = performance.now();
        playCardFlip();
        dealing = true;
      } else {
        state.dealingKey = "";
      }
    } else if (state.dealingKey === dealKey) {
      const elapsed = performance.now() - state.dealStartedAt;
      const total = 32 * Math.max(0, handCards.length - 1) + 200;
      if (elapsed < total) {
        dealing = true;
        dealBaseMs = -elapsed;
      } else {
        state.dealingKey = "";
      }
    }
  }
  const hand = `<div class="hand-scroll"><div class="hand${dealing ? " dealing" : ""}">${handCards
    .map((c, i) => {
      const isLegal = canPlay && legal.has(c.id);
      const dim = canPlay && !legal.has(c.id);
      const selected = isLegal && state.selectedCardId === c.id;
      const why = !isLegal ? cardPlayWhy(c, v) : "";
      const dealCls = dealing ? " deal-in" : "";
      const style = `style="margin-right:${i === handCards.length - 1 ? 0 : overlap}px;z-index:${selected ? 20 : i};--deal-i:${i};--deal-base:${dealBaseMs}ms"`;
      const inner = cardFaceHTML(c, { dimmed: dim });
      const info = c.special
        ? `<button class="card-info" data-act="inspect" data-id="${escapeHtml(c.id)}" aria-label="睇牌義">?</button>`
        : "";
      let tag = "";
      if (isLegal && v.ledSuit) {
        tag = c.special
          ? `<span class="card-tag special">特殊</span>`
          : (c.suit === v.ledSuit ? `<span class="card-tag follow">跟</span>` : "");
      }
      if (handCards.length === 1 && (v.phase === "playing" || v.phase === "choosingTigress" || v.phase === "trickResult")) {
        tag += `<span class="card-tag last">最後</span>`;
      }
      if (isLegal) {
        return `<div class="sk-wrap${selected ? " selected" : ""} playable${dealCls}" ${style}>
          <button class="sk-play" data-act="select-card" data-id="${escapeHtml(c.id)}">${inner.replace("sk-card ", `sk-card legal ${selected ? "picked " : ""}`)}</button>
          ${info}${tag}
        </div>`;
      }
      return `<div class="sk-wrap inspect-only${dim ? " unplayable" : ""}${dealCls}" ${style}>
        <button class="sk-play" data-act="inspect" data-id="${escapeHtml(c.id)}" data-why="${escapeHtml(why)}">${inner}</button>
        ${info}
      </div>`;
    })
    .join("")}</div></div>`;

  const skipTrick = v.phase === "trickResult"
    ? `<div class="next-trick"><button class="btn btn-ghost" data-act="continue">下一墩</button></div>`
    : "";

  const tablePrompt = tablePromptHTML(v, { bidding, alreadyBid });
  const confirmBar = confirmBarHTML(v);

  return `
    ${bannerHTML()}
    <div class="screen table-screen">
      <div class="table-header">
        <div class="header-left">
          <button class="btn-text" data-act="leave">離開</button>
          ${muteToggleHTML()}
        </div>
        <div class="center">
          <div class="round">第 ${v.round} 局／10</div>
          ${roundRailHTML(v)}
          <div class="sub">${(() => {
            const total = v.tricksTotal || v.cardsDealt;
            if (v.phase === 'bidding') return '各 ' + v.cardsDealt + ' 張 · 叫牌中';
            if (v.phase === 'roundResult' || v.phase === 'gameOver') return '各 ' + v.cardsDealt + ' 張 · 局滿';
            return '第 ' + (v.trickNumber || 1) + '／' + total + ' 墩';
          })()}</div>
        </div>
        <div class="header-actions">
          <button class="btn-text" data-act="score-peek">分數</button>
          <button class="btn-text" data-act="card-legend">牌義</button>
          <button class="btn-text" data-act="rules">規則</button>
        </div>
      </div>
      ${circleTableHTML(v)}
      <div class="table-dock">
        ${prevTrickButtonHTML(v)}
        ${tablePrompt}
        ${skipTrick}
        <div class="error-line">${escapeHtml(state.error)}</div>
        ${bidPanel}
        ${confirmBar}
        ${myBidTrackHTML(v)}
        ${hand}
      </div>
    </div>
    ${v.pendingTigress ? tigressHTML() : ""}
    ${v.phase === "roundResult" || v.phase === "gameOver" ? scoreHTML(v) : ""}
    ${scorePeekHTML(v)}
    ${prevTrickSheetHTML(v)}
    ${inspectHTML()}
    ${leaveConfirmHTML()}${showCodeHTML(v.code)}
    ${toastHTML()}
  `;
}

function handOverlap(count) {
  if (count <= 1) return 0;
  const width = Math.min(520, window.innerWidth) - 32;
  const card = window.innerWidth >= 700 ? 84 : 76;
  const need = card * count;
  if (need <= width) return 8;
  const overlap = -Math.ceil((need - width) / (count - 1));
  return Math.max(overlap, -(card - 38));
}

function tigressHTML() {
  return `<div class="overlay center">
    <div class="sheet">
      <h2>母老虎係咩？</h2>
      <p>母老虎係一張要「變身」嘅特殊牌：出嚟嗰陣你要即場宣布佢當海盜定逃脫。佢本身冇第三種打法，亦唔使跟花。</p>
      <div class="tig-choices">
        <button class="btn btn-gold" data-act="tig-pirate">當海盜出</button>
        <p class="tig-explain">同普通海盜一樣，可以搶墩；如果捕獲人魚（而且呢墩冇骷髏王），估中叫牌仲可以加分。</p>
        <button class="btn btn-ink" data-act="tig-escape">當逃脫出</button>
        <p class="tig-explain">同逃脫一樣，通常唔會贏墩。適合你已經贏夠，唔想再攞墩嘅時候。</p>
      </div>
      <button class="btn btn-sheet" data-act="tig-cancel" style="width:100%">取消，換第二張</button>
    </div>
  </div>`;
}

function scoreHTML(v) {
  const latest = v.scores?.[v.scores.length - 1];
  const over = v.phase === "gameOver";
  if (over) {
    const key = `over:${v.round}:${(v.players || []).map((p) => p.score).join(",")}`;
    if (state.seenGameOverKey !== key) {
      state.seenGameOverKey = key;
      haptic(28);
    }
  }
  const meRow = (latest?.rows || []).find((r) => r.playerId === v.yourId);
  const rows = (latest?.rows || [])
    .map((r) => {
      const made = r.bid === r.taken;
      const mine = r.playerId === v.yourId;
      return `<tr class="${mine ? "me" : ""}">
        <td>${escapeHtml(r.playerName)}${mine ? "（你）" : ""}</td>
        <td>${r.bid}／${r.taken}<span class="made-tag ${made ? "ok" : "bad"}">${made ? "估中" : "估錯"}</span></td>
        <td class="${r.bidPoints < 0 ? "neg" : r.bidPoints > 0 ? "pos" : ""}">${signed(r.bidPoints)}</td>
        <td>${r.bonus === 0 ? "–" : "+" + r.bonus}</td>
        <td class="${r.roundTotal < 0 ? "neg" : r.roundTotal > 0 ? "pos" : ""}">${signed(r.roundTotal)}</td>
        <td><strong>${r.runningTotal}</strong></td>
      </tr>`;
    })
    .join("");
  let mineSummary = "";
  if (meRow) {
    const made = meRow.bid === meRow.taken;
    mineSummary = `<div class="score-hero ${made ? "made" : "missed"}">
      <div class="hero-kicker">${made ? "估中！" : "估錯"}</div>
      <p>你叫 ${meRow.bid} 贏 ${meRow.taken}，叫牌分 ${signed(meRow.bidPoints)}${meRow.bonus ? `，獎勵 +${meRow.bonus}` : ""}，本局 ${signed(meRow.roundTotal)}</p>
      <div class="hero-total">總分 <strong>${meRow.runningTotal}</strong></div>
    </div>`;
  }
  const hostBtns = v.youAreHost
    ? `<div class="actions">
        <button class="btn btn-ink" data-act="back-lobby">返回大廳</button>
        <button class="btn btn-gold" data-act="play-again">再嚟一場</button>
      </div>`
    : `<p>等房主決定再開一場定返回大廳。</p>`;
  const nextLabel = v.round >= 10 ? "睇總分" : "下一局";
  const waiting = v.continueWaitingNames || [];
  const needed = v.continueNeeded || [];
  const ready = v.continueReady || [];
  const meReady = ready.includes(v.yourId);
  let continueBtn;
  if (over) continueBtn = "";
  else if (meReady && waiting.length) {
    continueBtn = `<p class="start-hint">你已睇完（${ready.length}/${needed.length}），仲等 ${waiting.map(escapeHtml).join("、")}。</p>
      <button class="btn btn-ghost" disabled>已睇完</button>`;
  } else if (meReady) {
    continueBtn = `<button class="btn btn-ghost" disabled>已睇完</button>`;
  } else {
    const waitNote = needed.length > 1 ? `<p class="start-hint">大家都睇完先會進入${v.round >= 10 ? "總分" : "下一局"}。</p>` : "";
    continueBtn = `${waitNote}<button class="btn btn-gold" data-act="continue">${nextLabel}</button>`;
  }
  return `<div class="overlay center">
    <div class="sheet">
      <h2>${over ? "最終分數" : `第 ${v.round} 局結果`}</h2>
      ${over ? `<p>${escapeHtml(v.statusMessage || "")}</p>${podiumHTML(v)}` : ""}
      ${mineSummary}
      <div class="score-wrap">
        <table class="score-table">
          <thead><tr><th>玩家</th><th>叫／贏</th><th>叫牌分</th><th>獎勵</th><th>本局</th><th>總分</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${over ? hostBtns : continueBtn}
    </div>
  </div>`;
}

function renderRules() {
  return `
    ${bannerHTML()}
    <div class="screen rules-screen">
      <div class="topbar">
        <button class="btn-text" data-act="close-rules">返回</button>
        <h2>規則</h2>
        <span></span>
      </div>
      <div class="rules-page" style="color:var(--cream)">
        <h2 style="color:var(--gold-soft);margin:0 0 12px">骷髏王規則</h2>
        <h3 style="color:var(--gold)">點玩</h3>
        <p>一共 10 局。第 1 局每人 1 張，之後每局多一張，第 10 局各 10 張。睇完手牌之後，大家一齊叫會贏幾墩（其他人嘅叫牌要等齊先睇到）。估中先有分，估錯就扣分。叫 0 即係估一墩都唔贏。</p>
        <h3 style="color:var(--gold)">特殊牌係咩？</h3>
        <p>特殊牌隨時可出，唔使跟花。牌局入面撳「牌義」，或者手牌右上角嘅「？」，可以隨時再睇。</p>
        <p><strong>母老虎</strong>：出牌時要宣布當海盜定逃脫。當海盜就可以搶墩；當逃脫就盡量唔贏墩。</p>
        <p><strong>逃脫</strong>：通常唔會贏墩。<strong>海盜</strong>大過人魚同數字牌。<strong>人魚</strong>大過數字牌，而且可以捕獲骷髏王。<strong>骷髏王</strong>大過海盜，但會被人魚捕獲。</p>
        <p><strong>八爪魚</strong>會食咗整墩，無人贏。<strong>白鯨</strong>令特殊牌作廢，由最高點數嘅數字牌贏。</p>
        <h3 style="color:var(--gold)">出牌</h3>
        <p>第一張有花色嘅牌決定呢墩要跟嘅花。如果你出數字牌，有嗰種花就要跟。逃脫、海盜、人魚、母老虎、骷髏王、八爪魚同白鯨隨時都可以出，唔使跟花。黑色骷髏旗係王牌，大過其他三種顏色嘅數字牌。</p>
        <p>如果第一張係逃脫或「母老虎當逃脫」，之後第一張數字牌先定花。如果第一張係人魚、海盜、骷髏王、「母老虎當海盜」、八爪魚或白鯨，呢墩就冇得跟花，各人可以出任何牌。如果花色已經定咗，之後先出白鯨，之後出數字牌嘅人仍然要跟嗰個已定花色。</p>
        <h3 style="color:var(--gold)">誰贏呢墩</h3>
        <p>人魚可以捕獲骷髏王。骷髏王大過海盜。海盜大過人魚同所有數字牌。幾個海盜或者兩條人魚一齊出現，先出嗰張贏。如果人魚、海盜同骷髏王同時出現，一定係人魚贏，而且只計人魚捕骷髏王嘅獎勵。全部都係逃脫，就由先出嗰個人贏。出母老虎時要即時宣布當海盜定逃脫。</p>
        <p>八爪魚會食咗整墩：無人贏、牌亦唔算被捕獲（冇捕獲獎勵）。下一墩由「如果冇出八爪魚會贏嗰個人」先出。</p>
        <p>白鯨會令特殊牌全部作廢、唔可以贏墩；所有數字牌都唔再分花色同王牌，由點數最高嗰張贏（相同點數就由先出嗰張贏）。如果呢墩淨係特殊牌，就好似八爪魚咁作廢，下一墩由出白鯨嗰個人先出。數字牌喺白鯨之下贏墩，可以收埋呢墩嘅牌，亦可以計 14 嘅獎勵，但人魚、海盜、骷髏王嘅捕獲獎勵就唔計。</p>
        <p>如果同一墩既有八爪魚又有白鯨，得第二張出嘅獸牌有效，第一張當逃脫。若八爪魚係後出，呢墩作廢，下一墩由「兩張獸牌都冇出過會贏嗰個人」先出。一局最後一墩如果作廢，就直接完局，無人贏嗰墩。因為有墩會被食咗，一局贏墩總數可以少過派牌張數；叫 0 仍然係按呢局張數加減 10 分。</p>
        <h3 style="color:var(--gold)">計分</h3>
        <p>叫 1 墩或以上而且估中：每墩 20 分。估錯：差幾墩就扣 10 分乘相差。叫 0 而且真係一墩都唔贏：10 分乘呢局張數；一旦贏咗墩，就要扣同樣分數。獎勵分只會喺估中叫牌時先計：普通 14 各 +10，黑色 14 +20（誰出都係贏墩嗰個人收）；海盜捕人魚每條 +20；骷髏王捕海盜每個 +30；人魚捕骷髏王 +40。</p>
        <h3 style="color:var(--gold)">呢個版本</h3>
        <p>用 2021 年起 Grand Prix 規則，包括八爪魚同白鯨。牌組 72 張：黃寶藏箱、綠鸚鵡、紫海盜地圖、黑骷髏旗各 1–14，再加 5 張逃脫、5 張海盜、2 條人魚、1 張母老虎、1 張骷髏王、1 張八爪魚同 1 張白鯨。2 至 6 人，莊家輪流，莊家左邊先出第一墩。暫時唔包括贓物牌。</p>
      </div>
    </div>
  `;
}

function render() {
  const screen = state.screen;
  let html;
  if (screen === "rules") html = renderRules();
  else if (screen === "lobby") html = renderLobby();
  else if (screen === "play") html = renderTable();
  else html = renderHome();
  app.innerHTML = html;
  if (screen === "play") applyFlyAnim(state.view);
  bindCardLongPress();
  bindCodeBoxes();
  scrollPlayableIntoView();
  syncWakeLock();
}

async function boot() {
  try {
    const info = await fetch("/api/info").then((r) => r.json());
    if (info?.lanUrls && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      state.lanUrls = info.lanUrls;
    }
  } catch {
    // offline until ws connects
  }
  if (pathCode()) state.joinCode = pathCode();
  render();
  tryResume();
}

boot();
window.addEventListener("resize", () => {
  if (state.screen === "play") render();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseWakeLock();
  else syncWakeLock();
});
window.addEventListener("pagehide", () => {
  releaseWakeLock();
});
