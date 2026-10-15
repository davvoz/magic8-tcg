/**
 * The daily challenges for the screens (docs/tcg/24-sfide.md): today's
 * opponents and the player's progress, read from the server; the choice of
 * the day's track; starting the next challenge. The challenge itself is a
 * game like any online game: once started, it arrives through the online
 * service (match.found), and the server settles it.
 *
 * It also knows the characters of the day by their seat names, so the match
 * screen can name an opponent "Kael" rather than "@ai_kael".
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { characterIdOf, isCharacterAccount } from "./characters.js";

/**
 * @typedef {import("../ports/DailyApi.contract.js").DailyDay} DailyDay
 * @typedef {import("../ports/DailyApi.contract.js").DailyOpponent} DailyOpponent
 * @typedef {Readonly<{ loading: boolean, day: DailyDay | null, error: string | null, busy: string | null }>} DailyState
 *   `day` null until first read; `busy`: what is being asked of the server (a track chosen, a challenge started)
 */

export const DailyBusy = Object.freeze({ TRACK: "track", PLAY: "play" });

/** @type {DailyState} */
const INITIAL = Object.freeze({ loading: false, day: null, error: null, busy: null });

export class DailyService {
  #api;
  /** @type {DailyState} */
  #state = INITIAL;
  /** @type {Set<(state: DailyState) => void>} */
  #listeners = new Set();
  /** Every character met today or before (by id): the match screen names them even after the day changes. @type {Map<string, DailyOpponent>} */
  #characters = new Map();
  #generation = 0;

  /** @param {{ api: import("../ports/DailyApi.contract.js").DailyApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: DailyState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The challenge to play now: the first one not beaten; null when all are, or before the day is read. */
  get next() {
    return this.#state.day?.opponents.find((opponent) => opponent.state === "next") ?? null;
  }

  /**
   * The character a seat name stands for, when it is one met here.
   * @param {string | null | undefined} account
   * @returns {DailyOpponent | null}
   */
  characterOf(account) {
    return isCharacterAccount(account) ? this.#characters.get(characterIdOf(/** @type {string} */ (account))) ?? null : null;
  }

  /** Reads today again; an answer that arrives after a reset is dropped. */
  async refresh() {
    const generation = this.#generation;
    this.#set({ loading: true, error: null });
    const read = await this.#api.today();
    if (generation === this.#generation) {
      this.#took(read, { loading: false });
    }
  }

  /**
   * Fixes today's track (it changes tomorrow).
   * @param {string} track
   */
  async chooseTrack(track) {
    return this.#asking(DailyBusy.TRACK, async () => {
      const chosen = await this.#api.chooseTrack(track);
      this.#took(chosen, {});
      return chosen.ok ? ok(undefined) : chosen;
    });
  }

  /**
   * Starts the next challenge with an account deck (or gives back the game already in play).
   * @param {string} deckId the server's id of the deck
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the game's id
   */
  async play(deckId) {
    return this.#asking(DailyBusy.PLAY, async () => {
      const started = await this.#api.play(deckId);
      if (!started.ok) {
        this.#set({ error: started.error.message });
        return started;
      }
      return ok(started.value.gameId);
    });
  }

  /** Forgets the player's day (sign-out, account change). */
  reset() {
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /**
   * One request at a time: a second click while the server works is ignored.
   * @template T
   * @param {string} what
   * @param {() => Promise<T>} request
   * @returns {Promise<T | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #asking(what, request) {
    if (this.#state.busy !== null) {
      return fail("BUSY", "the server is still answering the last request");
    }
    const generation = this.#generation;
    this.#set({ busy: what, error: null });
    try {
      return await request();
    } finally {
      if (generation === this.#generation) {
        this.#set({ busy: null });
      }
    }
  }

  /**
   * @param {import("@magic8/engine/shared/Result.js").Ok<DailyDay> | import("@magic8/engine/shared/Result.js").Fail} read
   * @param {Partial<DailyState>} changes
   */
  #took(read, changes) {
    if (!read.ok) {
      this.#set({ ...changes, error: read.error.message });
      return;
    }
    for (const opponent of read.value.opponents) {
      this.#characters.set(opponent.id, opponent);
    }
    this.#set({ ...changes, day: read.value, error: null });
  }

  /** @param {Partial<DailyState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
