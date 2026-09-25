/**
 * Probes and metrics for the hosting platform and the monitoring system:
 * - GET /api/health: the process answers (liveness);
 * - GET /api/ready: the database answers too (readiness);
 * - GET /api/metrics: Prometheus text, only with `Authorization: Bearer
 *   <M8_METRICS_TOKEN>`; without a configured token it does not exist.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";

const PROBE_RATE = Object.freeze({ name: "probe", capacity: 30, refillPerSecond: 2, by: /** @type {const} */ ("ip") });
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/** @param {string} text */
const digest = (text) => createHash("sha256").update(text).digest();

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, monitor: import("../application/Monitor.js").Monitor, metricsToken: string | null }} deps
 */
export function registerMonitoringRoutes({ router, monitor, metricsToken }) {
  router.add({ method: "GET", path: "/api/health", auth: Auth.NONE, rateLimit: PROBE_RATE, handler: async () => ({ status: 200, body: { status: "ok" }, headers: NO_STORE }) });

  router.add({
    method: "GET",
    path: "/api/ready",
    auth: Auth.NONE,
    rateLimit: PROBE_RATE,
    handler: async () => ((await monitor.ready()) ? { status: 200, body: { status: "ready" }, headers: NO_STORE } : { status: 503, body: { status: "database unavailable" }, headers: NO_STORE }),
  });

  router.add({
    method: "GET",
    path: "/api/metrics",
    auth: Auth.NONE,
    rateLimit: PROBE_RATE,
    handler: async (context) => {
      const presented = /^Bearer (.+)$/.exec(context.header("authorization") ?? "")?.[1];
      if (metricsToken === null || presented === undefined || !timingSafeEqual(digest(presented), digest(metricsToken))) {
        throw new AppError("NOT_FOUND", "not found");
      }
      return { status: 200, raw: await monitor.metrics(), headers: { ...NO_STORE, "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } };
    },
  });
}
