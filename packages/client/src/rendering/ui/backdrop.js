/**
 * The shared scene background: a deep radial glow, a vignette and a
 * deterministic scatter of faint motes, so every screen sits in the same
 * space instead of on a flat colour; under them, once its image is ready,
 * the painted menu backdrop (Theme.uiArt). The match is played on the
 * painted mat instead (Theme.tableArt). Pure drawing; no state.
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { TablePiece } from "../images/TableArt.js";
import { UiPiece } from "../images/UiArt.js";
import { withAlpha } from "../theme/color.js";
import { coverCrop, drawImageCover, radialGradient } from "./drawing.js";

const MOTE_COUNT = 70;
const MOTE_VALUES_PER_ITEM = 3;
const VIGNETTE_INNER = 0.55;
/** The glow at the centre and at the vignette's inner ring: strong on the plain colour, a tint over the painted backdrop. */
const GLOW_ALPHA = Object.freeze({ plain: Object.freeze({ center: 0.95, ring: 0.25 }), painted: Object.freeze({ center: 0.3, ring: 0.06 }) });
/** How much the painted backdrop may be stretched out of its proportions instead of cropped. */
const MAX_SQUEEZE = 1.12;

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} bounds
 * @param {{ glowKey?: string, seed?: string, motes?: boolean }} [options] `glowKey` is a theme colour token for the central light
 */
export function drawSceneBackdrop(context, theme, bounds, { glowKey = "backgroundGlow", seed = "backdrop", motes = true } = {}) {
  const { colors } = theme;
  const glow = colors[glowKey] ?? colors.backgroundGlow;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.42 };
  const radius = Math.max(bounds.width, bounds.height) * 0.75;
  const art = theme.uiArt?.imageFor(UiPiece.BACKDROP) ?? null;
  context.save();
  context.fillStyle = colors.background;
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  if (art !== null) {
    drawArtBackdrop(context, art, bounds);
  }
  // Over the painted backdrop the glow only tints it, keeping each scene's colour.
  const glowAlpha = art === null ? GLOW_ALPHA.plain : GLOW_ALPHA.painted;
  context.fillStyle = radialGradient(context, center, radius, [
    [0, withAlpha(glow, glowAlpha.center)],
    [VIGNETTE_INNER, withAlpha(glow, glowAlpha.ring)],
    [1, withAlpha(colors.letterbox, 0.65)],
  ]);
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  if (motes) {
    drawMotes(context, bounds, { color: colors.accentLight, seed });
  }
  context.restore();
}

/**
 * The match background: the painted mat under a soft vignette, or the
 * shared backdrop while the mat is not ready.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} bounds
 */
export function drawTableBackdrop(context, theme, bounds) {
  const mat = theme.tableArt?.imageFor(TablePiece.MAT) ?? null;
  if (mat === null) {
    drawSceneBackdrop(context, theme, bounds, { seed: "match", motes: false });
    return;
  }
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  context.save();
  drawImageCover(context, mat, bounds);
  context.fillStyle = radialGradient(context, center, Math.max(bounds.width, bounds.height) * 0.7, [
    [0, withAlpha(theme.colors.backgroundGlow, 0.18)],
    [VIGNETTE_INNER, withAlpha(theme.colors.letterbox, 0)],
    [1, withAlpha(theme.colors.letterbox, 0.55)],
  ]);
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
}

/**
 * The painted menu backdrop over the whole screen. Its framed edges matter,
 * so rather than cropping them all away to fit the screen's proportions it
 * is squeezed a little (at most MAX_SQUEEZE) and only the rest is cropped.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../images/ImageCache.js").LoadedImage} art
 * @param {import("@magic8/engine/shared/geometry.js").Rect} bounds
 */
function drawArtBackdrop(context, art, bounds) {
  const imageAspect = art.width / art.height;
  const screenAspect = bounds.width / bounds.height;
  const squeeze = Math.min(MAX_SQUEEZE, Math.max(imageAspect, screenAspect) / Math.min(imageAspect, screenAspect));
  // Crop to proportions `squeeze` closer to the image's own, then stretch that into the screen.
  const target = imageAspect < screenAspect ? { width: bounds.width, height: bounds.height * squeeze } : { width: bounds.width * squeeze, height: bounds.height };
  const crop = coverCrop(art, target, [0.5, 0.5]);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(art.source, crop.x, crop.y, crop.width, crop.height, bounds.x, bounds.y, bounds.width, bounds.height);
}

/**
 * Faint scattered points of light; positions and sizes come from the seed
 * so the field is identical on every frame.
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} bounds
 * @param {{ color: string, seed: string }} style
 */
function drawMotes(context, bounds, { color, seed }) {
  const values = unitSequence(hashString(seed), MOTE_COUNT * MOTE_VALUES_PER_ITEM);
  for (let index = 0; index < MOTE_COUNT; index += 1) {
    const [u, v, w] = values.slice(index * MOTE_VALUES_PER_ITEM, (index + 1) * MOTE_VALUES_PER_ITEM);
    const radius = 0.6 + w * 1.6;
    context.beginPath();
    context.arc(bounds.x + u * bounds.width, bounds.y + v * bounds.height, radius, 0, Math.PI * 2);
    context.fillStyle = withAlpha(color, 0.08 + w * 0.22);
    context.fill();
  }
}
