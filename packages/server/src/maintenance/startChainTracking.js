/**
 * Run once, before the server publishes with a broadcaster for the first
 * time: the chain tracker will read that account's history from its current
 * end. What the account published before is not this database's (another
 * server: tests run on the same account), and would otherwise raise one
 * UNKNOWN_ON_CHAIN alert per operation, the alert that means a stolen key.
 *
 *   node packages/server/src/maintenance/startChainTracking.js <account> [<account> …]
 *
 * Same environment as the server (in Docker: docker compose exec app node …).
 * An account the tracker already follows, or that this database already
 * published with, is left alone: skipping its history would hide our own
 * operations from the tracker.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { STEEM_NETWORK, SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient } from "@magic8/steem";
import { loadConfig } from "../config.js";
import { createJsonLogger } from "../kernel/logger.js";
import { systemClock } from "../kernel/time.js";
import { PgChainRepository } from "../modules/chain/index.js";
import { openDatabase } from "../platform/db/openDatabase.js";

const PAGE_SIZE = 1000;

/**
 * @param {{
 *   database: import("../platform/db/Database.js").Database,
 *   reader: { publications: (account: string, after: number, limit: number) => Promise<readonly { index: number }[]> },
 *   network: string,
 *   clock: import("../kernel/time.js").Clock,
 * }} deps
 * @param {string} account
 * @returns {Promise<Readonly<{ account: string, started: boolean, index: number | null, problem: string | null }>>}
 */
export async function startChainTracking({ database, reader, network, clock }, account) {
  const repository = new PgChainRepository(database);
  const name = `tracker:${network}:${account}`;
  const result = (started, index, problem) => Object.freeze({ account, started, index, problem });
  const followed = await repository.getCursor(name);
  if (followed !== null) {
    return result(false, followed, "the tracker already follows this account");
  }
  const published = await database.maybeOne("SELECT 1 AS found FROM blockchain_transactions WHERE network = $1 AND signer = $2 LIMIT 1", [network, account]);
  if (published !== null) {
    return result(false, null, "this database already published with this account");
  }
  let index = -1;
  for (;;) {
    const entries = await reader.publications(account, index, PAGE_SIZE);
    if (entries.length > 0) {
      index = entries[entries.length - 1].index;
    }
    if (entries.length < PAGE_SIZE) {
      break;
    }
  }
  if (index < 0) {
    return result(false, null, "the account has no history: nothing to skip");
  }
  await repository.setCursor(name, network, index, clock.now());
  return result(true, index, null);
}

async function main() {
  const accounts = process.argv.slice(2);
  const config = loadConfig(process.env);
  const logger = createJsonLogger({ write: (line) => process.stdout.write(line), level: "info" });
  if (accounts.length === 0 || !accounts.every((account) => /^[a-z][a-z0-9.-]{2,15}$/.test(account))) {
    process.stderr.write("usage: startChainTracking.js <account> [<account> …]\n");
    process.exitCode = 2;
    return;
  }
  const database = await openDatabase({ url: config.databaseUrl, baseDirectory: resolve(import.meta.dirname, "../../../.."), logger });
  try {
    const reader = new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc: new SteemRpcClient({ nodes: config.steemNodes }) }) });
    let failed = false;
    for (const account of accounts) {
      const outcome = await startChainTracking({ database, reader, network: STEEM_NETWORK, clock: systemClock }, account);
      logger.info("start chain tracking", outcome);
      failed ||= !outcome.started;
    }
    process.exitCode = failed ? 1 : 0;
  } finally {
    await database.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
