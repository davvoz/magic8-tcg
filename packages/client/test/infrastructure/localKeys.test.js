/**
 * The player's own keys (docs/tcg/20-chiavi.md): the vault that keeps them
 * encrypted, the wallet that checks, keeps and signs with them, and the
 * game server API it needs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { base58Encode, fromBroadcastJson, publicKeyOf, recoverSigner, recoverSignerKeys, serializeTransaction, transactionDigest, transactionId } from "@magic8/steem";
import { ActiveKeyPrompt, ActiveKeyStatus } from "../../src/application/wallet/ActiveKeyPrompt.js";
import { HttpWalletApi } from "../../src/infrastructure/api/HttpWalletApi.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { KeyVault } from "../../src/infrastructure/wallet/KeyVault.js";
import { LocalKeyWallet } from "../../src/infrastructure/wallet/LocalKeyWallet.js";

/** @param {number} seed */
function keyPair(seed) {
  const privateKey = new Uint8Array(32).fill(seed);
  const payload = Buffer.from([0x80, ...privateKey]);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return { wif: base58Encode(Uint8Array.from([...payload, ...checksum])), publicKey: publicKeyOf(privateKey) };
}

const POSTING = keyPair(1);
const ACTIVE = keyPair(2);
const STRANGER = keyPair(3);
const REFERENCE = Object.freeze({ blockNum: 100, blockId: "00000064dcdcf4b4aaaaaaaaaaaaaaaaaaaaaaaa", time: Date.UTC(2026, 9, 3, 10) });
const PAYMENT = Object.freeze({ from: "alice", to: "m8tcg-shop", amount: "1.500", asset: "STEEM", memo: "order 42" });

const randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));
const vaultOn = (store) => new KeyVault({ store, subtle: globalThis.crypto.subtle, randomBytes, iterations: 1000 });

/**
 * A store over `inner` whose device key cannot be read while `failing.device` holds (a storage hiccup).
 * @param {InMemoryStore} inner
 */
function hiccupStore(inner) {
  const failing = { device: true };
  return {
    failing,
    store: {
      read: (key) => (failing.device && key.endsWith(".device") ? fail("STORE_UNAVAILABLE", "local storage is not readable") : inner.read(key)),
      write: (key, value) => inner.write(key, value),
      delete: (key) => inner.delete(key),
    },
  };
}

/**
 * The game server as the wallet sees it: alice's keys on the chain, and what was broadcast.
 * @param {{ reference?: () => any, broadcast?: (transaction: any) => any }} [options]
 */
function fakeApi({ reference = () => ok(REFERENCE), broadcast } = {}) {
  const roles = new Map([
    [POSTING.publicKey, ["posting"]],
    [ACTIVE.publicKey, ["owner", "active"]],
  ]);
  const broadcasts = [];
  return {
    broadcasts,
    api: {
      keyRoles: async (account, publicKey) => (account === "alice" ? ok(roles.get(publicKey) ?? []) : fail("NOT_FOUND", "no such account")),
      reference: async () => reference(),
      broadcastTransfer: async (transaction) => {
        broadcasts.push(transaction);
        return broadcast === undefined ? ok("ignored") : broadcast(transaction);
      },
    },
  };
}

/**
 * Answers the prompt's requests in turn, recording each one as the player saw it.
 * @param {ActiveKeyPrompt} prompt
 * @param {((prompt: ActiveKeyPrompt) => void)[]} answers
 */
function answering(prompt, answers) {
  const seen = [];
  prompt.subscribe((state) => {
    if (state.status === ActiveKeyStatus.ASKING) {
      seen.push({ saved: state.saved, error: state.error?.code ?? null });
      const answer = answers.shift();
      globalThis.queueMicrotask(() => (answer === undefined ? prompt.cancel() : answer(prompt)));
    }
  });
  return seen;
}

function wallet({ store = new InMemoryStore(), api = fakeApi().api, prompt = new ActiveKeyPrompt() } = {}) {
  return { keys: new LocalKeyWallet({ vault: vaultOn(store), api, prompt }), store, prompt };
}

