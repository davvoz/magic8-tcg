/**
 * The player's budget (BalanceService) and how the game server's answer is
 * read (HttpBalanceApi).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { BalanceService } from "../../src/application/wallet/BalanceService.js";
import { HttpBalanceApi } from "../../src/infrastructure/api/HttpBalanceApi.js";

const STEEM = Object.freeze([{ asset: "STEEM", amount: "12.345" }, { asset: "SBD", amount: "0.007" }]);

/** An API whose answers the test hands out one by one. */
function scriptedApi() {
  /** @type {((result: unknown) => void)[]} */
  const pending = [];
  return {
    api: { balances: () => new Promise((resolve) => pending.push(resolve)) },
    answer: (result) => pending.shift()?.(result),
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("BalanceService", () => {
  it("reads what the wallet holds and compares prices with it exactly", async () => {
    const { api, answer } = scriptedApi();
    const balance = new BalanceService({ api });
    const seen = [];
    balance.subscribe((state) => seen.push(state.loading));
    assert.equal(balance.amountOf("STEEM"), null);
    assert.equal(balance.isShort("1000.000", "STEEM"), false, "nothing is short while unknown");
    const read = balance.refresh();
    assert.equal(balance.state.loading, true);
    answer(ok(STEEM));
    await read;
    assert.deepEqual(seen, [true, false]);
    assert.equal(balance.amountOf("STEEM"), "12.345");
    assert.equal(balance.isShort("12.345", "STEEM"), false, "exactly enough is enough");
    assert.equal(balance.isShort("12.346", "STEEM"), true);
    assert.equal(balance.isShort("9.5", "STEEM"), false);
    assert.equal(balance.isShort("1.000", "HIVE"), false, "an asset it does not report is unknown, not short");
  });

  it("keeps what it knew when a read fails, and says why", async () => {
    const { api, answer } = scriptedApi();
    const balance = new BalanceService({ api });
    const first = balance.refresh();
    answer(ok(STEEM));
    await first;
    const second = balance.refresh();
    answer(fail("CHAIN_UNAVAILABLE", "the blockchain cannot be reached right now, try again"));
    await second;
    assert.equal(balance.amountOf("STEEM"), "12.345");
    assert.equal(balance.state.error, "the blockchain cannot be reached right now, try again");
  });

  it("keeps only the latest read, and forgets everything on reset", async () => {
    const { api, answer } = scriptedApi();
    const balance = new BalanceService({ api });
    const older = balance.refresh();
    const newer = balance.refresh();
    answer(ok([{ asset: "STEEM", amount: "1.000" }]));
    answer(ok([{ asset: "STEEM", amount: "2.000" }]));
    await Promise.all([older, newer]);
    assert.equal(balance.amountOf("STEEM"), "2.000");
    const late = balance.refresh();
    balance.reset();
    answer(ok([{ asset: "STEEM", amount: "3.000" }]));
    await late;
    assert.deepEqual(balance.state, { loading: false, balances: null, error: null }, "an answer for the previous account is dropped");
  });
});

describe("HttpBalanceApi", () => {
  it("reads the balances and checks their shape", async () => {
    const requests = [];
    const answerWith = (response) => new HttpBalanceApi({ fetch: async (url, init) => (requests.push({ url, init }), response) });
    assert.deepEqual(await answerWith(json(200, { account: "alice", balances: STEEM })).balances(), { ok: true, value: STEEM });
    assert.equal(requests[0].url, "/api/wallet/balances");
    assert.equal(requests[0].init.method, "GET");
    for (const body of [{}, { balances: [{ asset: "STEEM", amount: 12.3 }] }, { balances: [{ asset: "steem", amount: "1.000" }] }, { balances: "lots" }]) {
      assert.equal((await answerWith(json(200, body)).balances()).error.code, "BAD_RESPONSE", JSON.stringify(body));
    }
    const down = await answerWith(json(503, { error: { code: "CHAIN_UNAVAILABLE", message: "the blockchain cannot be reached right now, try again" } })).balances();
    assert.equal(down.error.code, "CHAIN_UNAVAILABLE");
  });
});
