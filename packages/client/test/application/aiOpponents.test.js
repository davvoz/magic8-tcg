import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiStyle } from "@magic8/engine/domain/ai/BasicAi.js";
import { AiController } from "../../src/application/match/AiController.js";
import { AiKind, AiOpponentFactory, PRACTICE_OPPONENTS, describeAiSpec, parseAiSpec } from "../../src/application/match/AiOpponents.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { ControllerKind } from "../../src/application/match/PlayerController.contract.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const factory = new AiOpponentFactory({ content, effects });

describe("parseAiSpec", () => {
  it("reads basic and search specs, with or without a style", () => {
    assert.deepEqual(parseAiSpec("basic"), { kind: AiKind.BASIC, style: AiStyle.BALANCED });
    assert.deepEqual(parseAiSpec("basic:aggressive"), { kind: AiKind.BASIC, style: AiStyle.AGGRESSIVE });
    assert.deepEqual(parseAiSpec("search:7"), { kind: AiKind.SEARCH, level: 7, style: AiStyle.BALANCED });
    assert.deepEqual(parseAiSpec(" Search:2.5:defensive "), { kind: AiKind.SEARCH, level: 2.5, style: AiStyle.DEFENSIVE });
    assert.equal(describeAiSpec(parseAiSpec("search:7:aggressive")), "search 7 aggressive");
  });

  it("refuses what is not an AI", () => {
    for (const text of ["", "smart", "search", "search:0", "search:11", "search:x", "basic:reckless", "search:5:calm", "basic:aggressive:extra"]) {
      assert.throws(() => parseAiSpec(text), `"${text}"`);
    }
  });
});

describe("AiOpponentFactory", () => {
  it("builds an AI controller for every practice opponent, and refuses unknown kinds", () => {
    for (const opponent of PRACTICE_OPPONENTS) {
      const controller = factory.controllerFor(opponent.spec);
      assert.ok(controller instanceof AiController);
      assert.equal(controller.kind, ControllerKind.AI);
    }
    assert.throws(() => factory.controllerFor({ kind: "oracle" }), TypeError);
  });

  it("seats a search AI that plays a whole local match", async () => {
    const setup = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const [first, second] = content.preconDecks;
    const created = setup.createMatch({
      seats: [
        { id: "a", name: "A", deckList: first, controller: factory.controllerFor({ kind: AiKind.SEARCH, level: 3 }) },
        { id: "b", name: "B", deckList: second, controller: factory.controllerFor({ kind: AiKind.BASIC }) },
      ],
      seed: 3,
    });
    assert.equal(created.ok, true);
    created.value.start();
    await created.value.whenIdle();
    assert.equal(created.value.snapshotFor(null).isOver, true);
  });
});
