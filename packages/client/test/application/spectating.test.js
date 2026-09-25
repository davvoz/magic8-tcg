/**
 * Watching games on the client: the live-games adapter checks what the
 * server lists, OnlineService watches one game at a time (and asks again
 * after a reconnection), the list screen opens a game, and the match screen
 * shows a spectator the table without a hand and without anything to play.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SPECTATOR } from "@magic8/engine/domain/game/GameSnapshot.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { P1 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { RemoteMatchSession } from "../../src/application/online/RemoteMatchSession.js";
import { HttpLiveGamesApi } from "../../src/infrastructure/api/HttpLiveGamesApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { LiveGamesScene, liveGameSubtitle } from "../../src/rendering/scenes/LiveGamesScene.js";
import { computeBoardLayout } from "../../src/rendering/board/BoardLayout.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { FakeContext2D, loadTheme } from "../rendering/fakes.js";

const theme = loadTheme();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";
const OTHER = "01j8x3r6h2qkq4w0v7m5a9c1e0";
const LIVE = Object.freeze({ gameId: GAME, mode: "ranked", players: [{ seat: "s0", account: "alice" }, { seat: "s1", account: "bob" }], turn: 4, spectators: 2, startedAt: 1000 });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const WATCH_VIEW = (overrides = {}) => ({ gameId: GAME, status: "ACTIVE", players: LIVE.players, version: 9, snapshot: { version: 9, isOver: false, players: [] }, spectators: 1, ...overrides });

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

/** OnlineService against a scripted server. */
function world({ games = [LIVE] } = {}) {
  const statusListeners = new Set();
  const listeners = new Set();
  const requests = [];
  const replies = {
    hello: () => ({ t: "welcome", d: { user: { account: "carol" }, serverTime: 0, activeGame: null, queue: { state: "idle" } } }),
    "watch.start": (d) => ({ t: "watch.state", d: WATCH_VIEW({ gameId: d.gameId }) }),
    "watch.stop": () => ({ t: "watch.stopped", d: {} }),
  };
  const connection = {
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (t, d) => (requests.push({ t, d }), ok(replies[t]?.(d) ?? { t: "error", d: { code: "UNKNOWN", message: "?" } })),
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  const liveGames = { live: async () => (games === null ? fail("NETWORK", "offline") : ok(games)) };
  const online = new OnlineService({ connection, randomHex: (bytes) => "cd".repeat(bytes), newCommandId: () => "00000000-0000-4000-8000-000000000001", accountDecks: () => [], liveGames, logger: new MemoryLogger() });
  online.start();
  return { online, requests, replies, push: (t, d) => listeners.forEach((listener) => listener({ t, d })), reconnect: () => statusListeners.forEach((listener) => listener("open", { code: null })) };
}

describe("HttpLiveGamesApi", () => {
  it("reads the live games and refuses a malformed list", async () => {
    let body = { games: [LIVE] };
    const api = new HttpLiveGamesApi({ fetch: async () => json(200, body) });
    assert.deepEqual((await api.live()).value, [LIVE]);
    body = { games: [{ ...LIVE, players: [{ seat: "s0", account: "<b>x</b>" }, LIVE.players[1]] }] };
    assert.equal((await api.live()).error.code, "BAD_RESPONSE");
    body = { games: [{ ...LIVE, gameId: "../admin" }] };
    assert.equal((await api.live()).error.code, "BAD_RESPONSE");
    body = { games: [] };
    assert.deepEqual((await api.live()).value, []);
  });
});

describe("OnlineService: watching", () => {
  it("watches one game through a seatless session that can play nothing", async () => {
    const { online, requests, push } = world();
    await flush();
    assert.equal(online.canWatch, true);
    const watched = await online.watch(GAME);
    const session = watched.value;
    assert.equal(online.state.watching, session);
    assert.deepEqual([session.isSpectating, session.humanPlayerIds, session.version], [true, [], 9]);
    assert.equal((await session.submit({ type: "END_TURN" })).error.code, "SPECTATOR");
    assert.equal(requests.some((request) => request.t === "game.command"), false, "nothing reaches the server");

    const updates = [];
    session.subscribe((update) => updates.push(update));
    push("watch.events", WATCH_VIEW({ gameId: OTHER, version: 20 }));
    push("watch.events", WATCH_VIEW({ version: 10, events: [{ type: "CARD_DRAWN", playerId: "s0" }] }));
    assert.deepEqual(updates.map((update) => update.version), [10], "only the watched game");

    session.stop();
    assert.equal(online.state.watching, null);
    assert.deepEqual(requests.at(-1), { t: "watch.stop", d: {} });
  });

  it("switches games without a stop, asks again after a reconnection, and stops quietly once the game is over", async () => {
    const { online, requests, push, reconnect } = world();
    await flush();
    const first = (await online.watch(GAME)).value;
    const second = (await online.watch(OTHER)).value;
    assert.equal(first.isStopped, true);
    assert.equal(online.state.watching, second);
    assert.equal(requests.filter((request) => request.t === "watch.stop").length, 0, "the server switches by itself");

    reconnect();
    await flush();
    assert.deepEqual(requests.filter((request) => request.t === "watch.start").at(-1), { t: "watch.start", d: { gameId: OTHER } });

    push("watch.events", WATCH_VIEW({ gameId: OTHER, version: 30, snapshot: { version: 30, isOver: true, players: [] } }));
    push("watch.over", { gameId: OTHER, winner: "s1", reason: "CONCEDE" });
    assert.equal(second.result.winner, "s1");
    const sent = requests.length;
    reconnect();
    await flush();
    second.stop();
    assert.equal(requests.slice(sent).some((request) => request.t.startsWith("watch.")), false, "nothing to resume or stop");
  });

  it("reports why a game cannot be watched", async () => {
    const { online, replies } = world();
    await flush();
    replies["watch.start"] = () => ({ t: "error", d: { code: "CONFLICT", message: "at most 50 spectators per game", details: { code: "SPECTATORS_FULL" } } });
    const refused = await online.watch(GAME);
    assert.deepEqual([refused.error.code, refused.error.message], ["SPECTATORS_FULL", "at most 50 spectators per game"]);
    assert.equal(online.state.watching, null);
  });
});

describe("LiveGamesScene", () => {
  it("lists the games and opens the one picked", async () => {
    const { online } = world();
    await flush();
    const navigated = [];
    const scene = new LiveGamesScene(services({ navigate: (id, params) => navigated.push({ id, params }) }), { online });
    scene.enter({});
    await flush();
    const row = scene.root.findById(`live.game.${GAME}`);
    assert.equal(row.text, "@alice vs @bob");
    assert.equal(row.subtitle, "ranked · turn 4 · 2 watching");
    assert.equal(liveGameSubtitle({ ...LIVE, spectators: 1 }), "ranked · turn 4 · 1 watching");
    row.activate();
    await flush();
    assert.equal(navigated[0].id, SceneId.MATCH);
    assert.equal(navigated[0].params.againScene, SceneId.LIVE_GAMES);
    assert.equal(navigated[0].params.session, online.state.watching);
  });

  it("says when nobody plays, or the list cannot be loaded", async () => {
    const empty = new LiveGamesScene(services(), { online: world({ games: [] }).online });
    empty.enter({});
    await flush();
    assert.ok(rendered(empty).includes("Nobody is playing right now."));
    const offline = new LiveGamesScene(services(), { online: world({ games: null }).online });
    offline.enter({});
    await flush();
    assert.ok(rendered(offline).includes("offline"));
  });
});

describe("MatchScene for a spectator", () => {
  it("shows both players' hands as backs, whose turn it is by name, and only a way out", () => {
    const { engine } = createScenario({ p1: { hand: ["lava_brute", "ember_imp"], resources: 5 }, p2: { hand: ["ember_bolt"], battlefield: ["ember_imp"] } });
    const snapshot = engine.getSnapshot(SPECTATOR);
    const stopped = [];
    const session = new RemoteMatchSession({ gameId: GAME, seat: null, request: async () => ok({ t: "error", d: {} }), newCommandId: () => "x", onStop: () => stopped.push(true) });
    session.apply({ version: snapshot.version, snapshot });
    const navigated = [];
    const scene = new MatchScene(services({ navigate: (id) => navigated.push(id) }));
    scene.enter({ session, againScene: SceneId.LIVE_GAMES });
    const texts = rendered(scene);
    assert.ok(texts.some((text) => text.startsWith(`Turn 1 · @${snapshot.players.find((player) => player.id === P1).name}'s turn`)), texts.join("|"));
    assert.ok(!texts.includes("YOU"), "nobody at the table is the viewer");
    assert.ok(texts.some((text) => text.startsWith("Watching @")));
    assert.equal(scene.root.findById("endTurn"), null);
    assert.equal(scene.root.findById("endPhase"), null);
    const layout = computeLayout(snapshot);
    assert.equal(layout.me.handSlots.length, 2, "the bottom hand is card backs");
    assert.equal(layout.opponent.handSlots.length, 1);
    scene.root.findById("leave").activate();
    assert.deepEqual([navigated, stopped], [[SceneId.LIVE_GAMES], [true]]);
  });
});

/** @param {any} snapshot */
function computeLayout(snapshot) {
  return computeBoardLayout(snapshot, "", { logicalWidth: 1600, logicalHeight: 900 });
}
