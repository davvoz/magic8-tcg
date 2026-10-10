/** WebSocket messages of the auto list (docs/tcg/23-automatica.md). There is no message to leave it. */
import { checkString } from "@magic8/engine/shared/validation.js";
import { validated } from "../../../platform/http/validateBody.js";

/**
 * @param {{ router: import("../../../platform/realtime/MessageRouter.js").MessageRouter, auto: import("../application/AutoService.js").AutoService }} deps
 */
export function registerAutoMessages({ router, auto }) {
  router.on("auto.prepare", async ({ principal }, data) => {
    validated(data, [], () => undefined);
    return { t: "auto.prepared", d: await auto.prepare({ id: principal.user.id, account: principal.user.account }) };
  });

  router.on("auto.join", async ({ principal }, data) => {
    const body = validated(data, ["ticket", "deckId", "style", "entropy"], (issues, object) => {
      checkString(issues, object.ticket, "d.ticket", { minLength: 1, maxLength: 36 });
      checkString(issues, object.deckId, "d.deckId", { minLength: 1, maxLength: 36 });
      checkString(issues, object.style, "d.style", { minLength: 1, maxLength: 16 });
      checkString(issues, object.entropy, "d.entropy", { minLength: 32, maxLength: 32 });
    });
    const { user } = principal;
    const joined = await auto.join({ user: { id: user.id, account: user.account }, ticket: String(body.ticket), deckId: String(body.deckId), style: String(body.style), entropy: String(body.entropy) });
    return { t: "auto.status", d: joined };
  });

  router.on("auto.status", async ({ principal }, data) => {
    validated(data, [], () => undefined);
    return { t: "auto.status", d: await auto.status(principal.user.id) };
  });
}
