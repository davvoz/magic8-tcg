/**
 * HTTP surface of the marketplace (docs/tcg/02-protocollo-multiplayer.md §2).
 * The listing and the pack epochs are public (anyone may check odds and
 * commitments); orders belong to their buyer.
 */
import { checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";
import { MAX_ORDER_LINES } from "../application/MarketplaceService.js";

/** An order is `{ items: [{ productId, quantity }, ...], asset }` (a cart), or one line as `{ productId, quantity, asset }`. */
const ORDER_KEYS = Object.freeze(["items", "productId", "quantity", "asset"]);
const LINE_KEYS = Object.freeze(["productId", "quantity"]);
const HINT_KEYS = Object.freeze(["txId"]);
const PUBLIC_RATE = Object.freeze({ name: "market-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const ORDER_READ_RATE = Object.freeze({ name: "orders-read", capacity: 120, refillPerSecond: 2, by: /** @type {const} */ ("user") });
const ORDER_WRITE_RATE = Object.freeze({ name: "orders-write", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("user") });
const HINT_RATE = Object.freeze({ name: "orders-hint", capacity: 6, refillPerSecond: 0.1, by: /** @type {const} */ ("user") });
const ORDER_CANCEL_RATE = Object.freeze({ name: "orders-cancel", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("user") });

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   marketplace: import("../application/MarketplaceService.js").MarketplaceService,
 *   epochs: import("../application/PackEpochService.js").PackEpochService,
 *   settlement: import("../application/PaymentSettlement.js").PaymentSettlement,
 * }} deps
 */
export function registerMarketplaceRoutes({ router, marketplace, epochs, settlement }) {
  router.add({
    method: "GET",
    path: "/api/products",
    auth: Auth.NONE,
    rateLimit: PUBLIC_RATE,
    handler: async () => ({ status: 200, body: await marketplace.listing() }),
  });

  router.add({
    method: "GET",
    path: "/api/pack-epochs",
    auth: Auth.NONE,
    rateLimit: PUBLIC_RATE,
    handler: async () => ({ status: 200, body: { epochs: await epochs.publicEpochs() } }),
  });

  router.add({
    method: "POST",
    path: "/api/orders",
    auth: Auth.REQUIRED,
    rateLimit: ORDER_WRITE_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ORDER_KEYS, (issues, object) => {
        if (object.items === undefined) {
          checkLine(issues, object, "body");
        } else if (object.productId !== undefined || object.quantity !== undefined) {
          issues.add("body", "send either items or productId and quantity");
        } else {
          checkArrayOf(issues, object.items, "body.items", { minLength: 1, maxLength: MAX_ORDER_LINES, item: (line, path) => (checkObject(issues, line, path, LINE_KEYS) === undefined ? undefined : checkLine(issues, /** @type {Record<string, unknown>} */ (line), path)) });
        }
        checkString(issues, object.asset, "body.asset", { minLength: 1, maxLength: 10 });
      });
      const { user } = context.principal;
      const items = /** @type {{ productId: string, quantity: number }[]} */ (body.items ?? [{ productId: body.productId, quantity: body.quantity }]);
      const result = await marketplace.createOrder({
        buyer: { id: user.id, account: user.account, network: user.network },
        items,
        asset: body.asset,
        idempotencyKey: context.header("idempotency-key"),
        ip: context.ip,
      });
      return { status: result.created ? 201 : 200, body: { order: result.order } };
    },
  });

  router.add({
    method: "GET",
    path: "/api/orders",
    auth: Auth.REQUIRED,
    rateLimit: ORDER_READ_RATE,
    handler: async (context) => ({ status: 200, body: { orders: await marketplace.listOrders(context.principal.user.id) } }),
  });

  router.add({
    method: "GET",
    path: "/api/orders/:id",
    auth: Auth.REQUIRED,
    rateLimit: ORDER_READ_RATE,
    handler: async (context) => ({ status: 200, body: { order: await marketplace.getOrder(context.principal.user.id, context.params.id) } }),
  });

  router.add({
    method: "POST",
    path: "/api/orders/:id/payment-hint",
    auth: Auth.REQUIRED,
    rateLimit: HINT_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), HINT_KEYS, (issues, object) => {
        checkString(issues, object.txId, "body.txId", { minLength: 40, maxLength: 40 });
      });
      const order = await settlement.hint({ userId: context.principal.user.id, orderId: context.params.id, txId: body.txId });
      return { status: 202, body: { order: marketplace.orderView(order) } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/orders/:id/cancel",
    auth: Auth.REQUIRED,
    rateLimit: ORDER_CANCEL_RATE,
    handler: async (context) => ({ status: 200, body: { order: await marketplace.cancel({ userId: context.principal.user.id, orderId: context.params.id, ip: context.ip }) } }),
  });
}

/**
 * @param {import("@magic8/engine/shared/validation.js").Issues} issues
 * @param {Record<string, unknown>} line
 * @param {string} path
 */
function checkLine(issues, line, path) {
  const productId = checkString(issues, line.productId, `${path}.productId`, { minLength: 1, maxLength: 40 });
  const quantity = checkInteger(issues, line.quantity, `${path}.quantity`, { min: 1, max: 100 });
  return productId === undefined || quantity === undefined ? undefined : { productId, quantity };
}
