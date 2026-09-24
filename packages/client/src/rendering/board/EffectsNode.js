/**
 * Transient overlay drawn above the cards: block arrows, cards on their
 * way to the graveyard, floating damage/heal numbers and the card the
 * opponent just cast. It reads the presenter and the layout every frame and
 * holds no state of its own.
 */
import { paintRuneCircle } from "../cards/CardArt.js";
import { drawCard, drawCardBack } from "../cards/CardRenderer.js";
import { withAlpha } from "../theme/color.js";
import { bodyFont, displayFont, factionTones } from "../theme/Theme.js";
import { drawOutlinedText, glowRoundedRect, radialGradient } from "../ui/drawing.js";
import { drawArrow } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";
import { floatOffset } from "./MatchPresenter.js";

const ARROW_WIDTH = 5;
const ARROW_GLOW = 14;
const FLOAT_FONT = 34;
/** Floats start enlarged and settle to their size in the first part of their life. */
const FLOAT_POP = Object.freeze({ scale: 1.6, untilProgress: 0.18 });
/** The light a cast throws: the table dims away from it, the card sits in a pool of its faction's colour. */
const CAST_LIGHT = Object.freeze({ reach: 0.6, dimNear: 0.12, dimFar: 0.5, poolReach: 1.1, poolCore: 0.34, poolEdge: 0.16 });
/** The rune spreading out of the card, in card widths, while it is held up. */
const CAST_RUNE = Object.freeze({ from: 0.5, to: 1.35, rays: 8, blur: 18 });
/** The turning card: its halo, and the gleam along the edge while it is side-on. */
const CAST_CARD = Object.freeze({ haloBlur: 36, haloAlpha: 0.55, gleamUntil: 0.35, gleamWidth: 3, gleamBlur: 24 });
const CAST_CAPTION = Object.freeze({ font: 22, gap: 12, height: 30, spread: 70 });
/** The beam to each target, the rune that marks it and the name under it. */
const CAST_TARGET = Object.freeze({ beamWidth: 3, beamBlur: 16, markRadius: 26, markRays: 8, markFrom: 0.55, nameFont: 15, nameGap: 8, nameHeight: 20, nameSpread: 80 });

/** @typedef {Readonly<{ attackerId: string, blockerId: string }>} Block */

export class EffectsNode extends UiNode {
  #presenter;
  #layout;
  #blocks;

  /**
   * @param {{ presenter: import("./MatchPresenter.js").MatchPresenter, layout: import("./BoardLayout.js").BoardLayout, blocks: readonly Block[] }} options
   */
  constructor({ presenter, layout, blocks }) {
    super({ id: "effects", width: layout.width, height: layout.height });
    this.passthrough = true;
    this.#presenter = presenter;
    this.#layout = layout;
    this.#blocks = blocks;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    this.#paintBlocks(context, theme);
    for (const visual of this.#presenter.leavingVisuals) {
      const card = this.#presenter.cardFor(visual.instanceId);
      if (card !== null) {
        drawCard(context, theme, card, visual.state);
      }
    }
    this.#paintFloats(context, theme);
    this.#paintReveal(context, theme);
  }

