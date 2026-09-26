/**
 * content_versions and card_definitions. A content version is immutable
 * (trigger); publishing the same bundle again is a no-op apart from making
 * it current. card_definitions keeps one row per card id, pointing at the
 * first version that introduced it, with the latest definition as data.
 */

/** @typedef {import("../application/ports.js").ContentRepository} ContentRepository */

/** @implements {ContentRepository} */
export class PgContentRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async publish({ hash, payload, engineVersion, cards }) {
    await this.#db.transaction(async () => {
      await this.#db.query("INSERT INTO content_versions (hash, engine_version, payload) VALUES ($1, $2, $3) ON CONFLICT (hash) DO NOTHING", [hash, engineVersion, payload]);
      await this.#db.query("UPDATE content_versions SET is_current = false WHERE is_current AND hash <> $1", [hash]);
      await this.#db.query("UPDATE content_versions SET is_current = true WHERE hash = $1 AND NOT is_current", [hash]);
      for (const card of cards) {
        await this.#db.query(
          `INSERT INTO card_definitions (id, first_content_hash, data) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data WHERE card_definitions.data IS DISTINCT FROM EXCLUDED.data`,
          [card.id, hash, JSON.stringify(card)],
        );
      }
    });
  }

  async payload(hash) {
    const row = await this.#db.maybeOne("SELECT payload FROM content_versions WHERE hash = $1", [hash]);
    return row === null ? null : row.payload;
  }

  async engineVersion(hash) {
    const row = await this.#db.maybeOne("SELECT engine_version FROM content_versions WHERE hash = $1", [hash]);
    return row === null ? null : row.engine_version;
  }
}
