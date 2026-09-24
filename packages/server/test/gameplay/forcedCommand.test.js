/**
 * The only moves the server makes for an absent player: never a card, never a target.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FORCED_COMMAND_TYPES } from "@magic8/protocol";
import { forcedCommandFor } from "../../src/modules/gameplay/domain/forcedCommand.js";

const snapshot = (phase, { canEndTurn = false, canEndPhase = false } = {}) => ({ phase, legalMoves: { canEndTurn, canEndPhase } });

describe("forcedCommandFor", () => {
  it("declares no block, no attack, then ends the turn or the phase", () => {
    assert.deepEqual(forcedCommandFor(snapshot("COMBAT_BLOCKERS")), { type: "DECLARE_BLOCKERS", blocks: [] });
    assert.deepEqual(forcedCommandFor(snapshot("COMBAT_ATTACKERS")), { type: "DECLARE_ATTACKERS", attackerIds: [] });
    assert.deepEqual(forcedCommandFor(snapshot("MAIN_1", { canEndTurn: true, canEndPhase: true })), { type: "END_TURN" });
    assert.deepEqual(forcedCommandFor(snapshot("MAIN_1", { canEndPhase: true })), { type: "END_PHASE" });
    assert.deepEqual(forcedCommandFor(snapshot("MAIN_1")), { type: "CONCEDE" }, "stuck: forfeit rather than act");
  });

  it("only ever uses the command types the protocol allows for forced moves", () => {
    const phases = ["COMBAT_BLOCKERS", "COMBAT_ATTACKERS", "MAIN_1"];
    for (const phase of phases) {
      for (const moves of [{}, { canEndTurn: true }, { canEndPhase: true }]) {
        assert.ok(FORCED_COMMAND_TYPES.includes(forcedCommandFor(snapshot(phase, moves)).type));
      }
    }
  });
});
