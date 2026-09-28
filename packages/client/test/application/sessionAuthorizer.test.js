/**
 * SessionAuthorizer: the Keychain prompt that authorises a game's signing
 * key (docs/tcg/12). One prompt at a time per game, at most one the player
 * did not ask for, no automatic retry after a refusal, and nothing sent
 * for a game that was closed while the prompt was open.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { AuthorizationState, SessionAuthorizer } from "../../src/application/online/SessionAuthorizer.js";

const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";

/** Session keys in memory, and a wallet whose prompts the test answers. */
function harness({ serverAccepts = true } = {}) {
  const keys = new Set();
  const sessionKeys = {
    create: async (gameId) => {
      keys.add(gameId);
      return { key: `04${"ab".repeat(64)}`, authorizationText: `m8tcg session ${gameId}` };
    },
    has: (gameId) => keys.has(gameId),
    sign: async () => "sig",
    forget: (gameId) => keys.delete(gameId),
  };
  /** @type {((approve: boolean) => void)[]} */
  const prompts = [];
  let shown = 0;
  const wallet = {
    signMessage: () => {
      shown += 1;
      return new Promise((resolve) => prompts.push((approve) => resolve(approve ? ok("f".repeat(130)) : fail("REJECTED", "the user said no"))));
    },
  };
  const sent = [];
  const send = async (type, data) => {
    sent.push({ type, data });
    return serverAccepts ? ok({ t: "game.session", d: { gameId: data.gameId } }) : ok({ t: "error", d: { code: "VALIDATION", message: "not a posting key" } });
  };
  const authorizer = new SessionAuthorizer({ sessionKeys, wallet, send });
  const answer = async (approve) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    /** @type {(approve: boolean) => void} */ (prompts.shift())(approve);
  };
  return { authorizer, keys, sent, answer, shown: () => shown };
}

describe("SessionAuthorizer", () => {
  it("asks once, shares the open prompt, and sends the signed key to the server", async () => {
    const h = harness();
    const first = h.authorizer.ask(GAME, "alice");
    const second = h.authorizer.ask(GAME, "alice");
    assert.equal(h.authorizer.stateOf(GAME)?.state, AuthorizationState.ASKING);
    await h.answer(true);
    assert.deepEqual(await first, { state: AuthorizationState.AUTHORIZED, reason: null });
    assert.deepEqual(await second, await first, "one prompt, two callers");
    assert.equal(h.shown(), 1);
    assert.deepEqual(h.sent.map((entry) => entry.type), ["game.session"]);
    assert.equal(h.keys.has(GAME), true);
    assert.equal((await h.authorizer.ask(GAME, "alice")).state, AuthorizationState.AUTHORIZED, "asking again just reports it");
    assert.equal(h.shown(), 1);
  });

  it("does not ask again on its own after a refusal; only a retry does", async () => {
    const h = harness();
    const asked = h.authorizer.ask(GAME, "alice");
    await h.answer(false);
    assert.deepEqual(await asked, { state: AuthorizationState.REFUSED, reason: "the user said no" });
    assert.equal(h.keys.has(GAME), false, "the unauthorised key is thrown away");
    assert.equal((await h.authorizer.ask(GAME, "alice")).state, AuthorizationState.REFUSED);
    assert.equal(h.shown(), 1, "no second prompt unasked");

    const retried = h.authorizer.retry(GAME, "alice");
    await h.answer(true);
    assert.equal((await retried).state, AuthorizationState.AUTHORIZED);
    assert.equal(h.shown(), 2);
  });

  it("drops an answer that comes back after the game was closed", async () => {
    const h = harness();
    const asked = h.authorizer.ask(GAME, "alice");
    h.authorizer.close(GAME);
    await h.answer(true);
    assert.equal((await asked).state, AuthorizationState.CLOSED);
    assert.deepEqual(h.sent, [], "nothing is sent for a closed game");
    assert.equal(h.keys.has(GAME), false);
    assert.equal((await h.authorizer.retry(GAME, "alice")).state, AuthorizationState.CLOSED, "and nothing is asked for it any more");
    assert.equal(h.shown(), 1);
  });

  it("reports a signature the server refuses, and a browser that cannot sign", async () => {
    const refused = harness({ serverAccepts: false });
    const asked = refused.authorizer.ask(GAME, "alice");
    await refused.answer(true);
    const outcome = await asked;
    assert.equal(outcome.state, AuthorizationState.REFUSED);
    assert.match(outcome.reason ?? "", /the server refused it: not a posting key/);
    assert.equal(refused.keys.has(GAME), false);

    const nothing = new SessionAuthorizer({ sessionKeys: null, wallet: null, send: async () => ok({ t: "game.session", d: {} }) });
    assert.equal((await nothing.ask(GAME, "alice")).state, AuthorizationState.UNAVAILABLE);
    const noAccount = harness();
    assert.equal((await noAccount.authorizer.ask(GAME, null)).state, AuthorizationState.UNAVAILABLE);
    assert.equal(noAccount.shown(), 0);
  });
});
