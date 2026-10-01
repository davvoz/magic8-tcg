/**
 * Maintenance notice: what a maintenance.json may say, and the banner line
 * before, during and long after the announced time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STALE_AFTER_MS, describeMaintenance, formatCountdown, parseMaintenanceNotice } from "../../src/application/maintenance/MaintenanceNotice.js";
import { fetchMaintenanceNotice } from "../../src/infrastructure/api/fetchMaintenanceNotice.js";

const AT = "2026-10-02T21:00:00Z";
const STARTS_AT = Date.parse(AT);

describe("parseMaintenanceNotice", () => {
  it("reads the start time and an optional message", () => {
    assert.deepEqual(parseMaintenanceNotice({ at: AT }), { startsAt: STARTS_AT, message: null });
    assert.deepEqual(parseMaintenanceNotice({ at: AT, message: "  New cards!  " }), { startsAt: STARTS_AT, message: "New cards!" });
  });

  it("refuses anything without a valid time", () => {
    for (const value of [null, "x", 42, {}, { at: "tomorrow" }, { at: 1790000000000 }]) {
      assert.equal(parseMaintenanceNotice(value), null);
    }
  });

  it("caps the message length", () => {
    assert.equal(parseMaintenanceNotice({ at: AT, message: "a".repeat(500) })?.message?.length, 200);
  });
});

describe("describeMaintenance", () => {
  const notice = { startsAt: STARTS_AT, message: null };

  it("counts down before the start", () => {
    assert.match(describeMaintenance(notice, STARTS_AT - 90_000) ?? "", /^Maintenance in 1m 30s: .*do not buy packs/);
  });

  it("says it is in progress after the start, and appends the message", () => {
    assert.equal(describeMaintenance({ ...notice, message: "New cards!" }, STARTS_AT + 1000), "Maintenance in progress: the game will be back in a few minutes. New cards!");
  });

  it("hides a notice left over long after the start", () => {
    assert.equal(describeMaintenance(notice, STARTS_AT + STALE_AFTER_MS + 1), null);
  });
});

describe("formatCountdown", () => {
  it("shows seconds, then minutes and seconds, then hours and minutes", () => {
    assert.equal(formatCountdown(5_000), "5s");
    assert.equal(formatCountdown(59_001), "1m 00s");
    assert.equal(formatCountdown(692_000), "11m 32s");
    assert.equal(formatCountdown(3_600_000 + 61_000), "1h 01m");
  });
});

describe("fetchMaintenanceNotice", () => {
  it("asks without cache and parses the file", async () => {
    const calls = [];
    const notice = await fetchMaintenanceNotice(async (url, init) => (calls.push({ url, init }), Response.json({ at: AT })));
    assert.deepEqual(notice, { startsAt: STARTS_AT, message: null });
    assert.deepEqual(calls, [{ url: "/maintenance.json", init: { cache: "no-store" } }]);
  });

  it("means no maintenance on 404, network errors and garbage", async () => {
    assert.equal(await fetchMaintenanceNotice(async () => new Response("<h1>404</h1>", { status: 404 })), null);
    assert.equal(await fetchMaintenanceNotice(async () => { throw new TypeError("offline"); }), null);
    assert.equal(await fetchMaintenanceNotice(async () => new Response("not json")), null);
  });
});
