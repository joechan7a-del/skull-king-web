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
import { bid as aiBid, choosePlay as aiChoosePlay, choosePirateAbility as aiChoosePirateAbility } from "./ai.js";
import { winningPirateAbility, pirateAbilityByCopyIndex } from "../public/pirates.js";

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

/** Pick who leads the first trick of a new match. Later 局 use official rotation. */
export function pickOpeningLeaderIndex(count, rng = Math.random) {
  const n = Math.max(1, Number(count) || 1);
  const r = typeof rng === "function" ? rng() : Math.random();
  return Math.min(n - 1, Math.max(0, Math.floor(r * n)));
}

export class Game {
  constructor(seats, { rng } = {}) {
    this.rng = typeof rng === "function" ? rng : Math.random;
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
      rascalBet: 0,
      score: 0,
    }));
    this.phase = PHASE.BIDDING;
    this.round = 1;
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.openingLeaderIndex = 0;
    this.trick = [];
    this.lastTrick = [];
    this.lastWinnerIndex = null;
    this.lastNextLeaderIndex = null;
    this.lastTrickDestroyed = false;
    this.lastTrickDetails = [];
    this.previousTrick = null;
    this.roundTrickLog = [];
    this.pendingTigress = null;
    this.pendingAbility = null;
    this.deck = [];
    this.discards = [];
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
      player.rascalBet = 0;
    }
    this.deck = deck;
    this.discards = [];
    this.pendingAbility = null;
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
    this.openingLeaderIndex = pickOpeningLeaderIndex(this.players.length, this.rng);
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
    const opening = this.round === 1 && this.tricksPlayed === 0;
    this.currentPlayerIndex = opening
      ? this.openingLeaderIndex
      : (this.dealerIndex + 1) % this.players.length;
    this.phase = PHASE.PLAYING;
    const leader = this.players[this.currentPlayerIndex];
    this.statusMessage = opening
      ? `今場由${leader.name}先出。`
      : (leader.isAI ? `由${leader.name}先出第一回合。` : this._isSelfLeadMessage(leader));
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
    this.pendingAbility = null;
    if (!result.destroyed && result.winnerPlayerIndex != null) {
      const winPlay = this.lastTrick.find((p) => p.playerIndex === result.winnerPlayerIndex);
      const info = winningPirateAbility(winPlay, { lastTrickOfRound: lastOfRound });
      if (info) {
        this.pendingAbility = {
          id: info.id,
          copyIndex: winPlay.card.copyIndex ?? 0,
          playerIndex: result.winnerPlayerIndex,
        };
        if (info.id === "bendt") this._bendtDraw();
        const actor = this.players[result.winnerPlayerIndex];
        this.statusMessage = `${this.statusMessage} ${actor.name}用${info.chineseName}贏回合，要即時使用能力。`;
      }
    }
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
    if (this.pendingAbility) return { error: "請先使用海盜能力。", needAbility: true };
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
        player.rascalBet ?? 0,
      );
      player.score += result.total;
      rows.push({
        playerId: player.id,
        playerName: player.name,
        bid: player.bid ?? 0,
        taken: player.tricksWon,
        bidPoints: result.bidPoints,
        bonus: result.bonus,
        rascalPoints: result.rascalPoints,
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
    if (this.pendingAbility) {
      const actor = this.players[this.pendingAbility.playerIndex];
      const info = pirateAbilityByCopyIndex(this.pendingAbility.copyIndex);
      const who = info ? `${info.chineseName}` : "海盜能力";
      return actor?.id === playerId
        ? `你用${who}贏咗呢個回合，請即時使用能力。`
        : `等${actor?.name || "對手"}使用${who}嘅能力。`;
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


  _bendtDraw() {
    const actor = this.players[this.pendingAbility.playerIndex];
    const take = Math.min(2, this.deck.length);
    const drawn = this.deck.slice(0, take);
    this.deck = this.deck.slice(take);
    if (drawn.length) {
      actor.hand = sortHand([...actor.hand, ...drawn]);
    }
    this.pendingAbility.drawnIds = drawn.map((c) => c.id);
    this.pendingAbility.drawnCount = drawn.length;
  }

  _abilityView(playerId) {
    if (this.phase !== PHASE.TRICK_RESULT || !this.pendingAbility) return null;
    const info = pirateAbilityByCopyIndex(this.pendingAbility.copyIndex);
    if (!info) return null;
    const actor = this.players[this.pendingAbility.playerIndex];
    const mine = actor?.id === playerId;
    const view = {
      id: info.id,
      officialName: info.officialName,
      chineseName: info.chineseName,
      artName: info.artName,
      artFile: info.artFile,
      skill: info.skill,
      copyIndex: this.pendingAbility.copyIndex,
      playerIndex: this.pendingAbility.playerIndex,
      playerId: actor?.id,
      playerName: actor?.name,
      isMine: mine,
      lastTrickOfRound: this.players.every((p) => p.hand.length === 0) && info.id === "harry",
      drawnCount: this.pendingAbility.drawnCount ?? 0,
    };
    if (mine && info.id === "juanita") {
      view.undealtCards = this.deck.map((c) => ({ ...c }));
    }
    if (mine && info.id === "harry") {
      view.bid = actor.bid ?? 0;
      view.cardsDealt = this.cardsDealt;
    }
    return view;
  }

  usePirateAbility(playerId, choice = {}) {
    if (this.phase !== PHASE.TRICK_RESULT || !this.pendingAbility) {
      return { error: "而家唔使使用海盜能力。" };
    }
    const actor = this.players[this.pendingAbility.playerIndex];
    if (!actor || actor.id !== playerId) return { error: "而家唔係你使用海盜能力。" };
    const info = pirateAbilityByCopyIndex(this.pendingAbility.copyIndex);
    if (!info || info.id !== this.pendingAbility.id) return { error: "找不到呢個海盜能力。" };

    if (info.id === "rosie") {
      const leaderIndex = Number(choice.leaderIndex);
      if (!Number.isInteger(leaderIndex) || leaderIndex < 0 || leaderIndex >= this.players.length) {
        return { error: "請揀邊個做下一回合領牌。" };
      }
      this.lastNextLeaderIndex = leaderIndex;
      const lead = this.players[leaderIndex];
      this.statusMessage = `${actor.name}用${info.chineseName}，下一回合由${lead.name}先出。`;
    } else if (info.id === "bendt") {
      const ids = Array.isArray(choice.discardIds) ? [...new Set(choice.discardIds.map(String))] : [];
      if (ids.length !== 2) return { error: "請從手牌揀 2 張棄掉。" };
      const picked = ids.map((id) => actor.hand.find((c) => c.id === id));
      if (picked.some((c) => !c)) return { error: "要棄嘅牌唔喺你手上。" };
      actor.hand = sortHand(actor.hand.filter((c) => !ids.includes(c.id)));
      this.discards.push(...picked);
      this.statusMessage = `${actor.name}用${info.chineseName}，加牌後棄咗 2 張。`;
    } else if (info.id === "rascal") {
      const bet = Number(choice.bet);
      if (![0, 10, 20].includes(bet)) return { error: "旁注只可以係 0、10 或 20 分。" };
      actor.rascalBet = bet;
      this.statusMessage = bet
        ? `${actor.name}用${info.chineseName}，旁注 ${bet} 分。`
        : `${actor.name}用${info.chineseName}，唔旁注。`;
    } else if (info.id === "juanita") {
      this.statusMessage = `${actor.name}用${info.chineseName}，已私下睇過未發嘅牌。`;
    } else if (info.id === "harry") {
      const delta = Number(choice.delta);
      if (![ -1, 0, 1 ].includes(delta)) return { error: "請揀將叫牌 +1、−1，或者保持不變。" };
      const next = (actor.bid ?? 0) + delta;
      if (next < 0 || next > this.cardsDealt) {
        return { error: "叫牌唔可以細過 0，亦唔可以大過呢局張數。" };
      }
      actor.bid = next;
      this.statusMessage = delta === 0
        ? `${actor.name}用${info.chineseName}，叫牌保持 ${actor.bid}。`
        : `${actor.name}用${info.chineseName}，叫牌改為 ${actor.bid}。`;
    } else {
      return { error: "未知海盜能力。" };
    }

    this.pendingAbility = null;
    this.revision++;
    return { ok: true };
  }

  stepPirateAbilityAI() {
    if (this.phase !== PHASE.TRICK_RESULT || !this.pendingAbility) return { waited: true };
    const actor = this.players[this.pendingAbility.playerIndex];
    if (!actor?.isAI) return { waited: true };
    const info = pirateAbilityByCopyIndex(this.pendingAbility.copyIndex);
    const choice = aiChoosePirateAbility({
      id: info?.id,
      player: actor,
      players: this.players,
      cardsDealt: this.cardsDealt,
      tricksLeft: this.cardsDealt - this.tricksPlayed,
    });
    return this.usePirateAbility(actor.id, choice);
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
      openingLead: this.phase === PHASE.PLAYING && this.round === 1 && this.tricksPlayed === 0 && this.trick.length === 0,
      openingLeaderIndex: this.openingLeaderIndex,
      openingLeaderName: this.players[this.openingLeaderIndex]?.name || "",
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
      pendingAbility: this._abilityView(playerId),
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
