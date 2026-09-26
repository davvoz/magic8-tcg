/**
 * A card-for-card trade between two players (docs/tcg/13-scambi.md).
 *
 *   OPEN ──accept (counterparty)──▶ ACCEPTED
 *   OPEN ──decline (counterparty)─▶ DECLINED
 *   OPEN ──cancel (proposer)──────▶ CANCELLED
 *   OPEN ──time runs out──────────▶ EXPIRED
 *
 * The proposer's copies are in escrow while the trade is OPEN; the other
 * outcomes give them back. Only OPEN changes, and only once.
 */
import { Issues, checkArrayOf, checkInteger, checkObject, checkString, checkUnique } from "@magic8/engine/shared/validation.js";
import { MAX_TRADE_CARDS } from "@magic8/protocol";

export const TradeStatus = Object.freeze({ OPEN: "OPEN", ACCEPTED: "ACCEPTED", DECLINED: "DECLINED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARD_ID = /^[a-z0-9_]{1,64}$/;

/**
 * @typedef {Readonly<{ definitionId: string, count: number }>} Want
 * @typedef {Readonly<{
 *   id: string, proposerId: string, counterpartyId: string, status: string, wants: readonly Want[],
 *   idempotencyKey: string, requestHash: string, createdAt: number, expiresAt: number, closedAt: number | null,
 * }>} Trade
 */

/**
 * Checks what a proposer offers and asks for.
 * @param {{ give: unknown, want: unknown }} proposal
 * @param {(definitionId: string) => boolean} isKnownCard
 * @returns {{ ok: true, give: readonly string[], wants: readonly Want[] } | { ok: false, message: string }}
 */
export function checkProposal({ give, want }, isKnownCard) {
  const issues = new Issues();
  const offered = checkArrayOf(issues, give, "give", { minLength: 1, maxLength: MAX_TRADE_CARDS, item: (id, path) => checkString(issues, id, path, { pattern: UUID }) });
  if (offered !== undefined) {
    checkUnique(issues, offered, "give", (id) => id);
  }
  const wants = checkArrayOf(issues, want, "want", {
    minLength: 0,
    maxLength: MAX_TRADE_CARDS,
    item: (entry, path) => {
      const object = checkObject(issues, entry, path, ["count", "definitionId"]);
      if (object === undefined) {
        return undefined;
      }
      const definitionId = checkString(issues, object.definitionId, `${path}.definitionId`, { pattern: CARD_ID });
      const count = checkInteger(issues, object.count, `${path}.count`, { min: 1, max: MAX_TRADE_CARDS });
      if (definitionId !== undefined && !isKnownCard(definitionId)) {
        issues.add(`${path}.definitionId`, "no such card");
      }
      return definitionId === undefined || count === undefined ? undefined : { definitionId, count };
    },
  });
  if (wants !== undefined) {
    checkUnique(issues, wants, "want", (entry) => entry.definitionId);
    if (wants.reduce((sum, entry) => sum + entry.count, 0) > MAX_TRADE_CARDS) {
      issues.add("want", `at most ${MAX_TRADE_CARDS} copies`);
    }
  }
  if (!issues.isEmpty || offered === undefined || wants === undefined) {
    return { ok: false, message: issues.list()[0] ?? "invalid proposal" };
  }
  return { ok: true, give: Object.freeze([...offered]), wants: Object.freeze(wants.map((entry) => Object.freeze({ definitionId: entry.definitionId, count: entry.count }))) };
}

/**
 * Whether the copies a counterparty gives are exactly what the trade asks for.
 * @param {readonly Want[]} wants
 * @param {readonly { definitionId: string }[]} copies
 */
export function matchesWants(wants, copies) {
  const counts = new Map();
  for (const copy of copies) {
    counts.set(copy.definitionId, (counts.get(copy.definitionId) ?? 0) + 1);
  }
  return counts.size === wants.length && wants.every((want) => counts.get(want.definitionId) === want.count);
}
