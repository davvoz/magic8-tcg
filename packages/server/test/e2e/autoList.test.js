/**
 * The auto list end to end (docs/tcg/23-automatica.md), the way two browsers
 * use it: a real server, and for each player the real client stack. Alice
 * buys an entry in the shop and joins the auto list; hours later Bob does
 * the same. Neither has to wait for the other: the server plays their game
 * when Bob joins, both tabs hear it, the notification names the game, and
 * the client replays it from the published record to the same end.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { AutoListService, AutoListStatus } from "../../../client/src/application/auto/AutoListService.js";
import { AutoReplayService } from "../../../client/src/application/auto/AutoReplayService.js";
import { HttpAutoApi } from "../../../client/src/infrastructure/api/HttpAutoApi.js";
import { MemoryLogger } from "../../../client/src/infrastructure/logging/MemoryLogger.js";
import { buildRecordedGameEngine } from "../../../client/src/infrastructure/random/recordedGameEngine.js";
import { immediateScheduler } from "../../../client/src/infrastructure/time/ImmediateScheduler.js";
import { loadBundledContent } from "../../../client/test/application/fixtures.js";
import { bundledContent } from "../helpers.js";
import { onlineWorld, until } from "./onlineHarness.js";

const HOUR = 60 * 60 * 1000;

/** The bundled data with one ranked season running, charging an entry a game, open to everyone. */
async function paidSeason() {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  ranked.eligibility.minFinishedCasualGames = 0;
  ranked.seasons = [{ id: "auto-season", name: "Auto season", startsAt: "2026-09-01T00:00:00Z", entryFee: 1 }];
  return { ...bundled, ranked };
}

describe("auto list (two real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>> | null} */
  let world = null;
  after(() => world?.close());

  it("plays the game of two players who joined hours apart, tells both, and replays it to the same end", async () => {
    world = await onlineWorld({ content: await paidSeason() });
    const w = world;
    await w.setup.app.settlement.poll("steem"); // the shop's watcher starts reading the bank
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    /** The player buys one entry: one Keychain transfer to the bank. @param {typeof alice} player */
    const buyEntry = async (player) => {
      await player.shop.load();
      const buying = player.shop.buy({ productId: "ranked_entry", quantity: 1, asset: "STEEM" });
      await until(() => player.keychain.open.length === 1, `${player.account} is asked to pay`);
      player.keychain.approve();
      assert.equal((await buying).ok, true);
      await player.entries.refresh();
      assert.equal(player.entries.ranked?.balance, 1);
    };
    /** The auto list of a tab, on its realtime connection. @param {typeof alice} player */
    const autoListOf = (player) => {
      const randomHex = (/** @type {number} */ bytes) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const auto = new AutoListService({ connection: player.connection, randomHex, logger: player.logger });
      auto.start();
      return auto;
    };

    await buyEntry(alice);
    const aliceAuto = autoListOf(alice);
    const joined = await aliceAuto.join(alice.deckId, "aggressive");
    assert.equal(joined.ok, true, JSON.stringify(joined));
    assert.equal(aliceAuto.state.status, AutoListStatus.WAITING);
    assert.equal(aliceAuto.state.ticket?.style, "aggressive");
    assert.deepEqual(alice.sent.filter((type) => type.startsWith("auto.")).slice(-2), ["auto.prepare", "auto.join"]);
    await alice.entries.refresh();
    assert.equal(alice.entries.ranked?.balance, 0, "paid on joining");

    // Hours later, with Alice nowhere near the lobby, Bob joins.
    w.setup.clock.advance(3 * HOUR);
    await buyEntry(bob);
    const bobAuto = autoListOf(bob);
    assert.equal((await bobAuto.join(bob.deckId, "defensive")).ok, true);
    await until(() => aliceAuto.state.lastGame !== null && bobAuto.state.lastGame !== null, "both tabs hear the game was played");
    const gameId = /** @type {string} */ (aliceAuto.state.lastGame);
    assert.equal(bobAuto.state.lastGame, gameId);
    assert.deepEqual([aliceAuto.state.status, bobAuto.state.status], [AutoListStatus.IDLE, AutoListStatus.IDLE]);

    const feed = await alice.api.get("/api/notifications");
    const note = feed.json.notifications.find((/** @type {any} */ item) => item.kind === "auto.finished");
    assert.equal(note?.data.gameId, gameId);
    assert.deepEqual([note.data.opponent, note.data.style, note.data.opponentStyle], ["bob", "aggressive", "defensive"]);

    // The replay, read like a browser reads it, plays the published record to the server's end.
    const replays = new AutoReplayService({
      api: new HttpAutoApi({ fetch: (url, init = {}) => fetch(`${w.server.base}${url}`, init) }),
      content: await loadBundledContent(),
      effects: createCoreEffectRegistry(),
      buildEngine: buildRecordedGameEngine,
      scheduler: immediateScheduler,
      logger: new MemoryLogger(),
    });
    const opened = await replays.open(gameId);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const { session, replay } = opened.value;
    assert.deepEqual(replay.tickets.map((ticket) => [ticket.account, ticket.style]), [["alice", "aggressive"], ["bob", "defensive"]]);
    session.begin();
    await session.whenIdle();
    const end = session.snapshotFor(null);
    const game = await w.setup.app.gameRepository.findGame(gameId);
    assert.equal(end.isOver, true);
    assert.equal(end.winnerId, game?.winnerSeat);
    assert.equal(note.data.result, game?.winnerSeat === "s0" ? "win" : "loss", "alice sat at s0: her ticket was older");
    aliceAuto.stop();
    bobAuto.stop();
  });
});
