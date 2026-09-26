/**
 * Operators over HTTP: only listed accounts get in; refunds are closed by
 * what the chain shows (never by what the operator says), mismatches and
 * double payments are flagged; chain alerts are acknowledged with a note;
 * the audit log is searchable and its hash chain checked.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildTestApp, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const SHOP = "verdu.green";
const operatorKeys = keyPair(7);
const aliceKeys = keyPair(1);

describe("admin", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  /** @type {ApiClient} */
  let operator;
  /** @type {ApiClient} */
  let alice;

  before(async () => {
    setup = await buildTestApp();
    server = await listen(setup.app);
    setup.chain.setAccount(SHOP, [operatorKeys.publicKey]);
    setup.chain.setAccount("alice", [aliceKeys.publicKey]);
    operator = new ApiClient(server.base);
    await operator.signIn(SHOP, operatorKeys.privateKey);
    alice = new ApiClient(server.base);
    await alice.signIn("alice", aliceKeys.privateKey);
  });

  after(() => server.close());

  const settle = async () => {
    await setup.app.settlement.runOnce();
    await setup.app.refunds.runOnce();
  };

  it("lets in only the operator accounts", async () => {
    assert.equal((await new ApiClient(server.base).get("/api/admin/overview")).status, 401);
    assert.equal((await alice.get("/api/admin/overview")).status, 403);
    assert.equal((await alice.post("/api/admin/alerts/1/resolve", { note: "not mine" })).status, 403);
    const overview = await operator.get("/api/admin/overview");
    assert.equal(overview.status, 200);
    assert.equal(overview.json.openAlerts, 0);
    assert.equal(typeof overview.json.runtime.connections, "number");
    assert.equal(overview.json.runtime.broadcasters, null, "no broadcaster keys in this setup");
  });

  it("closes a refund only when the chain shows the exact transfer, and flags anything else", async () => {
    await settle(); // the watchers start after the shop's current history
    const paid = setup.ledger.transfer({ from: "dave", to: SHOP, amount: "1.500 STEEM", memo: "for nothing", time: setup.clock.now() });
    await settle();
    setup.ledger.finalize();
    await settle();
    let [refund] = (await operator.get("/api/admin/refunds")).json.refunds;
    assert.deepEqual([refund.toAccount, refund.asset, refund.amount, refund.status, refund.from], ["dave", "STEEM", 1500, "PENDING", SHOP]);
    assert.equal(refund.memo, `m8tcg refund ${refund.id}`);
    assert.equal(refund.amountText, "1.500", "exactly what Keychain must send");
    assert.ok(paid.txId);

    const sbd = setup.ledger.transfer({ from: "erin", to: SHOP, amount: "2.250 SBD", memo: "oops", time: setup.clock.now() });
    await settle();
    setup.ledger.finalize();
    await settle();
    const refundsNow = (await operator.get("/api/admin/refunds")).json.refunds;
    assert.deepEqual(refundsNow.map((open) => `${open.toAccount} ${open.amountText} ${open.asset}`), ["dave 1.500 STEEM", "erin 2.250 SBD"], "an asset the shop does not accept is still refunded exactly");
    assert.ok(sbd.txId);

    // A wrong amount does not close it.
    setup.ledger.transfer({ from: SHOP, to: "dave", amount: "1.000 STEEM", memo: refund.memo, time: setup.clock.now() });
    await settle();
    assert.equal((await operator.get("/api/admin/refunds")).json.refunds[0].status, "PENDING");

    // The exact transfer: SENT when seen, CONFIRMED once irreversible on two nodes.
    const exact = setup.ledger.transfer({ from: SHOP, to: "dave", amount: "1.500 STEEM", memo: refund.memo, time: setup.clock.now() });
    await settle();
    [refund] = (await operator.get("/api/admin/refunds")).json.refunds;
    assert.deepEqual([refund.status, refund.transfer.txId], ["SENT", exact.txId]);
    setup.ledger.finalize();
    await settle();
    assert.deepEqual((await operator.get("/api/admin/refunds")).json.refunds.map((open) => open.toAccount), ["erin"], "confirmed refunds leave the open list");
    const [row] = await setup.database.rows("SELECT status, refund_tx_id FROM refunds WHERE id = $1", [refund.id]);
    assert.deepEqual([row.status, row.refund_tx_id], ["CONFIRMED", exact.txId]);

    // Paying it again is flagged.
    setup.ledger.transfer({ from: SHOP, to: "dave", amount: "1.500 STEEM", memo: refund.memo, time: setup.clock.now() });
    await settle();
    const flagged = (await operator.get(`/api/admin/audit?target=${refund.id}`)).json.entries.map((entry) => entry.action);
    assert.deepEqual(flagged, ["payments.refund_paid_twice", "payments.refund_confirmed", "payments.refund_sent", "payments.refund_mismatch"]);
    assert.ok(setup.logger.entries.some((entry) => entry.level === "error" && entry.message.includes("refund_paid_twice")));
  });

  it("acknowledges a chain alert with a note, once, and audits who did it", async () => {
    await setup.database.query("INSERT INTO chain_alerts (network, kind, fingerprint, details) VALUES ('steem', 'UNKNOWN_ON_CHAIN', 'tx:0', '{}')");
    const [alert] = (await operator.get("/api/admin/alerts")).json.alerts;
    assert.deepEqual([alert.kind, alert.resolvedAt], ["UNKNOWN_ON_CHAIN", null]);
    assert.equal((await operator.get("/api/admin/overview")).json.openAlerts, 1);
    assert.equal((await operator.post(`/api/admin/alerts/${alert.id}/resolve`, {})).status, 400, "a note is required");
    const resolved = await operator.post(`/api/admin/alerts/${alert.id}/resolve`, { note: "our key rotated; old tx" });
    assert.equal(resolved.status, 200);
    assert.equal((await operator.post(`/api/admin/alerts/${alert.id}/resolve`, { note: "again" })).status, 404);
    const [entry] = (await operator.get("/api/admin/audit?action=admin.")).json.entries;
    assert.deepEqual([entry.action, entry.actorKind, entry.details.note], ["admin.alert_resolved", "admin", "our key rotated; old tx"]);
    assert.equal((await operator.get("/api/admin/audit?action=bad%20value")).status, 400);
  });

  it("checks the audit log's hash chain", async () => {
    assert.deepEqual((await operator.get("/api/admin/audit/verify")).json, { intact: true, firstBrokenSeq: null });
  });
});