/** @param {any} transaction the node's JSON a transfer was broadcast as */
function signerOf(transaction) {
  const { transaction: unsigned, signatures } = fromBroadcastJson(transaction);
  return recoverSignerKeys(transactionDigest(serializeTransaction(unsigned)), signatures)[0];
}

describe("KeyVault", () => {
  it("keeps a secret encrypted with the device key, bound to its name", async () => {
    const store = new InMemoryStore();
    const vault = vaultOn(store);
    assert.deepEqual(await vault.open("posting"), { ok: true, value: null });
    assert.equal((await vault.seal("posting", POSTING.wif)).ok, true);
    assert.ok(!store.read("magic8.keys.posting").value.includes(POSTING.wif), "never stored in clear");
    assert.deepEqual(await vaultOn(store).open("posting"), { ok: true, value: POSTING.wif }, "a new page reads it back");
    store.write("magic8.keys.other", store.read("magic8.keys.posting").value);
    assert.equal((await vault.open("other")).ok, false, "a blob moved under another name does not open");
    vault.remove("posting");
    assert.equal(vault.has("posting"), false);
  });

  it("never replaces a device key it cannot read, and makes none just to open a secret", async () => {
    const inner = new InMemoryStore();
    await vaultOn(inner).seal("posting", POSTING.wif);
    const device = inner.read("magic8.keys.device").value;
    const { store, failing } = hiccupStore(inner);
    const opened = await vaultOn(store).open("posting");
    assert.equal(opened.error.code, "KEY_STORAGE", "unreadable now, not gone");
    assert.equal(inner.read("magic8.keys.device").value, device, "the device key is the same one");
    failing.device = false;
    assert.deepEqual(await vaultOn(store).open("posting"), { ok: true, value: POSTING.wif }, "readable again: the secret opens");

    const orphan = new InMemoryStore();
    orphan.write("magic8.keys.posting", inner.read("magic8.keys.posting").value);
    assert.equal((await vaultOn(orphan).open("posting")).error.code, "KEY_DAMAGED", "its device key is gone: it can never open");
    assert.equal(orphan.read("magic8.keys.device").value, null, "no device key made by opening");
  });

  it("keeps a secret under a PIN that is never stored", async () => {
    const store = new InMemoryStore();
    const vault = vaultOn(store);
    await vault.sealWithPin("active.alice", ACTIVE.wif, "correct horse");
    assert.equal(vault.needsPin("active.alice"), true);
    assert.ok(!store.read("magic8.keys.active.alice").value.includes("correct horse"));
    assert.deepEqual(await vault.openWithPin("active.alice", "correct horse"), { ok: true, value: ACTIVE.wif });
    assert.equal((await vault.openWithPin("active.alice", "wrong horse")).error.code, "KEY_WRONG_PIN");
    assert.equal((await vault.open("active.alice")).error.code, "KEY_WRONG_PIN", "the device key alone does not open it");
  });
});

