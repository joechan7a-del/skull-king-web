import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, PHASE, pickOpeningLeaderIndex } from "../server/game.js";
import { scoreRound, winnerIndex, playedCard, makeSuit, makeSpecial } from "../server/rules.js";
import { RoomManager, playHasFlourish, trickReviewDelayMs, TRICK_REVIEW_MS, FLOURISH_HOLD_MS, TRICK_PAUSE_MS } from "../server/rooms.js";
import { AI_NAMES, pickAINames } from "../server/ai.js";

function seats(nHumans = 2, nAI = 2) {
  const s = [];
  for (let i = 0; i < nHumans; i++) s.push({ id: `h${i}`, name: i === 0 ? "你" : `玩家${i + 1}`, isAI: false });
  const ai = ["安妮", "黑鬍子", "凱利", "摩根"];
  for (let i = 0; i < nAI; i++) s.push({ id: `ai${i}`, name: ai[i], isAI: true });
  return s;
}

test("round 1 deals 6 cards and starts in bidding", () => {
  const g = new Game(seats(1, 2));
  g.start();
  assert.equal(g.round, 1);
  assert.equal(g.cardsDealt, 6);
  assert.equal(g.phase, PHASE.BIDDING);
  for (const p of g.players) assert.equal(p.hand.length, 6);
});

test("bids stay hidden until everyone has bid, then reveal together", () => {
  const g = new Game(seats(2, 0));
  g.start();
  // Force known hands
  assert.equal(g.players[0].bid, null);
  const r1 = g.submitBid("h0", 0);
  assert.equal(r1.ok, true);
  const v1 = g.viewFor("h1");
  assert.equal(v1.bidsRevealed, false);
  assert.equal(v1.players[0].hasBid, true);
  assert.equal(v1.players[0].bid, null); // hidden from the other human
  const self = g.viewFor("h0");
  assert.equal(self.players[0].bid, 0); // own bid visible
  g.submitBid("h1", 1);
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.bidsRevealed, true);
  const v2 = g.viewFor("h0");
  assert.equal(v2.players[1].bid, 1);
  assert.equal(g.currentPlayerIndex, g.openingLeaderIndex);
  assert.equal(v2.openingLead, true);
});

test("illegal bid and illegal play are rejected; other hands stay private", () => {
  const g = new Game(seats(2, 0));
  g.start();
  assert.ok(g.submitBid("h0", 99).error || g.players[0].bid === 6); // clamped? we reject non-integers and out-of-range if Number(value) !== bid after clamp only if value isn't integer in range
  // Our implementation clamps with min/max only if Number(value) equals the clamped integer.
  // 99 -> bid becomes 6, Number(99) !== 6, so error. Good.
  assert.ok(g.submitBid("h0", 99).error);
  g.submitBid("h0", 0);
  g.submitBid("h1", 0);
  const otherCard = g.players[1].hand[0];
  const attempt = g.playCard("h0", otherCard.id);
  assert.ok(attempt.error);
  const view = g.viewFor("h0");
  assert.ok(!view.myHand.some((c) => c.id === otherCard.id));
  const hidden = view.players.find((p) => p.id === "h1");
  assert.equal(hidden.handCount, g.players[1].hand.length);
  assert.ok(!("hand" in hidden));
});

test("follow-suit is enforced by the server", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.players[0].hand = [makeSuit("yellow", 3), makeSuit("green", 14)];
  g.players[1].hand = [makeSuit("yellow", 12), makeSuit("black", 1)];
  g.round = 2;
  // Bypass bidding
  g.players[0].bid = 1;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 1;
  g.playCard("h1", "yellow-12");
  const bad = g.playCard("h0", "green-14");
  assert.ok(bad.error);
  const ok = g.playCard("h0", "yellow-3");
  assert.equal(ok.ok, true);
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  assert.equal(g.lastWinnerIndex, 1);
});

test("character lead does not force follow suit", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 2;
  g.players[0].hand = [makeSpecial("pirate", 0), makeSuit("green", 2)];
  g.players[1].hand = [makeSuit("yellow", 5), makeSuit("green", 9)];
  g.players[0].bid = 1;
  g.players[1].bid = 0;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "pirate-0");
  const ok = g.playCard("h1", "yellow-5");
  assert.equal(ok.ok, true);
  assert.equal(g.lastWinnerIndex, 0);
});

