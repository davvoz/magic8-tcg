import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ChainDataError,
  RpcError,
  RpcErrorCode,
  SteemBlockchainProvider,
  SteemRpcClient,
  SteemWalletProvider,
  WalletError,
  publicKeyOf,
  signMessage,
} from "../src/index.js";
import { fakeFetch, rawAccount } from "./fakes.js";

const A = "https://a.example/";
const B = "https://b.example/";

/** @param {Parameters<typeof fakeFetch>[0]} handlers */
function client(handlers, options = {}) {
  const fake = fakeFetch(handlers);
  return { rpc: new SteemRpcClient({ nodes: [A, B], fetch: fake.fetch, timeoutMs: 50, ...options }), calls: fake.calls };
}

describe("SteemRpcClient", () => {
  it("sends JSON-RPC 2.0 and returns the result", async () => {
    const { rpc, calls } = client({ [A]: () => ({ reply: { ok: 1 } }) });
    assert.deepEqual(await rpc.call("condenser_api.get_accounts", [["alice"]]), { ok: 1 });
    assert.deepEqual(calls[0].request, { jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [["alice"]] });
  });

  it("fails over on network errors, timeouts, 5xx, 429, bad JSON and id mismatches", async () => {
    const failures = [
      () => ({ throws: true }),
      () => ({ delayMs: 500, reply: 1 }),
      () => ({ status: 503, body: "busy" }),
      () => ({ status: 429, body: "slow down" }),
      () => ({ body: "<html>" }),
      (request) => ({ json: { jsonrpc: "2.0", id: request.id + 1, result: 1 } }),
      () => ({ json: { jsonrpc: "2.0", id: 1 } }),
      () => ({ error: { code: -32003, message: "method not supported" } }),
    ];
    for (const failure of failures) {
      const { rpc } = client({ [A]: failure, [B]: () => ({ reply: "from b" }) });
      assert.equal(await rpc.call("condenser_api.get_config", []), "from b", failure.toString());
    }
  });

  it("does not fail over on a deterministic JSON-RPC error", async () => {
    const { rpc, calls } = client({ [A]: () => ({ error: { code: -32602, message: "invalid params" } }), [B]: () => ({ reply: 1 }) });
    await assert.rejects(rpc.call("condenser_api.get_accounts", ["bad"]), (error) => error instanceof RpcError && error.code === RpcErrorCode.RPC_ERROR);
    assert.equal(calls.length, 1);
  });

  it("reports when every node failed", async () => {
    const { rpc } = client({ [A]: () => ({ status: 500, body: "" }), [B]: () => ({ throws: true }) });
    await assert.rejects(rpc.call("condenser_api.get_config", []), (error) => error.code === RpcErrorCode.ALL_NODES_FAILED && error.details.failures.length === 2);
  });

  it("puts a failing node on cooldown and tries healthy nodes first", async () => {
    let now = 0;
    const { rpc, calls } = client({ [A]: (_, call) => (call === 1 ? { throws: true } : { reply: "a" }), [B]: () => ({ reply: "b" }) }, { now: () => now, cooldownMs: 1000 });
    assert.equal(await rpc.call("condenser_api.get_config", []), "b");
    assert.equal(await rpc.call("condenser_api.get_config", []), "b");
    assert.deepEqual(calls.map((call) => call.url), [A, B, B]);
    now = 1001;
    assert.equal(await rpc.call("condenser_api.get_config", []), "a");
  });

  it("caps response size", async () => {
    const { rpc } = client({ [A]: () => ({ reply: "x".repeat(5000) }), [B]: () => ({ reply: "small" }) }, { maxResponseBytes: 1000 });
    assert.equal(await rpc.call("condenser_api.get_config", []), "small");
  });

  it("validates its configuration and method names", async () => {
    assert.throws(() => new SteemRpcClient({ nodes: [] }), TypeError);
    assert.throws(() => new SteemRpcClient({ nodes: ["http://node.example/"] }), TypeError);
    assert.throws(() => new SteemRpcClient({ nodes: ["https://user:pw@node.example/"] }), TypeError);
    assert.throws(() => new SteemRpcClient({ nodes: ["not a url"] }), TypeError);
    assert.doesNotThrow(() => new SteemRpcClient({ nodes: ["http://127.0.0.1:8090/"], allowInsecureHosts: ["127.0.0.1"] }));
    const { rpc } = client({ [A]: () => ({ reply: 1 }) });
    await assert.rejects(rpc.call("DROP TABLE", []), TypeError);
  });
});

const KEY_ONE = publicKeyOf(new Uint8Array(32).fill(1));
const KEY_TWO = publicKeyOf(new Uint8Array(32).fill(2));

/** @param {(request: any) => unknown} reply */
function providerWith(reply) {
  const rpc = new SteemRpcClient({ nodes: [A], fetch: fakeFetch({ [A]: (request) => ({ reply: reply(request) }) }).fetch });
  return new SteemBlockchainProvider({ rpc });
}

