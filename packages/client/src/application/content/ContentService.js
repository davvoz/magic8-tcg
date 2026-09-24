/**
 * Loads raw content through the ContentSource port; the engine's
 * buildGameContent validates it into the immutable GameContent bundle every
 * other service depends on (the same code the game server runs).
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ContentError, buildGameContent } from "@magic8/engine/domain/content/GameContent.js";
import { ContentResource } from "../ports/ContentSource.contract.js";

export { ContentError };

/**
 * @typedef {import("@magic8/engine/domain/content/GameContent.js").GameContent} GameContent
 */

/**
 * @param {import("../ports/ContentSource.contract.js").ContentSource} source
 * @param {import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry} effects
 * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<GameContent> | import("@magic8/engine/shared/Result.js").Fail>}
 */
export async function loadContent(source, effects) {
  const raw = await loadRaw(source);
  return raw.ok ? buildGameContent(raw.value, effects) : raw;
}

/**
 * @param {import("../ports/ContentSource.contract.js").ContentSource} source
 * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("@magic8/engine/domain/content/GameContent.js").RawContent> | import("@magic8/engine/shared/Result.js").Fail>}
 */
async function loadRaw(source) {
  /** @type {Record<string, unknown>} */
  const loaded = {};
  for (const resource of Object.values(ContentResource)) {
    const result = await source.load(resource);
    if (!result.ok) {
      return fail(ContentError.LOAD_FAILED, `could not load ${resource}: ${result.error.message}`, result.error.details);
    }
    loaded[resource] = result.value;
  }
  return ok(/** @type {import("@magic8/engine/domain/content/GameContent.js").RawContent} */ (/** @type {unknown} */ (loaded)));
}
