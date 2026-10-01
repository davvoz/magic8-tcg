/**
 * The WebSocket gateway over a real server and real sockets: upgrade checks,
 * the envelope protocol, a whole online game between two connections,
 * replacement, abuse limits, disconnect and resume.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { WebSocket } from "ws";
import { ACK_KEYS, ORIGIN, buildTestApp, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const alice = keyPair(1);
const bob = keyPair(2);
const carol = keyPair(3);

/** A WebSocket client that records every message and can wait for one. */
class Peer {
  /** @type {any[]} */
  messages = [];
  /** @type {{ type: string, test: (d: any) => boolean, resolve: (value: any) => void }[]} */
  #waiters = [];
  #next = 0;

  /**
   * @param {string} base http base url
   * @param {{ cookie?: string | null, origin?: string, path?: string }} options
   */
  constructor(base, { cookie = null, origin = ORIGIN, path = "/ws" } = {}) {
    this.socket = new WebSocket(`${base.replace("http", "ws")}${path}`, { headers: { ...(cookie === null ? {} : { Cookie: cookie }), Origin: origin } });
    this.closed = new Promise((resolve) => this.socket.on("close", (code) => resolve(code)));
    this.opened = new Promise((resolve, reject) => {
      this.socket.on("open", resolve);
      this.socket.on("unexpected-response", (_, response) => reject(new Error(String(response.statusCode))));
      this.socket.on("error", reject);
    });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      this.#waiters = this.#waiters.filter((waiter) => {
        if (waiter.type === message.t && waiter.test(message.d)) {
          waiter.resolve(message.d);
          return false;
        }
        return true;
      });
    });
  }

  /**
   * Sends a message and returns its reply (the message with re = its id).
   * @param {string} t
   * @param {unknown} d
   */
  request(t, d = {}) {
    const id = `m${(this.#next += 1)}`;
    const reply = new Promise((resolve) => {
      const check = () => {
        const found = this.messages.find((message) => message.re === id);
        if (found) {
          resolve(found);
        } else {
          setTimeout(check, 5);
        }
      };
      check();
    });
    this.socket.send(JSON.stringify({ t, id, d }));
    return reply;
  }

  /**
   * @param {string} type
   * @param {(d: any) => boolean} [test]
   */
  waitFor(type, test = () => true) {
    const seen = this.messages.find((message) => message.t === type && message.re === undefined && test(message.d));
    return seen ? Promise.resolve(seen.d) : new Promise((resolve) => this.#waiters.push({ type, test, resolve }));
  }

  close() {
    this.socket.close();
    return this.closed;
  }
}

