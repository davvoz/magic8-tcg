/**
 * Walks a player through the tutorial match, one step at a time. Pure: it
 * reads the snapshots the match screen shows and says what to tell the
 * player and what they may touch; it never plays a move.
 *
 * A step is one of three kinds:
 * - a lesson (`text`): a short explanation, read while the board waits;
 *   "Next" (`next()`) moves on. Nothing can be played meanwhile.
 * - a task (`hint`, `until`): one line saying what to do, which follows
 *   what the player has chosen so far (tap this, now that, now confirm).
 *   Only what the task names can be tapped (`taps`), pressed (`buttons`) or
 *   confirmed (`confirm`); it is done once `until` holds on a shown
 *   snapshot. A `free` task lets the player do anything. A task with
 *   nothing to tap or press is a wait: the opponent's turn.
 *
 * Lessons and tasks point at what they talk about (`focus`): a card, one of
 * its gems, a player's life or mana, the hand, a button.
 *
 * Texts mark names: `{Scrap Golem}` a card, `[End turn]` a button.
 *
 * Steps run in order and are checked on every snapshot (`sync`): tasks and
 * waits whose condition already holds are passed straight away, a lesson
 * always waits for its "Next".
 */
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";

/** @typedef {ReturnType<import("../match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot */
/** @typedef {"mine" | "theirs"} Side */
/** @typedef {"hand" | "battlefield"} ZoneName */

/**
 * What the player has chosen so far: the picked hand card (played on "Play"
 * on a phone), the card whose target is being chosen, the attackers chosen,
 * the blocker waiting for its attacker, the blocks assigned.
 * @typedef {Readonly<{ pickedCardId: string | null, targetingCardId: string | null, attackerIds: readonly string[], pendingBlockerId: string | null, blocks: readonly Readonly<{ attackerId: string, blockerId: string }>[] }>} Intent
 */

/** Nothing chosen. @type {Intent} */
export const NO_INTENT = Object.freeze({ pickedCardId: null, targetingCardId: null, attackerIds: Object.freeze([]), pendingBlockerId: null, blocks: Object.freeze([]) });

/**
 * What the coach can point at: a card (`card:<instance id>`), its cost gem,
 * attack or health (`cost:`, `attack:`, `health:<instance id>`); a player's
 * portrait, life or mana (`hud:`, `life:`, `mana:` + `mine` or `theirs`);
 * the player's hand (`hand:mine`); a button of the side panel (`button:<id>`).
 * @typedef {string} FocusTarget
 */

/**
 * @typedef {Readonly<{
 *   id: string,
 *   title?: string,
 *   text?: string,
 *   hint?: string | ((view: TutorialView, intent: Intent) => string),
 *   until?: (view: TutorialView) => boolean,
 *   taps?: (view: TutorialView) => readonly string[],
 *   buttons?: readonly string[],
 *   confirm?: (intent: Intent, view: TutorialView) => boolean,
 *   focus?: (view: TutorialView, intent: Intent) => readonly FocusTarget[],
 *   free?: boolean,
 * }>} TutorialStep `title` and `text`: a lesson; `hint`: a task's line; `buttons`: the side panel's buttons a task allows
 *   ("endPhase", "endTurn"); `confirm`: whether a task lets the player confirm what they chose (by default: playing a card it lets them tap)
 */

/** The board as the coach reads it: whose turn, which phase, which cards where. */
export class TutorialView {
  #snapshot;
  #playerId;

  /**
   * @param {Snapshot} snapshot
   * @param {string} playerId the player being taught
   */
  constructor(snapshot, playerId) {
    this.#snapshot = snapshot;
    this.#playerId = playerId;
  }

  get turn() {
    return this.#snapshot.turnNumber;
  }

  get phase() {
    return this.#snapshot.phase;
  }

  get isOver() {
    return this.#snapshot.isOver;
  }

  /** True on the player's own turn, while the game is on. */
  get myTurn() {
    return !this.#snapshot.isOver && this.#snapshot.activePlayerId === this.#playerId;
  }

  /**
   * True when the game waits on the player in `phase`.
   * @param {string} phase
   */
  awaitsMeIn(phase) {
    return !this.#snapshot.isOver && this.#snapshot.awaitingPlayerId === this.#playerId && this.#snapshot.phase === phase;
  }

  /**
   * True in main phase 1 of one of the player's turns, from turn `turn` on.
   * @param {number} turn
   */
  myMainPhaseFrom(turn) {
    return this.awaitsMeIn(GamePhase.MAIN_1) && this.#snapshot.turnNumber >= turn;
  }

