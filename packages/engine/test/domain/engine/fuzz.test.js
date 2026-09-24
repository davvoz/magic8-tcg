/**
 * Property-style hardening: for many seeds, drive the engine with a mix of
 * random legal moves (derived from LegalMoves, like the UI would) and random
 * garbage, and check that it never reports ENGINE_ERROR, never throws, keeps
 * its invariants and stays deterministic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandError } from "../../../src/domain/commands/CommandError.js";
import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { ChaChaRandom } from "../../../src/domain/random/ChaChaRandom.js";
import { P1, P2, createEngine, rulesWith } from "./fixtures.js";

const SEEDS = 24;
const MAX_STEPS = 600;
/** Percentage of steps that submit garbage instead of a legal move. */
const GARBAGE_PERCENT = 20;

/** @type {readonly ((rng: ChaChaRandom, snapshot: any) => unknown)[]} */
const GARBAGE = Object.freeze([
  () => null,
  () => "END_TURN",
  () => ({ type: "END_TURN" }),
  () => ({ type: "PLAY_CARD", playerId: "nobody", cardId: "c1" }),
  (rng, snapshot) => ({ type: "PLAY_CARD", playerId: snapshot.awaitingPlayerId, cardId: `c${rng.nextInt(200)}`, targets: ["zzz"] }),
  (rng, snapshot) => ({ type: "DECLARE_ATTACKERS", playerId: snapshot.awaitingPlayerId, attackerIds: Array(50).fill("c1") }),
  (rng, snapshot) => ({ type: "DECLARE_BLOCKERS", playerId: snapshot.awaitingPlayerId, blocks: [{ attackerId: "c1", blockerId: "c1" }] }),
  (rng, snapshot) => ({ type: "END_TURN", playerId: snapshot.awaitingPlayerId === P1 ? P2 : P1 }),
  () => ({ type: "PLAY_CARD", playerId: P1, cardId: "c1", __proto__: { evil: true } }),
  () => ({ type: "CONCEDE", playerId: P1, extra: { deep: { deeper: [1, 2, 3] } } }),
]);

/**
 * A random legal move for whoever is awaited, built the way the UI builds them.
 * @param {ChaChaRandom} rng
 * @param {any} snapshot omniscient snapshot
 * @param {any} moves legal moves of the awaited player
 */
function legalMove(rng, snapshot, moves) {
  const me = snapshot.awaitingPlayerId;
  const choices = [];
  for (const cardId of moves.playableCardIds) {
    const groups = moves.targetOptions[cardId] ?? [];
    if (groups.every((group) => group.length > 0)) {
      choices.push(() => playCard(me, cardId, groups.map((group) => group[rng.nextInt(group.length)])));
    }
  }
  if (moves.canEndPhase) {
    choices.push(() => endPhase(me));
  }
  if (moves.canEndTurn) {
    choices.push(() => endTurn(me));
  }
  if (moves.attackerIds.length > 0 || snapshot.phase === "COMBAT_ATTACKERS") {
    choices.push(() => declareAttackers(me, moves.attackerIds.filter(() => rng.nextInt(10) < 6)));
  }
  if (snapshot.phase === "COMBAT_BLOCKERS" && snapshot.awaitingPlayerId === me) {
    choices.push(() => declareBlockers(me, moves.blockerIds.filter(() => rng.nextInt(2) === 0).map((blockerId) => ({ attackerId: snapshot.combat.attackerIds[rng.nextInt(snapshot.combat.attackerIds.length)], blockerId }))));
  }
  return choices.length === 0 ? null : choices[rng.nextInt(choices.length)]();
}

/** Structural invariants every snapshot must satisfy. */
function checkInvariants(snapshot, rules) {
  assert.ok(Object.isFrozen(snapshot));
  const seen = new Set();
  for (const player of snapshot.players) {
    assert.ok(player.life <= rules.startingLife + 100, "life within sanity bounds");
    assert.ok(player.resources.current >= 0 && player.resources.current <= player.resources.max);
    assert.ok(player.resources.max <= rules.resource.max);
    for (const card of [...player.battlefield, ...player.graveyard, ...(player.hand ?? [])]) {
      assert.ok(!seen.has(card.instanceId), `instance ${card.instanceId} appears in two zones`);
      seen.add(card.instanceId);
      assert.ok(card.health >= 1 || card.zone !== "battlefield", "no dead creature survives on the battlefield");
    }
  }
  if (!snapshot.isOver) {
    assert.ok(snapshot.players.some((player) => player.id === snapshot.awaitingPlayerId), "someone is always awaited while the game runs");
  }
}

/**
 * @param {number} seed
 * @returns {{ steps: number, over: boolean, version: number, accepted: number, rejected: number }}
 */
function fuzzOne(seed) {
  const rules = rulesWith();
  const { engine } = createEngine({ seed, rules });
  const rng = ChaChaRandom.fromSeed(seed * 7919 + 1);
  let accepted = 0;
  let rejected = 0;
  let steps = 0;
  while (steps < MAX_STEPS && !engine.isOver) {
    steps += 1;
    const snapshot = engine.getSnapshot(null);
    checkInvariants(snapshot, rules);
    const moves = engine.getSnapshot(snapshot.awaitingPlayerId).legalMoves;
    const garbage = rng.nextInt(100) < GARBAGE_PERCENT;
    const command = garbage ? GARBAGE[rng.nextInt(GARBAGE.length)](rng, snapshot) : legalMove(rng, snapshot, moves);
    assert.notEqual(command, undefined);
    if (command === null && !garbage) {
      assert.fail(`no legal move for ${snapshot.awaitingPlayerId} in ${snapshot.phase}`);
    }
    const before = engine.version;
    const result = engine.execute(command);
    if (result.ok) {
      accepted += 1;
      assert.ok(engine.version > before, "accepted commands bump the version");
      assert.ok(!garbage || command?.type === "CONCEDE", `garbage was accepted: ${JSON.stringify(command)}`);
    } else {
      rejected += 1;
      assert.notEqual(result.error.code, CommandError.ENGINE_ERROR, `${result.error.message} for ${JSON.stringify(command)}`);
      assert.equal(engine.version, before, "rejected commands leave the state alone");
    }
  }
  checkInvariants(engine.getSnapshot(null), rules);
  return { steps, over: engine.isOver, version: engine.version, accepted, rejected };
}

describe("engine fuzzing", () => {
  it("survives random legal and malformed commands across many seeds without engine errors", () => {
    let finished = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = fuzzOne(seed);
      assert.ok(run.rejected > 0, "garbage was rejected");
      assert.ok(run.accepted > 10, "legal moves were accepted");
      finished += run.over ? 1 : 0;
    }
    assert.ok(finished >= SEEDS / 2, `most random games reach an end (${finished}/${SEEDS})`);
  });

  it("is deterministic: the same seed and the same random command stream give the same state", () => {
    const first = fuzzOne(3);
    const second = fuzzOne(3);
    assert.deepEqual(first, second);
    const { engine: a } = createEngine({ seed: 3 });
    const { engine: b } = createEngine({ seed: 3 });
    assert.deepEqual(a.getSnapshot(null), b.getSnapshot(null));
  });
});
