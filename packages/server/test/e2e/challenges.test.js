/**
 * Challenges end to end (docs/tcg/17): real clients on a real server. A
 * player sees who is online, challenges one of them, the other hears it
 * and accepts with their own deck, and the game starts for both like a
 * queue game (Keychain asks each once); a refusal reaches the challenger;
 * a player who leaves takes their challenge with them.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { onlineWorld, settle, until } from "./onlineHarness.js";

describe("challenges (real clients, real server)", () => {
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

  it("a challenge accepted starts the game for both, with each player's deck", async () => {
    const w = await fresh();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const carol = await w.player("carol");
    await alice.lobby.refresh();
    assert.deepEqual(alice.lobby.state.players, [
      { account: "bob", status: "idle" },
      { account: "carol", status: "idle" },
    ]);

    const heard = [];
    bob.lobby.onEvent((event) => heard.push(event));
    const sent = await alice.lobby.challenge("bob", "casual", alice.deckId);
    assert.equal(sent.ok, true);
    await until(() => bob.lobby.state.incoming.length === 1, "bob hears the challenge");
    assert.deepEqual([heard[0].kind, heard[0].challenge.from, heard[0].challenge.mode], ["received", "alice", "casual"]);

    const aliceHeard = [];
    alice.lobby.onEvent((event) => aliceHeard.push(event));
    const accepted = await bob.lobby.accept(bob.lobby.state.incoming[0].id, bob.deckId);
    assert.equal(accepted.ok, true);
    await until(() => alice.online.state.status === "matched" && bob.online.state.status === "matched", "both are matched");
    assert.equal(alice.online.state.opponent, "bob");
    await until(() => aliceHeard.some((event) => event.kind === "closed" && event.reason === "accepted"), "alice hears it was accepted");
    assert.equal(alice.lobby.state.outgoing, null);

    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign the game");
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");
    const gameId = /** @type {string} */ (alice.online.state.session?.gameId);
    const seats = await w.setup.database.rows("SELECT account, deck_id FROM game_players WHERE game_id = $1 ORDER BY seat", [gameId]);
    assert.deepEqual(seats.map((row) => [row.account, row.deck_id]), [["alice", alice.deckId], ["bob", bob.deckId]]);

    w.setup.clock.advance(3000); // past the lobby's list cache
    await carol.lobby.refresh();
    assert.deepEqual(carol.lobby.state.players, [
      { account: "alice", status: "playing" },
      { account: "bob", status: "playing" },
    ]);
    for (const player of [alice, bob]) {
      assert.equal(player.keychain.shown, 1, `${player.account} was asked once`);
      assert.deepEqual(player.logger.entries, []);
    }
  });

  it("a refusal reaches the challenger; a challenger who leaves takes the challenge along", async () => {
    const w = await fresh();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const aliceHeard = [];
    alice.lobby.onEvent((event) => aliceHeard.push(event));
    await alice.lobby.challenge("bob", "casual", alice.deckId);
    await until(() => bob.lobby.state.incoming.length === 1, "bob hears the challenge");
    await bob.lobby.decline(bob.lobby.state.incoming[0].id);
    await until(() => aliceHeard.some((event) => event.reason === "declined"), "alice hears the refusal");
    assert.equal(alice.lobby.state.outgoing, null);

    const refused = await alice.lobby.challenge("bob", "casual", alice.deckId);
    assert.equal(refused.ok, false, "not straight away after a refusal");
    assert.equal(refused.ok ? null : refused.error.code, "RATE_LIMITED");

    w.setup.clock.advance(31_000);
    await alice.lobby.challenge("bob", "ranked", alice.deckId).then((result) => assert.equal(result.ok ? null : result.error.code, "FORBIDDEN", "ranked needs finished casual games"));
    await alice.lobby.challenge("bob", "casual", alice.deckId);
    await until(() => bob.lobby.state.incoming.length === 1, "bob hears the new challenge");
    alice.lobby.stop();
    alice.online.stop();
    await until(() => bob.lobby.state.incoming.length === 0, "alice's challenge leaves with her");
    await settle();
    assert.equal(bob.online.state.status, "idle");
  });
});
