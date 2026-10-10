/**
 * A player's game history on the client: the adapter checks what the
 * server lists, the screen shows the games and loads older ones a page at a
 * time, and the leaderboard opens it for the player or a player picked.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { HttpGameHistoryApi } from "../../src/infrastructure/api/HttpGameHistoryApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { GameHistoryScene, historySummary, playedGameSubtitle, playedGameTitle } from "../../src/rendering/scenes/GameHistoryScene.js";
import { LeaderboardScene } from "../../src/rendering/scenes/LeaderboardScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { FakeContext2D, loadTheme } from "../rendering/fakes.js";

const theme = loadTheme();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const HOUR = 3_600_000;
const NOW = 100 * HOUR;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const game = (id, overrides = {}) => Object.freeze({ gameId: `01j8x3r6h2qkq4w0v7m5a9c1${id}`, mode: "casual", opponent: "bob", result: "win", endReason: "life_depleted", turn: 7, startedAt: NOW - 3 * HOUR, finishedAt: NOW - 2 * HOUR, ...overrides });
const FIRST = game("d1");
const SECOND = game("d0", { mode: "ranked", opponent: "carol", result: "loss", endReason: "concede", turn: 1 });
const OLDER = game("c9", { result: "draw", endReason: "draw" });

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};

/** An api with two pages for alice and nothing for anyone else; `null` pages fail. */
function fakeApi(pages = { "": { games: [FIRST, SECOND], next: SECOND.gameId }, [SECOND.gameId]: { games: [OLDER], next: null } }) {
  const calls = [];
  return {
    calls,
    played: async (account, before = null) => {
      calls.push([account, before]);
      if (pages === null) {
        return fail("NETWORK", "the game server could not be reached");
      }
      const page = account === "alice" ? pages[before ?? ""] : { games: [], next: null };
      return ok({ account, ...page });
    },
  };
}

const signedIn = (account) => ({ state: { user: { account } } });

describe("HttpGameHistoryApi", () => {
  it("reads a page of a player's games and refuses a malformed one", async () => {
    const requested = [];
    let body = { account: "alice", games: [FIRST], next: FIRST.gameId };
    const api = new HttpGameHistoryApi({ fetch: async (url) => (requested.push(url), json(200, body)) });
    assert.deepEqual((await api.played("alice")).value, body);
    await api.played("alice", FIRST.gameId);
    assert.deepEqual(requested, ["/api/games/history?account=alice", `/api/games/history?account=alice&before=${FIRST.gameId}`]);
    body = { account: "alice", games: [{ ...FIRST, result: "won" }], next: null };
    assert.equal((await api.played("alice")).error.code, "BAD_RESPONSE");
    body = { account: "alice", games: [{ ...FIRST, opponent: "<b>x</b>" }], next: null };
    assert.equal((await api.played("alice")).error.code, "BAD_RESPONSE");
    body = { account: "alice", games: [], next: "../admin" };
    assert.equal((await api.played("alice")).error.code, "BAD_RESPONSE");
  });
});

describe("game history texts", () => {
  it("say how each game went and sum up the list", () => {
    assert.equal(playedGameTitle(FIRST), "Won vs @bob");
    assert.equal(playedGameTitle(SECOND), "Lost vs @carol");
    assert.equal(playedGameTitle(OLDER), "Draw vs @bob");
    assert.equal(playedGameSubtitle(FIRST, NOW), "casual · 7 turns · life depleted · 2 h ago");
    assert.equal(playedGameSubtitle(SECOND, NOW), "ranked · 1 turn · conceded · 2 h ago");
    assert.equal(playedGameSubtitle(OLDER, NOW), "casual · 7 turns · 2 h ago");
    assert.equal(historySummary([FIRST, SECOND, OLDER], false), "3 games · 1–1–1");
    assert.equal(historySummary([FIRST], false), "1 game · 1–0");
    assert.equal(historySummary([FIRST], true), "1+ games · 1–0");
  });
});

