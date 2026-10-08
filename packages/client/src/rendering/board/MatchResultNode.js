/**
 * The result dialog's duel: the two players face to face, so who won and who
 * lost reads at a glance. The winner's portrait sits under a gold crown with
 * rays turning behind it, sparks twinkling round it and a WINNER ribbon
 * across its foot; the loser's is dimmed and cracked, its ribbon DEFEATED; a draw ribbons both alike. Each
 * portrait (their STEEM profile picture online, else their initial) is named
 * underneath, with the life it ended on; between them, the VS medallion, how
 * the match was settled ("KNOCKOUT") and on which turn.
 *
 * It plays in as the dialog opens — the seats slide in from either side, the
 * medallion is stamped down, then the crown drops onto the winner and the
 * ribbons land — and the rays keep turning, the sparks twinkling, while it is open. It holds no
 * clock of its own: `clock` says how long the result has been offered, so a
 * rebuilt dialog carries on where it was. Non-interactive.
 *
 * Composed for a 720×260 area; a smaller one (a phone's dialog) draws all of
 * it smaller, uniformly.
 */
import { Easing } from "../animation/Tween.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { bodyFont, displayFont } from "../theme/Theme.js";
import { drawAvatar } from "../ui/avatar.js";
import { drawOutlinedText, fillRoundedRect, radialGradient, verticalGradient } from "../ui/drawing.js";
import { drawGem, starPath } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

/** How each player came out of the match. @enum {string} */
export const Standing = Object.freeze({ WINNER: "winner", LOSER: "loser", DRAW: "draw" });

const RIBBON_TEXT = Object.freeze({ [Standing.WINNER]: "WINNER", [Standing.LOSER]: "DEFEATED", [Standing.DRAW]: "DRAW" });
const YOU_TAG = "YOU";

/** The area it is composed for. */
const DESIGN = Object.freeze({ width: 720, height: 260 });
/** A seat: how far its centre is from the middle, its portrait, the ribbon across the portrait's foot, the name and life under it. */
const SEAT = Object.freeze({ offset: 220, portraitY: 100, radius: 58, ring: 4, ribbonWidth: 176, ribbonHeight: 34, ribbonOverlap: 8, notch: 12, ribbonFont: 19, nameGap: 4, nameHeight: 30, nameFont: 24, lifeY: 236, lifeRadius: 15, tagWidth: 44, tagHeight: 20, tagGap: 8 });
/** The winner's light: rays turning behind the portrait (how many, how wide in radians, how far in radii, how fast in rad/ms) and a beating halo. */
const RAYS = Object.freeze({ count: 12, width: 0.11, reach: 2.1, spin: 0.00035, alpha: 0.32, haloBlur: 30, beatMs: 1600 });
/** The sparks twinkling round the winner: how many, how far out (in radii), how big, and how long one twinkle takes. */
const SPARKS = Object.freeze({ count: 9, near: 1.2, far: 1.8, size: 7, sizeSpread: 6, periodMs: 1400 });
/** The crown over the winner: its width and height, how far above the portrait it rests and how far it drops from. */
const CROWN = Object.freeze({ width: 62, height: 40, gap: 6, drop: 70, gem: 4.5 });
/** The loser's portrait: how dark it gets, and the cracks running across it. */
const FALLEN = Object.freeze({ dim: 0.5, cracks: 5, bends: 3, jitter: 0.5, reach: 0.95, width: 2 });
/** The medallion between the seats, and the lines under it. */
const MEDALLION = Object.freeze({ y: 92, radius: 40, font: 34, stamp: 1.8, verdictY: 160, verdictFont: 20, verdictHeight: 30, turnY: 188, turnFont: 16, turnHeight: 24, spread: 120 });
/** When each part plays, in ms since the result was offered: [start, length]. */
const TIMING = Object.freeze({ seats: [0, 420], medallion: [220, 320], crown: [520, 460], ribbons: [600, 300], crack: [600, 500], verdict: [760, 360] });
/** How far the seats slide in from. */
const SLIDE = 90;

/**
 * @typedef {Readonly<{ name: string, account: string | null, life: number, standing: string, isViewer: boolean }>} Fighter
 *   `account`: the STEEM account whose picture is shown, null for none (the local AI); `standing`: a Standing
 * @typedef {Readonly<{ left: Fighter, right: Fighter, verdict: string, turn: number }>} MatchResult
 *   `left`: the viewer (or the first seat, for a spectator); `verdict`: how the match was settled
 */

export class MatchResultNode extends UiNode {
  /** @type {MatchResult} */
  result;
  #clock;

