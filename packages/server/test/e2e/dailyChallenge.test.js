/**
 * A daily challenge end to end (docs/tcg/24-sfide.md): the real client stack
 * (DailyService over HTTP, OnlineService over a real WebSocket) against a
 * real server. The challenge starts without asking Keychain anything (the
 * AI's games are protocol v1), arrives as an online game marked "daily",
 * the server's AI takes its seat and plays, the character speaks, and when
 * the player gives up the server settles the challenge as lost.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { concede } from "@magic8/engine/domain/commands/commandFactories.js";
import { DailyCompanion } from "../../../client/src/application/daily/DailyCompanion.js";
import { DailyService } from "../../../client/src/application/daily/DailyService.js";
import { HttpDailyApi } from "../../../client/src/infrastructure/api/HttpDailyApi.js";
import { ORIGIN } from "../helpers.js";
import { onlineWorld, settle, until } from "./onlineHarness.js";

describe("a daily challenge (a real client, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>> | null} */
  let world = null;
  after(async () => world?.close());

  it("is played as an online game against the server's AI, and settled when it ends", async () => {
    world = await onlineWorld();
    const alice = await world.player("alice");
    const base = world.server.base;
    /** @type {typeof fetch} */
    const httpFetch = (url, init = {}) => fetch(`${base}${url}`, { ...init, headers: { ...init.headers, Cookie: /** @type {string} */ (alice.api.cookie), Origin: ORIGIN } });
    const daily = new DailyService({ api: new HttpDailyApi({ fetch: httpFetch }) });
    const speeches = [];
    new DailyCompanion({ online: alice.online, daily, say: (speech) => speeches.push(speech) }).start();

    await daily.refresh();
    const [first] = dayOf(daily).opponents;
    assert.equal(first.state, "next");
    assert.equal((await daily.chooseTrack("normal")).ok, true);
    const started = await daily.play(alice.deckId);
    assert.equal(started.ok, true, JSON.stringify(started));
    const gameId = /** @type {string} */ (started.ok && started.value);

    await until(() => alice.online.state.status === "playing" && alice.online.state.session?.gameId === gameId && alice.online.state.session.hasSnapshot, "the challenge starts");
    assert.equal(alice.online.state.mode, "daily");
    assert.equal(alice.online.state.opponent, first.account);
    assert.equal(alice.keychain.shown, 0, "no Keychain prompt for a game against the AI");
    assert.equal(daily.characterOf(alice.online.state.opponent)?.name, first.name);
    assert.deepEqual(speeches.map((speech) => speech.kind), ["intro"], "the character greets the player");

    const session = /** @type {any} */ (alice.online.state.session);
    await until(() => session.snapshotFor(session.seat).awaitingPlayerId === session.seat, "the AI has played its part");
    assert.equal((await session.submit(concede(session.seat))).ok, true);
    await until(() => alice.online.state.status === "over", "the game is over");
    assert.equal(speeches.at(-1)?.kind, "win", "the character has its last word");

    await settle();
    await daily.refresh();
    const { run, opponents } = dayOf(daily);
    assert.deepEqual([run.stage, run.gameId, run.attempts, run.last.result], [0, null, 1, "loss"]);
    assert.equal(opponents[0].state, "next", "the challenge waits to be fought again");
  });
});

/**
 * The day the service last read.
 * @param {DailyService} daily
 * @returns {any}
 */
function dayOf(daily) {
  assert.ok(daily.state.day !== null, "the day was read");
  return daily.state.day;
}