describe("GameHistoryScene", () => {
  it("opens the replay of an auto game, and says so on its line", async () => {
    const auto = game("d2", { mode: "auto", opponent: "dave" });
    const navigated = [];
    const scene = new GameHistoryScene(services({ navigate: (id, params) => navigated.push({ id, params }) }), { identity: signedIn("alice"), gameHistory: fakeApi({ "": { games: [auto, FIRST], next: null } }) }, () => NOW);
    scene.enter({});
    await flush();
    const row = scene.root.findById(`history.game.${auto.gameId}`);
    assert.equal(row.subtitle, "auto · 7 turns · life depleted · 2 h ago · click to watch");
    row.activate();
    assert.deepEqual(navigated, [{ id: SceneId.REPLAY, params: { gameId: auto.gameId, from: SceneId.GAME_HISTORY } }]);
    scene.root.findById(`history.game.${FIRST.gameId}`).activate();
    assert.equal(navigated.length, 1, "a game played by hand has no replay");
  });

  it("lists the signed-in player's games and loads older ones", async () => {
    const api = fakeApi();
    const navigated = [];
    const scene = new GameHistoryScene(services({ navigate: (id, params) => navigated.push({ id, params }) }), { identity: signedIn("alice"), gameHistory: api }, () => NOW);
    scene.enter({});
    await flush();
    assert.ok(rendered(scene).includes("Games — @alice"));
    const row = scene.root.findById(`history.game.${FIRST.gameId}`);
    assert.deepEqual([row.text, row.avatar], ["Won vs @bob", "bob"]);
    assert.ok(rendered(scene).includes("2+ games · 1–1"));
    scene.root.findById("history.more").activate();
    await flush();
    assert.deepEqual(api.calls, [["alice", null], ["alice", SECOND.gameId]]);
    assert.ok(scene.root.findById(`history.game.${OLDER.gameId}`) !== null);
    assert.equal(scene.root.findById("history.more"), null, "nothing older left");
    assert.ok(rendered(scene).includes("3 games · 1–1–1"));
    scene.onCancel();
    assert.deepEqual(navigated, [{ id: SceneId.ONLINE, params: undefined }]);
  });

  it("shows another player's games, and says when there are none or they cannot be read", async () => {
    const api = fakeApi();
    const other = new GameHistoryScene(services(), { identity: signedIn("alice"), gameHistory: api }, () => NOW);
    other.enter({ account: "dave" });
    await flush();
    assert.deepEqual(api.calls, [["dave", null]]);
    assert.ok(rendered(other).includes("No games played yet."));
    const offline = new GameHistoryScene(services(), { identity: signedIn("alice"), gameHistory: fakeApi(null) }, () => NOW);
    offline.enter({});
    await flush();
    assert.ok(rendered(offline).includes("the game server could not be reached"));
  });
});

describe("LeaderboardScene → game history", () => {
  it("opens the player's own games, or those of a player picked, and Back returns as the leaderboard was opened", async () => {
    const entries = [{ rank: 1, provisional: false, account: "carol", rating: 1600, games: 12, wins: 8, losses: 4, draws: 0 }];
    const ranking = new RankingService({ api: { standing: async () => fail("NETWORK", "offline"), leaderboard: async () => ok({ season: { id: "s1", name: "Season 1" }, entries }) } });
    const navigated = [];
    const scene = new LeaderboardScene(services({ navigate: (id, params) => navigated.push({ id, params }) }), { ranking, identity: signedIn("alice") });
    scene.enter({ back: SceneId.MAIN_MENU });
    await flush();
    scene.root.findById("leaderboard.history").activate();
    scene.root.findById("leaderboard.row.1").activate();
    assert.deepEqual(navigated, [
      { id: SceneId.GAME_HISTORY, params: { back: SceneId.LEADERBOARD, backParams: { back: SceneId.MAIN_MENU } } },
      { id: SceneId.GAME_HISTORY, params: { account: "carol", back: SceneId.LEADERBOARD, backParams: { back: SceneId.MAIN_MENU } } },
    ]);
  });
});
