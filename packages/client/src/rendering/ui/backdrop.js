/**
 * The shared scene background: a deep radial glow, a vignette and a
 * deterministic scatter of faint motes, so every screen sits in the same
 * space instead of on a flat colour. The match is played on the painted
 * mat instead (Theme.tableArt) once its image is ready. Pure drawing; no state.
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { TablePiece } from "../images/TableArt.js";
import { withAlpha } from "../theme/color.js";
import { drawImageCover, radialGradient } from "./drawing.js";

const MOTE_COUNT = 70;
const MOTE_VALUES_PER_ITEM = 3;
const VIGNETTE_INNER = 0.55;

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
  context.save();
  context.fillStyle = colors.background;
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.fillStyle = radialGradient(context, center, radius, [
    [0, withAlpha(glow, 0.95)],
    [VIGNETTE_INNER, withAlpha(glow, 0.25)],
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