  /**
   * @param {{ id?: string, x?: number, y?: number, width: number, height: number, result: MatchResult, clock: () => number }} options
   *   `clock`: how long the result has been offered, in ms
   */
  constructor({ result, clock, ...area }) {
    super(area);
    this.passthrough = true;
    this.result = result;
    this.#clock = clock;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const scale = Math.min(1, area.width / DESIGN.width, area.height / DESIGN.height);
    const origin = { x: area.x + area.width / 2, y: area.y + (area.height - DESIGN.height * scale) / 2 };
    const time = Math.max(0, this.#clock());
    context.save();
    context.translate(origin.x, origin.y);
    context.scale(scale, scale);
    const seats = Easing.easeOutBack(phase(time, TIMING.seats));
    paintSeat(context, theme, { fighter: this.result.left, side: -1, time, seats });
    paintSeat(context, theme, { fighter: this.result.right, side: 1, time, seats });
    this.#paintMedallion(context, theme, time);
    context.restore();
  }

  /**
   * VS between the seats, stamped down; how the match was settled and on which turn under it.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {number} time
   */
  #paintMedallion(context, theme, time) {
    const { colors } = theme;
    const stamp = phase(time, TIMING.medallion);
    if (stamp <= 0) {
      return;
    }
    const centre = { x: 0, y: MEDALLION.y };
    const radius = MEDALLION.radius * (1 + (MEDALLION.stamp - 1) * (1 - Easing.easeOutCubic(stamp)));
    const box = { x: -radius, y: centre.y - radius, width: radius * 2, height: radius * 2 };
    context.save();
    context.globalAlpha = stamp;
    context.shadowColor = withAlpha(colors.accent, 0.8);
    context.shadowBlur = 24;
    drawGem(context, centre, radius, { fill: verticalGradient(context, box, [[0, colors.panelLight], [1, colors.panelDark]]), rim: colors.accent, highlight: withAlpha("#ffffff", 0.1), sides: 6, rimWidth: 3 });
    context.restore();
    context.save();
    context.globalAlpha = stamp;
    drawOutlinedText(context, "VS", box, { font: displayFont(theme, MEDALLION.font * (radius / MEDALLION.radius)), color: colors.accentLight, outline: withAlpha(colors.letterbox, 0.9), outlineWidth: 5, glow: withAlpha(colors.accent, 0.9), glowBlur: 16 });
    context.restore();
    const shown = phase(time, TIMING.verdict);
    if (shown <= 0) {
      return;
    }
    context.save();
    context.globalAlpha = shown;
    const verdict = { x: -MEDALLION.spread, y: MEDALLION.verdictY + (1 - shown) * 10, width: 2 * MEDALLION.spread, height: MEDALLION.verdictHeight };
    drawOutlinedText(context, this.result.verdict, verdict, { font: displayFont(theme, MEDALLION.verdictFont), color: colors.accent, outline: withAlpha(colors.letterbox, 0.9), outlineWidth: 4, glow: withAlpha(colors.accent, 0.6), glowBlur: 10 });
    const turn = { ...verdict, y: MEDALLION.turnY + (1 - shown) * 10, height: MEDALLION.turnHeight };
    drawOutlinedText(context, `Turn ${this.result.turn}`, turn, { font: bodyFont(theme, MEDALLION.turnFont), color: colors.textMuted, outline: withAlpha(colors.letterbox, 0.8), outlineWidth: 3 });
    context.restore();
  }
}

/**
 * One player: their light (a winner's), portrait, crown, ribbon, name and life.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ fighter: Fighter, side: number, time: number, seats: number }} seat `side`: -1 on the left, 1 on the right; `seats`: how far they have slid in
 */
function paintSeat(context, theme, { fighter, side, time, seats }) {
  const { colors } = theme;
  const x = side * (SEAT.offset + (1 - seats) * SLIDE);
  const centre = { x, y: SEAT.portraitY };
  const won = fighter.standing === Standing.WINNER;
  const lost = fighter.standing === Standing.LOSER;
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, seats));
  if (won) {
    paintRays(context, theme, centre, time);
  }
  paintPortrait(context, theme, { fighter, centre });
  if (lost) {
    paintFallen(context, theme, centre, phase(time, TIMING.crack));
  }
  if (won) {
    paintCrown(context, theme, centre, phase(time, TIMING.crown));
    paintSparks(context, theme, centre, time);
  }
  paintRibbon(context, theme, { fighter, centre, landed: phase(time, TIMING.ribbons) });
  const nameTop = SEAT.portraitY + SEAT.radius - SEAT.ribbonOverlap + SEAT.ribbonHeight + SEAT.nameGap;
  const nameBox = { x: x - SEAT.offset / 2 - 40, y: nameTop, width: SEAT.offset + 80, height: SEAT.nameHeight };
  drawOutlinedText(context, fighter.name, nameBox, { font: displayFont(theme, SEAT.nameFont), color: nameColor(theme, fighter.standing), outline: withAlpha(colors.letterbox, 0.9), outlineWidth: 4 });
  paintLife(context, theme, { fighter, x });
  context.restore();
}

