import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoadingScreen } from "../../src/rendering/page/LoadingScreen.js";

/** The page's #loading veil, as far as LoadingScreen touches it. */
function fakePage() {
  const status = { textContent: "Reading the stars…" };
  const classes = new Set();
  const element = {
    attributes: new Map(),
    properties: new Map(),
    removed: false,
    status,
    classes,
    querySelector: (selector) => (selector === ".loading-status" ? status : null),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    style: {
      setProperty: (name, value) => element.properties.set(name, value),
    },
    classList: { add: (name) => classes.add(name) },
    remove() {
      this.removed = true;
    },
  };
  return { element, page: { getElementById: (id) => (id === "loading" ? element : null) } };
}

function fakeTimers() {
  const pending = [];
  return {
    setTimeout: (callback, ms) => pending.push({ callback, ms }),
    runAll() {
      while (pending.length > 0) {
        pending.shift().callback();
      }
    },
  };
}

const progress = (element) => Number(element.properties.get("--loading-progress"));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LoadingScreen", () => {
  it("takes the bar over from the page's own creep once the scripts run", () => {
    const { element, page } = fakePage();
    new LoadingScreen(page, fakeTimers());
    assert.equal(element.attributes.has("data-live"), true);
    assert.equal(progress(element), 0.3);
  });

  it("moves the bar as tracked tasks settle, failed ones too, never backwards", async () => {
    const { element, page } = fakePage();
    const loading = new LoadingScreen(page, fakeTimers());
    let fail = () => undefined;
    const first = loading.track(Promise.resolve("a"));
    loading.track(new Promise((_, reject) => (fail = reject))).catch(() => undefined);
    await settle();
    const half = progress(element);
    assert.ok(half > 0.3 && half < 1, `half way: ${half}`);
    assert.equal(await first, "a", "the task is handed back as it was");
    // A task added later lowers the share settled: the bar stays where it is.
    loading.track(new Promise(() => undefined));
    await settle();
    assert.equal(progress(element), half);
    fail(new Error("image missing"));
    await settle();
    assert.ok(progress(element) > half && progress(element) < 1);
  });

  it("tells what the game is doing", () => {
    const { element, page } = fakePage();
    const loading = new LoadingScreen(page, fakeTimers());
    loading.say("Shuffling the decks…");
    assert.equal(element.status.textContent, "Shuffling the decks…");
  });

  it("fills the bar, fades and then removes the veil, once", () => {
    const { element, page } = fakePage();
    const timers = fakeTimers();
    const loading = new LoadingScreen(page, timers);
    loading.finish();
    loading.finish();
    assert.equal(progress(element), 1);
    assert.equal(element.attributes.get("aria-busy"), "false");
    assert.equal(element.classes.has("is-leaving"), false, "the full bar is seen first");
    timers.runAll();
    assert.equal(element.classes.has("is-leaving"), true);
    assert.equal(element.removed, true);
    loading.say("too late");
    assert.notEqual(element.status.textContent, "too late");
  });

  it("does nothing on a page without the veil", () => {
    const loading = new LoadingScreen({ getElementById: () => null }, fakeTimers());
    loading.say("Shuffling the decks…");
    void loading.track(Promise.resolve());
    assert.doesNotThrow(() => loading.finish());
  });
});
