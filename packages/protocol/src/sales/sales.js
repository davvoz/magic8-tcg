/**
 * Sale records (`custom_json` m8tcg_sale, docs/tcg/14-vendite.md): the
 * public trace of a copy sold by one player to another for a payment made
 * directly between them on chain. With receipts and trade records, it lets
 * anyone follow the owner of every copy from its mint.
 *
 *   {"b":buyer,"c":[id, definitionId, serial],"p":"1.500 STEEM",
 *    "s":seller,"t":listingId,"v":1,"x":paymentTxId}
 *
 * `x` names the transfer from `b` to `s` that paid `p`: a verifier can find
 * it on chain and check that it says exactly that.
 */
import { Issues, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { CanonicalJsonError, canonicalize, parseCanonical, utf8Length } from "../canonical/CanonicalJson.js";
import { ACCOUNT_PATTERN, CARD_ID_PATTERN, LIMITS } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";

export const SALE_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TX_ID = /^[0-9a-f]{40}$/;
/** An amount as the chain writes it: "1.500 STEEM". */
const PRICE = /^(0|[1-9]\d{0,14})\.\d{1,8} [A-Z]{3,10}$/;

/**
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number }>} SoldCard
 */

/**
 * The canonical JSON of a completed sale.
 * @param {{ listingId: string, seller: string, buyer: string, card: SoldCard, price: string, txId: string }} sale `price` as the chain writes it ("1.500 STEEM")
 * @returns {string}
 */
export function saleRecord({ listingId, seller, buyer, card, price, txId }) {
  const json = canonicalize({ b: buyer, c: [card.id, card.definitionId, card.serial], p: price, s: seller, t: listingId, v: SALE_VERSION, x: txId });
  if (parseSaleRecord(json) === null || utf8Length(json) > LIMITS.MAX_OPERATION_BYTES) {
    throw new ProtocolError("sale: a record names a listing id, two different accounts, one copy, a price and the payment's transaction id");
  }
  return json;
}

/**
 * A sale record read from the chain, checked for shape (and canonical form); null when malformed.
 * @param {string} json
 * @returns {Readonly<Record<string, any>> | null}
 */
export function parseSaleRecord(json) {
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
  const record = checkObject(issues, value, "sale", ["b", "c", "p", "s", "t", "v", "x"]);
  if (record !== undefined) {
    checkInteger(issues, record.v, "sale.v", { min: SALE_VERSION, max: SALE_VERSION });
    checkString(issues, record.t, "sale.t", { pattern: UUID });
    checkString(issues, record.x, "sale.x", { pattern: TX_ID });
    checkString(issues, record.p, "sale.p", { pattern: PRICE });
    const buyer = checkString(issues, record.b, "sale.b", { pattern: ACCOUNT_PATTERN });
    const seller = checkString(issues, record.s, "sale.s", { pattern: ACCOUNT_PATTERN });
    const card = checkArrayOf(issues, record.c, "sale.c", { minLength: 3, maxLength: 3, item: (field) => field });
    if (card !== undefined) {
      checkString(issues, card[0], "sale.c[0]", { pattern: UUID });
      checkString(issues, card[1], "sale.c[1]", { pattern: CARD_ID_PATTERN });
      checkInteger(issues, card[2], "sale.c[2]", { min: 1 });
    }
    if (issues.isEmpty && buyer === seller) {
      issues.add("sale", "a player cannot buy from themselves");
    }
  }
  return issues.isEmpty ? Object.freeze(/** @type {Record<string, any>} */ (record)) : null;
}
