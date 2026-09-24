/**
 * Data key rotation (docs/tcg/07-runbook.md): re-seals every secret at rest
 * with the current data key, so a retired key can be dropped.
 *
 *   1. set the new key as M8_DATA_KEY with a new M8_DATA_KEY_ID, and list the
 *      old one in M8_DATA_KEYS_OLD ("id:hex"); restart the server (new
 *      secrets use the new key, old ones still open);
 *   2. run: node packages/server/src/maintenance/rotateDataKey.js
 *      (same environment as the server);
 *   3. when it reports 0 left, remove the old key from M8_DATA_KEYS_OLD.
 *
 * Each row is re-sealed in its own transaction with a compare-and-set on the
 * old ciphertext, so it can run while the server runs, and again safely.
 */
import { pathToFileURL } from "node:url";

import { hexToBytes } from "@magic8/protocol";
import { loadConfig } from "../config.js";
import { SecretBox } from "../kernel/crypto/SecretBox.js";
import { createJsonLogger } from "../kernel/logger.js";
import { nodeSecureRandom } from "../kernel/random.js";
import { openDatabase } from "../platform/db/openDatabase.js";

/** Where secrets live, and the context each one is sealed with (must match the owning module). */
export const SEALED_COLUMNS = Object.freeze([
  Object.freeze({ table: "games", column: "secret_encrypted", key: "id", context: (/** @type {unknown} */ id) => `game:${id}` }),
  Object.freeze({ table: "rng_epochs", column: "secret_encrypted", key: "id", context: (/** @type {unknown} */ id) => `rng_epoch:${id}` }),
]);

/**
 * @param {{ database: import("../platform/db/Database.js").Database, secrets: SecretBox }} deps
 * @returns {Promise<Readonly<{ resealed: number, current: number }>>}
 */
export async function rotateDataKey({ database, secrets }) {
  let resealed = 0;
  let current = 0;
  for (const { table, column, key, context } of SEALED_COLUMNS) {
    const rows = await database.rows(`SELECT ${key} AS id, ${column} AS sealed FROM ${table}`);
    for (const row of rows) {
      const sealed = new Uint8Array(row.sealed);
      const fresh = secrets.reseal(sealed, context(row.id));
      if (fresh === null) {
        current += 1;
        continue;
      }
      const updated = await database.transaction(() => database.query(`UPDATE ${table} SET ${column} = $2 WHERE ${key} = $1 AND ${column} = $3`, [row.id, Buffer.from(fresh), Buffer.from(sealed)]));
      resealed += updated.rowCount;
    }
  }
  return Object.freeze({ resealed, current });
}

async function main() {
  const config = loadConfig(process.env);
  const logger = createJsonLogger({ write: (line) => process.stdout.write(line), level: "info" });
  const database = await openDatabase({ url: config.databaseUrl, baseDirectory: new URL("../../../..", import.meta.url).pathname, logger });
  const secrets = new SecretBox({ keys: new Map([...config.dataKeys].map(([id, hex]) => [id, hexToBytes(hex)])), currentKeyId: config.dataKeyId, random: nodeSecureRandom });
  const result = await rotateDataKey({ database, secrets });
  logger.info("data key rotation", { keyId: config.dataKeyId, ...result });
  await database.close();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
