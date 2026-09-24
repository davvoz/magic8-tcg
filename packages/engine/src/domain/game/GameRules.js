/**
 * Match rules loaded from configuration. Every tunable number the engine uses
 * comes from here; the engine never hardcodes gameplay constants.
 */
import {
  Issues,
  checkBoolean,
  checkEnum,
  checkInteger,
  checkObject,
} from "../../shared/validation.js";

export const GAME_RULES_SCHEMA_VERSION = 1;

export const ResourceModel = Object.freeze({
  /** Maximum resources grow by `gainPerTurn` each turn and refill at turn start. */
  INCREMENTAL: "incremental",
});

export const EmptyLibraryMode = Object.freeze({
  /** Drawing from an empty library deals `damagePerDraw` to the player. */
  FATIGUE: "fatigue",
  /** Drawing from an empty library loses the game. */
  LOSE: "lose",
});

const RULES_KEYS = Object.freeze([
  "schemaVersion",
  "startingLife",
  "startingHandSize",
  "cardsDrawnPerTurn",
  "firstPlayerSkipsFirstDraw",
  "maxHandSize",
  "maxBattlefieldCreatures",
  "resource",
  "combat",
  "emptyLibrary",
  "limits",
]);
const RESOURCE_KEYS = Object.freeze(["type", "gainPerTurn", "max", "startingMax"]);
const COMBAT_KEYS = Object.freeze(["blockersEnabled", "summoningSickness", "maxBlockersPerAttacker"]);
const EMPTY_LIBRARY_KEYS = Object.freeze(["mode", "damagePerDraw"]);
const LIMIT_KEYS = Object.freeze(["maxEffectsPerResolution", "maxEventsPerCommand"]);

/** Absolute bounds for configurable values; protect the engine from absurd configs. */
const BOUNDS = Object.freeze({
  life: { min: 1, max: 999 },
  handSize: { min: 0, max: 20 },
  draw: { min: 0, max: 10 },
  battlefield: { min: 1, max: 20 },
  resource: { min: 0, max: 50 },
  blockers: { min: 1, max: 10 },
  damage: { min: 0, max: 99 },
  effects: { min: 1, max: 10000 },
  events: { min: 1, max: 100000 },
});

export class GameRules {
  /** @type {number} */
  startingLife;
  /** @type {number} */
  startingHandSize;
  /** @type {number} */
  cardsDrawnPerTurn;
  /** @type {boolean} */
  firstPlayerSkipsFirstDraw;
  /** @type {number} */
  maxHandSize;
  /** @type {number} */
  maxBattlefieldCreatures;
  /** @type {Readonly<{ type: string, gainPerTurn: number, max: number, startingMax: number }>} */
  resource;
  /** @type {Readonly<{ blockersEnabled: boolean, summoningSickness: boolean, maxBlockersPerAttacker: number }>} */
  combat;
  /** @type {Readonly<{ mode: string, damagePerDraw: number }>} */
  emptyLibrary;
  /** @type {Readonly<{ maxEffectsPerResolution: number, maxEventsPerCommand: number }>} */
  limits;

  /** @param {Omit<GameRules, never>} fields */
  constructor(fields) {
    this.startingLife = fields.startingLife;
    this.startingHandSize = fields.startingHandSize;
    this.cardsDrawnPerTurn = fields.cardsDrawnPerTurn;
    this.firstPlayerSkipsFirstDraw = fields.firstPlayerSkipsFirstDraw;
    this.maxHandSize = fields.maxHandSize;
    this.maxBattlefieldCreatures = fields.maxBattlefieldCreatures;
    this.resource = Object.freeze({ ...fields.resource });
    this.combat = Object.freeze({ ...fields.combat });
    this.emptyLibrary = Object.freeze({ ...fields.emptyLibrary });
    this.limits = Object.freeze({ ...fields.limits });
    Object.freeze(this);
  }
}

