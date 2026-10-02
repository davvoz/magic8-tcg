/**
 * Draws the end of a match over everything else: the table darkening, the
 * fallen player's crystal cracking and bursting, and the outcome coming down
 * over the middle of the table. GameOverSequence says where everything is;
 * this is only the light and the shapes. Non-interactive, and it draws
 * nothing once the sequence is over, so the board can be looked at again.
 */
import { mix, withAlpha } from "../theme/color.js";
import { displayFont } from "../theme/Theme.js";
import { drawOutlinedText, radialGradient } from "../ui/drawing.js";
import { polygonPath } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";
import { GameOverMood } from "./GameOverSequence.js";

/** How dark the table gets, and the colour creeping in from the edges after a defeat. */
const DIM = Object.freeze({ depth: 0.62, vignette: 0.32, vignetteFrom: 0.45 });
/** The cracks through a crystal: how many, how far past its rim they reach, and how they are drawn. */
const CRACK = Object.freeze({ count: 7, reach: 1.25, bends: 3, jitter: 0.45, width: 2.2, blur: 12 });
const SHARD_BLUR = 10;
const FLASH_STRENGTH = 0.55;
/** The outcome: its size, how much larger a victory starts, how far a defeat drops from, and the line under it. */
/** The outcome's type is sized for a board this tall, and shrinks with a shorter one (a phone's) down to `minFit` of it. */
const TITLE_FIT = Object.freeze({ height: 760, minFit: 0.6 });
const TITLE = Object.freeze({ font: 120, growFrom: 1, minScale: 0.9, drop: 150, glowBlur: 34, subtitleFont: 26, subtitleGap: 18 });
/** The rays behind a victory: how many, how wide (radians), how far they reach, and the glow at their heart. */
const RAYS = Object.freeze({ count: 14, width: 0.09, reach: 620, alpha: 0.16, glowReach: 360, glowAlpha: 0.35 });

export class GameOverNode extends UiNode {
  #sequence;
  #centreY;

