import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { RoomManager } from "./rooms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const rooms = new RoomManager();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "骷髏王" });
});

app.get("/api/info", (_req, res) => {
  res.json({
    name: "骷髏王",
    port: PORT,
    lanUrls: lanUrls(PORT),
  });
});

// Shareable room links: /r/AB3K
app.get("/r/:code", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.playerId = null;
  ws.roomCode = null;
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      rooms.sendError(ws, "訊息格式不正確。");
      return;
    }
    try {
      handle(ws, msg);
    } catch (err) {
      console.error(err);
      rooms.sendError(ws, "伺服器出咗問題，請稍後再試。");
    }
  });

  ws.on("close", () => {
    detach(ws);
  });
});

function handle(ws, msg) {
  const type = msg?.type;
  if (type === "createRoom") {
    detach(ws);
    const { room, player } = rooms.createRoom({ name: msg.name, seats: msg.seats });
    attach(ws, room, player);
    rooms.send(ws, { type: "welcome", token: player.token, playerId: player.id, code: room.code });
    rooms.broadcast(room);
    return;
  }
  if (type === "joinRoom") {
    detach(ws);
    const result = rooms.joinRoom({ code: msg.code, name: msg.name, token: msg.token });
    if (result.error) return rooms.sendError(ws, result.error);
    attach(ws, result.room, result.player);
    rooms.send(ws, {
      type: "welcome",
      token: result.player.token,
      playerId: result.player.id,
      code: result.room.code,
      reconnected: !!result.reconnected,
    });
    rooms.broadcast(result.room);
    return;
  }
  if (type === "reconnect") {
    detach(ws);
    const result = rooms.reconnect(msg.token);
    if (result.error) return rooms.sendError(ws, result.error);
    attach(ws, result.room, result.player);
    rooms.send(ws, {
      type: "welcome",
      token: result.player.token,
      playerId: result.player.id,
      code: result.room.code,
      reconnected: true,
    });
    rooms.broadcast(result.room);
    return;
  }

  const room = ws.roomCode ? rooms.rooms.get(ws.roomCode) : null;
  const playerId = ws.playerId;
  if (!room || !playerId) {
    rooms.sendError(ws, "請先開房或者加入房間。");
    return;
  }

  let result = { ok: true };
  switch (type) {
    case "setSeats":
      result = rooms.setSeats(room, playerId, msg.count);
      break;
    case "setAiFill":
      result = rooms.setAiFill(room, playerId, msg.enabled);
      break;
    case "setName":
      result = rooms.setName(room, playerId, msg.name);
      break;
    case "ready":
      result = rooms.setReady(room, playerId, msg.ready);
      break;
    case "startGame":
      result = rooms.startGame(room, playerId);
      break;
    case "playAgain":
      result = rooms.playAgain(room, playerId);
      break;
    case "backToLobby":
      result = rooms.backToLobby(room, playerId);
      break;
    case "bid":
      result = rooms.bid(room, playerId, msg.value);
      break;
    case "play":
      result = rooms.play(room, playerId, msg.cardId, msg.tigressAsPirate);
      break;
    case "resolveTigress":
      result = rooms.resolveTigress(room, playerId, msg.asPirate);
      break;
    case "cancelTigress":
      result = rooms.cancelTigress(room, playerId);
      break;
    case "continueRound":
      result = rooms.continueRound(room, playerId);
      break;
    case "leave": {
      const dropSeat = !room.game;
      rooms.leave(room, playerId, { dropSeat });
      ws.playerId = null;
      ws.roomCode = null;
      rooms.send(ws, { type: "left", dropped: dropSeat });
      rooms.broadcast(room);
      return;
    }
    case "ping":
      rooms.send(ws, { type: "pong" });
      return;
    default:
      result = { error: "未知動作。" };
  }

  if (result?.error) {
    rooms.sendError(ws, result.error);
    return;
  }
  rooms.broadcast(room);
}

function attach(ws, room, player) {
  if (player.ws && player.ws !== ws) {
    try {
      player.ws.close();
    } catch {
      // ignore
    }
  }
  rooms.attachSocket(player, ws);
  ws.playerId = player.id;
  ws.roomCode = room.code;
  room.emptySince = null;
}

function detach(ws) {
  if (!ws.roomCode || !ws.playerId) return;
  const room = rooms.rooms.get(ws.roomCode);
  if (!room) return;
  const human = room.humans.find((h) => h.id === ws.playerId);
  if (human && human.ws === ws) {
    rooms.leave(room, ws.playerId, { dropSeat: false });
    rooms.broadcast(room);
  }
  ws.playerId = null;
  ws.roomCode = null;
}

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, 25000);
heartbeat.unref?.();

export function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family !== "IPv4" && net.family !== 4) continue;
      if (net.internal) continue;
      out.push(net.address);
    }
  }
  return out;
}

function lanUrls(port) {
  return lanAddresses().map((ip) => `http://${ip}:${port}`);
}

export function start(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = server.address().port;
      const urls = lanUrls(actual);
      console.log(`骷髏王已啟動： http://localhost:${actual}`);
      if (urls.length) {
        console.log("同一網絡嘅電話可以打開：");
        for (const u of urls) console.log(`  ${u}`);
      }
      resolve(server);
    });
  });
}

export { app, server, rooms };

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start();
}