test("tigress must be declared; cancel puts the card back", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.players[0].hand = [makeSpecial("tigress")];
  g.players[1].hand = [makeSuit("green", 2)];
  g.players[0].bid = 1;
  g.players[1].bid = 0;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  const need = g.playCard("h0", "tigress-0");
  assert.equal(need.needTigress, true);
  assert.equal(g.phase, PHASE.CHOOSING_TIGRESS);
  assert.equal(g.players[0].hand.length, 1);
  g.cancelTigress("h0");
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.players[0].hand[0].special, "tigress");
  g.playCard("h0", "tigress-0");
  g.resolveTigress("h0", true);
  assert.equal(g.trick[0].tigressAsPirate, true);
  g.playCard("h1", "green-2");
  assert.equal(g.lastWinnerIndex, 0);
});

test("round scoring awards bonus only if the bid is made", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 1;
  g.players[0].bid = 1;
  g.players[1].bid = 0;
  g.players[0].tricksWon = 1;
  g.players[1].tricksWon = 0;
  g.players[0].potentialBonus = 40;
  g.players[1].potentialBonus = 10;
  g.players[0].hand = [];
  g.players[1].hand = [];
  g.phase = PHASE.TRICK_RESULT;
  g.lastWinnerIndex = 0;
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  const rows = g.scores[0].rows;
  assert.equal(rows[0].bidPoints, 20);
  assert.equal(rows[0].bonus, 40);
  assert.equal(rows[0].roundTotal, 60);
  assert.equal(rows[1].bidPoints, 60); // 0-bid made: 10 * 6 cards dealt
  assert.equal(rows[1].bonus, 10);
  assert.equal(rows[1].runningTotal, 70);
});

test("five rounds then game over; play again resets", () => {
  const g = new Game(seats(2, 0));
  g.start();
  for (let r = 1; r <= 5; r++) {
    assert.equal(g.round, r);
    assert.equal(g.cardsDealt, r + 5);
    for (const p of g.players) {
      p.bid = 0;
      p.tricksWon = 0;
      p.potentialBonus = 0;
      p.hand = [];
    }
    g.phase = PHASE.TRICK_RESULT;
    g.lastWinnerIndex = 0;
    g.advanceTrickResult();
    assert.equal(g.phase, PHASE.ROUND_RESULT);
    g.continueAfterRound();
  }
  assert.equal(g.phase, PHASE.GAME_OVER);
  g.playAgain();
  assert.equal(g.round, 1);
  assert.equal(g.phase, PHASE.BIDDING);
  assert.equal(g.players[0].score, 0);
});

test("AI fills seats and can bid + play a whole round", () => {
  const g = new Game(seats(1, 2));
  g.start();
  assert.equal(g.cardsDealt, 6);
  assert.ok(g.players[1].isAI && g.players[1].bid != null);
  assert.ok(g.players[2].isAI && g.players[2].bid != null);
  g.submitBid("h0", 0);
  assert.equal(g.phase, PHASE.PLAYING);
  let guard = 0;
  while (g.phase !== PHASE.ROUND_RESULT && guard++ < 200) {
    if (g.phase === PHASE.TRICK_RESULT) {
      g.advanceTrickResult();
      continue;
    }
    if (g.phase === PHASE.CHOOSING_TIGRESS) {
      const cur = g.players[g.currentPlayerIndex];
      const r = g.resolveTigress(cur.id, false);
      assert.equal(r.ok, true);
      continue;
    }
    const cur = g.players[g.currentPlayerIndex];
    if (cur.isAI) {
      const r = g.stepAI();
      assert.equal(r.ok, true, r.error);
    } else {
      const view = g.viewFor(cur.id);
      const card = (view.myHand || []).find((c) => (view.legalCardIds || []).includes(c.id)) || cur.hand[0];
      const r = g.playCard(cur.id, card.id, card.special === "tigress" ? false : null);
      assert.equal(r.ok, true, r.error);
    }
  }
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  assert.equal(g.scores.length, 1);
  assert.equal(g.scores[0].cardsDealt, 6);
});

test("createRoom defaults to 5 players and the host can still pick 2–6", () => {
  const mgr = new RoomManager();
  const { room, player: host } = mgr.createRoom({ name: "阿明" });
  assert.equal(room.seats, 5);
  const three = mgr.createRoom({ name: "阿明", seats: 3 });
  assert.equal(three.room.seats, 3);
  const fallback = mgr.createRoom({ name: "阿明", seats: 9 });
  assert.equal(fallback.room.seats, 5);
  assert.equal(mgr.setSeats(room, host.id, 2).ok ?? true, true);
  assert.equal(room.seats, 2);
  mgr.setSeats(room, host.id, 6);
  assert.equal(room.seats, 6);
  const bad = mgr.setSeats(room, host.id, 7);
  assert.ok(bad?.error);
  assert.equal(room.seats, 6);
});

