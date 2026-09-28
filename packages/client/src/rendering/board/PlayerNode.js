/**
 * A player's HUD: name, a life crystal, resource orbs and the hand /
 * library / graveyard counts drawn as small card stacks. It is a widget
 * because players are legal targets for some spells; when the interaction
 * marks it targetable it becomes tappable and shows a highlight halo.
 * When the life total moves the crystal swells and throws off a ring —
 * red for damage, green for healing — and a blow shakes the whole plate.
 */
import { Highlight } from "../../input/interaction/MatchInteraction.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { bodyFont, fontFor } from "../theme/Theme.js";
import { drawOutlinedText, drawTextInRect, fillRoundedRect, glowRoundedRect, verticalGradient } from "../ui/drawing.js";
import { paintStone } from "../ui/Panel.js";
import { drawCardStackIcon, drawGem, drawOrb } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

const PAD = 12;
const NAME_HEIGHT = 26;
const CRYSTAL_RADIUS = 30;
const ORB_RADIUS = 7;
const ORB_GAP = 4;
const MAX_ORBS = 12;
const STACK_ICON = Object.freeze({ width: 18, height: 24 });
const HALO_BLUR = 22;
const SEAT_TAG = "YOU";
/** A life total that just moved: how much the crystal swells, how far its ring spreads (in radii), and the shake of a blow (px, swings, and the share of the pulse it lasts). */
const KICK = Object.freeze({ swell: 0.28, ringSpread: 1.1, ringWidth: 3, glow: 1.4, shake: 7, swings: 3, shakeUntil: 0.45 });

/**
 * @typedef {Readonly<{ id: string, name: string, life: number, resources: Readonly<{ current: number, max: number }>, librarySize: number, handSize: number, graveyard: readonly unknown[] }>} PlayerView
 */

export class PlayerNode extends UiNode {
  /** @type {PlayerView} */
  player;
  /** @type {boolean} */
  isMe;
  /** @type {boolean} */
  isActive;
  /** @type {string | null} */
  highlight;
  /** @type {(playerId: string) => void} */
  onTap;
  /** The life drawn in the crystal, read every frame: it may lag the snapshot while a cast plays out. @type {() => number} */
  lifeShown;
  /** How the life total is pulsing right now, read every frame; null when it is still. @type {() => { progress: number, delta: number } | null} */
  lifeKick;

  /**
   * @param {{ player: PlayerView, rect: import("@magic8/engine/shared/geometry.js").Rect, isMe: boolean, isActive: boolean, highlight: string | null, onTap: (playerId: string) => void, lifeShown?: () => number, lifeKick?: () => { progress: number, delta: number } | null }} options
   */
  constructor({ player, rect, isMe, isActive, highlight, onTap, lifeShown = () => player.life, lifeKick = () => null }) {
    super({ id: player.id, ...rect, enabled: highlight === Highlight.TARGETABLE });
    this.player = player;
    this.lifeShown = lifeShown;
    this.lifeKick = lifeKick;
    this.isMe = isMe;
    this.isActive = isActive;
    this.highlight = highlight;
    this.onTap = onTap;
    this.interactive = true;
    this.focusable = this.enabled;
  }

