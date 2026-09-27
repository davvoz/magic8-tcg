import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NO_ILLUSTRATIONS, buildIllustrationManifest } from "../../src/application/content/IllustrationManifest.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();

describe("IllustrationManifest", () => {
  it("reads the illustrations file, centring the focus by default and setting aside cards the game does not know", () => {
    const built = buildIllustrationManifest({
      schemaVersion: 1,
      cards: { ember_imp: { file: "ember_imp.webp" }, cinder_hound: { file: "cinder-hound_v2.png", focus: [0.3, 0.8] }, ghost_card: { file: "ghost.jpg" } },
    }, content.catalog);
    assert.equal(built.ok, true);
    assert.deepEqual([...built.value.entries], [
      ["ember_imp", { file: "ember_imp.webp", focus: [0.5, 0.5] }],
      ["cinder_hound", { file: "cinder-hound_v2.png", focus: [0.3, 0.8] }],
    ]);
    assert.deepEqual(built.value.unknownCards, ["ghost_card"]);
    assert.equal(NO_ILLUSTRATIONS.entries.size, 0);
  });

  it("accepts the empty file the game ships with", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(new URL("../../../../data/art/illustrations.json", import.meta.url), "utf8"));
    assert.equal(buildIllustrationManifest(raw, content.catalog).ok, true);
  });

  it("refuses a malformed file, and file names that could leave the art directory", () => {
    const card = (entry) => ({ schemaVersion: 1, cards: { ember_imp: entry } });
    for (const raw of [
      null,
      { cards: {} },
      { schemaVersion: 2, cards: {} },
      { schemaVersion: 1, cards: [] },
      card("ember_imp.webp"),
      card({}),
      card({ file: "../secret.webp" }),
      card({ file: "art/ember_imp.webp" }),
      card({ file: "ember_imp.gif" }),
      card({ file: "Ember_Imp.webp" }),
      card({ file: "ember_imp.webp", focus: [0.5] }),
      card({ file: "ember_imp.webp", focus: [0.5, 1.5] }),
      card({ file: "ember_imp.webp", focus: ["0.5", 0.5] }),
    ]) {
      assert.equal(buildIllustrationManifest(raw, content.catalog).ok, false, JSON.stringify(raw));
    }
  });
});
