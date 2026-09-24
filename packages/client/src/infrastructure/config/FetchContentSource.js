/**
 * ContentSource over fetch(). Given a manifest of resource → file path(s),
 * downloads and parses JSON with a size cap. Returns raw, unvalidated data;
 * callers validate. The manifest is code (composition root), never data, so
 * no data-driven URL can be requested.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

const MAX_BYTES = 2 * 1024 * 1024;

export const FetchError = Object.freeze({
  HTTP: "CONTENT_HTTP",
  TOO_LARGE: "CONTENT_TOO_LARGE",
  MALFORMED: "CONTENT_MALFORMED",
  UNKNOWN_RESOURCE: "CONTENT_UNKNOWN_RESOURCE",
});

/**
 * @typedef {Readonly<Record<string, string | readonly string[]>>} ContentManifest
 *   Resource name → one path (object resources) or a list of paths (array resources).
 */

/** @implements {import("../../application/ports/ContentSource.contract.js").ContentSource} */
export class FetchContentSource {
  #manifest;
  #fetch;

  /**
   * @param {ContentManifest} manifest
   * @param {typeof fetch} fetchImplementation Injected for testability.
   */
  constructor(manifest, fetchImplementation) {
    this.#manifest = manifest;
    this.#fetch = fetchImplementation;
  }

  /** @param {string} resource */
  async load(resource) {
    const paths = Object.hasOwn(this.#manifest, resource) ? this.#manifest[resource] : undefined;
    if (paths === undefined) {
      return fail(FetchError.UNKNOWN_RESOURCE, `no manifest entry for "${resource}"`);
    }
    if (typeof paths === "string") {
      return this.#loadJson(paths);
    }
    const items = [];
    for (const path of paths) {
      const item = await this.#loadJson(path);
      if (!item.ok) {
        return item;
      }
      items.push(item.value);
    }
    return ok(items);
  }

  /** @param {string} path */
  async #loadJson(path) {
    let response;
    try {
      response = await this.#fetch(path, { cache: "no-store" });
    } catch (error) {
      return fail(FetchError.HTTP, `fetch failed for ${path}: ${error instanceof Error ? error.message : "network error"}`);
    }
    if (!response.ok) {
      return fail(FetchError.HTTP, `${path}: HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_BYTES) {
      return fail(FetchError.TOO_LARGE, `${path} exceeds ${MAX_BYTES} bytes`);
    }
    try {
      return ok(JSON.parse(text));
    } catch {
      return fail(FetchError.MALFORMED, `${path} is not valid JSON`);
    }
  }
}
