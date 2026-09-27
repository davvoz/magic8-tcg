/**
 * Game results (`custom_json` m8tcg_result, docs/tcg/03 §9): one small
 * record per finished game, published once it ends. Games themselves stay
 * in the server's database; the result commits publicly to their history.
 *
 *   {"a":[account of s0, account of s1],"g":gameId,"h":head,"m":mode,
 *    "n":seq,"r":reason,"v":1,"w":"s0"|"s1"|null}
 *
 * `h` is the hash-chain head after the last event (`n`): it commits to every
 * event of the game (03 §6.2), so the server can no longer change a move, a
 * checkpoint or the outcome without the history ceasing to hash to `h`.
 * A player's signed ack (11) names the head at one of those events: the
 * history the server shows must hash through it to `h`.
 */
import { Issues, checkArrayOf, checkEnum, checkInteger, checkObject, checkString, checkUnique } from "@magic8/engine/shared/validation.js";
import { CanonicalJsonError, canonicalize, parseCanonical } from "../canonical/CanonicalJson.js";
import { isHash } from "../crypto/hash.js";
import { ACCOUNT_PATTERN, GAME_ID_PATTERN, GameMode, LIMITS, REASON_PATTERN, SEATS } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";

export const RESULT_VERSION = 1;

/**
 * The canonical JSON of a finished game's result.
 * @param {{ gameId: string, mode: string, accounts: readonly string[], seq: number, head: string, winner: string | null, reason: string }} result `accounts` in seat order
 * @returns {string}
 */
export function gameResultRecord({ gameId, mode, accounts, seq, head, winner, reason }) {
  const json = canonicalize({ a: [...accounts], g: gameId, h: head, m: mode, n: seq, r: reason, v: RESULT_VERSION, w: winner });
  if (parseGameResultRecord(json) === null) {
    throw new ProtocolError("result: a record names the game, its mode, two different accounts, the last event and its head, the winner seat (or none) and the reason");
  }
  return json;
}

/**
 * A result record read from the chain, checked for shape (and canonical form); null when malformed.
 * @param {string} json
 * @returns {Readonly<Record<string, any>> | null}
 */
export function parseGameResultRecord(json) {
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
  const record = checkObject(issues, value, "result", ["a", "g", "h", "m", "n", "r", "v", "w"]);
  if (record !== undefined) {
    checkInteger(issues, record.v, "result.v", { min: RESULT_VERSION, max: RESULT_VERSION });
    checkString(issues, record.g, "result.g", { pattern: GAME_ID_PATTERN });
    const accounts = checkArrayOf(issues, record.a, "result.a", { minLength: SEATS.length, maxLength: SEATS.length, item: (item, path) => checkString(issues, item, path, { pattern: ACCOUNT_PATTERN }) });
    if (accounts !== undefined) {
      checkUnique(issues, accounts, "result.a", (account) => account);
    }
    checkEnum(issues, record.m, "result.m", Object.values(GameMode));
    checkInteger(issues, record.n, "result.n", { min: 0 });
    if (!isHash(record.h)) {
      issues.add("result.h", "expected a hash");
    }
    checkString(issues, record.r, "result.r", { pattern: REASON_PATTERN });
    if (record.w !== null) {
      checkEnum(issues, record.w, "result.w", SEATS);
    }
  }
  return issues.isEmpty ? Object.freeze(/** @type {Record<string, any>} */ (record)) : null;
}
