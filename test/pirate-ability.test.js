import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, PHASE } from "../server/game.js";
import { scoreRound, playedCard, makeSuit, makeSpecial } from "../server/rules.js";
import { PIRATE_ABILITIES, winningPirateAbility } from "../public/pirates.js";

function seats(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    name: i === 0 ? "你" : `玩家${i + 1}`,
    isAI: false,
  }));
}

function playableGame() {
  const g = new Game(seats(3));
  g.start();
  g.round = 2;
  g.tricksPlayed = 0;
  g.players.forEach((p, i) => {
    p.bid = i === 0 ? 1 : 0;
    p.tricksWon = 0;
    p.rascalBet = 0;
    p.potentialBonus = 0;
    p.bonusDetails = [];
  });
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.deck = [makeSuit("yellow", 2), makeSuit("green", 3), makeSuit("purple", 4), makeSuit("black", 5)];
  g.discards = [];
  g.pendingAbility = null;
  return g;
}

function finishTrick(g, plays) {
  g.trick = [];
  g.phase = PHASE.PLAYING;
  for (const [i, card, asPirate] of plays) {
    g.currentPlayerIndex = i;
    if (!g.players[i].hand.some((c) => c.id === card.id)) g.players[i].hand.push(card);
    const result = g.playCard(g.players[i].id, card.id, asPirate);
    assert.equal(result.error, undefined, result.error);
  }
  assert.equal(g.phase, PHASE.TRICK_RESULT);
}

test("pirate-ability mapping binds each house art to one official 2021 skill", () => {
  assert.equal(PIRATE_ABILITIES[0].id, "harry");
  assert.equal(PIRATE_ABILITIES[0].artName, "Edward Newgate");
  assert.equal(PIRATE_ABILITIES[1].id, "juanita");
  assert.equal(PIRATE_ABILITIES[1].artName, "Kaido");
  assert.equal(PIRATE_ABILITIES[2].id, "rosie");
  assert.equal(PIRATE_ABILITIES[2].artName, "Big Mum");
  assert.equal(PIRATE_ABILITIES[3].id, "rascal");
  assert.equal(PIRATE_ABILITIES[3].artName, "Shanks");
  assert.equal(PIRATE_ABILITIES[4].id, "bendt");
  assert.equal(PIRATE_ABILITIES[4].artName, "Marshall D. Teach");
});

test("only winning with that pirate yourself triggers the ability", () => {
  const pirate = makeSpecial("pirate", 2); // Rosie
  const yellow = makeSuit("yellow", 1);
  assert.equal(winningPirateAbility(playedCard(0, pirate), { lastTrickOfRound: false })?.id, "rosie");
  assert.equal(winningPirateAbility(playedCard(0, yellow), { lastTrickOfRound: false }), null);
  assert.equal(
    winningPirateAbility(playedCard(1, makeSpecial("tigress", 0), true), { lastTrickOfRound: false }),
    null,
  );
});

test("winning with a pirate triggers Rosie and choosing the next leader", () => {
  const g = playableGame();
  const pirate = makeSpecial("pirate", 2);
  g.players[0].hand = [pirate, makeSuit("black", 1)];
  g.players[1].hand = [makeSuit("yellow", 3), makeSuit("black", 2)];
  g.players[2].hand = [makeSuit("green", 4), makeSuit("black", 3)];
  finishTrick(g, [
    [0, pirate],
    [1, makeSuit("yellow", 3)],
    [2, makeSuit("green", 4)],
  ]);
  assert.equal(g.lastWinnerIndex, 0);
  assert.equal(g.pendingAbility?.id, "rosie");
  assert.ok(g.advanceTrickResult().needAbility);
  const bad = g.usePirateAbility("h1", { leaderIndex: 1 });
  assert.ok(bad.error);
  const ok = g.usePirateAbility("h0", { leaderIndex: 2 });
  assert.equal(ok.ok, true);
  assert.equal(g.pendingAbility, null);
  assert.equal(g.lastNextLeaderIndex, 2);
  assert.equal(g.advanceTrickResult().ok, true);
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.currentPlayerIndex, 2);
});

