import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeSuit as suit,
  makeSpecial as special,
  playedCard as P,
  legalCards,
  ledSuit,
  winnerIndex,
  resolveTrick,
  bonusPoints,
  scoreRound,
  standardDeck,
  isLegal,
  activeBeast,
  currentTrickLead,
  explainTrick,
} from "../server/rules.js";

const Y = "yellow",
  G = "green",
  PPL = "purple",
  B = "black";
const ESC = "escape",
  PIR = "pirate",
  MER = "mermaid",
  TIG = "tigress",
  SK = "skullKing",
  KRA = "kraken",
  WH = "whiteWhale";

function hasCard(list, card) {
  return list.some((c) => {
    if (card.special) return c.special === card.special && (c.copyIndex ?? 0) === (card.copyIndex ?? 0);
    return c.suit === card.suit && c.rank === card.rank && (c.copyIndex ?? 0) === (card.copyIndex ?? 0);
  });
}

function bonusPts(trick, winner) {
  return bonusPoints(trick, winner).points;
}

function bonusDet(trick, winner) {
  return bonusPoints(trick, winner).details;
}

test("follow suit: has yellow, cannot play green, can play pirate", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(PIR, 0), special(ESC, 0)];
  const trick = [P(0, suit(Y, 12))];
  const leg = legalCards(hand, trick);
  assert.ok(hasCard(leg, suit(Y, 5)));
  assert.ok(hasCard(leg, special(PIR, 0)));
  assert.ok(hasCard(leg, special(ESC, 0)));
  assert.ok(!hasCard(leg, suit(G, 14)));
});

test("no led-suit cards: any card legal", () => {
  const hand2 = [suit(G, 14), special(PIR, 0)];
  const trick = [P(0, suit(Y, 12))];
  assert.equal(legalCards(hand2, trick).length, 2);
});

test("special led: no suit, anything legal", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(PIR, 0), special(ESC, 0)];
  const trickPir = [P(0, special(PIR, 0))];
  assert.equal(legalCards(hand, trickPir).length, 4);
});

test("escape led then yellow: yellow is led", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(PIR, 0), special(ESC, 0)];
  const trickE = [P(0, special(ESC, 0)), P(1, suit(Y, 3))];
  assert.equal(ledSuit(trickE), Y);
  assert.ok(!hasCard(legalCards(hand, trickE), suit(G, 14)));
});

test("all escapes / tigress-as-escape: first wins", () => {
  const t = [P(0, special(ESC, 0)), P(1, special(ESC, 1)), P(2, special(TIG), false)];
  assert.equal(winnerIndex(t), 0);
});

test("highest of led suit", () => {
  const t = [P(0, suit(Y, 12)), P(1, suit(Y, 5)), P(2, suit(PPL, 14))];
  assert.equal(winnerIndex(t), 0);
});

test("black trumps higher color", () => {
  const t = [P(0, suit(Y, 14)), P(1, suit(B, 1)), P(2, suit(Y, 10))];
  assert.equal(winnerIndex(t), 1);
});

test("higher black wins", () => {
  const t = [P(0, suit(B, 4)), P(1, suit(Y, 14)), P(2, suit(B, 7))];
  assert.equal(winnerIndex(t), 2);
});

test("pirate beats numbers including black 14", () => {
  const t = [P(0, suit(B, 14)), P(1, special(PIR, 0))];
  assert.equal(winnerIndex(t), 1);
});

test("first pirate wins among pirates", () => {
  const t = [P(0, special(PIR, 0)), P(1, special(PIR, 1))];
  assert.equal(winnerIndex(t), 0);
});

test("SK beats pirates", () => {
  const t = [P(0, special(PIR, 0)), P(1, special(SK))];
  assert.equal(winnerIndex(t), 1);
});

test("mermaid beats numbers, loses to pirate", () => {
  let t = [P(0, suit(B, 14)), P(1, special(MER, 0))];
  assert.equal(winnerIndex(t), 1);
  t = [P(0, special(MER, 0)), P(1, special(PIR, 0))];
  assert.equal(winnerIndex(t), 1);
});

test("mermaid beats SK even if pirate also present; first mermaid", () => {
  const t = [P(0, special(PIR, 0)), P(1, special(SK)), P(2, special(MER, 0)), P(3, special(MER, 1))];
  assert.equal(winnerIndex(t), 2);
});