  activate() {
    if (this.isEffectivelyEnabled) {
      this.onTap(this.id);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const kick = this.lifeKick();
    const shake = shakeOf(kick);
    context.save();
    if (shake !== 0) {
      context.translate(shake, 0);
    }
    this.#paintPlate(context, theme);
    this.#paintName(context, theme);
    this.#paintLife(context, theme, kick);
    this.#paintResources(context, theme);
    this.#paintCounts(context, theme);
    context.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintPlate(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const radius = theme.spacing.radius;
    const halo = this.#haloColor(theme);
    if (halo !== null) {
      glowRoundedRect(context, area, { color: halo, radius, blur: HALO_BLUR, lineWidth: 2 });
    }
    const rim = halo ?? (this.isActive ? withAlpha(colors.accent, 0.7) : colors.panelBorder);
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, shade(colors.panel, 0.08)], [1, shade(colors.panelDark, -0.2)]]), radius });
    paintStone(context, theme, area, radius);
    fillRoundedRect(context, area, { stroke: rim, radius, lineWidth: halo === null ? 1.5 : 3 });
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintName(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const line = { x: area.x + PAD, y: area.y + PAD, width: area.width - 2 * PAD, height: NAME_HEIGHT };
    drawTextInRect(context, this.player.name, line, { font: fontFor(theme, "body", "bold"), color: this.isActive ? colors.accentLight : colors.text, align: "left" });
    if (this.isMe) {
      const tag = { x: line.x + line.width - 44, y: line.y + 3, width: 44, height: NAME_HEIGHT - 6 };
      fillRoundedRect(context, tag, { fill: withAlpha(colors.accent, 0.2), stroke: withAlpha(colors.accent, 0.7), radius: tag.height / 2, lineWidth: 1 });
      drawTextInRect(context, SEAT_TAG, tag, { font: bodyFont(theme, 11, "bold"), color: colors.accentLight });
    }
  }

  /**
   * Life as a faceted crystal, red-tinted when low, swelling while it pulses.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ progress: number, delta: number } | null} kick
   */
  #paintLife(context, theme, kick) {
    const area = this.bounds;
    const { colors } = theme;
    const center = lifeCrystalCentre(area);
    const life = this.lifeShown();
    const color = life <= 5 ? colors.danger : colors.health;
    const box = { x: center.x - CRYSTAL_RADIUS, y: center.y - CRYSTAL_RADIUS, width: CRYSTAL_RADIUS * 2, height: CRYSTAL_RADIUS * 2 };
    const fresh = kick === null ? 0 : (1 - kick.progress) ** 2;
    const radius = CRYSTAL_RADIUS * (1 + KICK.swell * fresh);
    const pulse = kick === null ? color : kickColor(theme, kick);
    if (kick !== null) {
      paintKickRing(context, center, pulse, kick.progress);
    }
    context.save();
    context.shadowColor = withAlpha(mix(color, pulse, fresh), 0.75);
    context.shadowBlur = CRYSTAL_RADIUS * (0.6 + KICK.glow * fresh);
    drawGem(context, center, radius, { fill: verticalGradient(context, box, [[0, shade(color, 0.25)], [1, shade(color, -0.55)]]), rim: colors.accent, highlight: withAlpha("#ffffff", 0.3), sides: 6, rimWidth: 2.5 });
    context.restore();
    drawOutlinedText(context, String(life), box, { font: bodyFont(theme, radius * 1.05, "bold"), color: mix(colors.text, pulse, fresh), outline: withAlpha("#000000", 0.85), outlineWidth: 4 });
    const column = { x: box.x + box.width + 10, width: area.width - 2 * PAD - box.width - 10 };
    drawTextInRect(context, "life", { ...column, y: center.y - CRYSTAL_RADIUS + 2, height: 18 }, { font: fontFor(theme, "small"), color: colors.textMuted, align: "left" });
    drawTextInRect(context, `${this.player.resources.current} / ${this.player.resources.max}`, { ...column, y: center.y - 2, height: 22 }, { font: fontFor(theme, "body", "bold"), color: colors.resource, align: "left" });
    drawTextInRect(context, "resources", { ...column, y: center.y + 18, height: 14 }, { font: fontFor(theme, "micro"), color: colors.textMuted, align: "left" });
  }

  /**
   * One orb per resource point this turn: lit while available, dim once spent.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintResources(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const { current, max } = this.player.resources;
    const count = Math.min(MAX_ORBS, Math.max(0, max));
    const y = area.y + PAD + NAME_HEIGHT + 8 + CRYSTAL_RADIUS * 2 + 14;
    for (let index = 0; index < count; index += 1) {
      const lit = index < current;
      const center = { x: area.x + PAD + ORB_RADIUS + index * (ORB_RADIUS * 2 + ORB_GAP), y };
      drawOrb(context, center, ORB_RADIUS, {
        fill: lit ? colors.resource : withAlpha(colors.resource, 0.18),
        rim: lit ? shade(colors.resource, 0.3) : withAlpha(colors.resource, 0.4),
        highlight: lit ? withAlpha("#ffffff", 0.55) : withAlpha("#ffffff", 0.08),
      });
    }
  }

  /**
   * Hand, library and graveyard as small stacks with their counts.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintCounts(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const y = area.y + area.height - PAD - STACK_ICON.height;
    const entries = [
      { label: "hand", value: this.player.handSize },
      { label: "deck", value: this.player.librarySize },
      { label: "grave", value: this.player.graveyard.length },
    ];
    const column = (area.width - 2 * PAD) / entries.length;
    entries.forEach((entry, index) => {
      const x = area.x + PAD + index * column;
      drawCardStackIcon(context, { x, y, width: STACK_ICON.width, height: STACK_ICON.height }, { fill: shade(colors.panelDark, -0.3), stroke: withAlpha(colors.accent, 0.6), layers: Math.min(4, Math.max(1, entry.value)) });
      drawTextInRect(context, String(entry.value), { x: x + STACK_ICON.width + 6, y, width: column - STACK_ICON.width - 6, height: STACK_ICON.height / 2 + 2 }, { font: fontFor(theme, "small", "bold"), color: colors.text, align: "left" });
      drawTextInRect(context, entry.label, { x: x + STACK_ICON.width + 6, y: y + STACK_ICON.height / 2, width: column - STACK_ICON.width - 6, height: STACK_ICON.height / 2 }, { font: fontFor(theme, "micro"), color: colors.textMuted, align: "left" });
    });
  }

  /** @param {import("../theme/Theme.js").Theme} theme */
  #haloColor(theme) {
    if (this.highlight === Highlight.TARGETABLE) {
      return theme.colors.focus;
    }
    return this.focused || (this.hovered && this.enabled) ? theme.colors.focus : null;
  }
}