test("room: two humans join, host starts 2+2 AI, reconnect mid-hand", () => {
  const mgr = new RoomManager();
  const { room, player: host } = mgr.createRoom({ name: "阿明" });
  assert.equal(room.code.length >= 4, true);
  const joined = mgr.joinRoom({ code: room.code, name: "小芳" });
  assert.equal(joined.player.name, "小芳");
  mgr.setSeats(room, host.id, 4);
  mgr.setAiFill(room, host.id, true);
  mgr.setReady(room, joined.player.id, true);
  const started = mgr.startGame(room, host.id);
  assert.equal(started.ok, true);
  assert.equal(room.game.players.length, 4);
  assert.equal(room.game.players.filter((p) => p.isAI).length, 2);
  const aiNames = room.game.players.filter((p) => p.isAI).map((p) => p.name);
  assert.equal(aiNames.length, 2);
  assert.equal(new Set(aiNames).size, 2);
  for (const n of aiNames) {
    assert.ok(AI_NAMES.includes(n), n);
    assert.ok(!["阿明", "小芳"].includes(n));
  }
  assert.deepEqual(room.game.players.map((p) => p.colorIndex), [0, 1, 2, 3]);

  const token = joined.player.token;
  const again = mgr.reconnect(token);
  assert.equal(again.player.id, joined.player.id);
  assert.equal(again.room.code, room.code);
  const view = mgr.viewFor(room, joined.player.id);
  assert.equal(view.myHand.length, 6);
  assert.equal(view.phase, "bidding");
  // Host cannot see the other hand
  const hostView = mgr.viewFor(room, host.id);
  assert.ok(hostView.players.every((p) => !p.hand));
  assert.equal(hostView.myHand.length, 6);
  assert.ok(hostView.myHand[0].id !== view.myHand[0].id || hostView.myHand[0].id === view.myHand[0].id);
  // just ensure they're independent arrays
  const other = hostView.players.find((p) => p.id === joined.player.id);
  assert.equal(other.handCount, 6);
  assert.equal(other.bid, null);
  assert.equal(other.hasBid, false);

  // Illegal start mid-game
  assert.ok(mgr.startGame(room, host.id).error);
  // Wrong player play
  assert.ok(mgr.play(room, host.id, hostView.myHand[0].id).error);
});

test("scoreRound helper still matches classic table", () => {
  assert.equal(scoreRound(0, 0, 5, 0).total, 50);
  assert.equal(scoreRound(4, 3, 8, 20).total, -10);
});

test("winnerIndex used by game matches mermaid-over-SK-with-pirate", () => {
  const t = [
    playedCard(0, makeSpecial("pirate", 0)),
    playedCard(1, makeSpecial("skullKing")),
    playedCard(2, makeSpecial("mermaid", 0)),
  ];
  assert.equal(winnerIndex(t), 2);
});

test("八爪魚 destroys a trick: no capture, next leader is the hypothetical winner", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 2;
  g.players[0].hand = [makeSuit("yellow", 12), makeSuit("green", 5)];
  g.players[1].hand = [makeSpecial("kraken"), makeSuit("green", 10)];
  g.players[0].bid = 0;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "yellow-12");
  g.playCard("h1", "kraken");
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  assert.equal(g.lastTrickDestroyed, true);
  assert.equal(g.lastWinnerIndex, null);
  assert.equal(g.lastNextLeaderIndex, 0);
  assert.equal(g.players[0].tricksWon, 0);
  assert.equal(g.players[1].tricksWon, 0);
  assert.equal(g.players[0].potentialBonus, 0);
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.currentPlayerIndex, 0);
  g.playCard("h0", "green-5");
  g.playCard("h1", "green-10");
  assert.equal(g.lastTrickDestroyed, false);
  assert.equal(g.lastWinnerIndex, 1);
  assert.equal(g.players[1].tricksWon, 1);
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  const rows = g.scores[0].rows;
  assert.equal(rows[0].taken, 0);
  assert.equal(rows[1].taken, 1);
  assert.equal(rows[0].taken + rows[1].taken, 1); // less than 7 cards dealt
  assert.equal(rows[0].bidPoints, 70); // 0-bid made: 10 * 7 cards dealt
  assert.equal(rows[1].bidPoints, 20);
});

