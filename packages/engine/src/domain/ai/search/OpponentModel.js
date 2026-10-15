/**
 * How the search AI expects its opponent to answer inside a simulated turn:
 * in practice, how they will block its attack. The model is another AI
 * policy, seen from the opponent's seat of the rebuilt game (whose hand is
 * unknown cards, as far as the AI knows). The default is BasicAi: it blocks
 * sensibly and costs nothing to ask, which matters because the search asks
 * it once for every attack it tries.
 */
import { AiStyle, BasicAi } from "../BasicAi.js";

export class OpponentModel {
  #policy;

  /** @param {import("../AiPolicy.contract.js").AiPolicy} [policy] */
  constructor(policy = new BasicAi(AiStyle.BALANCED)) {
    this.#policy = policy;
  }

  /**
   * @param {import("../../game/GameEngine.js").GameEngine} engine a rebuilt game awaiting the opponent
   * @param {string} opponentId
   * @returns {Readonly<Record<string, unknown>> | null}
   */
  answer(engine, opponentId) {
    return this.#policy.decide(engine.getSnapshot(opponentId));
  }
}
