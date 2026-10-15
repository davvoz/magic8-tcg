/**
 * Which cards a match condition touches: any card, or only those of a type,
 * a faction, or with a keyword (all of those given must hold). Plain data in
 * and out, so it travels in game records and snapshots.
 */
import { CARD_TYPES } from "../cards/CardType.js";
import { KEYWORDS } from "../effects/Keyword.js";
import { checkEnum, checkObject, checkString } from "../../shared/validation.js";

const FILTER_KEYS = Object.freeze(["type", "faction", "keyword"]);
const FACTION_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;

/** @typedef {Readonly<{ type?: string, faction?: string, keyword?: string }>} PlainCardFilter */

export class CardFilter {
  /** @type {string | undefined} */
  #type;
  /** @type {string | undefined} */
  #faction;
  /** @type {string | undefined} */
  #keyword;

  /** @param {PlainCardFilter} [fields] */
  constructor({ type, faction, keyword } = {}) {
    this.#type = type;
    this.#faction = faction;
    this.#keyword = keyword;
    Object.freeze(this);
  }

  /** Any card. */
  static get ANY() {
    return ANY;
  }

  /**
   * @param {import("../cards/CardDefinition.js").CardDefinition} definition
   */
  matches(definition) {
    return (this.#type === undefined || definition.type === this.#type) && (this.#faction === undefined || definition.faction === this.#faction) && (this.#keyword === undefined || definition.hasKeyword(this.#keyword));
  }

  /** @returns {PlainCardFilter} */
  toPlain() {
    return Object.freeze({ ...(this.#type === undefined ? {} : { type: this.#type }), ...(this.#faction === undefined ? {} : { faction: this.#faction }), ...(this.#keyword === undefined ? {} : { keyword: this.#keyword }) });
  }
}

const ANY = new CardFilter();

/**
 * @param {import("../../shared/validation.js").Issues} issues
 * @param {unknown} raw absent: any card
 * @param {string} path
 * @returns {CardFilter | undefined}
 */
export function validateCardFilter(issues, raw, path) {
  if (raw === undefined) {
    return ANY;
  }
  const object = checkObject(issues, raw, path, FILTER_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const before = issues.count;
  const type = object.type === undefined ? undefined : checkEnum(issues, object.type, `${path}.type`, CARD_TYPES);
  const faction = object.faction === undefined ? undefined : checkString(issues, object.faction, `${path}.faction`, { pattern: FACTION_PATTERN });
  const keyword = object.keyword === undefined ? undefined : checkEnum(issues, object.keyword, `${path}.keyword`, KEYWORDS);
  return issues.count === before ? new CardFilter({ type, faction, keyword }) : undefined;
}
