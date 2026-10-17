/**
 * A band tinted in a way to play's tone, to set a part of a panel apart (the
 * ranked entries the player holds): a faint fill and a thin rim. What it
 * holds is laid over it by the screen (siblings after it), so buttons there
 * take the pointer: the band itself is decorative and pointer queries look
 * through it.
 */
import { withAlpha } from "../../theme/color.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { playTone } from "./lobbyIcons.js";

export class TintedBand extends UiNode {
  /** One of PlayKind. */
  kind;
  /** Whether the rim is lit in the danger colour (something missing). */
  alert;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, kind: string, alert?: boolean }} options
   */
  constructor({ kind, alert = false, ...frame }) {
    super(frame);
    this.passthrough = true;
    this.kind = kind;
    this.alert = alert;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const tone = playTone(theme, this.kind);
    const rim = this.alert ? theme.colors.danger : tone.base;
    fillRoundedRect(context, this.bounds, { fill: withAlpha(tone.dark, 0.16), stroke: withAlpha(rim, this.alert ? 0.7 : 0.32), radius: theme.spacing.radius, lineWidth: this.alert ? 1.5 : 1 });
  }
}
