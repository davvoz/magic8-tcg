/**
 * Registry of effect types the engine knows how to execute.
 *
 * Card data references effects by `type` and supplies `params`; the registry
 * validates those params against the effect's declared schema at content-load
 * time, so an unknown effect or a malformed parameter can never reach the
 * engine. Effect behaviour (`resolve`) is code, registered here — never data.
 *
 * Registration errors are programmer errors and throw; data errors go through
 * `Issues` like every other validator.
 */
import { checkEnum, checkInteger, checkObject } from "../../shared/validation.js";
import { TARGET_KINDS } from "./TargetSpec.js";

/** Whether an effect needs a target declared in card data. */
export const Targeting = Object.freeze({
  REQUIRED: "required",
  NONE: "none",
});

const TARGETING_VALUES = Object.freeze(Object.values(Targeting));

/**
 * @typedef {{ kind: "integer", min: number, max: number, default?: number }} IntegerParamSchema
 * @typedef {{ kind: "enum", values: readonly string[], default?: string }} EnumParamSchema
 * @typedef {IntegerParamSchema | EnumParamSchema} ParamSchema
 *
 * @typedef {object} EffectDescriptor
 * @property {string} type
 * @property {string} targeting One of `Targeting`.
 * @property {readonly string[]} [targetKinds] Target kinds this effect accepts (defaults to all) when targeting is required.
 * @property {Readonly<Record<string, ParamSchema>>} params
 * @property {(context: import("./EffectContext.js").EffectContext) => void} resolve Applies the effect at resolution time.
 */

const PARAM_KINDS = Object.freeze(["integer", "enum"]);

export class EffectRegistry {
  /** @type {Map<string, EffectDescriptor>} */
  #descriptors = new Map();

  /**
   * @param {EffectDescriptor} descriptor
   * @returns {this}
   */
  register(descriptor) {
    assertDescriptor(descriptor);
    if (this.#descriptors.has(descriptor.type)) {
      throw new Error(`EffectRegistry: effect "${descriptor.type}" is already registered`);
    }
    this.#descriptors.set(descriptor.type, descriptor);
    return this;
  }

  /** @param {string} type */
  has(type) {
    return this.#descriptors.has(type);
  }

  /**
   * @param {string} type
   * @returns {EffectDescriptor | undefined}
   */
  get(type) {
    return this.#descriptors.get(type);
  }

  /** @returns {readonly string[]} */
  types() {
    return Object.freeze([...this.#descriptors.keys()]);
  }

  /**
   * Validates raw params against the effect's schema and returns a frozen,
   * normalised params object (defaults applied), or undefined on failure.
   * @param {import("../../shared/validation.js").Issues} issues
   * @param {string} type A registered effect type.
   * @param {unknown} rawParams
   * @param {string} path
   * @returns {Readonly<Record<string, number | string>> | undefined}
   */
  validateParams(issues, type, rawParams, path) {
    const descriptor = this.#descriptors.get(type);
    if (descriptor === undefined) {
      return issues.add(path, `unknown effect "${type}"`);
    }
    const schemaKeys = Object.keys(descriptor.params);
    const object = checkObject(issues, rawParams ?? {}, path, schemaKeys);
    if (object === undefined) {
      return undefined;
    }
    /** @type {Record<string, number | string>} */
    const normalised = {};
    let valid = true;
    for (const key of schemaKeys) {
      const value = validateParam(issues, descriptor.params[key], object[key], `${path}.${key}`);
      if (value === undefined) {
        valid = false;
      } else {
        normalised[key] = value;
      }
    }
    return valid ? Object.freeze(normalised) : undefined;
  }
}

/**
 * @param {import("../../shared/validation.js").Issues} issues
 * @param {ParamSchema} schema
 * @param {unknown} value
 * @param {string} path
 * @returns {number | string | undefined}
 */
function validateParam(issues, schema, value, path) {
  const effective = value === undefined ? schema.default : value;
  if (effective === undefined) {
    return issues.add(path, "required parameter is missing");
  }
  if (schema.kind === "integer") {
    return checkInteger(issues, effective, path, { min: schema.min, max: schema.max });
  }
  return checkEnum(issues, effective, path, schema.values);
}

/** @param {EffectDescriptor} descriptor */
function assertDescriptor(descriptor) {
  if (typeof descriptor?.type !== "string" || descriptor.type.length === 0) {
    throw new TypeError("EffectRegistry: descriptor.type must be a non-empty string");
  }
  if (typeof descriptor.resolve !== "function") {
    throw new TypeError(`EffectRegistry: "${descriptor.type}" must implement resolve()`);
  }
  assertTargeting(descriptor);
  assertParamSchemas(descriptor);
}

/** @param {EffectDescriptor} descriptor */
function assertTargeting(descriptor) {
  if (!TARGETING_VALUES.includes(descriptor.targeting)) {
    throw new TypeError(`EffectRegistry: "${descriptor.type}" has invalid targeting`);
  }
  const targetKinds = descriptor.targetKinds ?? TARGET_KINDS;
  if (!Array.isArray(targetKinds) || !targetKinds.every((kind) => TARGET_KINDS.includes(kind))) {
    throw new TypeError(`EffectRegistry: "${descriptor.type}" has invalid targetKinds`);
  }
}

/** @param {EffectDescriptor} descriptor */
function assertParamSchemas(descriptor) {
  if (typeof descriptor.params !== "object" || descriptor.params === null) {
    throw new TypeError(`EffectRegistry: "${descriptor.type}" must declare params`);
  }
  for (const [name, schema] of Object.entries(descriptor.params)) {
    if (!PARAM_KINDS.includes(schema?.kind)) {
      throw new TypeError(`EffectRegistry: "${descriptor.type}" param "${name}" has invalid kind`);
    }
  }
}
