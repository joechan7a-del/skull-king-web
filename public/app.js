import { cardFaceHTML, cardBackHTML, iconSVG, escapeHtml, CARD_HELP, SPECIAL_INFO, SUIT_INFO, cardHelpText, suitLabel } from "./cards.js";
import { extractJoinCode, normalizeJoinCode } from "./join-code.js";
import { qrSvg } from "./qr.js";

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
  shakeCardId: "",
  shakeToken: 0,
  shakeTimer: 0,
  roundSplash: null,
  splashTimer: 0,
  trickCaptionKey: "",
  trickCaptionStartedAt: 0,
  trickCaptionTimer: 0,
  celebrateKey: "",
  confetti: null,
  confettiTimer: 0,
  lobbyNameDraft: null,
  editingBid: false,
  rotateDismissed: false,
  winBuzzKey: "",
  trickLogPeek: false,
  handCollapsed: false,
};

const app = document.getElementById("app");

const SOUND_SRCS = {
  flip: ["/sounds/card-flip.ogg", "/sounds/card-flip.mp3"],
  click: ["/sounds/ui-click.ogg", "/sounds/ui-click.mp3"],
};
const soundBank = {
  flip: { buffer: null, start: 0, fallback: [], volume: 0.55 },
  click: { buffer: null, start: 0, fallback: [], volume: 0.22 },
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

function playCardFlip() { playSound("click"); }
function playUiClick() { playSound("click"); }

function playDealFlutter(count) {
  const n = Math.max(1, Math.min(Number(count) || 1, 3));
  if (prefersReducedMotion()) {
    playUiClick();
    return;
  }
  for (let i = 0; i < n; i++) {
    setTimeout(() => playUiClick(), i * 90);
  }
}

function playTurnChime() { playUiClick(); }

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

function playBeepSequence() { playUiClick(); }

function playFlourishSting() { playUiClick(); }

function playMakeChime() { playUiClick(); }

function playLobbyTick() { playUiClick(); }

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
  return `<div class="flourish-overlay" role="status">
    <div class="flourish-banner" data-kind="${escapeHtml(state.flourish.kind)}">${escapeHtml(state.flourish.text)}</div>
  </div>`;
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

function totalRounds(v) {
  const n = Number(v && v.roundsTotal);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function roundRailHTML(v) {
  if (!v || !v.round) return "";
  const total = totalRounds(v);
  const cur = Math.min(total, Math.max(1, v.round));
  const segs = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const cls = n < cur ? "done" : n === cur ? "current" : "future";
    return `<span class="round-seg ${cls}"></span>`;
  }).join("");
  return `<div class="round-rail" aria-label="進度：第 ${cur}／${total} 局">${segs}</div>`;
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
    return `<input class="code-box" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" maxlength="1" name="sk-room-box-${i}" data-box="${i}" value="${escapeHtml(ch)}" aria-label="房號第 ${i + 1} 個字" spellcheck="false" readonly data-lpignore="true" data-1p-ignore="true" data-form-type="other">`;
  }).join("");
  return `
    <div class="field-label" id="code-boxes-label">房號</div>
    <input id="code-input" class="code-input-sr" maxlength="6" name="sk-room-join-hidden" value="${escapeHtml(code)}" autocapitalize="characters" autocomplete="off" autocorrect="off" inputmode="text" enterkeyhint="go" spellcheck="false" tabindex="-1" readonly aria-hidden="true" data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
    <div class="join-row">
      <div class="code-boxes" role="group" aria-labelledby="code-boxes-label">${boxes}</div>
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

  const unlockBox = (box) => {
    if (box && box.hasAttribute("readonly")) box.removeAttribute("readonly");
  };

  const sync = (code, { focusIndex, joinIfFull } = {}) => {
    const raw = normalizeJoinCode(code);
    state.joinCode = raw;
    boxes.forEach((b, i) => {
      if (b.value !== (raw[i] || "")) b.value = raw[i] || "";
    });
    if (hidden && hidden.value !== raw) hidden.value = raw;
    if (typeof focusIndex === "number" && boxes[focusIndex]) {
      unlockBox(boxes[focusIndex]);
      boxes[focusIndex].focus();
      boxes[focusIndex].select();
      state.codeBoxFocus = focusIndex;
    }
    if (joinIfFull) maybeAutoJoin(raw);
  };

  const sweepCodeBoxes = () => {
    const raw = readBoxes();
    boxes.forEach((b, i) => {
      const want = raw[i] || "";
      if (b.value !== want) b.value = want;
    });
    if (hidden && hidden.value !== raw) hidden.value = raw;
    if (state.joinCode !== raw) state.joinCode = raw;
  };

  boxes.forEach((box, i) => {
    box.addEventListener("pointerdown", () => unlockBox(box));
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
        unlockBox(boxes[i - 1]);
        boxes[i - 1].focus();
        boxes[i - 1].select();
        state.codeBoxFocus = i - 1;
      } else if (e.key === "ArrowRight" && i < 5) {
        e.preventDefault();
        unlockBox(boxes[i + 1]);
        boxes[i + 1].focus();
        boxes[i + 1].select();
        state.codeBoxFocus = i + 1;
      }
    });
    box.addEventListener("paste", (e) => {
      const raw = e.clipboardData?.getData("text") || "";
      if (!raw) return;
      e.preventDefault();
      const extracted = extractJoinCode(raw);
      const prefix = extracted.length === 6 ? "" : readBoxes().slice(0, i);
      const next = normalizeJoinCode(prefix + (extracted || raw));
      sync(next, { focusIndex: Math.min(5, Math.max(0, next.length - 1)), joinIfFull: true });
    });
    box.addEventListener("focus", () => {
      unlockBox(box);
      state.codeBoxFocus = i;
    });
    box.addEventListener("change", sweepCodeBoxes);
    box.addEventListener("animationstart", (e) => {
      if (/autofill|onAutoFillStart/i.test(e.animationName || "")) sweepCodeBoxes();
    });
  });

  if (hidden) {
    hidden.addEventListener("input", () => {
      sync(hidden.value, { focusIndex: Math.min(5, normalizeJoinCode(hidden.value).length), joinIfFull: true });
    });
    hidden.addEventListener("change", sweepCodeBoxes);
  }

  sweepCodeBoxes();
  [0, 50, 200, 600, 1200].forEach((ms) => setTimeout(sweepCodeBoxes, ms));
}

function haptic(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

function connChipHTML() {
  const map = {
    open: ["ok", "已連線"],
    reconnecting: ["wait", "重連緊"],
    connecting: ["wait", "連線緊"],
    closed: ["down", "已斷線"],
    idle: ["wait", "連線緊"],
  };
  const [cls, label] = map[state.conn] || ["wait", "連線緊"];
  return "<span class=\"conn-chip " + cls + "\" role=\"status\">" + label + "</span>";
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

const LIVE_SHARE_URL = "https://onepieceking.up.railway.app";

function prefersReducedMotion() {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function uniqueFirstPlace(v) {
  const players = [...(v?.players || [])];
  if (!players.length) return null;
  const top = Math.max(...players.map((p) => p.score));
  const tied = players.filter((p) => p.score === top);
  return tied.length === 1 ? tied[0] : null;
}

function rankingsForShare(v) {
  const players = [...(v?.players || [])].sort((a, b) => b.score - a.score || 0);
  let lastScore = null;
  let lastPlace = 0;
  let seen = 0;
  return players.map((p) => {
    seen += 1;
    if (lastScore === null || p.score !== lastScore) {
      lastPlace = seen;
      lastScore = p.score;
    }
    const mine = p.id === v.yourId ? "（你）" : "";
    return `${lastPlace}. ${p.name}${mine} ${p.score} 分`;
  });
}

function resultsShareText(v) {
  const lines = rankingsForShare(v);
  const winner = uniqueFirstPlace(v);
  const headline = winner
    ? `${winner.name}${winner.id === v.yourId ? "（你）" : ""}勝出！`
    : "呢場打和。";
  return `骷髏王戰績\n${headline}\n${lines.join("\n")}\n一齊嚟玩：${LIVE_SHARE_URL}`;
}

async function shareResults() {
  const v = state.view;
  if (!v) return;
  const text = resultsShareText(v);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "骷髏王戰績", text, url: LIVE_SHARE_URL });
    } catch (err) {
      const msg = String(err?.name || "") + " " + String(err?.message || "");
      const cancelled = /AbortError|cancel|abort/i.test(msg);
      if (!cancelled) copyText(text);
    }
    return;
  }
  copyText(text);
}

function maybeRoundSplash(msg, { prevRound, prevPhase, prevInGame } = {}) {
  if (!msg?.inGame || msg.phase !== "bidding") return;
  if (!prevPhase) return;
  const entered = prevPhase === "lobby" || prevPhase === "roundResult" || prevPhase === "gameOver" || (prevRound != null && prevRound !== msg.round);
  if (!entered) return;
  const round = msg.round || 1;
  const text = round === 1 ? "遊戲開始！第 1 局" : `第 ${round} 局開始`;
  state.roundSplash = { text, startedAt: performance.now() };
  clearTimeout(state.splashTimer);
  const ms = prefersReducedMotion() ? 500 : 1150;
  state.splashTimer = setTimeout(() => {
    state.roundSplash = null;
    state.splashTimer = 0;
    render();
  }, ms);
}

function roundSplashHTML() {
  if (!state.roundSplash) return "";
  return `<div class="round-splash" role="status">${escapeHtml(state.roundSplash.text)}</div>`;
}

function maybeCelebrateWin(v) {
  if (!v || v.phase !== "gameOver") return;
  const key = `win:${v.round}:${(v.players || []).map((p) => p.score).join(",")}`;
  if (state.celebrateKey === key) return;
  state.celebrateKey = key;
  const winner = uniqueFirstPlace(v);
  if (!winner || winner.id !== v.yourId || prefersReducedMotion()) {
    state.confetti = null;
    return;
  }
  state.confetti = { startedAt: performance.now() };
  playBeepSequence([523, 659, 784, 1046], { type: "triangle", peak: 0.06, attack: 0.02, decay: 0.28, step: 0.1 });
  haptic(28);
  clearTimeout(state.confettiTimer);
  state.confettiTimer = setTimeout(() => {
    state.confetti = null;
    state.confettiTimer = 0;
    render();
  }, 2200);
}

function confettiHTML() {
  if (!state.confetti) return "";
  const colors = ["#edbf59", "#fae094", "#f5e8c7", "#7dff9a", "#8ec8ff", "#ffd0a0"];
  const bits = Array.from({ length: 20 }, (_, i) => {
    const x = 6 + ((i * 4.7) % 88);
    const delay = (i % 8) * 0.04;
    const dur = 1.35 + (i % 5) * 0.12;
    const c = colors[i % colors.length];
    const rot = (i * 47) % 360;
    const dx = ((i % 2 === 0 ? 1 : -1) * (8 + (i * 5) % 18));
    return `<i style="--x:${x}%;--d:${delay}s;--t:${dur}s;--c:${c};--r:${rot}deg;--dx:${dx}px"></i>`;
  }).join("");
  return `<div class="confetti-burst" aria-hidden="true">${bits}</div>`;
}

function shakeIllegalCard(id) {
  if (!id) return;
  state.shakeCardId = id;
  state.shakeToken = (state.shakeToken || 0) + 1;
  clearTimeout(state.shakeTimer);
  state.shakeTimer = setTimeout(() => {
    if (state.shakeCardId === id) state.shakeCardId = "";
    state.shakeTimer = 0;
  }, 420);
}

function sheetHandleHTML() {
  return `<div class="sheet-handle" aria-hidden="true"></div>`;
}

function dismissSheet(act) {
  if (act === "close-inspect") state.inspect = null;
  else if (act === "close-score-peek") state.scorePeek = false;
  else if (act === "close-prev-trick") state.prevTrickPeek = false;
  else if (act === "close-show-code") state.showRoomCode = false;
  else if (act === "cancel-leave") state.leaveConfirm = false;
  else if (act === "close-trick-log") state.trickLogPeek = false;
  else return;
  render();
}

let suppressSheetClickUntil = 0;
let suppressPlayClickUntil = 0;

function syncViewportFrame() {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height || window.innerHeight);
  const w = Math.round(vv?.width || window.innerWidth);
  const root = document.documentElement;
  root.style.setProperty("--vvh", `${h}px`);
  root.style.setProperty("--vvw", `${w}px`);
  const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0))) : 0;
  root.style.setProperty("--kb", inset + "px");
  const el = document.activeElement;
  if (inset > 40 && el && (el.id === "name-input" || el.id === "lobby-name-input" || el.id === "code-input" || el.classList?.contains("code-box"))) {
    try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch { /* ignore */ }
  }
}

function syncKeyboardInset() { syncViewportFrame(); }

function bindKeyboardInset() {
  if (bindKeyboardInset.done) return;
  bindKeyboardInset.done = true;
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", syncViewportFrame);
    vv.addEventListener("scroll", syncViewportFrame);
  }
  window.addEventListener("resize", syncViewportFrame);
  window.addEventListener("orientationchange", () => setTimeout(syncViewportFrame, 80));
  window.addEventListener("focusin", syncViewportFrame);
  window.addEventListener("focusout", () => setTimeout(syncViewportFrame, 50));
  syncViewportFrame();
}

function confirmSelectedPlay() {
  const view = state.view;
  if (!state.selectedCardId || !view) return false;
  const card = (view.myHand || []).find((c) => c.id === state.selectedCardId);
  if (!card) return false;
  if (card.special === "tigress") {
    render();
    return true;
  }
  const id = state.selectedCardId;
  state.selectedCardId = null;
  state.inspect = null;
  haptic(18);
  send({ type: "play", cardId: id });
  return true;
}

function bindCardDrag() {
  if (state.screen !== "play") return;
  const table = app.querySelector(".table-felt, .circle-table");
  app.querySelectorAll(".hand .sk-wrap.playable .sk-play").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const wrap = btn.closest(".sk-wrap");
      const id = btn.dataset.id || wrap?.querySelector("[data-id]")?.dataset.id;
      if (!id) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost = null;
      const pointerId = e.pointerId;
      const overTable = (x, y) => {
        if (!table) return false;
        const r = table.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        table?.classList.remove("drop-ready", "drag-target");
        document.body.classList.remove("dragging-card");
        ghost?.remove();
      };
      const onMove = (ev) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < 16) return;
          if (Math.abs(dx) > Math.abs(dy) + 8) {
            cleanup();
            return;
          }
          dragging = true;
          state.longPressFired = true;
          const cardEl = wrap.querySelector(".sk-card");
          ghost = (cardEl || wrap).cloneNode(true);
          ghost.classList.add("drag-ghost");
          ghost.style.left = ev.clientX + "px";
          ghost.style.top = ev.clientY + "px";
          document.body.appendChild(ghost);
          document.body.classList.add("dragging-card");
          table?.classList.add("drag-target");
          haptic(8);
          ev.preventDefault();
        }
        if (ghost) {
          ghost.style.left = ev.clientX + "px";
          ghost.style.top = ev.clientY + "px";
        }
        table?.classList.toggle("drop-ready", overTable(ev.clientX, ev.clientY));
      };
      const onUp = (ev) => {
        if (ev.pointerId !== pointerId) return;
        const dropped = dragging && overTable(ev.clientX, ev.clientY);
        cleanup();
        if (!dragging) return;
        suppressPlayClickUntil = performance.now() + 450;
        if (!dropped) return;
        const view = state.view;
        const legal = new Set(view?.legalCardIds || []);
        if (view?.phase === "playing" && view?.isMyTurn && legal.has(id)) {
          state.selectedCardId = id;
          state.inspect = null;
          playCardFlip();
          confirmSelectedPlay();
        }
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  });
}


function bindSheetSwipe() {
  app.querySelectorAll("[data-sheet-dismiss]").forEach((sheet) => {
    const act = sheet.dataset.sheetDismiss;
    if (!act) return;
    let startY = 0;
    let startX = 0;
    let dragging = false;
    let armed = false;
    let dy = 0;
    const overlay = sheet.closest(".overlay");
    const resetPos = (animate) => {
      sheet.style.transition = animate ? "transform 0.22s ease" : "";
      sheet.style.transform = "";
      if (overlay) overlay.style.background = "";
      sheet.classList.remove("sheet-dragging");
    };
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("button, input, a, textarea, select, .score-wrap, .legend-list, .prev-plays, .inspect-card, .name-edit-row")) {
        if (!e.target.closest(".sheet-handle")) return;
      }
      if (sheet.scrollTop > 0 && !e.target.closest(".sheet-handle")) return;
      startY = e.clientY;
      startX = e.clientX;
      dragging = true;
      armed = false;
      dy = 0;
      try { sheet.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onMove = (e) => {
      if (!dragging) return;
      const y = e.clientY - startY;
      const x = e.clientX - startX;
      if (!armed) {
        if (Math.abs(x) > 10 && Math.abs(x) > y) {
          dragging = false;
          resetPos(false);
          return;
        }
        if (y > 8) {
          armed = true;
          sheet.classList.add("sheet-dragging");
        } else if (y < -8) {
          dragging = false;
          return;
        } else {
          return;
        }
      }
      dy = Math.max(0, y);
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${dy}px)`;
      if (overlay) overlay.style.background = `rgba(0,0,0,${(0.62 * (1 - Math.min(dy / 420, 0.75))).toFixed(3)})`;
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const close = dy > 96;
      if (close) {
        suppressSheetClickUntil = performance.now() + 400;
        resetPos(false);
        dismissSheet(act);
        return;
      }
      if (armed) suppressSheetClickUntil = performance.now() + 350;
      resetPos(true);
    };
    sheet.addEventListener("pointerdown", onDown);
    sheet.addEventListener("pointermove", onMove, { passive: false });
    sheet.addEventListener("pointerup", onUp);
    sheet.addEventListener("pointercancel", onUp);
  });
}

