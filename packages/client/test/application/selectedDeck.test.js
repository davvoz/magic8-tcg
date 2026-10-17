/**
 * The deck the player plays with: chosen once, kept between visits, and
 * taken up by each screen among its own decks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SelectedDeck, parseSelectedDeck } from "../../src/application/decks/SelectedDeck.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { SELECTED_DECK_STORAGE_KEY, StoredSelectedDeck } from "../../src/infrastructure/persistence/StoredSelectedDeck.js";

const over = (store) => new SelectedDeck({ preferences: new StoredSelectedDeck({ store, logger: new MemoryLogger() }) });

describe("SelectedDeck", () => {
  it("keeps the deck chosen between visits, and tells who listens", () => {
    const store = new InMemoryStore();
    const selected = over(store);
    assert.equal(selected.deckId, null);
    const heard = [];
    selected.subscribe((state) => heard.push(state.deckId));
    selected.choose("deck-b");
    selected.choose("deck-b");
    assert.deepEqual(heard, ["deck-b"], "choosing it again changes nothing");
    assert.equal(over(store).deckId, "deck-b");
    assert.ok(store.read(SELECTED_DECK_STORAGE_KEY).value.includes("deck-b"));
  });

  it("starts each screen on the chosen deck while it can be played there, else on the first that can", () => {
    const store = new InMemoryStore();
    const selected = over(store);
    const decks = [{ id: "a", ok: false }, { id: "b", ok: true }, { id: "c", ok: true }];
    const read = { idOf: (deck) => deck.id, playable: (deck) => deck.ok };
    assert.equal(selected.pick(decks, read)?.id, "b", "nothing chosen: the first playable");
    selected.choose("c");
    assert.equal(selected.pick(decks, read)?.id, "c");
    selected.choose("a");
    assert.equal(selected.pick(decks, read)?.id, "b", "the chosen one cannot be played here");
    assert.equal(selected.pick([], read), null);
  });

  it("reads back only a deck id", () => {
    assert.equal(parseSelectedDeck({ deckId: "x" }), "x");
    assert.equal(parseSelectedDeck({ deckId: 3 }), null);
    assert.equal(parseSelectedDeck({ deckId: "" }), null);
    assert.equal(parseSelectedDeck("x"), null);
  });
});
