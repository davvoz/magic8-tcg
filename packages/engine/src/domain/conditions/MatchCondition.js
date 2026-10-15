/**
 * A match condition: a rule that holds for a whole game, for some of its
 * players (a daily challenge's boss fight, docs/tcg/24-sfide.md). Each kind
 * is a class that answers only the questions it changes the answer to; the
 * engine asks every condition at a few fixed points (MatchConditions):
 *
 * - setting up: extra starting life, extra starting cards;
 * - each turn's start: extra cards drawn, then a turn-start effect;
 * - paying for a card: a cost change;
 * - a creature entering the battlefield: stat changes, keywords.
 *
 * Conditions are data in game records (GAME_CREATED `cond`) and snapshots,
 * so a replay, a player and the AI all see the same game. New kinds plug in
 * through CONDITION_KINDS without touching the engine's hooks.
 */
import { ModifierDuration } from "../cards/CardInstance.js";
import { KEYWORDS } from "../effects/Keyword.js";
import { GameEventType } from "../game/GameEventType.js";
import { checkEnum, checkInteger } from "../../shared/validation.js";
import { CardFilter, validateCardFilter } from "./CardFilter.js";

export const ConditionKind = Object.freeze({
  /** Cards matching `filter` cost `amount` more (less when negative, never below 0). */
  COST: "cost",
  /** Creatures matching `filter` enter the battlefield with `attack`/`health` more, for good. */
  ENTER_STATS: "enter_stats",
  /** Creatures matching `filter` enter the battlefield with `keyword`. */
  KEYWORD: "keyword",
  /** At the start of each of their turns the player loses or gains `amount` life, or draws `amount` cards. */
  TURN_START: "turn_start",
  /** The player draws `amount` more cards at the start of each turn. */
  EXTRA_DRAW: "extra_draw",
  /** The player starts with `amount` more cards in hand. */
  STARTING_HAND: "starting_hand",
  /** The player starts with `amount` more life (and as much more maximum life). */
  STARTING_LIFE: "starting_life",
});

/** What a turn-start condition does to the player whose turn starts. */
export const TurnStartEffect = Object.freeze({ LOSE_LIFE: "lose_life", GAIN_LIFE: "gain_life", DRAW: "draw" });

/**
 * @typedef {Readonly<{ kind: string, players: readonly string[], [field: string]: unknown }>} PlainCondition
 * @typedef {{ drawCards: (player: import("../game/Player.js").Player, amount: number) => void, events: import("../game/EventLog.js").EventLog }} TurnStartContext
 */

/** The shape every condition shares: who it holds for, and no change to anything until a kind says otherwise. */
export class MatchCondition {
  /** @type {readonly string[]} */
  #players;

  /** @param {readonly string[]} players the ids of the players it holds for */
  constructor(players) {
    this.#players = Object.freeze([...players]);
  }

  /** @returns {string} one of ConditionKind */
  get kind() {
    throw new Error("MatchCondition: a condition names its kind");
  }

  get players() {
    return this.#players;
  }

  /** @param {string} playerId */
  holdsFor(playerId) {
    return this.#players.includes(playerId);
  }

  /**
   * @param {string} _playerId
   * @param {import("../cards/CardDefinition.js").CardDefinition} _definition
   */
  costDelta(_playerId, _definition) {
    return 0;
  }

  /** @param {import("../cards/CardInstance.js").CardInstance} _creature it has just entered the battlefield */
  onEnter(_creature) {
    // Most conditions leave entering creatures alone.
  }

  /**
   * @param {import("../game/Player.js").Player} _player whose turn starts
   * @param {TurnStartContext} _context
   */
  onTurnStart(_player, _context) {
    // Most conditions do nothing at turn start.
  }

  /** @param {string} _playerId */
  extraDraws(_playerId) {
    return 0;
  }

  /** @param {string} _playerId */
  extraStartingCards(_playerId) {
    return 0;
  }

  /** @param {string} _playerId */
  lifeBonus(_playerId) {
    return 0;
  }