test("tigress as pirate vs mermaid: pirate wins", () => {
  const t = [P(0, special(MER, 0)), P(1, special(TIG), true)];
  assert.equal(winnerIndex(t), 1);
});

test("tigress as escape loses to a number", () => {
  const t = [P(0, suit(G, 2)), P(1, special(TIG), false)];
  assert.equal(winnerIndex(t), 0);
});

test("two mermaids no SK: first mermaid", () => {
  const t = [P(0, special(MER, 0)), P(1, special(MER, 1))];
  assert.equal(winnerIndex(t), 0);
});

test("bonuses: yellow 14 +10, black 14 +20", () => {
  const t = [P(0, suit(Y, 14)), P(1, suit(B, 14)), P(2, suit(G, 2))];
  assert.equal(winnerIndex(t), 1);
  assert.equal(bonusPts(t, 1), 10 + 20);
});

test("mermaid captures SK +40, yellow 14 +10, no SK-pirate bonus", () => {
  const t = [P(0, suit(Y, 14)), P(1, special(PIR, 0)), P(2, special(SK)), P(3, special(MER, 0))];
  assert.equal(winnerIndex(t), 3);
  const { points, details } = bonusPoints(t, 3);
  assert.equal(points, 10 + 40);
  assert.ok(!details.some((d) => d.includes("骷髏王捕獲海盜")));
});

test("SK captures two pirates (one is tigress) +60", () => {
  const t = [P(0, special(PIR, 0)), P(1, special(TIG), true), P(2, special(SK))];
  assert.equal(winnerIndex(t), 2);
  assert.equal(bonusPts(t, 2), 60);
});

test("pirate captures two mermaids +40", () => {
  const t = [P(0, special(MER, 0)), P(1, special(MER, 1)), P(2, special(PIR, 0))];
  assert.equal(winnerIndex(t), 2);
  assert.equal(bonusPts(t, 2), 40);
});

test("scoring examples from rulebook", () => {
  assert.deepEqual(scoreRound(3, 3, 3, 0), { bidPoints: 60, bonus: 0, rascalPoints: 0, total: 60 });
  assert.deepEqual(scoreRound(2, 4, 5, 50), { bidPoints: -20, bonus: 0, rascalPoints: 0, total: -20 });
  assert.deepEqual(scoreRound(0, 0, 7, 10), { bidPoints: 70, bonus: 10, rascalPoints: 0, total: 80 });
  assert.deepEqual(scoreRound(0, 2, 9, 40), { bidPoints: -90, bonus: 0, rascalPoints: 0, total: -90 });
  assert.deepEqual(scoreRound(1, 1, 4, 40), { bidPoints: 20, bonus: 40, rascalPoints: 0, total: 60 });
});

test("basic deck has 74 house-rule cards including two black 14s and two Tigresses, no loot", () => {
  const deck = standardDeck();
  assert.equal(deck.length, 74);
  assert.equal(deck.filter((c) => c.suit).length, 57);
  assert.equal(deck.filter((c) => c.suit === "black" && c.rank === 14).length, 2);
  const black14 = deck.filter((c) => c.suit === "black" && c.rank === 14);
  assert.notEqual(black14[0].id, black14[1].id);
  assert.equal(deck.filter((c) => c.special === "escape").length, 5);
  assert.equal(deck.filter((c) => c.special === "pirate").length, 5);
  assert.equal(deck.filter((c) => c.special === "mermaid").length, 2);
  assert.equal(deck.filter((c) => c.special === "tigress").length, 2);
  assert.equal(deck.filter((c) => c.special === "skullKing").length, 1);
  assert.equal(deck.filter((c) => c.special === "kraken").length, 1);
  assert.equal(deck.filter((c) => c.special === "whiteWhale").length, 1);
  assert.equal(deck.filter((c) => c.special === "loot").length, 0);
  const ids = deck.map((c) => c.id);
  assert.equal(new Set(ids).size, 74);
});

test("isLegal agrees with legalCards", () => {
  const hand = [suit(Y, 5), suit(G, 14)];
  const trick = [P(0, suit(Y, 1))];
  assert.equal(isLegal(suit(Y, 5), hand, trick), true);
  assert.equal(isLegal(suit(G, 14), hand, trick), false);
});

