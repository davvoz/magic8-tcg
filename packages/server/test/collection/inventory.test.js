/**
 * InventoryService on PostgreSQL: serials, grants, history and the database
 * invariants behind them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../../src/kernel/AppError.js";
import { uuidV4 } from "../../src/kernel/random.js";
import { DbErrorCode } from "../../src/platform/db/DbError.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const PRINTING = Object.freeze({ edition: "core-1" });

/** A user row to own cards (users are created by sign-in in real life). */
async function userIn(setup, account) {
  return setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
}

describe("InventoryService.mint", () => {
  it("numbers copies per printing, consecutively, across mints", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    const bob = await userIn(setup, "bob");
    const first = await setup.app.inventory.mint({ ownerId: alice.id, items: [{ definitionId: "ember_imp", count: 3 }, { definitionId: "arcane_apprentice", count: 1 }], ...PRINTING, origin: { kind: "grant", ref: "test:1" } });
    const second = await setup.app.inventory.mint({ ownerId: bob.id, items: [{ definitionId: "ember_imp", count: 2 }], ...PRINTING, origin: { kind: "grant", ref: "test:2" } });
    const promo = await setup.app.inventory.mint({ ownerId: bob.id, items: [{ definitionId: "ember_imp", count: 1 }], edition: "promo-1", origin: { kind: "reward", ref: "test:3" } });
    const imps = (instances) => instances.filter((instance) => instance.definitionId === "ember_imp").map((instance) => instance.serial);
    assert.deepEqual(imps(first), [1, 2, 3]);
    assert.deepEqual(imps(second), [4, 5]);
    assert.deepEqual(imps(promo), [1], "another edition has its own numbering");
    assert.equal(new Set([...first, ...second].map((instance) => instance.id)).size, 6);
  });

  it("never hands out the same serial to concurrent mints", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    const mints = await Promise.all([1, 2, 3, 4].map((n) => setup.app.inventory.mint({ ownerId: alice.id, items: [{ definitionId: "ember_imp", count: 5 }], ...PRINTING, origin: { kind: "grant", ref: `test:${n}` } })));
    const serials = mints.flat().map((instance) => instance.serial).sort((a, b) => a - b);
    assert.deepEqual(serials, Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it("refuses requests that callers should never build", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    const origin = { kind: "grant", ref: "test" };
    for (const request of [
      { items: [{ definitionId: "no_such_card", count: 1 }], ...PRINTING, origin },
      { items: [{ definitionId: "ember_imp", count: 0 }], ...PRINTING, origin },
      { items: [{ definitionId: "ember_imp", count: 1 }, { definitionId: "ember_imp", count: 1 }], ...PRINTING, origin },
      { items: [{ definitionId: "ember_imp", count: 501 }], ...PRINTING, origin },
      { items: [{ definitionId: "ember_imp", count: 1 }], edition: "Core 1", origin },
      { items: [{ definitionId: "ember_imp", count: 1 }], ...PRINTING, origin: { kind: "gift", ref: "x" } },
    ]) {
      await assert.rejects(setup.app.inventory.mint({ ownerId: alice.id, ...request }), /InventoryService\.mint/, JSON.stringify(request));
    }
    assert.equal((await setup.database.rows("SELECT id FROM card_instances")).length, 0);
  });
});

describe("InventoryService.grantOnce", () => {
  const starter = (setup, ownerId) => setup.app.inventory.grantOnce({ key: `starter:${ownerId}`, kind: "starter", ownerId, items: [{ definitionId: "ember_imp", count: 2 }], ...PRINTING });

  it("grants once, even when asked concurrently", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    const results = await Promise.all([starter(setup, alice.id), starter(setup, alice.id), starter(setup, alice.id)]);
    assert.deepEqual(results.map((result) => result.granted).sort(), [false, false, true]);
    assert.equal((await setup.database.rows("SELECT id FROM card_instances")).length, 2);
    assert.equal((await starter(setup, alice.id)).granted, false);
    assert.equal(await setup.app.inventory.hasGrant(`starter:${alice.id}`), true);
  });

  it("leaves no grant, card or serial behind when the surrounding work fails", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    await assert.rejects(
      setup.database.transaction(async () => {
        await starter(setup, alice.id);
        throw new Error("a later step failed");
      }),
    );
    assert.equal(await setup.app.inventory.hasGrant(`starter:${alice.id}`), false);
    const granted = await starter(setup, alice.id);
    assert.deepEqual(granted.instances.map((instance) => instance.serial), [1, 2], "serials were rolled back too");
  });
});

describe("reading a collection", () => {
  it("groups copies by card, shows one's own history and hides other players' cards", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    const bob = await userIn(setup, "bob");
    const [copy] = await setup.app.inventory.mint({ ownerId: alice.id, items: [{ definitionId: "ember_imp", count: 2 }, { definitionId: "arcane_apprentice", count: 1 }], ...PRINTING, origin: { kind: "grant", ref: "test:a" } });
    const collection = await setup.app.inventory.collection(alice.id);
    assert.deepEqual(collection.map((entry) => [entry.definitionId, entry.copies.length]), [["arcane_apprentice", 1], ["ember_imp", 2]]);
    assert.deepEqual(Object.fromEntries(await setup.app.inventory.activeCounts(alice.id)), { arcane_apprentice: 1, ember_imp: 2 });

    const detail = await setup.app.inventory.card(alice.id, copy.id);
    assert.deepEqual(detail.history.map((event) => [event.kind, event.toUserId, event.ref]), [["MINTED", alice.id, "test:a"]]);
    for (const [userId, id] of [[bob.id, copy.id], [alice.id, "not-a-uuid"], [alice.id, "00000000-0000-4000-8000-000000000000"]]) {
      await assert.rejects(setup.app.inventory.card(userId, id), (error) => error instanceof AppError && error.code === "NOT_FOUND");
    }
    assert.deepEqual(await setup.app.inventory.collection(bob.id), []);
  });

  it("is backed by database invariants: unique serials, append-only history", async () => {
    const setup = await buildTestApp();
    const alice = await userIn(setup, "alice");
    const [copy] = await setup.app.inventory.mint({ ownerId: alice.id, items: [{ definitionId: "ember_imp", count: 1 }], ...PRINTING, origin: { kind: "grant", ref: "test" } });
    await assert.rejects(
      setup.database.query(
        "INSERT INTO card_instances (id, definition_id, edition, serial, owner_id, origin_kind, origin_ref) VALUES ('00000000-0000-4000-8000-00000000abcd', 'ember_imp', 'core-1', $1, $2, 'grant', 'forged')",
        [copy.serial, alice.id],
      ),
      (error) => error.code === DbErrorCode.UNIQUE_VIOLATION,
    );
    await assert.rejects(setup.database.query("UPDATE card_instance_events SET ref = 'rewritten'"), (error) => error.code === DbErrorCode.FORBIDDEN_MUTATION);
    await assert.rejects(setup.database.query("DELETE FROM card_instance_events"), (error) => error.code === DbErrorCode.FORBIDDEN_MUTATION);
  });
});
