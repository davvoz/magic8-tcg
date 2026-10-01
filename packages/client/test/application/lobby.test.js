/**
 * The lobby service against a scripted server: reading who is online on
 * every (re)connection and while a screen watches, challenges sent,
 * received, accepted, declined and withdrawn, the server closing them, and
 * what the toasts say about each.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ChallengeEnd, LobbyService } from "../../src/application/lobby/LobbyService.js";
import { describeLobbyEvent } from "../../src/application/lobby/describeLobbyEvent.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHALLENGE = Object.freeze({ id: "c1", from: "alice", to: "bob", mode: "ranked", expiresAt: 0, expiresInMs: 60_000 });

/** A lobby service on a scripted connection; `replies` answers requests by type. */
function harness(replies = {}) {
  const listeners = new Set();
  const statusListeners = new Set();
  const requests = [];
  /** @type {(() => void)[]} */
  const timers = [];
  const connection = {
    status: "closed",
    connect: () => undefined,
    close: () => undefined,
    request: async (t, d) => {
      requests.push({ t, d });
      const reply = replies[t];
      return typeof reply === "function" ? reply(d) : (reply ?? fail("NOT_CONNECTED", "no reply scripted"));
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  let now = 1_000;
  const lobby = new LobbyService({
    connection,
    scheduler: { delay: () => new Promise((resolve) => timers.push(resolve)) },
    now: () => now,
    logger: new MemoryLogger(),
  });
  const events = [];
  lobby.onEvent((event) => events.push(event));
  return {
    lobby,
    requests,
    events,
    push: (t, d) => listeners.forEach((listener) => listener({ t, d })),
    status: (status) => statusListeners.forEach((listener) => listener(status, { code: null })),
    tick: () => timers.splice(0).forEach((resolve) => resolve()),
    advance: (ms) => {
      now += ms;
    },
  };
}

const listing = (players, challenges = { incoming: [], outgoing: null }) => ok({ t: "lobby.players", d: { players, challenges } });

describe("LobbyService", () => {
  it("reads who is online on every connection, with the player's challenges", async () => {
    const world = harness({ "lobby.list": listing([{ account: "bob", status: "idle" }], { incoming: [CHALLENGE], outgoing: null }) });
    world.lobby.start();
    assert.equal(world.lobby.state.loaded, false);
    world.status("open");
    await flush();
    assert.deepEqual(world.lobby.state.players, [{ account: "bob", status: "idle" }]);
    assert.deepEqual(world.lobby.state.incoming.map((challenge) => [challenge.id, challenge.from, challenge.deadline]), [["c1", "alice", 61_000]]);
    assert.equal(world.lobby.state.loaded, true);

    world.status("closed");
    assert.deepEqual(world.lobby.state.incoming, [], "the server forgets the challenges of a player who left");
    world.lobby.stop();
    assert.deepEqual(world.lobby.state.players, []);
  });

  it("reads the list again every few seconds while a screen watches it", async () => {
    const world = harness({ "lobby.list": listing([]) });
    world.lobby.start();
    const unwatch = world.lobby.watch();
    await flush();
    const reads = () => world.requests.filter((request) => request.t === "lobby.list").length;
    assert.equal(reads(), 1);
    world.tick();
    await flush();
    assert.equal(reads(), 2);
    unwatch();
    world.tick();
    await flush();
    assert.equal(reads(), 2, "nobody watches: no more reads");
  });

  it("sends a challenge, and hears the answer", async () => {
    const world = harness({ "challenge.send": (d) => ok({ t: "challenge.sent", d: { ...CHALLENGE, from: "me", to: d.to, mode: d.mode } }) });
    world.lobby.start();
    const sent = await world.lobby.challenge("bob", "ranked", "deck-1");
    assert.equal(sent.ok, true);
    assert.deepEqual(world.requests.at(-1), { t: "challenge.send", d: { to: "bob", mode: "ranked", deckId: "deck-1" } });
    assert.equal(world.lobby.state.outgoing?.to, "bob");

    world.push("challenge.closed", { challengeId: "c1", reason: "declined" });
    assert.equal(world.lobby.state.outgoing, null);
    assert.deepEqual(world.events.map((event) => [event.kind, event.reason, event.outgoing]), [["closed", "declined", true]]);
    assert.deepEqual(describeLobbyEvent(world.events[0]), { title: "@bob declined your challenge", body: "Challenge someone else, or find a match in the queue.", tone: "bad", account: "bob" });
  });

  it("keeps the server's refusal as the error to show", async () => {
    const world = harness({ "challenge.send": ok({ t: "error", d: { code: "CONFLICT", message: "@bob is in a game" } }) });
    world.lobby.start();
    const sent = await world.lobby.challenge("bob", "casual", "deck-1");
    assert.equal(sent.ok, false);
    assert.deepEqual(world.lobby.state.error, { code: "CONFLICT", message: "@bob is in a game" });
    world.lobby.clearError();
    assert.equal(world.lobby.state.error, null);
  });

  it("announces a challenge received, and accepts or declines it", async () => {
    const world = harness({ "challenge.accept": ok({ t: "challenge.accepted", d: { challengeId: "c1", gameId: "g1" } }), "challenge.decline": ok({ t: "challenge.declined", d: { challengeId: "c2" } }) });
    world.lobby.start();
    world.push("challenge.received", CHALLENGE);
    world.push("challenge.received", { ...CHALLENGE, id: "c2", from: "carol", mode: "casual" });
    assert.deepEqual(world.lobby.state.incoming.map((challenge) => challenge.id), ["c1", "c2"]);
    assert.deepEqual(describeLobbyEvent(world.events[0]), { title: "@alice challenges you", body: "To a ranked game. Open Play online to answer within a minute.", tone: "info", account: "alice" });

    const accepted = await world.lobby.accept("c1", "deck-1");
    assert.deepEqual(accepted, ok({ gameId: "g1" }));
    await world.lobby.decline("c2");
    assert.deepEqual(world.requests.map((request) => request.t), ["challenge.accept", "challenge.decline"]);
    assert.deepEqual(world.lobby.state.incoming, []);
  });

  it("drops a challenge that is no longer open when accepting it fails, but keeps it for a deck problem", async () => {
    let answer = ok({ t: "error", d: { code: "VALIDATION", message: "this deck cannot be played yet" } });
    const world = harness({ "challenge.accept": () => answer });
    world.lobby.start();
    world.push("challenge.received", CHALLENGE);
    assert.equal((await world.lobby.accept("c1", "draft")).ok, false);
    assert.equal(world.lobby.state.incoming.length, 1, "another deck may do");
    answer = ok({ t: "error", d: { code: "NOT_FOUND", message: "this challenge is no longer open" } });
    assert.equal((await world.lobby.accept("c1", "deck-1")).ok, false);
    assert.deepEqual(world.lobby.state.incoming, []);
  });

  it("withdraws the challenge out, and hears when a received one closes", async () => {
    const world = harness({ "challenge.send": ok({ t: "challenge.sent", d: { ...CHALLENGE, from: "me" } }), "challenge.cancel": ok({ t: "challenge.cancelled", d: { challengeId: "c1" } }) });
    world.lobby.start();
    await world.lobby.challenge("bob", "ranked", "deck-1");
    await world.lobby.cancel();
    assert.deepEqual(world.requests.at(-1), { t: "challenge.cancel", d: { challengeId: "c1" } });
    assert.equal(world.lobby.state.outgoing, null);

    world.push("challenge.received", { ...CHALLENGE, id: "c9", from: "dave" });
    world.push("challenge.closed", { challengeId: "c9", reason: ChallengeEnd.EXPIRED });
    world.push("challenge.closed", { challengeId: "unknown", reason: ChallengeEnd.EXPIRED });
    const closed = world.events.filter((event) => event.kind === "closed");
    assert.equal(closed.length, 1, "news of a challenge nobody here knows is ignored");
    assert.deepEqual(describeLobbyEvent(closed[0]), { title: "The challenge from @dave lapsed", body: "Nobody answered it within a minute.", tone: "info", account: "dave" });
  });

  it("says why a challenge closed, from each side", () => {
    const challenge = Object.freeze({ id: "c1", from: "alice", to: "bob", mode: "casual", deadline: 0 });
    const outgoing = (reason) => describeLobbyEvent({ kind: "closed", challenge, reason, outgoing: true });
    const incoming = (reason) => describeLobbyEvent({ kind: "closed", challenge, reason, outgoing: false });
    assert.equal(outgoing("accepted").title, "@bob accepted your challenge");
    assert.equal(outgoing("accepted").tone, "good");
    assert.equal(outgoing("expired").title, "@bob did not answer");
    assert.equal(outgoing("offline").title, "@bob left");
    assert.equal(outgoing("busy").title, "@bob is in another game");
    assert.equal(incoming("cancelled").title, "@alice withdrew the challenge");
    assert.equal(incoming("maintenance").title, "Challenge called off");
    assert.equal(incoming("something new").title, "Challenge with @alice closed");
  });
});