/**
 * The portrait in its ring: gold and glowing for the winner, red for the loser.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ fighter: Fighter, centre: { x: number, y: number } }} portrait
 */
function paintPortrait(context, theme, { fighter, centre }) {
  const { colors } = theme;
  const ring = ringColor(theme, fighter.standing);
  context.save();
  context.beginPath();
  context.arc(centre.x, centre.y, SEAT.radius + SEAT.ring, 0, Math.PI * 2);
  context.fillStyle = colors.panelDark;
  context.shadowColor = withAlpha(ring, 0.9);
  context.shadowBlur = fighter.standing === Standing.WINNER ? RAYS.haloBlur : 14;
  context.fill();
  context.restore();
  const account = fighter.account ?? fighter.name;
  drawAvatar(context, theme, { account, center: centre, radius: SEAT.radius, picture: fighter.account !== null });
  context.save();
  context.beginPath();
  context.arc(centre.x, centre.y, SEAT.radius + SEAT.ring / 2, 0, Math.PI * 2);
  context.lineWidth = SEAT.ring;
  context.strokeStyle = ring;
  context.stroke();
  context.restore();
}

/**
 * The loser's portrait going dark, cracks running across it.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} centre
 * @param {number} crack 0–1
 */
function paintFallen(context, theme, centre, crack) {
  if (crack <= 0) {
    return;
  }
  const { colors } = theme;
  context.save();
  context.beginPath();
  context.arc(centre.x, centre.y, SEAT.radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = withAlpha(mix(colors.letterbox, colors.danger, 0.25), FALLEN.dim * crack);
  context.fillRect(centre.x - SEAT.radius, centre.y - SEAT.radius, SEAT.radius * 2, SEAT.radius * 2);
  context.strokeStyle = withAlpha(mix("#ffffff", colors.danger, 0.4), 0.85);
  context.shadowColor = withAlpha(colors.danger, 0.9);
  context.shadowBlur = 8;
  context.lineWidth = FALLEN.width;
  context.lineJoin = "round";
  const reach = SEAT.radius * FALLEN.reach * Easing.easeOutCubic(crack);
  const heart = { x: centre.x + SEAT.radius * 0.15, y: centre.y - SEAT.radius * 0.1 };
  for (let index = 0; index < FALLEN.cracks; index += 1) {
    const heading = (index / FALLEN.cracks) * Math.PI * 2 + wobble(index, 0);
    context.beginPath();
    context.moveTo(heart.x, heart.y);
    for (let bend = 1; bend <= FALLEN.bends; bend += 1) {
      const angle = heading + wobble(index, bend) * FALLEN.jitter;
      const length = (reach * bend) / FALLEN.bends;
      context.lineTo(heart.x + Math.cos(angle) * length, heart.y + Math.sin(angle) * length);
    }
    context.stroke();
  }
  context.restore();
}

/**
 * Gold rays turning behind the winner, over a beating glow.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} centre
 * @param {number} time
 */
function paintRays(context, theme, centre, time) {
  const { accent, accentLight } = theme.colors;
  const reach = SEAT.radius * RAYS.reach;
  const beat = 0.75 + 0.25 * Math.sin((2 * Math.PI * time) / RAYS.beatMs);
  const angle = time * RAYS.spin;
  context.save();
  context.fillStyle = radialGradient(context, centre, reach, [
    [0, withAlpha(accentLight, RAYS.alpha * beat)],
    [1, withAlpha(accent, 0)],
  ]);
  context.fillRect(centre.x - reach, centre.y - reach, reach * 2, reach * 2);
  for (let index = 0; index < RAYS.count; index += 1) {
    const heading = angle + (index / RAYS.count) * Math.PI * 2;
    context.beginPath();
    context.moveTo(centre.x, centre.y);
    context.lineTo(centre.x + Math.cos(heading - RAYS.width) * reach, centre.y + Math.sin(heading - RAYS.width) * reach);
    context.lineTo(centre.x + Math.cos(heading + RAYS.width) * reach, centre.y + Math.sin(heading + RAYS.width) * reach);
    context.closePath();
    context.fill();
  }
  context.restore();
}

/**
 * Four-pointed sparks round the winner, each twinkling at its own moment once the crown has landed.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} centre
 * @param {number} time
 */
function paintSparks(context, theme, centre, time) {
  const since = time - TIMING.crown[0] - TIMING.crown[1];
  if (since <= 0) {
    return;
  }
  const { accent, accentLight } = theme.colors;
  context.save();
  context.fillStyle = accentLight;
  context.shadowColor = withAlpha(accent, 0.95);
  context.shadowBlur = 10;
  const faded = context.globalAlpha;
  for (let index = 0; index < SPARKS.count; index += 1) {
    const twinkle = Math.sin(2 * Math.PI * (since / SPARKS.periodMs + spread(index, 1)));
    if (twinkle <= 0) {
      continue;
    }
    const angle = (index / SPARKS.count) * Math.PI * 2 + spread(index, 2);
    const distance = SEAT.radius * (SPARKS.near + (SPARKS.far - SPARKS.near) * spread(index, 3));
    const at = { x: centre.x + Math.cos(angle) * distance, y: centre.y + Math.sin(angle) * distance };
    context.globalAlpha = faded * twinkle;
    starPath(context, at, (SPARKS.size + SPARKS.sizeSpread * spread(index, 4)) * (0.6 + 0.4 * twinkle), { points: 4, innerRatio: 0.3 });
    context.fill();
  }
  context.restore();
}

/**
 * A gold crown with three points and a jewel on each, dropping onto the winner.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} centre the portrait's centre
 * @param {number} landed 0–1
 */
function paintCrown(context, theme, centre, landed) {
  if (landed <= 0) {
    return;
  }
  const { colors } = theme;
  const bottom = centre.y - SEAT.radius - SEAT.ring - CROWN.gap + (Easing.easeOutBack(landed) - 1) * CROWN.drop;
  const left = centre.x - CROWN.width / 2;
  const top = bottom - CROWN.height;
  const w = CROWN.width;
  const h = CROWN.height;
  const box = { x: left, y: top, width: w, height: h };
  context.save();
  context.globalAlpha *= Math.min(1, landed * 2);
  context.beginPath();
  context.moveTo(left, bottom);
  context.lineTo(left, top + h * 0.3);
  context.lineTo(left + w * 0.25, top + h * 0.6);
  context.lineTo(left + w * 0.5, top);
  context.lineTo(left + w * 0.75, top + h * 0.6);
  context.lineTo(left + w, top + h * 0.3);
  context.lineTo(left + w, bottom);
  context.closePath();
  context.fillStyle = verticalGradient(context, box, [[0, colors.accentLight], [0.6, colors.accent], [1, colors.accentDark]]);
  context.shadowColor = withAlpha(colors.accent, 0.9);
  context.shadowBlur = 18;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 2;
  context.strokeStyle = shade(colors.accentDark, -0.3);
  context.stroke();
  const band = { x: left, y: bottom - h * 0.22, width: w, height: h * 0.22 };
  fillRoundedRect(context, band, { fill: withAlpha(colors.accentDark, 0.55), radius: 2 });
  for (const [px, py, tone] of /** @type {const} */ ([[0, 0.3, "danger"], [0.5, 0, "resource"], [1, 0.3, "danger"]])) {
    context.beginPath();
    context.arc(left + w * px, top + h * py, CROWN.gem, 0, Math.PI * 2);
    context.fillStyle = colors[tone];
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = colors.accentLight;
    context.stroke();
  }
  context.beginPath();
  context.arc(centre.x, band.y + band.height / 2, CROWN.gem, 0, Math.PI * 2);
  context.fillStyle = colors.success;
  context.fill();
  context.restore();
}

/**
 * The ribbon across the portrait's foot, notched at both ends, landing with a stamp.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ fighter: Fighter, centre: { x: number, y: number }, landed: number }} ribbon
 */
function paintRibbon(context, theme, { fighter, centre, landed }) {
  if (landed <= 0) {
    return;
  }
  const { colors } = theme;
  const grow = 1 + 0.4 * (1 - Easing.easeOutCubic(landed));
  const width = SEAT.ribbonWidth * grow;
  const height = SEAT.ribbonHeight * grow;
  const top = centre.y + SEAT.radius - SEAT.ribbonOverlap + (SEAT.ribbonHeight - height) / 2;
  const left = centre.x - width / 2;
  const box = { x: left, y: top, width, height };
  const tone = ribbonTone(theme, fighter.standing);
  context.save();
  context.globalAlpha *= landed;
  context.beginPath();
  context.moveTo(left - SEAT.notch, top);
  context.lineTo(left + width + SEAT.notch, top);
  context.lineTo(left + width, top + height / 2);
  context.lineTo(left + width + SEAT.notch, top + height);
  context.lineTo(left - SEAT.notch, top + height);
  context.lineTo(left, top + height / 2);
  context.closePath();
  context.fillStyle = verticalGradient(context, box, [[0, shade(tone, 0.2)], [1, shade(tone, -0.45)]]);
  context.shadowColor = withAlpha(colors.letterbox, 0.7);
  context.shadowBlur = 10;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 2;
  context.strokeStyle = fighter.standing === Standing.WINNER ? colors.accentLight : withAlpha(colors.accent, 0.6);
  context.stroke();
  const text = fighter.standing === Standing.WINNER ? colors.accentText : colors.text;
  drawOutlinedText(context, RIBBON_TEXT[fighter.standing] ?? "", box, { font: displayFont(theme, SEAT.ribbonFont * grow), color: text, outline: withAlpha(fighter.standing === Standing.WINNER ? colors.accentLight : colors.letterbox, 0.6), outlineWidth: 2 });
  context.restore();
}

/**
 * The life the player ended on, in a crystal like the board's; "YOU" before it on the viewer's seat.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ fighter: Fighter, x: number }} row
 */
function paintLife(context, theme, { fighter, x }) {
  const { colors } = theme;
  const lead = fighter.isViewer ? SEAT.tagWidth + SEAT.tagGap : 0;
  const centre = { x: x + lead / 2, y: SEAT.lifeY };
  const radius = SEAT.lifeRadius;
  const color = fighter.life <= 0 ? colors.danger : colors.health;
  const box = { x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2 };
  if (fighter.isViewer) {
    const tag = { x: centre.x - radius - SEAT.tagGap - SEAT.tagWidth, y: centre.y - SEAT.tagHeight / 2, width: SEAT.tagWidth, height: SEAT.tagHeight };
    fillRoundedRect(context, tag, { fill: withAlpha(colors.accent, 0.2), stroke: colors.accent, radius: SEAT.tagHeight / 2, lineWidth: 1.5 });
    drawOutlinedText(context, YOU_TAG, tag, { font: bodyFont(theme, 12, "bold"), color: colors.accentLight, outline: withAlpha(colors.letterbox, 0.6), outlineWidth: 2 });
  }
  context.save();
  context.shadowColor = withAlpha(color, 0.7);
  context.shadowBlur = 10;
  drawGem(context, centre, radius, { fill: verticalGradient(context, box, [[0, shade(color, 0.25)], [1, shade(color, -0.55)]]), rim: colors.accent, highlight: withAlpha("#ffffff", 0.3), sides: 6, rimWidth: 2 });
  context.restore();
  drawOutlinedText(context, String(Math.max(0, fighter.life)), box, { font: bodyFont(theme, radius * 1.05, "bold"), color: colors.text, outline: withAlpha("#000000", 0.85), outlineWidth: 3 });
}

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} standing
 */
