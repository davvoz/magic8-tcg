/**
 * A game with match conditions (a daily challenge's boss fight), on the
 * board: the character is named as such, never as an account, and the
 * game's rules are one button away, in words.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();

/**
 * @param {{ compact?: boolean, conditions?: readonly Record<string, unknown>[] }} [options]
 */
async function board({ compact = false, conditions = [] } = {}) {
  const { engine } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, conditions });
  const session = new MatchSession({
    engine,
    controllers: new Map([
      [P1, humanController],
      [P2, new BasicAiController()],
    ]),
    scheduler: immediateScheduler,
    logger: new MemoryLogger(),
    accounts: new Map([
      [P1, "alice"],
      [P2, "ai_gravelord"],
    ]),
  });
  session.start();
  await session.whenIdle();
  const viewport = new Viewport(theme.layout);
  viewport.resize(compact ? { cssWidth: 667, cssHeight: 375 } : { cssWidth: 1600, cssHeight: 900 });
  const scene = new MatchScene({ theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true }, { characterName: (account) => (account === "ai_gravelord" ? "The Gravelord" : null) });
  scene.enter({ session });
  return scene;
}

const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};
const find = (scene, id) => (scene.modal ?? scene.root).findById(id) ?? scene.root.findById(id);

describe("MatchScene — a daily challenge's table", () => {
  it("names the character as itself, never as an account", async () => {
    const scene = await board();
    const texts = rendered(scene);
    assert.ok(texts.some((text) => text.includes("The Gravelord")), texts.filter((text) => /grave/i.test(text)).join(" | "));
    assert.ok(!texts.some((text) => text.includes("@ai_gravelord")));
  });

  it("offers the game's rules in words when it has some, and nothing otherwise", async () => {
    const plain = await board();
    assert.equal(find(plain, "rules"), null);

    const scene = await board({ conditions: [{ kind: "cost", players: [P1], filter: { type: "spell" }, amount: 1 }, { kind: "extra_draw", players: [P1, P2], amount: 1 }] });
    find(scene, "rules").activate();
    assert.equal(scene.modal?.id, "rules");
    const texts = rendered(scene);
    assert.ok(texts.includes("Rules of this game"));
    assert.ok(texts.some((text) => text.includes("Your spells cost 1 more")), texts.join(" | "));
    assert.ok(texts.some((text) => text.includes("Everyone draws 1 more card each turn")));
  });

  it("puts the rules in the log dialog on a phone", async () => {
    const scene = await board({ compact: true, conditions: [{ kind: "enter_stats", players: [P2], attack: 0, health: 2 }] });
    find(scene, "log.open").activate();
    find(scene, "logModal.rules").activate();
    assert.ok(rendered(scene).some((text) => text.includes("The Gravelord's creatures enter the battlefield with +0/+2")));
  });
});