describe("LocalKeyWallet: the posting key", () => {
  it("accepts a posting key, signs like Keychain with it, and loads it again on the next visit once saved", async () => {
    const { keys, store } = wallet();
    assert.deepEqual(await keys.usePostingKey("alice", ` ${POSTING.wif} `), { ok: true, value: undefined });
    assert.equal(keys.account, "alice");
    const signed = await keys.signMessage({ account: "alice", message: "login", keyRole: "Posting" });
    assert.equal(recoverSigner("login", signed.value), POSTING.publicKey);
    assert.equal((await keys.signMessage({ account: "alice", message: "x", keyRole: "Active" })).ok, false, "never as another role");
    assert.equal((await keys.signMessage({ account: "bob", message: "x", keyRole: "Posting" })).error.code, "WALLET_NOT_INSTALLED");

    assert.equal(await wallet({ store }).keys.restore(), null, "nothing is saved before save()");
    await keys.save();
    const next = wallet({ store }).keys;
    assert.equal(await next.restore(), "alice");
    assert.equal(next.isAvailable(), true);
    next.forget();
    assert.equal(await wallet({ store }).keys.restore(), null, "forgotten for good");
  });

  it("refuses what is not a posting key of the account, and says what it is", async () => {
    const { keys } = wallet();
    const refusal = async (account, text) => (await keys.usePostingKey(account, text)).error;
    assert.equal((await refusal("alice", ACTIVE.wif)).code, "KEY_TOO_POWERFUL", "an active key is never kept unprotected");
    assert.equal((await refusal("alice", STRANGER.wif)).code, "KEY_NOT_AUTHORIZED");
    assert.match((await refusal("alice", POSTING.publicKey)).message, /public key/);
    assert.match((await refusal("alice", "P5Kmasterpassword")).message, /master password/);
    assert.equal((await refusal("alice", "hello")).code, "KEY_INVALID");
    assert.equal((await refusal("nobody", POSTING.wif)).code, "NOT_FOUND");
    assert.equal(keys.account, null);
  });

  it("keeps a saved key the storage could not hand over now, for the next start", async () => {
    const inner = new InMemoryStore();
    const { keys } = wallet({ store: inner });
    await keys.usePostingKey("alice", POSTING.wif);
    await keys.save();
    const { store, failing } = hiccupStore(inner);
    assert.equal(await wallet({ store }).keys.restore(), null);
    assert.notEqual(inner.read("magic8.keys.posting").value, null, "still saved");
    failing.device = false;
    assert.equal(await wallet({ store }).keys.restore(), "alice");
  });

  it("drops a saved entry it cannot read", async () => {
    const store = new InMemoryStore();
    store.write("magic8.keys.posting", '{"v":1,"iv":"AAAA","data":"AAAA"}');
    assert.equal(await wallet({ store }).keys.restore(), null);
    assert.equal(store.read("magic8.keys.posting").value, null);
  });
});

describe("LocalKeyWallet: transfers with the active key", () => {
  async function signedIn(options = {}) {
    const setup = wallet(options);
    await setup.keys.usePostingKey("alice", POSTING.wif);
    return setup;
  }

  it("asks for the active key until a right one is given, signs exactly the payment with it, then keeps it for the visit", async () => {
    const server = fakeApi();
    const { keys, prompt } = await signedIn({ api: server.api });
    const seen = answering(prompt, [(p) => p.submitKey(POSTING.wif, ""), (p) => p.submitKey(ACTIVE.wif, "123"), (p) => p.submitKey(ACTIVE.wif, "")]);
    const paid = await keys.requestTransfer(PAYMENT);
    assert.deepEqual(seen, [
      { saved: false, error: null },
      { saved: false, error: "KEY_NOT_AUTHORIZED" },
      { saved: false, error: "KEY_WEAK_PIN" },
    ]);
    assert.equal(prompt.state.status, ActiveKeyStatus.IDLE);
    const [transaction] = server.broadcasts;
    assert.deepEqual(transaction.operations, [["transfer", { from: "alice", to: "m8tcg-shop", amount: "1.500 STEEM", memo: "order 42" }]]);
    assert.equal(transaction.expiration, "2026-10-03T10:01:00", "a minute after the referenced block");
    assert.equal(signerOf(transaction), ACTIVE.publicKey);
    assert.deepEqual(paid, { ok: true, value: transactionId(serializeTransaction(fromBroadcastJson(transaction).transaction)) });

    assert.equal((await keys.requestTransfer(PAYMENT)).ok, true);
    assert.equal(seen.length, 3, "not asked again while the page is open");
  });

  it("saves the active key under a PIN, never unlocks it by itself, and opens it with the PIN on the next visit", async () => {
    const store = new InMemoryStore();
    const first = await signedIn({ store });
    answering(first.prompt, [(p) => p.submitKey(ACTIVE.wif, "123456")]);
    assert.equal((await first.keys.requestTransfer(PAYMENT)).ok, true);

    const server = fakeApi();
    const next = wallet({ store, api: server.api });
    await next.keys.restore();
    const seen = answering(next.prompt, [(p) => p.submitPin("654321"), (p) => p.submitPin("123456")]);
    assert.equal((await next.keys.requestTransfer(PAYMENT)).ok, true);
    assert.deepEqual(seen, [
      { saved: true, error: null },
      { saved: true, error: "KEY_WRONG_PIN" },
    ]);
    assert.equal(signerOf(server.broadcasts[0]), ACTIVE.publicKey);

    const forgetful = wallet({ store });
    await forgetful.keys.restore();
    const asked = answering(forgetful.prompt, [(p) => p.forgetSaved(), (p) => p.submitKey(ACTIVE.wif, "")]);
    assert.equal((await forgetful.keys.requestTransfer(PAYMENT)).ok, true);
    assert.deepEqual(asked, [
      { saved: true, error: null },
      { saved: false, error: null },
    ], "another key: the saved one is forgotten");
  });

  it("sends nothing when the player cancels or the chain cannot be read", async () => {
    const server = fakeApi({ reference: () => fail("CHAIN_UNAVAILABLE", "down") });
    const { keys, prompt } = await signedIn({ api: server.api });
    answering(prompt, [(p) => p.cancel(), (p) => p.submitKey(ACTIVE.wif, "")]);
    assert.equal((await keys.requestTransfer(PAYMENT)).error.code, "WALLET_REJECTED");
    assert.equal((await keys.requestTransfer(PAYMENT)).error.code, "WALLET_UNAVAILABLE");
    assert.equal((await keys.requestTransfer({ ...PAYMENT, amount: "1.5" })).error.code, "WALLET_BAD_RESPONSE");
    assert.equal(server.broadcasts.length, 0);
  });

  it("tells a refusal by the chain from a transfer that may still go through", async () => {
    let answer = fail("TRANSFER_REJECTED", "missing required active authority");
    const server = fakeApi({ broadcast: () => answer });
    const { keys, prompt } = await signedIn({ api: server.api });
    const seen = answering(prompt, [(p) => p.submitKey(ACTIVE.wif, ""), (p) => p.submitKey(ACTIVE.wif, "")]);
    const refused = await keys.requestTransfer(PAYMENT);
    assert.equal(refused.error.code, "WALLET_REJECTED");
    assert.match(refused.error.message, /chain refused the transfer: missing required active authority/);
    answer = fail("NETWORK", "the game server could not be reached");
    const unsure = await keys.requestTransfer(PAYMENT);
    assert.equal(unsure.error.code, "WALLET_TIMEOUT");
    assert.match(unsure.error.message, /may still go through/);
    assert.equal(seen.length, 2, "an active key the chain refused is asked for again");
  });
});

