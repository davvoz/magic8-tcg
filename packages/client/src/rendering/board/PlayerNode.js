/**
 * A player's HUD: name, a life crystal, resource orbs and the hand /
 * library / graveyard counts drawn as small card stacks. It is a widget
 * because players are legal targets for some spells; when the interaction
 * marks it targetable it becomes tappable and shows a highlight halo.
 */
import { Highlight } from "../../input/interaction/MatchInteraction.js";
import { shade, withAlpha } from "../theme/color.js";
import { bodyFont, fontFor } from "../theme/Theme.js";
import { drawOutlinedText, drawTextInRect, fillRoundedRect, glowRoundedRect, verticalGradient } from "../ui/drawing.js";
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

  /**
   * @param {{ player: PlayerView, rect: import("@magic8/engine/shared/geometry.js").Rect, isMe: boolean, isActive: boolean, highlight: string | null, onTap: (playerId: string) => void, lifeShown?: () => number }} options
   */
  constructor({ player, rect, isMe, isActive, highlight, onTap, lifeShown = () => player.life }) {
    super({ id: player.id, ...rect, enabled: highlight === Highlight.TARGETABLE });
    this.player = player;
    this.lifeShown = lifeShown;
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
    this.#paintPlate(context, theme);
    this.#paintName(context, theme);
    this.#paintLife(context, theme);
    this.#paintResources(context, theme);
    this.#paintCounts(context, theme);
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
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, shade(colors.panel, 0.08)], [1, shade(colors.panelDark, -0.2)]]), stroke: rim, radius, lineWidth: halo === null ? 1.5 : 3 });
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
   * Life as a faceted crystal, red-tinted when low.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintLife(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const center = { x: area.x + PAD + CRYSTAL_RADIUS, y: area.y + PAD + NAME_HEIGHT + 8 + CRYSTAL_RADIUS };
    const life = this.lifeShown();
    const color = life <= 5 ? colors.danger : colors.health;
    const box = { x: center.x - CRYSTAL_RADIUS, y: center.y - CRYSTAL_RADIUS, width: CRYSTAL_RADIUS * 2, height: CRYSTAL_RADIUS * 2 };
    context.save();
    context.shadowColor = withAlpha(color, 0.75);
    context.shadowBlur = CRYSTAL_RADIUS * 0.6;
    drawGem(context, center, CRYSTAL_RADIUS, { fill: verticalGradient(context, box, [[0, shade(color, 0.25)], [1, shade(color, -0.55)]]), rim: colors.accent, highlight: withAlpha("#ffffff", 0.3), sides: 6, rimWidth: 2.5 });
    context.restore();
    drawOutlinedText(context, String(life), box, { font: bodyFont(theme, CRYSTAL_RADIUS * 1.05, "bold"), color: colors.text, outline: withAlpha("#000000", 0.85), outlineWidth: 4 });
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
