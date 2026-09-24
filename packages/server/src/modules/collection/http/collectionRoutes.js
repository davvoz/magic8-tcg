/**
 * HTTP surface of the collection (docs/tcg/02-protocollo-multiplayer.md §2).
 * Read-only: no endpoint creates, moves or destroys cards.
 */
import { Auth } from "../../../platform/http/Router.js";

const READ_RATE = Object.freeze({ name: "collection-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, inventory: import("../application/InventoryService.js").InventoryService }} deps
 */
export function registerCollectionRoutes({ router, inventory }) {
  router.add({
    method: "GET",
    path: "/api/collection",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: { cards: await inventory.collection(context.principal.user.id) } }),
  });

  router.add({
    method: "GET",
    path: "/api/collection/cards/:id",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => {
      const { instance, history } = await inventory.card(context.principal.user.id, context.params.id);
      const card = {
        id: instance.id,
        definitionId: instance.definitionId,
        edition: instance.edition,
        serial: instance.serial,
        finish: instance.finish,
        status: instance.status,
        originKind: instance.originKind,
        mintedAt: instance.mintedAt,
      };
      return { status: 200, body: { card, history: history.map((event) => ({ kind: event.kind, at: event.at })) } };
    },
  });
}
