/**
 * The season's jackpot on the client: the HTTP adapter checks the answer,
 * the texts say the amount, the split, the countdown and the growth, and
 * the leaderboard shows it with its countdown ticking.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { describeJackpot, formatDuration } from "../../src/application/jackpot/describeJackpot.js";
import { JackpotService } from "../../src/application/jackpot/JackpotService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { HttpJackpotApi } from "../../src/infrastructure/api/HttpJackpotApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { LeaderboardScene } from "../../src/rendering/scenes/LeaderboardScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadTheme } from "../rendering/fakes.js";

const ENDS_AT = Date.UTC(2026, 10, 5);
const JACKPOT = Object.freeze({
  season: { id: "season-1", name: "Season 1", startsAt: Date.UTC(2026, 9, 5), endsAt: ENDS_AT, status: "running" },
  bank: "verdu.green",
  asset: "STEEM",
  share: { numerator: 2, denominator: 3 },
  jackpot: "866.666",
  opening: "666.666",
  readAt: Date.UTC(2026, 9, 20),
  places: [
    { place: 1, percent: 65, amount: "563.332", account: "alice", rating: 1700, paid: null },
    { place: 2, percent: 25, amount: "216.666", account: "bob", rating: 1600, paid: null },
    { place: 3, percent: 10, amount: "86.668", account: null, rating: null, paid: null },
  ],
});

describe("season jackpot", () => {
  it("reads the jackpot, and refuses a malformed answer", async () => {
    let body = JACKPOT;
    const api = new HttpJackpotApi({ fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) });
    assert.deepEqual((await api.current()).value, JACKPOT);
    body = { ...JACKPOT, jackpot: "1e9" };
    assert.equal((await api.current()).error.code, "BAD_RESPONSE");
    body = { season: null };
    assert.equal((await api.current()).value, null, "no season has a jackpot");
  });

  it("says the amount, each place's share, the time left and how much it has grown", () => {
    const text = describeJackpot(JACKPOT, ENDS_AT - (12 * 86_400_000 + 4 * 3_600_000 + 31 * 60_000 + 8_000));
    assert.equal(text.amount, "866.666 STEEM");
    assert.equal(text.countdown, "Ends in 12d 04h 31m 08s");
    assert.equal(text.source, "2/3 of @verdu.green's wallet · grows with every pack sold");
    assert.equal(text.growth, "+200.000 STEEM since the season began");
    assert.deepEqual(
      text.places.map((place) => [place.label, place.share, place.amount, place.holder]),
      [["1st", "65%", "563.332 STEEM", "@alice"], ["2nd", "25%", "216.666 STEEM", "@bob"], ["3rd", "10%", "86.668 STEEM", "nobody yet · it could be you"]],
    );
    assert.deepEqual([formatDuration(59_500), formatDuration(3_600_000), formatDuration(0)], ["01m 00s", "01h 00m 00s", "00s"]);
    const settled = describeJackpot({ ...JACKPOT, season: { ...JACKPOT.season, status: "settled" }, places: [{ ...JACKPOT.places[0], paid: "CONFIRMED" }] }, ENDS_AT + 1);
    assert.deepEqual([settled.countdown, settled.growth, settled.places[0].note], ["Season over", null, "paid"]);
  });

  it("heads the leaderboard with the jackpot, its countdown ticking, and goes back where it came from", async () => {
    let now = ENDS_AT - 90_000;
    const jackpot = new JackpotService({ api: { current: async () => ok(JACKPOT) }, scheduler: { delay: () => new Promise(() => undefined) }, now: () => now });
    const ranking = new RankingService({ api: { standing: async () => ok(null), leaderboard: async () => ok({ season: null, entries: [] }) } });
    const navigated = [];
    const theme = loadTheme();
    const services = { theme, viewport: new Viewport(theme.layout), logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id) => navigated.push(id), hasScene: () => true };
    const scene = new LeaderboardScene(services, /** @type {any} */ ({ ranking, jackpot }));
    scene.enter({ back: SceneId.MAIN_MENU });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(scene.root.findById("jackpot.amount")?.text, "866.666 STEEM");
    assert.equal(scene.root.findById("jackpot.countdown")?.text, "Ends in 01m 30s");
    now += 1000;
    assert.equal(scene.update(16), true, "a new second is drawn");
    assert.equal(scene.root.findById("jackpot.countdown")?.text, "Ends in 01m 29s");
    assert.equal(scene.update(16), false, "nothing changed within the second");
    scene.onCancel();
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
    scene.exit();
  });
});
