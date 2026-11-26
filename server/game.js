import {
  standardDeck,
  shuffle,
  sortHand,
  legalCards,
  playedCard,
  resolveTrick,
  bonusPoints,
  scoreRound,
  ledSuit,
  SUIT_INFO,
  currentTrickLead,
  explainTrick,
} from "./rules.js";
import { bid as aiBid, choosePlay as aiChoosePlay } from "./ai.js";

export const PHASE = {
  BIDDING: "bidding",
  PLAYING: "playing",
  CHOOSING_TIGRESS: "choosingTigress",
  TRICK_RESULT: "trickResult",
  ROUND_RESULT: "roundResult",
  GAME_OVER: "gameOver",
};

/** A match has five rounds. Round n deals n + 5 cards (6 through 10). */
export const TOTAL_ROUNDS = 5;
export function cardsDealtForRound(round) {
  return round + 5;
}

export class Game {
  constructor(seats) {
    this.players = seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      isAI: !!s.isAI,
      colorIndex: i,
      hand: [],
      bid: null,
      tricksWon: 0,
      potentialBonus: 0,
      bonusDetails: [],
      score: 0,
    }));
    this.phase = PHASE.BIDDING;
    this.round = 1;
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.trick = [];
    this.lastTrick = [];
    this.lastWinnerIndex = null;
    this.lastNextLeaderIndex = null;
    this.lastTrickDestroyed = false;
    this.lastTrickDetails = [];
    this.previousTrick = null;
    this.roundTrickLog = [];
    this.pendingTigress = null;
    this.scores = [];
    this.tricksPlayed = 0;
    this.statusMessage = "";
    this.revision = 0;
  }

  get cardsDealt() {
    return cardsDealtForRound(this.round);
  }

  get bidsRevealed() {
    return this.phase !== PHASE.BIDDING && this.players.every((p) => p.bid != null);
  }

  playerIndexById(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  startRound() {
    let deck = shuffle(standardDeck());
    const n = this.cardsDealt;
    for (const player of this.players) {
      const dealt = deck.slice(0, n);
      deck = deck.slice(n);
      player.hand = sortHand(dealt);
      player.bid = null;
      player.tricksWon = 0;
      player.potentialBonus = 0;
      player.bonusDetails = [];
    }
    this.trick = [];
    this.lastTrick = [];
    this.lastWinnerIndex = null;
    this.lastNextLeaderIndex = null;
    this.lastTrickDestroyed = false;
    this.lastTrickDetails = [];
    this.previousTrick = null;
    this.roundTrickLog = [];
    this.pendingTigress = null;
    this.tricksPlayed = 0;
    this.phase = PHASE.BIDDING;
    this.statusMessage = `第 ${this.round} 局，各有 ${n} 張牌。睇完手牌再預測會贏幾多回合。`;
    this._applyAIBids();
    this.revision++;
  }

  start() {
    this.round = 1;
    this.dealerIndex = 0;
    for (const p of this.players) p.score = 0;
    this.scores = [];
    this.startRound();
  }

  _applyAIBids() {
    for (const player of this.players) {
      if (player.isAI) player.bid = aiBid(player.hand, this.cardsDealt);
    }
  }

  _maybeRevealBids() {
    if (this.players.some((p) => p.bid == null)) return false;
    this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;
    this.phase = PHASE.PLAYING;
    const leader = this.players[this.currentPlayerIndex];
    this.statusMessage = leader.isAI
      ? `由${leader.name}先出第一回合。`
      : this._isSelfLeadMessage(leader);
    this.revision++;
    return true;
  }

  _isSelfLeadMessage(leader) {
    return `由${leader.name}先出第一回合。`;
  }

  submitBid(playerId, value) {
    if (this.phase !== PHASE.BIDDING) return { error: "而家唔係叫牌時間。" };
    const index = this.playerIndexById(playerId);
    if (index < 0) return { error: "找不到呢位玩家。" };
    const player = this.players[index];
    if (player.isAI) return { error: "電腦玩家會自己叫牌。" };
    const bid = Math.min(this.cardsDealt, Math.max(0, Number(value)));
    if (!Number.isInteger(bid) || bid !== Number(value)) {
      return { error: `叫牌要係 0 到 ${this.cardsDealt} 嘅整數。` };
    }
    const changing = player.bid != null;
    if (changing && player.bid === bid) return { ok: true };
    player.bid = bid;
    this.revision++;
    const waiting = this.players.filter((p) => p.bid == null).map((p) => p.name);
    if (waiting.length) {
      this.statusMessage = changing
        ? `${player.name}改叫咗牌。仲等緊 ${waiting.join("、")}。`
        : `已叫牌。仲等緊 ${waiting.join("、")}。`;
    }
    this._maybeRevealBids();
    return { ok: true, changed: changing };
  }

  playCard(playerId, cardId, tigressAsPirate) {
    if (this.phase === PHASE.CHOOSING_TIGRESS) {
      return { error: "請先揀母老虎當海盜定逃脫。" };
    }
    if (this.phase !== PHASE.PLAYING) return { error: "而家唔係出牌時間。" };
    const index = this.playerIndexById(playerId);
    if (index < 0) return { error: "找不到呢位玩家。" };
    if (index !== this.currentPlayerIndex) return { error: "仲未到你出牌。" };
    const player = this.players[index];
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return { error: "呢張牌唔喺你手上。" };
    const legal = legalCards(player.hand, this.trick);
    if (!legal.some((c) => c.id === card.id)) return { error: "呢張牌唔可以出：有花色就要跟花。" };
    if (card.special === "tigress") {
      if (tigressAsPirate !== true && tigressAsPirate !== false) {
        this.pendingTigress = { playerId, cardId };
        this.phase = PHASE.CHOOSING_TIGRESS;
        this.statusMessage = `${player.name}要宣布母老虎當海盜定逃脫。`;
        this.revision++;
        return { ok: true, needTigress: true };
      }
    } else if (tigressAsPirate != null) {
      return { error: "只有母老虎先要宣布當海盜定逃脫。" };
    }
    return this._commitPlay(index, card, card.special === "tigress" ? !!tigressAsPirate : null);
  }

  resolveTigress(playerId, asPirate) {
    if (this.phase !== PHASE.CHOOSING_TIGRESS) return { error: "而家唔使揀母老虎。" };
    if (!this.pendingTigress || this.pendingTigress.playerId !== playerId) {
      return { error: "而家唔係你揀母老虎。" };
    }
    const index = this.playerIndexById(playerId);
    const card = this.players[index].hand.find((c) => c.id === this.pendingTigress.cardId);
    if (!card) return { error: "找不到母老虎呢張牌。" };
    this.pendingTigress = null;
    return this._commitPlay(index, card, !!asPirate);
  }

  cancelTigress(playerId) {
    if (this.phase !== PHASE.CHOOSING_TIGRESS) return { error: "而家唔使取消。" };
    if (!this.pendingTigress || this.pendingTigress.playerId !== playerId) {
      return { error: "而家唔係你揀母老虎。" };
    }
    this.pendingTigress = null;
    this.phase = PHASE.PLAYING;
    this.statusMessage = "輪到你出牌。";
    this.revision++;
    return { ok: true };
  }

  _commitPlay(index, card, tigressAsPirate) {
    const player = this.players[index];
    player.hand = player.hand.filter((c) => c.id !== card.id);
    this.trick.push(playedCard(index, card, tigressAsPirate));
    this.phase = PHASE.PLAYING;
    if (this.trick.length === this.players.length) {
      this._resolveTrick();
    } else {
      this.currentPlayerIndex = (index + 1) % this.players.length;
      this.statusMessage = `輪到${this.players[this.currentPlayerIndex].name}出牌。`;
      this.revision++;
    }
    return { ok: true };
  }

  _resolveTrick() {
    const result = resolveTrick(this.trick);
    this.lastTrick = this.trick;
    this.lastTrickDestroyed = result.destroyed;
    this.lastWinnerIndex = result.winnerPlayerIndex;
    this.lastNextLeaderIndex = result.nextLeaderIndex;
    this.lastTrickDetails = [];
    const lastOfRound = this.players.every((p) => p.hand.length === 0);
    const leader = this.players[result.nextLeaderIndex];

    if (result.destroyed) {
      const beast = result.effect === "whiteWhale" ? "白鯨令呢個回合作廢" : "八爪魚食咗呢個回合";
      this.statusMessage = lastOfRound
        ? `${beast}，無人贏呢個回合。呢局完。`
        : `${beast}，無人贏呢個回合。下一回合由${leader.name}先出。`;
    } else {
      const bonus = bonusPoints(this.trick, result.winnerPlayerIndex);
      const winner = this.players[result.winnerPlayerIndex];
      winner.tricksWon += 1;
      winner.potentialBonus += bonus.points;
      winner.bonusDetails.push(...bonus.details);
      this.lastTrickDetails = bonus.details;
      const extra = bonus.details.length ? "（" + bonus.details.join("，") + "）" : "";
      const whale = result.effect === "whiteWhale" ? "白鯨令最高數字贏，" : "";
      this.statusMessage = `${whale}${winner.name}贏咗呢個回合。` + extra;
    }
    this.roundTrickLog = this.roundTrickLog || [];
    this.roundTrickLog.push({
      trickNumber: this.tricksPlayed + 1,
      winnerIndex: this.lastWinnerIndex,
      destroyed: !!this.lastTrickDestroyed,
      effect: result.effect || null,
      explanation: explainTrick(this.lastTrick),
      details: [...(this.lastTrickDetails || [])],
      cards: this.lastTrick.map((p) => ({
        playerIndex: p.playerIndex,
        playerName: this.players[p.playerIndex]?.name || "",
        card: p.card,
        tigressAsPirate: p.tigressAsPirate,
      })),
    });
    this.trick = [];
    this.tricksPlayed += 1;
    this.phase = PHASE.TRICK_RESULT;
    this.revision++;
  }

  _snapshotPreviousTrick() {
    return {
      cards: (this.lastTrick || []).map((p) => ({
        playerIndex: p.playerIndex,
        playerName: this.players[p.playerIndex]?.name || "",
        card: p.card,
        tigressAsPirate: p.tigressAsPirate,
      })),
      winnerIndex: this.lastWinnerIndex,
      destroyed: !!this.lastTrickDestroyed,
      details: [...(this.lastTrickDetails || [])],
      explanation: explainTrick(this.lastTrick || []),
    };
  }

  advanceTrickResult() {
    if (this.phase !== PHASE.TRICK_RESULT) return { error: "而家唔係回合結果。" };
    this.previousTrick = this._snapshotPreviousTrick();
    const leader = this.lastNextLeaderIndex ?? this.lastWinnerIndex ?? this.currentPlayerIndex;
    if (this.players.every((p) => p.hand.length === 0)) {
      this._finalizeRound();
    } else {
      this.currentPlayerIndex = leader;
      this.phase = PHASE.PLAYING;
      this.statusMessage = `${this.players[leader].name}出下一回合。`;
      this.revision++;
    }
    return { ok: true };
  }

  _finalizeRound() {
    const rows = [];
    for (const player of this.players) {
      const result = scoreRound(
        player.bid ?? 0,
        player.tricksWon,
        this.cardsDealt,
        player.potentialBonus,
      );
      player.score += result.total;
      rows.push({
        playerId: player.id,
        playerName: player.name,
        bid: player.bid ?? 0,
        taken: player.tricksWon,
        bidPoints: result.bidPoints,
        bonus: result.bonus,
        roundTotal: result.total,
        runningTotal: player.score,
      });
    }
    this.scores.push({ round: this.round, cardsDealt: this.cardsDealt, rows });
    this.phase = PHASE.ROUND_RESULT;
    this.statusMessage = `第 ${this.round} 局結束。`;
    this.revision++;
  }

  continueAfterRound() {
    if (this.phase !== PHASE.ROUND_RESULT) return { error: "而家唔係局結算。" };
    if (this.round >= TOTAL_ROUNDS) {
      this.phase = PHASE.GAME_OVER;
      const top = Math.max(...this.players.map((p) => p.score));
      const tied = this.players.filter((p) => p.score === top);
      if (tied.length > 1) {
        this.statusMessage = `打和，最高分係 ${top} 分（${tied.map((p) => p.name).join("、")}）。`;
      } else {
        this.statusMessage = `${tied[0].name}勝出，共 ${top} 分。`;
      }
      this.revision++;
    } else {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
      this.round += 1;
      this.startRound();
    }
    return { ok: true };
  }

  playAgain() {
    if (this.phase !== PHASE.GAME_OVER) return { error: "遊戲仲未完。" };
    this.start();
    return { ok: true };
  }

  /** If the current seat is AI and it's time to act, perform that action. */
  stepAI() {
    if (this.phase === PHASE.BIDDING) return { waited: true };
    if (this.phase === PHASE.TRICK_RESULT || this.phase === PHASE.ROUND_RESULT || this.phase === PHASE.GAME_OVER) {
      return { waited: true };
    }
    if (this.phase === PHASE.CHOOSING_TIGRESS) return { waited: true };
    if (this.phase !== PHASE.PLAYING) return { waited: true };
    const player = this.players[this.currentPlayerIndex];
    if (!player.isAI) return { waited: true };
    const legal = legalCards(player.hand, this.trick);
    const [card, asPirate] = aiChoosePlay({
      hand: player.hand,
      legal,
      trick: this.trick,
      bid: player.bid ?? 0,
      taken: player.tricksWon,
      myIndex: this.currentPlayerIndex,
      playerCount: this.players.length,
    });
    return this._commitPlay(this.currentPlayerIndex, card, asPirate);
  }

  followHintFor(playerId) {
    const myIndex = this.playerIndexById(playerId);
    const current = this.players[this.currentPlayerIndex];
    if (this.phase === PHASE.BIDDING) {
      return "睇完手牌，預測呢局會贏幾多回合。其他人嘅叫牌要等齊先睇到。";
    }
    if (this.phase === PHASE.CHOOSING_TIGRESS) {
      return this.pendingTigress && this.pendingTigress.playerId === playerId
        ? "請揀母老虎當海盜定逃脫。"
        : `等${current?.name || "對手"}揀母老虎當海盜定逃脫。`;
    }
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.TRICK_RESULT) return "";
    const trick = this.phase === PHASE.TRICK_RESULT ? this.lastTrick : this.trick;
    if (!trick.length) {
      if (myIndex === this.currentPlayerIndex) {
        return "由你先出呢一回合。第一張有花色嘅牌會定花；如果特殊牌先出，呢個回合就冇得跟花。";
      }
      return `等${current?.name || "對手"}先出。第一張有花色嘅牌會定花。`;
    }
    const suit = ledSuit(trick);
    if (suit && SUIT_INFO[suit]) {
      const info = SUIT_INFO[suit];
      return `而家要跟${info.shortName}色（${info.chineseName}）。你有呢種花就要跟；特殊牌隨時可出。`;
    }
    return "呢個回合由特殊牌先出，冇得跟花，可以出任何牌。";
  }

  viewFor(playerId) {
    const myIndex = this.playerIndexById(playerId);
    const me = myIndex >= 0 ? this.players[myIndex] : null;
    const revealed = this.bidsRevealed;
    const showTrick = this.phase === PHASE.TRICK_RESULT ? this.lastTrick : this.trick;
    const legal = me && this.phase === PHASE.PLAYING && this.currentPlayerIndex === myIndex
      ? legalCards(me.hand, this.trick).map((c) => c.id)
      : [];
    const trickForSuit = this.phase === PHASE.TRICK_RESULT ? this.lastTrick : this.trick;
    const suit = trickForSuit && trickForSuit.length ? ledSuit(trickForSuit) : null;

    let leadView = null;
    if (
      (this.phase === PHASE.PLAYING || this.phase === PHASE.CHOOSING_TIGRESS) &&
      this.trick.length
    ) {
      const lead = currentTrickLead(this.trick);
      if (lead?.destroyed) {
        leadView = { destroyed: true };
      } else if (lead && lead.leading === false) {
        leadView = { leading: false };
      } else if (lead) {
        leadView = {
          playerIndex: lead.playerIndex,
          playerName: this.players[lead.playerIndex]?.name || "",
          cardLabel: lead.cardLabel,
        };
      }
    }

    const trickNumber = this.phase === PHASE.BIDDING
      ? 0
      : (this.phase === PHASE.TRICK_RESULT || this.phase === PHASE.ROUND_RESULT || this.phase === PHASE.GAME_OVER)
        ? this.tricksPlayed
        : this.tricksPlayed + 1;

    return {
      phase: this.phase,
      round: this.round,
      cardsDealt: this.cardsDealt,
      roundsTotal: TOTAL_ROUNDS,
      trickNumber,
      tricksTotal: this.cardsDealt,
      dealerIndex: this.dealerIndex,
      currentPlayerIndex: this.currentPlayerIndex,
      statusMessage: this.statusMessage,
      revision: this.revision,
      bidsRevealed: revealed,
      lastWinnerIndex: this.phase === PHASE.TRICK_RESULT ? this.lastWinnerIndex : null,
      lastNextLeaderIndex: this.phase === PHASE.TRICK_RESULT ? this.lastNextLeaderIndex : null,
      lastTrickDestroyed: this.phase === PHASE.TRICK_RESULT ? this.lastTrickDestroyed : false,
      lastTrickDetails: this.phase === PHASE.TRICK_RESULT ? this.lastTrickDetails : [],
      previousTrick: this.previousTrick,
      lastTrickExplanation: this.phase === PHASE.TRICK_RESULT ? explainTrick(this.lastTrick || []) : "",
      roundTrickLog: this.roundTrickLog || [],
      pendingTigress: !!(
        this.phase === PHASE.CHOOSING_TIGRESS &&
        this.pendingTigress &&
        this.pendingTigress.playerId === playerId
      ),
      trick: showTrick.map((p) => ({
        playerIndex: p.playerIndex,
        playerName: this.players[p.playerIndex]?.name,
        card: p.card,
        tigressAsPirate: p.tigressAsPirate,
      })),
      myHand: me ? me.hand : [],
      legalCardIds: legal,
      isMyTurn: this.phase === PHASE.PLAYING && myIndex === this.currentPlayerIndex,
      ledSuit: suit,
      currentTrickLead: leadView,
      followHint: this.followHintFor(playerId),
      scores: this.scores,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        score: p.score,
        handCount: p.hand.length,
        tricksWon: revealed || this.phase === PHASE.BIDDING ? p.tricksWon : 0,
        bid: revealed || p.id === playerId ? p.bid : null,
        hasBid: p.bid != null,
        isTurn:
          (this.phase === PHASE.PLAYING || this.phase === PHASE.CHOOSING_TIGRESS) &&
          i === this.currentPlayerIndex,
        potentialBonus: p.id === playerId ? p.potentialBonus : null,
        bonusDetails: p.id === playerId ? p.bonusDetails : [],
        colorIndex: p.colorIndex ?? i,
      })),
    };
  }
}

export function publicHandsEmpty(game) {
  // helper used in tests — never leak other hands
  return game.players.every((p) => Array.isArray(p.hand));
}
