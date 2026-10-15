/**
 * Who the daily challenges are played against (docs/tcg/24-sfide.md): the
 * characters (one per preconstructed deck) and the bosses (one per
 * faction, each with a deck built around its strongest card). Each one is a
 * deck, a style the AI plays it with, and a few lines of dialogue for the
 * client to show before, during and after the game.
 *
 * The roster is data (data/daily/characters.json), validated against the
 * game content at startup: every deck must be legal, so a character can
 * never sit down with a deck the rules refuse.
 *
 * A deck is written as a preconstructed deck's id, or as `{ base, add }`: a
 * preconstructed deck with some cards added (a boss's), or `{ cards }`.
 *
 * An opponent may bring conditions to the table (a boss's): rules that hold
 * for that game only (the engine's match conditions), each with a name and a
 * line of text for the player, and a scope: everyone at the table, only the
 * opponent, or only the challenger.
 */
import { MatchConditions } from "@magic8/engine/domain/conditions/MatchConditions.js";
import { AI_STYLES } from "@magic8/engine/domain/ai/BasicAi.js";
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { Issues, checkArray, checkArrayOf, checkEnum, checkInteger, checkObject, checkString, checkUnique } from "@magic8/engine/shared/validation.js";

/**
 * @typedef {Readonly<{ intro: readonly string[], low: readonly string[], win: readonly string[], lose: readonly string[], unlock: readonly string[] }>} Lines
 *   `intro` before the game, `low` when the character is at low life, `win` when it wins (the player lost), `lose` when
 *   it loses, `unlock` (bosses) when the boss becomes the next challenge
 * @typedef {Readonly<{ name: string, text: string, scope: string, rule: Readonly<Record<string, unknown>> }>} OpponentCondition
 *   `rule`: a match condition without its players, whom `scope` (one of ConditionScope) names
 * @typedef {Readonly<{ id: string, name: string, title: string, faction: string, style: string, boss: boolean, deck: DeckList, lines: Lines, conditions: readonly OpponentCondition[] }>} Opponent
 */

/** Who an opponent's condition holds for. */
export const ConditionScope = Object.freeze({ EVERYONE: "everyone", OPPONENT: "opponent", CHALLENGER: "challenger" });
/** Stand-in ids for checking a condition's rule: the challenger's and the opponent's. */
const SCOPE_PLAYERS = Object.freeze({ [ConditionScope.EVERYONE]: ["challenger", "opponent"], [ConditionScope.OPPONENT]: ["opponent"], [ConditionScope.CHALLENGER]: ["challenger"] });
const CONDITION_KEYS = Object.freeze(["name", "text", "scope", "rule"]);
const MAX_CONDITIONS = 3;

const ROSTER_KEYS = Object.freeze(["schemaVersion", "characters", "bosses"]);
const OPPONENT_KEYS = Object.freeze(["id", "name", "title", "faction", "style", "deck", "lines", "conditions"]);
const LINE_KINDS = Object.freeze(["intro", "low", "win", "lose", "unlock"]);
const DECK_KEYS = Object.freeze(["base", "add", "cards"]);
const ENTRY_KEYS = Object.freeze(["cardId", "count"]);
/** Ids name a character in game records (as the seat's account "ai_<id>"), so they stay short and plain. */
const ID_PATTERN = /^[a-z][a-z0-9_]{1,23}$/;
const MAX_OPPONENTS = 64;
const MAX_LINES = 8;
const MAX_LINE_LENGTH = 160;
const MAX_TEXT_LENGTH = 40;

export class DailyRoster {
  /** @type {readonly Opponent[]} */
  #characters;
  /** @type {readonly Opponent[]} */
  #bosses;

  /**
   * @param {readonly Opponent[]} characters
   * @param {readonly Opponent[]} bosses
   */
  constructor(characters, bosses) {
    this.#characters = Object.freeze([...characters]);
    this.#bosses = Object.freeze([...bosses]);
  }

  get characters() {
    return this.#characters;
  }

  get bosses() {
    return this.#bosses;
  }

  /**
   * @param {string} id
   * @returns {Opponent | undefined}
   */
  find(id) {
    return this.#characters.find((opponent) => opponent.id === id) ?? this.#bosses.find((opponent) => opponent.id === id);
  }
}

