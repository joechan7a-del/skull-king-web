import { randomBytes } from "node:crypto";
import { Game, PHASE } from "./game.js";

import { pickAINames } from "./ai.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 20 * 60 * 1000;
const TRICK_PAUSE_MS = 4000; // time to read the explanation after it appears; do not shorten
const AI_PAUSE_MS = 1200; // plays only (bids stay immediate); easier to follow, not sluggish
/** Time for the match-start “who leads first” draw before an AI may play. */
export const OPENING_DRAW_MS = 1100;
/** Look-at-the-completed-trick beat before the winner/void overlay. Mid of the requested 1.5–2s. */
export const TRICK_REVIEW_MS = 1800;
/** Matches the client flourish banner length in public/app.js (maybeSpecialFlourish). */
export const FLOURISH_HOLD_MS = 1050;

const FLOURISH_SPECIALS = new Set(["mermaid", "pirate", "skullKing", "kraken", "whiteWhale"]);

export function playHasFlourish(played) {
  if (!played?.card) return false;
  if (played.card.special === "tigress") return played.tigressAsPirate === true;
  return FLOURISH_SPECIALS.has(played.card.special);
}

export function trickReviewDelayMs(game) {
  const trick = game?.lastTrick || [];
  const last = trick[trick.length - 1];
  return (playHasFlourish(last) ? FLOURISH_HOLD_MS : 0) + TRICK_REVIEW_MS;
}

export { TRICK_PAUSE_MS, AI_PAUSE_MS };

export class RoomManager {
  constructor({ rng } = {}) {
    this.rng = typeof rng === "function" ? rng : Math.random;
    this.rooms = new Map();
    this.tokenToRoom = new Map();
    this._janitor = setInterval(() => this.cleanup(), 60 * 1000);
    if (this._janitor.unref) this._janitor.unref();
  }

