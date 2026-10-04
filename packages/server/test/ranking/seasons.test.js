/**
 * The season calendar on the real services: copied from the data file once,
 * then changed by operators. An upcoming season changes freely, a running
 * one only its name and its end, an ended one never; every change keeps the
 * calendar valid (order, ends, prize pools), is audited, reaches the ranking
 * and jackpot services at once and every process through the database.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildTestApp, bundledContent, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const SHOP = "verdu.green";
const OPERATOR = { userId: null, ip: "127.0.0.1" };

/** Lets an in-process NOTIFY, and the work it starts, run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 30));
const at = (iso) => Date.parse(iso);

/** A season as the services take it. */
const season = (fields) => ({ endsAt: null, prizePool: null, entryFee: 1, ...fields });

describe("season calendar", () => {
  it("starts from the data file's seasons, once", async () => {
    const first = await buildTestApp();
    assert.deepEqual(first.app.seasons.seasons.map((candidate) => candidate.id), ["2026-s1", "season-1"]);
    const view = first.app.seasons.view();
    assert.deepEqual(view.pools, ["bank-jackpot"]);
    assert.deepEqual(
      view.seasons.map((candidate) => [candidate.id, candidate.phase, candidate.endsAt, candidate.end]),
      [
        ["2026-s1", "running", null, "2026-10-08T00:00:00Z"],
        ["season-1", "upcoming", "2026-11-05T00:00:00Z", "2026-11-05T00:00:00Z"],
      ],
      "a season without an end ends when the next starts",
    );

    await first.app.seasons.update(OPERATOR, season({ id: "season-1", name: "Season One", startsAt: at("2026-10-10T00:00:00Z"), endsAt: at("2026-11-10T00:00:00Z"), prizePool: "bank-jackpot" }));
    const restarted = await buildTestApp({ database: first.database, clock: first.clock, random: deterministicRandom("restart") });
    const reread = restarted.app.seasons.seasons.find((candidate) => candidate.id === "season-1");
    assert.deepEqual([reread?.name, reread?.startsAt], ["Season One", at("2026-10-10T00:00:00Z")], "the database wins over the file");
  });

  it("changes an upcoming season freely and a running one only by name and end, never an ended one", async () => {
    const setup = await buildTestApp();
    const { seasons, ranking, jackpot } = setup.app;

    await seasons.create(OPERATOR, season({ id: "season-2", name: "Season 2", startsAt: at("2026-11-10T00:00:00Z"), endsAt: at("2026-12-10T00:00:00Z"), entryFee: 2 }));
    assert.deepEqual(seasons.seasons.map((candidate) => candidate.id), ["2026-s1", "season-1", "season-2"]);
    await assert.rejects(seasons.create(OPERATOR, season({ id: "season-2", name: "Again", startsAt: at("2027-01-01T00:00:00Z") })), /already exists/);
    await assert.rejects(seasons.create(OPERATOR, season({ id: "past", name: "Past", startsAt: at("2026-09-20T00:00:00Z") })), /must start in the future/);
    await assert.rejects(seasons.create(OPERATOR, season({ id: "overlap", name: "Overlap", startsAt: at("2026-11-01T00:00:00Z") })), /no later than the next season's start/, "season-1 ends on 5 November");
    await assert.rejects(seasons.create(OPERATOR, season({ id: "pool", name: "Pool", startsAt: at("2027-01-01T00:00:00Z"), endsAt: at("2027-02-01T00:00:00Z"), prizePool: "nope" })), /no prize pool "nope"/);
    await assert.rejects(seasons.create(OPERATOR, season({ id: "open", name: "Open", startsAt: at("2027-01-01T00:00:00Z"), prizePool: "bank-jackpot" })), /needs an end/);

    // Upcoming: anything, and the jackpot follows.
    await seasons.update(OPERATOR, season({ id: "season-1", name: "Season 1", startsAt: at("2026-10-08T00:00:00Z"), endsAt: at("2026-11-08T00:00:00Z"), prizePool: "bank-jackpot", entryFee: 3 }));
    assert.equal((await jackpot.view()).season.endsAt, at("2026-11-08T00:00:00Z"));

    // Running: name and end only, the end in the future.
    const beta = { id: "2026-s1", startsAt: at("2026-09-01T00:00:00Z") };
    await assert.rejects(seasons.update(OPERATOR, season({ ...beta, name: "Beta", entryFee: 2 })), /only its name and its end/);
    await assert.rejects(seasons.update(OPERATOR, season({ ...beta, name: "Beta", startsAt: at("2026-09-02T00:00:00Z") })), /only its name and its end/);
    await assert.rejects(seasons.update(OPERATOR, season({ ...beta, name: "Beta", endsAt: at("2026-09-24T09:00:00Z") })), /end in the future/);
    await assert.rejects(seasons.remove(OPERATOR, "2026-s1"), /cannot be deleted/);
    await seasons.update(OPERATOR, season({ ...beta, name: "Beta (short)", endsAt: at("2026-10-01T00:00:00Z") }));
    assert.deepEqual([ranking.currentSeason()?.name, ranking.entryFeeOf("ranked")?.count], ["Beta (short)", 1]);

    await seasons.remove(OPERATOR, "season-2");
    await assert.rejects(seasons.remove(OPERATOR, "season-2"), /no season with this id/);

    // Ended: nothing; and no season runs until the next starts.
    setup.clock.advance(at("2026-10-02T00:00:00Z") - setup.clock.now());
    assert.equal(ranking.currentSeason(), null);
    await assert.rejects(seasons.update(OPERATOR, season({ ...beta, name: "Renamed", endsAt: at("2026-10-01T00:00:00Z") })), /has ended cannot change/);

    const audited = await setup.database.rows("SELECT action, target_id FROM audit_logs WHERE action LIKE 'admin.season%' ORDER BY seq");
    assert.deepEqual(audited.map((row) => [row.action, row.target_id]), [
      ["admin.season_created", "season-2"],
      ["admin.season_changed", "season-1"],
      ["admin.season_changed", "2026-s1"],
      ["admin.season_deleted", "season-2"],
    ]);
  });

  it("keeps at least one season, so a restart never copies the file again", async () => {
    const bundled = await bundledContent();
    const setup = await buildTestApp({ content: { ...bundled, ranked: { ...bundled.ranked, seasons: [{ id: "later", name: "Later", startsAt: "2030-01-01T00:00:00Z" }] } } });
    await assert.rejects(setup.app.seasons.remove(OPERATOR, "later"), /at least one season/);
  });

  it("reaches every process through the database", async () => {
    const first = await buildTestApp();
    const stop = await first.app.seasons.start();
    const second = await buildTestApp({ database: first.database, clock: first.clock, random: deterministicRandom("second process") });
    await second.app.seasons.create(OPERATOR, season({ id: "season-2", name: "Season 2", startsAt: at("2026-12-01T00:00:00Z") }));
    await settled();
    assert.deepEqual(first.app.seasons.seasons.map((candidate) => candidate.id), ["2026-s1", "season-1", "season-2"]);
    await stop();
  });

  describe("over HTTP", () => {
    /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
    let setup;
    /** @type {{ base: string, close: () => Promise<unknown> }} */
    let server;
    /** @type {ApiClient} */
    let operator;
    /** @type {ApiClient} */
    let alice;
    const operatorKeys = keyPair(7);
    const aliceKeys = keyPair(1);

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

    it("lets only operators read and change the calendar", async () => {
      const created = { id: "season-2", name: "Season 2", startsAt: "2026-12-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z", prizePool: "bank-jackpot", entryFee: 1 };
      assert.equal((await new ApiClient(server.base).get("/api/admin/seasons")).status, 401);
      assert.equal((await alice.get("/api/admin/seasons")).status, 403);
      assert.equal((await alice.post("/api/admin/seasons", created)).status, 403);

      const listed = await operator.get("/api/admin/seasons");
      assert.equal(listed.status, 200);
      assert.deepEqual([listed.json.now, listed.json.pools, listed.json.seasons.length], ["2026-09-24T10:00:00Z", ["bank-jackpot"], 2]);

      assert.equal((await operator.post("/api/admin/seasons", { ...created, startsAt: "2026-12-01" })).status, 400);
      assert.equal((await operator.post("/api/admin/seasons", { ...created, colour: "red" })).status, 400);
      const added = await operator.post("/api/admin/seasons", created);
      assert.equal(added.status, 201);
      assert.deepEqual(added.json.seasons.at(-1), { ...created, end: created.endsAt, phase: "upcoming" });

      const fields = { name: created.name, startsAt: created.startsAt, endsAt: created.endsAt, prizePool: created.prizePool, entryFee: created.entryFee };
      assert.equal((await operator.request("PUT", "/api/admin/seasons/season-2", created)).status, 400, "the id is in the path");
      assert.equal((await operator.request("PUT", "/api/admin/seasons/nope", fields)).status, 404);
      const changed = await operator.request("PUT", "/api/admin/seasons/season-2", { ...fields, name: "Winter", endsAt: null, prizePool: null });
      assert.equal(changed.status, 200);
      assert.deepEqual(changed.json.seasons.at(-1), { ...created, name: "Winter", endsAt: null, end: null, prizePool: null, phase: "upcoming" });
      assert.equal((await operator.request("PUT", "/api/admin/seasons/2026-s1", { name: "Beta", startsAt: "2026-09-01T00:00:00Z", entryFee: 5 })).status, 409);

      assert.equal((await operator.delete("/api/admin/seasons/season-2")).status, 200);
      assert.equal((await operator.delete("/api/admin/seasons/2026-s1")).status, 409);
      assert.deepEqual(setup.app.seasons.seasons.map((candidate) => candidate.id), ["2026-s1", "season-1"]);
    });
  });
});
