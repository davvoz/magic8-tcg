/**
 * Constants of the Game Blockchain Protocol v1
 * (docs/tcg/03-game-blockchain-protocol.md). Changing any of them changes
 * the protocol: bump PROTOCOL_VERSION and keep verifiers for old versions.
 */

/**
 * Version of the payload formats that did not change since v1: envelopes,
 * manifests, receipts, pack epochs, acks.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Versions of the game record format (records and their events). A game
 * keeps the version it was created with; verifiers accept both.
 * - 1: moves as the server recorded them.
 * - 2: every player move is signed with a session key the player's account
 *   authorised (SESSION events), docs/tcg/12-mosse-firmate.md.
 */
export const GameProtocol = Object.freeze({ V1: 1, V2: 2 });
/** @type {readonly number[]} */
export const GAME_PROTOCOL_VERSIONS = Object.freeze([GameProtocol.V1, GameProtocol.V2]);
export const LATEST_GAME_PROTOCOL = GameProtocol.V2;

/** `custom_json` ids (at most 32 characters on STEEM). */
export const OperationId = Object.freeze({
  GAME: "m8tcg_game",
  RECEIPT: "m8tcg_receipt",
  MANIFEST: "m8tcg_manifest",
  /** Pack epoch commitments and reveals, published by the broadcaster pool. */
  EPOCH: "m8tcg_epoch",
  /** Card-for-card trades between players (docs/tcg/13). */
  TRADE: "m8tcg_trade",
  /** Copies sold between players for a direct payment (docs/tcg/14). */
  SALE: "m8tcg_sale",
});

export const EventKind = Object.freeze({
  GAME_CREATED: "GAME_CREATED",
  PLAYER_JOINED: "PLAYER_JOINED",
  GAME_STARTED: "GAME_STARTED",
  MOVE: "MOVE",
  FORCED_MOVE: "FORCED_MOVE",
  STATE_CHECKPOINT: "STATE_CHECKPOINT",
  GAME_FINISHED: "GAME_FINISHED",
  GAME_ABORTED: "GAME_ABORTED",
  /** v2: a seat's session key, authorised by the seat account's posting key. */
  SESSION: "SESSION",
});

export const EVENT_KINDS = Object.freeze(Object.values(EventKind));

/** Seats double as the engine's player ids. */
export const Seat = Object.freeze({ S0: "s0", S1: "s1" });
export const SEATS = Object.freeze([Seat.S0, Seat.S1]);

export const GameMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });

export const EntropySource = Object.freeze({ CLIENT: "client", SERVER: "server" });

export const ForcedMoveReason = Object.freeze({ TIMEOUT: "timeout", DISCONNECT: "disconnect", ABANDON: "abandon" });

/** Engine command types the server may issue on a seat's behalf, and only in their "do nothing" form. */
export const FORCED_COMMAND_TYPES = Object.freeze(["END_PHASE", "END_TURN", "CONCEDE", "DECLARE_ATTACKERS", "DECLARE_BLOCKERS"]);

export const LIMITS = Object.freeze({
  /** STEEM_CUSTOM_OP_DATA_MAX_LENGTH */
  MAX_OPERATION_BYTES: 8192,
  MAX_RECORDS_PER_ENVELOPE: 16,
  MAX_EVENTS_PER_RECORD: 256,
  MAX_TURN: 10000,
  /** ~115 days in milliseconds: a game never lasts this long. */
  MAX_ELAPSED_MS: 10_000_000_000,
  MAX_COMMAND_BYTES: 1024,
  MAX_DECK_ENTRIES: 200,
  MAX_CARD_COPIES: 99,
  ENTROPY_BYTES: 16,
  SECRET_BYTES: 32,
});

/** ULID in lowercase Crockford base32 (no i, l, o, u). */
export const GAME_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;

/** Network-agnostic account name: lowercase, starts alphanumeric, at most 40 characters (the engine's player name limit). Networks apply stricter rules. */
export const ACCOUNT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export const NETWORK_PATTERN = /^[a-z0-9_-]{1,16}$/;
export const ENGINE_VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;
export const REASON_PATTERN = /^[a-z_]{1,32}$/;
export const CARD_ID_PATTERN = /^[a-z0-9_]{1,40}$/;
