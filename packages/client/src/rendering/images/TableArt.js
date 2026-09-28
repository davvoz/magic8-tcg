/**
 * The painted furniture of the game table, loaded on demand through an
 * ImageCache: the mat the match is played on, the back of every card, and
 * the stone the panels are cut from. Until a piece's image is ready (or
 * when it cannot be loaded) its painter draws it procedurally.
 */
import { ImageCache } from "./ImageCache.js";

/**
 * @typedef {import("./ImageCache.js").LoadedImage} LoadedImage
 * @typedef {Readonly<{ imageFor: (piece: string) => LoadedImage | null }>} TableArtSource what the painters read (Theme.tableArt)
 */

export const TablePiece = Object.freeze({
  /** The match background: dark, quiet in the middle where the cards lie. */
  MAT: "mat",
  /** The back of a card, in card proportions. */
  CARD_BACK: "cardBack",
  /** A stone surface laid under panels; not seamless, so it is stretched, never tiled. */
  PANEL: "panel",
});

/** @implements {TableArtSource} */
export class TableArt {
  /** @type {ReadonlyMap<string, string>} piece → url */
  #urls;
  #images;

  /**
   * @param {{
   *   urls: Readonly<Record<string, string>>,
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   * }} deps `urls`: the image of each piece (TablePiece → url)
   */
  constructor({ urls, loadImage, onLoaded = () => undefined, logger }) {
    const pieces = Object.values(TablePiece);
    if (!pieces.every((piece) => typeof urls?.[piece] === "string" && urls[piece].length > 0)) {
      throw new TypeError(`TableArt: an image is needed for each piece (${pieces.join(", ")})`);
    }
    this.#urls = new Map(pieces.map((piece) => [piece, urls[piece]]));
    this.#images = new ImageCache({
      loadImage,
      onLoaded,
      onFailed: ({ key, url, reason }) => logger.warn("table art unavailable", { piece: key, url, reason }),
    });
  }

  /**
   * The piece's image when it is ready; otherwise null, starting the download if needed.
   * @param {string} piece a TablePiece
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
