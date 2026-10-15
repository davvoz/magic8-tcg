/**
 * The conditions of one game (MatchCondition), and the questions the engine
 * asks of them at its fixed points: setup, turn start, paying for a card, a
 * creature entering the battlefield. Without conditions every answer is the
 * plain rules' (MatchConditions.NONE), so games without them play exactly as
 * before.
 *
 * Immutable: a game state's clones share it.
 */
import { Issues, checkArray, checkArrayOf, checkEnum, checkObject, checkUnique } from "../../shared/validation.js";
import { CONDITION_KINDS, ConditionKind, keysOfKind } from "./MatchCondition.js";

/** Conditions one game may have. */
export const MAX_CONDITIONS = 8;
const COMMON_KEYS = Object.freeze(["kind", "players"]);

/** @typedef {import("./MatchCondition.js").PlainCondition} PlainCondition */

export class MatchConditions {
  /** @type {readonly import("./MatchCondition.js").MatchCondition[]} */
  #conditions;

  /** @param {readonly import("./MatchCondition.js").MatchCondition[]} conditions */
  constructor(conditions) {
    this.#conditions = Object.freeze([...conditions]);
    Object.freeze(this);
  }

  /** No conditions: the plain rules. */
  static get NONE() {
    return NONE;
  }

  /**
   * Reads conditions from plain data (a game record, a snapshot, a data file).
   * @param {unknown} raw an array of plain conditions; undefined for none
   * @param {readonly string[]} playerIds the game's players, whom conditions may name
   * @returns {import("../../shared/Result.js").Ok<MatchConditions> | import("../../shared/Result.js").Fail}
   */
  static fromPlain(raw, playerIds) {
    if (raw === undefined) {
      return new Issues().toResult(NONE);
    }
    const issues = new Issues();
    const conditions = checkArrayOf(issues, raw, "conditions", { maxLength: MAX_CONDITIONS, item: (item, path) => conditionOf(issues, item, { path, playerIds }) });
    return issues.toResult(conditions === undefined ? undefined : new MatchConditions(conditions));
  }

  get isEmpty() {
    return this.#conditions.length === 0;
  }

  /** @returns {readonly PlainCondition[]} */
  toPlain() {
    return Object.freeze(this.#conditions.map((condition) => condition.toPlain()));
  }

  /**
   * What a card costs its player, conditions applied (never below 0).
   * @param {string} playerId
   * @param {import("../cards/CardDefinition.js").CardDefinition} definition
   */
  costOf(playerId, definition) {
    return Math.max(0, definition.cost + this.#sum((condition) => condition.costDelta(playerId, definition)));
  }

  /** @param {import("../cards/CardInstance.js").CardInstance} creature it has just entered the battlefield */
  applyOnEnter(creature) {
    for (const condition of this.#conditions) {
      condition.onEnter(creature);
    }
  }

  /**
   * @param {import("../game/Player.js").Player} player whose turn starts, after their draw
   * @param {import("./MatchCondition.js").TurnStartContext} context
   */
  applyTurnStart(player, context) {
    for (const condition of this.#conditions) {
      condition.onTurnStart(player, context);
    }
  }

  /** @param {string} playerId */
  extraDraws(playerId) {
    return this.#sum((condition) => condition.extraDraws(playerId));
  }

  /** @param {string} playerId */
  extraStartingCards(playerId) {
    return this.#sum((condition) => condition.extraStartingCards(playerId));
  }

  /** @param {string} playerId */
  lifeBonus(playerId) {
    return this.#sum((condition) => condition.lifeBonus(playerId));
  }

  /** @param {(condition: import("./MatchCondition.js").MatchCondition) => number} value */
  #sum(value) {
    return this.#conditions.reduce((total, condition) => total + value(condition), 0);
  }
}

const NONE = new MatchConditions([]);

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {{ path: string, playerIds: readonly string[] }} context
 */
function conditionOf(issues, raw, { path, playerIds }) {
  const object = checkObject(issues, raw, path);
  if (object === undefined) {
    return undefined;
  }
  const kind = checkEnum(issues, object.kind, `${path}.kind`, Object.values(ConditionKind));
  if (kind === undefined) {
    return undefined;
  }
  checkObject(issues, object, path, [...COMMON_KEYS, ...keysOfKind(kind)]);
  const players = checkArray(issues, object.players, `${path}.players`, { minLength: 1, maxLength: playerIds.length });
  if (players === undefined) {
    return undefined;
  }
  const unknown = players.find((player) => typeof player !== "string" || !playerIds.includes(player));
  if (unknown !== undefined) {
    return issues.add(`${path}.players`, `"${String(unknown)}" does not play this game`);
  }
  if (!checkUnique(issues, players, `${path}.players`, String)) {
    return undefined;
  }
  return CONDITION_KINDS[kind](issues, object, { path, players: /** @type {string[]} */ (players) });
}