/**
 * @param {unknown} raw
 * @returns {import("../../shared/Result.js").Ok<GameRules> | import("../../shared/Result.js").Fail}
 */
export function validateGameRules(raw) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "gameRules", RULES_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "gameRules.schemaVersion", { min: GAME_RULES_SCHEMA_VERSION, max: GAME_RULES_SCHEMA_VERSION });
  const fields = {
    startingLife: checkInteger(issues, object.startingLife, "gameRules.startingLife", BOUNDS.life),
    startingHandSize: checkInteger(issues, object.startingHandSize, "gameRules.startingHandSize", BOUNDS.handSize),
    cardsDrawnPerTurn: checkInteger(issues, object.cardsDrawnPerTurn, "gameRules.cardsDrawnPerTurn", BOUNDS.draw),
    firstPlayerSkipsFirstDraw: checkBoolean(issues, object.firstPlayerSkipsFirstDraw ?? true, "gameRules.firstPlayerSkipsFirstDraw"),
    maxHandSize: checkInteger(issues, object.maxHandSize, "gameRules.maxHandSize", BOUNDS.handSize),
    maxBattlefieldCreatures: checkInteger(issues, object.maxBattlefieldCreatures, "gameRules.maxBattlefieldCreatures", BOUNDS.battlefield),
    resource: checkResource(issues, object.resource, "gameRules.resource"),
    combat: checkCombat(issues, object.combat, "gameRules.combat"),
    emptyLibrary: checkEmptyLibrary(issues, object.emptyLibrary, "gameRules.emptyLibrary"),
    limits: checkLimits(issues, object.limits, "gameRules.limits"),
  };
  if (!issues.isEmpty) {
    return issues.toResult(undefined);
  }
  return issues.toResult(new GameRules(fields));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 */
function checkResource(issues, raw, path) {
  const object = checkObject(issues, raw, path, RESOURCE_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const type = checkEnum(issues, object.type, `${path}.type`, Object.values(ResourceModel));
  const gainPerTurn = checkInteger(issues, object.gainPerTurn, `${path}.gainPerTurn`, BOUNDS.resource);
  const max = checkInteger(issues, object.max, `${path}.max`, BOUNDS.resource);
  const startingMax = checkInteger(issues, object.startingMax ?? 0, `${path}.startingMax`, { min: 0, max: max ?? BOUNDS.resource.max });
  return { type, gainPerTurn, max, startingMax };
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 */
function checkCombat(issues, raw, path) {
  const object = checkObject(issues, raw, path, COMBAT_KEYS);
  if (object === undefined) {
    return undefined;
  }
  return {
    blockersEnabled: checkBoolean(issues, object.blockersEnabled, `${path}.blockersEnabled`),
    summoningSickness: checkBoolean(issues, object.summoningSickness, `${path}.summoningSickness`),
    maxBlockersPerAttacker: checkInteger(issues, object.maxBlockersPerAttacker, `${path}.maxBlockersPerAttacker`, BOUNDS.blockers),
  };
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 */
function checkEmptyLibrary(issues, raw, path) {
  const object = checkObject(issues, raw, path, EMPTY_LIBRARY_KEYS);
  if (object === undefined) {
    return undefined;
  }
  return {
    mode: checkEnum(issues, object.mode, `${path}.mode`, Object.values(EmptyLibraryMode)),
    damagePerDraw: checkInteger(issues, object.damagePerDraw ?? 0, `${path}.damagePerDraw`, BOUNDS.damage),
  };
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 */
function checkLimits(issues, raw, path) {
  const object = checkObject(issues, raw, path, LIMIT_KEYS);
  if (object === undefined) {
    return undefined;
  }
  return {
    maxEffectsPerResolution: checkInteger(issues, object.maxEffectsPerResolution, `${path}.maxEffectsPerResolution`, BOUNDS.effects),
    maxEventsPerCommand: checkInteger(issues, object.maxEventsPerCommand, `${path}.maxEventsPerCommand`, BOUNDS.events),
  };
}
