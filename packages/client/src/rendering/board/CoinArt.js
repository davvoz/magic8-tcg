/**
 * The painted coin used by the opening toss: one image per face, loaded on
 * demand through an ImageCache. Until a face's image is ready (or when it
 * cannot be loaded) the toss draws that face procedurally.
 *
 * The art is a coin seen slightly from above, its rim painted beneath it,
 * so it does not fill its image: `disc` says where the face sits, as
 * fractions of the image width (x, radius) and height (y), which lets the
 * painter put the painted face exactly where it would draw its own.
 */
import { CoinFace } from "../../application/match/CoinToss.js";
import { ImageCache } from "../images/ImageCache.js";

/**
 * @typedef {import("../images/ImageCache.js").LoadedImage} LoadedImage
 * @typedef {Readonly<{ x: number, y: number, radius: number }>} Disc
 * @typedef {Readonly<{ image: LoadedImage, disc: Disc }>} CoinImage
 * @typedef {Readonly<{ imageFor: (face: string) => CoinImage | null }>} CoinArtSource what the toss painter reads (Theme.coinArt)
 */

/** @implements {CoinArtSource} */
export class CoinArt {
  /** @type {ReadonlyMap<string, string>} face → url */
  #urls;
  #disc;
  #images;

  /**
   * @param {{
   *   urls: Readonly<Record<string, string>>,
   *   disc: Disc,
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   * }} deps `urls`: the image of each face (CoinFace → url)
   */
  constructor({ urls, disc, loadImage, onLoaded = () => undefined, logger }) {
    const faces = Object.values(CoinFace);
    if (!faces.every((face) => typeof urls?.[face] === "string" && urls[face].length > 0)) {
      throw new TypeError(`CoinArt: an image is needed for each face (${faces.join(", ")})`);
    }
    if (![disc?.x, disc?.y, disc?.radius].every((value) => typeof value === "number" && value > 0 && value <= 1)) {
      throw new TypeError("CoinArt: the disc is given as fractions of the image, in (0, 1]");
    }
    this.#urls = new Map(faces.map((face) => [face, urls[face]]));
    this.#disc = Object.freeze({ x: disc.x, y: disc.y, radius: disc.radius });
    this.#images = new ImageCache({
      loadImage,
      onLoaded,
      onFailed: ({ key, url, reason }) => logger.warn("coin art unavailable", { face: key, url, reason }),
    });
  }

  /**
   * The face's painted image when it is ready; otherwise null, starting the download if needed.
   * @param {string} face a CoinFace
   * @returns {CoinImage | null}
   */
  imageFor(face) {
    const url = this.#urls.get(face);
    if (url === undefined) {
      return null;
    }
    const image = this.#images.imageFor(face, url);
    return image === null ? null : { image, disc: this.#disc };
  }

  /** Downloads both faces; resolves when both have settled. Never rejects. */
  async preload() {
    await Promise.all([...this.#urls].map(([face, url]) => this.#images.load(face, url)));
  }
}
