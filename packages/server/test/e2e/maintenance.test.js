/**
 * An announced maintenance, end to end: real clients on a real server. The
 * operator announces it on the admin API; every open tab hears it at once on
 * its realtime connection, whoever was searching is taken out of the queue,
 * new games and shop orders are refused with a message the player can read.
 * It ends from the command line (another process, as deploy.sh does): the
 * tabs hear that too, and players can search again and be matched.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MaintenanceWatch } from "../../../client/src/application/maintenance/MaintenanceWatch.js";
import { describeMaintenance } from "../../../client/src/application/maintenance/MaintenanceNotice.js";
import { fetchServerStatus } from "../../../client/src/infrastructure/api/fetchServerStatus.js";
import { runMaintenanceCommand } from "../../src/maintenance/maintenanceNotice.js";
import { buildTestApp, deterministicRandom, keyPair } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";
import { onlineWorld, until } from "./onlineHarness.js";

const SHOP = "verdu.green";

describe("announced maintenance (real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>> | null} */
  let world = null;
  /** @type {(() => Promise<void>) | null} */
  let stopFollowing = null;
  after(async () => {
    await stopFollowing?.();
    await world?.close();
  });

  it("closes the queue and the shop for every tab, then reopens them", async () => {
    world = await onlineWorld();
    const w = world;
    stopFollowing = await w.setup.app.maintenance.start();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    // What each page runs: read on load, then follow the pushes on the tab's connection.
    const watchOf = async (tab) => {
      const watch = new MaintenanceWatch({ load: () => fetchServerStatus((url, init) => fetch(`${w.server.base}${url}`, init)), now: () => w.setup.clock.now() });
      await watch.refresh();
      watch.follow(tab.connection);
      return watch;
    };
    const aliceWatch = await watchOf(alice);
    const bobWatch = await watchOf(bob);
    assert.equal(aliceWatch.notice, null);

    await alice.online.queue(alice.deckId);
    assert.equal(alice.online.state.status, "searching");

    const operatorKeys = keyPair(7);
    w.setup.chain.setAccount(SHOP, [operatorKeys.publicKey]);
    const operator = new ApiClient(w.server.base);
    await operator.signIn(SHOP, operatorKeys.privateKey);
    const announced = await operator.post("/api/admin/maintenance", { minutes: 10, message: "New cards!" });
    assert.equal(announced.status, 200);

    await until(() => aliceWatch.notice !== null && bobWatch.notice !== null, "every tab hears the announcement");
    assert.match(describeMaintenance(bobWatch.notice, w.setup.clock.now()) ?? "", /^Maintenance in 10m 00s: .* New cards!$/);
    await until(() => alice.online.state.status === "idle", "alice is taken out of the queue");

    const refused = await bob.online.queue(bob.deckId);
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "MAINTENANCE");
    assert.match(bob.online.state.error.message, /Matchmaking is closed for maintenance/);
    const order = await bob.api.post("/api/orders", { items: [{ productId: "core_booster", quantity: 1 }], asset: "STEEM" }, { "Idempotency-Key": "e2e-maintenance-0000001" });
    assert.deepEqual([order.status, order.json.error.code], [503, "MAINTENANCE"]);
    assert.match(order.json.error.message, /The shop is closed for maintenance/);

    // deploy.sh ends it from another process, through the database.
    const cli = await buildTestApp({ database: w.setup.database, clock: w.setup.clock, random: deterministicRandom("command line") });
    assert.deepEqual(await runMaintenanceCommand({ maintenance: cli.app.maintenance }, ["end"]), { ok: true, result: { ended: true } });
    await until(() => aliceWatch.notice === null && bobWatch.notice === null, "every tab hears the end");

    await alice.online.queue(alice.deckId);
    await bob.online.queue(bob.deckId);
    await until(() => alice.online.state.status === "matched" && bob.online.state.status === "matched", "they can play again");
  });
});
