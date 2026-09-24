import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endPhase, endTurn } from "../../../src/domain/commands/commandFactories.js";
import { P1, P2, createEngine, view } from "./fixtures.js";

/**
 * Asserts the value only contains what canonical JSON allows: safe integers,
 * strings, booleans, null, arrays and plain objects.
 * @param {unknown} value
 * @param {string} path
 */
function assertCanonicalData(value, path = "digest") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    assert.ok(Number.isSafeInteger(value) && !Object.is(value, -0), `${path} is not a safe integer: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalData(item, `${path}[${index}]`));
    return;
  }
  assert.equal(typeof value, "object", `${path} has type ${typeof value}`);
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} is not a plain object`);
  for (const [key, item] of Object.entries(/** @type {object} */ (value))) {
    assertCanonicalData(item, `${path}.${key}`);
  }
}

/** Plays a few turns of passing so the state moves without depending on card choices. */
function passTurns(engine, turns) {
  for (let turn = 0; turn < turns; turn += 1) {
    const awaiting = view(engine).awaitingPlayerId;
    assert.equal(engine.execute(endPhase(awaiting)).ok, true);
    assert.equal(engine.execute(endTurn(view(engine).awaitingPlayerId)).ok, true);
  }
}

describe("state digest", () => {
  it("is frozen canonical data", () => {
    const { engine } = createEngine();
    const digest = engine.getStateDigest();
    assert.ok(Object.isFrozen(digest));
    assertCanonicalData(digest);
  });

  it("includes hidden information: full library order and the random generator state", () => {
    const { engine } = createEngine();
    const digest = /** @type {any} */ (engine.getStateDigest());
    const snapshot = view(engine);
    for (const [index, player] of digest.players.entries()) {
      assert.equal(player.zones.library.length, snapshot.players[index].librarySize);
      assert.ok(player.zones.library.every((card) => typeof card.def === "string"));
    }
    assert.match(digest.rng.key, /^[0-9a-f]{64}$/);
  });

  it("is identical for identical seeds and commands, step by step", () => {
    const a = createEngine({ seed: 7 }).engine;
    const b = createEngine({ seed: 7 }).engine;
    assert.deepEqual(a.getStateDigest(), b.getStateDigest());
    for (let step = 0; step < 4; step += 1) {
      passTurns(a, 1);
      passTurns(b, 1);
      assert.deepEqual(a.getStateDigest(), b.getStateDigest(), `after turn ${step + 1}`);
    }
  });

  it("differs when only the seed differs, even if the visible board is the same", () => {
    const a = createEngine({ seed: 1 }).engine;
    const b = createEngine({ seed: 2 }).engine;
    assert.notDeepEqual(a.getStateDigest(), b.getStateDigest());
  });

  it("changes after every committed command and not after a rejected one", () => {
    const { engine } = createEngine();
    const before = engine.getStateDigest();
    const rejected = engine.execute(endTurn(P2));
    assert.equal(rejected.ok, false);
    assert.deepEqual(engine.getStateDigest(), before);
    assert.equal(engine.execute(endPhase(P1)).ok, true);
    assert.notDeepEqual(engine.getStateDigest(), before);
  });
});
