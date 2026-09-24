/**
 * Data key rotation: every secret at rest is re-sealed with the new key, the
 * old key can then be dropped, and a restarted server still opens them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hexToBytes } from "@magic8/protocol";
import { SecretBox } from "../../src/kernel/crypto/SecretBox.js";
import { uuidV4 } from "../../src/kernel/random.js";
import { rotateDataKey } from "../../src/maintenance/rotateDataKey.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const OLD = "11".repeat(32);
const NEW = "22".repeat(32);

describe("data key rotation", () => {
  it("re-seals game and pack epoch secrets with the new key, once", async () => {
    const setup = await buildTestApp({ env: { M8_DATA_KEY: OLD, M8_DATA_KEY_ID: "1" } });
    const content = setup.app.catalog.current().content;
    const deck = content.preconDecks[0].entries;
    const entrant = async (account) => ({ userId: (await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(account)))).id, account, deckId: null, deck });
    const gameId = await setup.app.games.createGame({ entrants: [await entrant("alice"), await entrant("bob")] });
    const epoch = await setup.app.epochs.current();
    const keyIds = async () => (await setup.database.rows("SELECT secret_encrypted AS s FROM games UNION ALL SELECT secret_encrypted FROM rng_epochs")).map((row) => SecretBox.keyIdOf(new Uint8Array(row.s)));
    assert.deepEqual(await keyIds(), [1, 1]);

    const both = new SecretBox({ keys: new Map([[1, hexToBytes(OLD)], [2, hexToBytes(NEW)]]), currentKeyId: 2, random: deterministicRandom("rotation") });
    assert.deepEqual(await rotateDataKey({ database: setup.database, secrets: both }), { resealed: 2, current: 0 });
    assert.deepEqual(await keyIds(), [2, 2]);
    assert.deepEqual(await rotateDataKey({ database: setup.database, secrets: both }), { resealed: 0, current: 2 }, "safe to run again");

    // The old key is gone: a restarted server opens everything with the new one alone.
    const restarted = await buildTestApp({ database: setup.database, clock: setup.clock, random: deterministicRandom("after-rotation"), env: { M8_DATA_KEY: NEW, M8_DATA_KEY_ID: "2" } });
    assert.equal(await restarted.app.games.restoreAll(), 1);
    assert.match(await restarted.app.epochs.secretOf(epoch.id), /^[0-9a-f]{64}$/);
    assert.ok(gameId);
  });
});