test("character lead: no led suit even after a numbered card is played", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(PIR, 1), special(ESC, 0)];
  for (const lead of [
    P(0, special(PIR, 0)),
    P(0, special(MER, 0)),
    P(0, special(SK)),
    P(0, special(TIG), true),
    P(0, special(KRA)),
    P(0, special(WH)),
  ]) {
    const trick = [lead, P(1, suit(Y, 9))];
    assert.equal(ledSuit(trick), null);
    assert.equal(legalCards(hand, trick).length, 4);
  }
});

test("escape / tigress-as-escape lead: first numbered card sets the suit", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(PIR, 0), special(ESC, 0)];
  const trick = [P(0, special(ESC, 0)), P(1, special(TIG), false), P(2, suit(Y, 3))];
  assert.equal(ledSuit(trick), Y);
  assert.ok(!hasCard(legalCards(hand, trick), suit(G, 14)));
  assert.ok(hasCard(legalCards(hand, trick), suit(Y, 5)));
});

test("八爪魚 and 白鯨 are always legal and do not follow suit", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(KRA), special(WH)];
  const trick = [P(0, suit(Y, 12))];
  const leg = legalCards(hand, trick);
  assert.ok(hasCard(leg, special(KRA)));
  assert.ok(hasCard(leg, special(WH)));
  assert.ok(hasCard(leg, suit(Y, 5)));
  assert.ok(!hasCard(leg, suit(G, 14)));
});

test("mid-trick 白鯨 still requires following an already established suit", () => {
  const hand = [suit(Y, 5), suit(G, 14), special(PIR, 0)];
  const trick = [P(0, suit(Y, 12)), P(1, special(WH))];
  assert.equal(ledSuit(trick), Y);
  const leg = legalCards(hand, trick);
  assert.ok(hasCard(leg, suit(Y, 5)));
  assert.ok(hasCard(leg, special(PIR, 0)));
  assert.ok(!hasCard(leg, suit(G, 14)));
});

test("escape lead then 白鯨 then a number: that number sets the suit", () => {
  const hand = [suit(Y, 5), suit(G, 14)];
  const trick = [P(0, special(ESC, 0)), P(1, special(WH)), P(2, suit(Y, 3))];
  assert.equal(ledSuit(trick), Y);
  assert.ok(!hasCard(legalCards(hand, trick), suit(G, 14)));
});

test("八爪魚 destroys the trick; next leader is who would have won without it", () => {
  const t = [P(0, suit(Y, 12)), P(1, suit(B, 3)), P(2, special(KRA))];
  const r = resolveTrick(t);
  assert.equal(r.destroyed, true);
  assert.equal(r.winnerPlayerIndex, null);
  assert.equal(r.effect, "kraken");
  assert.equal(r.nextLeaderIndex, 1); // black 3 would trump yellow 12
  assert.equal(winnerIndex(t), null);
  assert.equal(bonusPts(t, r.winnerPlayerIndex), 0);
});

test("八爪魚 lead: next leader is who would have won had it not been led", () => {
  const t = [P(0, special(KRA)), P(1, suit(Y, 12)), P(2, special(PIR, 0))];
  const r = resolveTrick(t);
  assert.equal(r.destroyed, true);
  assert.equal(r.nextLeaderIndex, 2); // pirate would beat yellow 12
});

test("白鯨: highest rank wins regardless of trump or suit; tie goes to first played", () => {
  const t = [P(0, suit(Y, 12)), P(1, suit(B, 3)), P(2, special(WH))];
  const r = resolveTrick(t);
  assert.equal(r.destroyed, false);
  assert.equal(r.effect, "whiteWhale");
  assert.equal(r.winnerPlayerIndex, 0); // 12 > 3, black does not trump
  assert.equal(r.nextLeaderIndex, 0);
});

test("白鯨: equal highest rank, first of those played wins", () => {
  const t = [P(0, suit(Y, 10)), P(1, suit(B, 14)), P(2, suit(G, 14)), P(3, special(WH))];
  const r = resolveTrick(t);
  assert.equal(r.winnerPlayerIndex, 1); // black 14 before green 14
});

test("白鯨: specials cannot win; a later high number beats earlier characters", () => {
  const t = [P(0, special(SK)), P(1, special(PIR, 0)), P(2, suit(G, 2)), P(3, special(WH))];
  const r = resolveTrick(t);
  assert.equal(r.winnerPlayerIndex, 2);
  assert.equal(bonusPts(t, 2), 0);
});

