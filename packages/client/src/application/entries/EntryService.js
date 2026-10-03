/**
 * The player's entries for the screens: how many ranked entries they hold
 * and what a ranked game costs now. Read on demand (the lobby), again after
 * a purchase or a game, and forgotten when the player signs out. The server
 * decides everything: this only tells the player before they try.
 */
import { RANKED_ENTRY } from "../ports/EntriesApi.contract.js";

/**
 * @typedef {import("../ports/EntriesApi.contract.js").Entries} Entries
 * @typedef {Readonly<{ loading: boolean, entries: readonly Entries[] | null, error: string | null }>} EntryState `entries` null until first read
 */

/** @type {EntryState} */
const INITIAL = Object.freeze({ loading: false, entries: null, error: null });

export class EntryService {
  #api;
  /** @type {EntryState} */
  #state = INITIAL;
  /** @type {Set<(state: EntryState) => void>} */
  #listeners = new Set();
  #generation = 0;

  /** @param {{ api: import("../ports/EntriesApi.contract.js").EntriesApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  get state() {
    return this.#state;
  }

  /** The ranked entries, once read. @returns {Entries | null} */
  get ranked() {
    return this.#state.entries?.find((entries) => entries.kind === RANKED_ENTRY) ?? null;
  }

  /** Whether the player holds what a ranked game costs now (true when it is free or not known yet: the server decides). */
  get canPlayRanked() {
    const ranked = this.ranked;
    return ranked === null || ranked.balance >= ranked.perGame;
  }

  /**
   * @param {(state: EntryState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Reads the player's entries; an answer that arrives after a reset is dropped. */
  async refresh() {
    const generation = this.#generation;
    this.#set({ loading: true, error: null });
    const read = await this.#api.entries();
    if (generation !== this.#generation) {
      return;
    }
    this.#set(read.ok ? { loading: false, entries: read.value, error: null } : { loading: false, error: read.error.message });
  }

  /** Forgets everything (sign-out, account change). */
  reset() {
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /** @param {Partial<EntryState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

/**
 * What the lobby says about ranked entries, or null when ranked play is free (or not known yet).
 * @param {Entries | null} ranked
 */
export function entriesText(ranked) {
  if (ranked === null || ranked.perGame === 0) {
    return null;
  }
  const fee = `${ranked.perGame} ${entryWord(ranked.perGame)} a game`;
  const held = ranked.balance === 0 ? "You have no ranked entries" : `You have ${rankedEntriesText(ranked.balance)}`;
  return `${held} · ${fee} · every entry goes into the season's jackpot.`;
}

/** "entry" or "entries" @param {number} count */
const entryWord = (count) => (count === 1 ? "entry" : "entries");

/** "1 ranked entry", "3 ranked entries" @param {number} count */
export const rankedEntriesText = (count) => `${count} ranked ${entryWord(count)}`;
