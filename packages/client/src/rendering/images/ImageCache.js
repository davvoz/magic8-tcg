/**
 * Images the painters draw, downloaded on demand. Drawing asks for an image
 * by key: the first request starts the download and answers null, so the
 * painter falls back to its procedural drawing until the image is decoded;
 * then `onLoaded` asks for a redraw. A download that fails (or yields an
 * empty image) is reported once through `onFailed` and never retried: that
 * key stays procedural for the session.
 *
 * Drawing stays synchronous and the loader is injected, so the layer runs
 * under node --test with a fake loader and without any image at all.
 */

/**
 * @typedef {Readonly<{ source: CanvasImageSource, width: number, height: number }>} LoadedImage
 * @typedef {Readonly<{ key: string, url: string, reason: string }>} ImageFailure
 */

export class ImageCache {
  #loadImage;
  #onLoaded;
  #onFailed;
  /** @type {Map<string, Promise<void>>} downloads started, settled or not */
  #requested = new Map();
  /** @type {Map<string, LoadedImage>} */
  #ready = new Map();

  /**
   * @param {{ loadImage: (url: string) => Promise<LoadedImage>, onLoaded?: () => void, onFailed?: (failure: ImageFailure) => void }} deps
   */
  constructor({ loadImage, onLoaded = () => undefined, onFailed = () => undefined }) {
    this.#loadImage = loadImage;
    this.#onLoaded = onLoaded;
    this.#onFailed = onFailed;
  }

  /**
   * The image when it is ready; otherwise null, starting its download if needed.
   * @param {string} key
   * @param {string} url where to download it from, the first time
   * @returns {LoadedImage | null}
   */
  imageFor(key, url) {
    const image = this.#ready.get(key);
    if (image === undefined) {
      void this.load(key, url);
      return null;
    }
    return image;
  }

  /**
   * Starts (once) the download of an image; resolves when it has settled. Never rejects.
   * @param {string} key
   * @param {string} url
   * @returns {Promise<void>}
   */
  load(key, url) {
    const started = this.#requested.get(key);
    if (started !== undefined) {
      return started;
    }
    const download = this.#loadImage(url)
      .then((image) => {
        if (!(image.width > 0 && image.height > 0)) {
          throw new Error("the image is empty");
        }
        this.#ready.set(key, image);
        this.#onLoaded();
      })
      .catch((error) => {
        this.#onFailed(Object.freeze({ key, url, reason: error instanceof Error ? error.message : String(error) }));
      });
    this.#requested.set(key, download);
    return download;
  }
}