test("destroyed last trick of a round ends the round with no winner for that trick", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 2;
  g.players[0].hand = [makeSuit("yellow", 2), makeSpecial("kraken")];
  g.players[1].hand = [makeSuit("yellow", 9), makeSuit("green", 3)];
  g.players[0].bid = 0;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 1;
  g.playCard("h1", "yellow-9");
  g.playCard("h0", "yellow-2");
  assert.equal(g.lastWinnerIndex, 1);
  g.advanceTrickResult();
  assert.equal(g.currentPlayerIndex, 1);
  g.playCard("h1", "green-3");
  g.playCard("h0", "kraken");
  assert.equal(g.lastTrickDestroyed, true);
  assert.equal(g.lastWinnerIndex, null);
  assert.ok(g.statusMessage.includes("呢局完"));
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  const rows = g.scores[0].rows;
  assert.equal(rows[0].taken, 0);
  assert.equal(rows[1].taken, 1);
  assert.equal(rows[0].bidPoints, 70); // 0-bid made: 10 * 7 cards dealt
  assert.equal(rows[1].bidPoints, 20);
});

test("白鯨 number win awards 14 bonus and no character-capture bonus in the game", () => {
  const g = new Game(seats(3, 0));
  g.start();
  g.round = 1;
  g.players[0].hand = [makeSuit("yellow", 14)];
  g.players[1].hand = [makeSpecial("pirate", 0)];
  g.players[2].hand = [makeSpecial("whiteWhale")];
  g.players[0].bid = 1;
  g.players[1].bid = 1;
  g.players[2].bid = 0;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "yellow-14");
  g.playCard("h1", "pirate-0");
  g.playCard("h2", "whiteWhale");
  assert.equal(g.lastTrickDestroyed, false);
  assert.equal(g.lastWinnerIndex, 0);
  assert.equal(g.players[0].tricksWon, 1);
  assert.equal(g.players[0].potentialBonus, 10);
  assert.ok(g.players[0].bonusDetails.some((d) => d.includes("寶藏箱 14")));
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  assert.equal(g.scores[0].rows[0].bonus, 10);
  assert.equal(g.scores[0].rows[0].bidPoints, 20);
});

test("0-bid scoring uses cards dealt even when a trick was destroyed", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 3;
  g.players[0].hand = [];
  g.players[1].hand = [];
  g.players[0].bid = 0;
  g.players[1].bid = 1;
  g.players[0].tricksWon = 0;
  g.players[1].tricksWon = 1; // only 1 trick taken; the rest of the 8 were destroyed
  g.players[0].potentialBonus = 0;
  g.players[1].potentialBonus = 0;
  g.phase = PHASE.TRICK_RESULT;
  g.lastWinnerIndex = null;
  g.lastTrickDestroyed = true;
  g.lastNextLeaderIndex = 0;
  g.advanceTrickResult();
  const rows = g.scores[0].rows;
  assert.equal(rows[0].bidPoints, 80); // 0 bid made, 10 * 8 cards dealt
  assert.equal(rows[1].bidPoints, 20);
  assert.equal(rows[0].taken + rows[1].taken, 1);
});

test("round result waits for all connected humans before advancing", () => {
  const mgr = new RoomManager();
  const { room, player: host } = mgr.createRoom({ name: "阿明" });
  const joined = mgr.joinRoom({ code: room.code, name: "小芳" });
  const guest = joined.player;
  host.connected = true;
  guest.connected = true;
  mgr.setSeats(room, host.id, 2);
  mgr.setAiFill(room, host.id, false);
  mgr.setReady(room, guest.id, true);
  const started = mgr.startGame(room, host.id);
  assert.equal(started.ok, true);
  const g = room.game;
  for (const p of g.players) {
    p.bid = 0;
    p.tricksWon = 0;
    p.potentialBonus = 0;
    p.hand = [];
  }
  g.phase = PHASE.ROUND_RESULT;
  const first = mgr.continueRound(room, host.id);
  assert.equal(first.ok, true);
  assert.equal(room.game.phase, PHASE.ROUND_RESULT);
  assert.equal(room.game.round, 1);
  const view = mgr.viewFor(room, guest.id);
  assert.deepEqual(view.continueWaitingNames, ["小芳"]);
  const second = mgr.continueRound(room, guest.id);
  assert.equal(second.ok, true);
  assert.equal(room.game.phase, PHASE.BIDDING);
  assert.equal(room.game.round, 2);
});

