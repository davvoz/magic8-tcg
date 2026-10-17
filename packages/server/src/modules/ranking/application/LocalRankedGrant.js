import { STEEM_NETWORK } from "@magic8/steem";
import { toTimestamp } from "../../../platform/db/Database.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const GRANT_FORMAT = /^([a-z][a-z0-9.-]{1,14}[a-z0-9]):([1-9]\d?)$/;

/**
 * Applies a one-off ranked eligibility and entry grant for local testing.
 * This is deliberately restricted to an in-memory PGlite database bound to loopback.
 * @param {{
 *   database: import("../../../platform/db/Database.js").Database,
 *   databaseUrl: string,
 *   host: string,
 *   publicOrigin: string,
 *   value: string,
 *   at: number,
 * }} options
 */
export async function grantLocalRankedAccess({ database, databaseUrl, host, publicOrigin, value, at }) {
  const originHost = new URL(publicOrigin).hostname;
  if (databaseUrl !== "pglite:memory" || !LOCAL_HOSTS.has(host) || !LOCAL_HOSTS.has(originHost)) {
    throw new Error("M8_LOCAL_RANKED_GRANT is allowed only with pglite:memory and a loopback server origin");
  }
  const match = GRANT_FORMAT.exec(value);
  if (match === null) {
    throw new Error("M8_LOCAL_RANKED_GRANT must be an account and entry count, for example im-ridd:5");
  }
  const account = match[1];
  const count = Number(match[2]);
  const timestamp = toTimestamp(at);
  const reference = `local-ranked-grant:${account}`;

  return database.transaction(async () => {
    await database.query(
      "INSERT INTO users (network, account) VALUES ($1, $2) ON CONFLICT (network, account) DO NOTHING",
      [STEEM_NETWORK, account],
    );
    const user = await database.maybeOne("SELECT id FROM users WHERE network = $1 AND account = $2", [STEEM_NETWORK, account]);
    if (user === null) {
      throw new Error(`could not create local test user "${account}"`);
    }
    await database.query(
      "INSERT INTO ranked_eligibility_grants (user_id, source, note, granted_at) VALUES ($1, 'local_test', 'Local test access; no game history altered', $2) ON CONFLICT (user_id) DO NOTHING",
      [user.id, timestamp],
    );
    const recorded = await database.maybeOne(
      "INSERT INTO entry_ledger (user_id, kind, reason, ref, delta, season, created_at) VALUES ($1, 'ranked', 'grant', $2, $3, NULL, $4) ON CONFLICT DO NOTHING RETURNING user_id",
      [user.id, reference, count, timestamp],
    );
    if (recorded !== null) {
      await database.query(
        `INSERT INTO entry_balances (user_id, kind, balance, updated_at) VALUES ($1, 'ranked', $2, $3)
         ON CONFLICT (user_id, kind) DO UPDATE SET balance = entry_balances.balance + EXCLUDED.balance, updated_at = EXCLUDED.updated_at`,
        [user.id, count, timestamp],
      );
    }
    return Object.freeze({ account, entries: recorded === null ? 0 : count });
  });
}