/**
 * Where the life crystal sits on a HUD: the end of the match strikes it there.
 * @param {import("@magic8/engine/shared/geometry.js").Rect} hud
 * @returns {{ x: number, y: number, radius: number }}
 */
export function lifeCrystalCentre(hud) {
  return { x: hud.x + PAD + CRYSTAL_RADIUS, y: hud.y + PAD + NAME_HEIGHT + 8 + CRYSTAL_RADIUS, radius: CRYSTAL_RADIUS };
}

/**
 * The colour of a life total that just moved: red when it fell, green when it rose.
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ delta: number }} kick
 */
function kickColor(theme, kick) {
  return kick.delta < 0 ? theme.colors.danger : theme.colors.success;
}

/**
 * How far the plate is thrown sideways by a blow: a few quick swings that die away. Healing does not shake.
 * @param {{ progress: number, delta: number } | null} kick
 */
function shakeOf(kick) {
  if (kick === null || kick.delta >= 0 || kick.progress >= KICK.shakeUntil) {
    return 0;
  }
  const through = kick.progress / KICK.shakeUntil;
  return Math.sin(through * Math.PI * 2 * KICK.swings) * KICK.shake * (1 - through);
}

/**
 * A ring spreading out of the crystal and fading.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {string} color
 * @param {number} progress
 */
function paintKickRing(context, center, color, progress) {
  context.save();
  context.globalAlpha = 1 - progress;
  context.strokeStyle = color;
  context.shadowColor = withAlpha(color, 0.9);
  context.shadowBlur = CRYSTAL_RADIUS * 0.5;
  context.lineWidth = KICK.ringWidth;
  context.beginPath();
  context.arc(center.x, center.y, CRYSTAL_RADIUS * (1 + KICK.ringSpread * progress), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
