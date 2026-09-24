/**
 * Tamper-evident audit trail: each entry carries the hash of the previous
 * one, so deleting or editing a past entry breaks every hash after it
 * (docs/tcg/04-modello-dati.md, audit_logs). Storage is a port; the chaining
 * rule lives here, once. The store runs `build` atomically with respect to
 * other appends (all server processes included), so the chain never forks.
 *
 * Recorded inside a Database transaction, an entry commits or rolls back
 * with the operation it describes.
 *
 * @typedef {Readonly<{ actorKind: "user" | "admin" | "system", actorUserId: string | null, action: string, targetKind: string | null, targetId: string | null, ip: string | null, details: Readonly<Record<string, unknown>> }>} AuditInput
 * @typedef {AuditInput & Readonly<{ seq: number, at: number, prevHash: string, hash: string }>} AuditEntry
 * @typedef {{
 *   appendNext: (build: (previous: AuditEntry | null) => AuditEntry) => Promise<AuditEntry>,
 *   list: (fromSeq: number, limit: number) => Promise<readonly AuditEntry[]>,
 * }} AuditStore
 */
import { canonicalize, sha256Hex, utf8 } from "@magic8/protocol";
import { redact } from "../logger.js";

export const AUDIT_GENESIS = "0".repeat(64);
const ACTION_PATTERN = /^[a-z]+(\.[a-z_]+)+$/;

/**
 * @param {Omit<AuditEntry, "hash">} entry
 */
function hashOf(entry) {
  return sha256Hex(utf8(canonicalize({ ...entry })));
}

export class AuditTrail {
  #store;
  #clock;

  /** @param {{ store: AuditStore, clock: import("../time.js").Clock }} deps */
  constructor({ store, clock }) {
    this.#store = store;
    this.#clock = clock;
  }

  /**
   * @param {Omit<AuditInput, "details" | "ip" | "targetKind" | "targetId" | "actorUserId"> & Partial<AuditInput>} input
   * @returns {Promise<AuditEntry>}
   */
  record(input) {
    if (!ACTION_PATTERN.test(input.action)) {
      throw new TypeError(`AuditTrail: invalid action "${input.action}"`);
    }
    const fields = {
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
      ip: input.ip ?? null,
      details: /** @type {Record<string, unknown>} */ (structuredClone(redact(input.details ?? {}))),
    };
    return this.#store.appendNext((previous) => {
      const body = {
        seq: previous === null ? 1 : previous.seq + 1,
        at: this.#clock.now(),
        ...fields,
        prevHash: previous === null ? AUDIT_GENESIS : previous.hash,
      };
      return Object.freeze({ ...body, hash: hashOf(body) });
    });
  }

  /**
   * Recomputes the chain; returns the seq of the first broken entry, or null.
   * @param {number} [batch]
   */
  async verify(batch = 500) {
    let previousHash = AUDIT_GENESIS;
    let seq = 1;
    for (;;) {
      const entries = await this.#store.list(seq, batch);
      for (const entry of entries) {
        const { hash, ...body } = entry;
        if (entry.seq !== seq || entry.prevHash !== previousHash || hashOf(body) !== hash) {
          return seq;
        }
        previousHash = hash;
        seq += 1;
      }
      if (entries.length < batch) {
        return null;
      }
    }
  }
}
