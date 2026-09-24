/**
 * The online lobby against a real OnlineService and a scripted server:
 * decks with their playability, queueing, and handing the match to the
 * match screen once the server starts the game.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { OnlineScene } from "../../src/rendering/scenes/OnlineScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";

async function harness() {
  const listeners = new Set();
  const statusListeners = new Set();
  const requests = [];
  const connection = {
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (t, d) => {
      requests.push({ t, d });
      if (t === "hello") {
        return ok({ t: "welcome", d: { user: {}, serverTime: 0, activeGame: null, queue: { state: "idle" } } });
      }
      return ok({ t: t === "queue.join" ? "queue.status" : "ok", d: { state: t === "queue.join" ? "searching" : "idle" } });
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  const online = new OnlineService({
    connection,
    randomHex: (bytes) => "ab".repeat(bytes),
    newCommandId: () => "00000000-0000-4000-8000-000000000001",
    accountDecks: () => [
      { id: "11111111-1111-4111-8111-111111111111", name: "Iron Foundry", faction: "iron", totalCards: 30, playable: true, problem: null },
      { id: "22222222-2222-4222-8222-222222222222", name: "Draft", faction: "ember", totalCards: 3, playable: false, problem: "deck has 3 cards; minimum is 30" },
    ],
    logger: new MemoryLogger(),
  });
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  const scene = new OnlineScene(services, { content, online });
  scene.enter({});
  await flush();
  return { scene, online, requests, navigated, push: (t, d) => listeners.forEach((listener) => listener({ t, d })) };
}

const byId = (scene, id) => scene.root.findById(id);
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}

describe("OnlineScene", () => {
  it("lists the account's decks, unplayable ones disabled with the reason", async () => {
    const { scene } = await harness();
    const good = byId(scene, "online.deck.11111111-1111-4111-8111-111111111111");
    const draft = byId(scene, "online.deck.22222222-2222-4222-8222-222222222222");
    assert.equal(good.selected, true);
    assert.equal(draft.enabled, false);
    assert.match(draft.subtitle, /not playable: deck has 3 cards/);
    assert.ok(rendered(scene).some((text) => text.includes("first player is drawn by lot")));
  });

  it("queues with the selected deck, can stop, and opens the match when the server starts it", async () => {
    const { scene, requests, navigated, push } = await harness();
    byId(scene, "online.find").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "queue.join").d, { mode: "casual", deckId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(byId(scene, "online.cancel").text, "Stop searching");

    push("match.found", { gameId: GAME, seat: "s1", opponent: { account: "bob" }, seedCommit: "ef".repeat(32) });
    assert.ok(rendered(scene).some((text) => text.includes("Opponent found: @bob")));
    push("game.events", { gameId: GAME, seat: "s1", status: "ACTIVE", opponent: { account: "bob" }, version: 3, snapshot: { version: 3, isOver: false }, events: [] });
    const match = navigated.at(-1);
    assert.equal(match.id, SceneId.MATCH);
    assert.deepEqual(match.params.session.humanPlayerIds, ["s1"]);
    assert.equal(match.params.againScene, SceneId.ONLINE, "play again leads back to the lobby");
  });
});