test("白鯨 with only specials: discarded, whale player leads next", () => {
  const t = [P(0, special(PIR, 0)), P(1, special(MER, 0)), P(2, special(WH)), P(3, special(ESC, 0))];
  const r = resolveTrick(t);
  assert.equal(r.destroyed, true);
  assert.equal(r.winnerPlayerIndex, null);
  assert.equal(r.effect, "whiteWhale");
  assert.equal(r.nextLeaderIndex, 2);
  assert.equal(bonusPts(t, null), 0);
});

test("白鯨 lead then only specials: whale player still leads next", () => {
  const t = [P(0, special(WH)), P(1, special(SK)), P(2, special(TIG), true)];
  const r = resolveTrick(t);
  assert.equal(r.destroyed, true);
  assert.equal(r.nextLeaderIndex, 0);
});

test("both beasts: second keeps power; 白鯨 second, first 八爪魚 acts as escape", () => {
  const t = [P(0, suit(Y, 12)), P(1, suit(B, 3)), P(2, special(KRA)), P(3, special(WH))];
  assert.equal(activeBeast(t).card.special, WH);
  const r = resolveTrick(t);
  assert.equal(r.destroyed, false);
  assert.equal(r.effect, "whiteWhale");
  assert.equal(r.winnerPlayerIndex, 0); // 12 > 3
});

test("both beasts: official FAQ, 白鯨 then 八爪魚 — no winner, black 3 would have won", () => {
  const t = [P(0, suit(Y, 12)), P(1, suit(B, 3)), P(2, special(WH)), P(3, special(KRA))];
  assert.equal(activeBeast(t).card.special, KRA);
  const r = resolveTrick(t);
  assert.equal(r.destroyed, true);
  assert.equal(r.effect, "kraken");
  assert.equal(r.winnerPlayerIndex, null);
  assert.equal(r.nextLeaderIndex, 1);
});

test("both beasts with only specials and 白鯨 second: discarded, whale player leads", () => {
  const t = [P(0, special(PIR, 0)), P(1, special(KRA)), P(2, special(WH))];
  const r = resolveTrick(t);
  assert.equal(r.effect, "whiteWhale");
  assert.equal(r.destroyed, true);
  assert.equal(r.nextLeaderIndex, 2);
});

test("14 bonuses still apply when a number wins under 白鯨; no character-capture bonus", () => {
  const t = [P(0, suit(Y, 14)), P(1, special(PIR, 0)), P(2, special(MER, 0)), P(3, special(WH))];
  const r = resolveTrick(t);
  assert.equal(r.winnerPlayerIndex, 0);
  const { points, details } = bonusPoints(t, 0);
  assert.equal(points, 10);
  assert.ok(details.some((d) => d.includes("寶藏箱 14")));
  assert.ok(!details.some((d) => d.includes("捕獲")));
});

test("black 14 + colour 14 bonuses both go to the 白鯨 number winner", () => {
  const t = [P(0, suit(Y, 14)), P(1, suit(B, 14)), P(2, special(WH))];
  const r = resolveTrick(t);
  assert.equal(r.winnerPlayerIndex, 0); // tie at 14, first played
  assert.equal(bonusPts(t, 0), 10 + 20);
});

test("two black 14s each award the official +20 when the trick is captured", () => {
  const t = [
    P(0, suit(B, 14)),
    P(1, suit(B, 14, "black-14-1", 1)),
    P(2, suit(Y, 2)),
  ];
  assert.equal(winnerIndex(t), 0);
  assert.equal(bonusPts(t, 0), 40);
});

test("destroyed trick awards no 14 bonus even if a 14 was played", () => {
  const t = [P(0, suit(Y, 14)), P(1, special(KRA))];
  const r = resolveTrick(t);
  assert.equal(r.destroyed, true);
  assert.equal(bonusPts(t, r.winnerPlayerIndex), 0);
});

test("currentTrickLead is null on an empty trick", () => {
  assert.equal(currentTrickLead([]), null);
});

test("currentTrickLead follows official winner on an incomplete numbered trick", () => {
  const first = currentTrickLead([P(0, suit(Y, 7))]);
  assert.equal(first.playerIndex, 0);
  assert.equal(first.cardLabel, "黃7");
  const overtaken = currentTrickLead([P(0, suit(Y, 7)), P(1, suit(Y, 12))]);
  assert.equal(overtaken.playerIndex, 1);
  assert.equal(overtaken.cardLabel, "黃12");
  const trump = currentTrickLead([P(0, suit(Y, 14)), P(1, suit(B, 2))]);
  assert.equal(trump.playerIndex, 1);
  assert.equal(trump.cardLabel, "黑2");
});

