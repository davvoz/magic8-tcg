/**
 * Small marks that stand for a thing beside its figure: STEEM's mark beside
 * an amount of money, a ranked ticket beside a count of tickets. Pictures,
 * not words, so they read at a label's height.
 *
 * STEEM's mark is its official artwork (Theme.uiArt); until the image is
 * ready, a disc in STEEM's blues (theme tokens) with three white strokes
 * stands in. Tickets are a neat little stack of three, cut as the game's
 * tickets are (ticketPaper.js), the front one printed in brief.
 */
import { UiPiece } from "../images/UiArt.js";
import { mix, withAlpha } from "../theme/color.js";
import { starPath } from "./shapes.js";
import { TICKET, ticketPath } from "./ticketPaper.js";

export const Glyph = Object.freeze({ STEEM: "steem", TICKET: "ticket" });

/**
 * The small stack of tickets: how many, how far each sits up (in ticket heights) and to the right (in ticket widths) of
 * the one in front, and how much darker each one behind is.
 */
const STACK_GLYPH = Object.freeze({ count: 3, dx: 0.1, dy: 0.17, dusk: 0.28 });
/** Each glyph's width over its height. */
const ASPECT = Object.freeze({
  [Glyph.STEEM]: 1,
  [Glyph.TICKET]: (TICKET.aspect * (1 + (STACK_GLYPH.count - 1) * STACK_GLYPH.dx)) / (1 + (STACK_GLYPH.count - 1) * STACK_GLYPH.dy),
});

/**
 * How wide a glyph is at a height.
 * @param {string} glyph one of Glyph
 * @param {number} height
 */
export function glyphWidth(glyph, height) {
  return height * (ASPECT[/** @type {keyof typeof ASPECT} */ (glyph)] ?? 1);
}

/**
 * Draws a glyph with its left edge at `x`, centred on `y`.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} glyph one of Glyph
 * @param {{ x: number, y: number, height: number }} place
 */
export function drawGlyph(context, theme, glyph, { x, y, height }) {
  if (glyph === Glyph.TICKET) {
    drawTicketStack(context, theme, { x, y, height });
    return;
  }
  drawSteemMark(context, theme, { x: x + height / 2, y }, height / 2);
}

/**
 * STEEM's mark: its artwork once ready, else a disc in its blues with three white strokes rising across it.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 */
export function drawSteemMark(context, theme, center, radius) {
  const logo = theme.uiArt?.imageFor(UiPiece.STEEM_LOGO) ?? null;
  if (logo !== null) {
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(logo.source, center.x - radius, center.y - radius, 2 * radius, 2 * radius);
    context.restore();
    return;
  }
  const { colors } = theme;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  const disc = context.createLinearGradient(center.x - radius, center.y - radius, center.x + radius, center.y + radius);
  disc.addColorStop(0, colors.steemLight);
  disc.addColorStop(1, colors.steem);
  context.fillStyle = disc;
  context.fill();
  context.lineWidth = Math.max(1, radius * 0.08);
  context.strokeStyle = withAlpha(colors.letterbox, 0.35);
  context.stroke();
  context.strokeStyle = colors.text;
  context.lineCap = "round";
  context.lineWidth = Math.max(1.2, radius * 0.17);
  for (const offset of [-1, 0, 1]) {
    const x = center.x + offset * radius * 0.36;
    const lift = offset === 0 ? radius * 0.12 : 0;
    context.beginPath();
    context.moveTo(x - radius * 0.1, center.y + radius * 0.5 - lift);
    context.bezierCurveTo(x - radius * 0.32, center.y + radius * 0.15, x + radius * 0.3, center.y - radius * 0.05, x + radius * 0.08, center.y - radius * 0.52 - lift);
    context.stroke();
  }
  context.restore();
}
/**
 * A neat little stack of three tickets, as the game's tickets are cut (ticketPath): square to one another, each one
 * set up and to the right of the one in front by the same step, the ones behind a shade darker, a thin shadow
 * between them; the front one printed with its frame, a star and the perforation before its stub.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number, height: number }} place the stack's left edge and middle, and the glyph's height
 */
function drawTicketStack(context, theme, { x, y, height }) {
  const behind = STACK_GLYPH.count - 1;
  const tall = height / (1 + behind * STACK_GLYPH.dy);
  const wide = tall * TICKET.aspect;
  const top = y - height / 2;
  for (let layer = behind; layer >= 0; layer -= 1) {
    const ticket = { x: Math.round(x + layer * STACK_GLYPH.dx * wide), y: Math.round(top + (behind - layer) * STACK_GLYPH.dy * tall), width: Math.round(wide), height: Math.round(tall) };
    paintSmallTicket(context, theme, ticket, { shade: layer * STACK_GLYPH.dusk, front: layer === 0 });
  }
}

/**
 * One small ticket: crisp gilt, its outline, and on the front one its printing in brief.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 * @param {{ shade: number, front: boolean }} look `shade` (0–1): how much darker it is
 */
function paintSmallTicket(context, theme, ticket, { shade, front }) {
  const { colors } = theme;
  const { x, y, width, height } = ticket;
  context.save();
  ticketPath(context, ticket);
  context.shadowColor = withAlpha(colors.letterbox, 0.7);
  context.shadowBlur = Math.max(1, height * 0.12);
  context.shadowOffsetX = -Math.max(0.5, height * 0.04);
  context.shadowOffsetY = Math.max(0.5, height * 0.06);
  const gilt = context.createLinearGradient(x, y, x, y + height);
  gilt.addColorStop(0, mix(colors.accentLight, colors.accentDark, shade));
  gilt.addColorStop(0.5, mix(colors.accent, colors.accentDark, shade * 0.8));
  gilt.addColorStop(1, mix(colors.accent, colors.accentDark, 0.35 + shade * 0.5));
  context.fillStyle = gilt;
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 1;
  context.strokeStyle = mix(colors.accentDark, colors.letterbox, 0.25);
  context.stroke();
  if (front) {
    const stub = x + width * TICKET.stub;
    const inset = Math.max(1.5, height * 0.16);
    context.strokeStyle = withAlpha(colors.accentDark, 0.8);
    context.lineWidth = Math.max(0.75, height * 0.05);
    context.beginPath();
    context.rect(x + inset, y + inset, stub - x - 2 * inset, height - 2 * inset);
    context.stroke();
    starPath(context, { x: x + (stub - x) / 2, y: y + height / 2 }, height * 0.2, { points: 5 });
    context.fillStyle = colors.accentDark;
    context.fill();
    context.setLineDash([Math.max(1, height * 0.08), Math.max(1, height * 0.07)]);
    context.beginPath();
    context.moveTo(stub, y + height * (TICKET.notch + 0.08));
    context.lineTo(stub, y + height * (1 - TICKET.notch - 0.08));
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}
