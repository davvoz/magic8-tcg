/**
 * The painted furniture of the screens around the match: the backdrop of
 * every menu, the gold corner that dresses large panels, the medallion of
 * the title divider and the plates of the buttons. Each ornament is painted
 * gold on pure black (JPEG, no alpha) and laid with the "screen" blend, so
 * its black drops out; the button plates are cut out along their rounded
 * outline instead. Until a piece's image is ready its painter draws it
 * procedurally.
 */
import { PieceArt } from "./PieceArt.js";

export const UiPiece = Object.freeze({
  /** Every menu screen's background: quiet in the middle, ornate at the edges. */
  BACKDROP: "backdrop",
  /** A panel's top-left corner; mirrored onto the other three. */
  CORNER: "corner",
  /** The medallion at the centre of a title divider. */
  DIVIDER: "divider",
  /** The plate of a primary button: heavy gold rim. */
  BUTTON_PRIMARY: "buttonPrimary",
  /** The plate of every other button: thin gold rim. */
  BUTTON_SECONDARY: "buttonSecondary",
});

/**
 * @typedef {import("./ImageCache.js").LoadedImage} LoadedImage
 * @typedef {Readonly<{ x: number, y: number, width: number, height: number }>} FractionRect a box as fractions of the image's width and height
 * @typedef {Readonly<{
 *   plate: FractionRect,
 *   caps: Readonly<{ left: number, right: number }>,
 *   radius: number,
 * }>} PlateLayout `caps`: the ornate ends, as fractions of the plate's width, kept whole while
 *   the plain middle stretches; `radius`: the plate's corner radius as a fraction of its height
 * @typedef {Readonly<{
 *   corner: Readonly<{ extent: FractionRect, lines: Readonly<{ x: number, y: number }> }>,
 *   divider: FractionRect,
 *   buttons: Readonly<{ primary: PlateLayout, secondary: PlateLayout }>,
 * }>} UiArtLayout where things are in each image. `corner.extent`: the painted part;
 *   `corner.lines`: where its vertical and horizontal lines run, laid on the panel's rim.
 *   `divider`: the medallion, centred on the divider's line
 * @typedef {Readonly<{ imageFor: (piece: string) => LoadedImage | null, layout: UiArtLayout }>} UiArtSource what the painters read (Theme.uiArt)
 */

/** @implements {UiArtSource} */
export class UiArt extends PieceArt {
  /** @type {UiArtLayout} */
  layout;

  /**
   * @param {{
   *   urls: Readonly<Record<string, string>>,
   *   layout: UiArtLayout,
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   * }} deps `urls`: the image of each piece (UiPiece → url)
   */
  constructor({ layout, ...deps }) {
    super({ ...deps, pieces: Object.values(UiPiece), name: "ui art" });
    this.layout = layout;
  }
}

/**
 * A fraction box in an image's pixels.
 * @param {FractionRect} box
 * @param {{ width: number, height: number }} image
 */
export function inPixels(box, image) {
  return { x: box.x * image.width, y: box.y * image.height, width: box.width * image.width, height: box.height * image.height };
}
