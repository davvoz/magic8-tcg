/**
 * The game content the server runs on: validated by the engine (the same
 * code the client and the replay verifier run), identified by its protocol
 * content hash, published in the database so that verifiers can download
 * any version a recorded game used.
 *
 * Content is loaded once at startup; a content change is a deploy. Games
 * keep the content they started with: `version(hash)` rebuilds any
 * published version (with this server's engine) for games that outlive a
 * content change.
 */
import { buildGameContent } from "@magic8/engine/domain/content/GameContent.js";
import { isHash, openContent, sealContent } from "@magic8/protocol";
import { assertImplements } from "../../../kernel/contracts.js";
import { CONTENT_REPOSITORY_METHODS } from "./ports.js";

/**
 * @typedef {Readonly<{ hash: string, engineVersion: string, content: import("@magic8/engine/domain/content/GameContent.js").GameContent }>} ContentVersion
 */

export class ContentInvalidError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ContentInvalidError";
  }
}

export class CatalogService {
  #repository;
  /** @type {ContentVersion | null} */
  #current = null;
  /** @type {import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry | null} */
  #effects = null;
  /** @type {Map<string, ContentVersion>} versions rebuilt for running games */
  #versions = new Map();

  /** @param {{ repository: import("./ports.js").ContentRepository }} deps */
  constructor({ repository }) {
    assertImplements(repository, CONTENT_REPOSITORY_METHODS, "ContentRepository");
    this.#repository = repository;
  }

  /**
   * Validates the bundle and makes it the current content.
   * @param {{ raw: import("@magic8/engine/domain/content/GameContent.js").RawContent, effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry, engineVersion: string }} input
   * @returns {Promise<ContentVersion>}
   */
  async publish({ raw, effects, engineVersion }) {
    const built = buildGameContent(raw, effects);
    if (!built.ok) {
      throw new ContentInvalidError(`content is invalid: ${built.error.message}`);
    }
    const { hash, payload } = sealContent(raw);
    const cards = /** @type {readonly { cards: readonly { id: string }[] }[]} */ (raw.cardSets).flatMap((set) => set.cards);
    await this.#repository.publish({ hash, payload, engineVersion, cards });
    this.#current = Object.freeze({ hash, engineVersion, content: built.value });
    this.#effects = effects;
    this.#versions.set(hash, this.#current);
    return this.#current;
  }

  /** @returns {ContentVersion} */
  current() {
    if (this.#current === null) {
      throw new Error("CatalogService: no content published yet");
    }
    return this.#current;
  }

  /**
   * The exact published payload of a content version, or null.
   * @param {unknown} hash
   * @returns {Promise<string | null>}
   */
  async payload(hash) {
    return isHash(hash) ? this.#repository.payload(hash) : null;
  }

  /**
   * A published content version, rebuilt from its exact payload, or null
   * when it is unknown or was published for another engine version (this
   * server can only run its own engine).
   * @param {string} hash
   * @returns {Promise<ContentVersion | null>}
   */
  async version(hash) {
    const known = this.#versions.get(hash);
    if (known !== undefined) {
      return known;
    }
    const current = this.current();
    const [payload, engineVersion] = isHash(hash) ? await Promise.all([this.#repository.payload(hash), this.#repository.engineVersion(hash)]) : [null, null];
    const raw = payload === null ? null : openContent(payload, hash);
    if (raw === null || engineVersion !== current.engineVersion) {
      return null;
    }
    const built = buildGameContent(/** @type {any} */ (raw), /** @type {any} */ (this.#effects));
    if (!built.ok) {
      return null;
    }
    const version = Object.freeze({ hash, engineVersion, content: built.value });
    this.#versions.set(hash, version);
    return version;
  }
}
