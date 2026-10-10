/**
 * How fast a replay plays (docs/tcg/23-automatica.md). The replay's session
 * waits on its pace before each move.
 *
 * At Normal and Fast the pace first waits for the board to finish showing
 * the move before, then pauses: every move is seen whole, as in a game
 * played by hand. At Very fast the moves come at a steady beat whatever the
 * board is showing; a board left far behind catches up without animating.
 *
 * The board says when it is busy (`follow`); with no board following, the
 * pace only pauses.
 */
export const ReplaySpeed = Object.freeze({
  NORMAL: "normal",
  FAST: "fast",
  VERY_FAST: "very_fast",
});

/** The speeds, slowest first. @type {readonly string[]} */
export const REPLAY_SPEEDS = Object.freeze([ReplaySpeed.NORMAL, ReplaySpeed.FAST, ReplaySpeed.VERY_FAST]);

/** Per speed: the pause before a move, and whether the move waits for the board to finish the one before. */
const PACES = Object.freeze({
  [ReplaySpeed.NORMAL]: Object.freeze({ pauseMs: 1000, followsBoard: true }),
  [ReplaySpeed.FAST]: Object.freeze({ pauseMs: 300, followsBoard: true }),
  [ReplaySpeed.VERY_FAST]: Object.freeze({ pauseMs: 260, followsBoard: false }),
});

/** How often a waiting move looks again whether the board is done. */
const POLL_MS = 50;

const idle = () => false;

export class ReplayPace {
  #scheduler;
  #speed;
  #onSpeed;
  /** @type {() => boolean} */
  #boardBusy = idle;

  /**
   * @param {{ scheduler: import("../ports/Scheduler.contract.js").Scheduler, speed?: string, onSpeed?: (speed: string) => void }} deps
   *   `speed`: the one to start at; `onSpeed`: told of every change, so the next replay can start at it
   */
  constructor({ scheduler, speed = ReplaySpeed.NORMAL, onSpeed = () => undefined }) {
    this.#scheduler = scheduler;
    this.#speed = REPLAY_SPEEDS.includes(speed) ? speed : ReplaySpeed.NORMAL;
    this.#onSpeed = onSpeed;
  }

  get speed() {
    return this.#speed;
  }

  /** @param {string} speed one of REPLAY_SPEEDS; anything else is ignored */
  setSpeed(speed) {
    if (!REPLAY_SPEEDS.includes(speed) || speed === this.#speed) {
      return;
    }
    this.#speed = speed;
    this.#onSpeed(speed);
  }

  /**
   * The board that shows the replay, and how to tell it is still showing a move; null when it leaves.
   * @param {(() => boolean) | null} isBusy
   */
  follow(isBusy) {
    this.#boardBusy = isBusy ?? idle;
  }

  /** Resolves when the next move may be made. */
  async wait() {
    if (PACES[this.#speed].followsBoard) {
      do {
        await this.#scheduler.delay(POLL_MS);
      } while (this.#boardBusy() && PACES[this.#speed].followsBoard);
    }
    await this.#scheduler.delay(PACES[this.#speed].pauseMs);
  }
}
