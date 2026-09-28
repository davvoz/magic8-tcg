/**
 * Painted card illustrations, loaded on demand. The painters ask for a
 * card's image while drawing; the first request starts the download and
 * answers null, so the card shows its procedural art until the image is
 * decoded, then `onLoaded` asks for a redraw. An image that fails to load
 * is not retried: that card stays procedural for the session.
 *
 * Downloads go through an ImageCache; this class knows which cards have an
 * illustration, where each file is, and how it is framed.
 */
import { ImageCache } from "../images/ImageCache.js";

/**
 * @typedef {import("../images/ImageCache.js").LoadedImage} LoadedImage
 * @typedef {Readonly<{ image: LoadedImage, focus: import("../../application/content/IllustrationManifest.js").Focus }>} Illustration
 * @typedef {Readonly<{ imageFor: (cardId: string) => Illustration | null }>} IllustrationSource what the card painters read (Theme.illustrations)
 */

const PRELOAD_CONCURRENCY = 4;

/** @implements {IllustrationSource} */
export class CardIllustrations {
  #entries;
  #urlFor;
  #images;

  /**
   * @param {{
   *   manifest: import("../../application/content/IllustrationManifest.js").IllustrationManifest,
   *   urlFor: (file: string) => string,
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ manifest, urlFor, loadImage, onLoaded = () => undefined, logger }) {
    this.#entries = manifest.entries;
    this.#urlFor = urlFor;
    this.#images = new ImageCache({
      loadImage,
      onLoaded,
      onFailed: ({ key, url, reason }) => logger.warn("card illustration unavailable", { cardId: key, url, reason }),
    });
  }

  /** Cards that have an illustration, loaded or not. */
  get cardIds() {
    return [...this.#entries.keys()];
  }

  /**
   * The card's illustration when it is ready; otherwise null, starting the download if needed.
   * @param {string} cardId
   * @returns {Illustration | null}
   */
  imageFor(cardId) {
    const entry = this.#entries.get(cardId);
    if (entry === undefined) {
      return null;
    }
    const image = this.#images.imageFor(cardId, this.#urlFor(entry.file));
    return image === null ? null : { image, focus: entry.focus };
  }

  /**
   * Downloads the given cards' illustrations a few at a time; resolves when all have settled.
   * Cards without an illustration are skipped.
   * @param {readonly string[]} cardIds
   */
  async preload(cardIds) {
    const queue = cardIds.filter((cardId) => this.#entries.has(cardId));
    const worker = async () => {
      for (let cardId = queue.shift(); cardId !== undefined; cardId = queue.shift()) {
        const entry = /** @type {import("../../application/content/IllustrationManifest.js").IllustrationEntry} */ (this.#entries.get(cardId));
        await this.#images.load(cardId, this.#urlFor(entry.file));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, queue.length) }, worker));
  }
}
