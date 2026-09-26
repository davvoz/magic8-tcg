/**
 * HTTP surface of trades (docs/tcg/13-scambi.md): a player's own trades, and
 * what another player could give in one (counts per card, no copy details).
 */
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const READ_RATE = Object.freeze({ name: "trades-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });
const WRITE_RATE = Object.freeze({ name: "trades-write", capacity: 20, refillPerSecond: 20 / 60, by: /** @type {const} */ ("user") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, trading: import("../application/TradeService.js").TradeService }} deps
 */
export function registerTradeRoutes({ router, trading }) {
  router.add({
    method: "GET",
    path: "/api/trades",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: { trades: await trading.list(context.principal.user.id) } }),
  });

  router.add({
    method: "GET",
    path: "/api/trades/tradeable/:account",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: { cards: await trading.tradeableOf({ userId: context.principal.user.id, account: context.params.account }) } }),
  });

  router.add({
    method: "POST",
    path: "/api/trades",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ["give", "to", "want"], () => undefined);
      const { user } = context.principal;
      const result = await trading.propose({ proposer: { id: user.id, account: user.account }, to: body.to, give: body.give, want: body.want, idempotencyKey: context.header("idempotency-key"), ip: context.ip });
      return { status: result.created ? 201 : 200, body: { trade: result.trade } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/trades/:id/accept",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ["copies"], () => undefined);
      return { status: 200, body: { trade: await trading.accept({ userId: context.principal.user.id, tradeId: context.params.id, copies: body.copies, ip: context.ip }) } };
    },
  });

  for (const [action, run] of /** @type {const} */ ([
    ["decline", (request) => trading.decline(request)],
    ["cancel", (request) => trading.cancel(request)],
  ])) {
    router.add({
      method: "POST",
      path: `/api/trades/:id/${action}`,
      auth: Auth.REQUIRED,
      rateLimit: WRITE_RATE,
      handler: async (context) => ({ status: 200, body: { trade: await run({ userId: context.principal.user.id, tradeId: context.params.id, ip: context.ip }) } }),
    });
  }
}
