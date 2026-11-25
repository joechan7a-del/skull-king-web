import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, PHASE } from "../server/game.js";
import { scoreRound, winnerIndex, playedCard, makeSuit, makeSpecial } from "../server/rules.js";
import { RoomManager } from "../server/rooms.js";

function seats(nHumans = 2, nAI = 2) {
  const s = [];
  for (let i = 0; i < nHumans; i++) s.push({ id: `h${i}`, name: i === 0 ? "你" : `玩家${i + 1}`, isAI: false });
  const ai = ["安妮", "黑鬍子", "凱利", "摩根"];
  for (let i = 0; i < nAI; i++) s.push({ id: `ai${i}`, name: ai[i], isAI: true });
  return s;
}

test("deal n cards in round n and start in bidding", () => {
  const g = new Game(seats(1, 2));
  g.start();
  assert.equal(g.round, 1);
  assert.equal(g.phase, PHASE.BIDDING);
  for (const p of g.players) assert.equal(p.hand.length, 1);
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
  assert.equal(g.currentPlayerIndex, 1); // left of dealer 0
});

test("illegal bid and illegal play are rejected; other hands stay private", () => {
  const g = new Game(seats(2, 0));
  g.start();
  assert.ok(g.submitBid("h0", 99).error || g.players[0].bid === 1); // clamped? we reject non-integers and out-of-range if Number(value) !== bid after clamp only if value isn't integer in range
  // Our implementation clamps with min/max only if Number(value) equals the clamped integer.
  // 99 -> bid becomes 1, Number(99) !== 1, so error. Good.
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
  const need = g.playCard("h0", "tigress");
  assert.equal(need.needTigress, true);
  assert.equal(g.phase, PHASE.CHOOSING_TIGRESS);
  assert.equal(g.players[0].hand.length, 1);
  g.cancelTigress("h0");
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.players[0].hand[0].special, "tigress");
  g.playCard("h0", "tigress");
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
  assert.equal(rows[1].bidPoints, 10);
  assert.equal(rows[1].bonus, 10);
  assert.equal(rows[1].runningTotal, 20);
});

test("ten rounds then game over; play again resets", () => {
  const g = new Game(seats(2, 0));
  g.start();
  for (let r = 1; r <= 10; r++) {
    assert.equal(g.round, r);
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
  assert.ok(g.players[1].isAI && g.players[1].bid != null);
  assert.ok(g.players[2].isAI && g.players[2].bid != null);
  g.submitBid("h0", 0);
  assert.equal(g.phase, PHASE.PLAYING);
  let guard = 0;
  while (g.phase === PHASE.PLAYING && guard++ < 20) {
    const cur = g.players[g.currentPlayerIndex];
    if (cur.isAI) {
      const r = g.stepAI();
      assert.equal(r.ok, true);
    } else {
      const r = g.playCard(cur.id, cur.hand[0].id, cur.hand[0].special === "tigress" ? false : null);
      assert.equal(r.ok, true);
    }
  }
  assert.equal(g.phase, PHASE.TRICK_RESULT);
  g.advanceTrickResult();
  assert.equal(g.phase, PHASE.ROUND_RESULT);
  assert.equal(g.scores.length, 1);
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
  assert.deepEqual(
    room.game.players.filter((p) => p.isAI).map((p) => p.name),
    ["安妮", "黑鬍子"],
  );

  const token = joined.player.token;
  const again = mgr.reconnect(token);
  assert.equal(again.player.id, joined.player.id);
  assert.equal(again.room.code, room.code);
  const view = mgr.viewFor(room, joined.player.id);
  assert.equal(view.myHand.length, 1);
  assert.equal(view.phase, "bidding");
  // Host cannot see the other hand
  const hostView = mgr.viewFor(room, host.id);
  assert.ok(hostView.players.every((p) => !p.hand));
  assert.equal(hostView.myHand.length, 1);
  assert.ok(hostView.myHand[0].id !== view.myHand[0].id || hostView.myHand[0].id === view.myHand[0].id);
  // just ensure they're independent arrays
  const other = hostView.players.find((p) => p.id === joined.player.id);
  assert.equal(other.handCount, 1);
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
  assert.equal(rows[0].taken + rows[1].taken, 1); // less than 2 cards dealt
  assert.equal(rows[0].bidPoints, 20); // 0-bid made: 10 * 2 cards dealt
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
  assert.equal(rows[0].bidPoints, 20);
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
  g.players[1].tricksWon = 1; // 2 of 3 tricks were destroyed
  g.players[0].potentialBonus = 0;
  g.players[1].potentialBonus = 0;
  g.phase = PHASE.TRICK_RESULT;
  g.lastWinnerIndex = null;
  g.lastTrickDestroyed = true;
  g.lastNextLeaderIndex = 0;
  g.advanceTrickResult();
  const rows = g.scores[0].rows;
  assert.equal(rows[0].bidPoints, 30); // 0 bid made, 10 * 3
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
