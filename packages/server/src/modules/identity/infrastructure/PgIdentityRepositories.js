/**
 * PostgreSQL implementations of the identity ports. Atomicity comes from
 * single statements: `consume` is one conditional UPDATE, so two requests
 * racing with the same challenge cannot both win; `findOrCreate` relies on
 * UNIQUE (network, account).
 */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../application/ports.js").User} */
function toUser(row) {
  return Object.freeze({
    id: row.id,
    network: row.network,
    account: row.account,
    status: row.status,
    roles: Object.freeze([...row.roles]),
    createdAt: fromTimestamp(row.created_at),
    lastLoginAt: fromNullableTimestamp(row.last_login_at),
  });
}

/** @implements {import("../application/ports.js").UserRepository} */
export class PgUserRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async findOrCreate({ network, account }, now, newId) {
    const inserted = await this.#db.maybeOne(
      `INSERT INTO users (id, network, account, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (network, account) DO NOTHING
       RETURNING *`,
      [newId, network, account, toTimestamp(now)],
    );
    if (inserted !== null) {
      return toUser(inserted);
    }
    const existing = await this.#db.maybeOne("SELECT * FROM users WHERE network = $1 AND account = $2", [network, account]);
    if (existing === null) {
      throw new Error("user vanished between insert and select");
    }
    return toUser(existing);
  }

  /**
   * @param {string} network
   * @param {string} account
   */
  async findByAccount(network, account) {
    const row = await this.#db.maybeOne("SELECT * FROM users WHERE network = $1 AND account = $2", [network, account]);
    return row === null ? null : toUser(row);
  }

  async findById(id) {
    const row = await this.#db.maybeOne("SELECT * FROM users WHERE id = $1", [id]);
    return row === null ? null : toUser(row);
  }

  async recordLogin(id, now) {
    await this.#db.query("UPDATE users SET last_login_at = $2 WHERE id = $1", [id, toTimestamp(now)]);
  }

  /**
   * Administrative: suspend or reactivate an account.
   * @param {string} id
   * @param {"active" | "suspended"} status
   */
  async setStatus(id, status) {
    await this.#db.query("UPDATE users SET status = $2 WHERE id = $1", [id, status]);
  }
}

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/LoginChallenge.js").LoginChallenge} */
function toChallenge(row) {
  return Object.freeze({
    id: row.id,
    network: row.network,
    account: row.account,
    origin: row.origin,
    message: row.message,
    createdAt: fromTimestamp(row.created_at),
    expiresAt: fromTimestamp(row.expires_at),
    consumedAt: fromNullableTimestamp(row.consumed_at),
  });
}

/** @implements {import("../application/ports.js").ChallengeRepository} */
export class PgChallengeRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async save(challenge) {
    await this.#db.query(
      `INSERT INTO auth_challenges (id, network, account, message, origin, created_at, expires_at, consumed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        challenge.id,
        challenge.network,
        challenge.account,
        challenge.message,
        challenge.origin,
        toTimestamp(challenge.createdAt),
        toTimestamp(challenge.expiresAt),
        challenge.consumedAt === null ? null : toTimestamp(challenge.consumedAt),
      ],
    );
  }

  async consume(id, now) {
    const row = await this.#db.maybeOne(
      `UPDATE auth_challenges SET consumed_at = $2
        WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2
       RETURNING *`,
      [id, toTimestamp(now)],
    );
    return row === null ? null : toChallenge(row);
  }

  async purgeExpired(now) {
    const result = await this.#db.query("DELETE FROM auth_challenges WHERE consumed_at IS NOT NULL OR expires_at <= $1", [toTimestamp(now)]);
    return result.rowCount;
  }
}

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/Session.js").Session} */
function toSession(row) {
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    loginPublicKey: row.login_public_key,
    createdAt: fromTimestamp(row.created_at),
    lastSeenAt: fromTimestamp(row.last_seen_at),
    expiresAt: fromTimestamp(row.expires_at),
    revokedAt: fromNullableTimestamp(row.revoked_at),
    revokeReason: row.revoke_reason,
  });
}

/** @implements {import("../application/ports.js").SessionRepository} */
export class PgSessionRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async save(session) {
    await this.#db.query(
      `INSERT INTO sessions (id, user_id, token_hash, login_public_key, created_at, last_seen_at, expires_at, revoked_at, revoke_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.loginPublicKey,
        toTimestamp(session.createdAt),
        toTimestamp(session.lastSeenAt),
        toTimestamp(session.expiresAt),
        session.revokedAt === null ? null : toTimestamp(session.revokedAt),
        session.revokeReason,
      ],
    );
  }

  async findByTokenHash(tokenHash) {
    const row = await this.#db.maybeOne("SELECT * FROM sessions WHERE token_hash = $1", [tokenHash]);
    return row === null ? null : toSession(row);
  }

  async touch(id, now) {
    await this.#db.query("UPDATE sessions SET last_seen_at = GREATEST(last_seen_at, $2) WHERE id = $1 AND revoked_at IS NULL", [id, toTimestamp(now)]);
  }

  async revoke(id, reason, now) {
    const result = await this.#db.query("UPDATE sessions SET revoked_at = $3, revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL", [id, reason, toTimestamp(now)]);
    return result.rowCount > 0;
  }

  async revokeByLoginKey(userId, publicKey, reason, now) {
    const result = await this.#db.query(
      "UPDATE sessions SET revoked_at = $4, revoke_reason = $3 WHERE user_id = $1 AND login_public_key = $2 AND revoked_at IS NULL",
      [userId, publicKey, reason, toTimestamp(now)],
    );
    return result.rowCount;
  }

  async listActiveLoginKeys(now, limit, after = null) {
    const rows = await this.#db.rows(
      `SELECT DISTINCT user_id, login_public_key FROM sessions
        WHERE revoked_at IS NULL AND expires_at > $1
          AND ($3::uuid IS NULL OR (user_id, login_public_key) > ($3::uuid, $4::text))
        ORDER BY user_id, login_public_key
        LIMIT $2`,
      [toTimestamp(now), limit, after?.userId ?? null, after?.loginPublicKey ?? null],
    );
    return Object.freeze(rows.map((row) => Object.freeze({ userId: row.user_id, loginPublicKey: row.login_public_key })));
  }
}
