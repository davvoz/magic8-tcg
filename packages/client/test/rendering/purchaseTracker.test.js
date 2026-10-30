import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHAIN_WAIT_MS, TrackStage } from "../../src/application/payments/purchaseProgress.js";
import { trackerText } from "../../src/rendering/scenes/purchase/PurchaseTracker.js";

const PAYMENT = Object.freeze({ amount: "12.500", asset: "STEEM", to: "verdu.green" });
const WORDS = Object.freeze({ approve: "Approve the transfer in Keychain", done: "", ordering: "Creating your order…" });
/** @param {Partial<import("../../src/application/payments/purchaseProgress.js").PurchaseTrack>} fields */
const track = (fields) => ({ stage: TrackStage.CHAIN, seen: false, final: false, paidAt: 0, payment: PAYMENT, ...fields });

describe("trackerText", () => {
  it("keeps a phone's notes to the length of one line (under a single's card there is room for one)", () => {
    const moments = [
      [track({ stage: TrackStage.PAYMENT, paidAt: null }), 0],
      [track({}), 1000],
      [track({ seen: true }), 1000],
      [track({ seen: true, final: true }), 1000],
      [track({ seen: true }), CHAIN_WAIT_MS + 1000],
    ];
    const notes = moments.map(([at, nowMs]) => trackerText(at, nowMs, { ...WORDS, compact: true }).note);
    const keepPlaying = notes[1];
    assert.match(keepPlaying, /keep playing/);
    for (const note of notes) {
      assert.ok(note.length <= keepPlaying.length, `"${note}" is no longer than the keep-playing line`);
    }
    assert.match(trackerText(track({}), CHAIN_WAIT_MS + 1000, { ...WORDS, compact: false }).note, /as soon as the blockchain confirms/, "a wide screen says it all");
  });
});
