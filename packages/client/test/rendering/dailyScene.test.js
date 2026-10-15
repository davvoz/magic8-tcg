/**
 * The daily challenges screen (docs/tcg/24-sfide.md), against the real
 * DailyService over a scripted server and a stand-in online service: the
 * track asked once, the next challenge fought with a deck and handed over to
 * the match, the opponent's last words, the pack won shown once, and the
 * phone's layout kept on screen.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { DailyService } from "../../src/application/daily/DailyService.js";
import { OnlineStatus } from "../../src/application/online/OnlineService.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { DailyScene } from "../../src/rendering/scenes/DailyScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { DAY } from "../application/dailyFixtures.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const NOW = Date.UTC(2026, 9, 15, 20, 30);
const RUN = Object.freeze({ track: "hard", stage: 0, gameId: null, attempts: 0, rewarded: false, last: null, reward: null });

/** Lets the scripted server's answers land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The screen over a day the server keeps answering with `day` (changed by `serve`).
 * @param {{ compact?: boolean, day?: any }} [options]
 */
async function world({ compact = false, day = DAY } = {}) {
  let served = day;
  const calls = [];
  const api = {
    today: async () => ok(served),
    chooseTrack: async (track) => (calls.push(["track", track]), (served = { ...served, run: { ...RUN, track } }), ok(served)),
    play: async (deckId) => (calls.push(["play", deckId]), ok({ gameId: "game-9" })),
  };
  const daily = new DailyService({ api });
  const listeners = new Set();
  const online = {
    state: { status: OnlineStatus.IDLE, session: null, mode: null },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    decks: () => [
      { id: "d-1", name: "Iron Foundry", playable: true },
      { id: "d-2", name: "Broken deck", playable: false },
      { id: "d-3", name: "Ember Vanguard", playable: true },
    ],
    resume: () => online.state.session,
  };
  const viewport = new Viewport(theme.layout);
  viewport.resize(compact ? { cssWidth: 667, cssHeight: 375 } : { cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  const scene = new DailyScene(services, { content, daily, online, logger: new MemoryLogger() }, { now: () => NOW });
  scene.enter({});
  await settle();
  const startGame = (gameId) => {
    online.state = { status: OnlineStatus.PLAYING, session: { gameId, hasSnapshot: true, isStopped: false }, mode: "daily" };
    listeners.forEach((listener) => listener(online.state));
  };
  return { scene, daily, calls, navigated, viewport, startGame, serve: (next) => (served = next) };
}

const byId = (scene, id) => (scene.modal ?? scene.root).findById(id) ?? scene.root.findById(id);
const click = (node) => {
  assert.ok(node, "node exists");
  assert.equal(node.isEffectivelyEnabled, true, `${node.id} is enabled`);
  node.activate();
};
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}
function nodes(root) {
  const found = [];
  const visit = (node) => {
    found.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return found;
}

describe("DailyScene", () => {
  it("shows today's three opponents, the boss's rule, and the time left", async () => {
    const { scene } = await world();
    const texts = rendered(scene);
    for (const text of ["Kael", "Sira", "Wyrm", "Boss", "Next", "“kael says hello”"]) {
      assert.ok(texts.includes(text), `shows ${text}`);
    }
    assert.ok(texts.some((text) => text.startsWith("Scorched Earth")), "the boss's rule");
    assert.ok(texts.some((text) => text.includes("New opponents in 3h 30m")), "the time left today");
    for (const text of ["Ember Vanguard · 30 cards", "Plays aggressive"]) {
      assert.ok(!texts.includes(text), `keeps the opponent's specifics to itself: ${text}`);
    }
  });

  it("asks before fixing the day's track, then offers the fight", async () => {
    const { scene, calls } = await world();
    click(byId(scene, "daily.track.hard"));
    assert.equal(scene.modal?.id !== undefined, true, "a confirmation first");
    const confirm = nodes(scene.modal).find((node) => node.interactive && /Play Hard/.test(node.text ?? ""));
    click(confirm);
    await settle();
    assert.deepEqual(calls, [["track", "hard"]]);
    assert.equal(byId(scene, "daily.fight").text, "Fight Kael");
    assert.equal(byId(scene, "daily.deck").text, "Deck: Iron Foundry");
    click(byId(scene, "daily.deck"));
    assert.equal(byId(scene, "daily.deck").text, "Deck: Ember Vanguard", "only playable decks come round");
  });

  it("starts the challenge with the chosen deck and hands over to the match once the game starts", async () => {
    const { scene, calls, navigated, startGame } = await world({ day: { ...DAY, run: RUN } });
    click(byId(scene, "daily.fight"));
    await settle();
    assert.deepEqual(calls, [["play", "d-1"]]);
    assert.equal(byId(scene, "daily.fight").text, "Starting…");
    startGame("another-game");
    assert.deepEqual(navigated, [], "another game is not this challenge");
    startGame("game-9");
    assert.equal(navigated.at(-1)?.id, SceneId.MATCH);
    assert.equal(navigated.at(-1)?.params.againScene, SceneId.DAILY, "the match comes back here");
  });

  it("tells how the last challenge went, in the opponent's words, and the boss's entrance", async () => {
    const lost = await world({ day: { ...DAY, run: { ...RUN, attempts: 1, last: { gameId: "g-1", stage: 0, opponent: "kael", result: "loss" } } } });
    assert.match(byId(lost.scene, "daily.status").text, /^Kael won this time\. “kael wins” Fight again/);
    const opponents = DAY.opponents.map((opponent, index) => ({ ...opponent, state: index < 2 ? "beaten" : "next" }));
    const boss = await world({ day: { ...DAY, opponents, run: { ...RUN, stage: 2, attempts: 2 } } });
    assert.equal(byId(boss.scene, "daily.status").text, "The mountain wakes");
    assert.equal(byId(boss.scene, "daily.fight").text, "Fight Wyrm");
  });

  it("shows the pack won once, card by card, and keeps it in reach", async () => {
    const opponents = DAY.opponents.map((opponent) => ({ ...opponent, state: "beaten" }));
    const reward = { pack: "core_booster", cards: [{ id: "x1", definitionId: "ember_imp", serial: 12 }, { id: "x2", definitionId: "pyre_drake", serial: 3 }] };
    const { scene, navigated } = await world({ day: { ...DAY, opponents, run: { ...RUN, stage: 3, rewarded: true, reward } } });
    assert.equal(scene.modal?.id, "daily.reveal", "shown by itself");
    const texts = rendered(scene);
    assert.ok(texts.includes("Your Core Booster"));
    assert.ok(texts.includes("#12") && texts.includes("#3"));
    click(byId(scene, "daily.reveal.close"));
    assert.equal(scene.modal, null);
    scene.relayout();
    assert.equal(scene.modal, null, "once");
    click(byId(scene, "daily.pack"));
    click(byId(scene, "daily.reveal.collection"));
    assert.equal(navigated.at(-1)?.id, SceneId.COLLECTION);
    assert.equal(navigated.at(-1)?.params.fresh.length, 2);
  });

  it("keeps everything on a phone's screen", async () => {
    const { scene, viewport } = await world({ compact: true, day: { ...DAY, run: RUN } });
    const screen = { width: viewport.logicalWidth, height: viewport.logicalHeight };
    for (const node of nodes(scene.root).filter((candidate) => candidate.interactive || candidate.id?.startsWith("daily."))) {
      const { x, y, width, height } = node.bounds;
      assert.ok(x >= 0 && y >= 0 && x + width <= screen.width + 0.5 && y + height <= screen.height + 0.5, `${node.id ?? node.text} at ${JSON.stringify(node.bounds)}`);
    }
  });
});
