/**
 * HTTP surface of the board (docs/tcg/14-vendite.md). The board is public:
 * anyone may see what is on sale. Listing, buying and one's own history
 * need a session; purchases belong to their buyer.
 */
import { checkString } from "@magic8/engine/shared/validation.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const BOARD_RATE = Object.freeze({ name: "board-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const READ_RATE = Object.freeze({ name: "sales-read", capacity: 120, refillPerSecond: 2, by: /** @type {const} */ ("user") });
const WRITE_RATE = Object.freeze({ name: "sales-write", capacity: 20, refillPerSecond: 20 / 60, by: /** @type {const} */ ("user") });
const HINT_RATE = Object.freeze({ name: "sales-hint", capacity: 6, refillPerSecond: 0.1, by: /** @type {const} */ ("user") });

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   sales: import("../application/SalesService.js").SalesService,
 *   settlement: import("../application/SaleSettlement.js").SaleSettlement,
 * }} deps
 */
export function registerSalesRoutes({ router, sales, settlement }) {
  router.add({
    method: "GET",
    path: "/api/listings",
    auth: Auth.NONE,
    rateLimit: BOARD_RATE,
    handler: async (context) => {
      const param = (/** @type {string} */ name) => context.query.get(name) ?? undefined;
      return { status: 200, body: await sales.board({ card: param("card"), seller: param("seller"), sort: param("sort"), offset: param("offset") }) };
    },
  });

  router.add({
    method: "GET",
    path: "/api/listings/mine",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: await sales.activity(context.principal.user.id) }),
  });

  router.add({
    method: "POST",
    path: "/api/listings",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ["asset", "copy", "price"], (issues, object) => {
        checkString(issues, object.copy, "body.copy", { minLength: 36, maxLength: 36 });
        checkString(issues, object.price, "body.price", { minLength: 1, maxLength: 24 });
        checkString(issues, object.asset, "body.asset", { minLength: 1, maxLength: 10 });
      });
      const { user } = context.principal;
      const result = await sales.list({ seller: { id: user.id, account: user.account, network: user.network }, copy: body.copy, price: body.price, asset: body.asset, idempotencyKey: context.header("idempotency-key"), ip: context.ip });
      return { status: result.created ? 201 : 200, body: { listing: result.listing } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/listings/:id/cancel",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => ({ status: 200, body: { listing: await sales.cancelListing({ userId: context.principal.user.id, listingId: context.params.id, ip: context.ip }) } }),
  });

  router.add({
    method: "POST",
    path: "/api/listings/:id/buy",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const { user } = context.principal;
      return { status: 200, body: { purchase: await sales.reserve({ buyer: { id: user.id, account: user.account, network: user.network }, listingId: context.params.id, ip: context.ip }) } };
    },
  });

  router.add({
    method: "GET",
    path: "/api/purchases/:id",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: { purchase: await sales.purchaseView(context.principal.user.id, context.params.id) } }),
  });

  router.add({
    method: "POST",
    path: "/api/purchases/:id/payment-hint",
    auth: Auth.REQUIRED,
    rateLimit: HINT_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ["txId"], (issues, object) => {
        checkString(issues, object.txId, "body.txId", { minLength: 40, maxLength: 40 });
      });
      return { status: 202, body: { purchase: await settlement.hint({ userId: context.principal.user.id, purchaseId: context.params.id, txId: body.txId }) } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/purchases/:id/release",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => ({ status: 200, body: { purchase: await settlement.release({ userId: context.principal.user.id, purchaseId: context.params.id, ip: context.ip }) } }),
  });
}
