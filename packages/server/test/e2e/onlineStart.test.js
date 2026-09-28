/**
 * How an online game starts, end to end (docs/tcg/12): two real clients on a
 * real server, a person at each Keychain. The game — hands, coin toss,
 * clock — starts only once both players have signed it; searching alone
 * starts nothing; a refusal or silence cancels it for both, each told who
 * did not accept; Keychain never asks anyone twice on its own; an answer
 * given too late changes nothing; and a page reloaded mid-game asks once,
 * then only when the player tries to move.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { onlineWorld, settle, until } from "./onlineHarness.js";

const SECOND = 1000;

describe("starting an online game (two real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>>[]} */
  const worlds = [];
  after(async () => {
    for (const world of worlds) {
      await world.close();
    }
  });
  const fresh = async () => {
    const world = await onlineWorld();
    worlds.push(world);
    return world;
  };
  /** Two players who both searched and were matched. */
  const matched = async () => {
    const w = await fresh();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    await alice.online.queue(alice.deckId);
    await bob.online.queue(bob.deckId);
    await until(() => alice.online.state.status === "matched" && bob.online.state.status === "matched", "both are matched");
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign");
    return { w, alice, bob };
  };

  it("searching alone starts nothing: no opponent, no game, no Keychain", async () => {
    const w = await fresh();
    const alice = await w.player("alice");
    await alice.online.queue(alice.deckId);
    await w.tick(30 * SECOND);
    assert.equal(alice.online.state.status, "searching");
    assert.equal(alice.online.state.session, null);
    assert.equal(alice.keychain.shown, 0);
  });

  it("starts the game — and its coin toss — only once both have signed, each asked exactly once", async () => {
    const { w, alice, bob } = await matched();
    alice.keychain.approve();
    await until(() => bob.online.state.acceptance?.opponent === true, "bob sees that alice accepted");
    assert.deepEqual(alice.online.state.acceptance, { you: true, opponent: false });
    await w.tick(20 * SECOND);
    assert.equal(alice.online.state.status, "matched", "one signature is not enough");
    assert.equal(alice.online.state.session?.hasSnapshot, false, "no hand has been dealt");

    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");
    const toss = alice.online.state.session?.openingToss;
    assert.ok(toss !== null && toss !== undefined, "the coin toss opens the game, after both signatures");
    assert.equal(bob.online.state.session?.openingToss?.firstPlayerId, toss.firstPlayerId, "the same toss for both");

    await w.tick(100 * SECOND); // a turn runs out: the server moves for the player, both get updates
    for (const player of [alice, bob]) {
      assert.equal(player.keychain.shown, 1, `${player.account} was asked once`);
      assert.equal(player.count("game.entropy"), 1, `${player.account} sent its entropy once`);
      assert.equal(player.count("game.session"), 1);
      assert.equal(player.online.state.error, null);
      assert.deepEqual(player.logger.entries, []);
    }
  });

  it("a refusal cancels the game for both, naming who refused; a late answer changes nothing; nobody is asked again", async () => {
    const { w, alice, bob } = await matched();
    bob.keychain.refuse();
    await until(() => alice.online.state.status === "cancelled" && bob.online.state.status === "cancelled", "both see the cancellation");
    assert.match(alice.online.state.error?.message ?? "", /@bob did not accept the game in Keychain/);
    assert.match(bob.online.state.error?.message ?? "", /You did not accept the game in Keychain/);
    assert.equal(alice.online.state.session, null);

    alice.keychain.approve(); // her prompt was still open: she answers after the game is gone
    await settle();
    assert.equal(alice.count("game.session"), 0, "nothing is sent for a cancelled game");
    assert.equal(alice.online.state.status, "cancelled");
    assert.match(alice.online.state.error?.message ?? "", /@bob did not accept/, "the notice stays what it was");

    await w.tick(70 * SECOND);
    assert.deepEqual([alice.keychain.shown, bob.keychain.shown], [1, 1], "Keychain never comes back on its own");

    await alice.online.queue(alice.deckId);
    await w.tick(10 * SECOND);
    assert.equal(alice.online.state.status, "searching", "a new search, alone, finds nobody");
    assert.equal(alice.keychain.shown, 1);
  });

  it("silence cancels the game when the time to sign runs out, and Keychain is not asked again", async () => {
    const { w, alice, bob } = await matched();
    alice.keychain.approve();
    for (let waited = 0; waited < 70; waited += 10) {
      await w.tick(10 * SECOND);
    }
    await until(() => alice.online.state.status === "cancelled" && bob.online.state.status === "cancelled", "the game is called off");
    assert.match(alice.online.state.error?.message ?? "", /@bob did not sign the game with Keychain in time/);
    assert.match(bob.online.state.error?.message ?? "", /You did not sign the game with Keychain in time/);
    bob.keychain.approve(); // too late
    await settle();
    assert.equal(bob.count("game.session"), 0);
    assert.deepEqual([alice.keychain.shown, bob.keychain.shown], [1, 1]);
  });

  it("a page reloaded mid-game asks Keychain once; after a refusal only the player's next move asks again", async () => {
    const { w, alice, bob } = await matched();
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");

    // The player whose turn it is reloads the page.
    const mover = [alice, bob].find((player) => {
      const session = /** @type {any} */ (player.online.state.session);
      return session.snapshotFor(session.seat).awaitingPlayerId === session.seat;
    });
    assert.ok(mover !== undefined, "someone is to move");
    const reloaded = await mover.reload();
    await until(() => reloaded.keychain.open.length === 1, "the reloaded page asks for a new key");
    reloaded.keychain.refuse();
    await until(() => reloaded.online.state.error?.code === "SESSION_REFUSED", "the player is told their moves are not signed");
    assert.equal(reloaded.online.state.status, "playing", "a running game is not cancelled");
    await w.tick(30 * SECOND); // updates keep coming
    assert.equal(reloaded.keychain.shown, 1, "no prompt on the game's updates");

    const session = /** @type {any} */ (reloaded.online.state.session);
    const snapshot = session.snapshotFor(session.seat);
    assert.equal(snapshot.awaitingPlayerId, session.seat, "still our decision");
    const moving = session.submit({ type: snapshot.legalMoves.canEndTurn ? "END_TURN" : "END_PHASE" });
    await until(() => reloaded.keychain.open.length === 1, "trying to move asks Keychain");
    reloaded.keychain.approve();
    const result = await moving;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(reloaded.online.state.error, null);
    assert.equal(reloaded.keychain.shown, 2);
  });
});
