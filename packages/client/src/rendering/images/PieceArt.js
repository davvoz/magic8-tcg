/**
 * A fixed set of named painted pieces, one image each, loaded on demand
 * through an ImageCache. Until a piece's image is ready (or when it cannot
 * be loaded) `imageFor` answers null and its painter draws it procedurally.
 */
import { ImageCache } from "./ImageCache.js";

/** @typedef {import("./ImageCache.js").LoadedImage} LoadedImage */

export class PieceArt {
  /** @type {ReadonlyMap<string, string>} piece → url */
  #urls;
  #images;

  /**
   * @param {{
   *   pieces: readonly string[],
   *   name: string,
   *   urls: Readonly<Record<string, string>>,
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   * }} deps `urls`: the image of each piece (piece → url); `name` labels errors and warnings
   */
  constructor({ pieces, name, urls, loadImage, onLoaded = () => undefined, logger }) {
    if (!pieces.every((piece) => typeof urls?.[piece] === "string" && urls[piece].length > 0)) {
      throw new TypeError(`${name}: an image is needed for each piece (${pieces.join(", ")})`);
    }
    this.#urls = new Map(pieces.map((piece) => [piece, urls[piece]]));
    this.#images = new ImageCache({
      loadImage,
      onLoaded,
      onFailed: ({ key, url, reason }) => logger.warn(`${name} unavailable`, { piece: key, url, reason }),
    });
  }

  /**
   * The piece's image when it is ready; otherwise null, starting the download if needed.
   * @param {string} piece
   * @returns {LoadedImage | null}
   */
  imageFor(piece) {
    const url = this.#urls.get(piece);
    return url === undefined ? null : this.#images.imageFor(piece, url);
  }

  /** Downloads every piece; resolves when all have settled. Never rejects. */
  async preload() {
    await Promise.all([...this.#urls].map(([piece, url]) => this.#images.load(piece, url)));
  }
}
