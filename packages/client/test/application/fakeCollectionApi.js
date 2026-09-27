/**
 * An in-memory game server for the collection API: starter offer, minted
 * copies and account decks with versions, behaving like the real one on
 * the paths the client uses. Every call is recorded; `fail` makes the next
 * call to a method fail, `hold` makes calls wait until released.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

/** Deterministic UUIDs: 00000000-0000-4000-8000-00000000000n. */
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * @param {{ content: import("../../src/application/content/ContentService.js").GameContent, starterIds?: readonly string[], claimed?: boolean }} options
 */
export function fakeCollectionApi({ content, starterIds = ["precon_foundry", "precon_harvest", "precon_verdant"], claimed = false }) {
  let next = 1;
  const calls = [];
  /** @type {Map<string, { code: string, message: string }>} */
  const failures = new Map();
  /** @type {Map<string, Promise<void>>} */
  const holds = new Map();
  const state = { claimed, copies: /** @type {{ id: string, definitionId: string, serial: number }[]} */ ([]), decks: new Map() };
  const starters = starterIds.map((id) => content.preconDecks.find((deck) => deck.id === id));

  const owned = () => {
    const counts = new Map();
    for (const copy of state.copies) {
      counts.set(copy.definitionId, (counts.get(copy.definitionId) ?? 0) + 1);
    }
    return counts;
  };
  const view = (deck) => {
    const counts = owned();
    const problems = deck.cards.filter((entry) => (counts.get(entry.cardId) ?? 0) < entry.count).map((entry) => ({ code: "NOT_OWNED", message: `you do not own enough ${entry.cardId}`, cardId: entry.cardId }));
    const size = deck.cards.reduce((total, entry) => total + entry.count, 0);
    if (size < content.deckRules.minSize) {
      problems.push({ code: "TOO_SMALL", message: `deck has ${size} cards`, cardId: null });
    }
    return Object.freeze({ ...deck, playable: problems.length === 0, problems });
  };
  const createDeck = (input) => {
    const deck = { id: uuid(next++), name: input.name, faction: input.faction, cards: input.cards.map((entry) => ({ cardId: entry.cardId, count: entry.count })), version: 1 };
    state.decks.set(deck.id, deck);
    return view(deck);
  };

  /**
   * @param {string} name
   * @param {(...args: any[]) => unknown} handler
   */
  const method = (name, handler) => async (...args) => {
    calls.push({ name, args });
    await holds.get(name);
    const failure = failures.get(name);
    if (failure !== undefined) {
      failures.delete(name);
      return fail(failure.code, failure.message);
    }
    return handler(...args);
  };

  const api = {
    starter: method("starter", () => ok({ claimed: state.claimed, choices: starters.map((deck) => ({ id: deck.id, name: deck.name, faction: deck.faction, size: deck.totalCards, cards: deck.entries })) })),
    claimStarter: method("claimStarter", (starterId) => {
      const starter = starters.find((deck) => deck.id === starterId);
      if (starter === undefined) {
        return fail("UNKNOWN_STARTER", "choose one of the offered starter decks");
      }
      if (state.claimed) {
        return fail("STARTER_ALREADY_CLAIMED", "you already received your starter deck");
      }
      state.claimed = true;
      for (const entry of starter.entries) {
        for (let copy = 0; copy < entry.count; copy += 1) {
          state.copies.push({ id: uuid(next++), definitionId: entry.cardId, serial: state.copies.length + 1 });
        }
      }
      return ok({ deck: createDeck({ name: starter.name, faction: starter.faction, cards: starter.entries }), cardsGranted: starter.totalCards });
    }),
    collection: method("collection", () => {
      const groups = new Map();
      for (const copy of state.copies) {
        groups.set(copy.definitionId, [...(groups.get(copy.definitionId) ?? []), { id: copy.id, edition: "core-1", serial: copy.serial, status: "active" }]);
      }
      return ok([...groups].map(([definitionId, copies]) => ({ definitionId, copies })));
    }),
    listDecks: method("listDecks", () => ok([...state.decks.values()].map(view))),
    createDeck: method("createDeck", (input) => ok(createDeck(input))),
    updateDeck: method("updateDeck", (id, version, input) => {
      const deck = state.decks.get(id);
      if (deck === undefined) {
        return fail("NOT_FOUND", "no such deck");
      }
      if (deck.version !== version) {
        return fail("PRECONDITION_FAILED", "the deck was changed elsewhere; reload it");
      }
      const updated = { ...deck, name: input.name, faction: input.faction, cards: input.cards.map((entry) => ({ cardId: entry.cardId, count: entry.count })), version: deck.version + 1 };
      state.decks.set(id, updated);
      return ok(view(updated));
    }),
    deleteDeck: method("deleteDeck", (id) => (state.decks.delete(id) ? ok(null) : fail("NOT_FOUND", "no such deck"))),
  };

  return {
    api,
    calls,
    state,
    /** Makes the next call to `name` fail. */
    fail: (name, code, message = code) => failures.set(name, { code, message }),
    /** Makes calls to `name` wait; returns the release function. */
    hold: (name) => {
      let release;
      holds.set(name, new Promise((resolve) => (release = resolve)));
      return () => {
        holds.delete(name);
        release();
      };
    },
  };
}
