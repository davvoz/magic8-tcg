/**
 * Probes, metrics behind a token, and alarms that log once when they start
 * and once when they clear.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildTestApp, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const TOKEN = "m".repeat(40);
const MINUTE = 60_000;

describe("monitoring", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;

  before(async () => {
    setup = await buildTestApp({ env: { M8_METRICS_TOKEN: TOKEN } });
    server = await listen(setup.app);
  });

  after(() => server.close());

  const metrics = (authorization) => fetch(`${server.base}/api/metrics`, { headers: authorization === undefined ? {} : { authorization } });

  it("answers liveness and readiness probes", async () => {
    const client = new ApiClient(server.base);
    assert.deepEqual((await client.get("/api/health")).json, { status: "ok" });
    assert.deepEqual((await client.get("/api/ready")).json, { status: "ready" });
  });

  it("serves Prometheus metrics only with the token", async () => {
    assert.equal((await metrics()).status, 404);
    assert.equal((await metrics(`Bearer ${"x".repeat(40)}`)).status, 404);
    const response = await metrics(`Bearer ${TOKEN}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/plain; version=0\.0\.4/);
    const text = await response.text();
    assert.match(text, /^# TYPE m8_chain_alerts_open gauge$/m);
    assert.match(text, /^m8_chain_alerts_open 0$/m);
    assert.match(text, /^m8_ws_connections 0$/m);
  });

  it("raises an alarm once when records wait too long to be published, and clears it", async () => {
    await setup.app.outbox.enqueueEpoch({ network: "steem", payload: '{"commit":"00","epoch":1,"kind":"pack_epoch","v":1}' });
    const raised = () => setup.logger.entries.filter((entry) => entry.message === "alarm raised: outbox_backlog").length;
    await setup.app.monitor.evaluate();
    assert.equal(raised(), 0);
    setup.clock.advance(11 * MINUTE);
    await setup.app.monitor.evaluate();
    await setup.app.monitor.evaluate();
    assert.equal(raised(), 1, "logged once, not every minute");
    assert.match(await (await metrics(`Bearer ${TOKEN}`)).text(), /^m8_alarm\{alarm="outbox_backlog"\} 1$/m);
    assert.match(await (await metrics(`Bearer ${TOKEN}`)).text(), /^m8_outbox_oldest_built_seconds 660$/m);

    await setup.database.query("UPDATE blockchain_events SET status = 'IRREVERSIBLE'");
    await setup.app.monitor.evaluate();
    assert.ok(setup.logger.entries.some((entry) => entry.message === "alarm cleared: outbox_backlog"));
    assert.equal(setup.app.monitor.alarms().find((alarm) => alarm.name === "outbox_backlog").active, false);
  });

  it("raises an alarm for an open chain alert", async () => {
    await setup.database.query("INSERT INTO chain_alerts (network, kind, fingerprint, details) VALUES ('steem', 'CONFLICT', 'g:1', '{}')");
    const alarms = await setup.app.monitor.evaluate();
    assert.equal(alarms.find((alarm) => alarm.name === "chain_alerts_open").active, true);
  });
});
