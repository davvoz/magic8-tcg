/**
 * An owned copy of a card (docs/tcg/01-architettura.md §7.1). The definition
 * says what the card does; the instance says whose it is, which printing it
 * is (edition, serial) and where it came from. Instances are only
 * ever created by InventoryService.mint.
 *
 * @typedef {Readonly<{
 *   id: string,
 *   definitionId: string,
 *   edition: string,
 *   serial: number,
 *   ownerId: string,
 *   status: "active" | "locked" | "burned",
 *   originKind: "purchase" | "pack" | "grant" | "reward",
 *   originRef: string,
 *   mintedAt: number,
 * }>} CardInstance
 *
 * @typedef {Readonly<{ kind: string, fromUserId: string | null, toUserId: string | null, ref: string, at: number }>} InstanceEvent
 * @typedef {Readonly<{ definitionId: string, count: number }>} MintItem
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export const InstanceStatus = Object.freeze({ ACTIVE: "active", LOCKED: "locked", BURNED: "burned" });
export const OriginKind = Object.freeze({ PURCHASE: "purchase", PACK: "pack", GRANT: "grant", REWARD: "reward" });
export const InstanceEventKind = Object.freeze({ MINTED: "MINTED", TRANSFERRED: "TRANSFERRED", LOCKED: "LOCKED", UNLOCKED: "UNLOCKED", BURNED: "BURNED" });

/** Editions are data (e.g. "core-1"); this bounds their shape. */
export const PRINTING_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** One mint (a starter deck, a pack, a bundle) never creates more copies than this. */
export const MAX_COPIES_PER_MINT = 500;
const ORIGIN_REF_MAX_LENGTH = 128;

/**
 * Checks a mint request before anything is written.
 * @param {{ items: readonly MintItem[], edition: string, origin: { kind: string, ref: string } }} request
 * @param {(definitionId: string) => boolean} isKnownCard
 * @returns {import("@magic8/engine/shared/Result.js").Ok<readonly MintItem[]> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function checkMintRequest({ items, edition, origin }, isKnownCard) {
  if (!PRINTING_PATTERN.test(edition)) {
    return fail("INVALID_PRINTING", "the edition must be a short lowercase identifier");
  }
  if (!isValidOrigin(origin)) {
    return fail("INVALID_ORIGIN", "every copy needs a known origin kind and a reference");
  }
  return checkItems(items, isKnownCard);
}

/** @param {{ kind: string, ref: string }} origin */
function isValidOrigin(origin) {
  const knownKind = Object.values(OriginKind).includes(/** @type {any} */ (origin.kind));
  return knownKind && typeof origin.ref === "string" && origin.ref.length > 0 && origin.ref.length <= ORIGIN_REF_MAX_LENGTH;
}

/**
 * @param {readonly MintItem[]} items
 * @param {(definitionId: string) => boolean} isKnownCard
 * @returns {import("@magic8/engine/shared/Result.js").Ok<readonly MintItem[]> | import("@magic8/engine/shared/Result.js").Fail}
 */
function checkItems(items, isKnownCard) {
  const seen = new Set();
  let total = 0;
  for (const { definitionId, count } of items) {
    if (!Number.isSafeInteger(count) || count < 1) {
      return fail("INVALID_COUNT", `invalid count for ${definitionId}`);
    }
    if (seen.has(definitionId) || !isKnownCard(definitionId)) {
      return fail("INVALID_CARD", `unknown or repeated card ${definitionId}`);
    }
    seen.add(definitionId);
    total += count;
  }
  if (total === 0 || total > MAX_COPIES_PER_MINT) {
    return fail("INVALID_COUNT", `a mint creates between 1 and ${MAX_COPIES_PER_MINT} copies`);
  }
  return ok(Object.freeze([...items].sort((a, b) => (a.definitionId < b.definitionId ? -1 : 1))));
}
