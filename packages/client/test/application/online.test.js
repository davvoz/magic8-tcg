/**
 * Online play on the client: the WebSocket adapter (reconnection, request
 * and reply), OnlineService (queue, match, entropy, resume) and
 * RemoteMatchSession (commands, acks, updates), against fakes of the socket
 * and of the server.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { OnlineService, OnlineStatus } from "../../src/application/online/OnlineService.js";
import { WebSocketConnection } from "../../src/infrastructure/realtime/WebSocketConnection.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Timers that run only when told to. */
function manualTimers() {
  const pending = [];
  return {
    pending,
    setTimeout: (fn, ms) => (pending.push({ fn, ms }), pending.length),
    clearTimeout: (handle) => {
      if (pending[handle - 1]) {
        pending[handle - 1].fn = () => undefined;
      }
    },
    runAll: () => pending.splice(0).forEach((timer) => timer.fn()),
  };
}

/** A socket the test drives. */
function fakeSockets() {
  const sockets = [];
  const create = (url) => {
    const socket = { url, readyState: 0, sent: [], closed: false, send: (data) => socket.sent.push(JSON.parse(data)), close: () => (socket.closed = true), onopen: null, onclose: null, onmessage: null, onerror: null };
    socket.open = () => {
      socket.readyState = 1;
      socket.onopen?.();
    };
    socket.receive = (message) => socket.onmessage?.({ data: JSON.stringify(message) });
    socket.drop = (code) => {
      socket.readyState = 3;
      socket.onclose?.({ code });
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, create };
}

describe("WebSocketConnection", () => {
  it("matches replies to requests by id and passes other messages to subscribers", async () => {
    const { sockets, create } = fakeSockets();
    const connection = new WebSocketConnection({ url: "ws://game/ws", createSocket: create, timers: manualTimers() });
    const statuses = [];
    const pushed = [];
    connection.onStatus((status) => statuses.push(status));
    connection.subscribe((message) => pushed.push(message));
    assert.equal((await connection.request("hello", {})).error.code, "NOT_CONNECTED");
    connection.connect();
    sockets[0].open();
    const reply = connection.request("hello", { resume: null });
    const sent = sockets[0].sent[0];
    assert.deepEqual(sent, { t: "hello", id: sent.id, d: { resume: null } });
    sockets[0].receive({ t: "match.found", d: { gameId: "g" } });
    sockets[0].receive({ t: "welcome", re: sent.id, d: { user: "alice" } });
    assert.deepEqual(await reply, ok({ t: "welcome", d: { user: "alice" } }));
    assert.deepEqual(pushed, [{ t: "match.found", d: { gameId: "g" } }]);
    assert.deepEqual(statuses, ["connecting", "open"]);
  });

  it("times requests out, reconnects after a drop, but not when replaced", async () => {
    const { sockets, create } = fakeSockets();
    const timers = manualTimers();
    const connection = new WebSocketConnection({ url: "ws://game/ws", createSocket: create, timers });
    connection.connect();
    sockets[0].open();
    const unanswered = connection.request("hello", {});
    timers.runAll();
    assert.equal((await unanswered).error.code, "TIMEOUT");

    sockets[0].drop(1006);
    assert.equal(sockets.length, 1);
    timers.runAll();
    assert.equal(sockets.length, 2, "reconnected");
    sockets[1].open();
    sockets[1].drop(4000);
    timers.runAll();
    assert.equal(sockets.length, 2, "replaced by another tab: stays closed");
    connection.close();
  });
});

/** A fake connection standing in for the server. */
function fakeServer({ welcome = { activeGame: null, queue: { state: "idle" } } } = {}) {
  const statusListeners = new Set();
  const listeners = new Set();
  const requests = [];
  const replies = {
    hello: () => ({ t: "welcome", d: { user: { account: "alice" }, serverTime: 0, ...welcome } }),
    "queue.join": () => ({ t: "queue.status", d: { state: "searching" } }),
    "queue.leave": () => ({ t: "queue.status", d: { state: "idle" } }),
    "game.entropy": () => null,
    "game.command": (d) => ({ t: "game.ack", d: { commandId: d.commandId, ok: true, version: d.expectedVersion + 1 } }),
  };
  const connection = {
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (t, d) => (requests.push({ t, d }), ok(replies[t]?.(d) ?? { t: "error", d: { code: "UNKNOWN", message: "?" } })),
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  return { connection, requests, replies, push: (t, d) => listeners.forEach((listener) => listener({ t, d })), reconnect: () => statusListeners.forEach((listener) => listener("open", { code: null })) };
}

const VIEW = (overrides = {}) => ({ gameId: "01j8x3r6h2qkq4w0v7m5a9c1dz", seat: "s0", status: "ACTIVE", opponent: { account: "bob" }, version: 7, lastSeq: 3, head: "ab".repeat(32), snapshot: { version: 7, isOver: false, awaitingPlayerId: "s0" }, events: [{ type: "CARD_DRAWN" }], clock: {}, ...overrides });

function service(options) {
  const server = fakeServer(options);
  let ids = 0;
  const online = new OnlineService({
    connection: server.connection,
    randomHex: (bytes) => "cd".repeat(bytes),
    newCommandId: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
    accountDecks: () => [{ id: "deck-1", name: "Iron", faction: "iron", totalCards: 30, playable: true, problem: null }],
    logger: new MemoryLogger(),
  });
  return { online, server };
}

describe("OnlineService", () => {
  it("connects, queues, and sends entropy only after the match (and its commitment) is announced", async () => {
    const { online, server } = service();
    online.start();
    await flush();
    assert.equal(online.state.status, OnlineStatus.IDLE);
    assert.equal((await online.queue("deck-1")).ok, true);
    assert.deepEqual(server.requests.at(-1), { t: "queue.join", d: { mode: "casual", deckId: "deck-1" } });
    assert.equal(online.state.status, OnlineStatus.SEARCHING);
    assert.equal(server.requests.some((request) => request.t === "game.entropy"), false);

    server.push("match.found", { gameId: VIEW().gameId, seat: "s0", opponent: { account: "bob" }, seedCommit: "ef".repeat(32) });
    assert.equal(online.state.status, OnlineStatus.MATCHED);
    assert.equal(online.state.opponent, "bob");
    assert.deepEqual(server.requests.at(-1), { t: "game.entropy", d: { gameId: VIEW().gameId, entropy: "cd".repeat(16) } });

    const updates = [];
    online.state.session.subscribe((update) => updates.push(update));
    server.push("game.events", VIEW());
    assert.equal(online.state.status, OnlineStatus.PLAYING);
    assert.equal(online.state.session.snapshotFor("s0").version, 7);
    assert.deepEqual(updates[0].events, [{ type: "CARD_DRAWN" }]);
  });

  it("carries the decision clock from each view, keeping the last one a stale or clock-less update cannot overwrite", async () => {
    const { online, server } = service();
    online.start();
    await flush();
    server.push("match.found", { gameId: VIEW().gameId, seat: "s0", opponent: { account: "bob" }, seedCommit: "ef".repeat(32) });
    server.push("game.events", VIEW({ clock: { activeSeat: "s0", deadline: 12_345, reserveMs: { s0: 90_000, s1: 90_000 } } }));
    const session = online.state.session;
    assert.deepEqual(session.clock, { activeSeat: "s0", deadline: 12_345, reserveMs: { s0: 90_000, s1: 90_000 } });

    session.apply(VIEW({ version: 5, clock: { activeSeat: "s1", deadline: 1, reserveMs: {} } }));
    assert.equal(session.clock.deadline, 12_345, "an older state's clock never replaces a newer one either");

    session.apply(VIEW({ version: 8, clock: undefined }));
    assert.equal(session.clock.deadline, 12_345, "a fresh view that omits the clock keeps the last one shown");

    session.apply(VIEW({ version: 9, clock: { activeSeat: null, deadline: null, reserveMs: {} } }));
    assert.equal(session.clock.deadline, null, "nobody awaited: no deadline");
  });

  it("plays through the session: the command carries the version and never a player id", async () => {
    const { online, server } = service();
    online.start();
    await flush();
    server.push("game.events", VIEW());
    const session = online.state.session;
    assert.deepEqual(session.humanPlayerIds, ["s0"]);
    const done = await session.submit({ type: "END_PHASE", playerId: "s1" });
    assert.equal(done.ok, true);
    const sent = server.requests.at(-1);
    assert.equal(sent.t, "game.command");
    assert.deepEqual(sent.d.command, { type: "END_PHASE" });
    assert.equal(sent.d.expectedVersion, 7);
    server.replies["game.command"] = (d) => ({ t: "game.ack", d: { commandId: d.commandId, ok: false, error: { code: "NOT_YOUR_TURN", message: "wait" } } });
    const refused = (await session.submit({ type: "END_TURN" })).error;
    assert.deepEqual([refused.code, refused.message], ["NOT_YOUR_TURN", "wait"]);
    session.apply(VIEW({ version: 5 }));
    assert.equal(session.version, 7, "an older state never replaces a newer one");
    server.push("game.over", { gameId: VIEW().gameId, winner: "s1", reason: "CONCEDE" });
    assert.equal(online.state.status, OnlineStatus.OVER);
    assert.equal(session.result.winner, "s1");
  });

  it("resumes a running game from the welcome after a reconnection, and a left match with a fresh session", async () => {
    const { online, server } = service({ welcome: { activeGame: VIEW(), queue: { state: "idle" } } });
    online.start();
    await flush();
    assert.equal(online.state.status, OnlineStatus.PLAYING);
    const first = online.state.session;
    first.stop();
    const fresh = online.resume();
    assert.notEqual(fresh, first);
    assert.equal(fresh.snapshotFor("s0").version, 7, "rebuilt from the last state");
    assert.equal(fresh.isStopped, false);

    server.reconnect();
    await flush();
    assert.equal(online.state.session.version, 7);
  });

  it("re-sends entropy when it reconnects before the game started", async () => {
    const { online, server } = service({ welcome: { activeGame: VIEW({ status: "CREATED", snapshot: null, version: 0 }), queue: { state: "idle" } } });
    online.start();
    await flush();
    assert.equal(online.state.status, OnlineStatus.MATCHED);
    assert.ok(server.requests.some((request) => request.t === "game.entropy"));
  });

  it("reports a refused queue and another tab taking over", async () => {
    const { online, server } = service();
    online.start();
    await flush();
    server.replies["queue.join"] = () => ({ t: "error", d: { code: "VALIDATION", message: "this deck cannot be played yet" } });
    assert.equal((await online.queue("deck-1")).error.code, "VALIDATION");
    assert.equal(online.state.error.message, "this deck cannot be played yet");
    server.push("session.replaced", {});
    assert.equal(online.state.error.code, "REPLACED");
  });
});
