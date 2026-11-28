import { playedCard, resolveTrick } from "./rules.js";

export const AI_NAMES = [
  "安妮",
  "黑鬍子",
  "凱利",
  "摩根",
  "杰克",
  "紅鬍子",
  "獨眼龍",
  "海魔女",
  "大副強",
  "花船長",
  "銀鈎",
  "珍珠",
  "炮手輝",
  "藍鬚",
  "白浪",
  "珊瑚",
  "金牙",
  "鹽婆",
  "錨仔",
  "霧隱",
  "潮生",
  "裂帆",
  "羅盤",
  "燈塔守",
];

/** Shuffle a fresh, unique set of display names for one match. */
export function pickAINames(count, reserved = [], rng = Math.random) {
  const need = Math.max(0, Number(count) || 0);
  const taken = new Set((reserved || []).filter(Boolean));
  const bag = AI_NAMES.filter((n) => !taken.has(n));
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const picked = bag.slice(0, need);
  let n = 1;
  while (picked.length < need) {
    const fallback = `電腦${n++}`;
    if (!taken.has(fallback) && !picked.includes(fallback)) picked.push(fallback);
  }
  return picked;
}

export function bid(hand, cardsDealt, rng = Math.random) {
  let expected = 0;
  for (const card of hand) expected += trickExpectation(card, cardsDealt);
  expected += rng() * 0.6 - 0.3;
  if (expected < 0.4) return 0;
  return Math.min(cardsDealt, Math.max(0, Math.round(expected)));
}

export function choosePlay({ hand, legal, trick, bid, taken, myIndex, playerCount }) {
  const remainingTricks = hand.length;
  const needed = bid - taken;
  const wantWin = needed > 0;
  const lastToPlay = trick.length === playerCount - 1;

  const options = [];
  for (const card of legal) {
    if (card.special === "tigress") {
      for (const asPirate of [true, false]) {
        options.push({
          card,
          asPirate,
          winsNow: wouldWin(card, asPirate, trick, myIndex),
          strength: asPirate ? 90 : 0,
        });
      }
    } else {
      options.push({
        card,
        asPirate: null,
        winsNow: wouldWin(card, null, trick, myIndex),
        strength: strength(card),
      });
    }
  }

  const pack = (option) => [option.card, option.asPirate];
  const mustWinAll = needed >= remainingTricks && wantWin;
  const weakest = (list) => list.reduce((a, b) => (a.strength < b.strength ? a : b));
  const strongest = (list) => list.reduce((a, b) => (a.strength > b.strength ? a : b));

  if (lastToPlay || mustWinAll) {
    if (wantWin) {
      const winners = options.filter((o) => o.winsNow);
      if (winners.length) return pack(mustWinAll ? strongest(winners) : weakest(winners));
      return pack(weakest(options));
    }
    const losers = options.filter((o) => !o.winsNow);
    if (losers.length) return pack(weakest(losers));
    return pack(weakest(options));
  }

  if (wantWin) {
    const mermaid = options.find(
      (o) => o.card.special === "mermaid" && trick.some((p) => p.card.special === "skullKing"),
    );
    if (mermaid) return pack(mermaid);
    const king = options.find(
      (o) =>
        o.card.special === "skullKing" &&
        trick.some((p) => (p.card.special === "tigress" ? p.tigressAsPirate === true : p.card.special === "pirate")),
    );
    if (king) return pack(king);
    const likely = options.filter((o) => o.winsNow);
    if (needed + 1 >= remainingTricks && likely.length) return pack(strongest(likely));
    const cheap = likely.filter((o) => o.strength <= 64);
    if (cheap.length) return pack(weakest(cheap));
    return pack(weakest(options));
  }

  const safe = options.filter((o) => !o.winsNow);
  if (safe.length) return pack(weakest(safe));
  return pack(weakest(options));
}

export function wouldWin(card, tigressAsPirate, trick, myIndex) {
  const hypo = [...trick, playedCard(myIndex, card, tigressAsPirate)];
  return resolveTrick(hypo).winnerPlayerIndex === myIndex;
}

export function strength(card) {
  if (card.special === "skullKing") return 100;
  if (card.special === "pirate" || card.special === "tigress") return 90;
  if (card.special === "mermaid") return 80;
  if (card.special === "kraken") return 8;
  if (card.special === "whiteWhale") return 12;
  if (card.suit === "black") return 50 + card.rank;
  if (card.suit) return card.rank;
  return 0;
}

function trickExpectation(card, handSize) {
  if (card.special === "skullKing") return 0.85;
  if (card.special === "pirate" || card.special === "tigress") return 0.68;
  if (card.special === "mermaid") return 0.42;
  if (card.special === "escape") return 0;
  if (card.special === "kraken" || card.special === "whiteWhale") return 0.05;
  if (card.suit === "black") return 0.1 + (card.rank / 14) * 0.82;
  if (card.rank === 14) return handSize <= 4 ? 0.4 : 0.28;
  if (card.rank >= 12) return handSize <= 3 ? 0.22 : 0.1;
  return 0;
}

/** Legal, modest AI choices for official 2021 pirate abilities. */
export function choosePirateAbility({ id, player, players, cardsDealt, tricksLeft }) {
  const bid = player.bid ?? 0;
  const taken = player.tricksWon ?? 0;
  if (id === "rosie") {
    if (taken < bid) return { leaderIndex: players.findIndex((p) => p.id === player.id) };
    const busted = players
      .map((p, i) => ({ i, over: (p.tricksWon ?? 0) - (p.bid ?? 0) }))
      .filter((x) => x.over > 0 && players[x.i].id !== player.id)
      .sort((a, b) => b.over - a.over);
    if (busted.length) return { leaderIndex: busted[0].i };
    const self = players.findIndex((p) => p.id === player.id);
    return { leaderIndex: self >= 0 ? self : 0 };
  }
  if (id === "bendt") {
    const hand = [...(player.hand || [])];
    const need = taken < bid;
    hand.sort((a, b) => (need ? strength(a) - strength(b) : strength(b) - strength(a)));
    return { discardIds: hand.slice(0, 2).map((c) => c.id) };
  }
  if (id === "rascal") {
    const remaining = Math.max(0, Number(tricksLeft) || 0);
    if (taken === bid && remaining === 0) return { bet: 20 };
    if (taken === bid && remaining <= 1) return { bet: 10 };
    if (Math.abs(taken - bid) > remaining) return { bet: taken === bid ? 20 : 0 };
    return { bet: 0 };
  }
  if (id === "juanita") return { done: true };
  if (id === "harry") {
    if (taken === bid + 1 && bid > 0) return { delta: -1 };
    if (taken === bid - 1 && bid < cardsDealt) return { delta: 1 };
    return { delta: 0 };
  }
  return {};
}
