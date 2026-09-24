/**
 * HTTP surface of the catalog (docs/tcg/02-protocollo-multiplayer.md §2).
 * Public: verifiers need content without an account.
 */
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";

const CONTENT_RATE = Object.freeze({ name: "content", capacity: 30, refillPerSecond: 0.5, by: /** @type {const} */ ("ip") });
/** A content version never changes: clients and proxies may keep it forever. */
const IMMUTABLE = Object.freeze({ "Cache-Control": "public, max-age=31536000, immutable" });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, catalog: import("../application/CatalogService.js").CatalogService }} deps
 */
export function registerCatalogRoutes({ router, catalog }) {
  router.add({
    method: "GET",
    path: "/api/content/current",
    auth: Auth.NONE,
    handler: async () => {
      const { hash, engineVersion } = catalog.current();
      return { status: 200, body: { hash, engineVersion } };
    },
  });

  router.add({
    method: "GET",
    path: "/api/content/:hash",
    auth: Auth.NONE,
    rateLimit: CONTENT_RATE,
    handler: async (context) => {
      const payload = await catalog.payload(context.params.hash);
      if (payload === null) {
        throw new AppError("NOT_FOUND", "unknown content version");
      }
      return { status: 200, raw: payload, headers: IMMUTABLE };
    },
  });
}