/**
 * @param {unknown} raw
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @returns {import("@magic8/engine/shared/Result.js").Ok<DailyRoster> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateDailyRoster(raw, content) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "roster", ROSTER_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "roster.schemaVersion", { min: 1, max: 1 });
  const read = (key, boss) => checkArrayOf(issues, object[key], `roster.${key}`, { minLength: 1, maxLength: MAX_OPPONENTS, item: (item, path) => opponentOf(issues, item, path, { content, boss }) });
  const characters = read("characters", false);
  const bosses = read("bosses", true);
  if (characters !== undefined && bosses !== undefined) {
    checkUnique(issues, [...characters, ...bosses], "roster", (opponent) => opponent.id);
  }
  return issues.toResult(characters === undefined || bosses === undefined ? undefined : new DailyRoster(characters, bosses));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {{ content: import("@magic8/engine/domain/content/GameContent.js").GameContent, boss: boolean }} context
 * @returns {Opponent | undefined}
 */
function opponentOf(issues, raw, path, { content, boss }) {
  const object = checkObject(issues, raw, path, OPPONENT_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const text = (key, options) => checkString(issues, object[key], `${path}.${key}`, options);
  const fields = {
    id: text("id", { pattern: ID_PATTERN }),
    name: text("name", { minLength: 1, maxLength: MAX_TEXT_LENGTH }),
    title: text("title", { minLength: 1, maxLength: MAX_TEXT_LENGTH }),
    faction: checkEnum(issues, object.faction, `${path}.faction`, content.deckRules.factions),
    style: checkEnum(issues, object.style, `${path}.style`, AI_STYLES),
    deck: deckOf(issues, object.deck, `${path}.deck`, { content, name: typeof object.name === "string" ? object.name : "deck" }),
    lines: linesOf(issues, object.lines, `${path}.lines`, boss),
    conditions: conditionsOf(issues, object.conditions, `${path}.conditions`),
  };
  if (Object.values(fields).includes(undefined)) {
    return undefined;
  }
  return /** @type {Opponent} */ (Object.freeze({ ...fields, boss }));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {{ content: import("@magic8/engine/domain/content/GameContent.js").GameContent, name: string }} context
 * @returns {DeckList | undefined}
 */
function deckOf(issues, raw, path, { content, name }) {
  const entries = typeof raw === "string" ? preconEntries(issues, raw, path, content) : composedEntries(issues, raw, path, content);
  if (entries === undefined) {
    return undefined;
  }
  const deck = new DeckList({ id: "daily", name: name.slice(0, content.deckRules.deckNameMaxLength), entries: mergeEntries(entries) });
  const report = validateDeck(deck, content.deckRules, content.catalog);
  if (!report.valid) {
    return issues.add(path, `the deck breaks the rules: ${report.problems[0].message}`);
  }
  return deck;
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 */
function composedEntries(issues, raw, path, content) {
  const object = checkObject(issues, raw, path, DECK_KEYS);
  if (object === undefined) {
    return undefined;
  }
  if ((object.base === undefined) === (object.cards === undefined)) {
    return issues.add(path, "write either a base preconstructed deck (with cards to add) or the whole list of cards");
  }
  const base = object.base === undefined ? [] : preconEntries(issues, object.base, `${path}.base`, content);
  const cards = entriesOf(issues, object.cards ?? object.add ?? [], `${path}.${object.cards === undefined ? "add" : "cards"}`);
  return base === undefined || cards === undefined ? undefined : [...base, ...cards];
}

/**
 * @param {Issues} issues
 * @param {unknown} id
 * @param {string} path
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 */
function preconEntries(issues, id, path, content) {
  const deck = content.preconDecks.find((candidate) => candidate.id === id);
  if (deck === undefined) {
    return issues.add(path, `"${String(id)}" is not a preconstructed deck`);
  }
  return deck.entries.map((entry) => ({ cardId: entry.cardId, count: entry.count }));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 */
function entriesOf(issues, raw, path) {
  return checkArrayOf(issues, raw, path, {
    maxLength: 60,
    item: (item, itemPath) => {
      const entry = checkObject(issues, item, itemPath, ENTRY_KEYS);
      if (entry === undefined) {
        return undefined;
      }
      const cardId = checkString(issues, entry.cardId, `${itemPath}.cardId`, { minLength: 1, maxLength: 64 });
      const count = checkInteger(issues, entry.count, `${itemPath}.count`, { min: 1, max: 99 });
      return cardId === undefined || count === undefined ? undefined : { cardId, count };
    },
  });
}

/**
 * The same card listed twice (a base deck's and an addition) becomes one entry.
 * @param {readonly { cardId: string, count: number }[]} entries
 */
function mergeEntries(entries) {
  const counts = new Map();
  for (const { cardId, count } of entries) {
    counts.set(cardId, (counts.get(cardId) ?? 0) + count);
  }
  return [...counts].map(([cardId, count]) => ({ cardId, count }));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw absent: none
 * @param {string} path
 * @returns {readonly OpponentCondition[] | undefined}
 */
function conditionsOf(issues, raw, path) {
  if (raw === undefined) {
    return Object.freeze([]);
  }
  const conditions = checkArrayOf(issues, raw, path, { maxLength: MAX_CONDITIONS, item: (item, itemPath) => conditionOf(issues, item, itemPath) });
  return conditions === undefined ? undefined : Object.freeze(conditions);
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {OpponentCondition | undefined}
 */
function conditionOf(issues, raw, path) {
  const object = checkObject(issues, raw, path, CONDITION_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const name = checkString(issues, object.name, `${path}.name`, { minLength: 1, maxLength: MAX_TEXT_LENGTH });
  const text = checkString(issues, object.text, `${path}.text`, { minLength: 1, maxLength: MAX_LINE_LENGTH });
  const scope = checkEnum(issues, object.scope, `${path}.scope`, Object.values(ConditionScope));
  const rule = checkObject(issues, object.rule, `${path}.rule`);
  if (name === undefined || text === undefined || scope === undefined || rule === undefined) {
    return undefined;
  }
  if ("players" in rule) {
    return issues.add(`${path}.rule.players`, "the scope says whom the rule holds for");
  }
  const checked = MatchConditions.fromPlain([{ ...rule, players: SCOPE_PLAYERS[scope] }], ["challenger", "opponent"]);
  if (!checked.ok) {
    return issues.add(`${path}.rule`, checked.error.message);
  }
  return Object.freeze({ name, text, scope, rule: Object.freeze({ ...rule }) });
}

/**
 * The match conditions an opponent brings to a game, naming the game's seats.
 * @param {Opponent} opponent
 * @param {{ challenger: string, opponent: string }} seats
 * @returns {readonly Readonly<Record<string, unknown>>[]} plain conditions, as GameService records them
 */
export function conditionsAt(opponent, seats) {
  const playersOf = {
    [ConditionScope.EVERYONE]: [seats.challenger, seats.opponent],
    [ConditionScope.OPPONENT]: [seats.opponent],
    [ConditionScope.CHALLENGER]: [seats.challenger],
  };
  return Object.freeze(opponent.conditions.map((condition) => Object.freeze({ ...condition.rule, players: playersOf[condition.scope] })));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {boolean} boss a boss also has lines for when it is unlocked
 * @returns {Lines | undefined}
 */
function linesOf(issues, raw, path, boss) {
  const object = checkObject(issues, raw, path, LINE_KINDS);
  if (object === undefined) {
    return undefined;
  }
  const required = boss ? LINE_KINDS : LINE_KINDS.filter((kind) => kind !== "unlock");
  /** @type {Record<string, readonly string[]>} */
  const lines = {};
  for (const kind of LINE_KINDS) {
    if (object[kind] === undefined && !required.includes(kind)) {
      lines[kind] = Object.freeze([]);
      continue;
    }
    const list = checkArray(issues, object[kind], `${path}.${kind}`, { minLength: 1, maxLength: MAX_LINES });
    list?.forEach((line, index) => checkString(issues, line, `${path}.${kind}[${index}]`, { minLength: 1, maxLength: MAX_LINE_LENGTH }));
    lines[kind] = Object.freeze(/** @type {string[]} */ (list ?? []));
  }
  return /** @type {Lines} */ (Object.freeze(lines));
}
