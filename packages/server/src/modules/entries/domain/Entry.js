/**
 * Entries: prepaid credits for game modes that cost something to play
 * (docs/tcg/22-ingressi-ranked.md). An entry of kind K pays for one game of
 * mode K: a player buys entries in the shop, many with one payment, and each
 * game of that mode takes its fee from every player's balance when it is
 * created. A game called off before it started gives them back.
 *
 * @typedef {Readonly<{ count: number, season: string | null }>} Fee what a game of a mode costs now: `count` entries (at least 1); `season` the ranked season charged, if any
 * @typedef {Readonly<{ kind: string, balance: number, perGame: number, season: string | null }>} EntryView a player's entries of one kind, and what a game costs now (0: free)
 */

/** The kinds of entry, each named after the game mode it pays for. */
export const EntryKind = Object.freeze({ RANKED: "ranked" });
/** @type {readonly string[]} */
export const ENTRY_KINDS = Object.freeze(Object.values(EntryKind));

/** Why a balance changed (entry_ledger.reason). */
export const EntryReason = Object.freeze({
  /** A shop order gave entries (ref: the order). */
  PURCHASE: "purchase",
  /** A game took its fee (ref: the game). */
  GAME: "game",
  /** A game called off before it started gave its fee back (ref: the game). */
  REFUND: "refund",
  /** A player joined the auto list: their ticket took the fee of the game it will be (ref: the ticket). */
  AUTO_TICKET: "auto_ticket",
  /** An auto ticket that never became a game gave its fee back (ref: the ticket). */
  AUTO_REFUND: "auto_refund",
});

/**
 * The fee policy when nothing costs anything.
 * @type {Readonly<{ feeOf: (mode: string) => Fee | null }>}
 */
export const FREE_PLAY = Object.freeze({ feeOf: () => null });

/**
 * "1 ranked entry", "3 ranked entries".
 * @param {number} count
 * @param {string} kind
 */
export const entriesText = (count, kind) => `${count} ${kind} ${count === 1 ? "entry" : "entries"}`;
