import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGameRules } from "../../src/domain/game/GameRules.js";

const raw = () => ({
  schemaVersion: 1,
  startingLife: 20,
  startingHandSize: 5,
  cardsDrawnPerTurn: 1,
  firstPlayerSkipsFirstDraw: true,
  maxHandSize: 10,
  maxBattlefieldCreatures: 7,
  resource: { type: "incremental", gainPerTurn: 1, max: 10, startingMax: 0 },
  combat: { blockersEnabled: true, summoningSickness: true, maxBlockersPerAttacker: 1 },
  emptyLibrary: { mode: "fatigue", damagePerDraw: 1 },
  limits: { maxEffectsPerResolution: 200, maxEventsPerCommand: 500 },
});

describe("validateGameRules", () => {
  it("accepts the reference configuration and freezes nested objects", () => {
    const result = validateGameRules(raw());
    assert.equal(result.ok, true);
    assert.equal(result.value.resource.max, 10);
    assert.ok(Object.isFrozen(result.value.combat));
    assert.ok(Object.isFrozen(result.value));
  });

  it("rejects unknown resource models, out-of-bound values and startingMax above max", () => {
    assert.equal(validateGameRules({ ...raw(), resource: { ...raw().resource, type: "lands" } }).ok, false);
    assert.equal(validateGameRules({ ...raw(), startingLife: 0 }).ok, false);
    assert.equal(validateGameRules({ ...raw(), resource: { ...raw().resource, startingMax: 11 } }).ok, false);
    assert.equal(validateGameRules({ ...raw(), limits: { maxEffectsPerResolution: 0, maxEventsPerCommand: 1 } }).ok, false);
  });

  it("rejects missing sections and unknown fields", () => {
    const missing = raw();
    delete missing.combat;
    assert.equal(validateGameRules(missing).ok, false);
    assert.equal(validateGameRules({ ...raw(), cheat: true }).ok, false);
  });
});
