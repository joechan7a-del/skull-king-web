/** Skull King 2021+ Grand Prix basic-rules engine (no expansion cards). */

export const SUITS = ["yellow", "green", "purple", "black"];

export const SUIT_INFO = {
  yellow: { chineseName: "寶藏箱", shortName: "黃" },
  green: { chineseName: "鸚鵡", shortName: "綠" },
  purple: { chineseName: "海盜地圖", shortName: "紫" },
  black: { chineseName: "骷髏旗", shortName: "黑", trump: true },
};

export const SPECIALS = ["escape", "pirate", "mermaid", "tigress", "skullKing"];

export const SPECIAL_INFO = {
  escape: { chineseName: "逃脫", count: 5 },
  pirate: { chineseName: "海盜", count: 5 },
  mermaid: { chineseName: "人魚", count: 2 },
  tigress: { chineseName: "母老虎", count: 1 },
  skullKing: { chineseName: "骷髏王", count: 1 },
};

const SPECIAL_HAND_ORDER = ["skullKing", "tigress", "pirate", "mermaid", "escape"];
const SUIT_HAND_ORDER = ["black", "purple", "green", "yellow"];

export function makeSuit(suit, rank, id = `${suit}-${rank}`) {
  return { id, suit, rank, special: null };
}

export function makeSpecial(special, copyIndex = 0, id) {
  const suffix = SPECIAL_INFO[special].count > 1 ? `-${copyIndex}` : "";
  return {
    id: id ?? `${special}${suffix}`,
    suit: null,
    rank: null,
    special,
    copyIndex,
  };
}

export function isSpecial(card) {
  return card.special != null;
}

export function sameCard(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.special && a.special === b.special) {
    return (a.copyIndex ?? 0) === (b.copyIndex ?? 0);
  }
  return a.suit === b.suit && a.rank === b.rank && !a.special && !b.special;
}

export function cardKey(card) {
  if (card.special) return `${card.special}:${card.copyIndex ?? 0}`;
  return `${card.suit}:${card.rank}`;
}

export function displayName(card) {
  if (card.special) return SPECIAL_INFO[card.special].chineseName;
  return `${SUIT_INFO[card.suit].shortName}${card.rank}`;
}

export function cloneCard(card) {
  return { ...card };
}

export function standardDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 14; rank++) {
      cards.push(makeSuit(suit, rank));
    }
  }
  for (let i = 0; i < 5; i++) cards.push(makeSpecial("escape", i));
  for (let i = 0; i < 5; i++) cards.push(makeSpecial("pirate", i));
  for (let i = 0; i < 2; i++) cards.push(makeSpecial("mermaid", i));
  cards.push(makeSpecial("tigress"));
  cards.push(makeSpecial("skullKing"));
  return cards;
}

export function sortHand(cards) {
  return [...cards].sort((a, b) => {
    const aSpec = a.special != null;
    const bSpec = b.special != null;
    if (aSpec && bSpec) {
      const li = SPECIAL_HAND_ORDER.indexOf(a.special);
      const ri = SPECIAL_HAND_ORDER.indexOf(b.special);
      if (li !== ri) return li - ri;
      return (a.copyIndex ?? 0) - (b.copyIndex ?? 0);
    }
    if (aSpec) return -1;
    if (bSpec) return 1;
    const ls = SUIT_HAND_ORDER.indexOf(a.suit);
    const rs = SUIT_HAND_ORDER.indexOf(b.suit);
    if (ls !== rs) return ls - rs;
    return b.rank - a.rank;
  });
}

export function shuffle(cards, rng = Math.random) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A card as played into a trick. tigressAsPirate is required when the card is the Tigress. */
export function playedCard(playerIndex, card, tigressAsPirate = null) {
  return { playerIndex, card, tigressAsPirate };
}

export function effectiveSpecial(played) {
  if (played.card.special === "tigress") {
    return played.tigressAsPirate === true ? "pirate" : "escape";
  }
  return played.card.special;
}

export function isEffectivePirate(played) {
  return effectiveSpecial(played) === "pirate";
}

export function isEffectiveEscape(played) {
  return effectiveSpecial(played) === "escape";
}

export function isMermaid(played) {
  return played.card.special === "mermaid";
}

export function isSkullKing(played) {
  return played.card.special === "skullKing";
}

export function isSuitCard(played) {
  return played.card.suit != null;
}

