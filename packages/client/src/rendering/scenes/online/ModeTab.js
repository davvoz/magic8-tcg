/**
 * One of the lobby's two tabs, Casual and Ranked: a medallion with the way
 * to play's pictogram (a fan of cards, a trophy), its name in the display
 * face and a line under it (what it costs, why it is locked). The tab
 * chosen is lit in its tone — blue for casual, gold for ranked — over the
 * panel it opens, clear of its painted corners; the other stays dim until
 * the pointer lifts it.
 * A locked ranked tab still opens (it says what is missing) and wears a
 * padlock. Activating it fires `onActivate`, as a button does.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { mix, withAlpha } from "../../theme/color.js";
import { bodyFont, displayFont } from "../../theme/Theme.js";
import { roundedRectPath, verticalGradient } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { PlayKind, drawCardFan, drawMedallion, drawPadlock, drawTrophy, iconMetals, playTone } from "./lobbyIcons.js";

/**
 * Proportions of a tab, in its heights: the medallion's radius, the space around it, the name's and the line's size,
 * the padlock's size; and the glow of the tab open, the width of the focus ring, the opacity of a tab that cannot be opened
 * and of the pictogram of a tab not chosen.
 */
const TAB = Object.freeze({ medallion: 0.32, gap: 0.22, title: 0.36, line: 0.21, lock: 0.3, glow: 18, focusWidth: 3, disabledAlpha: 0.55, dimIcon: 0.6 });

/**
 * @typedef {import("./lobbyIcons.js").Tone} Tone
 * @typedef {"lit" | "lifted" | "dim"} TabState the tab open, one under the pointer or focus, any other
 */

export class ModeTab extends UiNode {
  /** One of PlayKind. */
  kind;
  /** Its name ("Ranked"). */
  text;
  /** The line under the name, or "" for none. */
  subtitle;
  /** Whether it is the tab open. */
  selected;
  /** Whether ranked play is not open yet: a padlock beside the name. */
  locked;
  /** @type {() => void} */
  onActivate;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, kind: string, text: string, subtitle?: string, selected: boolean, locked?: boolean, enabled?: boolean, onActivate: () => void }} options
   */
  constructor(options) {
    super(options);
    this.kind = options.kind;
    this.text = options.text;
    this.subtitle = options.subtitle ?? "";
    this.selected = options.selected;
    this.locked = options.locked ?? false;
    this.onActivate = options.onActivate;
    this.interactive = true;
    this.focusable = true;
    this.activationCue = SoundCue.UI_CLICK;
  }

  activate() {
    if (this.isEffectivelyEnabled && this.isEffectivelyVisible) {
      this.onActivate();
    }
  }

  /** @returns {TabState} */
  get #state() {
    if (this.selected) {
      return "lit";
    }
    return (this.hovered || this.focused) && this.isEffectivelyEnabled ? "lifted" : "dim";
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const tone = playTone(theme, this.kind);
    const state = this.#state;
    const radius = Math.min(theme.spacing.radius * 1.4, area.height / 3);
    context.save();
    if (!this.isEffectivelyEnabled && state !== "lit") {
      context.globalAlpha = TAB.disabledAlpha;
    }
    paintBody(context, theme, { area, radius, tone, state });
    tabPath(context, area, radius);
    context.lineWidth = this.focused ? TAB.focusWidth : 2;
    context.strokeStyle = this.focused ? theme.colors.focus : edgeColor(theme, tone, state);
    context.stroke();
    const medallion = { x: area.x + area.height * (TAB.gap + TAB.medallion), y: area.y + area.height / 2 };
    this.#paintIcon(context, theme, medallion, { tone, bright: state !== "dim" });
    this.#paintWords(context, theme, medallion.x + area.height * (TAB.medallion + TAB.gap), { tone, state });
    context.restore();
  }

  /**
   * The medallion and the pictogram on it: a trophy for ranked, a fan of cards for casual.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number }} center
   * @param {{ tone: Tone, bright: boolean }} look
   */
  #paintIcon(context, theme, center, { tone, bright }) {
    const { colors } = theme;
    const radius = this.height * TAB.medallion;
    drawMedallion(context, center, radius, { tone, shadow: colors.letterbox, lit: bright });
    // A tab not chosen shows its pictogram faded.
    context.save();
    context.globalAlpha *= bright ? 1 : TAB.dimIcon;
    const metals = iconMetals(theme);
    if (this.kind === PlayKind.RANKED) {
      drawTrophy(context, { x: center.x, y: center.y + radius * 0.04 }, radius * 1.25, metals);
    } else {
      drawCardFan(context, center, radius * 1.25, { tone, metals });
    }
    context.restore();
  }

  /**
   * The name (with the padlock while locked) and the line under it, from `x` to the tab's right edge.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {number} x
   * @param {{ tone: Tone, state: TabState }} look
   */
  #paintWords(context, theme, x, { tone, state }) {
    const { colors } = theme;
    const area = this.bounds;
    const h = area.height;
    const room = area.x + area.width - x - h * TAB.gap;
    const title = this.text.toUpperCase();
    const lock = this.locked ? h * TAB.lock : 0;
    const titleSize = fitted(context, { font: (size) => displayFont(theme, size), text: title, size: h * TAB.title, width: room - lock * 1.4 });
    const lineSize = this.subtitle === "" ? 0 : h * TAB.line;
    const titleY = area.y + (h - titleSize - lineSize * 1.35) / 2 + titleSize / 2;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = displayFont(theme, titleSize);
    context.fillStyle = wordsColor(theme, tone, state);
    context.fillText(title, x, titleY);
    if (this.locked) {
      drawPadlock(context, { x: x + context.measureText(title).width + lock * 0.9, y: titleY }, lock, { fill: withAlpha(tone.base, 0.85), rim: colors.textMuted });
    }
    if (lineSize > 0) {
      const font = (/** @type {number} */ size) => bodyFont(theme, size, "bold");
      context.font = font(fitted(context, { font, text: this.subtitle, size: lineSize, width: room }));
      context.fillStyle = state === "lit" ? colors.text : colors.textMuted;
      context.fillText(this.subtitle, x, titleY + titleSize / 2 + lineSize * 0.85);
    }
  }
}

