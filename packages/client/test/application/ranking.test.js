/**
 * Ranked standing and leaderboard on the client: the HTTP adapter checks
 * every response, the service loads both and forgets them on sign-out,
 * and the screens show them (mode choice in the lobby, the leaderboard).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { HttpRankingApi } from "../../src/infrastructure/api/HttpRankingApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { LeaderboardScene } from "../../src/rendering/scenes/LeaderboardScene.js";
import { OnlineScene, standingText } from "../../src/rendering/scenes/OnlineScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { FakeContext2D, loadTheme } from "../rendering/fakes.js";
import { loadBundledContent } from "./fixtures.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const SEASON = Object.freeze({ id: "2026-s1", name: "Season 1" });
const STANDING = Object.freeze({ season: SEASON, rating: 1612, deviation: 90, provisional: false, rank: 4, games: 12, wins: 8, losses: 4, draws: 0, eligible: true, casualGamesNeeded: 0, practiceGamesNeeded: 0 });
const BOARD = Object.freeze({
  season: SEASON,
  entries: [
    { rank: 1, provisional: false, account: "carol", rating: 1801, games: 30, wins: 22, losses: 8, draws: 0 },
    { rank: 2, provisional: false, account: "alice", rating: 1650, games: 20, wins: 13, losses: 6, draws: 1 },
    { rank: null, provisional: true, account: "dave", rating: 1582, games: 3, wins: 2, losses: 1, draws: 0 },
  ],
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpRankingApi", () => {
  it("reads the standing and the leaderboard, and refuses malformed answers", async () => {
    const answers = { "/api/ranking/me": STANDING, "/api/ranking/leaderboard": BOARD };
    const api = new HttpRankingApi({ fetch: async (url) => json(200, answers[new URL(url, "http://x").pathname]) });
    assert.deepEqual((await api.standing()).value, STANDING);
    assert.deepEqual((await api.leaderboard()).value, BOARD);
    answers["/api/ranking/me"] = { ...STANDING, practiceGamesNeeded: undefined };
    assert.equal((await api.standing()).value.practiceGamesNeeded, 0, "an older server opens ranked play with casual games only");
    answers["/api/ranking/me"] = { ...STANDING, practiceGamesNeeded: -1 };
    assert.equal((await api.standing()).error.code, "BAD_RESPONSE");
    answers["/api/ranking/me"] = { ...STANDING, rating: "1612" };
    answers["/api/ranking/leaderboard"] = { season: SEASON, entries: [{ ...BOARD.entries[0], account: "<script>" }] };
    assert.equal((await api.standing()).error.code, "BAD_RESPONSE");
    assert.equal((await api.leaderboard()).error.code, "BAD_RESPONSE");
    answers["/api/ranking/leaderboard"] = { season: SEASON, entries: [{ ...BOARD.entries[0], rank: null }] };
    assert.equal((await api.leaderboard()).error.code, "BAD_RESPONSE", "a settled entry needs a rank");
    answers["/api/ranking/leaderboard"] = { season: SEASON, entries: [{ ...BOARD.entries[0], provisional: undefined }] };
    assert.equal((await api.leaderboard()).value.entries[0].provisional, false, "an older server sends ranked entries only");
    answers["/api/ranking/leaderboard"] = { season: null, entries: [] };
    assert.deepEqual((await api.leaderboard()).value, { season: null, entries: [] }, "no season running");
  });
});

/** A scripted RankingApi. */
function fakeApi(standing = STANDING, board = BOARD) {
  const calls = [];
  return {
    calls,
    standing: async () => (calls.push("standing"), standing === null ? fail("NETWORK", "offline") : ok(standing)),
    leaderboard: async () => (calls.push("leaderboard"), ok(board)),
  };
}

