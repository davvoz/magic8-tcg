/**
 * The daily ranked limit between two players end to end (docs/tcg/09, T24):
 * two real clients on a real server. Once they played their rated games of
 * the day together, the ranked queue keeps searching without pairing them
 * and each client shows who with, for how long and why; a ranked challenge
 * between them is refused with the same explanation, a casual one is not.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { concede } from "@magic8/engine/domain/commands/commandFactories.js";

import { bundledContent } from "../helpers.js";
import { onlineWorld, settle, until } from "./onlineHarness.js";

/** The bundled data with a free ranked season open to everyone, one rated game a day per pair. */
async function oneGameADay() {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  ranked.eligibility.minFinishedCasualGames = 0;
  ranked.fairPlay.maxRatedGamesPerPairPerDay = 1;
  ranked.seasons = [{ id: "free-season", name: "Free season", startsAt: "2026-09-01T00:00:00Z" }];
  return { ...bundled, ranked };
}

describe("ranked daily limit per pair (two real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>> | null} */
  let world = null;
  after(() => world?.close());

  it("holds the pair apart in the queue and refuses their ranked challenges, saying for how long and why", async () => {
    world = await onlineWorld({ content: await oneGameADay() });
    const w = world;
    const alice = await w.player("alice");
    const bob = await w.player("bob");

    // Their rated game of the day: bob concedes.
    await alice.online.queue(alice.deckId, "ranked");
    await bob.online.queue(bob.deckId, "ranked");
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign the game");
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");
    const session = /** @type {import("../../../client/src/application/online/RemoteMatchSession.js").RemoteMatchSession} */ (bob.online.state.session);
    await session.submit(concede(session.seat));
    await until(() => alice.online.state.status === "over" && bob.online.state.status === "over", "the game is over");
    for (let tries = 0; (await w.setup.database.rows("SELECT 1 FROM rating_changes WHERE counted")).length < 2; tries += 1) {
      assert.ok(tries < 100, "the game is rated");
      await settle();
    }

    // The queue searches on, without pairing them, and says why.
    for (const player of [alice, bob]) {
      player.online.dismissGame();
      await player.online.queue(player.deckId, "ranked");
    }
    await until(() => alice.online.state.notice !== null && bob.online.state.notice !== null, "both are told");
    assert.match(alice.online.state.notice ?? "", /^You will not be paired with @bob for \d+h \d\dm: at most 1 ranked game a day with the same opponent\. Looking for someone else…$/);
    assert.match(bob.online.state.notice ?? "", /^You will not be paired with @alice for /);
    await w.setup.app.matchmaking.pair();
    await settle();
    assert.deepEqual([alice.online.state.status, bob.online.state.status], ["searching", "searching"], "still searching, not paired");
    assert.equal(alice.keychain.open.length, 0, "no game to sign");
    await alice.online.leaveQueue();
    await bob.online.leaveQueue();
    assert.equal(alice.online.state.notice, null);

    // A ranked challenge between them is refused with the same reason; a casual one goes through.
    const refused = await alice.lobby.challenge("bob", "ranked", alice.deckId);
    assert.equal(refused.ok ? null : refused.error.code, "LIMIT_REACHED");
    assert.match(alice.lobby.state.error?.message ?? "", /^You can play ranked with @bob again in \d+h \d\dm: at most 1 ranked game a day with the same opponent\.$/, "shown to the challenger");
    assert.equal((await alice.lobby.challenge("bob", "casual", alice.deckId)).ok, true);
    await until(() => bob.lobby.state.incoming.length === 1, "bob hears the casual challenge");
    for (const player of [alice, bob]) {
      assert.deepEqual(player.logger.entries, []);
    }
  });
});
