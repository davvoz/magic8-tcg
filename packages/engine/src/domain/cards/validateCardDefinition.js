/**
 * Validates untrusted card content (JSON) into CardDefinition objects.
 *
 * Context supplies the closed vocabularies the content may reference:
 * - `factions`: from deck rules configuration
 * - `effects`:  the EffectRegistry (effect types + param schemas)
 */
import { LIMITS, stripControlCharacters } from "../../shared/limits.js";
import {
  Issues,
  checkArrayOf,
  checkBoolean,
  checkEnum,
  checkInteger,
  checkObject,
  checkString,
  checkUnique,
} from "../../shared/validation.js";
import { Targeting } from "../effects/EffectRegistry.js";
import { KEYWORDS } from "../effects/Keyword.js";
import { validateTargetSpec } from "../effects/TargetSpec.js";
import { PLAYER_TARGETED_TRIGGERS, TRIGGER_TYPES, TriggerType } from "../effects/TriggerType.js";
import { Ability } from "./Ability.js";
import { CardDefinition } from "./CardDefinition.js";
import { CARD_TYPES, CardType } from "./CardType.js";

/**
 * @typedef {object} CardValidationContext
 * @property {readonly string[]} factions
 * @property {import("../effects/EffectRegistry.js").EffectRegistry} effects
 */

export const CARD_SET_SCHEMA_VERSION = 1;

const CARD_KEYS = Object.freeze(["id", "name", "type", "faction", "cost", "attack", "health", "keywords", "abilities", "text"]);
const ABILITY_KEYS = Object.freeze(["trigger", "effect", "params", "target", "mandatory"]);
const CARD_SET_KEYS = Object.freeze(["schemaVersion", "cards"]);

/** Which card type each trigger belongs to. */
const TRIGGER_CARD_TYPE = Object.freeze({
  [TriggerType.ON_PLAY]: CardType.CREATURE,
  [TriggerType.ON_CAST]: CardType.SPELL,
  [TriggerType.ON_DEATH]: CardType.CREATURE,
  [TriggerType.ON_TURN_START]: CardType.CREATURE,
});

/**
 * @param {unknown} raw
 * @param {CardValidationContext} context
 * @returns {import("../../shared/Result.js").Ok<CardDefinition> | import("../../shared/Result.js").Fail}
 */
export function validateCardDefinition(raw, context) {
  const issues = new Issues();
  const definition = checkCard(issues, raw, "card", context);
  return issues.toResult(definition);
}

/**
 * Validates a card set file `{ schemaVersion, cards: [...] }`.
 * @param {unknown} raw
 * @param {CardValidationContext} context
 * @returns {import("../../shared/Result.js").Ok<readonly CardDefinition[]> | import("../../shared/Result.js").Fail}
 */
export function validateCardSet(raw, context) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "cardSet", CARD_SET_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "cardSet.schemaVersion", { min: CARD_SET_SCHEMA_VERSION, max: CARD_SET_SCHEMA_VERSION });
  const cards = checkArrayOf(issues, object.cards, "cardSet.cards", {
    maxLength: LIMITS.MAX_CARDS_PER_SET,
    item: (item, path) => checkCard(issues, item, path, context),
  });
  if (cards !== undefined) {
    checkUnique(issues, cards, "cardSet.cards", (card) => card.id);
  }
  return issues.toResult(cards === undefined ? undefined : Object.freeze(cards));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {CardValidationContext} context
 * @returns {CardDefinition | undefined}
 */
