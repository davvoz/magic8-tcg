/**
 * HTTP surface of the wallet the server keeps for players who signed in with
 * Google (docs/tcg/29-google.md): a transfer that pays an open payment, the
 * authorisation of a game's session key, a ping. Each answers what the
 * browser's own wallet would have: a transaction id, a signature. And the
 * export of that wallet, after the player signed in at Google again.
 */
import { checkString } from "@magic8/engine/shared/validation.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

/** A payment is a few a minute at most, like the relay of the browsers' transfers. */
const TRANSFER_RATE = Object.freeze({ name: "custody-transfer", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("user") });
/** One per online game, and again if the page reloads. */
const MESSAGE_RATE = Object.freeze({ name: "custody-message", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("user") });
/** A ping is shared now and then, at the end of a game (the pings' own relay allows the same). */
const PING_RATE = Object.freeze({ name: "custody-ping", capacity: 5, refillPerSecond: 1 / 60, by: /** @type {const} */ ("user") });
/** An export follows a sign-in at Google: a few an hour at most. */
const EXPORT_RATE = Object.freeze({ name: "custody-export", capacity: 5, refillPerSecond: 1 / 600, by: /** @type {const} */ ("user") });

const TRANSFER_KEYS = Object.freeze(["from", "to", "amount", "asset", "memo"]);
const MESSAGE_KEYS = Object.freeze(["message"]);
const PING_KEYS = Object.freeze(["parentAuthor", "parentPermlink", "permlink", "title", "body", "jsonMetadata"]);
const ACCOUNT = Object.freeze({ minLength: 3, maxLength: 16 });

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   signer: import("../application/CustodialSigner.js").CustodialSigner,
 *   exports: import("../application/WalletExport.js").WalletExport,
 *   reauthentication: { userOf: (cookies: ReadonlyMap<string, string>) => string | null, spent: () => string },
 * }} deps `reauthentication`: who signed in at Google again lately (identity's cookie), and the cookie that spends it
 */
export function registerCustodyRoutes({ router, signer, exports, reauthentication }) {
  // The keys, once per sign-in at Google: the answer is never cached, and the proof is spent.
  router.add({
    method: "POST",
    path: "/api/custody/export",
    auth: Auth.REQUIRED,
    rateLimit: EXPORT_RATE,
    handler: async (context) => {
      const wallet = await exports.export({ principal: context.principal, reauthenticatedUserId: reauthentication.userOf(context.cookies), ip: context.ip });
      return { status: 200, body: { wallet }, headers: { "Cache-Control": "no-store" }, cookies: [reauthentication.spent()] };
    },
  });

  router.add({
    method: "POST",
    path: "/api/custody/transfers",
    auth: Auth.REQUIRED,
    rateLimit: TRANSFER_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), TRANSFER_KEYS, (issues, object) => {
        checkString(issues, object.from, "body.from", ACCOUNT);
        checkString(issues, object.to, "body.to", ACCOUNT);
        checkString(issues, object.amount, "body.amount", { minLength: 5, maxLength: 20 });
        checkString(issues, object.asset, "body.asset", { minLength: 1, maxLength: 8 });
        checkString(issues, object.memo, "body.memo", { minLength: 1, maxLength: 64 });
      });
      const transfer = /** @type {import("../application/ports.js").TransferRequest} */ (/** @type {unknown} */ (body));
      return { status: 201, body: { txId: await signer.transfer({ principal: context.principal, transfer, ip: context.ip }) } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/custody/messages",
    auth: Auth.REQUIRED,
    rateLimit: MESSAGE_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), MESSAGE_KEYS, (issues, object) => checkString(issues, object.message, "body.message", { minLength: 1, maxLength: 256 }));
      return { status: 201, body: { signature: await signer.signMessage({ principal: context.principal, message: body.message, ip: context.ip }) } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/custody/pings",
    auth: Auth.REQUIRED,
    rateLimit: PING_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), PING_KEYS, (issues, object) => {
        checkString(issues, object.parentAuthor, "body.parentAuthor", ACCOUNT);
        checkString(issues, object.parentPermlink, "body.parentPermlink", { minLength: 1, maxLength: 256 });
        checkString(issues, object.permlink, "body.permlink", { minLength: 1, maxLength: 256 });
        checkString(issues, object.title, "body.title", { maxLength: 256 });
        // The pings' relay holds the body to its own limit, in bytes.
        checkString(issues, object.body, "body.body", { minLength: 1, maxLength: 4000 });
        checkString(issues, object.jsonMetadata, "body.jsonMetadata", { maxLength: 8192 });
      });
      const comment = /** @type {Omit<import("../application/ports.js").CommentRequest, "author">} */ (/** @type {unknown} */ (body));
      return { status: 201, body: { txId: await signer.ping({ principal: context.principal, comment, ip: context.ip }) } };
    },
  });
}