  createRoom({ name } = {}) {
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
      trickExplanationShown: false,
      abilityPromptShown: false,
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
    if (n === 5) {
      room.seats = 5;
      this.touch(room);
      return { ok: true };
    }
    return { error: "呢個玩法只開五人桌。" };
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
      const need = Math.max(0, room.seats - seats.length);
      const names = pickAINames(need, seats.map((s) => s.name), this.rng);
      for (let aiIndex = 0; aiIndex < names.length; aiIndex++) {
        seats.push({
          id: `ai-${room.code}-${aiIndex}`,
          name: names[aiIndex],
          isAI: true,
        });
      }
    }
    if (seats.length < 2) return { error: "至少要兩個人先開得（可以加電腦補位）。" };
    if (seats.length > 6) return { error: "最多六個人。" };
    room.game = new Game(seats, { rng: this.rng });
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
    // Same seats and colors; draw a fresh AI name set for the new match.
    const reserved = room.game.players.filter((p) => !p.isAI).map((p) => p.name);
    const ais = room.game.players.filter((p) => p.isAI);
    const names = pickAINames(ais.length, reserved, this.rng);
    ais.forEach((p, i) => { p.name = names[i]; });
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
    const prev = room.game.phase;
    const result = room.game.playCard(playerId, cardId, tigressAsPirate);
    if (result.error) return result;
    this._syncTrickExplanation(room, prev);
    this.touch(room);
    this.schedule(room);
    return result;
  }

  resolveTigress(room, playerId, asPirate) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    const prev = room.game.phase;
    const result = room.game.resolveTigress(playerId, asPirate);
    if (result.error) return result;
    this._syncTrickExplanation(room, prev);
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

  usePirateAbility(room, playerId, choice = {}) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    if (room.game.pendingAbility && !room.abilityPromptShown) {
      return { error: "請先睇完呢個回合結果。" };
    }
    const result = room.game.usePirateAbility(playerId, choice);
    if (result.error) return result;
    this.touch(room);
    if (!room.game.pendingAbility && room.game.phase === PHASE.TRICK_RESULT && room.abilityPromptShown) {
      this._clearTimer(room);
      room.abilityPromptShown = false;
      const next = room.game.advanceTrickResult();
      if (next.error) return next;
    }
    this.schedule(room);
    return result;
  }

  continueRound(room, playerId) {
    if (!room.game) return { error: "遊戲尚未開始。" };
    if (room.game.phase === PHASE.TRICK_RESULT) {
      if (room.abilityPromptShown && room.game.pendingAbility) {
        return { error: "請先使用海盜能力。" };
      }
      if (!room.trickExplanationShown) return { ok: true, waiting: true };
      this._clearTimer(room);
      if (room.game.pendingAbility) {
        room.trickExplanationShown = false;
        room.abilityPromptShown = true;
        this.touch(room);
        this.schedule(room);
        return { ok: true, abilityPrompt: true };
      }
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

  _syncTrickExplanation(room, prevPhase) {
    if (room.game?.phase === PHASE.TRICK_RESULT && prevPhase !== PHASE.TRICK_RESULT) {
      room.trickExplanationShown = false;
      room.abilityPromptShown = false;
    }
    if (room.game?.phase !== PHASE.TRICK_RESULT) {
      room.trickExplanationShown = false;
      room.abilityPromptShown = false;
    }
  }

  schedule(room) {
    this._clearTimer(room);
    const game = room.game;
    if (!game) return;
    if (game.phase === PHASE.TRICK_RESULT) {
      if (!room.trickExplanationShown && !room.abilityPromptShown) {
        const delay = trickReviewDelayMs(game);
        room.timer = setTimeout(() => {
          if (!room.game || room.game.phase !== PHASE.TRICK_RESULT) return;
          room.trickExplanationShown = true;
          room.abilityPromptShown = false;
          this.broadcast(room);
          this.schedule(room);
        }, delay);
        return;
      }
      if (room.trickExplanationShown && !room.abilityPromptShown) {
        room.timer = setTimeout(() => {
          if (!room.game || room.game.phase !== PHASE.TRICK_RESULT) return;
          if (room.game.pendingAbility) {
            room.trickExplanationShown = false;
            room.abilityPromptShown = true;
            this.broadcast(room);
            this.schedule(room);
            return;
          }
          room.trickExplanationShown = false;
          room.abilityPromptShown = false;
          room.game.advanceTrickResult();
          this.broadcast(room);
          this.schedule(room);
        }, TRICK_PAUSE_MS);
        return;
      }
      if (room.abilityPromptShown && game.pendingAbility) {
        const actor = game.players[game.pendingAbility.playerIndex];
        if (actor?.isAI) {
          room.timer = setTimeout(() => {
            if (!room.game || room.game.phase !== PHASE.TRICK_RESULT || !room.game.pendingAbility) return;
            if (!room.abilityPromptShown) return;
            room.game.stepPirateAbilityAI();
            room.abilityPromptShown = false;
            room.game.advanceTrickResult();
            this.broadcast(room);
            this.schedule(room);
          }, AI_PAUSE_MS);
        }
        return;
      }
      return;
    }
    if (game.phase === PHASE.PLAYING) {
      const current = game.players[game.currentPlayerIndex];
      if (current?.isAI) {
        const opening = game.round === 1 && game.tricksPlayed === 0 && !(game.trick || []).length;
        const delay = opening ? OPENING_DRAW_MS + AI_PAUSE_MS : AI_PAUSE_MS;
        room.timer = setTimeout(() => {
          if (!room.game || room.game.phase !== PHASE.PLAYING) return;
          const prev = room.game.phase;
          room.game.stepAI();
          this._syncTrickExplanation(room, prev);
          this.broadcast(room);
          this.schedule(room);
        }, delay);
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
      lobbyPlayers: room.humans.map((h, i) => ({
        id: h.id,
        name: h.name,
        ready: h.ready,
        connected: h.connected,
        isHost: h.id === room.hostId,
        colorIndex: i,
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
        previewAI: Array.from({ length: aiCount }, (_, i) => ({
          id: `preview-ai-${i}`,
          name: "電腦補位",
          isAI: true,
          colorIndex: room.humans.length + i,
        })),
      };
    }
    return {
      ...base,
      ...room.game.viewFor(playerId),
      ...this._continueView(room),
      showTrickExplanation: !!(room.game.phase === PHASE.TRICK_RESULT && room.trickExplanationShown && !room.abilityPromptShown),
      showPirateAbility: !!(room.game.phase === PHASE.TRICK_RESULT && room.abilityPromptShown && room.game.pendingAbility),
    };
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
    if (room.aiFill && aiCount > 0) bits.push(`開始後會加 ${aiCount} 個電腦，名子每場隨機`);
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
    const len = 4;
    for (let attempt = 0; attempt < 256; attempt++) {
      let code = "";
      const bytes = randomBytes(len);
      for (let i = 0; i < len; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
      if (!this.rooms.has(code)) return code;
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