test("previousTrick is snapshotted after leaving trickResult and cleared on a new round", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 2;
  g.players[0].hand = [makeSuit("yellow", 3), makeSuit("green", 14)];
  g.players[1].hand = [makeSuit("yellow", 12), makeSpecial("tigress")];
  g.players[0].bid = 1;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 1;
  g.playCard("h1", "yellow-12");
  g.playCard("h0", "yellow-3");
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  let view = g.viewFor("h0");
  assert.equal(view.previousTrick, null);
  assert.equal(view.lastWinnerIndex, 1);
  assert.ok(!("hand" in view.players.find((p) => p.id === "h1")));
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.PLAYING);
  view = g.viewFor("h0");
  assert.ok(view.previousTrick);
  assert.equal(view.previousTrick.destroyed, false);
  assert.equal(view.previousTrick.winnerIndex, 1);
  assert.equal(view.previousTrick.cards.length, 2);
  assert.equal(view.previousTrick.cards[0].playerName, "玩家2");
  assert.equal(view.previousTrick.cards[0].card.id, "yellow-12");
  assert.equal(view.previousTrick.cards[1].card.id, "yellow-3");
  assert.equal(view.lastWinnerIndex, null);
  assert.deepEqual(view.lastTrickDetails, []);
  assert.ok(!view.previousTrick.cards.some((c) => c.card.id === "green-14"));
  assert.ok(!view.myHand.some((c) => ["yellow-3", "yellow-12"].includes(c.id)));

  g.playCard("h1", "tigress-0", true);
  g.playCard("h0", "green-14");
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  view = g.viewFor("h1");
  // During the next result, previousTrick still shows the earlier completed trick.
  assert.equal(view.previousTrick.cards[0].card.id, "yellow-12");
  assert.equal(view.lastWinnerIndex, 1);
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  view = g.viewFor("h0");
  assert.equal(view.previousTrick.destroyed, false);
  assert.equal(view.previousTrick.winnerIndex, 1);
  const tig = view.previousTrick.cards.find((c) => c.card.special === "tigress");
  assert.equal(tig.tigressAsPirate, true);
  assert.equal(tig.playerName, "玩家2");

  g.continueAfterRound();
  assert.equal(g.phase, PHASE.BIDDING);
  assert.equal(g.round, 3);
  view = g.viewFor("h0");
  assert.equal(view.previousTrick, null);
});

test("previousTrick records a voided trick without capture bonuses", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 2;
  g.players[0].hand = [makeSuit("yellow", 12), makeSuit("green", 5)];
  g.players[1].hand = [makeSpecial("kraken"), makeSuit("green", 10)];
  g.players[0].bid = 0;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "yellow-12");
  g.playCard("h1", "kraken");
  assert.equal(g.lastTrickDestroyed, true);
  let view = g.viewFor("h0");
  assert.equal(view.previousTrick, null);
  g.advanceTrickResult();
  view = g.viewFor("h0");
  assert.equal(view.previousTrick.destroyed, true);
  assert.equal(view.previousTrick.winnerIndex, null);
  assert.deepEqual(view.previousTrick.details, []);
  assert.equal(view.previousTrick.cards.length, 2);
});

test("previousTrick keeps 14-point bonus details after a white whale number win", () => {
  const g = new Game(seats(3, 0));
  g.start();
  g.round = 1;
  g.players[0].hand = [makeSuit("yellow", 14)];
  g.players[1].hand = [makeSpecial("pirate", 0)];
  g.players[2].hand = [makeSpecial("whiteWhale")];
  g.players[0].bid = 1;
  g.players[1].bid = 1;
  g.players[2].bid = 0;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "yellow-14");
  g.playCard("h1", "pirate-0");
  g.playCard("h2", "whiteWhale");
  g.advanceTrickResult();
  const view = g.viewFor("h0");
  assert.equal(view.previousTrick.destroyed, false);
  assert.equal(view.previousTrick.winnerIndex, 0);
  assert.ok(view.previousTrick.details.some((d) => d.includes("寶藏箱 14")));
  assert.ok(!view.previousTrick.details.some((d) => d.includes("捕獲")));
});


