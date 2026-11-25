import { randomBytes } from "node:crypto";
import { Game, PHASE } from "./game.js";
import { AI_NAMES } from "./ai.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 20 * 60 * 1000;
const TRICK_PAUSE_MS = 2800;
const AI_PAUSE_MS = 700;

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.tokenToRoom = new Map();
    this._janitor = setInterval(() => this.cleanup(), 60 * 1000);
    if (this._janitor.unref) this._janitor.unref();
  }

  createRoom({ name }) {
    const code = this._uniqueCode();
    const room = {
      code,
      hostId: null,
      seats: 5,
      aiFill: true,
      humans: [],
      game: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      timer: null,
      continuing: new Set(),
    };
    const player = this._addHuman(room, name, true);
    room.hostId = player.id;
    this.rooms.set(code, room);
    this.touch(room);
    return { room, player };
  }

  joinRoom({ code, name, token }) {
    const room = this.rooms.get(this._norm(code));
    if (!room) return { error: "房號唔啱，或者房間已經散咗。" };
    if (token) {
      const existing = room.humans.find((h) => h.token === token);
      if (existing) return { room, player: existing, reconnected: true };
    }
    if (room.game) return { error: "呢場已經開咗局，得返原班人可以重新入去。" };
    if (room.humans.length >= room.seats) return { error: "房間已滿。" };
    const player = this._addHuman(room, name, false);
    this.touch(room);
    return { room, player };
  }

  reconnect(token) {
    const code = this.tokenToRoom.get(token);
    if (!code) return { error: "找不到之前嘅座位，試下重新加入。" };
    const room = this.rooms.get(code);
    if (!room) {
      this.tokenToRoom.delete(token);
      return { error: "房間已經散咗。" };
    }
    const player = room.humans.find((h) => h.token === token);
    if (!player) return { error: "找不到之前嘅座位，試下重新加入。" };
    this.touch(room);
    return { room, player, reconnected: true };
  }

  leave(room, playerId, { dropSeat = false } = {}) {
    const human = room.humans.find((h) => h.id === playerId);
    if (!human) return;
    human.connected = false;
    human.ws = null;
    if (!room.game && dropSeat) {
      room.humans = room.humans.filter((h) => h.id !== playerId);
      this.tokenToRoom.delete(human.token);
      if (room.hostId === playerId) {
        room.hostId = room.humans[0]?.id ?? null;
      }
    }
    this.touch(room);
    if (!room.humans.length || room.humans.every((h) => !h.connected)) {
      room.emptySince = Date.now();
    }
    if (room.game && room.game.phase === PHASE.ROUND_RESULT) {
      this._maybeAdvanceContinue(room);
    }
  }

  attachSocket(player, ws) {
    player.ws = ws;
    player.connected = true;
    player.emptySince = null;
  }

  setSeats(room, playerId, count) {
    if (room.game) return { error: "開咗局就不能改人數。" };
    if (room.hostId !== playerId) return { error: "得房主可以改人數。" };
    const n = Number(count);
    if (!Number.isInteger(n) || n < 2 || n > 6) return { error: "玩家人數要係 2 至 6 人。" };
    if (n < room.humans.length) return { error: `而家已經有 ${room.humans.length} 個人，不能再減。` };
    room.seats = n;
    this.touch(room);
    return { ok: true };
  }

  setAiFill(room, playerId, enabled) {
    if (room.game) return { error: "開咗局就不能改。" };
    if (room.hostId !== playerId) return { error: "得房主可以改呢個設定。" };
    room.aiFill = !!enabled;
    this.touch(room);
    return { ok: true };
  }

  setName(room, playerId, name) {
    const human = room.humans.find((h) => h.id === playerId);
    if (!human) return { error: "找不到呢位玩家。" };
    if (room.game && room.game.phase !== PHASE.BIDDING && room.game.round > 1) {
      // allow rename anytime in lobby; mid-game also ok for typo fixes
    }
    const cleaned = cleanName(name, human.name);
    if (room.humans.some((h) => h.id !== playerId && h.name === cleaned)) {
      return { error: "呢個名已經有人用咗。" };
    }
    human.name = cleaned;
    if (room.game) {
      const gp = room.game.players.find((p) => p.id === playerId);
      if (gp) gp.name = cleaned;
    }
    this.touch(room);
    return { ok: true };
  }

  setReady(room, playerId, ready) {
    if (room.game) return { error: "遊戲已經開始。" };
    const human = room.humans.find((h) => h.id === playerId);
    if (!human) return { error: "找不到呢位玩家。" };
    human.ready = !!ready;
    this.touch(room);
    return { ok: true };
  }

  startGame(room, playerId) {
    if (room.hostId !== playerId) return { error: "得房主可以開始遊戲。" };
    if (room.game && room.game.phase !== PHASE.GAME_OVER) {
      return { error: "遊戲已經開始。" };
    }
    const others = room.humans.filter((h) => h.id !== playerId);
    if (others.some((h) => !h.ready)) {
      const waiting = others.filter((h) => !h.ready).map((h) => h.name);
      return { error: `仲等緊 ${waiting.join("、")} 準備好。` };
    }
    const humans = room.humans;
    let seats = [];
    for (const h of humans) seats.push({ id: h.id, name: h.name, isAI: false });
    if (room.aiFill) {
      let aiIndex = 0;
      while (seats.length < room.seats && aiIndex < AI_NAMES.length) {
        seats.push({
          id: `ai-${room.code}-${aiIndex}`,
          name: AI_NAMES[aiIndex],
          isAI: true,
        });
        aiIndex++;
      }
    }
    if (seats.length < 2) return { error: "至少要兩個人先開得（可以加電腦補位）。" };
    if (seats.length > 6) return { error: "最多六個人。" };
    room.game = new Game(seats);
    room.game.start();
    room.continuing = new Set();
    this.touch(room);
    this.schedule(room);
    return { ok: true };
  }

  backToLobby(room, playerId) {
    if (room.hostId !== playerId) return { error: "得房主可以返回大廳。" };
    if (!room.game) return { error: "已經喺大廳。" };
    if (room.game.phase !== "gameOver") return { error: "打完先可以返回大廳。" };
    this._clearTimer(room);
    room.game = null;
    room.continuing = new Set();
    for (const h of room.humans) h.ready = false;
    this.touch(room);
    return { ok: true };
  }

  playAgain(room, playerId) {
    if (!room.game || room.game.phase !== PHASE.GAME_OVER) {
      return { error: "要打完先可以再嚟一場。" };
    }
    if (room.hostId !== playerId) return { error: "得房主可以再開一場。" };
    // Keep the same lineup (humans + the AI that were seated).
    room.game.playAgain();
    room.continuing = new Set();
    this.touch(room);
    this.schedule(room);
    return { ok: true };
  }

  bid(room, playerId, value) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    const result = room.game.submitBid(playerId, value);
    if (result.error) return result;
    this.touch(room);
    this.schedule(room);
    return result;
  }

  play(room, playerId, cardId, tigressAsPirate) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    const result = room.game.playCard(playerId, cardId, tigressAsPirate);
    if (result.error) return result;
    this.touch(room);
    this.schedule(room);
    return result;
  }

  resolveTigress(room, playerId, asPirate) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    const result = room.game.resolveTigress(playerId, asPirate);
    if (result.error) return result;
    this.touch(room);
    this.schedule(room);
    return result;
  }

  cancelTigress(room, playerId) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    const result = room.game.cancelTigress(playerId);
    if (result.error) return result;
    this.touch(room);
    return result;
  }

  continueRound(room, playerId) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    if (room.game.phase === PHASE.TRICK_RESULT) {
      this._clearTimer(room);
      const result = room.game.advanceTrickResult();
      if (result.error) return result;
      this.touch(room);
      this.schedule(room);
      return result;
    }
    if (room.game.phase !== PHASE.ROUND_RESULT) return { error: "而家唔使繼續。" };
    if (!room.continuing) room.continuing = new Set();
    room.continuing.add(playerId);
    this.touch(room);
    return this._maybeAdvanceContinue(room);
  }

  _connectedHumanIds(room) {
    return room.humans.filter((h) => h.connected).map((h) => h.id);
  }

  _maybeAdvanceContinue(room) {
    if (!room.game || room.game.phase !== PHASE.ROUND_RESULT) return { ok: true, waiting: true };
    if (!room.continuing) room.continuing = new Set();
    const needed = this._connectedHumanIds(room);
    if (needed.length && !needed.every((id) => room.continuing.has(id))) {
      return { ok: true, waiting: true };
    }
    this._clearTimer(room);
    const result = room.game.continueAfterRound();
    if (result.error) return result;
    room.continuing = new Set();
    this.touch(room);
    this.schedule(room);
    return result;
  }

  schedule(room) {
    this._clearTimer(room);
    const game = room.game;
    if (!game) return;
    if (game.phase === PHASE.TRICK_RESULT) {
      room.timer = setTimeout(() => {
        if (!room.game || room.game.phase !== PHASE.TRICK_RESULT) return;
        room.game.advanceTrickResult();
        this.broadcast(room);
        this.schedule(room);
      }, TRICK_PAUSE_MS);
      return;
    }
    if (game.phase === PHASE.PLAYING) {
      const current = game.players[game.currentPlayerIndex];
      if (current?.isAI) {
        room.timer = setTimeout(() => {
          if (!room.game || room.game.phase !== PHASE.PLAYING) return;
          room.game.stepAI();
          this.broadcast(room);
          this.schedule(room);
        }, AI_PAUSE_MS);
      }
    }
  }

  viewFor(room, playerId) {
    const base = {
      code: room.code,
      hostId: room.hostId,
      seats: room.seats,
      aiFill: room.aiFill,
      youAreHost: room.hostId === playerId,
      yourId: playerId,
      lobbyPlayers: room.humans.map((h) => ({
        id: h.id,
        name: h.name,
        ready: h.ready,
        connected: h.connected,
        isHost: h.id === room.hostId,
      })),
      inGame: !!room.game,
    };
    if (!room.game) {
      const filled = room.aiFill ? room.seats : room.humans.length;
      const aiCount = room.aiFill ? Math.max(0, room.seats - room.humans.length) : 0;
      return {
        ...base,
        phase: "lobby",
        statusMessage: this._lobbyStatus(room, aiCount, filled),
        previewAI: AI_NAMES.slice(0, aiCount).map((name, i) => ({
          id: `preview-ai-${i}`,
          name,
          isAI: true,
        })),
      };
    }
    return { ...base, ...room.game.viewFor(playerId), ...this._continueView(room) };
  }

  _continueView(room) {
    const inResult = room.game && room.game.phase === PHASE.ROUND_RESULT;
    if (!inResult) {
      return { continueReady: [], continueNeeded: [], continueWaitingNames: [] };
    }
    const needed = room.humans.filter((h) => h.connected);
    const ready = room.continuing || new Set();
    return {
      continueReady: needed.filter((h) => ready.has(h.id)).map((h) => h.id),
      continueNeeded: needed.map((h) => h.id),
      continueWaitingNames: needed.filter((h) => !ready.has(h.id)).map((h) => h.name),
    };
  }

  _lobbyStatus(room, aiCount) {
    const n = room.humans.length;
    const bits = [`${n} 個人已加入`];
    if (room.aiFill && aiCount > 0) bits.push(`開始後會加 ${aiCount} 個電腦（${AI_NAMES.slice(0, aiCount).join("、")}）`);
    else if (!room.aiFill && n < 2) bits.push("至少再等多一個人，或者開電腦補位");
    return bits.join("。") + "。";
  }

  broadcast(room, extraByPlayer = {}) {
    for (const human of room.humans) {
      if (!human.ws || human.ws.readyState !== 1) continue;
      const view = this.viewFor(room, human.id);
      const extra = extraByPlayer[human.id] || {};
      try {
        human.ws.send(JSON.stringify({ type: "state", ...view, ...extra }));
      } catch {
        // ignore broken sockets; heartbeat / close will clean up
      }
    }
  }

  sendError(ws, message) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "error", message }));
  }

  send(ws, payload) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  touch(room) {
    room.lastActivity = Date.now();
    room.emptySince = room.humans.some((h) => h.connected) ? null : room.emptySince ?? Date.now();
  }

  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActivity > ROOM_TTL_MS;
      const empty =
        room.humans.every((h) => !h.connected) &&
        room.emptySince &&
        now - room.emptySince > EMPTY_TTL_MS;
      if (idle || empty) {
        this._clearTimer(room);
        for (const h of room.humans) this.tokenToRoom.delete(h.token);
        this.rooms.delete(code);
      }
    }
  }

  _addHuman(room, name, isFirst) {
    const used = new Set(room.humans.map((h) => h.name));
    const cleaned = uniqueName(cleanName(name, isFirst || !room.humans.length ? "你" : "玩家"), used);
    const player = {
      id: randomBytes(8).toString("hex"),
      token: randomBytes(24).toString("base64url"),
      name: cleaned,
      ready: false,
      connected: false,
      ws: null,
    };
    room.humans.push(player);
    this.tokenToRoom.set(player.token, room.code);
    return player;
  }

  _uniqueCode() {
    for (let len = 4; len <= 6; len++) {
      for (let attempt = 0; attempt < 32; attempt++) {
        let code = "";
        const bytes = randomBytes(len);
        for (let i = 0; i < len; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
        if (!this.rooms.has(code)) return code;
      }
    }
    throw new Error("無法產生房號");
  }

  _norm(code) {
    return String(code || "").trim().toUpperCase();
  }

  _clearTimer(room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }
}

export function cleanName(name, fallback = "你") {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 12);
  return trimmed || fallback;
}

function uniqueName(base, used) {
  if (!used.has(base)) return base;
  for (let i = 2; i < 50; i++) {
    const n = `${base}${i}`;
    if (!used.has(n)) return n;
  }
  return `${base}-${randomBytes(2).toString("hex")}`;
}
