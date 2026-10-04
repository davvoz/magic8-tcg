/**
 * HTTP surface of the season calendar, for operators only:
 * - GET /api/admin/seasons: the seasons with their phase, and the prize pools a season may name;
 * - POST /api/admin/seasons {id, name, startsAt, endsAt?, prizePool?, entryFee?}: adds a season;
 * - PUT /api/admin/seasons/:id {name, startsAt, endsAt?, prizePool?, entryFee?}: changes one;
 * - DELETE /api/admin/seasons/:id: deletes one that has not started.
 * Times are UTC to the second (`2026-10-08T00:00:00Z`); a missing or null `endsAt` ends the season when the next starts.
 */
import { Issues } from "@magic8/engine/shared/validation.js";
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";
import { SEASON_ID, checkSeason } from "../domain/RankedSettings.js";

const ADMIN_RATE = Object.freeze({ name: "admin", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });

/**
 * @param {unknown} body
 * @returns {import("../domain/RankedSettings.js").Season}
 */
function seasonOf(body) {
  const issues = new Issues();
  const season = checkSeason(issues, body, "body");
  if (season === undefined) {
    throw new AppError("VALIDATION", issues.list()[0]);
  }
  return season;
}

/** @param {string} id */
function checkedId(id) {
  if (!SEASON_ID.test(id)) {
    throw new AppError("NOT_FOUND", "no season with this id");
  }
  return id;
}

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   seasons: import("../application/SeasonCalendar.js").SeasonCalendar,
 *   admin: { requireAdmin: (principal: any) => { id: string } },
 * }} deps
 */
export function registerSeasonRoutes({ router, seasons, admin }) {
  router.add({
    method: "GET",
    path: "/api/admin/seasons",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      admin.requireAdmin(context.principal);
      return { status: 200, body: seasons.view() };
    },
  });

  router.add({
    method: "POST",
    path: "/api/admin/seasons",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      const operator = admin.requireAdmin(context.principal);
      const season = seasonOf(await context.readJson());
      return { status: 201, body: await seasons.create({ userId: operator.id, ip: context.ip }, season) };
    },
  });

  router.add({
    method: "PUT",
    path: "/api/admin/seasons/:id",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      const operator = admin.requireAdmin(context.principal);
      const id = checkedId(context.params.id);
      const body = await context.readJson();
      if (body !== null && typeof body === "object" && "id" in body) {
        throw new AppError("VALIDATION", "body.id: the id is in the path and cannot change");
      }
      const season = seasonOf(body !== null && typeof body === "object" ? { ...body, id } : body);
      return { status: 200, body: await seasons.update({ userId: operator.id, ip: context.ip }, season) };
    },
  });

  router.add({
    method: "DELETE",
    path: "/api/admin/seasons/:id",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      const operator = admin.requireAdmin(context.principal);
      return { status: 200, body: await seasons.remove({ userId: operator.id, ip: context.ip }, checkedId(context.params.id)) };
    },
  });
}
