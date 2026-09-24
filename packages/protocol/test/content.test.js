import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { buildGameContent } from "@magic8/engine/domain/content/GameContent.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { contentHashOf, openContent, sealContent } from "../src/index.js";

const DATA = resolve(import.meta.dirname, "../../../data");
const readJson = (path) => JSON.parse(readFileSync(join(DATA, path), "utf8"));
const listJson = (directory, suffix) =>
  readdirSync(join(DATA, directory))
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => readJson(`${directory}/${name}`));

const bundled = Object.freeze({
  cardSets: listJson("cards", ".cards.json"),
  preconDecks: listJson("decks", ".deck.json"),
  gameRules: readJson("rules/game-rules.json"),
  deckRules: readJson("rules/deck-rules.json"),
});

describe("content identity", () => {
  it("hashes the canonical payload with its own domain tag", () => {
    const { hash, payload } = sealContent(bundled);
    const expected = createHash("sha256").update("m8tcg/v1/content").update(Buffer.from([0])).update(payload).digest("hex");
    assert.equal(hash, expected);
    assert.equal(contentHashOf(payload), hash);
    assert.equal(sealContent({ ...bundled }).hash, hash, "key order of the input does not matter");
  });

  it("opens a matching payload into content the engine accepts", () => {
    const { hash, payload } = sealContent(bundled);
    const raw = openContent(payload, hash);
    assert.ok(raw !== null);
    const content = buildGameContent(raw, createCoreEffectRegistry());
    assert.equal(content.ok, true);
    assert.equal(content.value.catalog.all().length, bundled.cardSets.reduce((sum, set) => sum + set.cards.length, 0));
  });

  it("refuses payloads that do not match, are not canonical or are not content", () => {
    const { hash, payload } = sealContent(bundled);
    assert.equal(openContent(payload.replace('"cost":1', '"cost":0'), hash), null, "an edited card");
    const spaced = payload.replace(":", ": ");
    assert.equal(openContent(spaced, contentHashOf(spaced)), null, "right hash, but not canonical");
    assert.equal(openContent("[1,2]", contentHashOf("[1,2]")), null, "canonical, but not an object");
    assert.equal(openContent(/** @type {any} */ (42), hash), null);
  });
});
