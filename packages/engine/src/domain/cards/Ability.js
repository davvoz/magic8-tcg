/**
 * An ability is a (trigger, effect, params, target) tuple declared in card
 * data and validated at load time. It is immutable and shared by every
 * instance of its card.
 *
 * `mandatory` marks a play ability the card pays rather than gains (Bone
 * Colossus' tribute): without a legal target the card is unplayable instead
 * of entering play with the ability fizzling. See Playability.
 */
export class Ability {
  /** @type {string} */
  trigger;
  /** @type {string} */
  effect;
  /** @type {Readonly<Record<string, number | string>>} */
  params;
  /** @type {import("../effects/TargetSpec.js").TargetSpec | null} */
  target;
  /** @type {boolean} */
  mandatory;

  /**
   * @param {{ trigger: string, effect: string, params: Readonly<Record<string, number | string>>, target: import("../effects/TargetSpec.js").TargetSpec | null, mandatory?: boolean }} fields
   */
  constructor({ trigger, effect, params, target, mandatory = false }) {
    this.trigger = trigger;
    this.effect = effect;
    this.params = params;
    this.target = target;
    this.mandatory = mandatory;
    Object.freeze(this);
  }

  get requiresTarget() {
    return this.target !== null;
  }
}
