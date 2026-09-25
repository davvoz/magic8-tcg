/**
 * Sealing chained events into records and packing records into `custom_json`
 * envelopes (docs/tcg/03-game-blockchain-protocol.md §6 and §9).
 *
 * A sealed record is immutable: its canonical JSON is what gets stored in the
 * outbox and broadcast, byte for byte, as many times as needed.
 */
import { canonicalize, utf8Length } from "../canonical/CanonicalJson.js";
import { isHash } from "../crypto/hash.js";
import { GAME_PROTOCOL_VERSIONS, GameProtocol, LIMITS, PROTOCOL_VERSION } from "./constants.js";
import { nextHead } from "./EventChain.js";
import { ProtocolError } from "./ProtocolError.js";

/** Bytes an envelope adds around its records: {"r":[…],"v":1} */
export const ENVELOPE_OVERHEAD_BYTES = utf8Length(canonicalize({ r: [], v: PROTOCOL_VERSION }));

/** Largest record that still fits alone in one operation. */
export const MAX_RECORD_BYTES = LIMITS.MAX_OPERATION_BYTES - ENVELOPE_OVERHEAD_BYTES;

/**
 * @typedef {import("./EventChain.js").ChainedEvent} ChainedEvent
 * @typedef {Readonly<{ gameId: string, seq: number, record: Readonly<Record<string, unknown>>, json: string, bytes: number, firstEventSeq: number, lastEventSeq: number, previousHead: string, head: string }>} SealedRecord
 */

/**
 * Recomputes the chain over `chained` from `previousHead`, so a record can
 * never be sealed with events that do not actually follow each other.
 * @param {string} gameId
 * @param {string} previousHead
 * @param {readonly ChainedEvent[]} chained
 * @param {number} version game protocol version
 */
function assertChained(gameId, previousHead, chained, version) {
  let head = previousHead;
  chained.forEach(({ event, head: claimed }, index) => {
    if (index > 0 && event.i !== chained[index - 1].event.i + 1) {
      throw new ProtocolError("events of a record must have contiguous sequence numbers");
    }
    head = nextHead(head, gameId, event, version);
    if (head !== claimed) {
      throw new ProtocolError(`event ${event.i} does not chain from the previous head`);
    }
  });
}

/**
 * @param {{ gameId: string, seq: number, previousHead: string, chained: readonly ChainedEvent[], ts: number, version?: number }} input `version`: the game's protocol version
 * @returns {SealedRecord}
 */
export function sealRecord({ gameId, seq, previousHead, chained, ts, version = GameProtocol.V1 }) {
  if (!GAME_PROTOCOL_VERSIONS.includes(version)) {
    throw new ProtocolError(`unknown game protocol version ${String(version)}`);
  }
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new ProtocolError("record sequence must be a non-negative integer");
  }
  if (!Number.isSafeInteger(ts) || ts < 0) {
    throw new ProtocolError("record timestamp must be a non-negative integer (Unix ms)");
  }
  if (!isHash(previousHead)) {
    throw new ProtocolError("previous head must be a 32-byte hash as lowercase hex");
  }
  if (chained.length === 0 || chained.length > LIMITS.MAX_EVENTS_PER_RECORD) {
    throw new ProtocolError(`a record holds 1..${LIMITS.MAX_EVENTS_PER_RECORD} events`);
  }
  assertChained(gameId, previousHead, chained, version);
  const head = chained[chained.length - 1].head;
  const record = Object.freeze({ e: Object.freeze(chained.map(({ event }) => event)), g: gameId, h: head, p: previousHead, s: seq, ts, v: version });
  const json = canonicalize(record);
  const bytes = utf8Length(json);
  if (bytes > MAX_RECORD_BYTES) {
    throw new ProtocolError(`record ${gameId}/${seq} is ${bytes} bytes, above ${MAX_RECORD_BYTES}`);
  }
  return Object.freeze({
    gameId,
    seq,
    record,
    json,
    bytes,
    firstEventSeq: chained[0].event.i,
    lastEventSeq: chained[chained.length - 1].event.i,
    previousHead,
    head,
  });
}

/**
 * Seals a run of chained events into as few records as fit the byte budget,
 * in order. The last record may be small; callers decide *when* to seal
 * (batching policy), this only decides *how*.
 * @param {{ gameId: string, firstRecordSeq: number, previousHead: string, chained: readonly ChainedEvent[], ts: number, maxRecordBytes?: number, version?: number }} input
 * @returns {readonly SealedRecord[]}
 */
