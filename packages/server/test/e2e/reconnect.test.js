/**
 * A connection that dies without the browser noticing, end to end: two real
 * clients in a game on a real server, and one of them stops hearing the
 * server (a half-open socket: nothing arrives, nothing says it closed). The
 * client finds out by itself — its ping goes unanswered — connects again,
 * and is back in the same game, able to move, without a reload.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { onlineWorld, until } from "./onlineHarness.js";

/** The clients' timers run this much faster: a 15 s heartbeat takes 150 ms. */
const SCALE = 100;

describe("a dead connection mid-game (two real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>>[]} */
  const worlds = [];
  after(async () => {
    for (const world of worlds) {
      await world.close();
    }
  });

  it("is noticed by the client, which reconnects and plays on in the same game", async () => {
    const w = await onlineWorld({ clientTimeScale: SCALE });
    worlds.push(w);
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    await alice.online.queue(alice.deckId);
    await bob.online.queue(bob.deckId);
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign");
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");
    const mover = [alice, bob].find((player) => {
      const session = /** @type {any} */ (player.online.state.session);
      return session.snapshotFor(session.seat).awaitingPlayerId === session.seat;
    });
    assert.ok(mover !== undefined, "someone is to move");
    const gameId = /** @type {any} */ (mover.online.state.session).gameId;

    // The network eats everything the server sends this tab; the socket still looks open.
    const dead = mover.sockets.at(-1);
    /** @type {any} */ (dead)._socket.pause();
    const statuses = [];
    mover.connection.onStatus((status) => statuses.push(status));

    await until(() => mover.sockets.length === 2 && mover.connection.status === "open", "the client gave up the dead socket and connected again", 10_000);
    assert.deepEqual(statuses.slice(0, 1), ["closed"], "the page was told the connection was lost");
    assert.ok(mover.logger.entries.some((entry) => /stopped answering/.test(entry.message)));
    await until(() => mover.count("hello") === 2, "it said hello again");

    const session = /** @type {any} */ (mover.online.state.session);
    assert.equal(session.gameId, gameId, "the same game");
    assert.equal(mover.online.state.status, "playing");
    const snapshot = session.snapshotFor(session.seat);
    assert.equal(snapshot.awaitingPlayerId, session.seat, "still its decision");
    const result = await session.submit({ type: snapshot.legalMoves.canEndTurn ? "END_TURN" : "END_PHASE" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(mover.keychain.shown, 1, "no new Keychain prompt: the page kept its key");
  });
});