describe("HttpWalletApi", () => {
  /** @param {Record<string, { status?: number, body: unknown }>} routes */
  function api(routes) {
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const route = routes[`${init.method} ${url}`];
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
    };
    return { wallet: new HttpWalletApi({ fetch }), requests };
  }

  it("asks for key roles with a public key only, and checks every answer's shape", async () => {
    const { wallet: client, requests } = api({
      "POST /api/auth/key-roles": { body: { roles: ["posting"] } },
      "GET /api/wallet/reference": { body: REFERENCE },
      "POST /api/wallet/transfers": { status: 201, body: { txId: "ab".repeat(20) } },
    });
    assert.deepEqual(await client.keyRoles("alice", POSTING.publicKey), { ok: true, value: ["posting"] });
    assert.deepEqual(requests[0].body, { account: "alice", publicKey: POSTING.publicKey });
    assert.deepEqual(await client.reference(), { ok: true, value: REFERENCE });
    assert.deepEqual(await client.broadcastTransfer({ operations: [] }), { ok: true, value: "ab".repeat(20) });
    assert.deepEqual(requests[2].body, { transaction: { operations: [] } });

    const odd = api({
      "POST /api/auth/key-roles": { body: { roles: ["god"] } },
      "GET /api/wallet/reference": { body: { ...REFERENCE, blockId: "nope" } },
      "POST /api/wallet/transfers": { status: 422, body: { error: { code: "TRANSFER_REJECTED", message: "insufficient funds" } } },
    }).wallet;
    assert.equal((await odd.keyRoles("alice", POSTING.publicKey)).error.code, "BAD_RESPONSE");
    assert.equal((await odd.reference()).error.code, "BAD_RESPONSE");
    assert.deepEqual((await odd.broadcastTransfer({})).error, { code: "TRANSFER_REJECTED", message: "insufficient funds", details: null });
  });
});