function checkCard(issues, raw, path, context) {
  const object = checkObject(issues, raw, path, CARD_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const identity = checkIdentity(issues, object, path, context);
  const type = checkEnum(issues, object.type, `${path}.type`, CARD_TYPES);
  const cost = checkInteger(issues, object.cost, `${path}.cost`, { min: 0, max: LIMITS.MAX_COST });
  const stats = type === undefined ? undefined : checkStats(issues, object, path, type);
  const keywords = checkKeywords(issues, object.keywords, `${path}.keywords`);
  const abilities = type === undefined ? undefined : checkAbilities(issues, object.abilities, `${path}.abilities`, { cardType: type, context });

  if ([identity, type, cost, stats, keywords, abilities].some((part) => part === undefined)) {
    return undefined;
  }
  return new CardDefinition({ ...identity, type, cost, ...stats, keywords, abilities });
}

/**
 * @param {Issues} issues
 * @param {Record<string, unknown>} object
 * @param {string} path
 * @param {CardValidationContext} context
 * @returns {{ id: string, name: string, faction: string, text: string } | undefined}
 */
function checkIdentity(issues, object, path, context) {
  const id = checkString(issues, object.id, `${path}.id`, { minLength: 1, maxLength: LIMITS.ID_MAX_LENGTH, pattern: LIMITS.ID_PATTERN });
  const name = checkString(issues, object.name, `${path}.name`, { minLength: 1, maxLength: LIMITS.NAME_MAX_LENGTH });
  const faction = checkEnum(issues, object.faction, `${path}.faction`, context.factions);
  const text = checkString(issues, object.text ?? "", `${path}.text`, { maxLength: LIMITS.TEXT_MAX_LENGTH });
  if (id === undefined || name === undefined || faction === undefined || text === undefined) {
    return undefined;
  }
  return { id, name: stripControlCharacters(name), faction, text: stripControlCharacters(text) };
}

/**
 * Creatures require attack and health; other types must not declare them.
 * @param {Issues} issues
 * @param {Record<string, unknown>} object
 * @param {string} path
 * @param {string} type
 * @returns {{ attack: number, health: number } | undefined}
 */
function checkStats(issues, object, path, type) {
  if (type !== CardType.CREATURE) {
    if (object.attack !== undefined || object.health !== undefined) {
      return issues.add(path, `attack/health are only valid on ${CardType.CREATURE} cards`);
    }
    return { attack: 0, health: 0 };
  }
  const attack = checkInteger(issues, object.attack, `${path}.attack`, { min: 0, max: LIMITS.MAX_ATTACK });
  const health = checkInteger(issues, object.health, `${path}.health`, { min: 1, max: LIMITS.MAX_HEALTH });
  return attack === undefined || health === undefined ? undefined : { attack, health };
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {readonly string[] | undefined}
 */
function checkKeywords(issues, raw, path) {
  const keywords = checkArrayOf(issues, raw ?? [], path, {
    maxLength: LIMITS.MAX_KEYWORDS_PER_CARD,
    item: (item, itemPath) => checkEnum(issues, item, itemPath, KEYWORDS),
  });
  if (keywords === undefined || !checkUnique(issues, keywords, path, (keyword) => keyword)) {
    return undefined;
  }
  return Object.freeze(keywords);
}

/**
 * @typedef {object} AbilityScope
 * @property {string} cardType Type of the card the abilities belong to.
 * @property {CardValidationContext} context
 */

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {AbilityScope} scope
 * @returns {readonly Ability[] | undefined}
 */
function checkAbilities(issues, raw, path, scope) {
  const abilities = checkArrayOf(issues, raw ?? [], path, {
    maxLength: LIMITS.MAX_ABILITIES_PER_CARD,
    item: (item, itemPath) => checkAbility(issues, item, itemPath, scope),
  });
  return abilities === undefined ? undefined : Object.freeze(abilities);
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {AbilityScope} scope
 * @returns {Ability | undefined}
 */
function checkAbility(issues, raw, path, scope) {
  const object = checkObject(issues, raw, path, ABILITY_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const trigger = checkTrigger(issues, object.trigger, `${path}.trigger`, scope.cardType);
  const effect = checkString(issues, object.effect, `${path}.effect`, { minLength: 1, maxLength: LIMITS.ID_MAX_LENGTH });
  const descriptor = effect === undefined ? undefined : scope.context.effects.get(effect);
  if (effect !== undefined && descriptor === undefined) {
    issues.add(`${path}.effect`, `unknown effect "${effect}"`);
  }
  if (trigger === undefined || descriptor === undefined) {
    return undefined;
  }
  const params = scope.context.effects.validateParams(issues, effect, object.params, `${path}.params`);
  const target = checkAbilityTarget(issues, object.target, `${path}.target`, { trigger, descriptor });
  const mandatory = checkMandatory(issues, object.mandatory, `${path}.mandatory`, { trigger, target });
  if (params === undefined || target === undefined || mandatory === undefined) {
    return undefined;
  }
  return new Ability({ trigger, effect, params, target, mandatory });
}

/**
 * `mandatory` only means something where a card could otherwise be played
 * with the ability fizzling: a play trigger whose target the player chooses.
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {{ trigger: string, target: import("../effects/TargetSpec.js").TargetSpec | null | undefined }} ability
 * @returns {boolean | undefined}
 */
function checkMandatory(issues, raw, path, { trigger, target }) {
  if (raw === undefined) {
    return false;
  }
  const mandatory = checkBoolean(issues, raw, path);
  if (mandatory === true && !(PLAYER_TARGETED_TRIGGERS.includes(trigger) && target !== null && target !== undefined && !target.isAutomatic)) {
    return issues.add(path, "only a play ability whose target the player chooses can be mandatory");
  }
  return mandatory;
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {string} cardType
 * @returns {string | undefined}
 */
function checkTrigger(issues, raw, path, cardType) {
  const trigger = checkEnum(issues, raw, path, TRIGGER_TYPES);
  if (trigger !== undefined && TRIGGER_CARD_TYPE[trigger] !== cardType) {
    return issues.add(path, `"${trigger}" is not valid on ${cardType} cards`);
  }
  return trigger;
}

/**
 * Reconciles the declared target with what the effect and trigger allow.
 * Returns `null` for a valid "no target", a TargetSpec, or undefined on error.
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {{ trigger: string, descriptor: import("../effects/EffectRegistry.js").EffectDescriptor }} ability
 * @returns {import("../effects/TargetSpec.js").TargetSpec | null | undefined}
 */
function checkAbilityTarget(issues, raw, path, { trigger, descriptor }) {
  if (descriptor.targeting === Targeting.NONE) {
    return raw === undefined ? null : issues.add(path, `effect "${descriptor.type}" does not take a target`);
  }
  if (raw === undefined) {
    return issues.add(path, `effect "${descriptor.type}" requires a target`);
  }
  const spec = validateTargetSpec(issues, raw, path);
  if (spec === undefined) {
    return undefined;
  }
  const allowedKinds = descriptor.targetKinds;
  if (allowedKinds !== undefined && !allowedKinds.includes(spec.kind)) {
    return issues.add(`${path}.kind`, `effect "${descriptor.type}" accepts only ${allowedKinds.join(", ")}`);
  }
  if (!PLAYER_TARGETED_TRIGGERS.includes(trigger) && !spec.isAutomatic) {
    return issues.add(path, `trigger "${trigger}" cannot ask the player for a target; use kind "player" with owner "enemy" or "ally"`);
  }
  return spec;
}
