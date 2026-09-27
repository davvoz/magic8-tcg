/**
 * Painted card illustrations, loaded on demand. The painters ask for a
 * card's image while drawing; the first request starts the download and
 * answers null, so the card shows its procedural art until the image is
 * decoded, then `onLoaded` asks for a redraw. An image that fails to load
 * is not retried: that card stays procedural for the session.
 *
 * Drawing stays synchronous and the loader is injected, so the layer runs
 * under node --test with a fake loader and without any image at all.
 */

/**
 * @typedef {Readonly<{ source: CanvasImageSource, width: number, height: number }>} LoadedImage
 * @typedef {Readonly<{ image: LoadedImage, focus: import("../../application/content/IllustrationManifest.js").Focus }>} Illustration
 * @typedef {Readonly<{ imageFor: (cardId: string) => Illustration | null }>} IllustrationSource what the card painters read (Theme.illustrations)
 */

const PRELOAD_CONCURRENCY = 4;

/** @implements {IllustrationSource} */
export class CardIllustrations {
  #entries;
  #urlFor;
  #loadImage;
  #onLoaded;
  #logger;
  /** @type {Map<string, Promise<void>>} downloads started, settled or not */
  #requested = new Map();
  /** @type {Map<string, LoadedImage>} */
  #ready = new Map();

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
    this.#loadImage = loadImage;
    this.#onLoaded = onLoaded;
    this.#logger = logger;
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
    const image = this.#ready.get(cardId);
    if (image === undefined) {
      void this.#request(cardId);
      return null;
    }
    return { image, focus: entry.focus };
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
        await this.#request(cardId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, queue.length) }, worker));
  }

  /**
   * Starts (once) the download of a card's image. Never rejects.
   * @param {string} cardId
   */
  #request(cardId) {
    const started = this.#requested.get(cardId);
    if (started !== undefined) {
      return started;
    }
    const entry = /** @type {import("../../application/content/IllustrationManifest.js").IllustrationEntry} */ (this.#entries.get(cardId));
    const url = this.#urlFor(entry.file);
    const download = this.#loadImage(url).then(
      (image) => {
        if (!(image.width > 0 && image.height > 0)) {
          throw new Error("the image is empty");
        }
        this.#ready.set(cardId, image);
        this.#onLoaded();
      },
    ).catch((error) => {
      this.#logger.warn("card illustration unavailable", { cardId, url, reason: error instanceof Error ? error.message : String(error) });
    });
    this.#requested.set(cardId, download);
    return download;
  }
}
