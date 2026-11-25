import { cardFaceHTML, cardBackHTML, iconSVG, escapeHtml } from "./cards.js";

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
  bidValue: 0,
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
      if (prevRound && msg.round !== prevRound) state.bidValue = 0;
      if (msg.phase === "bidding" && state.bidValue > msg.cardsDealt) state.bidValue = 0;
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

function tryResume() {
  const code = pathCode() || localStorage.getItem(ROOM_KEY) || "";
  if (pathCode()) state.joinCode = pathCode();
  if (state.token && code) {
    state.code = code;
    connect({
      onOpen() {
        send({ type: "reconnect", token: state.token });
      },
    });
  }
}

// Event delegation
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  const view = state.view;
  if (act === "create") createRoom();
  else if (act === "join") joinRoom();
  else if (act === "rules") openRules();
  else if (act === "close-rules") closeRules();
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
  else if (act === "bid-submit") send({ type: "bid", value: state.bidValue });
  else if (act === "play-card") {
    const id = t.dataset.id;
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
  else if (e.target.id === "name-input" && state.screen === "home") createRoom();
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

function renderHome() {
  const prefill = state.joinCode || pathCode();
  const lan = state.lanUrls.length
    ? `<div class="lan-box">同一 Wi-Fi 嘅電話請打開：${state.lanUrls.map((u) => `<code>${escapeHtml(u)}</code>`).join("")}</div>`
    : "";
  return `
    ${bannerHTML()}
    <div class="screen home">
      <div class="brand">
        <div class="brand-mark">${iconSVG("skullKing")}</div>
        <h1>骷髏王</h1>
        <div class="en">Skull King</div>
      </div>
      <div class="home-card">
        <label class="field-label" for="name-input">你嘅名</label>
        <input id="name-input" maxlength="12" placeholder="你" value="${escapeHtml(state.name)}" autocomplete="nickname" />
        <div style="height:14px"></div>
        <button class="btn btn-gold" data-act="create">開房</button>
        <div class="or-row">或者加入</div>
        <div class="join-row">
          <input id="code-input" maxlength="6" placeholder="房號" value="${escapeHtml(prefill)}" autocapitalize="characters" autocomplete="off" />
          <button class="btn btn-ghost" data-act="join">加入</button>
        </div>
        <div class="error-line">${escapeHtml(state.error)}</div>
      </div>
      <div>
        <button class="btn-text" data-act="rules">遊戲規則</button>
        <div class="footer-note">基本規則 · 10 局 · 暫時唔包括 Kraken、白鯨同贓物牌</div>
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
        ${!host ? `<button class="btn ${me?.ready ? "btn-ghost" : "btn-gold"}" data-act="ready" data-on="${me?.ready ? "1" : "0"}">${me?.ready ? "取消準備" : "準備好"}</button>` : ""}
        ${host ? `<button class="btn btn-gold" data-act="start" ${canStart ? "" : "disabled"}>開始遊戲</button>` : `<div class="footer-note">等房主開始遊戲</div>`}
      </div>
    </div>
    ${toastHTML()}
  `;
}

function signed(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

function renderTable() {
  const v = state.view;
  if (!v) return renderHome();
  const me = v.players?.find((p) => p.id === v.yourId);
  const others = (v.players || []).filter((p) => p.id !== v.yourId);
  const bidding = v.phase === "bidding";
  const myBid = me?.bid;
  const alreadyBid = bidding && me?.hasBid;

  const opp = others
    .map((p) => {
      let st;
      if (bidding) st = p.hasBid ? "已叫牌" : "考慮緊…";
      else if (v.bidsRevealed) st = `叫 ${p.bid} · 贏 ${p.tricksWon}`;
      else st = `${p.handCount} 張`;
      if (!p.isAI && v.lobbyPlayers) {
        const h = v.lobbyPlayers.find((x) => x.id === p.id);
        if (h && !h.connected) st = "已斷線";
      }
      return `<div class="opp ${p.isTurn ? "turn" : ""}">
        <div class="avatar ${p.isTurn ? "gold" : p.isAI ? "ai" : ""}" style="margin:0 auto 4px">${escapeHtml(p.name.slice(0, 1))}</div>
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="st">${escapeHtml(st)}</div>
        <div class="sc">${p.score} 分</div>
      </div>`;
    })
    .join("");

  const trickCards = v.trick || [];
  const trick = trickCards.length
    ? `<div class="trick-row">${trickCards
        .map((p) => {
          const win = v.phase === "trickResult" && p.playerIndex === v.lastWinnerIndex;
          return `<div class="trick-item ${win ? "winner" : ""}">
            ${cardFaceHTML(p.card, { tigressAsPirate: p.tigressAsPirate, compact: trickCards.length > 4 })}
            <div class="who">${escapeHtml(p.playerName || "")}${win ? " · 贏" : ""}</div>
          </div>`;
        })
        .join("")}</div>`
    : `<div class="trick-empty">呢墩尚未出牌</div>`;

  let bidPanel = "";
  if (bidding) {
    const n = v.cardsDealt;
    const btns = Array.from({ length: n + 1 }, (_, i) => {
      const on = state.bidValue === i ? "on" : "";
      return `<button class="${on}" data-act="bid-pick" data-n="${i}">${i}</button>`;
    }).join("");
    bidPanel = `<div class="bid-panel">
      <h3>${alreadyBid ? "已叫牌，等其他人" : "你叫幾多墩？"}</h3>
      <p>${alreadyBid ? `你叫咗 ${myBid} 墩。` : `睇完手牌再叫，可以叫 0 到 ${n}。`}</p>
      ${alreadyBid ? "" : `<div class="bid-grid">${btns}</div>
        <button class="btn btn-gold" data-act="bid-submit">確定叫 ${state.bidValue} 墩</button>`}
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
      const style = `style="margin-right:${i === handCards.length - 1 ? 0 : overlap}px;z-index:${i}"`;
      const inner = cardFaceHTML(c, { dimmed: dim });
      if (isLegal) {
        return `<button class="sk-wrap" data-act="play-card" data-id="${escapeHtml(c.id)}" ${style}>${inner.replace("sk-card ", "sk-card legal ")}</button>`;
      }
      return `<div ${style}>${inner}</div>`;
    })
    .join("")}</div>`;

  const meDetail = !bidding && me && v.bidsRevealed
    ? `<div class="detail">叫 ${me.bid} 墩 · 已贏 ${me.tricksWon}</div>`
    : bidding && me?.hasBid
      ? `<div class="detail">已叫 ${me.bid} 墩</div>`
      : "";

  const skipTrick = v.phase === "trickResult"
    ? `<div style="text-align:center;margin-top:-4px"><button class="btn-text" data-act="continue">跳過動畫</button></div>`
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
        <button class="btn-text" data-act="rules">規則</button>
      </div>
      <div class="opponents">${opp}</div>
      <div class="trick-area">${trick}</div>
      <div class="status">${escapeHtml(v.statusMessage || "")}</div>
      ${skipTrick}
      <div class="error-line">${escapeHtml(state.error)}</div>
      ${bidPanel}
      <div class="me-row">
        <div>
          <div class="who">${escapeHtml(me?.name || "你")}</div>
          ${meDetail}
        </div>
        <div class="score">${me?.score ?? 0} 分</div>
      </div>
      ${hand}
    </div>
    ${v.pendingTigress ? tigressHTML() : ""}
    ${v.phase === "roundResult" || v.phase === "gameOver" ? scoreHTML(v) : ""}
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
      <h2>母老虎當咩出？</h2>
      <p>當海盜就可以搶墩；當逃脫就盡量唔贏墩。</p>
      <button class="btn btn-gold" data-act="tig-pirate">當海盜</button>
      <div style="height:10px"></div>
      <button class="btn btn-ink" data-act="tig-escape">當逃脫</button>
      <div style="height:8px"></div>
      <button class="btn-text" data-act="tig-cancel" style="width:100%;color:var(--ink-soft)">取消</button>
    </div>
  </div>`;
}

function scoreHTML(v) {
  const latest = v.scores?.[v.scores.length - 1];
  const over = v.phase === "gameOver";
  const rows = (latest?.rows || [])
    .map((r) => `<tr>
      <td>${escapeHtml(r.playerName)}</td>
      <td>${r.bid}／${r.taken}</td>
      <td class="${r.bidPoints < 0 ? "neg" : r.bidPoints > 0 ? "pos" : ""}">${signed(r.bidPoints)}</td>
      <td>${r.bonus === 0 ? "–" : "+" + r.bonus}</td>
      <td class="${r.roundTotal < 0 ? "neg" : r.roundTotal > 0 ? "pos" : ""}">${signed(r.roundTotal)}</td>
      <td><strong>${r.runningTotal}</strong></td>
    </tr>`)
    .join("");
  const hostBtns = v.youAreHost
    ? `<div class="actions">
        <button class="btn btn-ink" data-act="back-lobby">返回大廳</button>
        <button class="btn btn-gold" data-act="play-again">再嚟一場</button>
      </div>`
    : `<p>等房主決定再開一場定返回大廳。</p>`;
  const nextLabel = v.round >= 10 ? "睇總分" : "下一局";
  return `<div class="overlay center">
    <div class="sheet">
      <h2>${over ? "最終分數" : `第 ${v.round} 局結果`}</h2>
      ${over ? `<p>${escapeHtml(v.statusMessage || "")}</p>` : ""}
      <div class="score-wrap">
        <table class="score-table">
          <thead><tr><th>玩家</th><th>叫／贏</th><th>叫牌分</th><th>獎勵</th><th>本局</th><th>總分</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${over ? hostBtns : `<button class="btn btn-gold" data-act="continue">${nextLabel}</button>`}
    </div>
  </div>`;
}

function renderRules() {
  return `
    ${bannerHTML()}
    <div class="screen">
      <div class="topbar">
        <button class="btn-text" data-act="close-rules">返回</button>
        <h2>規則</h2>
        <span></span>
      </div>
      <div class="rules-page" style="color:var(--cream)">
        <h2 style="color:var(--gold-soft);margin:0 0 12px">骷髏王規則</h2>
        <h3 style="color:var(--gold)">點玩</h3>
        <p>一共 10 局。第 1 局每人 1 張，之後每局多一張，第 10 局各 10 張。睇完手牌之後，大家一齊叫會贏幾墩（其他人嘅叫牌要等齊先睇到）。估中先有分，估錯就扣分。</p>
        <h3 style="color:var(--gold)">出牌</h3>
        <p>第一張有花色嘅牌決定呢墩要跟嘅花。如果你出數字牌，有嗰種花就要跟。逃脫、海盜、人魚、母老虎同骷髏王隨時都可以出，唔使跟花。黑色骷髏旗係王牌，大過其他三種顏色嘅數字牌。</p>
        <p>如果第一張係逃脫或「母老虎當逃脫」，之後第一張數字牌先定花。如果第一張係人魚、海盜、骷髏王或「母老虎當海盜」，呢墩就冇得跟花，各人可以出任何牌。</p>
        <h3 style="color:var(--gold)">誰贏呢墩</h3>
        <p>人魚可以捕獲骷髏王。骷髏王大過海盜。海盜大過人魚同所有數字牌。幾個海盜或者兩條人魚一齊出現，先出嗰張贏。如果人魚、海盜同骷髏王同時出現，一定係人魚贏，而且只計人魚捕骷髏王嘅獎勵。全部都係逃脫，就由先出嗰個人贏。出母老虎時要即時宣布當海盜定逃脫。</p>
        <h3 style="color:var(--gold)">計分</h3>
        <p>叫 1 墩或以上而且估中：每墩 20 分。估錯：差幾墩就扣 10 分乘相差。叫 0 而且真係一墩都唔贏：10 分乘呢局張數；一旦贏咗墩，就要扣同樣分數。獎勵分只會喺估中叫牌時先計：普通 14 各 +10，黑色 14 +20（誰出都係贏墩嗰個人收）；海盜捕人魚每條 +20；骷髏王捕海盜每個 +30；人魚捕骷髏王 +40。</p>
        <h3 style="color:var(--gold)">呢個版本</h3>
        <p>用 2021 年起 Grand Prix 基本規則。牌組 70 張：黃寶藏箱、綠鸚鵡、紫海盜地圖、黑骷髏旗各 1–14，再加 5 張逃脫、5 張海盜、2 條人魚、1 張母老虎同 1 張骷髏王。2 至 6 人，莊家輪流，莊家左邊先出第一墩。暫時唔包括擴充牌：Kraken、白鯨同贓物牌。</p>
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