  /**
   * Instance ids of the cards of one kind in a zone.
   * @param {string} definitionId
   * @param {Side} side
   * @param {ZoneName} zone
   * @returns {string[]}
   */
  ids(definitionId, side, zone) {
    const player = this.#snapshot.players.find((candidate) => (candidate.id === this.#playerId) === (side === "mine"));
    return (player?.[zone] ?? []).filter((card) => card.definitionId === definitionId).map((card) => card.instanceId);
  }

  /**
   * @param {string} definitionId
   * @param {Side} side
   * @param {ZoneName} zone
   */
  has(definitionId, side, zone) {
    return this.ids(definitionId, side, zone).length > 0;
  }
}

export class TutorialCoach {
  /** @type {readonly TutorialStep[]} */
  #steps;
  #playerId;
  #index = 0;
  /** @type {TutorialView | null} */
  #view = null;
  /** The indices of the lessons among the steps. @type {readonly number[]} */
  #lessons;

  /**
   * @param {{ steps: readonly TutorialStep[], playerId: string }} options
   */
  constructor({ steps, playerId }) {
    this.#steps = steps;
    this.#playerId = playerId;
    this.#lessons = steps.flatMap((step, index) => (step.text === undefined ? [] : [index]));
  }

  /** The player being taught. */
  get playerId() {
    return this.#playerId;
  }

  /** The current step, null once the tutorial is over. */
  get step() {
    return this.#steps[this.#index] ?? null;
  }

  get isFinished() {
    return this.step === null;
  }

  /** The lesson to read now, with its number among the lessons; null when the current step is not one. */
  get lesson() {
    const step = this.step;
    if (step === null || step.text === undefined) {
      return null;
    }
    return Object.freeze({ title: step.title ?? "", text: step.text, number: this.#lessons.indexOf(this.#index) + 1, of: this.#lessons.length });
  }

  /** True while a lesson is read: the board waits for its "Next". */
  get holdsBoard() {
    return this.lesson !== null;
  }

  /**
   * What to do now, in one line, after what the player has chosen so far; null when there is no task.
   * @param {Intent} [intent]
   */
  hintFor(intent = NO_INTENT) {
    const hint = this.lesson === null ? this.step?.hint : undefined;
    if (hint === undefined || this.#view === null) {
      return null;
    }
    return typeof hint === "string" ? hint : hint(this.#view, intent);
  }

  /**
   * What to point at now.
   * @param {Intent} [intent]
   * @returns {readonly FocusTarget[]}
   */
  focusFor(intent = NO_INTENT) {
    const step = this.step;
    return step?.focus === undefined || this.#view === null ? [] : step.focus(this.#view, intent);
  }

  /**
   * Takes in the snapshot on show and passes every task or wait it completes.
   * @param {Snapshot} snapshot
   * @returns {boolean} whether the step changed
   */
  sync(snapshot) {
    this.#view = new TutorialView(snapshot, this.#playerId);
    return this.#advance();
  }

  /** Done reading the lesson: on to the next step. */
  next() {
    if (!this.holdsBoard) {
      return false;
    }
    this.#index += 1;
    this.#advance();
    return true;
  }

  /** @param {string} id a card or player the player taps */
  allowsTap(id) {
    const step = this.step;
    if (step === null || step.free === true) {
      return true;
    }
    return this.#view !== null && (step.taps?.(this.#view) ?? []).includes(id);
  }

  /** @param {string} buttonId a button of the side panel that makes a move ("endPhase", "endTurn") */
  allowsButton(buttonId) {
    const step = this.step;
    if (step === null || step.free === true) {
      return true;
    }
    return this.lesson === null && (step.buttons ?? []).includes(buttonId);
  }

  /** @param {Intent} intent what the player would confirm */
  allowsConfirm(intent) {
    const step = this.step;
    if (step === null || step.free === true) {
      return true;
    }
    if (this.#view === null || this.lesson !== null) {
      return false;
    }
    if (step.confirm !== undefined) {
      return step.confirm(intent, this.#view);
    }
    return intent.pickedCardId !== null && this.allowsTap(intent.pickedCardId);
  }

  /** Passes the tasks and waits already done; stops at a lesson. */
  #advance() {
    const start = this.#index;
    while (this.#view !== null && this.step !== null && this.lesson === null && this.step.until?.(this.#view) === true) {
      this.#index += 1;
    }
    return this.#index !== start;
  }
}
