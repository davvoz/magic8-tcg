/**
 * card_instances, card_serial_counters, card_instance_events and grants.
 *
 * Serials: the counter row for a printing is created or incremented by one
 * upsert, which holds the row lock until the transaction ends, so two mints
 * of the same card can never receive the same numbers; UNIQUE (definition,
 * edition, serial) backs that up. Copies and their history are inserted in
 * bulk with unnest (one statement per table, whatever the count).
 */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";
import { InstanceEventKind } from "../domain/CardInstance.js";

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/CardInstance.js").CardInstance} */
function toInstance(row) {
  return Object.freeze({
    id: row.id,
    definitionId: row.definition_id,
    edition: row.edition,
    serial: row.serial,
    finish: row.finish,
    ownerId: row.owner_id,
    status: row.status,
    originKind: row.origin_kind,
    originRef: row.origin_ref,
    mintedAt: fromTimestamp(row.minted_at),
  });
}

/** @implements {import("../application/ports.js").InventoryRepository} */
export class PgInventoryRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async reserveSerials(definitionId, edition, count) {
    const row = await this.#db.maybeOne(
      `INSERT INTO card_serial_counters (definition_id, edition, next_serial) VALUES ($1, $2, 1 + $3::integer)
       ON CONFLICT (definition_id, edition) DO UPDATE SET next_serial = card_serial_counters.next_serial + $3::integer
       RETURNING next_serial - $3::integer AS first`,
      [definitionId, edition, count],
    );
    return /** @type {import("../../../platform/db/Database.js").Row} */ (row).first;
  }

  async insertMinted(instances) {
    if (instances.length === 0) {
      return;
    }
    const column = (/** @type {(instance: import("../domain/CardInstance.js").CardInstance) => unknown} */ pick) => instances.map(pick);
    await this.#db.query(
      `INSERT INTO card_instances (id, definition_id, edition, serial, finish, owner_id, status, origin_kind, origin_ref, minted_at)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::integer[], $5::text[], $6::uuid[], $7::text[], $8::text[], $9::text[], $10::timestamptz[])`,
      [
        column((instance) => instance.id),
        column((instance) => instance.definitionId),
        column((instance) => instance.edition),
        column((instance) => instance.serial),
        column((instance) => instance.finish),
        column((instance) => instance.ownerId),
        column((instance) => instance.status),
        column((instance) => instance.originKind),
        column((instance) => instance.originRef),
        column((instance) => toTimestamp(instance.mintedAt)),
      ],
    );
    await this.#db.query(
      `INSERT INTO card_instance_events (card_instance_id, kind, from_user_id, to_user_id, ref, at)
       SELECT id, $2, NULL, owner, ref, at FROM unnest($1::uuid[], $3::uuid[], $4::text[], $5::timestamptz[]) AS minted (id, owner, ref, at)`,
      [column((instance) => instance.id), InstanceEventKind.MINTED, column((instance) => instance.ownerId), column((instance) => instance.originRef), column((instance) => toTimestamp(instance.mintedAt))],
    );
  }

  async insertGrant({ key, userId, kind, at }) {
    const row = await this.#db.maybeOne("INSERT INTO grants (key, user_id, kind, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING RETURNING key", [key, userId, kind, toTimestamp(at)]);
    return row !== null;
  }

  async hasGrant(key) {
    return (await this.#db.maybeOne("SELECT 1 AS present FROM grants WHERE key = $1", [key])) !== null;
  }

  async listOwned(userId) {
    const rows = await this.#db.rows("SELECT * FROM card_instances WHERE owner_id = $1 AND status <> 'burned' ORDER BY definition_id, edition, serial", [userId]);
    return Object.freeze(rows.map(toInstance));
  }

  async activeCounts(userId) {
    const rows = await this.#db.rows("SELECT definition_id, sum(copies)::integer AS copies FROM collections WHERE owner_id = $1 GROUP BY definition_id", [userId]);
    return new Map(rows.map((row) => [row.definition_id, row.copies]));
  }

  async findOwned(userId, instanceId) {
    const row = await this.#db.maybeOne("SELECT * FROM card_instances WHERE id = $1 AND owner_id = $2", [instanceId, userId]);
    return row === null ? null : toInstance(row);
  }

  async listByOrigins(ownerId, origins) {
    const rows = await this.#db.rows(
      `SELECT c.* FROM card_instances c
         JOIN unnest($2::text[], $3::text[]) AS o(kind, ref) ON c.origin_kind = o.kind AND c.origin_ref = o.ref
        WHERE c.owner_id = $1
        ORDER BY c.origin_ref, c.definition_id, c.serial`,
      [ownerId, origins.map((origin) => origin.kind), origins.map((origin) => origin.ref)],
    );
    return Object.freeze(rows.map(toInstance));
  }

  async history(instanceId) {
    const rows = await this.#db.rows("SELECT kind, from_user_id, to_user_id, ref, at FROM card_instance_events WHERE card_instance_id = $1 ORDER BY id", [instanceId]);
    return Object.freeze(rows.map((row) => Object.freeze({ kind: row.kind, fromUserId: row.from_user_id, toUserId: row.to_user_id, ref: row.ref, at: fromTimestamp(row.at) })));
  }
}