describe("WebSocket gateway", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  const clients = {};
  const decks = {};

  before(async () => {
    setup = await buildTestApp();
    server = await listen(setup.app);
    for (const [name, keys, starter] of [["alice", alice, "precon_foundry"], ["bob", bob, "precon_shadow"], ["carol", carol, "precon_verdant"]]) {
      setup.chain.setAccount(name, [keys.publicKey]);
      clients[name] = new ApiClient(server.base);
      await clients[name].signIn(name, keys.privateKey);
      decks[name] = (await clients[name].post("/api/starter", { starterId: starter })).json.deck.id;
    }
  });

  after(() => server.close());

  const connect = async (name) => {
    setup.clock.advance(2000); // one upgrade token per 2 s per address
    const peer = new Peer(server.base, { cookie: clients[name].cookie });
    await peer.opened;
    return peer;
  };

  it("refuses upgrades without a session, from another origin, or on another path", async () => {
    await assert.rejects(new Peer(server.base).opened, /401/);
    await assert.rejects(new Peer(server.base, { cookie: clients.alice.cookie, origin: "https://evil.example" }).opened, /403/, "cross-site WebSocket hijacking");
    await assert.rejects(new Peer(server.base, { cookie: "m8_session=forged" }).opened, /401/);
    await assert.rejects(new Peer(server.base, { cookie: clients.alice.cookie, path: "/other" }).opened, /404/);
  });

  it("says hello with the user, no game and an idle queue", async () => {
    const peer = await connect("alice");
    const welcome = await peer.request("hello", { resume: null });
    assert.equal(welcome.t, "welcome");
    assert.equal(welcome.d.user.account, "alice");
    assert.equal(welcome.d.activeGame, null);
    assert.deepEqual(welcome.d.queue, { state: "idle" });
    assert.equal(welcome.d.ackKey, ACK_KEYS.publicKey, "the key every ack is signed with");
    await peer.close();
  });

  it("answers malformed and unknown messages without crashing, and closes on oversized ones", async () => {
    const peer = await connect("carol");
    peer.socket.send("not json");
    peer.socket.send(JSON.stringify({ t: "hello", d: [], extra: 1 }));
    const unknown = await peer.request("game.cheat", {});
    assert.deepEqual([unknown.t, unknown.d.code], ["error", "UNKNOWN_MESSAGE"]);
    const invalid = await peer.request("queue.join", { mode: "casual", deckId: decks.carol, price: 0 });
    assert.deepEqual([invalid.t, invalid.d.code], ["error", "VALIDATION"], "unknown fields are refused");
    assert.equal(peer.messages.filter((message) => message.d?.code === "BAD_MESSAGE").length, 2);
    peer.socket.send(JSON.stringify({ t: "hello", d: { resume: "x".repeat(5000) } }));
    assert.equal(await peer.closed, 1009, "message too big");
  });

  it("closes a connection that floods the server", async () => {
    const peer = await connect("carol");
    for (let index = 0; index < 80; index += 1) {
      peer.socket.send(JSON.stringify({ t: "hello", d: {} }));
    }
    assert.equal(await peer.closed, 4008);
    assert.ok(peer.messages.some((message) => message.d?.code === "RATE_LIMITED"));
  });

  it("limits upgrade attempts per address before looking up any session", async () => {
    setup.clock.advance(60_000);
    const refused = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      refused.push(await new Peer(server.base, { cookie: "m8_session=guess" }).opened.catch((error) => error.message));
    }
    assert.deepEqual(refused.slice(0, 10), new Array(10).fill("401"));
    assert.deepEqual(refused.slice(10), ["429", "429"], "a burst of guesses is cut off");
  });

  it("drops a client that stops reading instead of buffering for it without bound", async () => {
    const peer = await connect("carol");
    peer.socket.pause();
    const big = "x".repeat(64 * 1024);
    const userId = (await setup.users.findOrCreate({ network: "steem", account: "carol" }, setup.clock.now(), randomUUID())).id;
    for (let index = 0; index < 200; index += 1) {
      setup.app.hub.send(userId, "noise", { big });
    }
    peer.socket.resume();
    assert.equal(await peer.closed, 1006, "terminated");
  });

  it("replaces an older connection of the same user", async () => {
    const first = await connect("carol");
    const second = await connect("carol");
    assert.equal(await first.closed, 4000);
    assert.ok(first.messages.some((message) => message.t === "session.replaced"));
    assert.equal((await second.request("hello", {})).t, "welcome");
    await second.close();
  });

  it("plays an online game: queue, match, entropy, moves, hostile moves, resume, concede", async () => {
    const a = await connect("alice");
    const b = await connect("bob");
    assert.equal((await a.request("queue.join", { mode: "casual", deckId: decks.alice })).d.state, "searching");
    await b.request("queue.join", { mode: "casual", deckId: decks.bob });
    const [foundA, foundB] = await Promise.all([a.waitFor("match.found"), b.waitFor("match.found")]);
    assert.equal(foundA.gameId, foundB.gameId);
    const { gameId } = foundA;
    const declined = await a.request("game.decline", { gameId });
    assert.deepEqual([declined.t, declined.d.code, declined.d.details.code], ["error", "CONFLICT", "GAME_NOT_ACTIVE"], "a v1 game has no Keychain acceptance to decline");

    const joined = await a.request("game.entropy", { gameId, entropy: "1a".repeat(16) });
    assert.deepEqual(joined, { t: "game.joined", re: joined.re, d: { gameId } }, "every request gets a reply");
    b.socket.send(JSON.stringify({ t: "game.entropy", d: { gameId, entropy: "2b".repeat(16) } }));
    const [startA, startB] = await Promise.all([a.waitFor("game.events", (d) => d.status === "ACTIVE"), b.waitFor("game.events", (d) => d.status === "ACTIVE")]);
    assert.equal(startA.snapshot.perspectivePlayerId, "s0");
    assert.equal(startB.snapshot.perspectivePlayerId, "s1");
    const first = startA.snapshot.activePlayerId;
    const [mover, idle] = first === "s0" ? [a, b] : [b, a];
    const moverView = first === "s0" ? startA : startB;

    // Carol finds the game in the public list and watches it; a player cannot.
    const live = (await new ApiClient(server.base).get("/api/games/live")).json.games;
    assert.deepEqual(live.map((game) => [game.gameId, game.players.map((player) => player.account)]), [[gameId, ["alice", "bob"]]]);
    const watcher = await connect("carol");
    const watching = await watcher.request("watch.start", { gameId });
    assert.equal(watching.t, "watch.state");
    assert.ok(watching.d.snapshot.players.every((player) => player.hand === null), "a spectator sees no hand");
    assert.equal(watching.d.snapshot.legalMoves, null);
    const own = await a.request("watch.start", { gameId });
    assert.deepEqual([own.t, own.d.code, own.d.details.code], ["error", "CONFLICT", "PLAYER_CANNOT_WATCH"]);

    const wrong = await idle.request("game.command", { gameId, commandId: randomUUID(), expectedVersion: moverView.version, command: { type: "END_PHASE" } });
    assert.deepEqual([wrong.t, wrong.d.ok, wrong.d.error.code], ["game.ack", false, "NOT_YOUR_TURN"]);
    const spoofed = await idle.request("game.command", { gameId, commandId: randomUUID(), expectedVersion: moverView.version, command: { type: "END_PHASE", playerId: first } });
    assert.equal(spoofed.d.error.code, "NOT_YOUR_TURN", "a player id in the command is ignored");

    const commandId = randomUUID();
    const ack = await mover.request("game.command", { gameId, commandId, expectedVersion: moverView.version, command: { type: "END_PHASE" } });
    assert.equal(ack.d.ok, true, JSON.stringify(ack));
    const seen = await idle.waitFor("game.events", (d) => d.version === ack.d.version);
    assert.equal(seen.head, ack.d.head, "both see the same chain head");
    const streamed = await watcher.waitFor("watch.events", (d) => d.version === ack.d.version);
    assert.equal(streamed.head, ack.d.head, "and so does the spectator");
    const again = await mover.request("game.command", { gameId, commandId, expectedVersion: moverView.version, command: { type: "END_PHASE" } });
    assert.deepEqual(again.d, ack.d, "a re-sent command gets the same ack");

    // The idle player drops and comes back: the welcome carries the game.
    await idle.close();
    const back = await connect(idle === a ? "alice" : "bob");
    const welcome = await back.request("hello", { resume: { gameId, lastSeq: 0 } });
    assert.equal(welcome.d.activeGame.gameId, gameId);
    assert.equal(welcome.d.activeGame.version, ack.d.version);
    const synced = await back.request("game.sync", { gameId });
    assert.equal(synced.t, "game.state");
    assert.equal(synced.d.head, ack.d.head);

    const concede = await back.request("game.concede", { gameId, commandId: randomUUID() });
    assert.equal(concede.d.ok, true);
    const [overMover, overBack] = await Promise.all([mover.waitFor("game.over"), back.waitFor("game.over")]);
    assert.equal(overMover.winner, first, "the player who conceded lost");
    assert.equal(overBack.winner, first);
    assert.equal((await watcher.waitFor("watch.over")).winner, first, "the spectator sees the end");
    await watcher.close();
    const noGame = await back.request("game.sync", { gameId: "0".repeat(26) });
    assert.deepEqual([noGame.t, noGame.d.code], ["error", "NOT_FOUND"]);
    await Promise.all([mover.close(), back.close()]);
  });

  it("takes a disconnected player out of the queue", async () => {
    const peer = await connect("carol");
    await peer.request("queue.join", { mode: "casual", deckId: decks.carol });
    assert.deepEqual((await setup.app.matchmaking.status((await peer.request("hello", {})).d.user.id)).state, "searching");
    const userId = (await peer.request("hello", {})).d.user.id;
    await peer.close();
    for (let attempt = 0; attempt < 50 && (await setup.app.matchmaking.status(userId)).state !== "idle"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await setup.app.matchmaking.status(userId)).state, "idle");
  });
});
