/**
 * The per-game hash chain (docs/tcg/03-game-blockchain-protocol.md §6.2):
 *
 *   genesis = H("genesis", utf8(gameId))
 *   head_i  = H("event", raw(head_{i-1}) ‖ utf8(canonical({ a, d, g, i, k, ms, t, v })))
 *
 * `head_i` is the event hash of event i. The game id and protocol version are
 * part of every hashed body, so an event cannot be replayed into another game
 * or reinterpreted under another version.
 */
import { deepFreeze } from "@magic8/engine/shared/deepFreeze.js";
import { Issues } from "@magic8/engine/shared/validation.js";
import { canonicalize } from "../canonical/CanonicalJson.js";
import { HashTag, hexToBytes, isHash, taggedHashHex, utf8 } from "../crypto/hash.js";
import { GAME_ID_PATTERN, GAME_PROTOCOL_VERSIONS, GameProtocol } from "./constants.js";
import { ProtocolError } from "./ProtocolError.js";
import { checkEvent } from "./schema.js";

/**
 * @typedef {Readonly<{ a: string | null, d: Readonly<Record<string, unknown>>, i: number, k: string, ms: number, t: number }>} ProtocolEvent
 * @typedef {Readonly<{ event: ProtocolEvent, head: string }>} ChainedEvent
 */

/**
 * @param {string} gameId
 */
function assertGameId(gameId) {
  if (typeof gameId !== "string" || !GAME_ID_PATTERN.test(gameId)) {
    throw new ProtocolError(`invalid game id "${String(gameId)}"`);
  }
}

/**
 * @param {string} gameId
 * @returns {string} the head before the first event
 */
export function genesisHead(gameId) {
  assertGameId(gameId);
  return taggedHashHex(HashTag.GENESIS, utf8(gameId));
}

/**
 * @param {string} gameId
 * @param {ProtocolEvent} event
 * @param {number} [version]
 */
export function eventBody(gameId, event, version = GameProtocol.V1) {
  return { a: event.a, d: event.d, g: gameId, i: event.i, k: event.k, ms: event.ms, t: event.t, v: version };
}

/**
 * @param {string} previousHead
 * @param {string} gameId
 * @param {ProtocolEvent} event
 * @param {number} [version]
 * @returns {string}
 */
export function nextHead(previousHead, gameId, event, version = GameProtocol.V1) {
  if (!isHash(previousHead)) {
    throw new ProtocolError("previous head must be a 32-byte hash as lowercase hex");
  }
  return taggedHashHex(HashTag.EVENT, hexToBytes(previousHead), utf8(canonicalize(eventBody(gameId, event, version))));
}

/**
 * Appends events for one game, assigning sequence numbers and chaining
 * hashes. The server keeps one per active game; its state (head, next
 * sequence) is persisted with every event so it can be restored after a restart.
 */
export class EventChain {
  #gameId;
  #head;
  #nextSeq;
  #version;

  /**
   * @param {{ gameId: string, head?: string, nextSeq?: number, version?: number }} options omit head/nextSeq for a new game;
   *   `version`: the game protocol version (it is hashed into every event)
   */
  constructor({ gameId, head, nextSeq = 0, version = GameProtocol.V1 }) {
    assertGameId(gameId);
    if (!GAME_PROTOCOL_VERSIONS.includes(version)) {
      throw new ProtocolError(`unknown game protocol version ${String(version)}`);
    }
    this.#version = version;
    if (!Number.isSafeInteger(nextSeq) || nextSeq < 0) {
      throw new ProtocolError("nextSeq must be a non-negative integer");
    }
    if ((head === undefined) !== (nextSeq === 0)) {
      throw new ProtocolError("a restored chain needs both its head and its next sequence number");
    }
    this.#gameId = gameId;
    this.#head = head ?? genesisHead(gameId);
    this.#nextSeq = nextSeq;
    if (!isHash(this.#head)) {
      throw new ProtocolError("head must be a 32-byte hash as lowercase hex");
    }
  }

  get gameId() {
    return this.#gameId;
  }

  get head() {
    return this.#head;
  }

  get nextSeq() {
    return this.#nextSeq;
  }

  get version() {
    return this.#version;
  }

  /**
   * Validates, numbers and chains an event. Invalid events are programmer
   * errors on the server and throw; nothing is appended.
   * @param {{ k: string, a: string | null, t: number, ms: number, d: Readonly<Record<string, unknown>> }} fields
   * @returns {ChainedEvent}
   */
  append({ k, a, t, ms, d }) {
    const candidate = { a, d, i: this.#nextSeq, k, ms, t };
    const issues = new Issues();
    checkEvent(issues, candidate, "event", this.#version);
    if (!issues.isEmpty) {
      throw new ProtocolError(`invalid event: ${issues.list()[0]}`, { problems: issues.list() });
    }
    const event = deepFreeze(structuredClone(candidate));
    const head = nextHead(this.#head, this.#gameId, event, this.#version);
    this.#head = head;
    this.#nextSeq += 1;
    return Object.freeze({ event, head });
  }
}