test("capturing a pirate does not trigger an ability", () => {
  const g = playableGame();
  const pirate = makeSpecial("pirate", 3);
  const sk = makeSpecial("skullKing");
  g.players[0].hand = [pirate, makeSuit("black", 1)];
  g.players[1].hand = [sk, makeSuit("black", 2)];
  g.players[2].hand = [makeSuit("yellow", 2), makeSuit("black", 3)];
  finishTrick(g, [
    [0, pirate],
    [1, sk],
    [2, makeSuit("yellow", 2)],
  ]);
  assert.equal(g.lastWinnerIndex, 1);
  assert.equal(g.pendingAbility, null);
  assert.equal(g.advanceTrickResult().ok, true);
});

test("Tigress played as a pirate does not get a named pirate power", () => {
  const g = playableGame();
  const tig = makeSpecial("tigress", 0);
  g.players[0].hand = [tig, makeSuit("black", 1)];
  g.players[1].hand = [makeSuit("yellow", 2), makeSuit("black", 2)];
  g.players[2].hand = [makeSuit("green", 3), makeSuit("black", 3)];
  finishTrick(g, [
    [0, tig, true],
    [1, makeSuit("yellow", 2)],
    [2, makeSuit("green", 3)],
  ]);
  assert.equal(g.lastWinnerIndex, 0);
  assert.equal(g.pendingAbility, null);
});

test("the first four abilities do not trigger on the last trick of a 局", () => {
  const g = playableGame();
  g.tricksPlayed = 5;
  g.round = 1;
  // last card in each hand
  const pirate = makeSpecial("pirate", 2);
  g.players[0].hand = [pirate];
  g.players[1].hand = [makeSuit("yellow", 2)];
  g.players[2].hand = [makeSuit("green", 3)];
  finishTrick(g, [
    [0, pirate],
    [1, makeSuit("yellow", 2)],
    [2, makeSuit("green", 3)],
  ]);
  assert.ok(g.players.every((p) => p.hand.length === 0));
  assert.equal(g.pendingAbility, null);
  assert.equal(g.advanceTrickResult().ok, true);
  assert.equal(g.phase, PHASE.ROUND_RESULT);
});

test("Harry the Giant may change the bid after the last trick", () => {
  const g = playableGame();
  g.round = 1;
  g.tricksPlayed = 5;
  g.players[0].bid = 1;
  const harry = makeSpecial("pirate", 0);
  g.players[0].hand = [harry];
  g.players[1].hand = [makeSuit("yellow", 2)];
  g.players[2].hand = [makeSuit("green", 3)];
  finishTrick(g, [
    [0, harry],
    [1, makeSuit("yellow", 2)],
    [2, makeSuit("green", 3)],
  ]);
  assert.equal(g.pendingAbility?.id, "harry");
  assert.equal(g.players[0].tricksWon, 1);
  const up = g.usePirateAbility("h0", { delta: 1 });
  assert.equal(up.ok, true);
  assert.equal(g.players[0].bid, 2);
  assert.equal(g.advanceTrickResult().ok, true);
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  // bid 2, taken 1 → miss, not the made-bid 20
  const row = g.scores.at(-1).rows.find((r) => r.playerId === "h0");
  assert.equal(row.bid, 2);
  assert.equal(row.taken, 1);
  assert.equal(row.bidPoints, -10);
});

test("Rascal of Roatan awards or deducts the side bet when scoring the 局", () => {
  assert.equal(scoreRound(1, 1, 6, 0, 20).rascalPoints, 20);
  assert.equal(scoreRound(1, 1, 6, 0, 20).total, 40);
  assert.equal(scoreRound(1, 0, 6, 0, 20).rascalPoints, -20);
  assert.equal(scoreRound(1, 0, 6, 0, 20).total, -30);
  assert.equal(scoreRound(1, 1, 6, 0, 0).rascalPoints, 0);
  assert.equal(scoreRound(1, 1, 6, 0, 0).total, 20);

  const g = playableGame();
  const rascal = makeSpecial("pirate", 3);
  g.players[0].hand = [rascal, makeSuit("black", 1)];
  g.players[1].hand = [makeSuit("yellow", 2)];
  g.players[2].hand = [makeSuit("green", 3)];
  finishTrick(g, [
    [0, rascal],
    [1, makeSuit("yellow", 2)],
    [2, makeSuit("green", 3)],
  ]);
  assert.equal(g.pendingAbility?.id, "rascal");
  assert.equal(g.usePirateAbility("h0", { bet: 20 }).ok, true);
  assert.equal(g.players[0].rascalBet, 20);
  g.players[0].tricksWon = 1;
  g.players[0].bid = 1;
  g.players.forEach((p) => { p.hand = []; });
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  const row = g.scores.at(-1).rows.find((r) => r.playerId === "h0");
  assert.equal(row.rascalPoints, 20);
  assert.equal(row.bidPoints, 20);
  assert.equal(row.roundTotal, 40);
});

