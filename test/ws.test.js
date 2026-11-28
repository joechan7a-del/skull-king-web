import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { start, server } from "../server/index.js";

class Client {
  constructor(ws) {
    this.ws = ws;
    this.latest = null;
    this._waiters = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "state") this.latest = msg;
      this._waiters = this._waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }

  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }

  wait(pred, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w !== waiter);
        reject(new Error("timed out waiting for message"));
      }, timeout);
      const waiter = {
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      this._waiters.push(waiter);
    });
  }

  close() {
    this.ws.close();
  }
}

function open(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(new Client(ws)));
    ws.once("error", reject);
  });
}

function playCard(client) {
  const view = client.latest;
  const card = (view.myHand || []).find((c) => (view.legalCardIds || []).includes(c.id)) || view.myHand[0];
  const payload = { type: "play", cardId: card.id };
  if (card.special === "tigress") payload.tigressAsPirate = false;
  client.send(payload);
}

test("two browsers can open a room, bid together, and play a legal trick", async (t) => {
  await start(0, "127.0.0.1");
  const { port } = server.address();
  const url = `ws://127.0.0.1:${port}/ws`;

  const host = await open(url);
  const guest = await open(url);
  t.after(async () => {
    host.close();
    guest.close();
    await new Promise((resolve) => server.close(() => resolve()));
  });

  const hostWelcome = host.wait((m) => m.type === "welcome");
  const hostLobby = host.wait((m) => m.type === "state" && m.phase === "lobby");
  host.send({ type: "createRoom", name: "阿明" });
  const welcome = await hostWelcome;
  await hostLobby;
  assert.ok(welcome.code);
  assert.equal(host.latest.youAreHost, true);

  const guestWelcome = guest.wait((m) => m.type === "welcome");
  const hostTwo = host.wait((m) => m.type === "state" && m.lobbyPlayers?.length === 2);
  const guestLobby = guest.wait((m) => m.type === "state" && m.lobbyPlayers?.length === 2);
  guest.send({ type: "joinRoom", code: welcome.code, name: "小芳" });
  assert.equal((await guestWelcome).code, welcome.code);
  await hostTwo;
  await guestLobby;

  const guestReady = guest.wait((m) => m.type === "state" && m.lobbyPlayers.some((p) => p.name === "小芳" && p.ready));
  guest.send({ type: "ready", ready: true });
  await guestReady;

  const seats = host.wait((m) => m.type === "state" && m.seats === 2);
  host.send({ type: "setSeats", count: 2 });
  await seats;
  const fill = host.wait((m) => m.type === "state" && m.aiFill === false);
  host.send({ type: "setAiFill", enabled: false });
  await fill;

  const hostBidPhase = host.wait((m) => m.type === "state" && m.phase === "bidding");
  const guestBidPhase = guest.wait((m) => m.type === "state" && m.phase === "bidding");
  host.send({ type: "startGame" });
  await hostBidPhase;
  await guestBidPhase;
  assert.equal(host.latest.myHand.length, 6);
  assert.equal(guest.latest.myHand.length, 6);
  assert.notEqual(host.latest.myHand[0].id, guest.latest.myHand[0].id);

  const errP = guest.wait((m) => m.type === "error");
  guest.send({ type: "play", cardId: guest.latest.myHand[0].id });
  const err = await errP;
  assert.match(err.message, /出牌|叫牌|而家/);

  const guestSawBid = guest.wait(
    (m) => m.type === "state" && m.phase === "bidding" && m.players.some((p) => p.hasBid && p.bid == null),
  );
  host.send({ type: "bid", value: 0 });
  const mid = await guestSawBid;
  assert.equal(mid.bidsRevealed, false);

  const hostPlaying = host.wait((m) => m.type === "state" && m.phase === "playing");
  const guestPlaying = guest.wait((m) => m.type === "state" && m.phase === "playing");
  guest.send({ type: "bid", value: 1 });
  await hostPlaying;
  await guestPlaying;
  assert.equal(host.latest.bidsRevealed, true);

  // Match-start lead is a random draw; later 局 stay official. Play whoever is on turn.
  const leader = guest.latest.isMyTurn ? guest : host;
  const follower = guest.latest.isMyTurn ? host : guest;
  assert.equal(leader.latest.isMyTurn, true);
  assert.equal(follower.latest.isMyTurn, false);
  const afterLeadH = host.wait((m) => m.type === "state");
  const afterLeadG = guest.wait((m) => m.type === "state");
  playCard(leader);
  await afterLeadH;
  await afterLeadG;
  assert.equal(follower.latest.isMyTurn, true);

  const afterFollowH = host.wait((m) => m.type === "state" && (m.phase === "trickResult" || m.phase === "roundResult"));
  const afterFollowG = guest.wait((m) => m.type === "state" && (m.phase === "trickResult" || m.phase === "roundResult"));
  playCard(follower);
  await afterFollowH;
  await afterFollowG;
  assert.ok(["trickResult", "roundResult"].includes(host.latest.phase));
  assert.ok(
    /贏咗呢個回合|作廢|食咗呢個回合/.test(host.latest.statusMessage || "")
    || host.latest.phase === "roundResult",
  );
});
