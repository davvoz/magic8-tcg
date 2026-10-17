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
    // Cut out on transparency (1400×288, landscape for the top bar), not gold on black: the name in its frame, the flourishes above and below cut away.
    [UiPiece.TITLE]: "Logo_KIJAM.webp",
    // Plain paintings (620×630, their frames cropped away), drawn to cover the picture of a way to play.
    [UiPiece.PLAY_ONLINE_ARENA]: "Play_Online_Arena.jpg",
    [UiPiece.PLAY_PRACTICE]: "Play_Practice.jpg",
    [UiPiece.PLAY_TUTORIAL]: "Play_Tutorial.jpg",
    // Upright (620×1111), drawn to cover the pictures of the section cards on Home; Play's in landscape too (1100×614).
    [UiPiece.PLAY_ONLINE_TALL]: "Play_Online_Tall.jpg",
    [UiPiece.PLAY_ONLINE_WIDE]: "Play_Online_Wide.jpg",
    [UiPiece.DECKS_TALL]: "Decks_Tall.jpg",
    [UiPiece.MARKET_TALL]: "Market_Tall.jpg",
    [UiPiece.SEASON_TALL]: "Season_Tall.jpg",
    // STEEM's official mark (256×256, on transparency), its strokes filled white.
    [UiPiece.STEEM_LOGO]: "Steem_Logo.png",
  }),
  layout: Object.freeze({
    // The name's letters (measured on Logo_KIJAM.webp: their top and foot, where each of K-I-J-A-M starts and the last ends) and the compass star's heart.
    title: Object.freeze({ top: 0.12, bottom: 0.85, stops: Object.freeze([0.19, 0.345, 0.405, 0.495, 0.66, 0.835]), star: Object.freeze({ x: 0.171, y: 0.441 }) }),
    corner: Object.freeze({ extent: Object.freeze({ x: 0.0485, y: 0.0274, width: 0.8954, height: 0.9015 }), lines: Object.freeze({ x: 0.1046, y: 0.0702 }) }),
    divider: Object.freeze({ x: 0.1678, y: 0.1684, width: 0.6644, height: 0.6531 }),
    buttons: Object.freeze({
      primary: Object.freeze({ plate: Object.freeze({ x: 0.0248, y: 0.2653, width: 0.9503, height: 0.4349 }), caps: Object.freeze({ left: 0.2351, right: 0.2369 }), radius: 0.235 }),
      secondary: Object.freeze({ plate: Object.freeze({ x: 0.0411, y: 0.2857, width: 0.9178, height: 0.4145 }), caps: Object.freeze({ left: 0.2071, right: 0.208 }), radius: 0.209 }),
    }),
  }),
});