test("Bendt the Bandit draws two undealt cards and then discards two from hand", () => {
  const g = playableGame();
  const bendt = makeSpecial("pirate", 4);
  const keep = makeSuit("black", 14);
  const dumpA = makeSuit("yellow", 2);
  const dumpB = makeSuit("green", 3);
  g.players[0].hand = [bendt, keep];
  g.players[1].hand = [makeSuit("purple", 1)];
  g.players[2].hand = [makeSuit("purple", 2)];
  const beforeDeck = g.deck.length;
  const drawn = g.deck.slice(0, 2).map((c) => c.id);
  finishTrick(g, [
    [0, bendt],
    [1, makeSuit("purple", 1)],
    [2, makeSuit("purple", 2)],
  ]);
  assert.equal(g.pendingAbility?.id, "bendt");
  assert.equal(g.deck.length, beforeDeck - 2);
  assert.equal(g.players[0].hand.length, 3); // keep + 2 drawn
  assert.ok(drawn.every((id) => g.players[0].hand.some((c) => c.id === id)));
  const bad = g.usePirateAbility("h0", { discardIds: [keep.id] });
  assert.ok(bad.error);
  const ok = g.usePirateAbility("h0", { discardIds: drawn });
  assert.equal(ok.ok, true);
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(g.players[0].hand[0].id, keep.id);
  assert.equal(g.discards.length, 2);
  assert.equal(g.pendingAbility, null);
});

test("Juanita's undealt cards stay private to the winner's view", () => {
  const g = playableGame();
  const juanita = makeSpecial("pirate", 1);
  g.players[0].hand = [juanita, makeSuit("black", 1)];
  g.players[1].hand = [makeSuit("yellow", 2), makeSuit("black", 2)];
  g.players[2].hand = [makeSuit("green", 3), makeSuit("black", 3)];
  const undealtIds = g.deck.map((c) => c.id);
  finishTrick(g, [
    [0, juanita],
    [1, makeSuit("yellow", 2)],
    [2, makeSuit("green", 3)],
  ]);
  assert.equal(g.pendingAbility?.id, "juanita");
  const mine = g.viewFor("h0");
  const other = g.viewFor("h1");
  assert.equal(mine.pendingAbility.isMine, true);
  assert.ok(Array.isArray(mine.pendingAbility.undealtCards));
  assert.deepEqual(mine.pendingAbility.undealtCards.map((c) => c.id), undealtIds);
  assert.equal(other.pendingAbility.isMine, false);
  assert.equal(other.pendingAbility.undealtCards, undefined);
  assert.ok(!JSON.stringify(other.pendingAbility).includes('"undealtCards"'));
  for (const id of undealtIds) assert.doesNotMatch(JSON.stringify(other.players), new RegExp(id));
  assert.equal(g.usePirateAbility("h0", { done: true }).ok, true);
  assert.equal(g.pendingAbility, null);
  assert.equal(g.deck.length, undealtIds.length);
});

test("a destroyed trick does not grant a pirate ability", () => {
  const g = playableGame();
  const pirate = makeSpecial("pirate", 2);
  const kraken = makeSpecial("kraken");
  g.players[0].hand = [pirate, makeSuit("black", 1)];
  g.players[1].hand = [kraken, makeSuit("black", 2)];
  g.players[2].hand = [makeSuit("yellow", 2), makeSuit("black", 3)];
  finishTrick(g, [
    [0, pirate],
    [1, kraken],
    [2, makeSuit("yellow", 2)],
  ]);
  assert.equal(g.lastTrickDestroyed, true);
  assert.equal(g.pendingAbility, null);
});