function nameColor(theme, standing) {
  const { colors } = theme;
  if (standing === Standing.WINNER) {
    return colors.accentLight;
  }
  return standing === Standing.LOSER ? mix(colors.text, colors.textMuted, 0.5) : colors.text;
}

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} standing
 */
function ringColor(theme, standing) {
  if (standing === Standing.WINNER) {
    return theme.colors.accentLight;
  }
  return standing === Standing.LOSER ? theme.colors.danger : theme.colors.focus;
}

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} standing
 */
function ribbonTone(theme, standing) {
  if (standing === Standing.WINNER) {
    return theme.colors.accent;
  }
  return standing === Standing.LOSER ? shade(theme.colors.danger, -0.35) : theme.colors.panelBorder;
}

/**
 * How far through a part of the entrance `time` is, clamped to 0–1.
 * @param {number} time
 * @param {readonly number[]} part [start, length] in ms
 */
function phase(time, [start, length]) {
  return Math.min(1, Math.max(0, (time - start) / length));
}

/**
 * A fixed value in [0, 1) for the `salt`-th spark's `field`: scattered, but the same every frame.
 * @param {number} salt
 * @param {number} field
 */
function spread(salt, field) {
  const value = Math.sin(salt * 12.9898 + field * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * A fixed value in [-1, 1) for a crack's bend: jagged, but the same every frame.
 * @param {number} crack
 * @param {number} bend
 */
function wobble(crack, bend) {
  const value = Math.sin(crack * 57.3 + bend * 31.9) * 24634.6345;
  return (value - Math.floor(value)) * 2 - 1;
}
