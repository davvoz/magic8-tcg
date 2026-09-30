/**
 * Reopens an order that expired although its payment reached the chain in
 * time, unseen by the server (2026-09-30: the payment watcher missed a
 * transfer after a node failover; see SteemTransferPaymentProvider). The
 * order goes back to PAYMENT_PENDING with a fresh deadline, and the normal
 * pipeline takes over: the watcher records the transfer, checks it against
 * the order (amount, sender, asset, sent before the original deadline),
 * waits for it to be irreversible and fulfils the order, receipt included.
 * A transfer that does not pay the order is refunded as usual.
 *
 *   node packages/server/src/maintenance/reopenOrder.js <order id> "<reason>"
 *
 * Same environment as the server, with the server stopped when the database
 * is PGlite (it has a single process). Only an EXPIRED order that no payment
 * was ever matched to can be reopened; the change and its reason go to the audit trail.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.js";
import { AuditTrail } from "../kernel/audit/AuditTrail.js";
import { createJsonLogger } from "../kernel/logger.js";
import { isUuid } from "../kernel/random.js";
import { systemClock } from "../kernel/time.js";
import { PgAuditStore } from "../platform/audit/PgAuditStore.js";
import { toTimestamp } from "../platform/db/Database.js";
import { openDatabase } from "../platform/db/openDatabase.js";

/** How long the reopened order waits for the watcher to see its payment. */
export const REOPEN_WINDOW_MS = 30 * 60 * 1000;

/**
 * @param {{ database: import("../platform/db/Database.js").Database, audit: AuditTrail, clock: import("../kernel/time.js").Clock }} deps
 * @param {{ orderId: string, reason: string }} request
 * @returns {Promise<Readonly<{ reopened: boolean, problem: string | null }>>}
 */
export async function reopenOrder({ database, audit, clock }, { orderId, reason }) {
  if (!isUuid(orderId) || reason.trim().length === 0) {
    return Object.freeze({ reopened: false, problem: "an order id and a reason are required" });
  }
  return database.transaction(async () => {
    const order = await database.maybeOne("SELECT status, expires_at, payment_id, memo FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (order === null) {
      return Object.freeze({ reopened: false, problem: "no such order" });
    }
    if (order.status !== "EXPIRED" || order.payment_id !== null) {
      return Object.freeze({ reopened: false, problem: `only an expired, unpaid order can be reopened (status ${order.status})` });
    }
    const matched = await database.maybeOne("SELECT id FROM payments WHERE order_id = $1 LIMIT 1", [orderId]);
    if (matched !== null) {
      return Object.freeze({ reopened: false, problem: "a payment was already matched to this order" });
    }
    const now = clock.now();
    await database.query("UPDATE orders SET status = 'PAYMENT_PENDING', expires_at = $2, version = version + 1, updated_at = $3 WHERE id = $1 AND status = 'EXPIRED'", [
      orderId,
      toTimestamp(now + REOPEN_WINDOW_MS),
      toTimestamp(now),
    ]);
    await audit.record({
      actorKind: "admin",
      action: "marketplace.order_reopened",
      targetKind: "order",
      targetId: orderId,
      details: { reason, memo: order.memo, previousExpiresAt: new Date(order.expires_at).toISOString() },
    });
    return Object.freeze({ reopened: true, problem: null });
  });
}

async function main() {
  const [orderId = "", reason = ""] = process.argv.slice(2);
  const config = loadConfig(process.env);
  const logger = createJsonLogger({ write: (line) => process.stdout.write(line), level: "info" });
  const database = await openDatabase({ url: config.databaseUrl, baseDirectory: resolve(import.meta.dirname, "../../../.."), logger });
  try {
    const audit = new AuditTrail({ store: new PgAuditStore(database), clock: systemClock });
    const result = await reopenOrder({ database, audit, clock: systemClock }, { orderId, reason });
    logger.info("reopen order", { order: orderId, ...result });
    process.exitCode = result.reopened ? 0 : 1;
  } finally {
    await database.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
