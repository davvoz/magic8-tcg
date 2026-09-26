/**
 * Trade records (`custom_json` m8tcg_trade, docs/tcg/13-scambi.md): the
 * public trace of a card-for-card trade between two players, so that the
 * owner of every copy can be followed from its mint (receipt) through every
 * trade. Published by the broadcaster pool when both sides have swapped.
 *
 *   {"a":{"cards":[[id, definitionId, serial, finish]…],"u":account},
 *    "b":{"cards":[…],"u":account},"t":tradeId,"v":1}
 *
 * `a` proposed the trade and gave its cards to `b`; `b` gave its cards to `a`.
 */
import { Issues, checkArrayOf, checkObject, checkString, checkInteger, checkEnum } from "@magic8/engine/shared/validation.js";
import { CanonicalJsonError, canonicalize, parseCanonical, utf8Length } from "../canonical/CanonicalJson.js";
import { ACCOUNT_PATTERN, CARD_ID_PATTERN, LIMITS } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";
import { FINISH_CODES } from "../receipts/receipts.js";

export const TRADE_VERSION = 1;
/** Copies one side may give in one trade. */
export const MAX_TRADE_CARDS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number, finish: string }>} TradedCard
 * @typedef {Readonly<{ account: string, cards: readonly TradedCard[] }>} TradeSide
 */

/**
 * @param {TradeSide} side
 */
function sideOf(side) {
  return {
    cards: side.cards.map((card) => {
      const finish = FINISH_CODES[/** @type {keyof typeof FINISH_CODES} */ (card.finish)];
      if (finish === undefined) {
        throw new ProtocolError(`trade: unknown finish "${card.finish}"`);
      }
      return [card.id, card.definitionId, card.serial, finish];
    }),
    u: side.account,
  };
}

/**
 * The canonical JSON of a completed trade.
 * @param {{ tradeId: string, proposer: TradeSide, counterparty: TradeSide }} trade
 * @returns {string}
 */
export function tradeRecord({ tradeId, proposer, counterparty }) {
  const json = canonicalize({ a: sideOf(proposer), b: sideOf(counterparty), t: tradeId, v: TRADE_VERSION });
  if (parseTradeRecord(json) === null || utf8Length(json) > LIMITS.MAX_OPERATION_BYTES) {
    throw new ProtocolError("trade: a record names a trade id, two accounts and 0..10 copies a side");
  }
  return json;
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {string | undefined} the side's account
 */
function checkSide(issues, value, path) {
  const side = checkObject(issues, value, path, ["cards", "u"]);
  if (side === undefined) {
    return undefined;
  }
  const account = checkString(issues, side.u, `${path}.u`, { pattern: ACCOUNT_PATTERN });
  checkArrayOf(issues, side.cards, `${path}.cards`, {
    minLength: 0,
    maxLength: MAX_TRADE_CARDS,
    item: (card, cardPath) => {
      const entry = checkArrayOf(issues, card, cardPath, { minLength: 4, maxLength: 4, item: (field) => field });
      if (entry === undefined) {
        return undefined;
      }
      checkString(issues, entry[0], `${cardPath}[0]`, { pattern: UUID });
      checkString(issues, entry[1], `${cardPath}[1]`, { pattern: CARD_ID_PATTERN });
      checkInteger(issues, entry[2], `${cardPath}[2]`, { min: 1 });
      checkEnum(issues, entry[3], `${cardPath}[3]`, Object.values(FINISH_CODES));
      return entry;
    },
  });
  return account;
}

/**
 * A trade record read from the chain, checked for shape (and canonical form); null when malformed.
 * @param {string} json
 * @returns {Readonly<Record<string, any>> | null}
 */
export function parseTradeRecord(json) {
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
  const record = checkObject(issues, value, "trade", ["a", "b", "t", "v"]);
  if (record !== undefined) {
    checkInteger(issues, record.v, "trade.v", { min: TRADE_VERSION, max: TRADE_VERSION });
    checkString(issues, record.t, "trade.t", { pattern: UUID });
    const a = checkSide(issues, record.a, "trade.a");
    const b = checkSide(issues, record.b, "trade.b");
    if (issues.isEmpty && a === b) {
      issues.add("trade", "a player cannot trade with themselves");
    }
  }
  return issues.isEmpty ? Object.freeze(/** @type {Record<string, any>} */ (record)) : null;
}
