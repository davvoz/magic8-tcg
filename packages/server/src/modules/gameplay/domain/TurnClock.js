/**
 * Time limits of a game (docs/tcg/02-protocollo-multiplayer.md §3.6–3.7),
 * as pure arithmetic over milliseconds: the actor asks who must act by when.
 *
 * - A decision (a phase of your turn, or blocking) has a base time; a turn
 *   decision may also spend the seat's reserve, which shrinks by whatever a
 *   decision took beyond its base time.
 * - A disconnected seat waits at most `disconnectGraceMs` before the server
 *   acts for it; absent longer than `abandonMs`, or after `maxForcedTurns`
 *   turns in a row ended by the server, it forfeits.
 *
 * @typedef {Readonly<{ entropyMs: number, turnMs: number, blockMs: number, reserveMs: number, disconnectGraceMs: number, abandonMs: number, maxForcedTurns: number }>} TimePolicy
 */

export const DEFAULT_TIME_POLICY = Object.freeze({
  entropyMs: 15_000,
  turnMs: 90_000,
  blockMs: 30_000,
  reserveMs: 90_000,
  disconnectGraceMs: 60_000,
  abandonMs: 180_000,
  maxForcedTurns: 3,
});

export class TurnClock {
  #policy;
  /** @type {Map<string, number>} seat → reserve left */
  #reserve;
  /** @type {Map<string, number>} seat → disconnected since */
  #absentSince = new Map();
  /** @type {Map<string, number>} seat → turns in a row ended by the server */
  #forcedTurns = new Map();
  /** @type {{ seat: string, blocking: boolean, since: number } | null} */
  #decision = null;

  /**
   * @param {TimePolicy} policy
   * @param {readonly string[]} seats
   */
  constructor(policy, seats) {
    this.#policy = policy;
    this.#reserve = new Map(seats.map((seat) => [seat, policy.reserveMs]));
  }

  get policy() {
    return this.#policy;
  }

  /**
   * The engine now waits on `seat` (or nobody). A new decision starts only
   * when the seat or its kind changes, so a phase change inside one player's
   * turn keeps counting against the same decision.
   * @param {{ seat: string | null, blocking: boolean, now: number }} awaiting
   */
  awaiting({ seat, blocking, now }) {
    if (seat === null) {
      this.#decision = null;
      return;
    }
    if (this.#decision === null || this.#decision.seat !== seat || this.#decision.blocking !== blocking) {
      this.#decision = { seat, blocking, since: now };
    }
  }

  /**
   * The awaited seat acted itself: charge the reserve and clear its forced streak.
   * @param {string} seat
   * @param {number} now
   */
  acted(seat, now) {
    this.#forcedTurns.set(seat, 0);
    const decision = this.#decision;
    if (decision === null || decision.seat !== seat || decision.blocking) {
      return;
    }
    const over = now - decision.since - this.#policy.turnMs;
    if (over > 0) {
      this.#reserve.set(seat, Math.max(0, (this.#reserve.get(seat) ?? 0) - over));
    }
  }

  /**
   * The server ended a turn for `seat`.
   * @param {string} seat
   * @returns {boolean} whether the seat has now reached the forced-turn limit
   */
  forcedTurnEnded(seat) {
    const streak = (this.#forcedTurns.get(seat) ?? 0) + 1;
    this.#forcedTurns.set(seat, streak);
    return streak >= this.#policy.maxForcedTurns;
  }

  /**
   * @param {string} seat
   * @param {boolean} connected
   * @param {number} now
   */
  presence(seat, connected, now) {
    if (connected) {
      this.#absentSince.delete(seat);
    } else if (!this.#absentSince.has(seat)) {
      this.#absentSince.set(seat, now);
    }
  }

  /** @param {string} seat */
  isAbsent(seat) {
    return this.#absentSince.has(seat);
  }

  /**
   * @param {number} now
   * @returns {Readonly<{ seat: string, why: "timeout" | "disconnect" | "abandon" }> | null} what the server must do for whom, if anything
   */
  due(now) {
    const decision = this.#decision;
    if (decision === null) {
      return null;
    }
    const absentSince = this.#absentSince.get(decision.seat);
    if (absentSince !== undefined && now - absentSince >= this.#policy.abandonMs) {
      return Object.freeze({ seat: decision.seat, why: "abandon" });
    }
    if (absentSince !== undefined && now >= Math.max(absentSince, decision.since) + this.#policy.disconnectGraceMs) {
      return Object.freeze({ seat: decision.seat, why: "disconnect" });
    }
    const deadline = this.deadline();
    return deadline !== null && now >= deadline ? Object.freeze({ seat: decision.seat, why: "timeout" }) : null;
  }

  /** When the current decision times out (ignoring disconnection), or null when nobody is awaited. */
  deadline() {
    const decision = this.#decision;
    if (decision === null) {
      return null;
    }
    return decision.blocking ? decision.since + this.#policy.blockMs : decision.since + this.#policy.turnMs + (this.#reserve.get(decision.seat) ?? 0);
  }

  /** For the clients' clocks. */
  view() {
    return Object.freeze({
      activeSeat: this.#decision?.seat ?? null,
      deadline: this.deadline(),
      reserveMs: Object.freeze(Object.fromEntries(this.#reserve)),
    });
  }
}