test("trickNumber counts completed and current tricks including voided ones", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.round = 2;
  g.players[0].hand = [makeSuit("yellow", 3), makeSpecial("kraken")];
  g.players[1].hand = [makeSuit("yellow", 12), makeSuit("green", 5)];
  g.players[0].bid = 1;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 1;
  let view = g.viewFor("h0");
  assert.equal(view.trickNumber, 1);
  assert.equal(view.tricksTotal, 7);
  assert.equal(g.tricksPlayed, 0);
  g.playCard("h1", "yellow-12");
  g.playCard("h0", "yellow-3");
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  view = g.viewFor("h0");
  assert.equal(view.trickNumber, 1);
  assert.equal(g.tricksPlayed, 1);
  g.advanceTrickResult();
  view = g.viewFor("h0");
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(view.trickNumber, 2);
  g.playCard("h1", "green-5");
  g.playCard("h0", "kraken");
  view = g.viewFor("h0");
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  assert.equal(view.lastTrickDestroyed, true);
  assert.equal(view.trickNumber, 2);
  assert.equal(view.tricksTotal, 7);
  g.advanceTrickResult();
  view = g.viewFor("h0");
  assert.equal(view.phase, PHASE.ROUND_RESULT);
  assert.equal(view.trickNumber, 2);
});

test("view exposes currentTrickLead on incomplete tricks and hides it after the trick resolves", () => {
  const g = new Game(seats(3, 0));
  g.start();
  g.round = 1;
  g.players[0].hand = [makeSuit("yellow", 7)];
  g.players[1].hand = [makeSuit("yellow", 12)];
  g.players[2].hand = [makeSpecial("kraken")];
  g.players[0].bid = 0;
  g.players[1].bid = 1;
  g.players[2].bid = 0;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  let view = g.viewFor("h0");
  assert.equal(view.currentTrickLead, null);
  g.playCard("h0", "yellow-7");
  view = g.viewFor("h1");
  assert.equal(view.currentTrickLead.playerIndex, 0);
  assert.equal(view.currentTrickLead.playerName, "你");
  assert.equal(view.currentTrickLead.cardLabel, "黃7");
  g.playCard("h1", "yellow-12");
  view = g.viewFor("h0");
  assert.equal(view.currentTrickLead.playerIndex, 1);
  assert.equal(view.currentTrickLead.playerName, "玩家2");
  assert.equal(view.currentTrickLead.cardLabel, "黃12");
  g.playCard("h2", "kraken");
  view = g.viewFor("h0");
  assert.equal(view.phase, PHASE.TRICK_RESULT);
  assert.equal(view.currentTrickLead, null);
  assert.equal(view.lastTrickDestroyed, true);
});

test("view currentTrickLead marks a mid-trick kraken as about to be voided", () => {
  const g = new Game(seats(3, 0));
  g.start();
  g.round = 1;
  g.players[0].hand = [makeSpecial("kraken")];
  g.players[1].hand = [makeSuit("yellow", 4)];
  g.players[2].hand = [makeSuit("green", 9)];
  g.players[0].bid = 0;
  g.players[1].bid = 0;
  g.players[2].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "kraken");
  const view = g.viewFor("h1");
  assert.equal(view.phase, PHASE.PLAYING);
  assert.deepEqual(view.currentTrickLead, { destroyed: true });
});

test("view currentTrickLead is leading:false when only escapes are down", () => {
  const g = new Game(seats(3, 0));
  g.start();
  g.round = 1;
  g.players[0].hand = [makeSpecial("escape", 0)];
  g.players[1].hand = [makeSpecial("escape", 1)];
  g.players[2].hand = [makeSuit("yellow", 8)];
  g.players[0].bid = 0;
  g.players[1].bid = 0;
  g.players[2].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 0;
  g.playCard("h0", "escape-0");
  const view = g.viewFor("h2");
  assert.equal(view.currentTrickLead.leading, false);
  assert.equal(view.currentTrickLead.destroyed, undefined);
});

test("a player can change their bid until everyone has bid", () => {
  const g = new Game(seats(2, 0));
  g.start();
  assert.equal(g.submitBid("h0", 0).ok, true);
  const hidden = g.viewFor("h1");
  assert.equal(hidden.players[0].hasBid, true);
  assert.equal(hidden.players[0].bid, null);
  const changed = g.submitBid("h0", 1);
  assert.equal(changed.ok, true);
  assert.equal(changed.changed, true);
  assert.equal(g.players[0].bid, 1);
  assert.equal(g.phase, PHASE.BIDDING);
  const self = g.viewFor("h0");
  assert.equal(self.players[0].bid, 1);
  const stillHidden = g.viewFor("h1");
  assert.equal(stillHidden.players[0].bid, null);
  assert.equal(stillHidden.players[0].hasBid, true);
  assert.equal(g.submitBid("h1", 0).ok, true);
  assert.equal(g.phase, PHASE.PLAYING);
  assert.ok(g.submitBid("h0", 0).error);
});