  /**
   * @param {{ sequence: import("./GameOverSequence.js").GameOverSequence, x?: number, y?: number, width: number, height: number, centreY: number }} options
   *   `centreY`: the middle line of the table, where the outcome is shown
   */
  constructor({ sequence, x = 0, y = 0, width, height, centreY }) {
    super({ id: "gameOverSequence", x, y, width, height });
    this.passthrough = true;
    this.#sequence = sequence;
    this.#centreY = centreY;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const sequence = this.#sequence;
    if (sequence.isDone) {
      return;
    }
    this.#paintDim(context, theme);
    for (const crystal of sequence.crystals) {
      if (sequence.burst) {
        paintSocket(context, theme, crystal);
      } else {
        paintCracks(context, theme, crystal, sequence.crack);
      }
    }
    paintShards(context, theme, sequence.shards);
    this.#paintFlash(context, theme);
    this.#paintTitle(context, theme);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintDim(context, theme) {
    const { dim, mood } = this.#sequence;
    if (dim <= 0) {
      return;
    }
    const area = this.bounds;
    context.save();
    context.fillStyle = withAlpha(theme.colors.letterbox, DIM.depth * dim);
    context.fillRect(area.x, area.y, area.width, area.height);
    if (mood === GameOverMood.DEFEAT) {
      const centre = { x: area.x + area.width / 2, y: this.#centreY };
      context.fillStyle = radialGradient(context, centre, Math.max(area.width, area.height) * 0.7, [
        [DIM.vignetteFrom, withAlpha(theme.colors.danger, 0)],
        [1, withAlpha(theme.colors.danger, DIM.vignette * dim)],
      ]);
      context.fillRect(area.x, area.y, area.width, area.height);
    }
    context.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintFlash(context, theme) {
    const { flash } = this.#sequence;
    if (flash <= 0) {
      return;
    }
    const area = this.bounds;
    context.save();
    context.fillStyle = withAlpha(mix("#ffffff", theme.colors.danger, 0.3), FLASH_STRENGTH * flash);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.restore();
  }

  /**
   * The outcome over the middle of the table: a victory grows down into place
   * under turning rays; a defeat drops in from above; a draw simply appears.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintTitle(context, theme) {
    const sequence = this.#sequence;
    const alpha = Math.min(1, Math.max(0, sequence.titleAlpha));
    if (alpha <= 0) {
      return;
    }
    const area = this.bounds;
    const { colors } = theme;
    const centre = { x: area.x + area.width / 2, y: this.#centreY };
    const landed = sequence.titleIn;
    const style = titleStyle(theme, sequence.mood);
    context.save();
    context.globalAlpha = alpha;
    if (sequence.mood === GameOverMood.TRIUMPH) {
      paintRays(context, theme, centre, { angle: sequence.raysAngle, reach: Math.min(1, landed) });
    }
    const scale = sequence.mood === GameOverMood.TRIUMPH ? Math.max(TITLE.minScale, 1 + TITLE.growFrom * (1 - landed)) : 1;
    const drop = sequence.mood === GameOverMood.DEFEAT ? -TITLE.drop * (1 - landed) : 0;
    const fit = Math.min(1, Math.max(TITLE_FIT.minFit, area.height / TITLE_FIT.height));
    const font = TITLE.font * scale * fit;
    const words = { x: area.x, y: centre.y + drop * fit - font * 0.6, width: area.width, height: font * 1.2 };
    drawOutlinedText(context, sequence.title, words, { font: displayFont(theme, font), color: style.color, outline: withAlpha(colors.letterbox, 0.9), outlineWidth: 6, glow: withAlpha(style.glow, 0.95), glowBlur: TITLE.glowBlur * fit });
    const line = { x: area.x, y: words.y + words.height + TITLE.subtitleGap * fit, width: area.width, height: TITLE.subtitleFont * 1.4 };
    drawOutlinedText(context, sequence.subtitle, line, { font: displayFont(theme, TITLE.subtitleFont * Math.max(fit, 0.8)), color: colors.textMuted, outline: withAlpha(colors.letterbox, 0.85), outlineWidth: 4 });
    context.restore();
  }
}

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} mood
 * @returns {{ color: string, glow: string }}
 */
function titleStyle(theme, mood) {
  const { colors } = theme;
  if (mood === GameOverMood.TRIUMPH) {
    return { color: colors.accentLight, glow: colors.accent };
  }
  if (mood === GameOverMood.DEFEAT) {
    return { color: colors.danger, glow: colors.danger };
  }
  return { color: colors.text, glow: colors.focus };
}

/**
 * Cracks running out from the heart of the crystal, each a few jagged steps.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("./GameOverSequence.js").Crystal} crystal
 * @param {number} crack 0–1
 */
function paintCracks(context, theme, crystal, crack) {
  if (crack <= 0) {
    return;
  }
  context.save();
  context.strokeStyle = withAlpha("#ffffff", 0.9);
  context.shadowColor = withAlpha(theme.colors.danger, 0.95);
  context.shadowBlur = CRACK.blur * crack;
  context.lineWidth = CRACK.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let index = 0; index < CRACK.count; index += 1) {
    const heading = (index / CRACK.count) * Math.PI * 2 + wobble(index, 0) * 0.5;
    const length = crystal.radius * CRACK.reach * crack;
    context.beginPath();
    context.moveTo(crystal.x, crystal.y);
    for (let bend = 1; bend <= CRACK.bends; bend += 1) {
      const angle = heading + wobble(index, bend) * CRACK.jitter;
      const reach = (length * bend) / CRACK.bends;
      context.lineTo(crystal.x + Math.cos(angle) * reach, crystal.y + Math.sin(angle) * reach);
    }
    context.stroke();
  }
  context.restore();
}

/**
 * Where the crystal was: an empty, darkened setting.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("./GameOverSequence.js").Crystal} crystal
 */
function paintSocket(context, theme, crystal) {
  context.save();
  polygonPath(context, crystal, crystal.radius * 1.04, { sides: 6 });
  context.fillStyle = mix(theme.colors.panelDark, theme.colors.letterbox, 0.5);
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = withAlpha(theme.colors.danger, 0.5);
  context.stroke();
  context.restore();
}

/**
 * The flying pieces: small bright splinters, fading as they fall.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {readonly import("./GameOverSequence.js").Shard[]} shards
 */
function paintShards(context, theme, shards) {
  if (shards.length === 0) {
    return;
  }
  const fill = mix("#ffffff", theme.colors.danger, 0.35);
  context.save();
  context.fillStyle = fill;
  context.shadowColor = withAlpha(theme.colors.danger, 0.9);
  context.shadowBlur = SHARD_BLUR;
  for (const shard of shards) {
    context.globalAlpha = Math.max(0, shard.alpha);
    polygonPath(context, shard, shard.size, { sides: 3, rotation: shard.rotation });
    context.fill();
  }
  context.restore();
}

/**
 * Turning rays of gold behind a victory, with a warm glow at their heart.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} centre
 * @param {{ angle: number, reach: number }} rays
 */
function paintRays(context, theme, centre, { angle, reach }) {
  const { accent, accentLight } = theme.colors;
  const length = RAYS.reach * Math.max(0, reach);
  if (length <= 0) {
    return;
  }
  context.save();
  context.fillStyle = radialGradient(context, centre, RAYS.glowReach, [
    [0, withAlpha(accentLight, RAYS.glowAlpha)],
    [1, withAlpha(accent, 0)],
  ]);
  context.fillRect(centre.x - RAYS.glowReach, centre.y - RAYS.glowReach, RAYS.glowReach * 2, RAYS.glowReach * 2);
  context.fillStyle = radialGradient(context, centre, length, [
    [0, withAlpha(accentLight, RAYS.alpha * 2)],
    [1, withAlpha(accent, 0)],
  ]);
  for (let index = 0; index < RAYS.count; index += 1) {
    const heading = angle + (index / RAYS.count) * Math.PI * 2;
    context.beginPath();
    context.moveTo(centre.x, centre.y);
    context.lineTo(centre.x + Math.cos(heading - RAYS.width) * length, centre.y + Math.sin(heading - RAYS.width) * length);
    context.lineTo(centre.x + Math.cos(heading + RAYS.width) * length, centre.y + Math.sin(heading + RAYS.width) * length);
    context.closePath();
    context.fill();
  }
  context.restore();
}

/**
 * A fixed value in [-1, 1) for a crack's bend: jagged, but the same every frame.
 * @param {number} crack
 * @param {number} bend
 */
function wobble(crack, bend) {
  const value = Math.sin(crack * 91.7 + bend * 47.3) * 12543.21;
  return (value - Math.floor(value)) * 2 - 1;
}
