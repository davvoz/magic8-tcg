/**
 * Structural validation of protocol data read from untrusted sources (the
 * chain, a server response, a file). Exactly the fields of
 * docs/tcg/03-game-blockchain-protocol.md §6–7 are accepted; anything else is
 * a problem. Semantic checks (sequence, chaining, lifecycle, replay) belong to
 * the history assembler and the replay verifier.
 */
import {
  Issues,
  checkArray,
  checkArrayOf,
  checkEnum,
  checkInteger,
  checkObject,
  checkString,
  checkUnique,
} from "@magic8/engine/shared/validation.js";
import { utf8Length } from "../canonical/CanonicalJson.js";
import { isHash } from "../crypto/hash.js";
import {
  ACCOUNT_PATTERN,
  CARD_ID_PATTERN,
  ENGINE_VERSION_PATTERN,
  EVENT_KINDS,
  EntropySource,
  EventKind,
  FORCED_COMMAND_TYPES,
  ForcedMoveReason,
  GAME_ID_PATTERN,
  GameMode,
  LIMITS,
  NETWORK_PATTERN,
  PROTOCOL_VERSION,
  REASON_PATTERN,
  SEATS,
} from "./constants.js";

export const SchemaError = Object.freeze({
  INVALID_ENVELOPE: "INVALID_ENVELOPE",
  INVALID_RECORD: "INVALID_RECORD",
});