describe("SteemBlockchainProvider", () => {
  it("maps an account to a neutral DTO with validated authorities", async () => {
    const chain = providerWith(() => [rawAccount("alice", [KEY_ONE, "STMgarbage"])]);
    const account = await chain.getAccount("alice");
    assert.equal(account.network, "steem");
    assert.deepEqual(account.posting.keys, [{ key: KEY_ONE, weight: 1 }], "invalid keys are dropped");
    assert.deepEqual(account.posting.accounts, [{ account: "some.app", weight: 1 }]);
    assert.equal(account.posting.threshold, 1);
  });

  it("returns null for unknown or invalid names without asking the node for invalid ones", async () => {
    let asked = 0;
    const chain = providerWith(() => {
      asked += 1;
      return [];
    });
    assert.equal(await chain.getAccount("nobody"), null);
    assert.equal(await chain.getAccount("NOT VALID"), null);
    assert.equal(asked, 1);
  });

  it("refuses inconsistent node answers", async () => {
    await assert.rejects(providerWith(() => [rawAccount("mallory", [KEY_ONE])]).getAccount("alice"), ChainDataError);
    await assert.rejects(providerWith(() => [rawAccount("alice", [KEY_ONE]), rawAccount("alice", [KEY_ONE])]).getAccount("alice"), ChainDataError);
    await assert.rejects(providerWith(() => [{ name: "alice", posting: { weight_threshold: -1, key_auths: [], account_auths: [] } }]).getAccount("alice"), ChainDataError);
    await assert.rejects(providerWith(() => "nope").getAccount("alice"), ChainDataError);
  });

  it("reads head and irreversible blocks", async () => {
    const chain = providerWith(() => ({ head_block_number: 100, last_irreversible_block_num: 85, time: "2026-09-24T10:00:03" }));
    assert.deepEqual(await chain.getHead(), { headBlock: 100, irreversibleBlock: 85, time: Date.UTC(2026, 8, 24, 10, 0, 3) });
    await assert.rejects(providerWith(() => ({ head_block_number: 1, last_irreversible_block_num: 2, time: "2026-09-24T10:00:03" })).getHead(), ChainDataError);
    await assert.rejects(providerWith(() => ({ head_block_number: 1, last_irreversible_block_num: 1, time: "yesterday" })).getHead(), ChainDataError);
  });
});

describe("SteemWalletProvider", () => {
  const privateKey = new Uint8Array(32).fill(1);
  const challenge = { account: "alice", nonce: "n0nce", origin: "https://play.example", issuedAt: Date.UTC(2026, 8, 24), expiresAt: Date.UTC(2026, 8, 24, 0, 2) };

  /** @param {unknown[]} accounts */
  function wallet(accounts) {
    return new SteemWalletProvider({ chain: providerWith(() => accounts), appName: "magic8-tcg" });
  }

  it("builds a message that binds account, origin, nonce and validity", () => {
    const message = wallet([]).buildLoginMessage(challenge);
    assert.equal(message, "magic8-tcg login\naccount: alice\norigin: https://play.example\nnonce: n0nce\nissued: 2026-09-24T00:00:00.000Z\nexpires: 2026-09-24T00:02:00.000Z");
  });

  it("accepts a signature by a current posting key", async () => {
    const provider = wallet([rawAccount("alice", [KEY_ONE])]);
    const message = provider.buildLoginMessage(challenge);
    const result = await provider.verifyLogin({ account: "alice", message, signature: signMessage(message, privateKey) });
    assert.deepEqual(result, { ok: true, value: { network: "steem", account: "alice", publicKey: KEY_ONE } });
  });

  it("rejects keys that are not (or not enough of) the posting authority", async () => {
    const message = wallet([]).buildLoginMessage(challenge);
    const signature = signMessage(message, privateKey);
    const cases = [
      [[rawAccount("alice", [KEY_TWO])], WalletError.KEY_NOT_AUTHORIZED],
      [[rawAccount("alice", [KEY_TWO], { activeKeys: [KEY_ONE] })], WalletError.KEY_NOT_AUTHORIZED],
      [[rawAccount("alice", [KEY_ONE], { threshold: 2 })], WalletError.KEY_NOT_AUTHORIZED],
      [[rawAccount("alice", [KEY_ONE], { threshold: 0 })], WalletError.KEY_NOT_AUTHORIZED],
      [[], WalletError.ACCOUNT_NOT_FOUND],
    ];
    for (const [accounts, code] of cases) {
      const result = await wallet(accounts).verifyLogin({ account: "alice", message, signature });
      assert.equal(result.error?.code, code);
    }
  });

  it("rejects a signature of another message and malformed input", async () => {
    const provider = wallet([rawAccount("alice", [KEY_ONE])]);
    const message = provider.buildLoginMessage(challenge);
    const otherSignature = signMessage(provider.buildLoginMessage({ ...challenge, nonce: "other" }), privateKey);
    assert.equal((await provider.verifyLogin({ account: "alice", message, signature: otherSignature })).error.code, WalletError.KEY_NOT_AUTHORIZED);
    assert.equal((await provider.verifyLogin({ account: "alice", message, signature: "00" })).error.code, WalletError.MALFORMED_SIGNATURE);
    assert.equal((await provider.verifyLogin({ account: "A", message, signature: "00" })).error.code, WalletError.INVALID_ACCOUNT);
  });

  it("reports an unreachable chain distinctly", async () => {
    const rpc = new SteemRpcClient({ nodes: [A], fetch: fakeFetch({}).fetch });
    const provider = new SteemWalletProvider({ chain: new SteemBlockchainProvider({ rpc }), appName: "magic8-tcg" });
    const message = provider.buildLoginMessage(challenge);
    const result = await provider.verifyLogin({ account: "alice", message, signature: signMessage(message, privateKey) });
    assert.equal(result.error.code, WalletError.CHAIN_UNAVAILABLE);
  });

  it("validates its app name", () => {
    assert.throws(() => new SteemWalletProvider({ chain: providerWith(() => []), appName: "evil\nnonce: x" }), TypeError);
  });
});
