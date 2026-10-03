/**
 * A player's HUD: name (with their profile picture in an online game), a
 * life crystal, resource orbs and the hand / library / graveyard counts
 * drawn as small card stacks. It is a widget
 * because players are legal targets for some spells; when the interaction
 * marks it targetable it becomes tappable and shows a highlight halo.
 * When the life total moves the crystal swells and throws off a ring —
 * red for damage, green for healing — and a blow shakes the whole plate.
 *
 * Its insides are drawn for a 200×184 plate; a smaller one (a phone's board)
 * shrinks them all alike, type included (never below MIN_FONT).
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { Highlight } from "../../input/interaction/MatchInteraction.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { bodyFont, fontFor } from "../theme/Theme.js";
import { drawOutlinedText, drawTextInRect, fillRoundedRect, glowRoundedRect, verticalGradient } from "../ui/drawing.js";
import { paintStone } from "../ui/Panel.js";
import { drawAvatar } from "../ui/avatar.js";
import { drawCardStackIcon, drawGem, drawOrb } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

/** The plate its insides are drawn for, and their sizes on it. */
const DESIGN = Object.freeze({ width: 200, height: 184 });
const PAD = 12;
const NAME_HEIGHT = 26;
const CRYSTAL_RADIUS = 30;
const ORB_RADIUS = 7;
const ORB_GAP = 4;
const MAX_ORBS = 12;
const STACK_ICON = Object.freeze({ width: 18, height: 24 });
/** The smallest type a shrunken plate uses (logical px). */
const MIN_FONT = 9;
/** The small stacks along the foot of the plate, in drawing order. */
export const HudStack = Object.freeze({ HAND: "hand", DECK: "deck", GRAVE: "grave" });
/** @type {readonly string[]} */
const STACKS = Object.freeze([HudStack.HAND, HudStack.DECK, HudStack.GRAVE]);
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
  /** The player's STEEM account in an online game (their portrait is shown), or null. @type {string | null} */
  avatar;
  /** @type {(playerId: string) => void} */
  onTap;
  /** The life drawn in the crystal, read every frame: it may lag the snapshot while a cast plays out. @type {() => number} */
  lifeShown;
  /** How the life total is pulsing right now, read every frame; null when it is still. @type {() => { progress: number, delta: number } | null} */
  lifeKick;

  /**
   * @param {{ player: PlayerView, rect: import("@magic8/engine/shared/geometry.js").Rect, isMe: boolean, isActive: boolean, highlight: string | null, onTap: (playerId: string) => void, lifeShown?: () => number, lifeKick?: () => { progress: number, delta: number } | null, avatar?: string | null }} options
   */
  constructor({ player, rect, isMe, isActive, highlight, onTap, lifeShown = () => player.life, lifeKick = () => null, avatar = null }) {
    super({ id: player.id, ...rect, enabled: highlight === Highlight.TARGETABLE });
    this.player = player;
    this.lifeShown = lifeShown;
    this.lifeKick = lifeKick;
    this.isMe = isMe;
    this.isActive = isActive;
    this.highlight = highlight;
    this.avatar = avatar;
    this.onTap = onTap;
    this.interactive = true;
    this.focusable = this.enabled;
    this.activationCue = SoundCue.UI_SELECT;
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
    const s = scaleOf(area);
    const nameHeight = NAME_HEIGHT * s;
    const line = { x: area.x + PAD * s, y: area.y + PAD * s, width: area.width - 2 * PAD * s, height: nameHeight };
    const portrait = this.avatar === null ? 0 : nameHeight + 8 * s;
    if (this.avatar !== null) {
      drawAvatar(context, theme, { account: this.avatar, center: { x: line.x + nameHeight / 2, y: line.y + nameHeight / 2 }, radius: nameHeight / 2 });
    }
    const tagWidth = this.isMe ? 44 * s : 0;
    drawTextInRect(context, this.player.name, { ...line, x: line.x + portrait, width: line.width - portrait - (s < 1 ? tagWidth : 0) }, { font: fontAt(theme, "body", s, "bold"), color: this.isActive ? colors.accentLight : colors.text, align: "left" });
    if (this.isMe) {
      const tag = { x: line.x + line.width - tagWidth, y: line.y + 3 * s, width: tagWidth, height: nameHeight - 6 * s };
      fillRoundedRect(context, tag, { fill: withAlpha(colors.accent, 0.2), stroke: withAlpha(colors.accent, 0.7), radius: tag.height / 2, lineWidth: 1 });
      drawTextInRect(context, SEAT_TAG, tag, { font: bodyFont(theme, Math.max(MIN_FONT, 11 * s), "bold"), color: colors.accentLight });
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
    const s = scaleOf(area);
    const center = lifeCrystalCentre(area);
    const crystal = center.radius;
    const life = this.lifeShown();
    const color = life <= 5 ? colors.danger : colors.health;
    const box = { x: center.x - crystal, y: center.y - crystal, width: crystal * 2, height: crystal * 2 };
    const fresh = kick === null ? 0 : (1 - kick.progress) ** 2;
    const radius = crystal * (1 + KICK.swell * fresh);
    const pulse = kick === null ? color : kickColor(theme, kick);
    if (kick !== null) {
      paintKickRing(context, center, pulse, kick.progress);
    }
    context.save();
    context.shadowColor = withAlpha(mix(color, pulse, fresh), 0.75);
    context.shadowBlur = crystal * (0.6 + KICK.glow * fresh);
    drawGem(context, center, radius, { fill: verticalGradient(context, box, [[0, shade(color, 0.25)], [1, shade(color, -0.55)]]), rim: colors.accent, highlight: withAlpha("#ffffff", 0.3), sides: 6, rimWidth: 2.5 });
    context.restore();
    drawOutlinedText(context, String(life), box, { font: bodyFont(theme, radius * 1.05, "bold"), color: mix(colors.text, pulse, fresh), outline: withAlpha("#000000", 0.85), outlineWidth: 4 });
    const column = { x: box.x + box.width + 10 * s, width: area.width - 2 * PAD * s - box.width - 10 * s };
    drawTextInRect(context, "life", { ...column, y: center.y - crystal + 2 * s, height: 18 * s }, { font: fontAt(theme, "small", s), color: colors.textMuted, align: "left" });
    drawTextInRect(context, `${this.player.resources.current} / ${this.player.resources.max}`, { ...column, y: center.y - 2 * s, height: 22 * s }, { font: fontAt(theme, "body", s, "bold"), color: colors.resource, align: "left" });
    drawTextInRect(context, "resources", { ...column, y: center.y + 18 * s, height: 14 * s }, { font: fontAt(theme, "micro", s), color: colors.textMuted, align: "left" });
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
    const s = scaleOf(area);
    const orb = ORB_RADIUS * s;
    const y = area.y + (PAD + NAME_HEIGHT + 8 + CRYSTAL_RADIUS * 2 + 14) * s;
    for (let index = 0; index < count; index += 1) {
      const lit = index < current;
      const center = { x: area.x + PAD * s + orb + index * (orb * 2 + ORB_GAP * s), y };
      drawOrb(context, center, orb, {
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
    const values = { [HudStack.HAND]: this.player.handSize, [HudStack.DECK]: this.player.librarySize, [HudStack.GRAVE]: this.player.graveyard.length };
    const entries = STACKS.map((label) => ({ label, value: values[label] }));
    const column = stackColumn(area);
    const s = scaleOf(area);
    const icon = { width: STACK_ICON.width * s, height: STACK_ICON.height * s };
    const gap = 6 * s;
    entries.forEach((entry) => {
      const { x, y } = stackIcon(area, entry.label);
      drawCardStackIcon(context, { x, y, ...icon }, { fill: shade(colors.panelDark, -0.3), stroke: withAlpha(colors.accent, 0.6), layers: Math.min(4, Math.max(1, entry.value)) });
      drawTextInRect(context, String(entry.value), { x: x + icon.width + gap, y, width: column - icon.width - gap, height: icon.height / 2 + 2 * s }, { font: fontAt(theme, "small", s, "bold"), color: colors.text, align: "left" });
      drawTextInRect(context, entry.label, { x: x + icon.width + gap, y: y + icon.height / 2, width: column - icon.width - gap, height: icon.height / 2 }, { font: fontAt(theme, "micro", s), color: colors.textMuted, align: "left" });
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
 * How much a plate's insides shrink: 1 on a plate the design size or larger.
 * @param {{ width: number, height: number }} hud
 */
function scaleOf(hud) {
  return Math.min(1, hud.width / DESIGN.width, hud.height / DESIGN.height);
}

/**
 * A theme size shrunk with the plate (exactly the theme's font on a full-size one).
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../theme/Theme.js").FontSize} size
 * @param {number} scale
 * @param {"normal" | "bold"} [weight]
 */
function fontAt(theme, size, scale, weight = "normal") {
  return scale >= 1 ? fontFor(theme, size, weight) : bodyFont(theme, Math.max(MIN_FONT, theme.fonts.sizes[size] * scale), weight);
}

/** @param {import("@magic8/engine/shared/geometry.js").Rect} hud */
function stackColumn(hud) {
  return (hud.width - 2 * PAD * scaleOf(hud)) / STACKS.length;
}

/**
 * The top-left corner of one of the plate's stack icons.
 * @param {import("@magic8/engine/shared/geometry.js").Rect} hud
 * @param {string} stack a HudStack
 */
function stackIcon(hud, stack) {
  const s = scaleOf(hud);
  return { x: hud.x + PAD * s + STACKS.indexOf(stack) * stackColumn(hud), y: hud.y + hud.height - (PAD + STACK_ICON.height) * s };
}

/**
 * Where one of the plate's stacks (hand, deck, grave) sits on a HUD: what
 * mills a library is aimed at the deck, and milled cards come out of it.
 * @param {import("@magic8/engine/shared/geometry.js").Rect} hud
 * @param {string} stack a HudStack
 * @returns {{ x: number, y: number }}
 */
export function hudStackCentre(hud, stack) {
  const { x, y } = stackIcon(hud, stack);
  const s = scaleOf(hud);
  return { x: x + (STACK_ICON.width / 2) * s, y: y + (STACK_ICON.height / 2) * s };
}

/**
 * Where the life crystal sits on a HUD: the end of the match strikes it there.
 * @param {import("@magic8/engine/shared/geometry.js").Rect} hud
 * @returns {{ x: number, y: number, radius: number }}
 */
export function lifeCrystalCentre(hud) {
  const s = scaleOf(hud);
  return { x: hud.x + (PAD + CRYSTAL_RADIUS) * s, y: hud.y + (PAD + NAME_HEIGHT + 8 + CRYSTAL_RADIUS) * s, radius: CRYSTAL_RADIUS * s };
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
 * @param {{ x: number, y: number, radius: number }} center the crystal's centre and radius
 * @param {string} color
 * @param {number} progress
 */
function paintKickRing(context, center, color, progress) {
  const crystal = center.radius;
  context.save();
  context.globalAlpha = 1 - progress;
  context.strokeStyle = color;
  context.shadowColor = withAlpha(color, 0.9);
  context.shadowBlur = crystal * 0.5;
  context.lineWidth = KICK.ringWidth;
  context.beginPath();
  context.arc(center.x, center.y, crystal * (1 + KICK.ringSpread * progress), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
