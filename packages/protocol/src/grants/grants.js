/**
 * Grant records (`custom_json` m8tcg_grant): the public birth of copies the
 * game gives away rather than sells, so that, with the purchase receipts,
 * every copy anyone trades or sells can be traced back to its mint.
 *
 * - starter: the free starter deck a new player takes (one per account).
 *     {"cards":[[id, definitionId, serial]…],"deck":"precon_foundry","k":"starter","u":account,"v":1}
 * - daily: the pack won with a day's three daily challenges (docs/tcg/24-sfide.md).
 *     {"cards":[…],"day":"2026-10-15","k":"daily","seed":hex64,"t":hex64,"track":"hard","u":account,"v":1}
 *   `t` is the drop table's hash (as the shop publishes it) and `seed` the
 *   pack's seed: drawPack(table, seed) draws exactly `cards`' definitions.
 *
 * Published by the broadcaster pool, written in the same transaction as the
 * copies it records.
 */
import { Issues, checkArrayOf, checkEnum, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { CanonicalJsonError, canonicalize, parseCanonical, utf8Length } from "../canonical/CanonicalJson.js";
import { ACCOUNT_PATTERN, CARD_ID_PATTERN, LIMITS } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";

export const GRANT_VERSION = 1;
export const GrantKind = Object.freeze({ STARTER: "starter", DAILY: "daily" });
/** Copies one grant may record: a whole deck at most. */
export const MAX_GRANT_CARDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[a-z0-9_]{1,40}$/;
const COMMON_KEYS = Object.freeze(["cards", "k", "u", "v"]);
/** The fields each kind adds to the common ones, with their pattern. */
const KIND_FIELDS = Object.freeze({
  [GrantKind.STARTER]: Object.freeze({ deck: NAME }),
  [GrantKind.DAILY]: Object.freeze({ day: DAY, seed: HEX64, t: HEX64, track: NAME }),
});

/**
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number }>} GrantedCard
 * @typedef {Readonly<{ kind: "starter", account: string, cards: readonly GrantedCard[], deck: string }>} StarterGrant
 * @typedef {Readonly<{ kind: "daily", account: string, cards: readonly GrantedCard[], day: string, track: string, tableHash: string, seed: string }>} DailyGrant
 */

/**
 * The canonical JSON of a grant.
 * @param {StarterGrant | DailyGrant} grant
 * @returns {string}
 */
export function grantRecord(grant) {
  const common = { cards: grant.cards.map((card) => [card.id, card.definitionId, card.serial]), k: grant.kind, u: grant.account, v: GRANT_VERSION };
  const fields = grant.kind === GrantKind.STARTER ? { deck: grant.deck } : { day: grant.day, seed: grant.seed, t: grant.tableHash, track: grant.track };
  const json = canonicalize({ ...common, ...fields });
  if (parseGrantRecord(json) === null || utf8Length(json) > LIMITS.MAX_OPERATION_BYTES) {
    throw new ProtocolError(`grant: a ${grant.kind} record names an account, its fields and 1..${MAX_GRANT_CARDS} copies`);
  }
  return json;
}

/**
 * A grant record read from the chain, checked for shape (and canonical form); null when malformed.
 * @param {string} json
 * @returns {Readonly<Record<string, any>> | null}
 */
export function parseGrantRecord(json) {
  let value;
  try {
    value = parseCanonical(json, { maxBytes: LIMITS.MAX_OPERATION_BYTES });
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return null;
    }
    throw error;
  }
  const issues = new Issues();
  const kind = isRecord(value) ? checkEnum(issues, /** @type {Record<string, unknown>} */ (value).k, "grant.k", Object.values(GrantKind)) : undefined;
  const fields = kind === undefined ? {} : KIND_FIELDS[kind];
  const record = checkObject(issues, value, "grant", [...COMMON_KEYS, ...Object.keys(fields)]);
  if (record !== undefined && kind !== undefined) {
    checkInteger(issues, record.v, "grant.v", { min: GRANT_VERSION, max: GRANT_VERSION });
    checkString(issues, record.u, "grant.u", { pattern: ACCOUNT_PATTERN });
    for (const [key, pattern] of Object.entries(fields)) {
      checkString(issues, record[key], `grant.${key}`, { pattern });
    }
    checkCards(issues, record.cards);
  }
  return issues.isEmpty ? Object.freeze(/** @type {Record<string, any>} */ (record)) : null;
}

/**
 * @param {Issues} issues
 * @param {unknown} cards
 */
function checkCards(issues, cards) {
  checkArrayOf(issues, cards, "grant.cards", {
    minLength: 1,
    maxLength: MAX_GRANT_CARDS,
    item: (card, path) => {
      const entry = checkArrayOf(issues, card, path, { minLength: 3, maxLength: 3, item: (field) => field });
      if (entry === undefined) {
        return undefined;
      }
      checkString(issues, entry[0], `${path}[0]`, { pattern: UUID });
      checkString(issues, entry[1], `${path}[1]`, { pattern: CARD_ID_PATTERN });
      checkInteger(issues, entry[2], `${path}[2]`, { min: 1 });
      return entry;
    },
  });
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
