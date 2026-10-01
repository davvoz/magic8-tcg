/**
 * Announces or ends a maintenance from the command line (deploy/maintenance.sh,
 * deploy/deploy.sh); the admin page does the same over HTTP. The running
 * server hears the change on the maintenance channel: it closes or reopens
 * new payments and games and tells the players connected to it.
 *
 *   node packages/server/src/maintenance/maintenanceNotice.js announce <minutes> ["message"]
 *   node packages/server/src/maintenance/maintenanceNotice.js end
 *   node packages/server/src/maintenance/maintenanceNotice.js show
 *
 * Same environment as the server (in Docker: docker compose exec app node …).
 * Both changes go to the audit trail.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.js";
import { AuditTrail } from "../kernel/audit/AuditTrail.js";
import { createJsonLogger } from "../kernel/logger.js";
import { systemClock } from "../kernel/time.js";
import { unitOfWorkOf } from "../kernel/unitOfWork.js";
import { MaintenanceService, PgMaintenanceRepository } from "../modules/maintenance/index.js";
import { PgAuditStore } from "../platform/audit/PgAuditStore.js";
import { openDatabase } from "../platform/db/openDatabase.js";

const USAGE = 'usage: maintenanceNotice.js announce <minutes> ["message"] | end | show';

/**
 * @param {{ maintenance: MaintenanceService }} deps
 * @param {readonly string[]} args
 * @returns {Promise<Readonly<{ ok: boolean, result: unknown }>>}
 */
export async function runMaintenanceCommand({ maintenance }, args) {
  const [command = "", minutes = "", message = ""] = args;
  if (command === "announce" && /^\d{1,4}$/.test(minutes)) {
    return Object.freeze({ ok: true, result: await maintenance.announce({}, { minutes: Number(minutes), message: message === "" ? null : message }) });
  }
  if (command === "end") {
    return Object.freeze({ ok: true, result: { ended: await maintenance.end({}) } });
  }
  if (command === "show") {
    return Object.freeze({ ok: true, result: maintenance.current() });
  }
  return Object.freeze({ ok: false, result: USAGE });
}

async function main() {
  const config = loadConfig(process.env);
  const logger = createJsonLogger({ write: (line) => process.stdout.write(line), level: "warn" });
  const database = await openDatabase({ url: config.databaseUrl, baseDirectory: resolve(import.meta.dirname, "../../../.."), logger });
  try {
    const maintenance = new MaintenanceService({
      repository: new PgMaintenanceRepository(database),
      publish: (channel, payload) => database.query("SELECT pg_notify($1, $2)", [channel, payload]),
      listen: async () => async () => undefined,
      hub: { connectedUsers: () => [], send: () => undefined },
      audit: new AuditTrail({ store: new PgAuditStore(database), clock: systemClock }),
      clock: systemClock,
      unitOfWork: unitOfWorkOf(database),
      logger,
    });
    await maintenance.start();
    const { ok, result } = await runMaintenanceCommand({ maintenance }, process.argv.slice(2));
    process.stdout.write(`${typeof result === "string" ? result : JSON.stringify(result)}\n`);
    process.exitCode = ok ? 0 : 2;
  } finally {
    await database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