/**
 * The tab's face: a glow under the tab open, a gradient down to the panel's colour, a sheen across the top of the tab open.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ area: import("@magic8/engine/shared/geometry.js").Rect, radius: number, tone: Tone, state: TabState }} tab
 */
function paintBody(context, theme, { area, radius, tone, state }) {
  const { colors } = theme;
  const lit = state === "lit";
  if (lit) {
    // The glow rises around the tab but stops at its foot, clear of the panel's corners under it.
    context.save();
    context.beginPath();
    context.rect(area.x - 2 * TAB.glow, area.y - 2 * TAB.glow, area.width + 4 * TAB.glow, area.height + 2 * TAB.glow);
    context.clip();
    tabPath(context, area, radius);
    context.shadowColor = withAlpha(tone.base, 0.75);
    context.shadowBlur = TAB.glow;
    context.fillStyle = colors.panel;
    context.fill();
    context.restore();
  }
  const faces = { lit: mix(tone.base, colors.panel, 0.45), lifted: colors.hover, dim: colors.panelDark };
  tabPath(context, area, radius);
  context.fillStyle = verticalGradient(context, area, [
    [0, faces[state]],
    [1, lit ? colors.panel : mix(colors.panelDark, colors.panel, 0.5)],
  ]);
  context.fill();
  if (lit) {
    const top = { ...area, height: area.height * 0.45 };
    context.save();
    tabPath(context, area, radius);
    context.clip();
    context.fillStyle = verticalGradient(context, top, [
      [0, withAlpha(tone.light, 0.22)],
      [1, withAlpha(tone.light, 0)],
    ]);
    context.fillRect(top.x, top.y, top.width, top.height);
    context.restore();
  }
}

/**
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {Tone} tone
 * @param {TabState} state
 */
function edgeColor(theme, tone, state) {
  const edges = { lit: tone.base, lifted: withAlpha(tone.base, 0.7), dim: theme.colors.panelBorder };
  return edges[state];
}

/**
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {Tone} tone
 * @param {TabState} state
 */
function wordsColor(theme, tone, state) {
  const words = { lit: tone.light, lifted: theme.colors.text, dim: theme.colors.textMuted };
  return words[state];
}

/**
 * A tab's outline: a rounded box.
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {number} radius
 */
function tabPath(context, area, radius) {
  roundedRectPath(context, area, radius);
}

/**
 * The largest size up to `size` at which the text fits the width.
 * @param {CanvasRenderingContext2D} context
 * @param {{ font: (size: number) => string, text: string, size: number, width: number }} fit
 */
function fitted(context, { font, text, size, width }) {
  context.font = font(size);
  const measured = context.measureText(text).width;
  return measured <= width || measured === 0 ? size : Math.max(1, (size * width) / measured);
}
