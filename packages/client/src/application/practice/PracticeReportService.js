/**
 * Use case: have a practice game against the AI counted toward ranked play.
 * Once a signed-in player's practice game is over, its transcript (seed,
 * decks, every move) goes to the server, which plays it again before it
 * counts it. Nothing waits on the answer: the game ends as it always did,
 * and the lobby reads the player's standing again when it opens.
 */

export class PracticeReportService {
  #api;
  #logger;

  /** @param {{ api: import("../ports/PracticeApi.contract.js").PracticeApi, logger: import("../ports/Logger.contract.js").Logger }} deps */
  constructor({ api, logger }) {
    this.#api = api;
    this.#logger = logger;
  }

  /**
   * Sends the session's game once it is over; a session that cannot be played again (no transcript) is left alone.
   * @param {import("../match/MatchSession.js").MatchSession} session
   * @param {string} you the player's own seat
   */
  track(session, you) {
    if (session.transcript === null) {
      return;
    }
    const stop = session.subscribe(() => {
      const transcript = session.transcript;
      if (!session.isOver || transcript === null) {
        return;
      }
      stop();
      void this.#send({ ...transcript, you });
    });
  }

  /** @param {import("../ports/PracticeApi.contract.js").PracticeReport} report */
  async #send(report) {
    const result = await this.#api.report(report);
    if (result.ok) {
      this.#logger.info("practice game sent", { counted: result.value.counted, practiceGames: result.value.practiceGames });
    } else {
      this.#logger.warn("practice game not counted", { error: result.error.message });
    }
  }
}
