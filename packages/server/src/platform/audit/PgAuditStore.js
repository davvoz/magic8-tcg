/**
 * audit_logs as an AuditStore. `appendNext` takes a transaction-scoped
 * advisory lock, reads the last entry and inserts the next one: appends from
 * any number of server processes form a single chain. The lock is held until
 * the surrounding transaction ends, so audited operations commit one at a
 * time — acceptable for the rate of audited actions (sign-ins, grants,
 * purchases); `seq` as primary key would catch a fork regardless.
 */
import { fromTimestamp, toTimestamp } from "../db/Database.js";

/** Arbitrary constant naming the audit chain lock. */
const AUDIT_LOCK = 7_310_429;

/** @param {import("../db/Database.js").Row} row @returns {import("../../kernel/audit/AuditTrail.js").AuditEntry} */
function toEntry(row) {
  return Object.freeze({
    seq: row.seq,
    at: fromTimestamp(row.at),
    actorKind: row.actor_kind,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetKind: row.target_kind,
    targetId: row.target_id,
    ip: row.ip,
    details: row.details,
    prevHash: row.prev_hash,
    hash: row.hash,
  });
}

/** @implements {import("../../kernel/audit/AuditTrail.js").AuditStore} */
export class PgAuditStore {
  #db;

  /** @param {import("../db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /** @param {(previous: import("../../kernel/audit/AuditTrail.js").AuditEntry | null) => import("../../kernel/audit/AuditTrail.js").AuditEntry} build */
  appendNext(build) {
    return this.#db.transaction(async () => {
      await this.#db.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_LOCK]);
      const last = await this.#db.maybeOne("SELECT * FROM audit_logs ORDER BY seq DESC LIMIT 1");
      const entry = build(last === null ? null : toEntry(last));
      await this.#db.query(
        `INSERT INTO audit_logs (seq, at, actor_kind, actor_user_id, action, target_kind, target_id, ip, details, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [entry.seq, toTimestamp(entry.at), entry.actorKind, entry.actorUserId, entry.action, entry.targetKind, entry.targetId, entry.ip, JSON.stringify(entry.details), entry.prevHash, entry.hash],
      );
      return entry;
    });
  }

  async list(fromSeq, limit) {
    const rows = await this.#db.rows("SELECT * FROM audit_logs WHERE seq >= $1 ORDER BY seq LIMIT $2", [fromSeq, limit]);
    return Object.freeze(rows.map(toEntry));
  }
}
