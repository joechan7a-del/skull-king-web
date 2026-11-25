import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeSuit as suit,
  makeSpecial as special,
  playedCard as P,
  legalCards,
  ledSuit,
  winnerIndex,
  bonusPoints,
  scoreRound,
  standardDeck,
  isLegal,
} from "../server/rules.js";

const Y = "yellow",
  G = "green",
  PPL = "purple",
  B = "black";
const ESC = "escape",
  PIR = "pirate",
  MER = "mermaid",
  TIG = "tigress",
  SK = "skullKing";

function hasCard(list, card) {
  return list.some((c) => {
    if (card.special) return c.special === card.special && (c.copyIndex ?? 0) === (card.copyIndex ?? 0);
    return c.suit === card.suit && c.rank === card.rank;
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
  assert.deepEqual(scoreRound(3, 3, 3, 0), { bidPoints: 60, bonus: 0, total: 60 });
  assert.deepEqual(scoreRound(2, 4, 5, 50), { bidPoints: -20, bonus: 0, total: -20 });
  assert.deepEqual(scoreRound(0, 0, 7, 10), { bidPoints: 70, bonus: 10, total: 80 });
  assert.deepEqual(scoreRound(0, 2, 9, 40), { bidPoints: -90, bonus: 0, total: -90 });
  assert.deepEqual(scoreRound(1, 1, 4, 40), { bidPoints: 20, bonus: 40, total: 60 });
});

test("basic deck has 70 cards", () => {
  const deck = standardDeck();
  assert.equal(deck.length, 70);
  assert.equal(deck.filter((c) => c.suit).length, 56);
  assert.equal(deck.filter((c) => c.special === "escape").length, 5);
  assert.equal(deck.filter((c) => c.special === "pirate").length, 5);
  assert.equal(deck.filter((c) => c.special === "mermaid").length, 2);
  assert.equal(deck.filter((c) => c.special === "tigress").length, 1);
  assert.equal(deck.filter((c) => c.special === "skullKing").length, 1);
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
