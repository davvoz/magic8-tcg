/**
 * An opponent that follows a script, turn by turn: on its own turns it plays
 * the listed cards and attacks with the listed creatures; on the other
 * player's turns it does not block. Cards are named
 * by definition id, so the script reads like the deck it was written for.
 *
 * Past the script, or whenever a scripted move is not legal (the cards are
 * not where the script expected them), the fallback controller decides: the
 * session never sees an illegal command, and the match can always go on.
 * Works from its perspective snapshot only, like every controller.
 *
 * Used by the tutorial, whose lesson needs the opponent to make exactly the
 * moves the coach talks about.
 */
import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { BasicAiController } from "./BasicAiController.js";
import { ControllerKind } from "./PlayerController.contract.js";

/**
 * One of the controller's own turns: `play`, the cards to play from hand in
 * main phase 1, in order (cards needing no target); `attack`, the creatures
 * to attack with. An empty entry stands for one of the other player's turns.
 * @typedef {Readonly<{ play?: readonly string[], attack?: readonly string[] }>} ScriptedTurn
 */

/** @typedef {ReturnType<import("@magic8/engine/domain/game/GameEngine.js").GameEngine["getSnapshot"]>} Snapshot */

export class ScriptedAiController {
  kind = ControllerKind.AI;
  /** @type {ReadonlyMap<number, ScriptedTurn>} */
  #script;
  #fallback;

  /**
   * @param {{ script: Readonly<Record<number, ScriptedTurn>>, fallback?: import("./PlayerController.contract.js").PlayerController }} options
   *   `script`: what to do on each turn number it covers; any other turn is the fallback's
   */
  constructor({ script, fallback = new BasicAiController() }) {
    this.#script = new Map(Object.entries(script).map(([turn, plan]) => [Number(turn), plan]));
    this.#fallback = fallback;
  }

  /**
   * @param {Snapshot} snapshot
   * @returns {Readonly<Record<string, unknown>> | null}
   */
  decide(snapshot) {
    const me = snapshot.perspectivePlayerId;
    const plan = this.#script.get(snapshot.turnNumber);
    if (me === null || snapshot.isOver || snapshot.awaitingPlayerId !== me || snapshot.legalMoves === null) {
      return null;
    }
    if (plan === undefined) {
      return this.#fallback.decide(snapshot);
    }
    return scripted(snapshot, me, plan) ?? this.#fallback.decide(snapshot);
  }
}

/**
 * The scripted move for this moment, or null when the script cannot be followed.
 * @param {Snapshot} snapshot
 * @param {string} me
 * @param {ScriptedTurn} plan
 */
function scripted(snapshot, me, plan) {
  const moves = /** @type {NonNullable<Snapshot["legalMoves"]>} */ (snapshot.legalMoves);
  const self = snapshot.players.find((player) => player.id === me);
  if (self === undefined) {
    return null;
  }
  switch (snapshot.phase) {
    case GamePhase.MAIN_1: {
      const card = (self.hand ?? []).find((candidate) => (plan.play ?? []).includes(candidate.definitionId) && moves.playableCardIds.includes(candidate.instanceId));
      if (card !== undefined) {
        return (moves.targetOptions[card.instanceId] ?? []).some((options) => options.length > 0) ? null : playCard(me, card.instanceId);
      }
      return (plan.attack ?? []).length > 0 ? endPhase(me) : endTurn(me);
    }
    case GamePhase.COMBAT_ATTACKERS:
      return declareAttackers(me, self.battlefield.filter((card) => (plan.attack ?? []).includes(card.definitionId) && moves.attackerIds.includes(card.instanceId)).map((card) => card.instanceId));
    case GamePhase.COMBAT_BLOCKERS:
      return declareBlockers(me, []);
    case GamePhase.MAIN_2:
      return endTurn(me);
    default:
      return null;
  }
}
