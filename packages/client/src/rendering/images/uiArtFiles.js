/**
 * The painted menus' files and where things are in each of them, shared by
 * the game and the preview harness.
 */
import { UiPiece } from "./UiArt.js";

/**
 * The painted menus, in the art directory (data/art/: gold on black, 1168×784 or 784×1168),
 * and where things are in each image, as fractions of it (measured on these
 * files: regenerating one means measuring it again).
 */
export const UI_ART = Object.freeze({
  files: Object.freeze({
    [UiPiece.BACKDROP]: "Sfondo_Menu.jpg",
    [UiPiece.CORNER]: "Angolo_decorativo_pannelli.jpg",
    [UiPiece.DIVIDER]: "DIVISORE_TITOLI.jpg",
    [UiPiece.BUTTON_PRIMARY]: "BOTTONE_PRIMARIO.jpg",
    [UiPiece.BUTTON_SECONDARY]: "BOTTONE_SECONDARIO.jpg",
    // Cut out on transparency (1100×663), not gold on black: the name, "Trading card game" and their scrolls.
    [UiPiece.TITLE]: "Logo_KIJAM.webp",
    // Plain paintings (620×630, their frames cropped away), drawn to cover the picture of a way to play.
    [UiPiece.PLAY_ONLINE]: "Play_Online.jpg",
    [UiPiece.PLAY_PRACTICE]: "Play_Practice.jpg",
    [UiPiece.PLAY_TUTORIAL]: "Play_Tutorial.jpg",
  }),
  layout: Object.freeze({
    title: Object.freeze({ top: 0.39, bottom: 0.72, stops: Object.freeze([0.083, 0.285, 0.39, 0.479, 0.68, 0.93]), star: Object.freeze({ x: 0.4943, y: 0.2905 }) }),
    corner: Object.freeze({ extent: Object.freeze({ x: 0.0485, y: 0.0274, width: 0.8954, height: 0.9015 }), lines: Object.freeze({ x: 0.1046, y: 0.0702 }) }),
    divider: Object.freeze({ x: 0.1678, y: 0.1684, width: 0.6644, height: 0.6531 }),
    buttons: Object.freeze({
      primary: Object.freeze({ plate: Object.freeze({ x: 0.0248, y: 0.2653, width: 0.9503, height: 0.4349 }), caps: Object.freeze({ left: 0.2351, right: 0.2369 }), radius: 0.235 }),
      secondary: Object.freeze({ plate: Object.freeze({ x: 0.0411, y: 0.2857, width: 0.9178, height: 0.4145 }), caps: Object.freeze({ left: 0.2071, right: 0.208 }), radius: 0.209 }),
    }),
  }),
});
