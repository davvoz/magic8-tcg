/**
 * Maintenance notice: what the server's announcement may say, the banner line
 * before, during and long after the announced time, and how the page follows
 * it (read on load, pushed afterwards, read again after a reconnection).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STALE_AFTER_MS, describeMaintenance, formatCountdown, parseMaintenanceNotice } from "../../src/application/maintenance/MaintenanceNotice.js";
import { MaintenanceWatch } from "../../src/application/maintenance/MaintenanceWatch.js";
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
    assert.match(describeMaintenance(notice, STARTS_AT - 90_000) ?? "", /^Maintenance in 1m 30s: the shop and new games are paused.$/);
  });

  it("says it is in progress after the start, and appends the message", () => {
    assert.equal(describeMaintenance({ ...notice, message: "New cards!" }, STARTS_AT + 1000), "Maintenance in progress: back in a few minutes. New cards!");
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
  it("asks the server without cache", async () => {
    const calls = [];
    const notice = await fetchMaintenanceNotice(async (url, init) => (calls.push({ url, init }), Response.json({ maintenance: { at: AT, message: null } })));
    assert.deepEqual(notice, { startsAt: STARTS_AT, message: null });
    assert.deepEqual(calls, [{ url: "/api/maintenance", init: { cache: "no-store" } }]);
    assert.equal(await fetchMaintenanceNotice(async () => Response.json({ maintenance: null })), null);
  });

  it("means none known when the server is down, the network fails or the answer is garbage", async () => {
    assert.equal(await fetchMaintenanceNotice(async () => new Response("<h1>502</h1>", { status: 502 })), null);
    assert.equal(await fetchMaintenanceNotice(async () => { throw new TypeError("offline"); }), null);
    assert.equal(await fetchMaintenanceNotice(async () => new Response("not json")), null);
  });
});

describe("MaintenanceWatch", () => {
  /** A connection that delivers what the test pushes. */
  function fakeConnection() {
    const listeners = new Set();
    const statusListeners = new Set();
    return {
      connection: { subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)), onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)) },
      push: (message) => listeners.forEach((listener) => listener(message)),
      status: (status) => statusListeners.forEach((listener) => listener(status, { code: null })),
    };
  }

  it("reads on load, follows pushes, and reads again after a reconnection", async () => {
    let served = null;
    let loads = 0;
    const watch = new MaintenanceWatch({ load: async () => ((loads += 1), served) });
    const seen = [];
    watch.subscribe((notice) => seen.push(notice));
    await watch.refresh();
    assert.equal(watch.notice, null);

    const { connection, push, status } = fakeConnection();
    watch.follow(connection);
    push({ t: "maintenance", d: { maintenance: { at: AT, message: "Soon" } } });
    assert.deepEqual(watch.notice, { startsAt: STARTS_AT, message: "Soon" });
    push({ t: "notification", d: {} });
    assert.equal(seen.length, 2, "other messages are not its business");

    served = { startsAt: STARTS_AT + 60_000, message: null };
    status("closed");
    assert.equal(loads, 1);
    status("open");
    await Promise.resolve();
    assert.equal(loads, 2, "missed pushes are read again");
    assert.deepEqual(watch.notice, served);

    push({ t: "maintenance", d: { maintenance: null } });
    assert.equal(watch.notice, null);
  });
});