export function sealRecords({ gameId, firstRecordSeq, previousHead, chained, ts, maxRecordBytes = MAX_RECORD_BYTES, version = GameProtocol.V1 }) {
  if (maxRecordBytes > MAX_RECORD_BYTES) {
    throw new ProtocolError(`maxRecordBytes cannot exceed ${MAX_RECORD_BYTES}`);
  }
  const records = [];
  let start = 0;
  let head = previousHead;
  while (start < chained.length) {
    const end = largestFittingRun({ gameId, seq: firstRecordSeq + records.length, previousHead: head, chained, start, ts, maxRecordBytes, version });
    const sealed = sealRecord({ gameId, seq: firstRecordSeq + records.length, previousHead: head, chained: chained.slice(start, end), ts, version });
    records.push(sealed);
    head = sealed.head;
    start = end;
  }
  return Object.freeze(records);
}

/**
 * @param {{ gameId: string, seq: number, previousHead: string, chained: readonly ChainedEvent[], start: number, ts: number, maxRecordBytes: number, version: number }} input
 * @returns {number} exclusive end index of the longest run starting at `start` that fits
 */
function largestFittingRun({ gameId, seq, previousHead, chained, start, ts, maxRecordBytes, version }) {
  const shell = canonicalize({ e: [], g: gameId, h: chained[start].head, p: previousHead, s: seq, ts, v: version });
  let size = utf8Length(shell);
  let end = start;
  while (end < chained.length && end - start < LIMITS.MAX_EVENTS_PER_RECORD) {
    const eventBytes = utf8Length(canonicalize(chained[end].event)) + (end > start ? 1 : 0);
    if (size + eventBytes > maxRecordBytes) {
      break;
    }
    size += eventBytes;
    end += 1;
  }
  if (end === start) {
    throw new ProtocolError(`event ${chained[start].event.i} alone exceeds the record budget of ${maxRecordBytes} bytes`);
  }
  return end;
}

/** Accumulates record JSON for one envelope within byte and count limits. */
class EnvelopeBuilder {
  /** @type {string[]} */
  #records = [];
  #bytes = ENVELOPE_OVERHEAD_BYTES;
  #maxBytes;
  #maxRecords;

  /**
   * @param {number} maxBytes
   * @param {number} maxRecords
   */
  constructor(maxBytes, maxRecords) {
    this.#maxBytes = maxBytes;
    this.#maxRecords = maxRecords;
  }

  get isEmpty() {
    return this.#records.length === 0;
  }

  /** @param {number} recordBytes */
  fits(recordBytes) {
    const separator = this.isEmpty ? 0 : 1;
    return this.#records.length < this.#maxRecords && this.#bytes + separator + recordBytes <= this.#maxBytes;
  }

  /**
   * @param {string} json
   * @param {number} recordBytes
   */
  add(json, recordBytes) {
    this.#bytes += recordBytes + (this.isEmpty ? 0 : 1);
    this.#records.push(json);
  }

  build() {
    // Records are canonical and "r" < "v": this is the canonical form of { r, v }.
    const json = `{"r":[${this.#records.join(",")}],"v":${PROTOCOL_VERSION}}`;
    return Object.freeze({ json, bytes: utf8Length(json), count: this.#records.length });
  }
}

/**
 * Packs sealed records (of any games) into envelopes, in the given order,
 * each at most `maxBytes` of canonical JSON.
 * @param {readonly { json: string }[]} records
 * @param {{ maxBytes?: number, maxRecords?: number }} [options]
 * @returns {readonly Readonly<{ json: string, bytes: number, count: number }>[]}
 */
export function packEnvelopes(records, { maxBytes = LIMITS.MAX_OPERATION_BYTES, maxRecords = LIMITS.MAX_RECORDS_PER_ENVELOPE } = {}) {
  if (maxBytes > LIMITS.MAX_OPERATION_BYTES || maxRecords > LIMITS.MAX_RECORDS_PER_ENVELOPE || maxRecords < 1) {
    throw new ProtocolError("envelope limits exceed the protocol limits");
  }
  const envelopes = [];
  let builder = new EnvelopeBuilder(maxBytes, maxRecords);
  for (const { json } of records) {
    const recordBytes = utf8Length(json);
    if (ENVELOPE_OVERHEAD_BYTES + recordBytes > maxBytes) {
      throw new ProtocolError(`a record of ${recordBytes} bytes cannot fit an envelope of ${maxBytes} bytes`);
    }
    if (!builder.fits(recordBytes)) {
      envelopes.push(builder.build());
      builder = new EnvelopeBuilder(maxBytes, maxRecords);
    }
    builder.add(json, recordBytes);
  }
  if (!builder.isEmpty) {
    envelopes.push(builder.build());
  }
  return Object.freeze(envelopes);
}