const ENVELOPE_KEYS = Object.freeze(["r", "v"]);
const RECORD_KEYS = Object.freeze(["e", "g", "h", "p", "s", "ts", "v"]);
const EVENT_KEYS = Object.freeze(["a", "d", "i", "k", "ms", "t"]);
const SEAT_ENTRY_KEYS = Object.freeze(["acct", "seat"]);
const HEX_ENTROPY_PATTERN = new RegExp(`^[0-9a-f]{${LIMITS.ENTROPY_BYTES * 2}}$`);
const COMMAND_TYPE_PATTERN = /^[A-Z_]{1,32}$/;

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 */
function checkHash(issues, value, path) {
  if (!isHash(value)) {
    return issues.add(path, "expected a 32-byte hash as lowercase hex");
  }
  return /** @type {string} */ (value);
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 */
function checkSeat(issues, value, path) {
  return checkEnum(issues, value, path, SEATS);
}

/**
 * Command payload of MOVE / FORCED_MOVE: an engine command without playerId.
 * The engine validates it fully during replay; here only its envelope.
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 */
function checkCommand(issues, value, path) {
  const command = checkObject(issues, value, path);
  if (command === undefined) {
    return undefined;
  }
  if ("playerId" in command) {
    return issues.add(`${path}.playerId`, "must be omitted: the actor is the seat");
  }
  checkString(issues, command.type, `${path}.type`, { pattern: COMMAND_TYPE_PATTERN });
  if (utf8Length(JSON.stringify(command)) > LIMITS.MAX_COMMAND_BYTES) {
    issues.add(path, `larger than ${LIMITS.MAX_COMMAND_BYTES} bytes`);
  }
  return command;
}

/**
 * Decks as revealed at the end: [["card_id", count], …] sorted by card id.
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 */
function checkRevealedDecks(issues, value, path) {
  return checkArrayOf(issues, value, path, {
    minLength: SEATS.length,
    maxLength: SEATS.length,
    item: (deck, deckPath) => {
      const entries = checkArrayOf(issues, deck, deckPath, {
        minLength: 1,
        maxLength: LIMITS.MAX_DECK_ENTRIES,
        item: (entry, entryPath) => {
          const pair = checkArray(issues, entry, entryPath, { minLength: 2, maxLength: 2 });
          if (pair === undefined) {
            return undefined;
          }
          const cardId = checkString(issues, pair[0], `${entryPath}[0]`, { pattern: CARD_ID_PATTERN });
          const count = checkInteger(issues, pair[1], `${entryPath}[1]`, { min: 1, max: LIMITS.MAX_CARD_COPIES });
          return cardId === undefined || count === undefined ? undefined : pair;
        },
      });
      if (entries !== undefined && !isStrictlySorted(entries.map((entry) => /** @type {string} */ (entry[0])))) {
        issues.add(deckPath, "entries must be sorted by card id without duplicates");
      }
      return entries;
    },
  });
}

/**
 * [{ seat: "s0", acct }, { seat: "s1", acct }] in seat order, distinct accounts.
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 */
function checkSeatAssignments(issues, value, path) {
  const seats = checkArray(issues, value, path, { minLength: SEATS.length, maxLength: SEATS.length });
  if (seats === undefined) {
    return;
  }
  const accounts = [];
  seats.forEach((item, index) => {
    const entry = checkObject(issues, item, `${path}[${index}]`, SEAT_ENTRY_KEYS);
    if (entry === undefined) {
      return;
    }
    if (entry.seat !== SEATS[index]) {
      issues.add(`${path}[${index}].seat`, `expected "${SEATS[index]}"`);
    }
    const account = checkString(issues, entry.acct, `${path}[${index}].acct`, { pattern: ACCOUNT_PATTERN });
    if (account !== undefined) {
      accounts.push(account);
    }
  });
  checkUnique(issues, accounts, path, (account) => account);
}

/** @param {readonly string[]} values */
function isStrictlySorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

/**
 * Payload validators by event kind. `actor` is "null" (system events) or "seat".
 * @type {Readonly<Record<string, { actor: "null" | "seat", check: (issues: Issues, d: Record<string, unknown>, path: string) => void, keys: readonly string[] | null }>>}
 */
const PAYLOADS = Object.freeze({
  [EventKind.GAME_CREATED]: {
    actor: "null",
    keys: ["content", "deck_c", "eng", "mode", "net", "seats", "seed_c"],
    check(issues, d, path) {
      checkEnum(issues, d.mode, `${path}.mode`, Object.values(GameMode));
      checkString(issues, d.net, `${path}.net`, { pattern: NETWORK_PATTERN });
      checkString(issues, d.eng, `${path}.eng`, { pattern: ENGINE_VERSION_PATTERN });
      checkHash(issues, d.content, `${path}.content`);
      checkHash(issues, d.seed_c, `${path}.seed_c`);
      checkArrayOf(issues, d.deck_c, `${path}.deck_c`, {
        minLength: SEATS.length,
        maxLength: SEATS.length,
        item: (item, itemPath) => checkHash(issues, item, itemPath),
      });
      checkSeatAssignments(issues, d.seats, `${path}.seats`);
    },
  },
  [EventKind.PLAYER_JOINED]: {
    actor: "seat",
    keys: ["ent", "src"],
    check(issues, d, path) {
      checkString(issues, d.ent, `${path}.ent`, { pattern: HEX_ENTROPY_PATTERN });
      checkEnum(issues, d.src, `${path}.src`, Object.values(EntropySource));
    },
  },
  [EventKind.GAME_STARTED]: {
    actor: "null",
    keys: ["first"],
    check(issues, d, path) {
      checkSeat(issues, d.first, `${path}.first`);
    },
  },
  [EventKind.MOVE]: {
    actor: "seat",
    keys: null, // an engine command: its fields depend on its type and are checked by the engine on replay
    check(issues, d, path) {
      checkCommand(issues, d, path);
    },
  },
  [EventKind.FORCED_MOVE]: {
    actor: "seat",
    keys: ["cmd", "why"],
    check(issues, d, path) {
      const command = checkCommand(issues, d.cmd, `${path}.cmd`);
      if (command !== undefined) {
        checkForcedCommand(issues, command, `${path}.cmd`);
      }
      checkEnum(issues, d.why, `${path}.why`, Object.values(ForcedMoveReason));
    },
  },
  [EventKind.STATE_CHECKPOINT]: {
    actor: "null",
    keys: ["sc", "ver"],
    check(issues, d, path) {
      checkInteger(issues, d.ver, `${path}.ver`, { min: 0 });
      checkHash(issues, d.sc, `${path}.sc`);
    },
  },
  [EventKind.GAME_FINISHED]: {
    actor: "null",
    keys: ["decks", "sc", "secret", "ver", "why", "win"],
    check(issues, d, path) {
      if (d.win !== null) {
        checkSeat(issues, d.win, `${path}.win`);
      }
      checkString(issues, d.why, `${path}.why`, { pattern: REASON_PATTERN });
      checkInteger(issues, d.ver, `${path}.ver`, { min: 0 });
      checkHash(issues, d.sc, `${path}.sc`);
      checkHash(issues, d.secret, `${path}.secret`);
      checkRevealedDecks(issues, d.decks, `${path}.decks`);
    },
  },
  [EventKind.GAME_ABORTED]: {
    actor: "null",
    keys: ["decks", "secret", "why"],
    check(issues, d, path) {
      checkString(issues, d.why, `${path}.why`, { pattern: REASON_PATTERN });
      checkHash(issues, d.secret, `${path}.secret`);
      if (d.decks !== undefined) {
        checkRevealedDecks(issues, d.decks, `${path}.decks`);
      }
    },
  },
});

/**
 * A forced move may only pass, end the turn, concede, or declare nothing.
 * @param {Issues} issues
 * @param {Record<string, unknown>} command
 * @param {string} path
 */
function checkForcedCommand(issues, command, path) {
  if (!FORCED_COMMAND_TYPES.includes(/** @type {string} */ (command.type))) {
    issues.add(`${path}.type`, `a forced move must be one of ${FORCED_COMMAND_TYPES.join(", ")}`);
    return;
  }
  const lists = ["attackerIds", "blocks", "targets"].filter((field) => field in command);
  for (const field of lists) {
    if (!Array.isArray(command[field]) || /** @type {unknown[]} */ (command[field]).length > 0) {
      issues.add(`${path}.${field}`, "a forced move declares nothing");
    }
  }
  const extra = Object.keys(command).filter((key) => key !== "type" && !lists.includes(key));
  if (extra.length > 0) {
    issues.add(path, `unexpected field(s) ${extra.join(", ")}`);
  }
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {Readonly<Record<string, unknown>> | undefined}
 */
export function checkEvent(issues, value, path) {
  const event = checkObject(issues, value, path, EVENT_KEYS);
  if (event === undefined) {
    return undefined;
  }
  checkInteger(issues, event.i, `${path}.i`, { min: 0 });
  checkInteger(issues, event.t, `${path}.t`, { min: 0, max: LIMITS.MAX_TURN });
  checkInteger(issues, event.ms, `${path}.ms`, { min: 0, max: LIMITS.MAX_ELAPSED_MS });
  const kind = checkEnum(issues, event.k, `${path}.k`, EVENT_KINDS);
  if (kind === undefined) {
    return undefined;
  }
  const spec = PAYLOADS[kind];
  if (spec.actor === "null" && event.a !== null) {
    issues.add(`${path}.a`, "expected null for a system event");
  }
  if (spec.actor === "seat") {
    checkSeat(issues, event.a, `${path}.a`);
  }
  const payload = checkObject(issues, event.d, `${path}.d`, spec.keys ?? undefined);
  if (payload !== undefined) {
    spec.check(issues, payload, `${path}.d`);
  }
  return event;
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {Readonly<Record<string, unknown>> | undefined}
 */
export function checkRecord(issues, value, path) {
  const record = checkObject(issues, value, path, RECORD_KEYS);
  if (record === undefined) {
    return undefined;
  }
  checkInteger(issues, record.v, `${path}.v`, { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION });
  checkString(issues, record.g, `${path}.g`, { pattern: GAME_ID_PATTERN });
  checkInteger(issues, record.s, `${path}.s`, { min: 0 });
  checkHash(issues, record.p, `${path}.p`);
  checkHash(issues, record.h, `${path}.h`);
  checkInteger(issues, record.ts, `${path}.ts`, { min: 0 });
  const events = checkArrayOf(issues, record.e, `${path}.e`, {
    minLength: 1,
    maxLength: LIMITS.MAX_EVENTS_PER_RECORD,
    item: (item, itemPath) => checkEvent(issues, item, itemPath),
  });
  if (events !== undefined && !events.every((event, index) => index === 0 || event.i === /** @type {number} */ (events[index - 1].i) + 1)) {
    issues.add(`${path}.e`, "event sequence numbers must be contiguous");
  }
  return record;
}

/**
 * @param {unknown} value
 * @returns {import("@magic8/engine/shared/Result.js").Ok<Readonly<Record<string, unknown>>> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateRecord(value) {
  const issues = new Issues();
  const record = checkRecord(issues, value, "record");
  return issues.toResult(record, SchemaError.INVALID_RECORD);
}

/**
 * @param {unknown} value parsed envelope
 * @returns {import("@magic8/engine/shared/Result.js").Ok<Readonly<{ v: number, r: readonly Readonly<Record<string, unknown>>[] }>> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateEnvelope(value) {
  const issues = new Issues();
  const envelope = checkObject(issues, value, "envelope", ENVELOPE_KEYS);
  if (envelope !== undefined) {
    checkInteger(issues, envelope.v, "envelope.v", { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION });
    checkArrayOf(issues, envelope.r, "envelope.r", {
      minLength: 1,
      maxLength: LIMITS.MAX_RECORDS_PER_ENVELOPE,
      item: (item, itemPath) => checkRecord(issues, item, itemPath),
    });
  }
  return issues.toResult(/** @type {any} */ (envelope), SchemaError.INVALID_ENVELOPE);
}
