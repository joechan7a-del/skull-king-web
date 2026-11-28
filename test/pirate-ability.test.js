import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, PHASE } from "../server/game.js";
import { scoreRound, playedCard, makeSuit, makeSpecial } from "../server/rules.js";
import { RoomManager } from "../server/rooms.js";
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

function twoHumanRoom() {
  const mgr = new RoomManager();
  const { room, player: host } = mgr.createRoom({ name: "阿明" });
  const guest = mgr.joinRoom({ code: room.code, name: "小芳" }).player;
  host.connected = true;
  guest.connected = true;
  room.seats = 2;
  mgr.setAiFill(room, host.id, false);
  mgr.setReady(room, guest.id, true);
  assert.equal(mgr.startGame(room, host.id).ok, true);
  return { mgr, room, host, guest };
}

function playPirateWin(mgr, room, { lastTrick = false, copyIndex = 2 } = {}) {
  const g = room.game;
  const pirate = makeSpecial("pirate", copyIndex);
  const number = makeSuit("yellow", 3);
  g.players[0].hand = lastTrick ? [pirate] : [pirate, makeSuit("black", 1)];
  g.players[1].hand = lastTrick ? [number] : [number, makeSuit("black", 2)];
  g.players[0].bid = 1;
  g.players[1].bid = 0;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  if (lastTrick) {
    g.round = 1;
    g.tricksPlayed = 5;
  }
  assert.equal(mgr.play(room, room.humans[0].id, pirate.id).ok, true);
  assert.equal(mgr.play(room, room.humans[1].id, number.id).ok, true);
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  assert.equal(g.lastWinnerIndex, 0);
  return g;
}

test("the trick-win box is shown first; the pirate-ability prompt appears only after it is dismissed", () => {
  const { mgr, room, host } = twoHumanRoom();
  try {
    const g = playPirateWin(mgr, room, { copyIndex: 2 });
    assert.equal(g.pendingAbility?.id, "rosie");
    const before = mgr.viewFor(room, host.id);
    assert.equal(before.showTrickExplanation, false);
    assert.equal(before.showPirateAbility, false);

    room.trickExplanationShown = true;
    room.abilityPromptShown = false;
    const winBox = mgr.viewFor(room, host.id);
    assert.equal(winBox.showTrickExplanation, true);
    assert.equal(winBox.showPirateAbility, false);
    assert.ok(winBox.pendingAbility);
    const early = mgr.usePirateAbility(room, host.id, { leaderIndex: 0 });
    assert.ok(early.error);

    const dismissed = mgr.continueRound(room, host.id);
    assert.equal(dismissed.ok, true);
    assert.equal(dismissed.abilityPrompt, true);
    assert.equal(g.phase, PHASE.TRICK_RESULT);
    const ability = mgr.viewFor(room, host.id);
    assert.equal(ability.showTrickExplanation, false);
    assert.equal(ability.showPirateAbility, true);
    assert.equal(ability.pendingAbility?.id, "rosie");
    assert.equal(ability.showTrickExplanation && ability.showPirateAbility, false);

    const used = mgr.usePirateAbility(room, host.id, { leaderIndex: 1 });
    assert.equal(used.ok, true);
    assert.notEqual(room.game.phase, PHASE.TRICK_RESULT);
    assert.equal(room.game.currentPlayerIndex, 1);
  } finally {
    mgr._clearTimer(room);
  }
});

test("Harry after the last trick still waits for the win box before the bid prompt, then the 局 can end", () => {
  const { mgr, room, host } = twoHumanRoom();
  try {
    const g = playPirateWin(mgr, room, { lastTrick: true, copyIndex: 0 });
    assert.equal(g.pendingAbility?.id, "harry");
    room.trickExplanationShown = true;
    const winBox = mgr.viewFor(room, host.id);
    assert.equal(winBox.showTrickExplanation, true);
    assert.equal(winBox.showPirateAbility, false);
    assert.ok(mgr.usePirateAbility(room, host.id, { delta: 0 }).error);

    const dismissed = mgr.continueRound(room, host.id);
    assert.equal(dismissed.abilityPrompt, true);
    const ability = mgr.viewFor(room, host.id);
    assert.equal(ability.showTrickExplanation, false);
    assert.equal(ability.showPirateAbility, true);
    assert.equal(ability.pendingAbility?.id, "harry");

    const used = mgr.usePirateAbility(room, host.id, { delta: 0 });
    assert.equal(used.ok, true);
    assert.equal(room.game.phase, PHASE.ROUND_RESULT);
    const after = mgr.viewFor(room, host.id);
    assert.equal(after.showTrickExplanation, false);
    assert.equal(after.showPirateAbility, false);
  } finally {
    mgr._clearTimer(room);
  }
});
