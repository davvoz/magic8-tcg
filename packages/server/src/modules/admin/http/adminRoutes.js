/**
 * HTTP surface for operators (/api/admin/*): signed-in users listed in
 * M8_ADMIN_ACCOUNTS only. Reads are rate limited per user; the one write
 * (acknowledging a chain alert) needs a note and is audited.
 */
import { checkString } from "@magic8/engine/shared/validation.js";
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const ADMIN_RATE = Object.freeze({ name: "admin", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });
const RESOLVE_KEYS = Object.freeze(["note"]);
const ACTION_PREFIX = /^[a-z_.]{1,64}$/;
const TARGET_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/**
 * @param {URLSearchParams} query
 * @param {string} name
 * @param {RegExp} pattern
 */
function optionalParam(query, name, pattern) {
  const value = query.get(name);
  if (value === null || value === "") {
    return undefined;
  }
  if (!pattern.test(value)) {
    throw new AppError("VALIDATION", `invalid ${name}`);
  }
  return value;
}

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, admin: import("../application/AdminService.js").AdminService }} deps
 */
export function registerAdminRoutes({ router, admin }) {
  /**
   * @param {string} path
   * @param {(context: any) => Promise<unknown>} read
   */
  const get = (path, read) =>
    router.add({
      method: "GET",
      path,
      auth: Auth.REQUIRED,
      rateLimit: ADMIN_RATE,
      handler: async (context) => {
        admin.requireAdmin(context.principal);
        return { status: 200, body: await read(context) };
      },
    });

  get("/api/admin/overview", () => admin.overview());
  get("/api/admin/alerts", async () => ({ alerts: await admin.alerts() }));
  get("/api/admin/refunds", async () => ({ refunds: await admin.refunds() }));
  get("/api/admin/audit/verify", () => admin.verifyAudit());
  get("/api/admin/audit", async (context) => {
    const query = context.query;
    const beforeSeq = optionalParam(query, "before", /^[1-9]\d{0,15}$/);
    const limit = optionalParam(query, "limit", /^[1-9]\d{0,2}$/);
    return {
      entries: await admin.audit({
        action: optionalParam(query, "action", ACTION_PREFIX),
        targetId: optionalParam(query, "target", TARGET_ID),
        beforeSeq: beforeSeq === undefined ? undefined : Number(beforeSeq),
        limit: limit === undefined ? undefined : Number(limit),
      }),
    };
  });

  router.add({
    method: "POST",
    path: "/api/admin/alerts/:id/resolve",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      const operator = admin.requireAdmin(context.principal);
      const body = validated(await context.readJson(), RESOLVE_KEYS, (issues, object) => {
        checkString(issues, object.note, "body.note", { minLength: 3, maxLength: 500 });
      });
      if (!/^[1-9]\d{0,15}$/.test(context.params.id)) {
        throw new AppError("NOT_FOUND", "no open alert with this id");
      }
      const resolved = await admin.resolveAlert(operator, Number(context.params.id), body.note, context.ip);
      return { status: 200, body: { resolved } };
    },
  });
}
