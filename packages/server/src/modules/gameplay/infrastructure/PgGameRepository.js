/**
 * games, game_players, game_events, game_commands, game_snapshots. Events
 * are appended with a compare-and-set on games.last_event_seq and are
 * immutable afterwards (database triggers); commands are append-only.
 */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

const ACTIVE = Object.freeze(["CREATED", "ACTIVE"]);

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @param {readonly import("../../../platform/db/Database.js").Row[]} players
 * @returns {import("../application/ports.js").StoredGame}
 */
function toGame(row, players) {
  return Object.freeze({
    id: row.id,
    mode: row.mode,
    status: row.status,
    network: row.network,
    protocolVersion: row.protocol_version,
    engineVersion: row.engine_version,
    contentHash: row.content_hash,
    sealedSecret: new Uint8Array(row.secret_encrypted),
    seedCommit: row.seed_commit,
    firstSeat: row.first_seat,
    winnerSeat: row.winner_seat,
    endReason: row.end_reason,
    version: row.engine_version_counter,
    lastEventSeq: row.last_event_seq,
    chainHead: row.chain_head,
    createdAt: fromTimestamp(row.created_at),
    startedAt: fromNullableTimestamp(row.started_at),
    finishedAt: fromNullableTimestamp(row.finished_at),
    players: Object.freeze(
      players.map((player) =>
        Object.freeze({
          seat: player.seat,
          userId: player.user_id,
          account: player.account,
          deckId: player.deck_id,
          deck: Object.freeze(player.deck_snapshot.map(([cardId, count]) => Object.freeze([cardId, count]))),
          deckCommit: player.deck_commit,
          entropy: player.entropy === null ? null : player.entropy.trim(),
          entropySource: player.entropy_source,
        }),
      ),
    ),
  });
}

