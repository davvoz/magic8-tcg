/**
 * Turns taps on the board into intent and, when the intent is complete,
 * into a command built through the domain's command factories. Reads only
 * the human's perspective snapshot (its `legalMoves` section decides what
 * is tappable) and never re-implements rules: whatever it produces still
 * goes through full engine validation.
 *
 *   IDLE ──tap playable hand card──▶ TARGETING (if the card needs targets) ──tap target──▶ PLAY_CARD
 *   IDLE ──tap playable hand card──▶ PLAY_CARD (no targets)
 *   with `confirmPlays` (a phone: a small card is easily tapped by mistake),
 *   IDLE ──tap playable hand card──▶ that card picked ──confirm──▶ as above;
 *         tapping it again puts it back, tapping another picks that one
 *   COMBAT_ATTACKERS awaiting me ──▶ ATTACKERS: toggle legal attackers, confirm ──▶ DECLARE_ATTACKERS
 *   COMBAT_BLOCKERS awaiting me  ──▶ BLOCKERS: pick a legal blocker, then the attacker it blocks; confirm ──▶ DECLARE_BLOCKERS
 */
import { declareAttackers, declareBlockers, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";

export const InteractionMode = Object.freeze({
  IDLE: "idle",
  TARGETING: "targeting",
  ATTACKERS: "attackers",
  BLOCKERS: "blockers",
  WAITING: "waiting",
});

/** @typedef {typeof InteractionMode[keyof typeof InteractionMode]} Mode */

/** How the board should draw a card or player right now. */
export const Highlight = Object.freeze({
  PLAYABLE: "playable",
  SELECTED: "selected",
  TARGETABLE: "targetable",
  ATTACKING: "attacking",
  BLOCKING: "blocking",
});

/** @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot */

export class MatchInteraction {
  #playerId;
  /** @type {Snapshot | null} */
  #snapshot = null;
  /** @type {Mode} */
  #mode = InteractionMode.WAITING;
  /** @type {{ cardId: string, groups: readonly (readonly string[])[], chosen: string[] } | null} */
  #targeting = null;
  /** @type {string[]} */
  #attackers = [];
  /** @type {{ attackerId: string, blockerId: string }[]} */
  #blocks = [];
  /** @type {string | null} */
  #pendingBlockerId = null;
  /** The hand card picked to be played, waiting for the confirm (`confirmPlays`). @type {string | null} */
  #pickedId = null;
  /** Whether a hand card is picked first and played on confirm, rather than played on the tap. */
  confirmPlays;

  /**
   * @param {string} playerId the human seat this interaction acts for
   * @param {{ confirmPlays?: boolean }} [options]
   */
  constructor(playerId, { confirmPlays = false } = {}) {
    this.#playerId = playerId;
    this.confirmPlays = confirmPlays;
  }

  get mode() {
    return this.#mode;
  }

  /** Blocks assigned so far (BLOCKERS mode), for drawing arrows. */
  get pendingBlocks() {
    return Object.freeze(this.#blocks.map((block) => ({ ...block })));
  }

  get selectedAttackerIds() {
    return Object.freeze([...this.#attackers]);
  }

  /** Blocker picked and waiting for its attacker (BLOCKERS mode). */
  get pendingBlockerId() {
    return this.#pendingBlockerId;
  }

  /** The hand card picked and waiting for the confirm to be played (IDLE with `confirmPlays`), or null. */
  get pickedCardId() {
    return this.#pickedId;
  }

  /** Every new snapshot resets multi-step intent; the phase decides the mode. */
  sync(snapshot) {
    this.#snapshot = snapshot;
    this.#targeting = null;
    this.#attackers = [];
    this.#blocks = [];
    this.#pendingBlockerId = null;
    this.#pickedId = null;
    this.#mode = modeFor(snapshot, this.#playerId);
  }

  /** One-line instruction for the sidebar. */
  get prompt() {
    const snapshot = this.#snapshot;
    if (snapshot === null || snapshot.isOver) {
      return "";
    }
    return PROMPTS[this.#mode](this);
  }

  /** Label of the confirm button, or null when there is nothing to confirm. */
  get confirmLabel() {
    if (this.#mode === InteractionMode.ATTACKERS) {
      return this.#attackers.length === 0 ? "Skip combat" : `Attack with ${this.#attackers.length}`;
    }
    if (this.#mode === InteractionMode.BLOCKERS) {
      const count = this.#blocks.length;
      if (count === 0) {
        return "No blocks";
      }
      return count === 1 ? "Confirm 1 block" : `Confirm ${count} blocks`;
    }
    return this.#mode === InteractionMode.IDLE && this.#pickedId !== null ? "Play" : null;
  }

  get canCancel() {
    return this.#mode === InteractionMode.TARGETING || this.#attackers.length > 0 || this.#blocks.length > 0 || this.#pendingBlockerId !== null || this.#pickedId !== null;
  }

  /** The card whose targets are being chosen (TARGETING mode), or null. */
  get targetingCardId() {
    return this.#targeting?.cardId ?? null;
  }

  get targetingStep() {
    return this.#targeting === null ? null : { step: this.#targeting.chosen.length + 1, total: this.#targeting.groups.length };
  }

  /**
   * A tap on a card instance or a player HUD.
   * @param {string} id
   * @returns {Readonly<Record<string, unknown>> | null} a command to submit, if the intent completed
   */
  tap(id) {
    const snapshot = this.#snapshot;
    if (snapshot === null) {
      return null;
    }
    switch (this.#mode) {
      case InteractionMode.IDLE:
        return this.confirmPlays ? this.#pick(snapshot, id) : this.#tapIdle(snapshot, id);
      case InteractionMode.TARGETING:
        return this.#tapTarget(id);
      case InteractionMode.ATTACKERS:
        this.#toggleAttacker(snapshot, id);
        return null;
      case InteractionMode.BLOCKERS:
        this.#tapBlockers(snapshot, id);
        return null;
      default:
        return null;
    }
  }

  /** @returns {Readonly<Record<string, unknown>> | null} */
  confirm() {
    if (this.#mode === InteractionMode.ATTACKERS) {
      return declareAttackers(this.#playerId, this.#attackers);
    }
    if (this.#mode === InteractionMode.BLOCKERS) {
      return declareBlockers(this.#playerId, this.#blocks);
    }
    const picked = this.#pickedId;
    if (this.#mode === InteractionMode.IDLE && picked !== null && this.#snapshot !== null) {
      this.#pickedId = null;
      return this.#tapIdle(this.#snapshot, picked);
    }
    return null;
  }

  /** Drops the current multi-step intent without changing the mode. */
  cancel() {
    if (this.#mode === InteractionMode.TARGETING) {
      this.#mode = InteractionMode.IDLE;
    }
    this.#targeting = null;
    this.#attackers = [];
    this.#blocks = [];
    this.#pendingBlockerId = null;
    this.#pickedId = null;
  }

  /**
   * @param {string} id card instance or player id
   * @returns {string | null} a Highlight value
   */
  highlightFor(id) {
    const snapshot = this.#snapshot;
    if (snapshot === null) {
      return null;
    }
    if (this.#mode === InteractionMode.TARGETING) {
      return this.#targetingHighlight(id);
    }
    if (this.#mode === InteractionMode.ATTACKERS) {
      return this.#attackersHighlight(snapshot, id);
    }
    if (this.#mode === InteractionMode.BLOCKERS) {
      return this.#blockersHighlight(snapshot, id);
    }
    if (this.#mode === InteractionMode.IDLE && id === this.#pickedId) {
      return Highlight.SELECTED;
    }
    if (this.#mode === InteractionMode.IDLE && snapshot.legalMoves?.playableCardIds.includes(id)) {
      return Highlight.PLAYABLE;
    }
    return snapshot.combat.attackerIds.includes(id) ? Highlight.ATTACKING : null;
  }

  /**
   * Asks for a target once per play ability that has one to offer. An ability
   * with no legal target is skipped, so its card is played straight away and
   * the flat target list stays aligned with `splitChosenTargets`.
   * @param {Snapshot} snapshot
   * @param {string} id
   */
  #tapIdle(snapshot, id) {
    const moves = snapshot.legalMoves;
    if (moves === null || !moves.playableCardIds.includes(id)) {
      return null;
    }
    const groups = (moves.targetOptions[id] ?? []).filter((options) => options.length > 0);
    if (groups.length === 0) {
      return playCard(this.#playerId, id);
    }
    this.#targeting = { cardId: id, groups, chosen: [] };
    this.#mode = InteractionMode.TARGETING;
    return null;
  }

  /**
   * Picks a playable hand card to be played on confirm; the picked one again puts it back.
   * @param {Snapshot} snapshot
   * @param {string} id
   * @returns {null}
   */
  #pick(snapshot, id) {
    if (snapshot.legalMoves?.playableCardIds.includes(id) === true) {
      this.#pickedId = this.#pickedId === id ? null : id;
    }
    return null;
  }

  /** @param {string} id */
  #tapTarget(id) {
    const targeting = this.#targeting;
    if (targeting === null) {
      return null;
    }
    const options = targeting.groups[targeting.chosen.length] ?? [];
    if (!options.includes(id)) {
      return null;
    }
    const chosen = [...targeting.chosen, id];
    if (chosen.length < targeting.groups.length) {
      this.#targeting = { ...targeting, chosen };
      return null;
    }
    this.#targeting = null;
    this.#mode = InteractionMode.IDLE;
    return playCard(this.#playerId, targeting.cardId, chosen);
  }

  /**
   * @param {Snapshot} snapshot
   * @param {string} id
   */
  #toggleAttacker(snapshot, id) {
    if (!(snapshot.legalMoves?.attackerIds ?? []).includes(id)) {
      return;
    }
    this.#attackers = this.#attackers.includes(id) ? this.#attackers.filter((other) => other !== id) : [...this.#attackers, id];
  }

  /**
   * First tap picks one of my legal blockers (tapping an assigned blocker
   * unassigns it); the next tap on an attacker assigns the pending blocker.
   * @param {Snapshot} snapshot
   * @param {string} id
   */
  #tapBlockers(snapshot, id) {
    const legalBlockers = snapshot.legalMoves?.blockerIds ?? [];
    if (legalBlockers.includes(id)) {
      const assigned = this.#blocks.some((block) => block.blockerId === id);
      this.#blocks = this.#blocks.filter((block) => block.blockerId !== id);
      this.#pendingBlockerId = assigned || this.#pendingBlockerId === id ? null : id;
      return;
    }
    if (this.#pendingBlockerId !== null && snapshot.combat.attackerIds.includes(id)) {
      this.#blocks = [...this.#blocks, { attackerId: id, blockerId: this.#pendingBlockerId }];
      this.#pendingBlockerId = null;
    }
  }

  /** @param {string} id */
  #targetingHighlight(id) {
    const targeting = this.#targeting;
    if (targeting === null) {
      return null;
    }
    if (id === targeting.cardId) {
      return Highlight.SELECTED;
    }
    const options = targeting.groups[targeting.chosen.length] ?? [];
    return options.includes(id) ? Highlight.TARGETABLE : null;
  }

  /**
   * @param {Snapshot} snapshot
   * @param {string} id
   */
  #attackersHighlight(snapshot, id) {
    if (this.#attackers.includes(id)) {
      return Highlight.SELECTED;
    }
    return (snapshot.legalMoves?.attackerIds ?? []).includes(id) ? Highlight.PLAYABLE : null;
  }

  /**
   * @param {Snapshot} snapshot
   * @param {string} id
   */
  #blockersHighlight(snapshot, id) {
    if (id === this.#pendingBlockerId) {
      return Highlight.SELECTED;
    }
    if (this.#blocks.some((block) => block.blockerId === id)) {
      return Highlight.BLOCKING;
    }
    if (snapshot.combat.attackerIds.includes(id)) {
      return this.#pendingBlockerId === null ? Highlight.ATTACKING : Highlight.TARGETABLE;
    }
    return (snapshot.legalMoves?.blockerIds ?? []).includes(id) ? Highlight.PLAYABLE : null;
  }
}

/**
 * @param {Snapshot} snapshot
 * @param {string} playerId
 */
function modeFor(snapshot, playerId) {
  if (snapshot.isOver || snapshot.awaitingPlayerId !== playerId) {
    return InteractionMode.WAITING;
  }
  if (snapshot.phase === GamePhase.COMBAT_ATTACKERS) {
    return InteractionMode.ATTACKERS;
  }
  if (snapshot.phase === GamePhase.COMBAT_BLOCKERS) {
    return InteractionMode.BLOCKERS;
  }
  return InteractionMode.IDLE;
}

/** @type {Readonly<Record<string, (interaction: MatchInteraction) => string>>} */
const PROMPTS = Object.freeze({
  [InteractionMode.WAITING]: () => "Waiting for the opponent…",
  [InteractionMode.IDLE]: (interaction) => (interaction.pickedCardId === null ? "Play a card or end the phase." : "Play it, or pick another card."),
  [InteractionMode.TARGETING]: (interaction) => {
    const step = interaction.targetingStep;
    return step === null || step.total === 1 ? "Choose a target." : `Choose a target (${step.step}/${step.total}).`;
  },
  [InteractionMode.ATTACKERS]: (interaction) => (interaction.selectedAttackerIds.length === 0 ? "Tap creatures to attack with." : "Tap more creatures or confirm."),
  [InteractionMode.BLOCKERS]: (interaction) => {
    if (interaction.pendingBlockerId !== null) {
      return "Now tap the attacker it blocks.";
    }
    return interaction.pendingBlocks.length === 0 ? "Tap a creature to block with, or confirm." : "Tap another blocker or confirm.";
  },
});
