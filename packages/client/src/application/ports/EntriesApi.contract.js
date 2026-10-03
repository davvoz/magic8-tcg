/**
 * A player's entries to paid game modes, as the server keeps them: how many
 * they hold of each kind, and what a game costs now. Entries are bought in
 * the shop (products whose contents are of type "entry").
 *
 * @typedef {Readonly<{ kind: string, balance: number, perGame: number, season: string | null }>} Entries `perGame` 0: a game of that mode is free now
 *
 * @typedef {object} EntriesApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly Entries[]> | import("@magic8/engine/shared/Result.js").Fail>} entries
 */

/** The kind of entry ranked games take. */
export const RANKED_ENTRY = "ranked";
