/**
 * The replay screen (docs/tcg/23-automatica.md): it reads a played auto
 * game, hands the board a session that replays it, and says why when the
 * game cannot be replayed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { ReplayScene, replayErrorText } from "../../src/rendering/scenes/ReplayScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadTheme } from "./fakes.js";

const theme = loadTheme();
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @param {(gameId: string) => Promise<unknown>} open */
function harness(open, scenes = [SceneId.NOTIFICATIONS, SceneId.MATCH], account = "alice") {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const asked = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: (id) => scenes.includes(id) };
  const identity = { state: { user: account === null ? null : { account } } };
  const scene = new ReplayScene(services, /** @type {any} */ ({ identity, autoReplays: { open: (gameId, options) => (asked.push({ gameId, options }), open(gameId)) } }));
  return { scene, navigated, asked };
}

describe("ReplayScene", () => {
  it("hands the board the replay once it is ready; the board's Back leads where the player came from", async () => {
    const session = { stop: () => undefined };
    const { scene, navigated, asked } = harness(async () => ok({ session, replay: {} }));
    scene.enter({ gameId: GAME, from: SceneId.NOTIFICATIONS });
    assert.match(scene.root.findById("replay.status").text, /Loading the game/);
    await flush();
    assert.deepEqual(asked, [{ gameId: GAME, options: { viewer: "alice" } }], "seen from the seat of the player looking, if it is their game");
    assert.deepEqual(navigated, [{ id: SceneId.MATCH, params: { session, againScene: SceneId.NOTIFICATIONS } }]);
  });

  it("says why a game cannot be replayed, and Back returns", async () => {
    const { scene, navigated } = harness(async () => fail("UNREPLAYABLE", "this game was played with other cards than the ones this game knows: it cannot be replayed"));
    scene.enter({ gameId: GAME, from: "nowhere" });
    await flush();
    assert.match(scene.root.findById("replay.status").text, /cannot be replayed/);
    scene.root.findById("replay.back").activate();
    assert.deepEqual(navigated, [{ id: SceneId.MAIN_MENU, params: undefined }], "an unknown origin leads to the menu");
  });

  it("opens the game for nobody in particular when nobody is signed in", async () => {
    const { scene, asked } = harness(async () => fail("NOT_FOUND", "no such auto game"), undefined, null);
    scene.enter({ gameId: GAME });
    await flush();
    assert.deepEqual(asked[0].options, { viewer: null });
  });

  it("drops a replay that arrives after the player left", async () => {
    let stopped = false;
    let answer;
    const { scene, navigated } = harness(() => new Promise((resolve) => (answer = resolve)));
    scene.enter({ gameId: GAME });
    scene.exit();
    answer(ok({ session: { stop: () => (stopped = true) }, replay: {} }));
    await flush();
    assert.deepEqual(navigated, []);
    assert.equal(stopped, true);
  });

  it("words the server's failures", () => {
    assert.equal(replayErrorText({ code: "NOT_FOUND", message: "no such auto game" }), "This game cannot be found.");
    assert.match(replayErrorText({ code: "NETWORK", message: "offline" }), /could not be loaded: offline/);
  });
});
