import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHAIN_WAIT_MS, ChainPhase, PURCHASE_STEP_COUNT, PurchaseStep, TrackStage, isArriving, purchaseProgress } from "../../src/application/payments/purchaseProgress.js";
import { OrderStatus } from "../../src/application/ports/MarketApi.contract.js";
import { SalePurchaseStatus } from "../../src/application/ports/SalesApi.contract.js";
import { BuyStage, buyingTrack } from "../../src/application/sales/SalesService.js";
import { PurchaseStage, shopTrack } from "../../src/application/shop/ShopService.js";

const PAID_AT = 1_000_000;
const PAYMENT = { network: "steem", from: "alice", to: "verdu.green", asset: "STEEM", amount: "1.000", memo: "m", expiresAt: 1 };
const order = (stage, { status = OrderStatus.PAYMENT_PENDING, paidAt = PAID_AT } = {}) => ({ stage, order: { status, payment: PAYMENT }, txId: null, paidAt, error: null, cart: null });
const shopProgress = (stage, options, nowMs = PAID_AT) => purchaseProgress(shopTrack(order(stage, options)), nowMs);

describe("purchaseProgress", () => {
  it("names the step under way: the order, the payment, the blockchain, then all done", () => {
    assert.equal(shopProgress(PurchaseStage.ORDERING)?.step, PurchaseStep.ORDER);
    assert.equal(shopProgress(PurchaseStage.SIGNING)?.step, PurchaseStep.PAYMENT);
    assert.equal(shopProgress(PurchaseStage.CONFIRMING)?.step, PurchaseStep.CHAIN);
    assert.equal(shopProgress(PurchaseStage.DONE)?.step, PURCHASE_STEP_COUNT);
    assert.equal(shopProgress(PurchaseStage.FAILED), null);
    assert.equal(shopProgress(PurchaseStage.NONE), null);
    assert.equal(shopProgress(PurchaseStage.SIGNING)?.chain, null, "no wait before the payment is sent");
  });

  it("fills the blockchain's wait with the time since the payment, and counts down what is left", () => {
    assert.deepEqual(shopProgress(PurchaseStage.CONFIRMING)?.chain, { phase: ChainPhase.WAITING, share: 0, leftMs: CHAIN_WAIT_MS });
    const half = shopProgress(PurchaseStage.CONFIRMING, {}, PAID_AT + CHAIN_WAIT_MS / 2)?.chain;
    assert.equal(half?.leftMs, CHAIN_WAIT_MS / 2);
    assert.ok(half !== undefined && half !== null && half.share > 0.4 && half.share < 0.5, "about half, never quite full on time alone");
  });

  it("moves on with the order: the payment seen on the chain, then final (only the delivery left)", () => {
    const seen = shopProgress(PurchaseStage.CONFIRMING, { status: OrderStatus.PAYMENT_DETECTED }, PAID_AT + 1000);
    assert.equal(seen?.chain?.phase, ChainPhase.SEEN);
    assert.ok((seen?.chain?.share ?? 0) >= 0.1, "seen: under way at once");
    const final = shopProgress(PurchaseStage.CONFIRMING, { status: OrderStatus.PAYMENT_VERIFIED }, PAID_AT + 1000);
    assert.equal(final?.step, PurchaseStep.DELIVERY);
    assert.equal(final?.chain?.phase, ChainPhase.FINAL);
    assert.ok((final?.chain?.share ?? 0) > 0.9);
  });

  it("is late past the usual wait, the bar short of its end until the delivery", () => {
    const late = shopProgress(PurchaseStage.CONFIRMING, { status: OrderStatus.PAYMENT_DETECTED }, PAID_AT + CHAIN_WAIT_MS + 5000)?.chain;
    assert.equal(late?.phase, ChainPhase.LATE);
    assert.equal(late?.leftMs, 0);
    assert.ok((late?.share ?? 1) < 1);
  });

  it("follows a card bought from a player the same way: reserved, paid, seen in the seller's history, delivered", () => {
    const buying = (stage, status = SalePurchaseStatus.PENDING) => ({ stage, purchase: { status, payment: PAYMENT }, paidAt: PAID_AT, error: null });
    assert.equal(buyingTrack(buying(BuyStage.RESERVING))?.stage, TrackStage.ORDER);
    assert.deepEqual(buyingTrack(buying(BuyStage.SIGNING))?.payment, { amount: "1.000", asset: "STEEM", to: "verdu.green" });
    const seen = buyingTrack(buying(BuyStage.CONFIRMING, SalePurchaseStatus.DETECTED));
    assert.equal(purchaseProgress(seen, PAID_AT + 1000)?.chain?.phase, ChainPhase.SEEN);
    assert.equal(isArriving(seen), true, "paid and on its way");
    assert.equal(buyingTrack(buying(BuyStage.DONE))?.stage, TrackStage.DONE);
    assert.equal(buyingTrack(buying(BuyStage.FAILED)), null);
    assert.equal(isArriving(buyingTrack(buying(BuyStage.SIGNING))), false);
  });
});
