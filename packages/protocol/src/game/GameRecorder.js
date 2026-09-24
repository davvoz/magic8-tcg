/**
 * Produces the protocol events of one game (docs/tcg/03-game-blockchain-protocol.md §7)
 * on top of an EventChain. It is the only place that knows event payload
 * layouts, commitments and reveals; the game server calls it at each step
 * and persists what it returns, the tests use it to build reference games.
 *
 * The recorder holds the game secret: it lives on the server only, next to
 * the authoritative engine, and is revealed by `finished` / `aborted`.
 */
import { EntropySource, EventKind, GameMode, SEATS } from "./constants.js";
import { canonicalDeck, deckCommitment, deriveEngineSeed, firstSeatFor, seedCommitment, stateCommitment, stateSalt } from "./commitments.js";
import { EventChain } from "./EventChain.js";
import { ProtocolError } from "./ProtocolError.js";

/**
 * @typedef {import("./EventChain.js").ChainedEvent} ChainedEvent
 * @typedef {readonly ({ cardId: string, count: number } | readonly [string, number])[]} DeckEntries
 * @typedef {Readonly<{ turn: number, ms: number }>} EventClock turn number of the engine and ms since game creation
 */

export class GameRecorder {
  #chain;
  #secret;
  #salt;
  /** @type {readonly (readonly (readonly [string, number])[])[]} */
  #decks;
  /** @type {Map<string, string>} seat → entropy */
  #entropies = new Map();

  /**
   * @param {{ gameId: string, secret: string, decks: readonly DeckEntries[], head?: string, nextSeq?: number, entropies?: Readonly<Record<string, string>> }} options
   *   `head`/`nextSeq`/`entropies` restore a recorder after a restart
   */
  constructor({ gameId, secret, decks, head, nextSeq, entropies = {} }) {
    if (!Array.isArray(decks) || decks.length !== SEATS.length) {
      throw new ProtocolError(`a game needs ${SEATS.length} decks`);
    }
    this.#chain = new EventChain({ gameId, head, nextSeq });
    this.#secret = secret;
    this.#salt = stateSalt(secret);
    this.#decks = Object.freeze(decks.map((deck) => canonicalDeck(deck)));
    for (const [seat, entropy] of Object.entries(entropies)) {
      this.#entropies.set(seat, entropy);
    }
  }

  get gameId() {
    return this.#chain.gameId;
  }

  get head() {
    return this.#chain.head;
  }

  get nextSeq() {
    return this.#chain.nextSeq;
  }

  /**
   * @param {{ mode: string, network: string, engineVersion: string, contentHash: string, accounts: readonly string[], ms: number }} input accounts in seat order
   * @returns {ChainedEvent}
   */
  created({ mode = GameMode.CASUAL, network, engineVersion, contentHash, accounts, ms }) {
    return this.#chain.append({
      k: EventKind.GAME_CREATED,
      a: null,
      t: 0,
      ms,
      d: {
        content: contentHash,
        deck_c: SEATS.map((_, index) => deckCommitment(this.#secret, index, this.#decks[index])),
        eng: engineVersion,
        mode,
        net: network,
        seats: SEATS.map((seat, index) => ({ acct: accounts[index], seat })),
        seed_c: seedCommitment(this.#secret),
      },
    });
  }

  /**
   * @param {{ seat: string, entropy: string, source?: string, ms: number }} input
   * @returns {ChainedEvent}
   */
  joined({ seat, entropy, source = EntropySource.CLIENT, ms }) {
    const event = this.#chain.append({ k: EventKind.PLAYER_JOINED, a: seat, t: 0, ms, d: { ent: entropy, src: source } });
    this.#entropies.set(seat, entropy);
    return event;
  }

  /** The engine key, available once every seat has contributed entropy. */
  get engineSeed() {
    if (this.#entropies.size !== SEATS.length) {
      throw new ProtocolError("the engine seed needs the entropy of every seat");
    }
    return deriveEngineSeed({ secret: this.#secret, entropies: SEATS.map((seat) => /** @type {string} */ (this.#entropies.get(seat))), gameId: this.gameId });
  }

  get firstSeat() {
    return firstSeatFor(this.engineSeed);
  }

  /** The decks in canonical form, seat order (what the engine must be built from). */
  get decks() {
    return this.#decks;
  }

  /**
   * @param {{ ms: number }} input
   * @returns {ChainedEvent}
   */
  started({ ms }) {
    return this.#chain.append({ k: EventKind.GAME_STARTED, a: null, t: 0, ms, d: { first: this.firstSeat } });
  }

  /**
   * @param {{ seat: string, command: Readonly<Record<string, unknown>>, clock: EventClock }} input `command` as the engine accepted it
   * @returns {ChainedEvent}
   */
  move({ seat, command, clock }) {
    return this.#chain.append({ k: EventKind.MOVE, a: seat, t: clock.turn, ms: clock.ms, d: withoutPlayerId(command) });
  }

  /**
   * @param {{ seat: string, command: Readonly<Record<string, unknown>>, reason: string, clock: EventClock }} input
   * @returns {ChainedEvent}
   */
  forcedMove({ seat, command, reason, clock }) {
    return this.#chain.append({ k: EventKind.FORCED_MOVE, a: seat, t: clock.turn, ms: clock.ms, d: { cmd: withoutPlayerId(command), why: reason } });
  }

  /**
   * @param {{ engineVersion: number, digest: unknown, clock: EventClock }} input
   * @returns {ChainedEvent}
   */
  checkpoint({ engineVersion, digest, clock }) {
    return this.#chain.append({ k: EventKind.STATE_CHECKPOINT, a: null, t: clock.turn, ms: clock.ms, d: { sc: stateCommitment(this.#salt, digest), ver: engineVersion } });
  }

  /**
   * @param {{ winner: string | null, reason: string, engineVersion: number, digest: unknown, clock: EventClock }} input
   * @returns {ChainedEvent}
   */
  finished({ winner, reason, engineVersion, digest, clock }) {
    return this.#chain.append({
      k: EventKind.GAME_FINISHED,
      a: null,
      t: clock.turn,
      ms: clock.ms,
      d: { decks: this.#revealedDecks(), sc: stateCommitment(this.#salt, digest), secret: this.#secret, ver: engineVersion, why: reason, win: winner },
    });
  }

  /**
   * @param {{ reason: string, started: boolean, clock: EventClock }} input
   * @returns {ChainedEvent}
   */
  aborted({ reason, started, clock }) {
    const d = started ? { decks: this.#revealedDecks(), secret: this.#secret, why: reason } : { secret: this.#secret, why: reason };
    return this.#chain.append({ k: EventKind.GAME_ABORTED, a: null, t: clock.turn, ms: clock.ms, d });
  }

  #revealedDecks() {
    return this.#decks.map((deck) => deck.map(([cardId, count]) => [cardId, count]));
  }
}

/**
 * @param {Readonly<Record<string, unknown>>} command
 */
function withoutPlayerId(command) {
  return Object.fromEntries(Object.entries(command).filter(([key]) => key !== "playerId"));
}