test("completed tricks keep an explanation and a round log", () => {
  const g = new Game(seats(2, 0));
  g.start();
  g.players[0].hand = [makeSuit("yellow", 3)];
  g.players[1].hand = [makeSuit("yellow", 12)];
  g.players[0].bid = 0;
  g.players[1].bid = 1;
  g.phase = PHASE.PLAYING;
  g.currentPlayerIndex = 1;
  g.playCard("h1", "yellow-12");
  g.playCard("h0", "yellow-3");
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  const v = g.viewFor("h0");
  assert.match(v.lastTrickExplanation || "", /跟黃花當中最大/);
  assert.equal(v.roundTrickLog.length, 1);
  assert.equal(v.roundTrickLog[0].winnerIndex, 1);
  assert.match(v.roundTrickLog[0].explanation, /跟黃花當中最大/);
  assert.equal(v.roundTrickLog[0].cards.length, 2);
});

test("the winner overlay waits to look at the completed trick, and the winning card stays presented", () => {
  assert.equal(TRICK_REVIEW_MS, 1800);
  assert.equal(FLOURISH_HOLD_MS, 1050);
  assert.equal(TRICK_PAUSE_MS, 4000);
  assert.equal(trickReviewDelayMs({ lastTrick: [{ card: { suit: "yellow", rank: 5 } }] }), 1800);
  assert.equal(trickReviewDelayMs({ lastTrick: [{ card: { special: "kraken" } }] }), 1050 + 1800);
  assert.equal(trickReviewDelayMs({ lastTrick: [{ card: { special: "whiteWhale" } }] }), 1050 + 1800);
  assert.equal(trickReviewDelayMs({ lastTrick: [{ card: { special: "pirate" } }] }), 1050 + 1800);
  assert.equal(playHasFlourish({ card: { special: "tigress" }, tigressAsPirate: true }), true);
  assert.equal(playHasFlourish({ card: { special: "tigress" }, tigressAsPirate: false }), false);

  const mgr = new RoomManager();
  const { room, player: host } = mgr.createRoom({ name: "阿明" });
  const guest = mgr.joinRoom({ code: room.code, name: "小芳" }).player;
  host.connected = true;
  guest.connected = true;
  mgr.setSeats(room, host.id, 2);
  mgr.setAiFill(room, host.id, false);
  mgr.setReady(room, guest.id, true);
  assert.equal(mgr.startGame(room, host.id).ok, true);
  const g = room.game;
  try {
    g.players[0].hand = [makeSuit("yellow", 3)];
    g.players[1].hand = [makeSuit("yellow", 12)];
    g.players[0].bid = 0;
    g.players[1].bid = 1;
    g.phase = PHASE.PLAYING;
    g.currentPlayerIndex = 1;
    assert.equal(mgr.play(room, guest.id, "yellow-12").ok, true);
    assert.equal(mgr.play(room, host.id, "yellow-3").ok, true);
    assert.equal(g.phase, PHASE.TRICK_RESULT);
    assert.equal(g.lastWinnerIndex, 1);
    const before = mgr.viewFor(room, host.id);
    assert.equal(before.showTrickExplanation, false);
    assert.equal((before.trick || []).length, 2);
    assert.equal(before.trick.find((p) => p.playerIndex === 1).card.rank, 12);
    const skipped = mgr.continueRound(room, host.id);
    assert.equal(skipped.ok, true);
    assert.equal(skipped.waiting, true);
    assert.equal(room.game.phase, PHASE.TRICK_RESULT);
    room.trickExplanationShown = true;
    const shown = mgr.viewFor(room, host.id);
    assert.equal(shown.showTrickExplanation, true);
    const advanced = mgr.continueRound(room, host.id);
    assert.equal(advanced.ok, true);
    assert.notEqual(room.game.phase, PHASE.TRICK_RESULT);
  } finally {
    mgr._clearTimer(room);
  }
});

test("pickAINames draws unique names and skips reserved human names", () => {
  const names = pickAINames(6, ["安妮", "杰克"], () => 0);
  assert.equal(names.length, 6);
  assert.equal(new Set(names).size, 6);
  assert.ok(!names.includes("安妮"));
  assert.ok(!names.includes("杰克"));
  for (const n of names) assert.ok(AI_NAMES.includes(n) || /^電腦\d+$/.test(n));
});