  /** @returns {PlainCondition} */
  toPlain() {
    return Object.freeze({ kind: this.kind, players: this.#players, ...this.fields() });
  }

  /** @returns {Record<string, unknown>} the kind's own fields, as plain data */
  fields() {
    return {};
  }
}

class CostCondition extends MatchCondition {
  #filter;
  #amount;

  /** @param {{ players: readonly string[], filter: CardFilter, amount: number }} fields */
  constructor({ players, filter, amount }) {
    super(players);
    this.#filter = filter;
    this.#amount = amount;
  }

  get kind() {
    return ConditionKind.COST;
  }

  costDelta(playerId, definition) {
    return this.holdsFor(playerId) && this.#filter.matches(definition) ? this.#amount : 0;
  }

  fields() {
    return { amount: this.#amount, filter: this.#filter.toPlain() };
  }
}

class EnterStatsCondition extends MatchCondition {
  #filter;
  #attack;
  #health;

  /** @param {{ players: readonly string[], filter: CardFilter, attack: number, health: number }} fields */
  constructor({ players, filter, attack, health }) {
    super(players);
    this.#filter = filter;
    this.#attack = attack;
    this.#health = health;
  }

  get kind() {
    return ConditionKind.ENTER_STATS;
  }

  onEnter(creature) {
    if (this.holdsFor(creature.controllerId) && this.#filter.matches(creature.definition)) {
      creature.addModifier({ attack: this.#attack, health: this.#health, duration: ModifierDuration.PERMANENT });
    }
  }

  fields() {
    return { attack: this.#attack, filter: this.#filter.toPlain(), health: this.#health };
  }
}

class KeywordCondition extends MatchCondition {
  #filter;
  #keyword;

  /** @param {{ players: readonly string[], filter: CardFilter, keyword: string }} fields */
  constructor({ players, filter, keyword }) {
    super(players);
    this.#filter = filter;
    this.#keyword = keyword;
  }

  get kind() {
    return ConditionKind.KEYWORD;
  }

  onEnter(creature) {
    if (this.holdsFor(creature.controllerId) && this.#filter.matches(creature.definition)) {
      creature.grantKeyword(this.#keyword);
    }
  }

  fields() {
    return { filter: this.#filter.toPlain(), keyword: this.#keyword };
  }
}

class TurnStartCondition extends MatchCondition {
  #effect;
  #amount;

  /** @param {{ players: readonly string[], effect: string, amount: number }} fields */
  constructor({ players, effect, amount }) {
    super(players);
    this.#effect = effect;
    this.#amount = amount;
  }

  get kind() {
    return ConditionKind.TURN_START;
  }

  onTurnStart(player, { drawCards, events }) {
    if (!this.holdsFor(player.id)) {
      return;
    }
    if (this.#effect === TurnStartEffect.DRAW) {
      drawCards(player, this.#amount);
      return;
    }
    const delta = this.#effect === TurnStartEffect.LOSE_LIFE ? -player.loseLife(this.#amount) : player.gainLife(this.#amount, player.maxLife);
    events.emit(GameEventType.LIFE_CHANGED, { playerId: player.id, life: player.life, delta });
  }

  fields() {
    return { amount: this.#amount, effect: this.#effect };
  }
}

/** A condition that only adds to a number the engine asks for (draws, starting cards, starting life). */
class BonusCondition extends MatchCondition {
  #kind;
  #amount;

  /** @param {{ kind: string, players: readonly string[], amount: number }} fields */
  constructor({ kind, players, amount }) {
    super(players);
    this.#kind = kind;
    this.#amount = amount;
  }

  get kind() {
    return this.#kind;
  }

  /** @param {string} kind @param {string} playerId */
  #bonus(kind, playerId) {
    return this.#kind === kind && this.holdsFor(playerId) ? this.#amount : 0;
  }

  extraDraws(playerId) {
    return this.#bonus(ConditionKind.EXTRA_DRAW, playerId);
  }

  extraStartingCards(playerId) {
    return this.#bonus(ConditionKind.STARTING_HAND, playerId);
  }

  lifeBonus(playerId) {
    return this.#bonus(ConditionKind.STARTING_LIFE, playerId);
  }

  fields() {
    return { amount: this.#amount };
  }
}

/** The fields each kind takes beyond `kind` and `players`. */
const KIND_KEYS = Object.freeze({
  [ConditionKind.COST]: Object.freeze(["amount", "filter"]),
  [ConditionKind.ENTER_STATS]: Object.freeze(["attack", "filter", "health"]),
  [ConditionKind.KEYWORD]: Object.freeze(["filter", "keyword"]),
  [ConditionKind.TURN_START]: Object.freeze(["amount", "effect"]),
  [ConditionKind.EXTRA_DRAW]: Object.freeze(["amount"]),
  [ConditionKind.STARTING_HAND]: Object.freeze(["amount"]),
  [ConditionKind.STARTING_LIFE]: Object.freeze(["amount"]),
});

/**
 * How each kind is read from plain data: its own fields, checked, into the condition.
 * @type {Readonly<Record<string, (issues: import("../../shared/validation.js").Issues, raw: Record<string, unknown>, context: { path: string, players: readonly string[] }) => MatchCondition | undefined>>}
 */
export const CONDITION_KINDS = Object.freeze({
  [ConditionKind.COST]: (issues, raw, { path, players }) => {
    const filter = validateCardFilter(issues, raw.filter, `${path}.filter`);
    const amount = checkInteger(issues, raw.amount, `${path}.amount`, { min: -5, max: 5 });
    return filter === undefined || amount === undefined ? undefined : new CostCondition({ players, filter, amount });
  },
  [ConditionKind.ENTER_STATS]: (issues, raw, { path, players }) => {
    const filter = validateCardFilter(issues, raw.filter, `${path}.filter`);
    const attack = checkInteger(issues, raw.attack, `${path}.attack`, { min: -5, max: 5 });
    const health = checkInteger(issues, raw.health, `${path}.health`, { min: -5, max: 5 });
    return filter === undefined || attack === undefined || health === undefined ? undefined : new EnterStatsCondition({ players, filter, attack, health });
  },
  [ConditionKind.KEYWORD]: (issues, raw, { path, players }) => {
    const filter = validateCardFilter(issues, raw.filter, `${path}.filter`);
    const keyword = checkEnum(issues, raw.keyword, `${path}.keyword`, KEYWORDS);
    return filter === undefined || keyword === undefined ? undefined : new KeywordCondition({ players, filter, keyword });
  },
  [ConditionKind.TURN_START]: (issues, raw, { path, players }) => {
    const effect = checkEnum(issues, raw.effect, `${path}.effect`, Object.values(TurnStartEffect));
    const amount = checkInteger(issues, raw.amount, `${path}.amount`, { min: 1, max: 5 });
    return effect === undefined || amount === undefined ? undefined : new TurnStartCondition({ players, effect, amount });
  },
  [ConditionKind.EXTRA_DRAW]: bonus(ConditionKind.EXTRA_DRAW, { min: 1, max: 3 }),
  [ConditionKind.STARTING_HAND]: bonus(ConditionKind.STARTING_HAND, { min: 1, max: 5 }),
  [ConditionKind.STARTING_LIFE]: bonus(ConditionKind.STARTING_LIFE, { min: -15, max: 30 }),
});

/**
 * @param {string} kind
 * @param {{ min: number, max: number }} range
 */
function bonus(kind, range) {
  /** @type {(issues: import("../../shared/validation.js").Issues, raw: Record<string, unknown>, context: { path: string, players: readonly string[] }) => MatchCondition | undefined} */
  return (issues, raw, { path, players }) => {
    const amount = checkInteger(issues, raw.amount, `${path}.amount`, range);
    return amount === undefined ? undefined : new BonusCondition({ kind, players, amount });
  };
}

/**
 * @param {string} kind
 * @returns {readonly string[]} the fields of that kind, beyond kind and players
 */
export function keysOfKind(kind) {
  return KIND_KEYS[kind] ?? [];
}

export { CardFilter };
