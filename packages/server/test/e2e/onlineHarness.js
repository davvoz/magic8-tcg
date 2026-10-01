/**
 * End to end, the way two browsers play: a real server on a local port, and
 * for each player the real client stack (OnlineService and LobbyService over
 * a real WebSocketConnection, WebCrypto session keys) with a Keychain stand-in the
 * test drives by hand — every prompt waits until the test approves,
 * refuses or ignores it, like a person in front of the extension.
 */
import assert from "node:assert/strict";

import { signMessage } from "@magic8/steem";
import { WebSocket } from "ws";
import { LobbyService } from "../../../client/src/application/lobby/LobbyService.js";
import { OnlineService } from "../../../client/src/application/online/OnlineService.js";
import { WebCryptoSessionKeys } from "../../../client/src/infrastructure/crypto/webSessionKeys.js";
import { MemoryLogger } from "../../../client/src/infrastructure/logging/MemoryLogger.js";
import { WebSocketConnection } from "../../../client/src/infrastructure/realtime/WebSocketConnection.js";
import { ORIGIN, buildTestApp, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

/** Lets sockets, the server and promises run. */
export const settle = async (rounds = 8) => {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * Waits (in real time) until `reached()` holds.
 * @param {() => boolean} reached
 * @param {string} label
 */
export async function until(reached, label, limitMs = 5000) {
  for (let waited = 0; waited < limitMs; waited += 20) {
    if (reached()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`never reached: ${label}`);
}

/** A Keychain whose prompts stay open until the test answers them. */
class ManualKeychain {
  /** @type {{ message: string, answer: (approve: boolean) => void }[]} */
  open = [];
  /** Every prompt ever shown. */
  shown = 0;
  #postingKey;

  /** @param {Uint8Array} postingKey */
  constructor(postingKey) {
    this.#postingKey = postingKey;
  }

  /** @param {{ message: string }} request */
  signMessage({ message }) {
    this.shown += 1;
    return new Promise((resolve) => {
      const prompt = {
        message,
        answer: (approve) => {
          this.open = this.open.filter((candidate) => candidate !== prompt);
          resolve(approve ? { ok: true, value: signMessage(message, this.#postingKey) } : { ok: false, error: { code: "REJECTED", message: "the user said no" } });
        },
      };
      this.open.push(prompt);
    });
  }

  approve() {
    assert.ok(this.open.length > 0, "a Keychain prompt is open");
    this.open[0].answer(true);
  }

  refuse() {
    assert.ok(this.open.length > 0, "a Keychain prompt is open");
    this.open[0].answer(false);
  }
}

/** The server, and a way to bring players in (each signed in, with a deck, their client online). */
export async function onlineWorld() {
  const setup = await buildTestApp({ signedMoves: true });
  const server = await listen(setup.app);
  const players = [];
  let seed = 40;

  /**
   * One browser tab of a signed-in player: the real client stack, and what it sent.
   * @param {{ account: string, api: ApiClient, keys: { privateKey: Uint8Array }, deckId: string }} who
   */
  const browser = async ({ account, api, keys, deckId }) => {
    const keychain = new ManualKeychain(keys.privateKey);
    const logger = new MemoryLogger();
    /** @type {string[]} */
    const sent = [];
    const connect = () => {
      setup.clock.advance(2000); // the gateway allows one upgrade per 2 s per address
      return new WebSocket(`${server.base.replace("http", "ws")}/ws`, { headers: { Cookie: /** @type {string} */ (api.cookie), Origin: ORIGIN } });
    };
    const connection = new WebSocketConnection({ url: "unused", createSocket: connect, timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle) } });
    const request = connection.request.bind(connection);
    connection.request = (t, d) => {
      sent.push(t);
      return request(t, d);
    };
    const online = new OnlineService({
      connection,
      randomHex: (bytes) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      newCommandId: () => globalThis.crypto.randomUUID(),
      accountDecks: () => [{ id: deckId, name: "Foundry", faction: "iron", totalCards: 30, playable: true, problem: null }],
      sessionKeys: new WebCryptoSessionKeys({ subtle: globalThis.crypto.subtle }),
      wallet: keychain,
      logger,
    });
    online.start();
    // The lobby's list is read on demand in tests (no polling).
    const lobby = new LobbyService({ connection, scheduler: { delay: () => new Promise(() => undefined) }, now: () => Date.now(), logger });
    lobby.start();
    const entry = {
      account,
      online,
      lobby,
      /** The tab's realtime connection and its signed-in HTTP client, for what else the page runs on them. */
      connection,
      api,
      keychain,
      logger,
      sent,
      deckId,
      /** How many times this tab sent a message of that type. @param {string} type */
      count: (type) => sent.filter((candidate) => candidate === type).length,
      /** The page is reloaded: this tab goes, a new one opens for the same player. */
      reload: async () => {
        lobby.stop();
        online.stop();
        await settle();
        return browser({ account, api, keys, deckId });
      },
    };
    players.push(entry);
    await until(() => online.state.status !== "offline" && online.state.status !== "connecting", `${account} is welcomed`);
    return entry;
  };

  /** @param {string} account */
  const player = async (account) => {
    const keys = keyPair((seed += 1));
    setup.chain.setAccount(account, [keys.publicKey]);
    const api = new ApiClient(server.base);
    await api.signIn(account, keys.privateKey);
    const deckId = (await api.post("/api/starter", { starterId: "precon_foundry" })).json.deck.id;
    return browser({ account, api, keys, deckId });
  };

  return {
    setup,
    server,
    player,
    /** Runs the server's timers after the clock moved. */
    tick: async (ms) => {
      setup.clock.advance(ms);
      await setup.app.games.tick();
      await settle();
    },
    close: async () => {
      for (const entry of players) {
        entry.lobby.stop();
        entry.online.stop();
      }
      await server.close();
    },
  };
}