/** @implements {import("../application/ports.js").GameRepository} */
export class PgGameRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async insertGame(game, created) {
    await this.#db.query(
      `INSERT INTO games (id, mode, status, network, protocol_version, engine_version, content_hash, secret_encrypted, seed_commit,
                          engine_version_counter, last_event_seq, chain_head, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [game.id, game.mode, game.status, game.network, game.protocolVersion, game.engineVersion, game.contentHash, Buffer.from(game.sealedSecret), game.seedCommit, game.version, created.event.i, created.head, toTimestamp(game.createdAt)],
    );
    for (const player of game.players) {
      await this.#db.query("INSERT INTO game_players (game_id, seat, user_id, account, deck_id, deck_snapshot, deck_commit) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        game.id,
        player.seat,
        player.userId,
        player.account,
        player.deckId,
        JSON.stringify(player.deck),
        player.deckCommit,
      ]);
    }
    await this.#insertEvents(game.id, [created], game.createdAt);
  }

  async findGame(gameId) {
    const row = await this.#db.maybeOne("SELECT * FROM games WHERE id = $1", [gameId]);
    if (row === null) {
      return null;
    }
    const players = await this.#db.rows("SELECT * FROM game_players WHERE game_id = $1 ORDER BY seat", [gameId]);
    return toGame(row, players);
  }

  async listEvents(gameId) {
    const rows = await this.#db.rows("SELECT seq, kind, actor, turn, ms, payload FROM game_events WHERE game_id = $1 ORDER BY seq", [gameId]);
    return Object.freeze(rows.map((row) => Object.freeze({ i: row.seq, k: row.kind, a: row.actor, t: row.turn, ms: row.ms, d: row.payload })));
  }

  async appendEvents(gameId, expectedLastSeq, events, changes) {
    const last = events[events.length - 1];
    const updated = await this.#db.maybeOne(
      `UPDATE games
          SET last_event_seq = $3, chain_head = $4,
              status = coalesce($5, status),
              engine_version_counter = coalesce($6, engine_version_counter),
              first_seat = coalesce($7, first_seat),
              winner_seat = CASE WHEN $8::boolean THEN $9 ELSE winner_seat END,
              end_reason = coalesce($10, end_reason),
              started_at = coalesce($11, started_at),
              finished_at = coalesce($12, finished_at)
        WHERE id = $1 AND last_event_seq = $2
       RETURNING id`,
      [
        gameId,
        expectedLastSeq,
        last.event.i,
        last.head,
        changes.status ?? null,
        changes.version ?? null,
        changes.firstSeat ?? null,
        changes.winnerSeat !== undefined,
        changes.winnerSeat ?? null,
        changes.endReason ?? null,
        changes.startedAt === undefined ? null : toTimestamp(changes.startedAt),
        changes.finishedAt === undefined ? null : toTimestamp(changes.finishedAt),
      ],
    );
    if (updated === null) {
      return false;
    }
    await this.#insertEvents(gameId, events, null);
    return true;
  }

  async setEntropy(gameId, seat, entropy, source) {
    await this.#db.query("UPDATE game_players SET entropy = $3, entropy_source = $4 WHERE game_id = $1 AND seat = $2 AND entropy IS NULL", [gameId, seat, entropy, source]);
  }

  async setResults(gameId, results) {
    for (const [seat, result] of Object.entries(results)) {
      await this.#db.query("UPDATE game_players SET result = $3 WHERE game_id = $1 AND seat = $2", [gameId, seat, result]);
    }
  }

  async findAck(gameId, commandId) {
    const row = await this.#db.maybeOne("SELECT ack FROM game_commands WHERE game_id = $1 AND command_id = $2", [gameId, commandId]);
    return row === null ? null : row.ack;
  }

  async insertCommand({ gameId, commandId, seat, expectedVersion, payload, accepted, ack, at }) {
    await this.#db.query(
      `INSERT INTO game_commands (game_id, command_id, seat, expected_version, payload, accepted, ack, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (game_id, command_id) DO NOTHING`,
      [gameId, commandId, seat, expectedVersion, JSON.stringify(payload), accepted, JSON.stringify(ack), toTimestamp(at)],
    );
  }

  async insertSnapshot(gameId, engineVersion, commitment) {
    await this.#db.query("INSERT INTO game_snapshots (game_id, engine_version, state_commitment) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [gameId, engineVersion, commitment]);
  }

  async listActive() {
    const rows = await this.#db.rows("SELECT id FROM games WHERE status = ANY($1::text[]) ORDER BY created_at", [ACTIVE]);
    return Object.freeze(rows.map((row) => row.id));
  }

  async listFinished({ mode, since, limit }) {
    const games = await this.#db.rows(
      `SELECT g.id, g.mode, g.finished_at, g.winner_seat, g.end_reason,
              (SELECT turn FROM game_events e WHERE e.game_id = g.id ORDER BY seq DESC LIMIT 1) AS turn
         FROM games g WHERE g.status = 'FINISHED' AND g.mode = $1 AND g.finished_at >= $2
        ORDER BY g.finished_at, g.id LIMIT $3`,
      [mode, toTimestamp(since), limit],
    );
    const result = [];
    for (const game of games) {
      const players = await this.#db.rows("SELECT seat, user_id, account FROM game_players WHERE game_id = $1 ORDER BY seat", [game.id]);
      result.push(
        Object.freeze({
          gameId: game.id,
          mode: game.mode,
          finishedAt: fromTimestamp(game.finished_at),
          winnerSeat: game.winner_seat,
          endReason: game.end_reason,
          turn: game.turn,
          players: Object.freeze(players.map((player) => Object.freeze({ seat: player.seat, userId: player.user_id, account: player.account }))),
        }),
      );
    }
    return Object.freeze(result);
  }

  async countFinished(userId, mode) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM games g JOIN game_players p ON p.game_id = g.id WHERE p.user_id = $1 AND g.mode = $2 AND g.status = 'FINISHED'", [userId, mode]);
    return row?.n ?? 0;
  }

  async activeGameOf(userId) {
    const row = await this.#db.maybeOne(
      "SELECT g.id FROM games g JOIN game_players p ON p.game_id = g.id WHERE p.user_id = $1 AND g.status = ANY($2::text[]) ORDER BY g.created_at DESC LIMIT 1",
      [userId, ACTIVE],
    );
    return row === null ? null : row.id;
  }

  async lockForSealing(gameId) {
    const row = await this.#db.maybeOne("SELECT network FROM games WHERE id = $1 FOR UPDATE", [gameId]);
    return row === null ? null : Object.freeze({ network: row.network });
  }

  async listUnsealed(gameId) {
    const rows = await this.#db.rows("SELECT seq, kind, actor, turn, ms, payload, head FROM game_events WHERE game_id = $1 AND record_seq IS NULL ORDER BY seq", [gameId]);
    return Object.freeze(rows.map((row) => Object.freeze({ event: Object.freeze({ i: row.seq, k: row.kind, a: row.actor, t: row.turn, ms: row.ms, d: row.payload }), head: row.head })));
  }

  async countUnsealed(gameId) {
    const row = /** @type {import("../../../platform/db/Database.js").Row} */ (await this.#db.maybeOne("SELECT count(*)::integer AS pending FROM game_events WHERE game_id = $1 AND record_seq IS NULL", [gameId]));
    return row.pending;
  }

  async headAt(gameId, seq) {
    const row = await this.#db.maybeOne("SELECT head FROM game_events WHERE game_id = $1 AND seq = $2", [gameId, seq]);
    return row === null ? null : row.head;
  }

  async nextRecordSeq(gameId) {
    const row = /** @type {import("../../../platform/db/Database.js").Row} */ (await this.#db.maybeOne("SELECT coalesce(max(record_seq) + 1, 0)::integer AS next FROM game_events WHERE game_id = $1", [gameId]));
    return row.next;
  }

  async markSealed(gameId, fromSeq, toSeq, recordSeq) {
    await this.#db.query("UPDATE game_events SET record_seq = $4 WHERE game_id = $1 AND seq BETWEEN $2 AND $3 AND record_seq IS NULL", [gameId, fromSeq, toSeq, recordSeq]);
  }

  async gamesWithUnsealedBefore(before) {
    const rows = await this.#db.rows(
      `SELECT e.game_id FROM game_events e JOIN games g ON g.id = e.game_id
        WHERE e.record_seq IS NULL
        GROUP BY e.game_id, g.created_at
       HAVING g.created_at + min(e.ms) * interval '1 millisecond' <= $1
        ORDER BY e.game_id`,
      [toTimestamp(before)],
    );
    return Object.freeze(rows.map((row) => row.game_id));
  }

  /**
   * @param {string} gameId
   * @param {readonly import("@magic8/protocol").ChainedEvent[]} events
   * @param {number | null} at
   */
  async #insertEvents(gameId, events, at) {
    for (const { event, head } of events) {
      await this.#db.query("INSERT INTO game_events (game_id, seq, kind, actor, turn, ms, payload, head, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, now()))", [
        gameId,
        event.i,
        event.k,
        event.a,
        event.t,
        event.ms,
        JSON.stringify(event.d),
        head,
        at === null ? null : toTimestamp(at),
      ]);
    }
  }
}
