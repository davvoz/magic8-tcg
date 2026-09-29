/**
 * The painted furniture of the game table, loaded on demand: the mat the
 * match is played on, the back of every card, and the stone the panels are
 * cut from. Until a piece's image is ready (or when it cannot be loaded)
 * its painter draws it procedurally.
 */
import { PieceArt } from "./PieceArt.js";

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
export class TableArt extends PieceArt {
  /**
   * @param {{
   *   urls: Readonly<Record<string, string>>,
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   * }} deps `urls`: the image of each piece (TablePiece → url)
   */
  constructor(deps) {
    super({ ...deps, pieces: Object.values(TablePiece), name: "table art" });
  }
}
