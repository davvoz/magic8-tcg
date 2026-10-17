/**
 * One way to play online, offered side by side with the other (Play's
 * "Play online" choice): a card lit in the way's tone — blue for casual,
 * gold for ranked — with its medallion and pictogram (a fan of cards, a
 * trophy), its name in the display face and a line under it, then what it
 * gives and what it needs as a list of steps (ticked, locked, missing:
 * StepList), and its button at the foot.
 */
import { mix, withAlpha } from "../../theme/color.js";
import { displayFont } from "../../theme/Theme.js";
import { Button } from "../../ui/Button.js";
import { roundedRectPath, verticalGradient } from "../../ui/drawing.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { UiNode } from "../../ui/UiNode.js";
import { PlayKind, drawCardFan, drawMedallion, drawPadlock, drawTrophy, iconMetals, playTone } from "./lobbyIcons.js";
import { StepList } from "./StepList.js";

/** The card's parts, wide and compact: padding, the medallion's radius, the name's size, the line under it, a step's row, the button. */
const SIZES = Object.freeze({
  wide: Object.freeze({ pad: 18, medallion: 34, title: 34, tagline: 52, row: 40, button: 56, gap: 14, glow: 22 }),
  compact: Object.freeze({ pad: 10, medallion: 22, title: 24, tagline: 38, row: 30, button: 46, gap: 6, glow: 12 }),
});

/**
 * @typedef {Readonly<{ id: string, text: string, variant?: import("../../ui/Button.js").ButtonVariant, enabled?: boolean, onActivate: () => void }>} ModeAction
 */

export class ModeCard extends UiNode {
  /** One of PlayKind. */
  kind;
  /** Its name ("Ranked"). */
  title;
  /** Whether it is not open to the player yet: a padlock beside the name. */
  locked;
  #m;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, kind: string, title: string, tagline: string, steps: readonly import("./StepList.js").Step[], action: ModeAction, locked?: boolean, compact?: boolean }} options
   */
  constructor({ kind, title, tagline, steps, action, locked = false, compact = false, ...frame }) {
    super(frame);
    this.kind = kind;
    this.title = title;
    this.locked = locked;
    const m = compact ? SIZES.compact : SIZES.wide;
    this.#m = m;
    const inner = frame.width - 2 * m.pad;
    const headHeight = 2 * m.medallion;
    const taglineY = m.pad + headHeight + m.gap;
    this.add(new TextBlock({ id: `${frame.id}.tagline`, x: m.pad, y: taglineY, width: inner, height: m.tagline, text: tagline, size: compact ? "small" : "body", colorKey: "text" }));
    const buttonY = frame.height - m.pad - m.button;
    const stepsY = taglineY + m.tagline + m.gap;
    const rows = Math.min(steps.length, Math.floor(Math.max(0, buttonY - m.gap - stepsY) / m.row));
    this.add(new StepList({ id: `${frame.id}.steps`, x: m.pad, y: stepsY, width: inner, height: rows * m.row, kind, steps: steps.slice(0, rows) }));
    this.add(new Button({ keepPlate: true, variant: "secondary", ...action, x: m.pad, y: buttonY, width: inner, height: m.button, textSize: compact ? "small" : "body" }));
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const m = this.#m;
    const tone = playTone(theme, this.kind);
    const radius = theme.spacing.radius * 1.4;
    context.save();
    context.save();
    roundedRectPath(context, area, radius);
    context.shadowColor = withAlpha(tone.base, 0.55);
    context.shadowBlur = m.glow;
    context.fillStyle = colors.panel;
    context.fill();
    context.restore();
    roundedRectPath(context, area, radius);
    context.fillStyle = verticalGradient(context, area, [
      [0, mix(tone.base, colors.panel, 0.62)],
      [0.45, colors.panel],
      [1, colors.panelDark],
    ]);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = withAlpha(tone.base, 0.85);
    context.stroke();
    const center = { x: area.x + m.pad + m.medallion, y: area.y + m.pad + m.medallion };
    drawMedallion(context, center, m.medallion, { tone, shadow: colors.letterbox });
    const metals = iconMetals(theme);
    if (this.kind === PlayKind.RANKED) {
      drawTrophy(context, { x: center.x, y: center.y + m.medallion * 0.04 }, m.medallion * 1.25, metals);
    } else {
      drawCardFan(context, center, m.medallion * 1.25, { tone, metals });
    }
    const x = center.x + m.medallion + m.gap;
    const title = this.title.toUpperCase();
    context.font = displayFont(theme, m.title);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = tone.light;
    context.fillText(title, x, center.y);
    if (this.locked) {
      const lock = m.title * 0.8;
      drawPadlock(context, { x: x + context.measureText(title).width + lock, y: center.y }, lock, { fill: withAlpha(tone.base, 0.85), rim: colors.textMuted });
    }
    context.restore();
  }
}
