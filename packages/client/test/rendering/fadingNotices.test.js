import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FadingNotices, NOTICE_LIFETIME_MS } from "../../src/rendering/scenes/FadingNotices.js";

/** A notice kept somewhere, as a service keeps its last error. */
function kept(initial = null) {
  const box = { notice: initial, forgotten: 0 };
  return { box, source: { read: () => box.notice, forget: () => ((box.notice = null), (box.forgotten += 1)) } };
}

describe("FadingNotices", () => {
  it("forgets a notice once it has been up its whole lifetime, and only then", () => {
    const { box, source } = kept({ message: "turned down" });
    const notices = new FadingNotices([source]);
    assert.equal(notices.tick(0), false, "first seen");
    assert.equal(notices.tick(NOTICE_LIFETIME_MS - 1), false);
    assert.notEqual(box.notice, null);
    assert.equal(notices.tick(1), true);
    assert.equal(box.notice, null);
    assert.equal(box.forgotten, 1);
  });

  it("gives a new notice its own time, and leaves a source with nothing alone", () => {
    const { box, source } = kept({ message: "first" });
    const empty = kept();
    const notices = new FadingNotices([source, empty.source], 1000);
    notices.tick(0);
    notices.tick(900);
    box.notice = { message: "second" };
    notices.tick(900);
    assert.equal(box.notice?.message, "second", "the second has been up 0 ms, not 1800");
    notices.tick(1000);
    assert.equal(box.notice, null);
    assert.equal(empty.box.forgotten, 0);
  });

  it("forgets what was shown when the screen is left, not what was never shown", () => {
    const shown = kept({ message: "shown" });
    const later = kept();
    const notices = new FadingNotices([shown.source, later.source]);
    notices.tick(16);
    later.box.notice = { message: "arrived as the screen was left" };
    notices.forgetShown();
    assert.equal(shown.box.notice, null);
    assert.notEqual(later.box.notice, null);
  });
});
