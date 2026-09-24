/**
 * A signed-in (or not) player wired exactly as main.js wires the browser
 * client, against the in-memory game server of fakeCollectionApi.js.
 */
import { AccountService } from "../../src/application/account/AccountService.js";
import { CollectionService } from "../../src/application/collection/CollectionService.js";
import { AccountDeckRepository } from "../../src/application/decks/AccountDeckRepository.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { IdentityStatus } from "../../src/application/identity/IdentityService.js";
import { RemoteDeckRepository } from "../../src/infrastructure/api/RemoteDeckRepository.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { fakeCollectionApi } from "./fakeCollectionApi.js";

export const ALICE = Object.freeze({ id: "u-alice", network: "steem", account: "alice" });
export const BOB = Object.freeze({ id: "u-bob", network: "steem", account: "bob" });

/** Lets pending promise chains (loads started by a state change) finish. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An identity whose state the test sets directly. */
export function fakeIdentity() {
  const listeners = new Set();
  const identity = {
    state: Object.freeze({ status: IdentityStatus.SIGNED_OUT, user: null, error: null }),
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    /** @param {Readonly<{ id: string, account: string }> | null} user */
    become(user) {
      identity.state = Object.freeze({ status: user === null ? IdentityStatus.SIGNED_OUT : IdentityStatus.SIGNED_IN, user, error: null });
      listeners.forEach((listener) => listener(identity.state));
    },
  };
  return identity;
}

/**
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 * @param {Parameters<typeof fakeCollectionApi>[0] extends infer O ? Omit<O, "content"> : never} [options]
 */
export function accountWorld(content, options = {}) {
  const logger = new MemoryLogger();
  const server = fakeCollectionApi({ content, ...options });
  const identity = fakeIdentity();
  const collection = new CollectionService({ api: server.api });
  const accountDecks = new RemoteDeckRepository({ api: server.api });
  const browserDecks = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  const repository = new AccountDeckRepository({ identity, account: accountDecks, browser: browserDecks });
  const builder = new DeckBuildingService({ content, repository, ownership: () => collection.ownedCounts() });
  const account = new AccountService({ identity, collection, decks: accountDecks, deckBuilding: builder, logger });
  account.start();
  return { server, identity, collection, accountDecks, browserDecks, repository, builder, account, logger };
}
