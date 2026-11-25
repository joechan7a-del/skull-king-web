import { cardFaceHTML, cardBackHTML, iconSVG, escapeHtml, CARD_HELP, SPECIAL_INFO, SUIT_INFO, cardHelpText, suitLabel } from "./cards.js";

const TOKEN_KEY = "sk_token";
const NAME_KEY = "sk_name";
const ROOM_KEY = "sk_room";

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
  lastRound: 1,
  error: "",
  toast: "",
  toastTimer: 0,
  lanUrls: [],
  conn: "idle", // idle | connecting | open | reconnecting | closed
  pendingRoom: "",
};

const app = document.getElementById("app");

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

function showToast(msg) {
  state.toast = msg;
  render();
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 1800);
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
    } else {
      state.screen = state.screen === "rules" ? "rules" : "play";
      if (state.screen !== "rules") state.rulesReturn = "play";
      if (prevRound && msg.round !== prevRound) state.bidValue = null;
      if (msg.phase === "bidding" && state.bidValue != null && state.bidValue > msg.cardsDealt) state.bidValue = null;
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
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  if (t.dataset.act === "close-inspect" && e.target.closest("[data-stop]")) return;
  const act = t.dataset.act;
  const view = state.view;
  if (act === "create") createRoom();
  else if (act === "join") joinRoom();
  else if (act === "rules") openRules();
  else if (act === "close-rules") closeRules();
  else if (act === "resume") resumeSavedGame();
  else if (act === "discard-session") discardSavedGame();
  else if (act === "inspect") {
    e.stopPropagation();
    openInspect(t.dataset.id, t.dataset.why || "");
    return;
  }
  else if (act === "close-inspect") { state.inspect = null; render(); return; }
  else if (act === "card-legend") { state.inspect = { type: "legend" }; render(); return; }
  else if (act === "copy-code") copyText(state.code);
  else if (act === "copy-link") copyText(shareUrl(state.code));
  else if (act === "seats-inc") send({ type: "setSeats", count: (view?.seats || 4) + 1 });
  else if (act === "seats-dec") send({ type: "setSeats", count: (view?.seats || 4) - 1 });
  else if (act === "ai-fill") send({ type: "setAiFill", enabled: t.dataset.on !== "1" });
  else if (act === "ready") send({ type: "ready", ready: t.dataset.on !== "1" });
  else if (act === "start") send({ type: "startGame" });
  else if (act === "leave") {
    if (view?.inGame && !confirm("暫時離開？用同一部電話重新打開連結就可以返來繼續。")) return;
    send({ type: "leave" });
    // If mid-game, keep token so they can rejoin.
    if (view?.inGame) {
      goHome({ clearToken: false });
    }
  }
  else if (act === "bid-pick") { state.bidValue = Number(t.dataset.n); render(); }
  else if (act === "bid-submit") {
    if (state.bidValue == null) { setError("請先揀你叫幾多墩。"); return; }
    send({ type: "bid", value: state.bidValue });
  }
  else if (act === "play-card") {
    const id = t.dataset.id;
    state.inspect = null;
    send({ type: "play", cardId: id });
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
  if (state.conn === "reconnecting" || state.conn === "connecting") {
    return `<div class="banner info">${state.conn === "reconnecting" ? "連線中斷，重新連接緊…" : "連線緊…"}</div>`;
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
    const played = (v.trick || []).find((p) => p.card?.id === cardId);
    if (played) {
      card = played.card;
      tigressAsPirate = played.tigressAsPirate;
    }
  }
  if (!card) return;
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
        <button class="btn btn-gold" data-act="close-inspect">知道喇</button>
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
      ${ins.canPlay ? `<button class="btn btn-gold" data-act="play-card" data-id="${escapeHtml(card.id)}">出呢張</button><div style="height:10px"></div>` : ""}
      <button class="btn ${ins.canPlay ? "btn-ghost" : "btn-gold"}" data-act="close-inspect">知道喇</button>
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
        <div class="join-row">
          <input id="code-input" maxlength="6" placeholder="房號" value="${escapeHtml(prefill)}" autocapitalize="characters" autocomplete="off" />
          <button class="btn btn-ghost" data-act="join">加入</button>
        </div>
        <p class="home-hint">開房之後把房號或連結傳俾朋友，佢哋輸入同一個號就可以一齊玩。第一次玩可以先睇遊戲規則。</p>
        <div class="error-line">${escapeHtml(state.error)}</div>
      </div>
      <div>
        <button class="btn-text" data-act="rules">遊戲規則</button>
        <div class="footer-note">基本規則 · 八爪魚同白鯨 · 10 局 · 暫時唔包括贓物牌</div>
        ${location.hostname === "localhost" || location.hostname === "127.0.0.1" ? lan : ""}
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
        <button class="btn-text" data-act="rules">規則</button>
      </div>
      <div class="code-hero">
        <div class="label">房號</div>
        <div class="code">${escapeHtml(v.code)}</div>
        <div class="code-actions">
          <button class="btn btn-gold" data-act="copy-code">複製房號</button>
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
    ${toastHTML()}
  `;
}

function signed(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}


function playerSeatStatus(p, v) {
  const bidding = v.phase === "bidding";
  let st;
  if (bidding) st = p.hasBid ? "已叫牌" : "考慮緊…";
  else if (v.bidsRevealed) st = `叫 ${p.bid} · 贏 ${p.tricksWon}`;
  else st = `${p.handCount} 張`;
  if (!p.isAI && v.lobbyPlayers) {
    const h = v.lobbyPlayers.find((x) => x.id === p.id);
    if (h && !h.connected) st = "已斷線";
  }
  return st;
}

function isPlayerThinking(p, v) {
  if (v.phase === "bidding") return !p.hasBid;
  return !!p.isTurn;
}

function tableArrowsSVG() {
  const cx = 50;
  const cy = 50;
  const rx = 41;
  const ry = 37;
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

function circleTableHTML(v) {
  const players = v.players || [];
  const n = Math.max(players.length, 1);
  const found = players.findIndex((p) => p.id === v.yourId);
  const myIndex = found >= 0 ? found : 0;
  const bidding = v.phase === "bidding";
  const destroyed = v.phase === "trickResult" && v.lastTrickDestroyed;
  const trickByPlayer = new Map((v.trick || []).map((played) => [played.playerIndex, played]));
  const rx = n === 2 ? 0 : n >= 6 ? 39 : 40;
  const ry = n === 2 ? 36 : n >= 5 ? 35 : 36;

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
    const card = played
      ? `<button class="seat-card ${win ? "winner" : ""} ${destroyed ? "voided" : ""}" data-act="inspect" data-id="${escapeHtml(played.card.id)}" aria-label="睇呢張牌">
           ${cardFaceHTML(played.card, { tigressAsPirate: played.tigressAsPirate, compact: true })}
           ${win ? `<div class="seat-win">贏</div>` : ""}
         </button>`
      : `<div class="seat-card empty"><div class="card-slot" aria-hidden="true"></div></div>`;
    return `<div class="seat ${thinking ? "thinking" : ""} ${isMe ? "is-me" : ""} ${win ? "winner" : ""} ${p.isAI ? "ai-seat" : ""}"
      style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--rot:${rot}deg;z-index:${thinking ? 6 : 2}">
      ${card}
      <div class="seat-info">
        <div class="avatar ${thinking ? "gold" : p.isAI ? "ai" : ""}">${escapeHtml(p.name.slice(0, 1))}</div>
        <div class="nm">${escapeHtml(p.name)}${isMe ? "（你）" : ""}</div>
        <div class="st">${escapeHtml(st)}</div>
        <div class="sc">${p.score} 分</div>
        ${thinking ? `<div class="seat-thinking">諗緊</div>` : ""}
      </div>
    </div>`;
  }).join("");

  let center = "";
  if (destroyed) center = `<div class="table-center void">呢墩作廢，無人贏</div>`;
  else if (!(v.trick || []).length && bidding) center = `<div class="table-center dim">叫牌中<br /><span class="arrow-hint">順時針出牌</span></div>`;
  else if (!(v.trick || []).length) center = `<div class="table-center dim">呢墩尚未出牌<br /><span class="arrow-hint">順時針出牌</span></div>`;
  else center = `<div class="table-center dim"><span class="arrow-hint">順時針</span></div>`;

  return `<div class="circle-wrap">
    <div class="circle-table n-${n} ${destroyed ? "destroyed" : ""}" role="group" aria-label="牌桌，出牌順序順時針">
      <div class="table-felt">${tableArrowsSVG()}${center}</div>
      ${seats}
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
      return `<button class="${on}" data-act="bid-pick" data-n="${i}">${i}</button>`;
    }).join("");
    bidPanel = `<div class="bid-panel">
      <h3>${alreadyBid ? "已叫牌，等其他人" : "你估會贏幾墩？"}</h3>
      <p>${alreadyBid ? `你叫咗 ${myBid} 墩。等其他人一齊叫完先揭曉。` : `睇完手牌先叫，可以叫 0 到 ${n}。其他人叫咩要等齊先睇到。`}</p>
      ${alreadyBid ? "" : `<p class="bid-hint">${escapeHtml(bidHint(n, state.bidValue))}</p>
        <div class="bid-grid">${btns}</div>
        <button class="btn btn-gold" data-act="bid-submit" ${state.bidValue == null ? "disabled" : ""}>${state.bidValue == null ? "請先揀叫幾多墩" : `確定叫 ${state.bidValue} 墩`}</button>`}
    </div>`;
  }

  const legal = new Set(v.legalCardIds || []);
  const canPlay = v.isMyTurn && v.phase === "playing";
  const handCards = v.myHand || [];
  const overlap = handOverlap(handCards.length);
  const hand = `<div class="hand">${handCards
    .map((c, i) => {
      const isLegal = canPlay && legal.has(c.id);
      const dim = canPlay && !legal.has(c.id);
      const why = !isLegal ? cardPlayWhy(c, v) : "";
      const style = `style="margin-right:${i === handCards.length - 1 ? 0 : overlap}px;z-index:${i}"`;
      const inner = cardFaceHTML(c, { dimmed: dim });
      const info = c.special
        ? `<button class="card-info" data-act="inspect" data-id="${escapeHtml(c.id)}" aria-label="睇牌義">?</button>`
        : "";
      if (isLegal) {
        return `<div class="sk-wrap" ${style}>
          <button class="sk-play" data-act="play-card" data-id="${escapeHtml(c.id)}">${inner.replace("sk-card ", "sk-card legal ")}</button>
          ${info}
        </div>`;
      }
      return `<div class="sk-wrap inspect-only" ${style}>
        <button class="sk-play" data-act="inspect" data-id="${escapeHtml(c.id)}" data-why="${escapeHtml(why)}">${inner}</button>
        ${info}
      </div>`;
    })
    .join("")}</div>`;

  const skipTrick = v.phase === "trickResult"
    ? `<div class="next-trick"><button class="btn btn-ghost" data-act="continue">下一墩</button></div>`
    : "";

  let turnBanner = "";
  if (bidding && !alreadyBid) {
    turnBanner = `<div class="turn-banner mine">輪到你叫牌。睇完手牌，估呢局會贏幾墩。</div>`;
  } else if (v.phase === "playing" && v.isMyTurn) {
    turnBanner = `<div class="turn-banner mine">輪到你出牌。${v.ledSuit ? `有${suitLabel(v.ledSuit)}就要跟，` : ""}特殊牌隨時可出。</div>`;
  } else if (v.phase === "playing" || v.phase === "choosingTigress") {
    const cur = (v.players || [])[v.currentPlayerIndex];
    turnBanner = `<div class="turn-banner wait">等${escapeHtml(cur?.name || "對手")}出牌…</div>`;
  } else if (v.phase === "trickResult") {
    turnBanner = `<div class="turn-banner result">${escapeHtml(v.statusMessage || "")}</div>`;
  }

  const follow = v.followHint && (v.phase === "playing" || v.phase === "choosingTigress" || v.phase === "trickResult")
    ? `<div class="follow-hint">${escapeHtml(v.followHint)}</div>`
    : "";

  return `
    ${bannerHTML()}
    <div class="screen table-screen">
      <div class="table-header">
        <button class="btn-text" data-act="leave">離開</button>
        <div class="center">
          <div class="round">第 ${v.round} 局／10</div>
          <div class="sub">各 ${v.cardsDealt} 張</div>
        </div>
        <div class="header-actions">
          <button class="btn-text" data-act="card-legend">牌義</button>
          <button class="btn-text" data-act="rules">規則</button>
        </div>
      </div>
      ${circleTableHTML(v)}
      ${follow}
      <div class="status">${escapeHtml(v.statusMessage || "")}</div>
      ${skipTrick}
      <div class="error-line">${escapeHtml(state.error)}</div>
      ${bidPanel}
      ${turnBanner}
      ${hand}
    </div>
    ${v.pendingTigress ? tigressHTML() : ""}
    ${v.phase === "roundResult" || v.phase === "gameOver" ? scoreHTML(v) : ""}
    ${inspectHTML()}
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
  return Math.max(overlap, -(card - 28));
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
      <button class="btn-text" data-act="tig-cancel" style="width:100%;color:var(--ink-soft)">取消，換第二張</button>
    </div>
  </div>`;
}

function scoreHTML(v) {
  const latest = v.scores?.[v.scores.length - 1];
  const over = v.phase === "gameOver";
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
    mineSummary = `<p class="score-summary">你叫 ${meRow.bid} 贏 ${meRow.taken}，${made ? "估中" : "估錯"} ${signed(meRow.bidPoints)} 分${meRow.bonus ? `，獎勵 +${meRow.bonus}` : ""}，本局 ${signed(meRow.roundTotal)}，而家總分 ${meRow.runningTotal}。</p>`;
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
      ${over ? `<p>${escapeHtml(v.statusMessage || "")}</p>` : ""}
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