describe("RankingService (client)", () => {
  it("loads standing and leaderboard, keeps the last good values on errors, and forgets them on reset", async () => {
    const api = fakeApi();
    const ranking = new RankingService({ api });
    const seen = [];
    ranking.subscribe((state) => seen.push(state.loading));
    await ranking.refresh();
    assert.deepEqual([ranking.state.standing.rating, ranking.state.leaderboard.entries.length, ranking.state.error], [1612, 3, null]);
    assert.deepEqual(seen, [true, false]);

    const flaky = new RankingService({ api: fakeApi(null) });
    await flaky.refresh();
    assert.equal(flaky.state.error, "offline");

    const pending = ranking.refresh();
    ranking.reset();
    await pending;
    assert.equal(ranking.state.standing, null, "an answer after sign-out is dropped");
  });

  it("describes the standing in one line", () => {
    const base = { loading: false, leaderboard: null, error: null };
    assert.equal(standingText({ ...base, standing: STANDING }), "Season 1: rating 1612 (#4), 8–4 in 12 game(s).");
    assert.equal(standingText({ ...base, standing: { ...STANDING, provisional: true, rank: null, draws: 2 } }), "Season 1: rating 1612 (provisional), 8–4–2 in 12 game(s).");
    assert.equal(standingText({ ...base, standing: { ...STANDING, eligible: false, casualGamesNeeded: 2, practiceGamesNeeded: 1 } }), "Ranked opens after 2 more casual game(s), or 1 more practice game(s) vs AI.");
    assert.equal(standingText({ ...base, standing: { ...STANDING, eligible: false, casualGamesNeeded: 2 } }), "Ranked opens after 2 more casual game(s).", "an older server counts casual games only");
    assert.equal(standingText({ ...base, standing: { ...STANDING, season: null } }), "No ranked season is running.");
    assert.equal(standingText({ ...base, standing: null }), "Loading your ranked standing…");
    assert.equal(standingText({ ...base, standing: null, error: "offline" }), "Ranked standing unavailable: offline");
  });
});

function screens(ranking, requests = []) {
  const connection = {
    connect: () => undefined,
    close: () => undefined,
    request: async (t, d) => (requests.push({ t, d }), ok({ t: "queue.status", d: { state: "searching" } })),
    subscribe: () => () => undefined,
    onStatus: (listener) => (listener("open", { code: null }), () => undefined),
  };
  const deck = { id: "11111111-1111-4111-8111-111111111111", name: "Iron Foundry", mix: [{ faction: "iron", count: 26 }, { faction: "neutral", count: 4 }], totalCards: 30, playable: true, problem: null };
  const online = { state: { status: "idle", error: null, opponent: null, session: null }, subscribe: () => () => undefined, start: () => undefined, decks: () => [deck], dismissGame: () => undefined, queue: (deckId, mode) => connection.request("queue.join", { mode, deckId }) };
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id) => navigated.push(id), hasScene: () => true };
  const app = { content, online, ranking, identity: { state: { user: { account: "alice" } } } };
  return { services, app, navigated, requests };
}

describe("ranked screens", () => {
  it("offers ranked in the lobby only to eligible players, and queues in the chosen mode", async () => {
    const eligible = new RankingService({ api: fakeApi() });
    const { services, app, requests, navigated } = screens(eligible);
    const scene = new OnlineScene(services, app);
    scene.enter({});
    await flush();
    assert.equal(scene.root.findById("online.mode.ranked").enabled, true);
    scene.root.findById("online.mode.ranked").activate();
    assert.equal(scene.root.findById("online.mode.ranked").variant, "primary");
    scene.root.findById("online.find").activate();
    await flush();
    assert.deepEqual(requests.at(-1).d, { mode: "ranked", deckId: "11111111-1111-4111-8111-111111111111" });
    scene.root.findById("online.leaderboard").activate();
    assert.equal(navigated.at(-1), SceneId.LEADERBOARD);

    const newcomer = new RankingService({ api: fakeApi({ ...STANDING, eligible: false, casualGamesNeeded: 3, practiceGamesNeeded: 3 }) });
    const other = screens(newcomer);
    const lobby = new OnlineScene(other.services, other.app);
    lobby.enter({});
    await flush();
    assert.equal(lobby.root.findById("online.mode.ranked").enabled, false);
    assert.equal(lobby.root.findById("online.standing").text, "Ranked opens after 3 more casual game(s), or 3 more practice game(s) vs AI.");
  });

  it("shows the leaderboard with the player's own line selected", async () => {
    const { services, app, navigated } = screens(new RankingService({ api: fakeApi() }));
    const scene = new LeaderboardScene(services, app);
    scene.enter({});
    await flush();
    const context = new FakeContext2D();
    scene.render(context);
    assert.ok(context.texts.includes("Leaderboard — Season 1"));
    assert.equal(scene.root.findById("leaderboard.row.2").selected, true, "alice is highlighted");
    assert.equal(scene.root.findById("leaderboard.row.1").selected, false);
    assert.equal(scene.root.findById("leaderboard.row.3").text, "—  @dave", "a provisional player is listed with no rank");
    assert.equal(scene.root.findById("leaderboard.standing").text, "Season 1: rating 1612 (#4), 8–4 in 12 game(s).");
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.equal(navigated.at(-1), SceneId.ONLINE);
  });
});
