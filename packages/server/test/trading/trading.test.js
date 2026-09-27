/**
 * Card-for-card trades on the real services (docs/tcg/13): the proposer's
 * copies go into escrow with the offer; acceptance swaps both sides at once
 * and queues the public record; decline, cancel and expiry give the copies
 * back; only the right player may act, once; free starter cards can be
 * traded; offers are idempotent and limited.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTradeRecord } from "@magic8/protocol";
import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const PRINTING = Object.freeze({ edition: "core-1" });
const HOUR = 60 * 60 * 1000;

async function world(policy = {}) {
  const setup = await buildTestApp(policy);
  const { app } = setup;
  const inbox = new Map();
  const player = async (account) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    inbox.set(user.id, []);
    app.hub.attach(user.id, { send: (message) => inbox.get(user.id).push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account };
  };
  const bought = async (owner, definitionId, count, kind = "purchase") => app.inventory.mint({ ownerId: owner.id, items: [{ definitionId, count }], ...PRINTING, origin: { kind, ref: `test:${owner.account}:${definitionId}:${kind}` } });
  let keys = 0;
  const offer = (from, request) => app.trading.propose({ proposer: from, idempotencyKey: `offer-key-${String((keys += 1)).padStart(8, "0")}`, ip: "127.0.0.1", ...request });
  const statusOf = async (ids) => (await setup.database.rows("SELECT id, owner_id, status FROM card_instances WHERE id = ANY($1::uuid[]) ORDER BY serial", [ids])).map((row) => [row.owner_id, row.status]);
  return { setup, app, player, bought, offer, statusOf, inbox };
}

describe("trades", () => {
  it("escrows the offered copies, swaps both sides on acceptance, and queues the public record", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const imps = await w.bought(alice, "ember_imp", 2);
    await w.bought(bob, "iron_watcher", 3);
    const created = await w.offer(alice, { to: "bob", give: imps.map((copy) => copy.id), want: [{ definitionId: "iron_watcher", count: 2 }] });
    assert.equal(created.created, true);
    assert.deepEqual([created.trade.status, created.trade.role, created.trade.counterparty], ["OPEN", "proposer", "bob"]);
    assert.deepEqual(await w.statusOf(imps.map((copy) => copy.id)), [[alice.id, "locked"], [alice.id, "locked"]], "in escrow");
    assert.equal((await w.app.inventory.activeCounts(alice.id)).get("ember_imp") ?? 0, 0, "no deck can use them meanwhile");
    assert.ok(w.inbox.get(bob.id).some((message) => message.t === "trade.updated"), "bob is told");

    const [seen] = await w.app.trading.list(bob.id);
    assert.deepEqual([seen.role, seen.proposer, seen.give.length, seen.wants], ["counterparty", "alice", 2, [{ definitionId: "iron_watcher", count: 2 }]]);
    const accepted = await w.app.trading.accept({ userId: bob.id, tradeId: seen.id, ip: "127.0.0.1" });
    assert.equal(accepted.status, "ACCEPTED");
    assert.deepEqual(accepted.take.map((copy) => copy.serial), [2, 3], "the highest serials are picked when bob does not choose");
    assert.deepEqual(await w.statusOf(imps.map((copy) => copy.id)), [[bob.id, "active"], [bob.id, "active"]]);
    assert.deepEqual(await w.statusOf(accepted.take.map((copy) => copy.id)), [[alice.id, "active"], [alice.id, "active"]]);
    const history = await w.setup.database.rows("SELECT kind FROM card_instance_events WHERE card_instance_id = $1 ORDER BY id", [imps[0].id]);
    assert.deepEqual(history.map((row) => row.kind), ["MINTED", "LOCKED", "TRANSFERRED"]);

    const [queued] = await w.setup.database.rows("SELECT payload, status FROM blockchain_events WHERE kind = 'TRADE'");
    const record = parseTradeRecord(queued.payload);
    assert.deepEqual([record.t, record.a.u, record.a.cards.length, record.b.u, record.b.cards.length, queued.status], [seen.id, "alice", 2, "bob", 2, "BUILT"]);
  });

  it("takes the copies the counterparty chooses, and nothing but what was asked", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const [imp] = await w.bought(alice, "ember_imp", 1);
    const watchers = await w.bought(bob, "iron_watcher", 3);
    const { trade } = await w.offer(alice, { to: "bob", give: [imp.id], want: [{ definitionId: "iron_watcher", count: 1 }] });
    await assert.rejects(w.app.trading.accept({ userId: bob.id, tradeId: trade.id, copies: [watchers[0].id, watchers[1].id], ip: "x" }), /not what the offer asks for/);
    assert.deepEqual(await w.statusOf(watchers.map((copy) => copy.id)), watchers.map(() => [bob.id, "active"]), "a refused acceptance changes nothing");
    const done = await w.app.trading.accept({ userId: bob.id, tradeId: trade.id, copies: [watchers[0].id], ip: "x" });
    assert.deepEqual(done.take.map((copy) => copy.serial), [1], "bob kept his better serials");

    const [lonely] = await w.bought(alice, "ember_imp", 1);
    const askable = await w.app.trading.tradeableOf({ userId: alice.id, account: "bob" });
    assert.deepEqual([...askable].sort((left, right) => left.definitionId.localeCompare(right.definitionId)), [{ definitionId: "ember_imp", count: 1 }, { definitionId: "iron_watcher", count: 2 }], "what alice may ask bob for");
    await assert.rejects(w.app.trading.tradeableOf({ userId: alice.id, account: "alice" }), /another player/);
    await assert.rejects(w.offer(alice, { to: "bob", give: [lonely.id], want: [{ definitionId: "iron_watcher", count: 3 }] }), /@bob has 2 tradeable iron_watcher, the offer asks for 3/);
    await assert.rejects(w.offer(alice, { to: "bob", give: [lonely.id], want: [{ definitionId: "arcane_apprentice", count: 1 }] }), /@bob has 0 tradeable arcane_apprentice/);
    const second = await w.offer(alice, { to: "bob", give: [lonely.id], want: [{ definitionId: "iron_watcher", count: 2 }] });
    await w.offer(bob, { to: "alice", give: [watchers[1].id], want: [] });
    await assert.rejects(w.app.trading.accept({ userId: bob.id, tradeId: second.trade.id, ip: "x" }), /you have 1 tradeable iron_watcher, the offer asks for 2/, "bob offered one elsewhere meanwhile");
    assert.equal((await w.app.trading.list(alice.id)).find((row) => row.id === second.trade.id).status, "OPEN", "still open");
  });

  it("gives the copies back on decline, cancel and expiry, and lets only the right player act, once", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const carol = await w.player("carol");
    const imps = await w.bought(alice, "ember_imp", 3);
    const gift = (index) => w.offer(alice, { to: "bob", give: [imps[index].id], want: [] });
    const declined = (await gift(0)).trade;
    await assert.rejects(w.app.trading.decline({ userId: alice.id, tradeId: declined.id, ip: "x" }), /no such trade/, "the proposer cannot decline");
    await assert.rejects(w.app.trading.accept({ userId: carol.id, tradeId: declined.id, ip: "x" }), /no such trade/, "nor can a stranger accept");
    assert.equal((await w.app.trading.decline({ userId: bob.id, tradeId: declined.id, ip: "x" })).status, "DECLINED");
    await assert.rejects(w.app.trading.accept({ userId: bob.id, tradeId: declined.id, ip: "x" }), /already declined/);

    const cancelled = (await gift(1)).trade;
    await assert.rejects(w.app.trading.cancel({ userId: bob.id, tradeId: cancelled.id, ip: "x" }), /no such trade/);
    assert.equal((await w.app.trading.cancel({ userId: alice.id, tradeId: cancelled.id, ip: "x" })).status, "CANCELLED");

    const expiring = (await gift(2)).trade;
    w.setup.clock.advance(72 * HOUR);
    await assert.rejects(w.app.trading.accept({ userId: bob.id, tradeId: expiring.id, ip: "x" }), /expired/);
    assert.equal(await w.app.trading.expireDue(), 1);
    assert.equal((await w.app.trading.list(alice.id)).find((row) => row.id === expiring.id).status, "EXPIRED");
    assert.deepEqual(await w.statusOf(imps.map((copy) => copy.id)), imps.map(() => [alice.id, "active"]), "every copy is back");
  });

  it("trades free starter cards, refuses copies already in a trade, self-trades and strangers, and limits open offers", async () => {
    const w = await world();
    const alice = await w.player("alice");
    await w.player("bob");
    const [starter] = await w.bought(alice, "ember_imp", 1, "grant");
    await w.offer(alice, { to: "bob", give: [starter.id], want: [] });
    const [imp] = await w.bought(alice, "ember_imp", 1);
    await w.offer(alice, { to: "bob", give: [imp.id], want: [] });
    await assert.rejects(w.offer(alice, { to: "bob", give: [imp.id], want: [] }), /not one of your tradeable copies/, "already in escrow");
    await assert.rejects(w.offer(alice, { to: "alice", give: [imp.id], want: [] }), /another player/);
    await assert.rejects(w.offer(alice, { to: "nobody", give: [imp.id], want: [] }), /another player/);
    await assert.rejects(w.offer(alice, { to: "bob", give: [imp.id], want: [{ definitionId: "no_such_card", count: 1 }] }), /no such card/);
    await assert.rejects(w.offer(alice, { to: "bob", give: [], want: [] }), /give/);
    const others = await w.bought(alice, "arcane_apprentice", 10);
    for (const copy of others.slice(0, 8)) {
      await w.offer(alice, { to: "bob", give: [copy.id], want: [] });
    }
    await assert.rejects(w.offer(alice, { to: "bob", give: [others[8].id], want: [] }), /at most 10 open offers/);
  });

  it("answers a repeated offer with the same trade, and settles racing acceptances once", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const [imp] = await w.bought(alice, "ember_imp", 1);
    await w.bought(bob, "iron_watcher", 2);
    const request = { proposer: alice, to: "bob", give: [imp.id], want: [{ definitionId: "iron_watcher", count: 1 }], idempotencyKey: "same-key-0000000001", ip: "x" };
    const first = await w.app.trading.propose(request);
    const again = await w.app.trading.propose(request);
    assert.deepEqual([again.created, again.trade.id], [false, first.trade.id]);
    await assert.rejects(w.app.trading.propose({ ...request, want: [] }), /used for a different offer/);
    await assert.rejects(w.app.trading.propose({ ...request, idempotencyKey: null }), /Idempotency-Key/);

    const results = await Promise.allSettled([1, 2].map(() => w.app.trading.accept({ userId: bob.id, tradeId: first.trade.id, ip: "x" })));
    assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    assert.match(results.find((result) => result.status === "rejected").reason.message, /already accepted/);
    assert.equal((await w.setup.database.rows("SELECT * FROM trade_items WHERE side = 'take'")).length, 1, "bob gave one copy, once");
  });

  it("serves a player's trades over HTTP", async () => {
    const w = await world();
    const keys = keyPair(41);
    w.setup.chain.setAccount("alice", [keys.publicKey]);
    const bob = await w.player("bob");
    await w.bought(bob, "iron_watcher", 2);
    const server = await listen(w.app);
    try {
      const client = new ApiClient(server.base);
      await client.signIn("alice", keys.privateKey);
      const alice = { id: (await w.setup.users.findOrCreate({ network: "steem", account: "alice" }, 0, uuidV4(deterministicRandom("unused")))).id, account: "alice" };
      const [imp] = await w.bought(alice, "ember_imp", 1);
      assert.equal((await client.post("/api/trades", { to: "bob", give: [imp.id], want: [] })).status, 428, "an Idempotency-Key is required");
      const created = await client.post("/api/trades", { to: "bob", give: [imp.id], want: [] }, { "Idempotency-Key": "http-offer-00000001" });
      assert.equal(created.status, 201);
      assert.equal((await client.get("/api/trades")).json.trades[0].id, created.json.trade.id);
      assert.equal((await client.post(`/api/trades/${created.json.trade.id}/cancel`, {})).json.trade.status, "CANCELLED");
      assert.equal((await client.post("/api/trades/not-a-trade/accept", {})).status, 404);
      assert.deepEqual((await client.get("/api/trades/tradeable/bob")).json.cards, [{ definitionId: "iron_watcher", count: 2 }]);
      assert.equal((await client.get("/api/trades/tradeable/nobody")).status, 400);
    } finally {
      await server.close();
    }
  });
});