test("currentTrickLead: only escapes or tigress-as-escape means nobody is leading yet", () => {
  const onlyEsc = currentTrickLead([P(0, special(ESC, 0)), P(1, special(ESC, 1))]);
  assert.equal(onlyEsc.leading, false);
  assert.equal(onlyEsc.destroyed, undefined);
  const tigEscape = currentTrickLead([P(0, special(ESC, 0)), P(1, special(TIG), false)]);
  assert.equal(tigEscape.leading, false);
});

test("currentTrickLead: tigress-as-pirate can take the lead after escapes", () => {
  const lead = currentTrickLead([P(0, special(ESC, 0)), P(1, special(TIG), true)]);
  assert.equal(lead.playerIndex, 1);
  assert.equal(lead.cardLabel, "母老虎");
});

test("currentTrickLead: kraken already in the trick marks it about to be voided", () => {
  const lead = currentTrickLead([P(0, suit(Y, 12)), P(1, special(KRA))]);
  assert.deepEqual(lead, { destroyed: true });
});

test("currentTrickLead: white whale voids when no numbers are present yet", () => {
  const onlyWhale = currentTrickLead([P(0, special(WH))]);
  assert.deepEqual(onlyWhale, { destroyed: true });
  const specials = currentTrickLead([P(0, special(PIR, 0)), P(1, special(WH))]);
  assert.deepEqual(specials, { destroyed: true });
});

test("currentTrickLead: white whale with numbers uses the official highest-rank winner", () => {
  const lead = currentTrickLead([P(0, suit(Y, 7)), P(1, special(PIR, 0)), P(2, special(WH))]);
  assert.equal(lead.destroyed, undefined);
  assert.equal(lead.playerIndex, 0);
  assert.equal(lead.cardLabel, "黃7");
});

test("currentTrickLead: pirate currently beats mermaid mid-trick", () => {
  const lead = currentTrickLead([P(0, special(MER, 0)), P(1, special(PIR, 0))]);
  assert.equal(lead.playerIndex, 1);
  assert.equal(lead.cardLabel, "海盜");
});

test("explainTrick: mermaid captures Skull King", () => {
  const trick = [P(0, special(SK)), P(1, special(MER, 0))];
  assert.equal(resolveTrick(trick).winnerPlayerIndex, 1);
  assert.match(explainTrick(trick), /人魚捕獲骷髏王/);
});

test("explainTrick: Skull King beats pirates", () => {
  const trick = [P(0, special(PIR, 0)), P(1, special(SK))];
  assert.match(explainTrick(trick), /骷髏王最大/);
});

test("explainTrick: pirate beats mermaid and numbers; black trumps; follow suit; escapes; beasts", () => {
  assert.match(explainTrick([P(0, special(MER, 0)), P(1, special(PIR, 0))]), /海盜大過人魚/);
  assert.match(explainTrick([P(0, suit(Y, 14)), P(1, special(PIR, 0))]), /海盜大過花色牌/);
  assert.match(explainTrick([P(0, special(MER, 0)), P(1, suit(B, 14))]), /人魚大過花色牌/);
  assert.match(explainTrick([P(0, suit(Y, 14)), P(1, suit(B, 2))]), /骷髏旗係王牌/);
  assert.match(explainTrick([P(0, suit(B, 3)), P(1, suit(B, 12))]), /跟骷髏旗當中最大/);
  assert.match(explainTrick([P(0, suit(Y, 5)), P(1, suit(Y, 12)), P(2, suit(G, 14))]), /跟黃花當中最大/);
  assert.match(explainTrick([P(0, special(ESC, 0)), P(1, special(ESC, 1))]), /全部都係逃脫/);
  assert.match(explainTrick([P(0, suit(Y, 14)), P(1, special(KRA))]), /八爪魚令呢個回合作廢/);
  assert.match(explainTrick([P(0, special(PIR, 0)), P(1, special(WH))]), /白鯨[\s\S]*作廢/);
  assert.match(explainTrick([P(0, special(PIR, 0)), P(1, suit(Y, 7)), P(2, special(WH))]), /白鯨令特殊牌唔計/);
  assert.match(explainTrick([P(0, special(TIG), true), P(1, suit(Y, 14))]), /海盜/);
});