function playWaitHTML(v) {
  if (!v || (v.phase !== "playing" && v.phase !== "choosingTigress")) return "";
  const players = v.players || [];
  const played = new Set((v.trick || []).map((p) => p.playerIndex));
  const waiting = players.filter((_, i) => !played.has(i));
  if (!waiting.length) return "";
  const names = waiting.map((p) => escapeHtml(p.name) + (p.id === v.yourId ? "（你）" : "")).join("、");
  return `<div class="play-wait" aria-live="polite">仲等：${names}</div>`;
}

function lastTrickCueHTML(v) {
  if (!v) return "";
  if (v.phase !== "playing" && v.phase !== "choosingTigress") return "";
  const total = v.tricksTotal || v.cardsDealt;
  if (!total || v.trickNumber !== total) return "";
  return `<div class="last-trick-cue" role="status">最後一回合</div>`;
}

function seatRadii(n) {
  if (n <= 2) return { rx: 0, ry: 36 };
  if (n === 3) return { rx: 36, ry: 37 };
  if (n === 4) return { rx: 36, ry: 38 };
  if (n === 5) return { rx: 38, ry: 39 };
  return { rx: 40, ry: 39 };
}

function seatPlace(angleDeg) {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a >= 67.5 && a < 112.5) return "bottom";
  if (a >= 112.5 && a < 157.5) return "bottom-left";
  if (a >= 157.5 && a < 202.5) return "left";
  if (a >= 202.5 && a < 247.5) return "top-left";
  if (a >= 247.5 && a < 292.5) return "top";
  if (a >= 292.5 && a < 337.5) return "top-right";
  if (a >= 337.5 || a < 22.5) return "right";
  return "bottom-right";
}