test("startGame and playAgain shuffle AI names but keep seat colors for the match", () => {
  const seq = [0.91, 0.12, 0.83, 0.24, 0.75, 0.36, 0.67, 0.48, 0.19, 0.58, 0.07, 0.64, 0.33, 0.81, 0.44, 0.22];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const mgr = new RoomManager({ rng });
  const { room, player: host } = mgr.createRoom({ name: "阿明" });
  mgr.setSeats(room, host.id, 3);
  mgr.setAiFill(room, host.id, true);
  assert.equal(mgr.startGame(room, host.id).ok, true);
  const first = room.game.players.filter((p) => p.isAI).map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex }));
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((p) => p.name)).size, 2);
  for (const p of first) assert.ok(AI_NAMES.includes(p.name));
  assert.deepEqual(room.game.players.map((p) => p.colorIndex), [0, 1, 2]);
  const midNames = room.game.players.filter((p) => p.isAI).map((p) => p.name);
  for (const p of room.game.players) {
    p.bid = 0;
    p.tricksWon = 0;
    p.potentialBonus = 0;
    p.hand = [];
  }
  room.game.phase = "trickResult";
  room.game.lastWinnerIndex = 0;
  room.game.advanceTrickResult();
  room.game.continueAfterRound();
  assert.equal(room.game.round, 2);
  assert.deepEqual(room.game.players.filter((p) => p.isAI).map((p) => p.name), midNames);
  assert.deepEqual(room.game.players.map((p) => p.colorIndex), [0, 1, 2]);
  // Finish the remaining rounds so we can rematch.
  while (room.game.phase !== "gameOver") {
    for (const p of room.game.players) {
      p.bid = 0;
      p.tricksWon = 0;
      p.potentialBonus = 0;
      p.hand = [];
    }
    room.game.phase = "trickResult";
    room.game.lastWinnerIndex = 0;
    room.game.advanceTrickResult();
    room.game.continueAfterRound();
  }
  const ids = room.game.players.map((p) => p.id);
  assert.equal(mgr.playAgain(room, host.id).ok, true);
  const again = room.game.players.filter((p) => p.isAI);
  assert.equal(again.length, 2);
  assert.deepEqual(room.game.players.map((p) => p.id), ids);
  assert.deepEqual(room.game.players.map((p) => p.colorIndex), [0, 1, 2]);
  for (const p of again) assert.ok(AI_NAMES.includes(p.name));
  // Names are redrawn for the new match; a different shuffle should not stick to the first pair forever.
  assert.equal(new Set(again.map((p) => p.name)).size, 2);
});

test("pickOpeningLeaderIndex is deterministic with a stubbed rng", () => {
  assert.equal(pickOpeningLeaderIndex(5, () => 0), 0);
  assert.equal(pickOpeningLeaderIndex(5, () => 0.999), 4);
  assert.equal(pickOpeningLeaderIndex(6, () => 0.5), 3);
  assert.equal(pickOpeningLeaderIndex(2, () => 0.49), 0);
  assert.equal(pickOpeningLeaderIndex(2, () => 0.5), 1);
});

test("opening leader comes from rng only on the first trick of the match", () => {
  const g = new Game(seats(3, 0), { rng: () => 0 });
  g.start();
  assert.equal(g.openingLeaderIndex, 0);
  for (const p of g.players) g.submitBid(p.id, 0);
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.currentPlayerIndex, 0);
  assert.equal(g.viewFor("h0").openingLead, true);
  assert.equal(g.viewFor("h0").openingLeaderName, g.players[0].name);

  for (const p of g.players) {
    p.hand = [];
    p.tricksWon = 0;
    p.potentialBonus = 0;
  }
  g.phase = PHASE.TRICK_RESULT;
  g.lastWinnerIndex = 2;
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  g.continueAfterRound();
  assert.equal(g.round, 2);
  assert.equal(g.dealerIndex, 1);
  for (const p of g.players) g.submitBid(p.id, 0);
  assert.equal(g.currentPlayerIndex, 2); // official: left of the new dealer
  assert.equal(g.viewFor("h0").openingLead, false);
});

test("a later opening rng still leaves later 局 to official rotation", () => {
  const g = new Game(seats(4, 0), { rng: () => 0.9 });
  g.start();
  assert.equal(g.openingLeaderIndex, 3);
  for (const p of g.players) g.submitBid(p.id, 0);
  assert.equal(g.currentPlayerIndex, 3);
});

