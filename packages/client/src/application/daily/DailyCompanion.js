/**
 * The character's voice during a daily challenge (docs/tcg/24-sfide.md):
 * it watches the online game and, when that game is against a character of
 * the day, has the character speak at the moments its lines are written for:
 *
 * - intro: as the game starts (with the rules it brings, a boss's conditions);
 * - low: the first time it falls to LOW_LIFE or less;
 * - win / lose: when the game ends, as the character sees it.
 *
 * Each line is said once per game, picked by the game's id (the same line if
 * the page is reloaded). How it is shown (a toast) is the caller's business.
 */
import { lineFor } from "./characters.js";

/** At this life or less, a character is nearly beaten. */
export const LOW_LIFE = 5;

/** A game first seen in these turns is one starting: its intro is still timely. */
const OPENING_TURNS = 2;

export const LineKind = Object.freeze({ INTRO: "intro", LOW: "low", WIN: "win", LOSE: "lose" });

/**
 * @typedef {import("../ports/DailyApi.contract.js").DailyOpponent} DailyOpponent
 * @typedef {Readonly<{ opponent: DailyOpponent, kind: string, line: string, gameId: string }>} Speech
 */

export class DailyCompanion {
  #online;
  #daily;
  #say;
  /** @type {Map<string, Set<string>>} game id → the kinds of line said in it */
  #said = new Map();

  /**
   * @param {{
   *   online: Pick<import("../online/OnlineService.js").OnlineService, "state" | "subscribe">,
   *   daily: Pick<import("./DailyService.js").DailyService, "characterOf">,
   *   say: (speech: Speech) => void,
   * }} deps
   */
  constructor({ online, daily, say }) {
    this.#online = online;
    this.#daily = daily;
    this.#say = say;
  }

  /**
   * Starts listening to the online games.
   * @returns {() => void} stops listening
   */
  start() {
    const stop = this.#online.subscribe((state) => this.#follow(state.session));
    this.#follow(this.#online.state.session);
    return stop;
  }

  /** @param {import("../online/RemoteMatchSession.js").RemoteMatchSession | null} session */
  #follow(session) {
    if (session === null || session.seat === null || !session.hasSnapshot) {
      return;
    }
    const snapshot = session.snapshotFor(session.seat);
    const rival = snapshot.players.find((/** @type {{ id: string }} */ player) => player.id !== session.seat);
    const opponent = this.#daily.characterOf(rival?.name);
    if (rival === undefined || opponent === null) {
      return;
    }
    const kind = speechKind(snapshot, rival);
    if (kind !== null) {
      this.#speak(opponent, kind, session.gameId);
    }
    // A game the page first sees already under way still had its start: the intro is not said late.
    this.#mark(session.gameId, LineKind.INTRO);
  }

  /**
   * @param {DailyOpponent} opponent
   * @param {string} kind
   * @param {string} gameId
   */
  #speak(opponent, kind, gameId) {
    if (this.#saidIn(gameId).has(kind)) {
      return;
    }
    this.#mark(gameId, kind);
    const line = lineFor(opponent.lines[/** @type {"intro" | "low" | "win" | "lose"} */ (kind)], `${gameId}|${kind}`);
    if (line !== null) {
      this.#say(Object.freeze({ opponent, kind, line, gameId }));
    }
  }

  /** @param {string} gameId */
  #saidIn(gameId) {
    return this.#said.get(gameId) ?? new Set();
  }

  /**
   * @param {string} gameId
   * @param {string} kind
   */
  #mark(gameId, kind) {
    this.#said.set(gameId, this.#saidIn(gameId).add(kind));
  }
}

/**
 * What the character has to say about the game as it stands, if anything.
 * @param {any} snapshot the player's own
 * @param {{ id: string, life: number }} rival the character's seat
 * @returns {string | null}
 */
function speechKind(snapshot, rival) {
  if (snapshot.isOver) {
    return snapshot.winnerId === rival.id ? LineKind.WIN : LineKind.LOSE;
  }
  if (rival.life <= LOW_LIFE) {
    return LineKind.LOW;
  }
  // Seen in its first turns, the game has just started (the AI may well have moved first).
  return snapshot.turnNumber <= OPENING_TURNS ? LineKind.INTRO : null;
}