function ledSuitActive(v) {
  if (!v || !v.ledSuit || !SUIT_INFO[v.ledSuit]) return "";
  if (v.phase === "trickResult" && v.lastTrickDestroyed) return "";
  if ((v.phase === "playing" || v.phase === "choosingTigress") && v.currentTrickLead?.destroyed) return "";
  if (v.phase === "playing" || v.phase === "choosingTigress" || v.phase === "trickResult") return v.ledSuit;
  return "";
}

function followSuitHintHTML(v) {
  if (!v || v.phase === "trickResult") return "";
  const suit = ledSuitActive(v);
  if (!suit) return "";
  const labels = {
    black: "呢個回合要跟黑色（骷髏旗）",
    yellow: "呢個回合要跟黃色",
    green: "呢個回合要跟綠色（鸚鵡）",
    purple: "呢個回合要跟紫色",
  };
  const text = labels[suit] || `呢個回合要跟${suitLabel(suit)}`;
  return `<div class="follow-suit-hint suit-${suit}" role="status">${suitPip(suit)}<span>${escapeHtml(text)}</span></div>`;
}

function midTrickCueHTML(v) {
  if (!v) return "";
  const mid = (v.phase === "playing" || v.phase === "choosingTigress") && (v.trick || []).length;
  if (!mid) return "";
  const lead = v.currentTrickLead;
  if (lead?.destroyed) return `<div class="table-status-chip void-soon" role="status">呢個回合快將作廢</div>`;
  if (lead && lead.leading === false) return `<div class="table-status-chip dim" role="status">尚未有人領先</div>`;
  if (lead && (lead.playerName || lead.cardLabel)) {
    const who = escapeHtml(lead.playerName || "");
    const card = escapeHtml(lead.cardLabel || "");
    const label = who && card ? `${who} · ${card}` : (who || card);
    return `<div class="table-status-chip" role="status">而家最大：${label}</div>`;
  }
  return "";
}

function tableCuesRowHTML(v) {
  const last = lastTrickCueHTML(v);
  const mid = midTrickCueHTML(v);
  if (!last && !mid) return "";
  return `<div class="table-cues-row">${last}${mid}</div>`;
}

function submitLobbyName() {
  const v = state.view;
  if (!v || v.phase !== "lobby") return;
  const current = (v.lobbyPlayers || []).find((p) => p.id === v.yourId)?.name || state.name || "";
  const next = String(state.lobbyNameDraft ?? state.name ?? "").replace(/\s+/g, " ").trim().slice(0, 12);
  const name = next || current || "你";
  if (name === current) {
    state.lobbyNameDraft = name;
    return;
  }
  state.name = name;
  state.lobbyNameDraft = name;
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
  send({ type: "setName", name });
  render();
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
  return m ? normalizeJoinCode(m[1]) : "";
}

function shareUrl(code) {
  return `${location.origin}/r/${code}`;
}

const AVATAR_PALETTE = [
  ["#1e6f8b", "#f3fbff"],
  ["#8b3d1f", "#fff4ee"],
  ["#2f6b32", "#eef8e8"],
  ["#5b3d8b", "#f4eefe"],
  ["#8b1f4a", "#fff0f5"],
  ["#1f5b8b", "#e9f3ff"],
  ["#8b6b1f", "#fff8e6"],
  ["#1f8b6b", "#e6faf3"],
];

function avatarStyle(colorIndex) {
  const n = AVATAR_PALETTE.length;
  let i = Number(colorIndex);
  if (!Number.isFinite(i)) i = 0;
  i = ((i % n) + n) % n;
  const pair = AVATAR_PALETTE[i];
  return `--av-bg:${pair[0]};--av-fg:${pair[1]}`;
}

function phoneLandscape() {
  const ua = navigator.userAgent || "";
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches || (navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad|iPod/i.test(ua));
  const land = window.matchMedia?.("(orientation: landscape)")?.matches;
  const short = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight) <= 520;
  return !!(coarse && land && short);
}

function rotateHintHTML() {
  if (state.rotateDismissed || !phoneLandscape()) return "";
  return `<div class="rotate-hint" role="status"><span>豎轉部電話會更好玩</span><button type="button" class="btn-text" data-act="dismiss-rotate">關閉</button></div>`;
}

