import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { FetchContentSource, FetchError } from "../../src/infrastructure/config/FetchContentSource.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoreError } from "../../src/infrastructure/persistence/KeyValueStore.contract.js";
import { LocalStorageStore } from "../../src/infrastructure/persistence/LocalStorageStore.js";
import { EnvelopeError, openEnvelope, sealEnvelope } from "../../src/infrastructure/persistence/StorageEnvelope.js";
import { DECKS_STORAGE_KEY, DeckRepositoryError, StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { SIGN_IN_STORAGE_KEY, StoredSignIn } from "../../src/infrastructure/persistence/StoredSignIn.js";
import { createSeed } from "../../src/infrastructure/random/seedProvider.js";

const deck = (id, name = id) => new DeckList({ id, name, entries: [{ cardId: "ember_imp", count: 2 }] });

describe("StorageEnvelope", () => {
  it("round-trips a payload and rejects size, malformed JSON, wrong shape and wrong version", () => {
    const sealed = sealEnvelope(1, { a: 1 }, 1000);
    assert.equal(sealed.ok, true);
    assert.deepEqual(openEnvelope(sealed.value, { schemaVersion: 1, maxBytes: 1000 }).value, { a: 1 });
    assert.equal(sealEnvelope(1, "x".repeat(2000), 1000).error.code, EnvelopeError.TOO_LARGE);
    assert.equal(openEnvelope("x".repeat(2000), { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.TOO_LARGE);
    assert.equal(openEnvelope("{not json", { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.MALFORMED);
    assert.equal(openEnvelope("[]", { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.MALFORMED);
    assert.equal(openEnvelope('{"schemaVersion":1,"payload":1,"extra":2}', { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.MALFORMED);
    assert.equal(openEnvelope('{"payload":1}', { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.MALFORMED);
    assert.equal(openEnvelope('{"schemaVersion":2,"payload":1}', { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.VERSION);
    assert.equal(openEnvelope('{"__proto__":{},"schemaVersion":1,"payload":1}', { schemaVersion: 1, maxBytes: 1000 }).error.code, EnvelopeError.MALFORMED);
  });
});

describe("StoredDeckRepository", () => {
  it("saves, replaces, lists and removes decks", () => {
    const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger: new MemoryLogger() });
    assert.deepEqual(repository.list().value, []);
    assert.equal(repository.save(deck("custom_1", "A")).ok, true);
    assert.equal(repository.save(deck("custom_2", "B")).ok, true);
    assert.equal(repository.save(deck("custom_1", "A2")).ok, true, "replace by id");
    assert.deepEqual(repository.list().value.map((stored) => stored.name), ["B", "A2"]);
    assert.equal(repository.remove("custom_2").ok, true);
    assert.equal(repository.remove("custom_2").error.code, DeckRepositoryError.NOT_FOUND);
    assert.deepEqual(repository.list().value.map((stored) => stored.id), ["custom_1"]);
  });

  it("survives corrupted storage: bad envelope, bad entries, duplicates and precon flags are skipped and logged", () => {
    const store = new InMemoryStore();
    const logger = new MemoryLogger();
    const repository = new StoredDeckRepository({ store, logger });

    store.write(DECKS_STORAGE_KEY, "garbage");
    assert.deepEqual(repository.list().value, []);
    assert.equal(logger.entries.length, 1);

    const payload = [
      deck("custom_1").toPlain(),
      { id: "custom_2", name: "No cards" },
      deck("custom_1", "dup").toPlain(),
      { ...deck("custom_3").toPlain(), preconstructed: true },
      JSON.parse('{"__proto__":{"x":1},"id":"custom_4","name":"P","faction":"ember","cards":[]}'),
      { ...deck("custom_5").toPlain(), faction: "ember" },
    ];
    store.write(DECKS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, payload }));
    const listed = repository.list().value;
    assert.deepEqual(listed.map((stored) => stored.id), ["custom_1", "custom_5"], "a deck saved when decks had a faction still loads");
    assert.equal(logger.entries.length, 5);
  });

  it("propagates store failures", () => {
    const failing = {
      read: () => ({ ok: false, error: { code: StoreError.UNAVAILABLE, message: "nope", details: null } }),
      write: () => ({ ok: false, error: { code: StoreError.WRITE_FAILED, message: "nope", details: null } }),
      delete: () => ({ ok: true, value: undefined }),
    };
    const repository = new StoredDeckRepository({ store: failing, logger: new MemoryLogger() });
    assert.equal(repository.list().error.code, StoreError.UNAVAILABLE);
    assert.equal(repository.save(deck("custom_1")).error.code, StoreError.UNAVAILABLE);
  });
});

describe("LocalStorageStore", () => {
  const fakeStorage = () => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
    };
  };

  it("wraps a storage object and reports availability", () => {
    const store = new LocalStorageStore(fakeStorage());
    assert.equal(store.isAvailable(), true);
    assert.equal(store.write("k", "v").ok, true);
    assert.equal(store.read("k").value, "v");
    assert.equal(store.delete("k").ok, true);
    assert.equal(store.read("k").value, null);
  });

  it("degrades gracefully when storage is missing or throws", () => {
    const missing = new LocalStorageStore(undefined);
    assert.equal(missing.isAvailable(), false);
    assert.equal(missing.read("k").value, null);
    assert.equal(missing.write("k", "v").error.code, StoreError.UNAVAILABLE);

    const throwing = new LocalStorageStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    assert.equal(throwing.isAvailable(), false);
    assert.equal(throwing.read("k").error.code, StoreError.UNAVAILABLE);
    assert.equal(throwing.write("k", "v").error.code, StoreError.WRITE_FAILED);
    assert.equal(throwing.delete("k").error.code, StoreError.WRITE_FAILED);
  });
});

describe("FetchContentSource", () => {
  const manifest = { cardSets: ["a.json", "b.json"], gameRules: "rules.json" };
  const fakeFetch = (responses) => (path) => {
    const entry = responses[path];
    if (entry === undefined) {
      return Promise.reject(new Error("offline"));
    }
    return Promise.resolve({ ok: entry.status === 200, status: entry.status, text: () => Promise.resolve(entry.body) });
  };

  it("loads single and multi-file resources", async () => {
    const source = new FetchContentSource(manifest, fakeFetch({ "a.json": { status: 200, body: "[1]" }, "b.json": { status: 200, body: "[2]" }, "rules.json": { status: 200, body: '{"x":1}' } }));
    assert.deepEqual((await source.load("cardSets")).value, [[1], [2]]);
    assert.deepEqual((await source.load("gameRules")).value, { x: 1 });
  });

  it("reports unknown resources, HTTP errors, network errors, oversized and malformed bodies", async () => {
    const source = new FetchContentSource(manifest, fakeFetch({ "a.json": { status: 404, body: "" }, "rules.json": { status: 200, body: "{oops" } }));
    assert.equal((await source.load("deckRules")).error.code, FetchError.UNKNOWN_RESOURCE);
    assert.equal((await source.load("nope")).error.code, FetchError.UNKNOWN_RESOURCE);
    assert.equal((await source.load("cardSets")).error.code, FetchError.HTTP);
    assert.equal((await source.load("gameRules")).error.code, FetchError.MALFORMED);
    const offline = new FetchContentSource(manifest, fakeFetch({}));
    assert.equal((await offline.load("gameRules")).error.code, FetchError.HTTP);
    const huge = new FetchContentSource(manifest, fakeFetch({ "rules.json": { status: 200, body: "x".repeat(3 * 1024 * 1024) } }));
    assert.equal((await huge.load("gameRules")).error.code, FetchError.TOO_LARGE);
  });
});

describe("seedProvider", () => {
  it("produces 32-byte keys as lowercase hex that vary", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => createSeed()));
    assert.ok([...seeds].every((seed) => /^[0-9a-f]{64}$/.test(seed)));
    assert.equal(seeds.size, 20);
  });
});

describe("StoredSignIn", () => {
  it("remembers the account and how it signed in, and nothing it cannot read back", () => {
    const store = new InMemoryStore();
    const record = new StoredSignIn({ store });
    assert.equal(record.read(), null);
    record.write({ account: "alice", method: "keys" });
    assert.deepEqual(new StoredSignIn({ store }).read(), { account: "alice", method: "keys" }, "after a reload");
    assert.ok(!store.read(SIGN_IN_STORAGE_KEY).value.includes("5K"), "no key in it");
    store.write(SIGN_IN_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, payload: { account: "alice", method: "owner" } }));
    assert.equal(record.read(), null, "an unknown method reads as nothing");
    store.write(SIGN_IN_STORAGE_KEY, "{oops");
    assert.equal(record.read(), null);
    record.write({ account: "bob", method: "keychain" });
    record.clear();
    assert.equal(record.read(), null);
  });
});
