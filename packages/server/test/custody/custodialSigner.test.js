/**
 * What the server signs for the accounts it keeps (docs/tcg/29-google.md),
 * over real HTTP: a transfer only when it pays exactly an open payment of
 * the player, once; a game's session key; a ping through the pings' own
 * checks. Only for a Google session. The chain is the fake behind the real
 * STEEM wallet provider, which relays what was signed.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { fromBroadcastJson, recoverSigner, recoverSignerKeys, serializeTransaction, transactionDigest } from "@magic8/steem";
import { buildTestApp, keyPair, listen, toWif } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const MINUTE = 60 * 1000;
const GAME_ID = "01jbz3k8q9w2x4y5z6a7b8c9d0";
const SESSION_KEY = `04${"ab".repeat(64)}`;
const PRINTING = Object.freeze({ edition: "core-1" });
let keys = 0;
const newKey = () => `custody-key-${String((keys += 1)).padStart(8, "0")}`;

/** @param {unknown} json a broadcast transaction */
function signerOf(json) {
  const { transaction, signatures } = fromBroadcastJson(json);
  return { operation: transaction.operations[0], signer: recoverSignerKeys(transactionDigest(serializeTransaction(transaction)), signatures)[0] };
}

describe("the wallet kept by the server", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  const walls = [{ author: "micro.cur8", permlink: "wall-today" }];
  const alice = keyPair(1);
  /** @type {ApiClient} */
  let aliceClient;
  /** @type {{ id: string }} */
  let aliceUser;
  /** @type {Awaited<ReturnType<typeof keptPlayer>>} */
  let newbie;

  /**
   * An account the server keeps, signed in with Google.
   * @param {string} account
   * @param {number} seed
   */
  async function keptPlayer(account, seed) {
    const [owner, active, posting, memo] = [0, 1, 2, 3].map((offset) => keyPair(seed + offset));
    setup.chain.setAccount(account, [posting.publicKey], { activeKeys: [active.publicKey] });
    const session = await setup.app.auth.openVouchedSession({ network: "steem", account, publicKey: posting.publicKey, method: "google", ip: "x" });
    await setup.app.custody.keep({ userId: session.user.id, network: "steem", account, keys: { masterPassword: "P5master", owner: toWif(owner.privateKey), active: toWif(active.privateKey), posting: toWif(posting.privateKey), memo: toWif(memo.privateKey) } });
    const client = new ApiClient(server.base);
    client.useSession(session.token);
    return { client, user: session.user, active, posting };
  }

  /** @param {ApiClient} client */
  const openOrder = async (client) => {
    const placed = await client.post("/api/orders", { productId: "core_booster", quantity: 1, asset: "STEEM" }, { "Idempotency-Key": newKey() });
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    return placed.json.order;
  };

  /** @param {{ from: string, to: string, amount: string, asset: string, memo: string }} payment */
  const transferOf = ({ from, to, amount, asset, memo }) => ({ from, to, amount, asset, memo });

  before(async () => {
    setup = await buildTestApp({ pingWall: { account: "micro.cur8", latest: async () => walls } });
    setup.chain.setAccount("alice", [alice.publicKey]);
    server = await listen(setup.app);
    aliceClient = new ApiClient(server.base);
    aliceUser = await aliceClient.signIn("alice", alice.privateKey);
    newbie = await keptPlayer("newbie", 200);
  });

  after(() => server.close());

  // Each test starts with full rate budgets.
  beforeEach(() => setup.clock.advance(2 * MINUTE));

  it("pays an open shop order with the active key, once", async () => {
    const order = await openOrder(newbie.client);
    const paid = await newbie.client.post("/api/custody/transfers", transferOf(order.payment));
    assert.equal(paid.status, 201, JSON.stringify(paid.json));
    assert.match(paid.json.txId, /^[0-9a-f]{40}$/);
    const { operation, signer } = signerOf(setup.chain.broadcasts.at(-1).transaction);
    assert.deepEqual(operation, { type: "transfer", from: "newbie", to: order.payment.to, amount: 1000, asset: "STEEM", memo: order.payment.memo });
    assert.equal(signer, newbie.active.publicKey);

    const again = await newbie.client.post("/api/custody/transfers", transferOf(order.payment));
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, "ALREADY_PAID");
    assert.deepEqual(again.json.error.details, { txId: paid.json.txId });
    const audited = await setup.database.rows("SELECT details FROM audit_logs WHERE action = 'custody.transfer_signed'");
    assert.equal(audited.length, 1);
    assert.equal(audited[0].details.txId, paid.json.txId);
  });

  it("pays a reservation of the player market", async () => {
    const [imp] = await setup.app.inventory.mint({ ownerId: aliceUser.id, items: [{ definitionId: "ember_imp", count: 1 }], ...PRINTING, origin: { kind: "pack", ref: "test:custody:imp" } });
    const listed = await aliceClient.post("/api/listings", { copy: imp.id, price: "1.5", asset: "STEEM" }, { "Idempotency-Key": newKey() });
    assert.equal(listed.status, 201, JSON.stringify(listed.json));
    const bought = await newbie.client.post(`/api/listings/${listed.json.listing.id}/buy`, {});
    const { payment } = bought.json.purchase;
    assert.equal(payment.to, "alice");
    const paid = await newbie.client.post("/api/custody/transfers", transferOf(payment));
    assert.equal(paid.status, 201, JSON.stringify(paid.json));
    assert.deepEqual(signerOf(setup.chain.broadcasts.at(-1).transaction).operation, { type: "transfer", from: "newbie", to: "alice", amount: 1500, asset: "STEEM", memo: payment.memo });
  });

  it("signs nothing that is not exactly an open payment of this player", async () => {
    const order = await openOrder(newbie.client);
    const theirs = await openOrder(aliceClient);
    const broadcasts = setup.chain.broadcasts.length;
    for (const transfer of [
      { ...transferOf(order.payment), amount: "0.999" },
      { ...transferOf(order.payment), to: "alice" },
      { ...transferOf(order.payment), asset: "SBD" },
      { ...transferOf(order.payment), memo: "m8tcg-aaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { ...transferOf(theirs.payment), from: "newbie" },
    ]) {
      const refused = await newbie.client.post("/api/custody/transfers", transfer);
      assert.equal(refused.status, 409, JSON.stringify(transfer));
      assert.equal(refused.json.error.code, "PAYMENT_NOT_OPEN");
    }
    const fromSomeoneElse = await newbie.client.post("/api/custody/transfers", { ...transferOf(order.payment), from: "alice" });
    assert.equal(fromSomeoneElse.json.error.code, "PAYMENT_NOT_OPEN");
    setup.clock.advance(order.payment.expiresAt - setup.clock.now() + 1);
    assert.equal((await newbie.client.post("/api/custody/transfers", transferOf(order.payment))).json.error.code, "PAYMENT_NOT_OPEN", "expired");
    assert.equal(setup.chain.broadcasts.length, broadcasts, "nothing was sent");
  });

  it("pays again a transfer the chain refused, but never one whose fate is unknown", async () => {
    const rpc = setup.chain.rpc.call;
    const { RpcError } = await import("@magic8/steem");
    try {
      const refusedOrder = await openOrder(newbie.client);
      setup.chain.rpc.call = async () => {
        throw new RpcError("RPC_ERROR", "condenser_api.broadcast_transaction: missing required active authority");
      };
      const refused = await newbie.client.post("/api/custody/transfers", transferOf(refusedOrder.payment));
      assert.equal(refused.json.error.code, "TRANSFER_REJECTED");
      setup.chain.rpc.call = rpc;
      assert.equal((await newbie.client.post("/api/custody/transfers", transferOf(refusedOrder.payment))).status, 201, "a refused transfer can be paid again");

      const unknownOrder = await openOrder(newbie.client);
      setup.chain.rpc.call = async () => {
        throw new Error("socket hang up");
      };
      const unknown = await newbie.client.post("/api/custody/transfers", transferOf(unknownOrder.payment));
      assert.equal(unknown.status, 503);
      assert.equal(unknown.json.error.code, "CHAIN_UNAVAILABLE");
      assert.match(unknown.json.error.details.txId, /^[0-9a-f]{40}$/);
      setup.chain.rpc.call = rpc;
      const retried = await newbie.client.post("/api/custody/transfers", transferOf(unknownOrder.payment));
      assert.equal(retried.json.error.code, "ALREADY_PAID");
      assert.equal(retried.json.error.details.txId, unknown.json.error.details.txId);
    } finally {
      setup.chain.rpc.call = rpc;
    }
  });

  it("signs a game's session key with the posting key, and no other message", async () => {
    const message = `m8tcg session ${GAME_ID} ${SESSION_KEY}`;
    const signed = await newbie.client.post("/api/custody/messages", { message });
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    assert.equal(recoverSigner(message, signed.json.signature), newbie.posting.publicKey);
    for (const other of ["magic8 login 123", `m8tcg session ${GAME_ID} ${SESSION_KEY} `, `m8tcg session ${GAME_ID} 04zz`, `m8tcg session ../.. ${SESSION_KEY}`]) {
      const refused = await newbie.client.post("/api/custody/messages", { message: other });
      assert.equal(refused.status, 403, other);
    }
  });

  it("publishes a ping signed with the posting key, through the pings' checks", async () => {
    const ping = { parentAuthor: "micro.cur8", parentPermlink: "wall-today", permlink: "kijam-ping-1", title: "", body: "Won a game of KIJAM", jsonMetadata: "{}" };
    const posted = await newbie.client.post("/api/custody/pings", ping);
    assert.equal(posted.status, 201, JSON.stringify(posted.json));
    const { operation, signer } = signerOf(setup.chain.broadcasts.at(-1).transaction);
    assert.equal(operation.type, "comment");
    assert.equal(operation.author, "newbie");
    assert.equal(signer, newbie.posting.publicKey);
    const elsewhere = await newbie.client.post("/api/custody/pings", { ...ping, parentPermlink: "someone-elses-post" });
    assert.equal(elsewhere.status, 400, "only under the wall");
  });

  it("signs nothing for a player who signed in with their own keys, or whose wallet it does not keep", async () => {
    const order = await openOrder(aliceClient);
    const own = await aliceClient.post("/api/custody/transfers", transferOf(order.payment));
    assert.equal(own.status, 403);
    assert.equal((await aliceClient.post("/api/custody/messages", { message: `m8tcg session ${GAME_ID} ${SESSION_KEY}` })).status, 403);

    const posting = keyPair(300);
    setup.chain.setAccount("drifter", [posting.publicKey]);
    const session = await setup.app.auth.openVouchedSession({ network: "steem", account: "drifter", publicKey: posting.publicKey, method: "google", ip: "x" });
    const drifter = new ApiClient(server.base);
    drifter.useSession(session.token);
    assert.equal((await drifter.post("/api/custody/messages", { message: `m8tcg session ${GAME_ID} ${SESSION_KEY}` })).status, 403);
    assert.equal((await new ApiClient(server.base).post("/api/custody/messages", { message: "x" })).status, 401);
  });
});