function bidTotalChipHTML(v) {
  if (!v?.bidsRevealed) return "";
  if (v.phase === "roundResult" || v.phase === "gameOver" || v.phase === "lobby" || v.phase === "bidding") return "";
  const bids = (v.players || []).map((p) => p.bid);
  if (bids.some((b) => b == null)) return "";
  const sum = bids.reduce((a, b) => a + b, 0);
  const total = v.tricksTotal || v.cardsDealt;
  const diff = sum - total;
  let tone = "exact";
  let cue = "剛好";
  if (diff > 0) { tone = "over"; cue = `多 ${diff} 回合`; }
  else if (diff < 0) { tone = "under"; cue = `少 ${-diff} 回合`; }
  return `<div class="bid-total-chip ${tone}" role="status">合共叫 ${sum}／${total} 回合 · ${cue}</div>`;
}

function maybeWinBuzz(v) {
  if (!v || v.phase !== "trickResult" || v.lastTrickDestroyed) return;
  const idx = (v.players || []).findIndex((p) => p.id === v.yourId);
  if (idx < 0 || idx !== v.lastWinnerIndex) return;
  const key = `${v.round}:${v.trickNumber}:${idx}`;
  if (state.winBuzzKey === key) return;
  state.winBuzzKey = key;
  haptic(26);
  playBeepSequence([523.25, 659.25, 783.99], { type: "triangle", peak: 0.06, attack: 0.012, decay: 0.2, step: 0.07 });
}

function trickLogButtonHTML(v) {
  const log = v?.roundTrickLog || [];
  if (!log.length) return "";
  if (v.phase === "roundResult" || v.phase === "gameOver") return "";
  const label = log.length === 1 ? "呢局 1 回合" : `呢局各回合（${log.length}）`;
  return `<button type="button" class="btn btn-ghost prev-trick-btn" data-act="trick-log">${label}</button>`;
}

function trickLogSheetHTML(v) {
  if (!state.trickLogPeek || !v) return "";
  const log = v.roundTrickLog || [];
  if (!log.length) return "";
  const blocks = log.map((t) => {
    const winnerName = (t.cards || []).find((c) => c.playerIndex === t.winnerIndex)?.playerName || "有人";
    const winner = t.destroyed ? "呢個回合作廢" : `${winnerName}贏咗`;
    const plays = (t.cards || []).map((played) => {
      const mine = v.players?.[played.playerIndex]?.id === v.yourId;
      const won = !t.destroyed && played.playerIndex === t.winnerIndex;
      return `<div class="prev-play${won ? " won" : ""}">
        <div class="prev-who">${escapeHtml(played.playerName || "")}${mine ? "（你）" : ""}${won ? " · 贏" : ""}</div>
        <div class="prev-card">${cardFaceHTML(played.card, { tigressAsPirate: played.tigressAsPirate, compact: true })}</div>
      </div>`;
    }).join("");
    return `<section class="trick-log-item">
      <h3>第 ${t.trickNumber} 回合 · ${escapeHtml(winner)}</h3>
      <p>${escapeHtml(t.explanation || "")}</p>
      <div class="prev-plays">${plays}</div>
    </section>`;
  }).join("");
  return `<div class="overlay center" data-act="close-trick-log">
    <div class="sheet inspect-sheet" data-stop="1" data-sheet-dismiss="close-trick-log">
      ${sheetHandleHTML()}
      <h2>呢局打過嘅回合</h2>
      <div class="trick-log-list">${blocks}</div>
      <button class="btn btn-sheet" data-act="close-trick-log">返去牌桌</button>
    </div>
  </div>`;
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
  state.shakeCardId = "";
  clearTimeout(state.shakeTimer);
  state.roundSplash = null;
  clearTimeout(state.splashTimer);
  state.trickCaptionKey = "";
  clearTimeout(state.trickCaptionTimer);
  state.confetti = null;
  clearTimeout(state.confettiTimer);
  state.lobbyNameDraft = null;
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
    const wasReconnect = state.conn === "reconnecting";
    retryDelay = 600;
    state.conn = "open";
    state.error = "";
    const cb = onOpen || state._onOpen;
    state._onOpen = null;
    if (cb) cb();
    if (wasReconnect && state.screen !== "home") {
      showToast("連返啦，牌局繼續", { defer: true });
      haptic(16);
    }
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
    if (/呢個名已經有人用咗/.test(msg.message || "")) {
      const cur = (state.view?.lobbyPlayers || []).find((p) => p.id === state.view?.yourId)?.name;
      if (cur) {
        state.name = cur;
        state.lobbyNameDraft = cur;
      }
    }
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
    const prevPhase = state.view?.phase;
    const prevInGame = !!state.view?.inGame;
    state.view = msg;
    state.code = msg.code;
    state.error = "";
    if (msg.phase === "lobby" || !msg.inGame) {
      const meName = (msg.lobbyPlayers || []).find((p) => p.id === msg.yourId)?.name;
      if (meName && document.activeElement?.id !== "lobby-name-input") {
        state.name = meName;
        state.lobbyNameDraft = meName;
      }
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
      maybeRoundSplash(msg, { prevRound, prevPhase, prevInGame });
      maybeCelebrateWin(msg);
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
    const raw = await navigator.clipboard.readText() || "";
    const code = extractJoinCode(raw);
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
  return "<div class=\"overlay center\" data-act=\"cancel-leave\"><div class=\"sheet\" data-stop=\"1\" data-sheet-dismiss=\"cancel-leave\">" +
    sheetHandleHTML() +
    "<h2>確定離開？</h2>" +
    "<p>牌局仲進行緊。用同一部電話重新打開呢個連結就可以返嚟繼續。</p>" +
    "<div class=\"confirm-actions\"><button type=\"button\" class=\"btn btn-sheet\" data-act=\"cancel-leave\">繼續玩</button>" +
    "<button type=\"button\" class=\"btn btn-ink\" data-act=\"confirm-leave\">離開</button></div></div></div>";
}

function showCodeHTML(code) {
  if (!state.showRoomCode || !code) return "";
  let qr = "";
  try { qr = `<div class="join-qr">${qrSvg(shareUrl(code), { size: 168, alt: "掃碼加入房間" })}</div>`; }
  catch { qr = ""; }
  return "<div class=\"overlay center show-code-overlay\" data-act=\"close-show-code\">" +
    "<div class=\"sheet show-code-sheet\" data-stop=\"1\" data-sheet-dismiss=\"close-show-code\">" +
    sheetHandleHTML() +
    "<p class=\"label\">把房號出示俾朋友</p>" +
    "<div class=\"giant-code\">" + escapeHtml(code) + "</div>" +
    qr +
    "<p class=\"show-code-url\">" + escapeHtml(shareUrl(code)) + "</p>" +
    "<p class=\"sub\">朋友用相機掃呢個碼、輸入房號，或者打開上面條連結，就可以加入。</p>" +
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
  const raw = normalizeJoinCode(code || state.joinCode || pathCode());
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
  if (performance.now() < suppressSheetClickUntil || performance.now() < suppressPlayClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const t = e.target.closest("[data-act]");
  if (!t) {
    if (state.selectedCardId && e.target.closest(".table-felt, .circle-table") && !e.target.closest(".seat-card, button, a, input")) {
      state.selectedCardId = null;
      render();
    }
    return;
  }
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
    const id = t.dataset.id;
    if (t.closest(".hand .sk-wrap.inspect-only, .hand .sk-wrap.unplayable")) shakeIllegalCard(id);
    openInspect(id, t.dataset.why || "");
    return;
  }
  else if (act === "close-inspect") { state.inspect = null; render(); return; }
  else if (act === "card-legend") { state.inspect = { type: "legend" }; state.scorePeek = false; state.prevTrickPeek = false; render(); return; }
  else if (act === "score-peek") { state.inspect = null; state.prevTrickPeek = false; state.trickLogPeek = false; state.scorePeek = true; render(); return; }
  else if (act === "close-score-peek") { state.scorePeek = false; render(); return; }
  else if (act === "prev-trick") { state.inspect = null; state.scorePeek = false; state.trickLogPeek = false; state.prevTrickPeek = true; render(); return; }
  else if (act === "trick-log") { state.inspect = null; state.scorePeek = false; state.prevTrickPeek = false; state.trickLogPeek = true; render(); return; }
  else if (act === "close-trick-log") { state.trickLogPeek = false; render(); return; }
  else if (act === "dismiss-rotate") { state.rotateDismissed = true; render(); return; }
  else if (act === "close-prev-trick") { state.prevTrickPeek = false; render(); return; }
  else if (act === "share-room") { shareRoom(); return; }
  else if (act === "share-results") { shareResults(); return; }
  else if (act === "set-name") { submitLobbyName(); return; }
  else if (act === "copy-code") copyText(state.code);
  else if (act === "copy-link") copyText(shareUrl(state.code));
  else if (act === "seats-inc") send({ type: "setSeats", count: (view?.seats || 5) + 1 });
  else if (act === "seats-dec") send({ type: "setSeats", count: (view?.seats || 5) - 1 });
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
  else if (act === "bid-edit") {
    state.editingBid = true;
    if (state.bidValue == null && view?.players) {
      const me = view.players.find((p) => p.id === view.yourId);
      if (me?.bid != null) state.bidValue = me.bid;
    }
    render();
    return;
  }
  else if (act === "bid-edit-cancel") { state.editingBid = false; render(); return; }
  else if (act === "bid-pick") { state.bidValue = Number(t.dataset.n); haptic(10); render(); }
  else if (act === "bid-submit") {
    if (state.bidValue == null) { setError("請先揀你叫幾多回合。"); return; }
    haptic(16);
    state.editingBid = false;
    send({ type: "bid", value: state.bidValue });
  }
  else if (act === "select-card" || act === "play-card") {
    const id = t.dataset.id;
    const legal = new Set(view?.legalCardIds || []);
    state.inspect = null;
    playCardFlip();
    if (view?.phase !== "playing" || !view?.isMyTurn || !legal.has(id)) {
      if (t.closest(".hand .sk-wrap")) shakeIllegalCard(id);
      openInspect(id, t.dataset.why || "");
      return;
    }
    haptic(12);
    state.selectedCardId = state.selectedCardId === id ? null : id;
    render();
    return;
  }
  else if (act === "confirm-play") {
    confirmSelectedPlay();
  }
  else if (act === "toggle-hand") {
    state.handCollapsed = !state.handCollapsed;
    render();
    return;
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
  } else if (t.id === "lobby-name-input") {
    state.lobbyNameDraft = t.value;
  } else if (t.id === "code-input") {
    state.joinCode = normalizeJoinCode(t.value);
  }
});

