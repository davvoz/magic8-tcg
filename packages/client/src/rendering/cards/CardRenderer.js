/**
 * Board cards: the shared card face (CardFace) drawn in a base 150×210
 * coordinate system and scaled uniformly to the requested rectangle, so
 * hand cards, battlefield cards and shrinking "dying" cards share one code
 * path, plus the glowing ring that shows interaction state and the flash
 * of a blow the card just took. Also the card
 * back shown for the opponent's hidden hand.
 */
import { Highlight } from "../../input/interaction/MatchInteraction.js";
import { BoardFace, CARD_SIZE } from "../board/BoardLayout.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { TablePiece } from "../images/TableArt.js";
import { bevelRoundedRect, drawImageCover, fillRoundedRect, glowRoundedRect, insetRect, roundedRectPath, verticalGradient } from "../ui/drawing.js";
import { drawGem, starPath } from "../ui/shapes.js";
import { CardFaceProfile, paintCardFace } from "./CardFace.js";

const BASE = CARD_SIZE.battlefield;
const BASE_FRAME = Object.freeze({ x: 0, y: 0, width: BASE.width, height: BASE.height });
const RING = Object.freeze({ radius: BASE.width * 0.06, blur: 22, lineWidth: 3.5, focusLineWidth: 3 });
/** A struck card: its face washed with a hot white-red, and a red halo round it, both at full strength the instant the blow lands. */
const FLASH = Object.freeze({ tint: 0.45, wash: 0.6, blur: 26, lineWidth: 4 });

/** Highlight → theme colour key of the ring. */
const RING_COLORS = Object.freeze({
  [Highlight.PLAYABLE]: "success",
  [Highlight.SELECTED]: "accent",
  [Highlight.TARGETABLE]: "focus",
  [Highlight.ATTACKING]: "danger",
  [Highlight.BLOCKING]: "focus",
});

/**
 * @typedef {import("./CardFace.js").CardFaceModel} BoardCard
 * @typedef {{ x: number, y: number, width: number, height: number, alpha: number }} CardPlacement
 * @typedef {{ highlight?: string | null, focused?: boolean, rarity?: string | null, flash?: number, profile?: import("./CardFace.js").CardFaceProfile }} CardStyle `rarity`: shown on the type ribbon when known;
 *   `flash`: 0–1, how brightly a blow it just took still shows; `profile`: the face's type sizes (the compact one by default, the mini one for a phone's board)
 */

/**
 * The face profile a board draws its cards with (BoardLayout's `face`).
 * @param {string} face a BoardFace
 * @returns {import("./CardFace.js").CardFaceProfile}
 */
export function boardFaceProfile(face) {
  return face === BoardFace.MINI ? CardFaceProfile.MINI : CardFaceProfile.COMPACT;
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {BoardCard} card
 * @param {CardPlacement & CardStyle} at where to draw it, plus the optional highlight/focus ring
 */
export function drawCard(context, theme, card, at) {
  if (at.width <= 0 || at.height <= 0 || at.alpha <= 0) {
    return;
  }
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, at.alpha));
  context.translate(at.x, at.y);
  context.scale(at.width / BASE.width, at.height / BASE.height);
  const ring = ringFor(theme, at);
  if (ring !== null) {
    glowRoundedRect(context, BASE_FRAME, { color: ring.color, radius: RING.radius, blur: RING.blur, lineWidth: ring.width });
  }
  paintCardFace(context, theme, card, { frame: BASE_FRAME, profile: at.profile ?? CardFaceProfile.COMPACT, rarity: at.rarity ?? null });
  if (ring !== null) {
    fillRoundedRect(context, BASE_FRAME, { stroke: ring.color, radius: RING.radius, lineWidth: ring.width });
  }
  paintFlash(context, theme, at.flash ?? 0);
  context.restore();
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {number} strength 0–1
 */
function paintFlash(context, theme, strength) {
  if (strength <= 0) {
    return;
  }
  const { danger } = theme.colors;
  glowRoundedRect(context, BASE_FRAME, { color: withAlpha(danger, strength), radius: RING.radius, blur: FLASH.blur, lineWidth: FLASH.lineWidth });
  fillRoundedRect(context, BASE_FRAME, { fill: withAlpha(mix("#ffffff", danger, FLASH.tint), FLASH.wash * strength), radius: RING.radius });
}

/**
 * Highlight ring beats focus ring; no ring otherwise.
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {CardStyle} style
 * @returns {{ color: string, width: number } | null}
 */
function ringFor(theme, { highlight = null, focused = false }) {
  const ring = highlight === null ? undefined : theme.colors[RING_COLORS[highlight]];
  if (ring !== undefined) {
    return { color: ring, width: RING.lineWidth };
  }
  return focused ? { color: theme.colors.focus, width: RING.focusLineWidth } : null;
}

/**
 * The hidden side of a card: the painted back (Theme.tableArt) once its
 * image is ready, framed by a thin gold rim; until then a deep slab with a
 * double gold rim and a central star gem. Drawn at the given size (no base
 * system: it has no text).
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number, width: number, height: number }} at
 */
export function drawCardBack(context, theme, at) {
  const painted = theme.tableArt?.imageFor(TablePiece.CARD_BACK) ?? null;
  if (painted === null) {
    paintDrawnCardBack(context, theme, at);
  } else {
    paintPaintedCardBack(context, theme, at, painted);
  }
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number, width: number, height: number }} at
 * @param {import("../images/ImageCache.js").LoadedImage} image
 */
function paintPaintedCardBack(context, theme, at, image) {
  const { colors } = theme;
  const radius = at.width * 0.1;
  const rim = Math.max(1, at.width * 0.03);
  context.save();
  roundedRectPath(context, at, radius);
  context.clip();
  drawImageCover(context, image, at);
  context.restore();
  bevelRoundedRect(context, at, { light: withAlpha(colors.accentLight, 0.2), dark: withAlpha("#000000", 0.6), radius });
  fillRoundedRect(context, at, { stroke: colors.accentDark, radius, lineWidth: rim });
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number, width: number, height: number }} at
 */
function paintDrawnCardBack(context, theme, at) {
  const { colors } = theme;
  const radius = at.width * 0.1;
  const rim = Math.max(1, at.width * 0.04);
  fillRoundedRect(context, at, { fill: verticalGradient(context, at, [[0, shade(colors.backgroundGlow, 0.05)], [1, shade(colors.background, -0.3)]]), stroke: colors.accentDark, radius, lineWidth: rim });
  bevelRoundedRect(context, at, { light: withAlpha(colors.accentLight, 0.25), dark: withAlpha("#000000", 0.6), radius });
  fillRoundedRect(context, insetRect(at, rim * 2.2), { stroke: withAlpha(colors.accent, 0.6), radius: Math.max(0, radius - rim * 2), lineWidth: Math.max(0.8, rim * 0.5) });
  const center = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  const gemRadius = at.width * 0.22;
  context.save();
  context.shadowColor = withAlpha(colors.accent, 0.8);
  context.shadowBlur = gemRadius;
  drawGem(context, center, gemRadius, { fill: verticalGradient(context, { x: center.x - gemRadius, y: center.y - gemRadius, width: gemRadius * 2, height: gemRadius * 2 }, [[0, colors.accentLight], [1, colors.accentDark]]), rim: colors.accentDark, highlight: withAlpha("#ffffff", 0.35), sides: 4, rimWidth: Math.max(0.8, rim * 0.5) });
  context.restore();
  starPath(context, center, gemRadius * 0.55, { points: 4, innerRatio: 0.35 });
  context.fillStyle = withAlpha(colors.background, 0.7);
  context.fill();
}
