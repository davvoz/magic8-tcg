/**
 * Aggregate root for a match. Owned and mutated only by GameEngine (and the
 * domain systems it invokes) inside a command execution; everything outside
 * the domain sees GameSnapshot projections instead.
 */
import { CombatState } from "../combat/CombatState.js";
import { GamePhase } from "./GamePhase.js";

export class GameState {
  /** @type {readonly import("./Player.js").Player[]} exactly two, in seating order */
  players;
  /** @type {number} */
  turnNumber;
  /** @type {string} */
  activePlayerId;
  /** @type {string | null} player expected to act, null during automatic phases */
  awaitingPlayerId;
  /** @type {string} */
  phase;
  /** @type {CombatState} */
  combat;
  /** @type {import("../random/RandomSource.contract.js").RandomSource} */
  rng;
  /** @type {number} */
  nextInstanceNumber;
  /** @type {string | null} */
  winnerId;
  /** @type {string | null} */
  endReason;
  /** @type {boolean} */
  ended;
  /** @type {number} incremented on every committed command */
  version;

  /**
   * @param {{ players: readonly import("./Player.js").Player[], turnNumber?: number, activePlayerId: string, awaitingPlayerId?: string | null, phase?: string, combat?: CombatState, rng: import("../random/RandomSource.contract.js").RandomSource, nextInstanceNumber?: number, winnerId?: string | null, endReason?: string | null, ended?: boolean, version?: number }} fields
   */
  constructor(fields) {
    this.players = Object.freeze([...fields.players]);
    this.turnNumber = fields.turnNumber ?? 1;
    this.activePlayerId = fields.activePlayerId;
    this.awaitingPlayerId = fields.awaitingPlayerId ?? null;
    this.phase = fields.phase ?? GamePhase.TURN_START;
    this.combat = fields.combat ?? new CombatState();
    this.rng = fields.rng;
    this.nextInstanceNumber = fields.nextInstanceNumber ?? 1;
    this.winnerId = fields.winnerId ?? null;
    this.endReason = fields.endReason ?? null;
    this.ended = fields.ended ?? false;
    this.version = fields.version ?? 0;
  }

  get isOver() {
    return this.ended;
  }

  /**
   * @param {string} playerId
   * @returns {import("./Player.js").Player | undefined}
   */
  getPlayer(playerId) {
    return this.players.find((player) => player.id === playerId);
  }

  /**
   * @param {string} playerId
   * @returns {import("./Player.js").Player}
   */
  requirePlayer(playerId) {
    const player = this.getPlayer(playerId);
    if (player === undefined) {
      throw new RangeError(`GameState: unknown player "${playerId}"`);
    }
    return player;
  }

  get activePlayer() {
    return this.requirePlayer(this.activePlayerId);
  }

  /**
   * @param {string} playerId
   * @returns {import("./Player.js").Player}
   */
  opponentOf(playerId) {
    const opponent = this.players.find((player) => player.id !== playerId);
    if (opponent === undefined || this.getPlayer(playerId) === undefined) {
      throw new RangeError(`GameState: no opponent for "${playerId}"`);
    }
    return opponent;
  }

  /**
   * Locates a card in any zone of any player.
   * @param {string} instanceId
   * @returns {{ card: import("../cards/CardInstance.js").CardInstance, owner: import("./Player.js").Player } | undefined}
   */
  findCard(instanceId) {
    for (const owner of this.players) {
      const card = owner.findCard(instanceId);
      if (card !== undefined) {
        return { card, owner };
      }
    }
    return undefined;
  }

  /** Deterministic instance id allocation. */
  allocateInstanceId() {
    const id = `c${this.nextInstanceNumber}`;
    this.nextInstanceNumber += 1;
    return id;
  }

  /**
   * @param {string} phase
   * @param {string | null} awaitingPlayerId
   */
  setPhase(phase, awaitingPlayerId) {
    this.phase = phase;
    this.awaitingPlayerId = awaitingPlayerId;
  }

  /** Hands the turn to the other player. */
  passTurn() {
    this.activePlayerId = this.opponentOf(this.activePlayerId).id;
    this.turnNumber += 1;
  }

  /**
   * @param {string | null} winnerId null for a draw
   * @param {string} reason One of GameEndReason.
   */
  endGame(winnerId, reason) {
    this.ended = true;
    this.winnerId = winnerId;
    this.endReason = reason;
    this.awaitingPlayerId = null;
  }

  clone() {
    return new GameState({
      players: this.players.map((player) => player.clone()),
      turnNumber: this.turnNumber,
      activePlayerId: this.activePlayerId,
      awaitingPlayerId: this.awaitingPlayerId,
      phase: this.phase,
      combat: this.combat.clone(),
      rng: this.rng.clone(),
      nextInstanceNumber: this.nextInstanceNumber,
      winnerId: this.winnerId,
      endReason: this.endReason,
      ended: this.ended,
      version: this.version,
    });
  }
}
