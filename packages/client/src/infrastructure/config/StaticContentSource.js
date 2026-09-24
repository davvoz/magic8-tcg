/**
 * ContentSource over in-memory objects. Used by tests and headless
 * simulations, and the natural home for content bundled at build time.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

/** @implements {import("../../application/ports/ContentSource.contract.js").ContentSource} */
export class StaticContentSource {
  #resources;

  /** @param {Readonly<Record<string, unknown>>} resources resource name → raw content */
  constructor(resources) {
    this.#resources = resources;
  }

  /** @param {string} resource */
  load(resource) {
    if (!Object.hasOwn(this.#resources, resource)) {
      return Promise.resolve(fail("CONTENT_UNKNOWN_RESOURCE", `no static content for "${resource}"`));
    }
    return Promise.resolve(ok(this.#resources[resource]));
  }
}
