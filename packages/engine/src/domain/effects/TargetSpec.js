/**
 * Declarative description of what an ability may target. Card data declares a
 * TargetSpec; the engine uses it both to list legal targets (UI, AI) and to
 * validate the targets carried by a command.
 */
import { LIMITS } from "../../shared/limits.js";
import { checkEnum, checkInteger, checkObject } from "../../shared/validation.js";

export const TargetKind = Object.freeze({
  CREATURE: "creature",
  PLAYER: "player",
  CREATURE_OR_PLAYER: "creature_or_player",
});

export const TARGET_KINDS = Object.freeze(Object.values(TargetKind));

/** Relative to the controller of the ability's source. */
export const TargetOwner = Object.freeze({
  ANY: "any",
  ENEMY: "enemy",
  ALLY: "ally",
});

export const TARGET_OWNERS = Object.freeze(Object.values(TargetOwner));

const TARGET_SPEC_KEYS = Object.freeze(["kind", "owner", "count"]);

export class TargetSpec {
  /** @type {string} */
  kind;
  /** @type {string} */
  owner;
  /** @type {number} */
  count;

  /**
   * @param {{ kind: string, owner: string, count: number }} fields
   */
  constructor({ kind, owner, count }) {
    this.kind = kind;
    this.owner = owner;
    this.count = count;
    Object.freeze(this);
  }

  /**
   * True when the target set is fully determined without a player decision
   * (exactly one candidate: a specific player). Required for triggers that
   * fire outside the player's own command, such as on_death.
   */
  get isAutomatic() {
    return this.kind === TargetKind.PLAYER && this.owner !== TargetOwner.ANY && this.count === 1;
  }

  get allowsCreatures() {
    return this.kind !== TargetKind.PLAYER;
  }

  get allowsPlayers() {
    return this.kind !== TargetKind.CREATURE;
  }
}

/**
 * @param {import("../../shared/validation.js").Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {TargetSpec | undefined}
 */
export function validateTargetSpec(issues, raw, path) {
  const object = checkObject(issues, raw, path, TARGET_SPEC_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const kind = checkEnum(issues, object.kind, `${path}.kind`, TARGET_KINDS);
  const owner = checkEnum(issues, object.owner ?? TargetOwner.ANY, `${path}.owner`, TARGET_OWNERS);
  const count = checkInteger(issues, object.count ?? 1, `${path}.count`, { min: 1, max: LIMITS.MAX_TARGET_COUNT });
  if (kind === undefined || owner === undefined || count === undefined) {
    return undefined;
  }
  return new TargetSpec({ kind, owner, count });
}