export function ledSuit(trick) {
  if (!trick.length) return null;
  // Character lead (mermaid / pirate / Skull King / Tigress-as-pirate): no suit all trick.
  const lead = trick[0];
  const leadEff = effectiveSpecial(lead);
  if (
    leadEff === "pirate" ||
    lead.card.special === "mermaid" ||
    lead.card.special === "skullKing"
  ) {
    return null;
  }
  // Suit lead, or escape / Tigress-as-escape lead: first numbered card sets the suit.
  const first = trick.find(isSuitCard);
  return first ? first.card.suit : null;
}

export function legalCards(hand, trick) {
  if (!trick.length) return [...hand];
  const suit = ledSuit(trick);
  if (suit == null) return [...hand];
  const hasSuit = hand.some((c) => c.suit === suit);
  if (!hasSuit) return [...hand];
  return hand.filter((c) => c.special != null || c.suit === suit);
}

export function isLegal(card, hand, trick) {
  return legalCards(hand, trick).some((c) => c.id === card.id || sameCard(c, card));
}

/** Winning player's seat index (playerIndex on the played cards). */
export function winnerIndex(trick) {
  if (!trick.length) throw new Error("empty trick");
  const mermaids = [];
  const kings = [];
  const pirates = [];
  for (let i = 0; i < trick.length; i++) {
    if (isMermaid(trick[i])) mermaids.push(i);
    if (isSkullKing(trick[i])) kings.push(i);
    if (isEffectivePirate(trick[i])) pirates.push(i);
  }

  if (mermaids.length && kings.length) return trick[mermaids[0]].playerIndex;
  if (kings.length) return trick[kings[0]].playerIndex;
  if (pirates.length) return trick[pirates[0]].playerIndex;
  if (mermaids.length) return trick[mermaids[0]].playerIndex;

  let bestBlack = -1;
  let bestBlackRank = -1;
  for (let i = 0; i < trick.length; i++) {
    const c = trick[i].card;
    if (c.suit === "black" && c.rank > bestBlackRank) {
      bestBlack = i;
      bestBlackRank = c.rank;
    }
  }
  if (bestBlack >= 0) return trick[bestBlack].playerIndex;

  const suit = ledSuit(trick);
  if (suit) {
    let best = -1;
    let bestRank = -1;
    for (let i = 0; i < trick.length; i++) {
      const c = trick[i].card;
      if (c.suit === suit && c.rank > bestRank) {
        best = i;
        bestRank = c.rank;
      }
    }
    if (best >= 0) return trick[best].playerIndex;
  }

  return trick[0].playerIndex;
}

/**
 * Potential bonuses for the winner of this trick.
 * Awarded only later if that player makes their bid.
 */
export function bonusPoints(trick, winnerPlayerIndex) {
  let points = 0;
  const details = [];

  for (const played of trick) {
    if (played.card.rank === 14 && played.card.suit) {
      const add = played.card.suit === "black" ? 20 : 10;
      points += add;
      details.push(`${SUIT_INFO[played.card.suit].chineseName} 14 +${add}`);
    }
  }

  const winPlay = trick.find((p) => p.playerIndex === winnerPlayerIndex);
  if (!winPlay) return { points, details };

  const mermaidCount = trick.filter(isMermaid).length;
  const pirateCount = trick.filter(isEffectivePirate).length;
  const hasSkullKing = trick.some(isSkullKing);

  if (isMermaid(winPlay) && hasSkullKing) {
    points += 40;
    details.push("人魚捕獲骷髏王 +40");
  } else if (isSkullKing(winPlay) && pirateCount > 0) {
    const add = 30 * pirateCount;
    points += add;
    details.push(`骷髏王捕獲海盜 +${add}`);
  } else if (isEffectivePirate(winPlay) && mermaidCount > 0 && !hasSkullKing) {
    const add = 20 * mermaidCount;
    points += add;
    details.push(`海盜捕獲人魚 +${add}`);
  }

  return { points, details };
}

/** Classic scoring. Bonus is only kept if the bid is made. */
export function scoreRound(bid, taken, cardsDealt, bonus) {
  const made = bid === taken;
  let bidPoints;
  if (made) {
    bidPoints = bid === 0 ? 10 * cardsDealt : 20 * bid;
  } else {
    bidPoints = bid === 0 ? -10 * cardsDealt : -10 * Math.abs(taken - bid);
  }
  const awardedBonus = made ? bonus : 0;
  return { bidPoints, bonus: awardedBonus, total: bidPoints + awardedBonus };
}
