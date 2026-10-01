/**
 * Maintenance notice: what the server's announcement may say, the banner line
 * before, during and long after the announced time, and how the page follows
 * it (read on load, pushed afterwards, read again after a reconnection), with
 * a lost connection and a newer version live.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DISCONNECTED_AFTER_MS, STALE_AFTER_MS, describeBanner, describeMaintenance, formatCountdown, parseMaintenanceNotice } from "../../src/application/maintenance/MaintenanceNotice.js";
import { MaintenanceWatch } from "../../src/application/maintenance/MaintenanceWatch.js";
import { fetchServerStatus } from "../../src/infrastructure/api/fetchServerStatus.js";

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

describe("describeBanner", () => {
  const quiet = { notice: null, disconnectedSince: null, updateAvailable: false };

  it("shows nothing when there is nothing to say", () => {
    assert.equal(describeBanner(quiet, STARTS_AT), null);
  });

  it("puts the maintenance first, then a lost connection, then a newer version with a reload button", () => {
    const everything = { notice: { startsAt: STARTS_AT, message: null }, disconnectedSince: STARTS_AT - 60_000, updateAvailable: true };
    assert.deepEqual(describeBanner(everything, STARTS_AT - 1000), { text: "Maintenance in 1s: the shop and new games are paused.", reload: false });
    assert.deepEqual(describeBanner({ ...everything, notice: null }, STARTS_AT), { text: "Connection to the game server lost: reconnecting…", reload: false });
    assert.deepEqual(describeBanner({ ...quiet, updateAvailable: true }, STARTS_AT), { text: "A new version of the game is out.", reload: true });
  });

  it("waits a moment before telling a lost connection, and forgets a stale maintenance", () => {
    assert.equal(describeBanner({ ...quiet, disconnectedSince: STARTS_AT }, STARTS_AT + DISCONNECTED_AFTER_MS - 1), null);
    const stale = { ...quiet, notice: { startsAt: STARTS_AT, message: null }, updateAvailable: true };
    assert.equal(describeBanner(stale, STARTS_AT + STALE_AFTER_MS + 1)?.text, "A new version of the game is out.");
  });
});

describe("fetchServerStatus", () => {
  it("asks the server without cache, for the maintenance and the version it serves", async () => {
    const calls = [];
    const status = await fetchServerStatus(async (url, init) => (calls.push({ url, init }), Response.json({ maintenance: { at: AT, message: null }, build: "96e1df5c1a2b" })));
    assert.deepEqual(status, { notice: { startsAt: STARTS_AT, message: null }, build: "96e1df5c1a2b" });
    assert.deepEqual(calls, [{ url: "/api/maintenance", init: { cache: "no-store" } }]);
    assert.deepEqual(await fetchServerStatus(async () => Response.json({ maintenance: null })), { notice: null, build: null }, "no version named: development");
    assert.deepEqual(await fetchServerStatus(async () => Response.json({ maintenance: null, build: "<script>" })), { notice: null, build: null });
  });

  it("means nothing new when the server is down, the network fails or the answer is garbage", async () => {
    assert.equal(await fetchServerStatus(async () => new Response("<h1>502</h1>", { status: 502 })), null);
    assert.equal(await fetchServerStatus(async () => { throw new TypeError("offline"); }), null);
    assert.equal(await fetchServerStatus(async () => new Response("not json")), null);
    assert.equal(await fetchServerStatus(async () => Response.json(null)), null);
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
    let served = { notice: null, build: null };
    let loads = 0;
    const watch = new MaintenanceWatch({ load: async () => ((loads += 1), served), now: () => 0 });
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

    served = { notice: { startsAt: STARTS_AT + 60_000, message: null }, build: null };
    status("closed");
    assert.equal(loads, 1);
    status("open");
    await Promise.resolve();
    assert.equal(loads, 2, "missed pushes are read again");
    assert.deepEqual(watch.notice, served.notice);

    push({ t: "maintenance", d: { maintenance: null } });
    assert.equal(watch.notice, null);
  });

  it("keeps what it knows when a read fails (the server is restarting)", async () => {
    let served = { notice: { startsAt: STARTS_AT, message: null }, build: "a" };
    const watch = new MaintenanceWatch({ load: async () => served, now: () => 0 });
    await watch.refresh();
    served = null;
    await watch.refresh();
    assert.deepEqual(watch.notice, { startsAt: STARTS_AT, message: null }, "still announced");
  });

  it("tells a newer version from the one the page runs, and keeps saying so", async () => {
    let build = "first";
    const watch = new MaintenanceWatch({ load: async () => ({ notice: null, build }), now: () => 0 });
    await watch.refresh();
    assert.equal(watch.updateAvailable, false);
    await watch.refresh();
    assert.equal(watch.updateAvailable, false, "the same version");
    build = "second";
    await watch.refresh();
    assert.equal(watch.updateAvailable, true);
    build = "first";
    await watch.refresh();
    assert.equal(watch.updateAvailable, true, "the page still runs the first one");
  });

  it("never offers a reload when the server named no version at first (development)", async () => {
    let build = null;
    const watch = new MaintenanceWatch({ load: async () => ({ notice: null, build }), now: () => 0 });
    await watch.refresh();
    build = "deployed";
    await watch.refresh();
    assert.equal(watch.updateAvailable, false, "the first version named is taken as the page's");
  });

  it("knows since when the connection is lost, until it is back", () => {
    let now = 1000;
    const watch = new MaintenanceWatch({ load: async () => null, now: () => now });
    const { connection, status } = fakeConnection();
    watch.follow(connection);
    const seen = [];
    watch.subscribe(() => seen.push(watch.disconnectedSince));
    status("connecting");
    assert.equal(watch.disconnectedSince, null, "connecting the first time is not a loss");
    status("closed");
    now = 5000;
    status("connecting");
    status("closed");
    assert.equal(watch.disconnectedSince, 1000, "since the first loss, through the retries");
    status("open");
    assert.equal(watch.disconnectedSince, null);
    assert.deepEqual(seen, [1000, null], "the banner hears both changes");
  });
});
