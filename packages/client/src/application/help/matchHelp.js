/**
 * What the match help shouts at a given moment, so the player sees what to
 * do without reading: a headline of two or three words over the table, the
 * one-word label stuck on every card or portrait that can be tapped now,
 * and a label on every side-panel button that can be pressed now, saying
 * what it does. One option is the move the help suggests (`primary`): the
 * cards to tap, or one button; the others are shown as the other ways on.
 *
 * Pure: it reads the snapshot the board shows (its `legalMoves` say what is
 * allowed, so nothing here re-implements a rule) and what the player has
 * chosen so far. Which cards can be tapped, and which buttons are on the
 * panel and enabled, the board already knows: the help only says what each
 * does, and the board points at those that are there.
 *
 * Nothing is shouted while the game waits on the other player: the board's
 * own banner says whose turn it is.
 */
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";

/** @typedef {ReturnType<import("../match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot */
/** @typedef {import("../tutorial/TutorialCoach.js").Intent} Intent */

/** What the moment is about; the board gives each its colour. */
export const HelpTone = Object.freeze({
  PLAY: "play",
  ATTACK: "attack",
  BLOCK: "block",
  TARGET: "target",
  NEXT: "next",
});

/**
 * @typedef {Readonly<{ id: string, label: string, primary: boolean }>} HelpButton a side-panel button ("confirm", "cancel",
 *   "endPhase", "endTurn"), what it does, and whether it is the move suggested
 * @typedef {Readonly<{
 *   headline: string,
 *   tone: string,
 *   marks: Readonly<{ playable: string | null, targetable: string | null }>,
 *   buttons: readonly HelpButton[],
 * }>} MatchHelp `headline`: over the table; `tone`: a HelpTone; `marks`: the label on what the board marks as playable,
 *   and on what it marks as targetable (null: no label); tapping them is the suggested move whenever there are any
 */

const END_TURN = "END TURN";
const CANCEL = "CANCEL";
const GO = "GO!";

/**
 * @param {{ snapshot: Snapshot, playerId: string, intent: Intent }} moment
 * @returns {MatchHelp | null} null when there is nothing for the player to do (the opponent's turn, the match over)
 */
export function helpFor({ snapshot, playerId, intent }) {
  const moves = snapshot.legalMoves;
  if (snapshot.isOver || snapshot.awaitingPlayerId !== playerId || moves === null) {
    return null;
  }
  switch (snapshot.phase) {
    case GamePhase.COMBAT_ATTACKERS:
      return attacking(intent, moves.attackerIds.length > 0);
    case GamePhase.COMBAT_BLOCKERS:
      return blocking(intent, moves.blockerIds.length > 0);
    default:
      return mainPhase(snapshot.phase, intent, moves.playableCardIds.length > 0);
  }
}

/**
 * Main phase 1 or 2: cards to play; then on to combat, or (after it) the turn's end.
 * @param {string} phase
 * @param {Intent} intent
 * @param {boolean} canPlay
 * @returns {MatchHelp}
 */
function mainPhase(phase, intent, canPlay) {
  if (intent.targetingCardId !== null) {
    return shout("PICK A TARGET!", HelpTone.TARGET, { targetable: "TARGET" }, [["cancel", CANCEL]]);
  }
  if (intent.pickedCardId !== null) {
    return shout("PLAY IT!", HelpTone.PLAY, { playable: "PLAY" }, [["confirm", "PLAY!", true], ["cancel", CANCEL]]);
  }
  const first = phase === GamePhase.MAIN_1;
  // After combat, ending the phase ends the turn.
  const endPhase = first ? "COMBAT" : END_TURN;
  const next = first ? "endPhase" : "endTurn";
  const buttons = /** @type {const} */ ([["endPhase", endPhase], ["endTurn", END_TURN]]).map(([id, label]) => /** @type {[string, string, boolean]} */ ([id, label, !canPlay && id === next]));
  if (canPlay) {
    return shout("PLAY A CARD!", HelpTone.PLAY, { playable: "PLAY" }, buttons);
  }
  return shout(first ? "TO COMBAT!" : "END YOUR TURN!", HelpTone.NEXT, {}, buttons);
}

/**
 * Choosing attackers on the player's turn; ending the phase skips combat.
 * @param {Intent} intent
 * @param {boolean} canAttack
 * @returns {MatchHelp}
 */
function attacking(intent, canAttack) {
  const others = /** @type {[string, string][]} */ ([["endPhase", "SKIP"], ["endTurn", END_TURN]]);
  if (!canAttack) {
    return shout("NO ATTACKERS", HelpTone.NEXT, {}, [["confirm", "SKIP", true], ...others]);
  }
  if (intent.attackerIds.length === 0) {
    return shout("ATTACK!", HelpTone.ATTACK, { playable: "ATTACK" }, [["confirm", "SKIP"], ...others]);
  }
  return shout("ATTACK!", HelpTone.ATTACK, { playable: "ATTACK" }, [["confirm", GO, true], ["cancel", CANCEL], ...others]);
}

/**
 * Choosing blockers while the opponent attacks: a blocker first, then the attacker it stops.
 * @param {Intent} intent
 * @param {boolean} canBlock
 * @returns {MatchHelp}
 */
function blocking(intent, canBlock) {
  if (!canBlock) {
    return shout("YOU'RE ATTACKED!", HelpTone.NEXT, {}, [["confirm", "TAKE IT", true]]);
  }
  if (intent.pendingBlockerId !== null) {
    return shout("BLOCK WHICH?", HelpTone.BLOCK, { targetable: "THIS ONE?" }, [["confirm", intent.blocks.length === 0 ? "NO BLOCK" : GO], ["cancel", CANCEL]]);
  }
  if (intent.blocks.length === 0) {
    return shout("BLOCK!", HelpTone.BLOCK, { playable: "BLOCK" }, [["confirm", "NO BLOCK"]]);
  }
  return shout("BLOCK!", HelpTone.BLOCK, { playable: "BLOCK" }, [["confirm", GO, true], ["cancel", CANCEL]]);
}

/**
 * @param {string} headline
 * @param {string} tone
 * @param {{ playable?: string, targetable?: string }} marks
 * @param {readonly (readonly [string, string, boolean?])[]} buttons each id, label and whether it is the suggested move
 * @returns {MatchHelp}
 */
function shout(headline, tone, { playable, targetable }, buttons) {
  return Object.freeze({
    headline,
    tone,
    marks: Object.freeze({ playable: playable ?? null, targetable: targetable ?? null }),
    buttons: Object.freeze(buttons.map(([id, label, primary = false]) => Object.freeze({ id, label, primary }))),
  });
}