  /**
   * The opponent's cast: the card rises out of their hand face-down, turns
   * over the middle of the table, holds, and sinks into their graveyard.
   * CastReveal says where it is and how far through the turn it is;
   * everything here is the light and the card itself.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintReveal(context, theme) {
    const reveal = this.#presenter.reveal;
    if (reveal === null) {
      return;
    }
    const { frame, card, caption, targets, origin } = reveal;
    const tones = factionTones(theme, card.faction);
    const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    this.#paintCastLight(context, theme, tones, { frame, centre });
    paintCastRune(context, tones, { frame, centre });
    paintCastBeams(context, tones, { frame, origin, targets });
    paintCastCard(context, theme, card, { frame, centre, tones });
    paintCastCaption(context, theme, caption, frame);
    paintCastMarks(context, theme, tones, { frame, targets });
  }

  /**
   * The table dims away from the cast and the card sits in a pool of its
   * faction's light, so the eye is pulled there without a panel being
   * dropped on the board.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {import("../theme/Theme.js").FactionTones} tones
   * @param {{ frame: import("./CastReveal.js").RevealFrame, centre: { x: number, y: number } }} at
   */
  #paintCastLight(context, theme, tones, { frame, centre }) {
    const area = this.bounds;
    const { glow } = frame;
    context.save();
    context.fillStyle = radialGradient(context, centre, Math.max(area.width, area.height) * CAST_LIGHT.reach, [
      [0, withAlpha(theme.colors.letterbox, 0)],
      [0.35, withAlpha(theme.colors.letterbox, CAST_LIGHT.dimNear * glow)],
      [1, withAlpha(theme.colors.letterbox, CAST_LIGHT.dimFar * glow)],
    ]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = radialGradient(context, centre, frame.height * CAST_LIGHT.poolReach, [
      [0, withAlpha(tones.light, CAST_LIGHT.poolCore * glow)],
      [0.45, withAlpha(tones.base, CAST_LIGHT.poolEdge * glow)],
      [1, withAlpha(tones.dark, 0)],
    ]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.restore();
  }

  /**
   * Glowing arrows from each blocker to the attacker it blocks.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintBlocks(context, theme) {
    const { cards } = this.#layout;
    context.save();
    context.shadowColor = withAlpha(theme.colors.focus, 0.9);
    context.shadowBlur = ARROW_GLOW;
    for (const block of this.#blocks) {
      const from = cards[block.blockerId];
      const to = cards[block.attackerId];
      if (from === undefined || to === undefined) {
        continue;
      }
      drawArrow(context, { x: from.x + from.width / 2, y: from.y }, { x: to.x + to.width / 2, y: to.y + to.height }, { color: theme.colors.focus, width: ARROW_WIDTH });
    }
    context.restore();
  }

  /**
   * Damage and heal numbers pop in, rise and fade.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintFloats(context, theme) {
    context.save();
    for (const { spec, progress } of this.#presenter.floats) {
      const pop = progress < FLOAT_POP.untilProgress ? FLOAT_POP.scale - (FLOAT_POP.scale - 1) * (progress / FLOAT_POP.untilProgress) : 1;
      context.globalAlpha = 1 - progress;
      const color = theme.colors[spec.colorKey] ?? theme.colors.text;
      const box = { x: spec.x - 100, y: spec.y + floatOffset(progress) - FLOAT_FONT, width: 200, height: FLOAT_FONT * 2 };
      drawOutlinedText(context, spec.text, box, { font: bodyFont(theme, FLOAT_FONT * pop, "bold"), color, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: 5, glow: withAlpha(color, 0.9), glowBlur: 16 });
    }
    context.restore();
  }
}

/**
 * The spell's own rune, spreading out from under the card and fading as it
 * goes: the same sigil the card's art carries.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").FactionTones} tones
 * @param {{ frame: import("./CastReveal.js").RevealFrame, centre: { x: number, y: number } }} at
 */
function paintCastRune(context, tones, { frame, centre }) {
  const fade = frame.alpha * frame.glow * (1 - frame.ring);
  if (fade <= 0) {
    return;
  }
  const radius = frame.width * (CAST_RUNE.from + (CAST_RUNE.to - CAST_RUNE.from) * frame.ring);
  context.save();
  context.globalAlpha = fade;
  context.shadowColor = withAlpha(tones.light, 0.8);
  context.shadowBlur = CAST_RUNE.blur;
  paintRuneCircle(context, centre, radius, { rays: CAST_RUNE.rays, color: tones.light });
  context.restore();
}

/**
 * A beam of the spell's light reaching out to each thing it was aimed at.
 * It leaves from where the card is held rather than from the card itself,
 * so it stays put instead of sweeping the table as the card sinks away.
 * Drawn under the card, so it seems to come from behind it.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").FactionTones} tones
 * @param {{ frame: import("./CastReveal.js").RevealFrame, origin: { x: number, y: number }, targets: readonly import("./CastReveal.js").CastTarget[] }} at
 */
function paintCastBeams(context, tones, { frame, origin, targets }) {
  const fade = frame.alpha * frame.glow;
  if (fade <= 0 || frame.strike <= 0) {
    return;
  }
  context.save();
  context.globalAlpha = fade;
  context.strokeStyle = withAlpha(tones.light, 0.85);
  context.shadowColor = withAlpha(tones.light, 0.9);
  context.shadowBlur = CAST_TARGET.beamBlur;
  context.lineWidth = CAST_TARGET.beamWidth;
  context.lineCap = "round";
  for (const target of targets) {
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(origin.x + (target.x - origin.x) * frame.strike, origin.y + (target.y - origin.y) * frame.strike);
    context.stroke();
  }
  context.restore();
}

/**
 * Where each beam lands: the spell's rune again, small, over whatever was
 * targeted, with its name under it — the creature may already have died and
 * left the board, and the name is what still answers "on what?".
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../theme/Theme.js").FactionTones} tones
 * @param {{ frame: import("./CastReveal.js").RevealFrame, targets: readonly import("./CastReveal.js").CastTarget[] }} at
 */
function paintCastMarks(context, theme, tones, { frame, targets }) {
  const arrived = (frame.strike - CAST_TARGET.markFrom) / (1 - CAST_TARGET.markFrom);
  const fade = frame.alpha * frame.glow * Math.min(1, Math.max(0, arrived));
  if (fade <= 0) {
    return;
  }
  context.save();
  context.globalAlpha = fade;
  for (const target of targets) {
    context.shadowColor = withAlpha(tones.light, 0.9);
    context.shadowBlur = CAST_TARGET.beamBlur;
    paintRuneCircle(context, target, CAST_TARGET.markRadius, { rays: CAST_TARGET.markRays, color: tones.light });
    const box = { x: target.x - CAST_TARGET.nameSpread, y: target.y + CAST_TARGET.markRadius + CAST_TARGET.nameGap, width: 2 * CAST_TARGET.nameSpread, height: CAST_TARGET.nameHeight };
    drawOutlinedText(context, target.name, box, { font: displayFont(theme, CAST_TARGET.nameFont), color: theme.colors.accentLight, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: 4, glow: withAlpha(tones.light, 0.8), glowBlur: 10 });
  }
  context.restore();
}

/**
 * The card mid-turn: squeezed to nothing at the halfway point, where the
 * back gives way to the face and the edge catches the light.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} card
 * @param {{ frame: import("./CastReveal.js").RevealFrame, centre: { x: number, y: number }, tones: import("../theme/Theme.js").FactionTones }} at
 */
function paintCastCard(context, theme, card, { frame, centre, tones }) {
  const squeeze = Math.abs(frame.turn * 2 - 1);
  const width = frame.width * squeeze;
  const placement = { x: centre.x - width / 2, y: frame.y, width, height: frame.height, alpha: frame.alpha };
  if (frame.turn < 0.5) {
    context.save();
    context.globalAlpha = frame.alpha;
    drawCardBack(context, theme, placement);
    context.restore();
  } else {
    glowRoundedRect(context, placement, { color: withAlpha(tones.light, CAST_CARD.haloAlpha), radius: width * 0.06, blur: CAST_CARD.haloBlur, lineWidth: 2, alpha: frame.alpha });
    drawCard(context, theme, card, placement);
  }
  paintCastGleam(context, theme, tones, { frame, centre, squeeze });
}

/**
 * A bright edge down the middle while the card is nearly side-on.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../theme/Theme.js").FactionTones} tones
 * @param {{ frame: import("./CastReveal.js").RevealFrame, centre: { x: number, y: number }, squeeze: number }} at
 */
function paintCastGleam(context, theme, tones, { frame, centre, squeeze }) {
  const gleam = 1 - Math.min(1, squeeze / CAST_CARD.gleamUntil);
  if (gleam <= 0) {
    return;
  }
  context.save();
  context.globalAlpha = frame.alpha * gleam;
  context.strokeStyle = theme.colors.accentLight;
  context.shadowColor = withAlpha(tones.light, 0.9);
  context.shadowBlur = CAST_CARD.gleamBlur;
  context.lineWidth = CAST_CARD.gleamWidth;
  context.beginPath();
  context.moveTo(centre.x, frame.y);
  context.lineTo(centre.x, frame.y + frame.height);
  context.stroke();
  context.restore();
}

/**
 * Who is casting, under the card, in the display face.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} caption
 * @param {import("./CastReveal.js").RevealFrame} frame
 */
function paintCastCaption(context, theme, caption, frame) {
  const box = { x: frame.x - CAST_CAPTION.spread, y: frame.y + frame.height + CAST_CAPTION.gap, width: frame.width + 2 * CAST_CAPTION.spread, height: CAST_CAPTION.height };
  context.save();
  context.globalAlpha = frame.alpha * frame.glow;
  drawOutlinedText(context, caption, box, { font: displayFont(theme, CAST_CAPTION.font), color: theme.colors.accentLight, outline: withAlpha(theme.colors.letterbox, 0.85), outlineWidth: 4, glow: withAlpha(theme.colors.accent, 0.8), glowBlur: 14 });
  context.restore();
}
