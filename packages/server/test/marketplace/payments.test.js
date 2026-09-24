/**
 * Payments end to end: orders over HTTP, transfers on a fake STEEM chain read
 * by the real STEEM adapter, settlement jobs run by hand. Covers detection,
 * irreversibility, every way a transfer can fail to pay (T5–T8), forks and
 * the payment hint.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { buildTestApp, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const alice = keyPair(1);
const bob = keyPair(2);
const SHOP = "luciojolly";
const MINUTE = 60 * 1000;
let keys = 0;
const newKey = () => `pay-key-${String((keys += 1)).padStart(10, "0")}`;

describe("payments", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  /** @type {ApiClient} */
  let aliceClient;
  /** @type {ApiClient} */
  let bobClient;

  /** Places an order and returns it (as the API shows it). */
  const place = async (client, productId = "core_booster", quantity = 1) => {
    const response = await client.post("/api/orders", { productId, quantity, asset: "STEEM" }, { "Idempotency-Key": newKey() });
    assert.equal(response.status, 201, response.text);
    return response.json.order;
  };
  /** A transfer as Keychain would broadcast it for these instructions, with overrides. */
  const pay = (order, overrides = {}) => setup.ledger.transfer({ from: order.payment.from, to: order.payment.to, amount: `${order.payment.amount} ${order.payment.asset}`, memo: order.payment.memo, time: setup.clock.now(), ...overrides });
  const status = async (client, id) => (await client.get(`/api/orders/${id}`)).json.order.status;
  const settle = async () => {
    await setup.app.settlement.poll("steem");
    return setup.app.settlement.confirm("steem");
  };
  const paymentsOf = (txId) => setup.database.rows("SELECT * FROM payments WHERE tx_id = $1", [txId]);

  before(async () => {
    setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    setup.chain.setAccount("bob", [bob.publicKey]);
    server = await listen(setup.app);
    aliceClient = new ApiClient(server.base);
    await aliceClient.signIn("alice", alice.privateKey);
    bobClient = new ApiClient(server.base);
    await bobClient.signIn("bob", bob.privateKey);
    // An old transfer to the shop from before this server existed.
    setup.ledger.transfer({ from: "carol", to: SHOP, amount: "5.000 STEEM", memo: "old" });
    assert.equal(await setup.app.settlement.poll("steem"), 0, "the first poll only sets the cursor");
  });

  after(() => server.close());

  beforeEach(() => {
    setup.clock.advance(2 * MINUTE);
    setup.ledger.time = setup.clock.now();
  });

  it("detects a correct payment, verifies it only once irreversible, and never counts it twice", async () => {
    const order = await place(aliceClient, "core_booster", 2);
    const { txId } = pay(order);
    assert.deepEqual(await settle(), { verified: 0, refunds: 0, vanished: 0 });
    assert.equal(await status(aliceClient, order.id), "PAYMENT_DETECTED");
    assert.equal((await paymentsOf(txId))[0].status, "DETECTED");

    setup.ledger.finalize();
    assert.deepEqual(await settle(), { verified: 1, refunds: 0, vanished: 0 });
    assert.equal(await status(aliceClient, order.id), "PAYMENT_VERIFIED");
    const [payment] = await paymentsOf(txId);
    assert.equal(payment.status, "APPLIED");
    assert.equal(payment.order_id, order.id);
    assert.equal(payment.amount, 2000);

    assert.deepEqual(await settle(), { verified: 0, refunds: 0, vanished: 0 }, "nothing left to do");
    assert.equal((await paymentsOf(txId)).length, 1);
    const again = await setup.app.payments.record({ network: "steem", txId, opIndex: 0, blockNum: payment.block_num, time: 0, from: "alice", to: SHOP, asset: "STEEM", amount: 2000, memo: order.payment.memo }, { orderId: order.id, problem: null });
    assert.equal(again.isNew, false, "a transfer is recorded once, ever");
    const audit = await setup.database.rows("SELECT action FROM audit_logs WHERE target_id IN ($1, $2) ORDER BY seq", [order.id, payment.id]);
    assert.deepEqual(audit.map((row) => row.action), ["marketplace.order_created", "payments.transfer_detected", "marketplace.payment_verified"]);
  });

  it("queues a refund for every transfer that pays nothing, and leaves the order payable", async () => {
    const order = await place(aliceClient);
    const unknownMemo = await place(bobClient, "single_pyre_drake");
    const wrong = [
      pay(order, { amount: "0.999 STEEM" }),
      pay(order, { amount: "1.000 SBD" }),
      pay(order, { from: "bob" }),
      pay(order, { memo: `${order.payment.memo} ` }),
      pay(unknownMemo, { memo: "m8tcg-aaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      setup.ledger.transfer({ from: "dave", to: SHOP, amount: "0.001 STEEM", memo: "hello" }),
    ];
    await settle();
    const problems = await Promise.all(wrong.map(async ({ txId }) => (await paymentsOf(txId))[0].problem));
    assert.deepEqual(problems, ["WRONG_AMOUNT", "WRONG_ASSET", "WRONG_SENDER", "NO_ORDER", "NO_ORDER", "NO_ORDER"]);
    assert.equal(await status(aliceClient, order.id), "PAYMENT_PENDING", "a wrong transfer does not touch the order");

    setup.ledger.finalize();
    assert.equal((await settle()).refunds, 6);
    const refunds = await setup.app.payments.pendingRefunds();
    const byPayment = new Map(refunds.map((refund) => [refund.paymentId, refund]));
    for (const { txId } of wrong) {
      const [payment] = await paymentsOf(txId);
      assert.equal(payment.status, "REFUND_REQUIRED");
      const refund = byPayment.get(payment.id);
      assert.equal(refund.toAccount, payment.from_account, "back to whoever sent it");
      assert.equal(refund.amount, payment.amount);
      assert.equal(refund.asset, payment.asset);
    }

    pay(order);
    setup.ledger.finalize();
    assert.equal((await settle()).verified, 1, "the right transfer still pays the order");
    await bobClient.post(`/api/orders/${unknownMemo.id}/cancel`, {});
  });

  it("refunds a second payment, a payment for a cancelled order and a late one", async () => {
    const paidTwice = await place(aliceClient);
    const cancelled = await place(aliceClient);
    const late = await place(aliceClient);
    const first = pay(paidTwice);
    const second = pay(paidTwice);
    await aliceClient.post(`/api/orders/${cancelled.id}/cancel`, {});
    const afterCancel = pay(cancelled);
    const tooLate = pay(late, { time: late.payment.expiresAt + 1000 });
    setup.ledger.finalize();
    await settle();
    assert.equal((await paymentsOf(first.txId))[0].status, "APPLIED");
    assert.equal((await paymentsOf(second.txId))[0].problem, "ORDER_NOT_PAYABLE");
    assert.equal((await paymentsOf(afterCancel.txId))[0].problem, "ORDER_NOT_PAYABLE");
    assert.equal((await paymentsOf(tooLate.txId))[0].problem, "LATE", "the block time decides, not when we saw it");
    for (const { txId } of [second, afterCancel, tooLate]) {
      assert.equal((await paymentsOf(txId))[0].status, "REFUND_REQUIRED");
    }
    assert.equal(await status(aliceClient, cancelled.id), "CANCELLED");
    await aliceClient.post(`/api/orders/${late.id}/cancel`, {});
  });

  it("accepts a payment made just in time even if seen after the deadline, and does not expire detected orders", async () => {
    const order = await place(aliceClient);
    const { txId } = pay(order, { time: order.payment.expiresAt - 1000 });
    setup.clock.advance(45 * MINUTE);
    await setup.app.settlement.poll("steem");
    assert.equal((await paymentsOf(txId))[0].problem, null);
    assert.equal(await setup.app.marketplace.expireDue(), 0);
    assert.equal(await status(aliceClient, order.id), "PAYMENT_DETECTED");
    setup.ledger.finalize();
    await setup.app.settlement.confirm("steem");
    assert.equal(await status(aliceClient, order.id), "PAYMENT_VERIFIED");
  });

  it("drops a payment that leaves the chain before it is irreversible; the order waits again", async () => {
    const order = await place(bobClient, "single_pyre_drake");
    const { txId } = pay(order);
    await setup.app.settlement.poll("steem");
    assert.equal(await status(bobClient, order.id), "PAYMENT_DETECTED");
    setup.ledger.drop(txId);
    setup.ledger.finalize();
    assert.deepEqual(await setup.app.settlement.confirm("steem"), { verified: 0, refunds: 0, vanished: 1 });
    assert.equal(await status(bobClient, order.id), "PAYMENT_PENDING");
    const [payment] = await paymentsOf(txId);
    assert.deepEqual([payment.status, payment.problem], ["IGNORED", "VANISHED"]);
    assert.equal((await setup.app.payments.pendingRefunds()).some((refund) => refund.paymentId === payment.id), false, "nothing to refund: it never happened");
    pay(order);
    setup.ledger.finalize();
    assert.equal((await settle()).verified, 1);
  });

  it("looks for the payment sooner on a hint, without trusting the hint", async () => {
    const order = await place(aliceClient, "single_pyre_drake");
    const { txId } = pay(order);
    const hinted = await aliceClient.post(`/api/orders/${order.id}/payment-hint`, { txId });
    assert.equal(hinted.status, 202, hinted.text);
    assert.equal(hinted.json.order.status, "PAYMENT_DETECTED");
    assert.equal(hinted.json.order.payment, null, "no instructions once paid");

    assert.equal((await aliceClient.post(`/api/orders/${order.id}/payment-hint`, { txId: "not-a-tx" })).status, 400);
    assert.equal((await bobClient.post(`/api/orders/${order.id}/payment-hint`, { txId })).status, 404, "someone else's order");
    const bogus = await aliceClient.post(`/api/orders/${order.id}/payment-hint`, { txId: "f".repeat(40) });
    assert.equal(bogus.status, 202, "a made-up id changes nothing");
    assert.equal(bogus.json.order.status, "PAYMENT_DETECTED");
  });
});