app.addEventListener("focusout", (e) => {
  if (e.target.id === "lobby-name-input") submitLobbyName();
});

app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "code-input") joinRoom();
  else if (e.target.id === "lobby-name-input") {
    e.preventDefault();
    submitLobbyName();
  }
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
  if (v.phase === "trickResult") return "等呢個回合結果完咗，先出下一張。";
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
  if (value == null) return "睇完手牌先叫。叫 0 即係預測一個回合都唔贏。";
  if (value === 0) return `叫 0：預測一個回合都唔贏。估中加 ${10 * cardsDealt} 分，一旦贏咗回合就要扣 ${10 * cardsDealt} 分。`;
  return `叫 ${value} 回合：估中加 ${20 * value} 分；估錯就差幾回合，每差 1 回合扣 10 分。`;
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
      <div class="sheet inspect-sheet" data-stop="1" data-sheet-dismiss="close-inspect">
        ${sheetHandleHTML()}
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
    <div class="sheet inspect-sheet" data-stop="1" data-sheet-dismiss="close-inspect">
      ${sheetHandleHTML()}
      <div class="inspect-card${ins.why ? " illegal-shake" : ""}">${cardFaceHTML(card, { tigressAsPirate: ins.tigressAsPirate })}</div>
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
        <div class="home-gap"></div>
        <button class="btn btn-gold" data-act="create">開房</button>
        <div class="or-row">或者加入</div>
        ${codeBoxesHTML(prefill)}
        <p class="home-hint">開房之後把房號或連結傳俾朋友，佢哋輸入同一個號就可以一齊玩。第一次玩可以先睇遊戲規則。</p>
        <div class="error-line">${escapeHtml(state.error)}</div>
      </div>
      <div class="home-foot">
        <button class="btn-text" data-act="rules">遊戲規則</button>
        <div class="footer-note">基本規則 · 八爪魚同白鯨 · 5 局 · 暫時唔包括贓物牌</div>
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
    ...humans.map((h, i) => {
      const tags = [];
      if (h.isHost) tags.push(`<span class="pill host">房主</span>`);
      if (h.ready) tags.push(`<span class="pill">已準備</span>`);
      if (!h.connected) tags.push(`<span class="pill down">已斷線</span>`);
      const display = h.id === v.yourId ? (state.name || h.name) : h.name;
      return `<div class="player-row${h.id === v.yourId ? " me" : ""}">
        <div class="avatar tone" style="${avatarStyle(h.colorIndex ?? i)}">${escapeHtml((display || "?").slice(0, 1))}</div>
        <div class="meta">
          <div class="name">${escapeHtml(display)}${h.id === v.yourId ? "（你）" : ""}</div>
        </div>
        ${tags.join("")}
      </div>`;
    }),
    ...ai.map((a, i) => `<div class="player-row">
      <div class="avatar ai tone" style="${avatarStyle(a.colorIndex ?? (humans.length + i))}">${escapeHtml((a.name || "電").slice(0, 1))}</div>
      <div class="meta">
        <div class="name">${escapeHtml(a.name || "電腦補位")}</div>
        <div class="sub">電腦對手 · 開始後隨機改名入座</div>
      </div>
      <span class="pill muted">電腦</span>
    </div>`),
  ];

  return `
    ${bannerHTML()}
    <div class="screen lobby-screen">
      <div class="topbar">
        <button class="btn-text" data-act="leave">離開</button>
        <h2>大廳</h2>
        <div class="topbar-right">${connChipHTML()}${muteToggleHTML()}<button class="btn-text" data-act="rules">規則</button></div>
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
      <div class="lobby-scroll">
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
        ${(() => {
          if (state.lobbyNameDraft == null) state.lobbyNameDraft = state.name || me?.name || "";
          const draft = state.lobbyNameDraft;
          return `<div class="lobby-name-edit">
            <label class="field-label" for="lobby-name-input">改你嘅名</label>
            <div class="name-edit-row">
              <input id="lobby-name-input" maxlength="12" value="${escapeHtml(draft)}" autocomplete="nickname" enterkeyhint="done" />
              <button type="button" class="btn btn-gold" data-act="set-name">確定</button>
            </div>
          </div>`;
        })()}
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
        <button class="btn btn-gold${canStart ? " can-start" : ""}" data-act="start" ${canStart ? "" : "disabled"}>開始遊戲</button>` : ""}
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
  const rx = 22;
  const ry = 19.5;
  const startDeg = 115;
  const sweepDeg = 302;
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = ((startDeg + sweepDeg) * Math.PI) / 180;
  const x0 = (cx + rx * Math.cos(a0)).toFixed(2);
  const y0 = (cy + ry * Math.sin(a0)).toFixed(2);
  const x1 = (cx + rx * Math.cos(a1)).toFixed(2);
  const y1 = (cy + ry * Math.sin(a1)).toFixed(2);
  const rot = (Math.atan2(ry * Math.cos(a1), -rx * Math.sin(a1)) * 180 / Math.PI).toFixed(2);
  const large = sweepDeg > 180 ? 1 : 0;
  return `<svg class="table-arrows" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M ${x0} ${y0} A ${rx} ${ry} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="#edbf59" stroke-width="1.6" stroke-linecap="round" />
    <polygon points="0,0 -7.2,-3.1 -4.6,0 -7.2,3.1" fill="#edbf59" transform="translate(${x1} ${y1}) rotate(${rot})" />
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
  const { rx, ry } = seatRadii(n);

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
    const place = seatPlace(angleDeg);
    const played = trickByPlayer.get(playerIndex);
    let arriveFlag = false;
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
    const dealerTag = playerIndex === v.dealerIndex ? "莊" : "";
    let card = "";
    if (played) {
      const justPlayed = isJustPlayed(played.card.id);
      if (justPlayed) {
        maybeSpecialFlourish(played);
        if (!isMe) haptic(10);
      }
      const slam = justPlayed ? " slam" : "";
      if (justPlayed && !isMe) arriveFlag = true;
      const voidCause = destroyed && isVoidCausePlay(played);
      card = `<button class="seat-card ${win ? "winner" : ""} ${destroyed && !voidCause ? "voided" : ""}${voidCause ? " void-cause" : ""}${slam}" data-act="inspect" data-id="${escapeHtml(played.card.id)}" aria-label="睇呢張牌">
           ${cardFaceHTML(played.card, { tigressAsPirate: played.tigressAsPirate, compact: true })}
           ${win ? `<div class="seat-win">贏</div>` : ""}
           ${voidCause ? `<div class="seat-win void-cause-tag">作廢</div>` : ""}
         </button>`;
    } else if (showSlots) {
      card = `<div class="seat-card empty"><div class="card-slot" aria-hidden="true"></div></div>`;
    }
    const arrive = arriveFlag ? " seat-arrive" : "";
    const celebrate = win ? " winner-celebrate" : "";
    const bustCls = bidLine.busted ? " busted" : "";
    const boomCls = bidLine.explode ? " bust-explode" : "";
    const featured = win || (destroyed && played && isVoidCausePlay(played));
    const z = bidLine.explode ? 8 : featured ? 7 : thinking ? 6 : 2;
    return `<div class="seat place-${place} ${thinking ? "thinking" : ""} ${isMe ? "is-me" : ""} ${win ? "winner" : ""}${celebrate}${arrive}${bustCls}${boomCls} ${p.isAI ? "ai-seat" : ""}"
      style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--rot:${rot}deg;z-index:${z}">
      ${card}
      ${bidLine.explode ? `<div class="bust-burst" aria-hidden="true"></div>` : ""}
      ${scoreFloaterHTML(v, p.id, i)}
      <div class="seat-info">
        <div class="avatar-wrap">
          <div class="avatar tone ${thinking ? "gold" : p.isAI ? "ai" : ""} ${win ? "win-ring" : ""}${bidLine.busted ? " bust-avatar" : ""}" style="${avatarStyle(p.colorIndex ?? playerIndex)}">${escapeHtml(p.name.slice(0, 1))}</div>
          <span class="conn-dot ${connected ? "on" : "off"}" title="${connected ? (p.isAI ? "電腦" : "已連線") : "已斷線"}" aria-label="${connected ? (p.isAI ? "電腦" : "已連線") : "已斷線"}"></span>
        </div>
        <div class="seat-meta">
          <div class="nm-row">
            <span class="nm">${escapeHtml(p.name)}${isMe ? "（你）" : ""}</span>
            ${dealerTag ? `<span class="seat-dealer">莊</span>` : ""}${leadTag ? `<span class="seat-lead">${leadTag}</span>` : ""}
            ${thinking ? `<span class="seat-thinking">諗緊</span>` : ""}
          </div>
          ${bidLine.html}
          <div class="seat-sub">${st ? `<span class="st">${escapeHtml(st)}</span>` : ""}${!bidding && v.phase !== "roundResult" && v.phase !== "gameOver" && v.phase !== "lobby" ? handStackHTML(p.handCount) : ""}<span class="sc">${p.score} 分</span></div>
        </div>
      </div>
    </div>`;
  }).join("");

  let center = "";
  const hasCards = (v.trick || []).length > 0;
  if (v.phase === "trickResult") center = "";
  else if (destroyed) center = `<div class="table-center void">呢個回合作廢，無人贏</div>`;
  else if (!hasCards && bidding) center = `<div class="table-center dim">叫牌中</div>`;
  else if (!hasCards) center = `<div class="table-center dim">呢個回合尚未出牌</div>`;
  else center = "";

  const led = ledSuitActive(v);
  const suitClass = led ? ` suit-${led}` : "";
  return `<div class="circle-wrap">
    <div class="circle-table n-${n} ${destroyed ? "destroyed" : ""}" role="group" aria-label="牌桌，出牌順序順時針">
      <div class="table-felt felt-rich${suitClass}">${tableArrowsSVG()}${center}</div>
      ${seats}
    </div>
  </div>`;
}


function isVoidCausePlay(played) {
  const special = played?.card?.special;
  return special === "kraken" || special === "whiteWhale";
}

function trickResultFeaturedPlays(v) {
  const trick = v?.trick || [];
  if (v.lastTrickDestroyed) return trick.filter(isVoidCausePlay);
  if (v.lastWinnerIndex == null) return [];
  return trick.filter((p) => p.playerIndex === v.lastWinnerIndex);
}

function trickResultOverlayHTML(v) {
  if (!v || v.phase !== "trickResult" || !v.showTrickExplanation) return "";
  maybeWinBuzz(v);
  const meIndex = (v.players || []).findIndex((p) => p.id === v.yourId);
  const mine = !v.lastTrickDestroyed && meIndex >= 0 && meIndex === v.lastWinnerIndex;
  let title;
  if (v.lastTrickDestroyed) title = "呢個回合作廢";
  else if (mine) title = "你贏咗呢個回合";
  else {
    const winner = (v.players || [])[v.lastWinnerIndex];
    title = `${winner?.name || "有人"}贏咗呢個回合`;
  }
  const whyText = v.lastTrickExplanation || v.statusMessage || "";
  const why = whyText ? `<p class="trick-result-why">${escapeHtml(whyText)}</p>` : "";
  const details = (!v.lastTrickDestroyed && (v.lastTrickDetails || []).length)
    ? `<div class="bonus-banner" role="status">${(v.lastTrickDetails || []).map((d) => `<span class="bonus-chip">${escapeHtml(d)}</span>`).join("")}</div>`
    : "";
  const featured = trickResultFeaturedPlays(v);
  const cards = featured.length
    ? `<div class="trick-result-cards" aria-hidden="false">${featured.map((p) => {
        const kind = v.lastTrickDestroyed ? "void-cause" : "winner";
        const who = escapeHtml(p.playerName || (v.players || [])[p.playerIndex]?.name || "");
        return `<div class="trick-result-card" data-featured="${kind}">
          ${cardFaceHTML(p.card, { tigressAsPirate: p.tigressAsPirate, compact: true })}
          ${who ? `<div class="trick-result-card-name">${who}</div>` : ""}
        </div>`;
      }).join("")}</div>`
    : "";
  return `<div class="trick-result-overlay" role="dialog" aria-modal="false" aria-labelledby="trick-result-title">
    <div class="sheet trick-result-sheet" data-stop="1">
      ${cards}
      <div class="trick-result-copy">
        <h2 id="trick-result-title">${escapeHtml(title)}</h2>
        ${why}
        ${details}
      </div>
      <button type="button" class="btn btn-gold" data-act="continue">下一回合</button>
    </div>
  </div>`;
}

function myBidTrackHTML(v) {
  const me = (v.players || []).find((p) => p.id === v.yourId);
  if (!me || !v.bidsRevealed || me.bid == null) return "";
  if (v.phase === "bidding" || v.phase === "roundResult" || v.phase === "gameOver") return "";
  const busted = me.tricksWon > me.bid;
  let text;
  if (busted) text = `你已爆咗：叫 ${me.bid} 贏 ${me.tricksWon}`;
  else if (me.tricksWon === me.bid) text = `你：叫 ${me.bid} 贏 ${me.tricksWon}，已經夠回合`;
  else text = `你：叫 ${me.bid} 贏 ${me.tricksWon}，仲差 ${me.bid - me.tricksWon} 回合`;
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
    <div class="sheet" data-stop="1" data-sheet-dismiss="close-score-peek">
      ${sheetHandleHTML()}
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
  if (!v || v.phase === "roundResult" || v.phase === "gameOver") return "";
  const prev = (v.previousTrick && v.phase !== "trickResult")
    ? `<button type="button" class="btn btn-ghost prev-trick-btn" data-act="prev-trick">上一回合</button>`
    : "";
  const log = trickLogButtonHTML(v);
  if (!prev && !log) return "";
  return `<div class="prev-trick-bar">${prev}${log}</div>`;
}

function prevTrickSheetHTML(v) {
  if (!state.prevTrickPeek || !v?.previousTrick) return "";
  const t = v.previousTrick;
  const winner = t.winnerIndex != null ? (v.players || [])[t.winnerIndex] : null;
  const winnerName = winner?.name || t.cards.find((c) => c.playerIndex === t.winnerIndex)?.playerName || "";
  let result;
  if (t.explanation) result = t.explanation;
  else if (t.destroyed) result = "呢個回合作廢，無人贏（八爪魚或白鯨）。";
  else result = `${winnerName || "有人"}贏咗呢個回合。`;
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
    <div class="sheet inspect-sheet" data-stop="1" data-sheet-dismiss="close-prev-trick">
      ${sheetHandleHTML()}
      <h2>上一回合</h2>
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
  if (!bidding) state.editingBid = false;

  let bidPanel = "";
  if (bidding) {
    const n = v.cardsDealt;
    const editing = alreadyBid && state.editingBid;
    const btns = Array.from({ length: n + 1 }, (_, i) => {
      const on = state.bidValue === i ? "on" : "";
      const zero = i === 0 ? " bid-zero" : "";
      const label = i === 0 ? `<span class="bid-n">0</span><span class="bid-cue">預測唔贏</span>` : String(i);
      return `<button type="button" class="${on}${zero}" data-act="bid-pick" data-n="${i}">${label}</button>`;
    }).join("");
    const bidCount = (v.players || []).filter((p) => p.hasBid).length;
    const bidTotal = (v.players || []).length;
    const waitingBid = (v.players || []).filter((p) => !p.hasBid);
    const waitingHTML = waitingBid.length
      ? ("<div class=\"bid-wait\" aria-live=\"polite\"><span>仲等</span> " + waitingBid.map((p) => "<span class=\"bid-wait-name\">" + escapeHtml(p.name) + (p.id === v.yourId ? "（你）" : "") + "</span>").join("") + "</div>")
      : "<p class=\"bid-wait done\">所有人都叫咗。</p>";
    const progress = `<p class="bid-progress">已叫 ${bidCount}／${bidTotal} 人</p>${waitingHTML}`;
    if (alreadyBid && !editing) {
      bidPanel = `<div class="bid-panel">
      <h3>已叫牌，等其他人</h3>
      ${progress}
      <p>你叫咗 ${myBid} 回合。其他人叫咩要等齊先睇到。齊人揭曉之前你仍然可以改叫。</p>
      <button type="button" class="btn btn-sheet" data-act="bid-edit">改叫牌</button>
    </div>`;
    } else {
      const submitLabel = state.bidValue == null
        ? "請先揀叫幾多回合"
        : (alreadyBid ? `確定改叫 ${state.bidValue} 回合` : `確定叫 ${state.bidValue} 回合`);
      const needFirstBid = !alreadyBid;
      const pulsePick = needFirstBid && state.bidValue == null;
      const pulseConfirm = needFirstBid && state.bidValue != null;
      bidPanel = `<div class="bid-panel">
      <h3>${alreadyBid ? "改叫幾多回合？" : "預測會贏幾多回合？"}</h3>
      ${progress}
      <p>${alreadyBid ? `而家叫咗 ${myBid} 回合。改完仍然會等其他人一齊揭曉。` : `睇完手牌先叫，可以叫 0 到 ${n}。其他人叫咩要等齊先睇到。`}</p>
      <p class="bid-hint">${escapeHtml(bidHint(n, state.bidValue))}</p>
      <div class="bid-grid${pulsePick ? " bid-need-pick" : ""}">${btns}</div>
      <div class="confirm-actions">
        ${alreadyBid ? `<button type="button" class="btn btn-sheet" data-act="bid-edit-cancel">唔改</button>` : ""}
        <button class="btn btn-gold${pulseConfirm ? " bid-need-confirm" : ""}" data-act="bid-submit" ${state.bidValue == null ? "disabled" : ""}>${submitLabel}</button>
      </div>
    </div>`;
    }
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
        playDealFlutter(handCards.length);
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
  const canBidNow = bidding && !(alreadyBid && !state.editingBid);
  if (state.handCollapsed && ((canPlay && v.phase === "playing") || canBidNow)) {
    state.handCollapsed = false;
  }
  const handTray = `<div class="hand-tray">
    <div class="hand-count">手牌 ${handCards.length} 張</div>
    <button type="button" class="btn-text" data-act="toggle-hand">${state.handCollapsed ? "顯示手牌" : "收起手牌 · 睇晒張枱"}</button>
  </div>`;
  const hand = `<div class="hand-scroll${state.handCollapsed ? " is-collapsed" : ""}"><div class="hand${dealing ? " dealing" : ""}">${handCards
    .map((c, i) => {
      const isLegal = canPlay && legal.has(c.id);
      const dim = canPlay && !legal.has(c.id);
      const selected = isLegal && state.selectedCardId === c.id;
      const why = !isLegal ? cardPlayWhy(c, v) : "";
      const dealCls = dealing ? " deal-in" : "";
      const style = `style="margin-right:${i === handCards.length - 1 ? 0 : overlap}px;z-index:${selected ? 40 : i};--deal-i:${i};--deal-base:${dealBaseMs}ms"`;
      const inner = cardFaceHTML(c, { dimmed: dim });
      let tag = "";
      if (isLegal && v.ledSuit) {
        tag = c.special
          ? `<span class="card-tag special">特殊</span>`
          : (c.suit === v.ledSuit ? `<span class="card-tag follow">跟</span>` : "");
      }
      if (handCards.length === 1 && (v.phase === "playing" || v.phase === "choosingTigress" || v.phase === "trickResult")) {
        tag += `<span class="card-tag last">最後</span>`;
      }
      const shaking = !isLegal && state.shakeCardId === c.id ? " illegal-shake" : "";
      if (isLegal) {
        return `<div class="sk-wrap${selected ? " selected" : ""} playable${dealCls}" ${style}>
          <button class="sk-play" data-act="select-card" data-id="${escapeHtml(c.id)}">${inner.replace("sk-card ", `sk-card legal ${selected ? "picked " : ""}`)}</button>
          ${tag}
        </div>`;
      }
      return `<div class="sk-wrap inspect-only${dim ? " unplayable" : ""}${dealCls}${shaking}" ${style}>
        <button class="sk-play" data-act="inspect" data-id="${escapeHtml(c.id)}" data-why="${escapeHtml(why)}">${inner}</button>
              </div>`;
    })
    .join("")}</div></div>`;

  const confirmBar = confirmBarHTML(v);
  const ledClass = ledSuitActive(v);

  return `
    ${bannerHTML()}
    <div class="screen table-screen${ledClass ? ` led-${ledClass}` : ""}">
      ${flourishBannerHTML()}
      <div class="table-header">
        <div class="header-left">
          <button class="btn-text" data-act="leave">離開</button>
          ${muteToggleHTML()}
          ${connChipHTML()}
        </div>
        <div class="center">
          <div class="round">第 ${v.round} 局／${totalRounds(v)}</div>
          ${roundRailHTML(v)}
          <div class="sub">${(() => {
            const total = v.tricksTotal || v.cardsDealt;
            if (v.phase === 'bidding') return '各 ' + v.cardsDealt + ' 張 · 叫牌中';
            if (v.phase === 'roundResult' || v.phase === 'gameOver') return '各 ' + v.cardsDealt + ' 張 · 局滿';
            return '第 ' + (v.trickNumber || 1) + '／' + total + ' 回合';
          })()}</div>
        </div>
        <div class="header-actions">
          <button class="btn-text" data-act="score-peek">分數</button>
          <button class="btn-text" data-act="card-legend">牌義</button>
          <button class="btn-text" data-act="rules">規則</button>
        </div>
      </div>
      <div class="table-top-slot">${bidTotalChipHTML(v)}${tableCuesRowHTML(v)}</div>
      ${circleTableHTML(v)}
      <div class="table-dock">
        ${prevTrickButtonHTML(v)}
        <div class="dock-status-row">${playWaitHTML(v)}${followSuitHintHTML(v)}</div>
        <div class="error-line">${escapeHtml(state.error)}</div>
        ${bidPanel}
        ${confirmBar}
        ${myBidTrackHTML(v)}
        ${handTray}
        ${hand}
      </div>
      ${trickResultOverlayHTML(v)}
    </div>
    ${v.pendingTigress ? tigressHTML() : ""}
    ${v.phase === "roundResult" || v.phase === "gameOver" ? scoreHTML(v) : ""}
    ${scorePeekHTML(v)}
    ${prevTrickSheetHTML(v)}
    ${trickLogSheetHTML(v)}
    ${inspectHTML()}
    ${leaveConfirmHTML()}${showCodeHTML(v.code)}
    ${roundSplashHTML()}
    ${confettiHTML()}
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
        <p class="tig-explain">同普通海盜一樣，可以搶回合；如果捕獲人魚（而且呢個回合冇骷髏王），估中叫牌仲可以加分。</p>
        <button class="btn btn-ink" data-act="tig-escape">當逃脫出</button>
        <p class="tig-explain">同逃脫一樣，通常唔會贏回合。適合你已經贏夠，唔想再攞回合嘅時候。</p>
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
    const busted = meRow.taken > meRow.bid;
    const kicker = made ? "叫中！" : busted ? "爆咗" : "唔夠回合";
    mineSummary = `<div class="score-hero ${made ? "made" : busted ? "missed bust" : "missed short"}">
      <div class="hero-kicker">${kicker}</div>
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
  const nextLabel = v.round >= totalRounds(v) ? "睇總分" : "下一局";
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
    const waitNote = needed.length > 1 ? `<p class="start-hint">大家都睇完先會進入${v.round >= totalRounds(v) ? "總分" : "下一局"}。</p>` : "";
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
      ${over ? `<div class="actions"><button type="button" class="btn btn-ghost" data-act="share-results">分享戰績</button></div>` : ""}
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
        <p>一共 5 局。第 1 局每人 6 張，之後每局多一張，第 5 局各 10 張。睇完手牌之後，大家一齊預測會贏幾多回合（其他人嘅叫牌要等齊先睇到）。估中先有分，估錯就扣分。叫 0 即係預測一個回合都唔贏。</p>
        <h3 style="color:var(--gold)">特殊牌係咩？</h3>
        <p>特殊牌隨時可出，唔使跟花。牌局入面撳「牌義」，或者手牌右上角嘅「？」，可以隨時再睇。</p>
        <p><strong>母老虎</strong>：出牌時要宣布當海盜定逃脫。當海盜就可以搶回合；當逃脫就盡量唔贏回合。</p>
        <p><strong>逃脫</strong>：通常唔會贏回合。<strong>海盜</strong>大過人魚同數字牌。<strong>人魚</strong>大過數字牌，而且可以捕獲骷髏王。<strong>骷髏王</strong>大過海盜，但會被人魚捕獲。</p>
        <p><strong>八爪魚</strong>會食咗整個回合，無人贏。<strong>白鯨</strong>令特殊牌作廢，由最高點數嘅數字牌贏。</p>
        <h3 style="color:var(--gold)">出牌</h3>
        <p>第一張有花色嘅牌決定呢個回合要跟嘅花。如果你出數字牌，有嗰種花就要跟。逃脫、海盜、人魚、母老虎、骷髏王、八爪魚同白鯨隨時都可以出，唔使跟花。黑色骷髏旗係王牌，大過其他三種顏色嘅數字牌。</p>
        <p>如果第一張係逃脫或「母老虎當逃脫」，之後第一張數字牌先定花。如果第一張係人魚、海盜、骷髏王、「母老虎當海盜」、八爪魚或白鯨，呢個回合就冇得跟花，各人可以出任何牌。如果花色已經定咗，之後先出白鯨，之後出數字牌嘅人仍然要跟嗰個已定花色。</p>
        <h3 style="color:var(--gold)">誰贏呢個回合</h3>
        <p>人魚可以捕獲骷髏王。骷髏王大過海盜。海盜大過人魚同所有數字牌。幾個海盜或者兩條人魚一齊出現，先出嗰張贏。如果人魚、海盜同骷髏王同時出現，一定係人魚贏，而且只計人魚捕骷髏王嘅獎勵。全部都係逃脫，就由先出嗰個人贏。出母老虎時要即時宣布當海盜定逃脫。</p>
        <p>八爪魚會食咗整個回合：無人贏、牌亦唔算被捕獲（冇捕獲獎勵）。下一回合由「如果冇出八爪魚會贏嗰個人」先出。</p>
        <p>白鯨會令特殊牌全部作廢、唔可以贏回合；所有數字牌都唔再分花色同王牌，由點數最高嗰張贏（相同點數就由先出嗰張贏）。如果呢個回合淨係特殊牌，就好似八爪魚咁作廢，下一回合由出白鯨嗰個人先出。數字牌喺白鯨之下贏回合，可以收埋呢個回合嘅牌，亦可以計 14 嘅獎勵，但人魚、海盜、骷髏王嘅捕獲獎勵就唔計。</p>
        <p>如果同一回合既有八爪魚又有白鯨，得第二張出嘅獸牌有效，第一張當逃脫。若八爪魚係後出，呢個回合作廢，下一回合由「兩張獸牌都冇出過會贏嗰個人」先出。一局最後一回合如果作廢，就直接完局，無人贏嗰個回合。因為有回合會被食咗，一局贏回合總數可以少過派牌張數；叫 0 仍然係按呢局張數加減 10 分。</p>
        <h3 style="color:var(--gold)">計分</h3>
        <p>叫 1 回合或以上而且估中：每回合 20 分。估錯：差幾回合就扣 10 分乘相差。叫 0 而且真係一個回合都唔贏：10 分乘呢局張數；一旦贏咗回合，就要扣同樣分數。獎勵分只會喺估中叫牌時先計：普通 14 各 +10，黑色 14 +20（誰出都係贏回合嗰個人收）；海盜捕人魚每條 +20；骷髏王捕海盜每個 +30；人魚捕骷髏王 +40。</p>
        <h3 style="color:var(--gold)">呢個版本</h3>
        <p>用 2021 年起 Grand Prix 規則，包括八爪魚同白鯨。牌組 72 張：黃寶藏箱、綠鸚鵡、紫海盜地圖、黑骷髏旗各 1–14，再加 5 張逃脫、5 張海盜、2 條人魚、1 張母老虎、1 張骷髏王、1 張八爪魚同 1 張白鯨。2 至 6 人，莊家輪流，莊家左邊先出第一回合。暫時唔包括贓物牌。</p>
      </div>
    </div>
  `;
}

function render() {
  const screen = state.screen;
  const prevScreen = app.dataset.screen || "";
  let html;
  if (screen === "rules") html = renderRules();
  else if (screen === "lobby") html = renderLobby();
  else if (screen === "play") html = renderTable();
  else html = renderHome();
  app.innerHTML = rotateHintHTML() + html;
  app.dataset.screen = screen;
  if (prevScreen && prevScreen !== screen) {
    app.querySelector(".screen")?.classList.add("screen-in");
  }
  if (screen === "play") applyFlyAnim(state.view);
  bindCardLongPress();
  bindCardDrag();
  bindCodeBoxes();
  bindSheetSwipe();
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
  bindKeyboardInset();
  render();
  tryResume();
}

boot();
window.addEventListener("resize", () => {
  if (state.screen === "play" || phoneLandscape() || document.querySelector(".rotate-hint")) render();
});
window.addEventListener("orientationchange", () => render());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseWakeLock();
  else syncWakeLock();
});
window.addEventListener("pagehide", () => {
  releaseWakeLock();
});
