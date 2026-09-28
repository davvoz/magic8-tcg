/**
 * What a player reads when an online game is called off before it started:
 * whether it was them or their opponent who did not accept it with
 * Keychain, and whether they refused or ran out of time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AbortReason, CancellationCode, cancellationNotice } from "../../src/application/online/cancellation.js";

describe("cancellationNotice", () => {
  it("names the opponent who did not accept, and invites a new search", () => {
    assert.deepEqual(cancellationNotice({ reason: AbortReason.DECLINED, seats: ["s1"], you: "s0" }, "bob"), {
      code: CancellationCode.OPPONENT_DECLINED,
      message: "@bob did not accept the game in Keychain, so it was cancelled. You can look for another opponent.",
    });
    assert.equal(cancellationNotice({ reason: AbortReason.NOT_AUTHORIZED, seats: ["s1"], you: "s0" }, "bob").message, "@bob did not sign the game with Keychain in time, so it was cancelled. You can look for another opponent.");
    assert.match(cancellationNotice({ reason: AbortReason.DECLINED, seats: ["s1"], you: "s0" }, null).message, /^Your opponent did not accept/);
  });

  it("tells the player when it was them, even if the opponent did not sign either", () => {
    assert.deepEqual(cancellationNotice({ reason: AbortReason.DECLINED, seats: ["s0"], you: "s0" }, "bob"), { code: CancellationCode.YOU_DECLINED, message: "You did not accept the game in Keychain, so it was cancelled." });
    assert.equal(cancellationNotice({ reason: AbortReason.NOT_AUTHORIZED, seats: ["s0", "s1"], you: "s1" }, "alice").message, "You did not sign the game with Keychain in time, so it was cancelled.");
  });
});
