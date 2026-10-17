/**
 * The card across the top of the Home screen: what to do now. The guide's
 * next step (with the track of the five steps and a way to hide the guide),
 * or a game in progress to resume. Its text on the left, its one gold
 * button on the right.
 */
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Panel, PANEL_INSET, SMALL_PANEL_INSET } from "../../ui/Panel.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { StepTrack } from "./StepTrack.js";

/** The height each layout needs (the Home screen sizes the card with it). */
export const HEADLINE_HEIGHT = Object.freeze({ wide: 190, compact: 98 });

const WIDE = Object.freeze({
  inset: PANEL_INSET,
  kicker: Object.freeze({ y: 24, height: 22 }),
  title: Object.freeze({ y: 48, height: 46 }),
  text: Object.freeze({ y: 96, height: 30 }),
  track: Object.freeze({ y: 134, height: 32 }),
  action: Object.freeze({ width: 320, height: 56, y: 42 }),
  secondary: Object.freeze({ width: 220, height: 44, gap: 14 }),
  sizes: Object.freeze({ kicker: "small", title: "heading", text: "body" }),
});
const COMPACT = Object.freeze({
  inset: SMALL_PANEL_INSET,
  kicker: Object.freeze({ y: 10, height: 14 }),
  title: Object.freeze({ y: 24, height: 26 }),
  text: Object.freeze({ y: 50, height: 18 }),
  track: Object.freeze({ y: 74, height: 8 }),
  action: Object.freeze({ width: 200, height: 46, y: 26 }),
  secondary: Object.freeze({ width: 84, height: 46, gap: 8 }),
  sizes: Object.freeze({ kicker: "tiny", title: "body", text: "tiny" }),
});

/**
 * @typedef {Readonly<{ id: string, text: string, onActivate: () => void, enabled?: boolean }>} HeadlineAction
 */

export class HeadlineCard extends Panel {
  /** The gold button. @type {Button} */
  action;

  /**
   * @param {{
   *   id: string, x: number, y: number, width: number, height: number, compact: boolean,
   *   kicker: string, title: string, text: string,
   *   track?: readonly { name: string, done: boolean, current: boolean }[] | null,
   *   action: HeadlineAction, secondary?: HeadlineAction | null,
   * }} options `secondary`: a quieter button beside the gold one (hiding the guide)
   */
  constructor({ compact, kicker, title, text, track = null, action, secondary = null, ...frame }) {
    super({ ...frame, glowKey: "accent", smallCorners: compact });
    const m = compact ? COMPACT : WIDE;
    const actionX = frame.width - m.inset - m.action.width;
    // A phone keeps the quieter button beside the gold one; a wide card puts it under, centred.
    const textRight = compact && secondary !== null ? actionX - m.secondary.gap - m.secondary.width : actionX;
    this.#buildText(m, { id: frame.id, compact, kicker, title, text, track, width: textRight - m.inset - (compact ? 12 : 30) });
    this.action = this.add(new Button({ id: action.id, x: actionX, y: m.action.y, width: m.action.width, height: m.action.height, text: action.text, variant: "primary", keepPlate: true, enabled: action.enabled !== false, textSize: compact ? "small" : "body", onActivate: action.onActivate }));
    if (secondary !== null) {
      const x = compact ? actionX - m.secondary.gap - m.secondary.width : actionX + (m.action.width - m.secondary.width) / 2;
      const y = compact ? m.action.y : m.action.y + m.action.height + m.secondary.gap;
      this.add(new Button({ id: secondary.id, x, y, width: m.secondary.width, height: m.secondary.height, text: secondary.text, textSize: "small", enabled: secondary.enabled !== false, onActivate: secondary.onActivate }));
    }
  }

  /**
   * The kicker, the title, the line under it and the steps' track, on the left.
   * @param {typeof WIDE | typeof COMPACT} m
   * @param {{ id: string, compact: boolean, kicker: string, title: string, text: string, track: readonly { name: string, done: boolean, current: boolean }[] | null, width: number }} parts
   */
  #buildText(m, { id, compact, kicker, title, text, track, width }) {
    // The kicker sits in the card's top band: clear of its painted corner.
    const kickerX = Math.max(m.inset, this.titleInset);
    this.add(new Label({ x: kickerX, y: m.kicker.y, width: width - (kickerX - m.inset), height: m.kicker.height, text: kicker.toUpperCase(), size: m.sizes.kicker, weight: "bold", colorKey: "accent", align: "left", fit: true }));
    this.add(new Label({ id: `${id}.title`, x: m.inset, y: m.title.y, width, height: m.title.height, text: title, size: m.sizes.title, weight: "bold", colorKey: "accentLight", align: "left", glow: !compact, fit: true }));
    const line = { id: `${id}.text`, x: m.inset, y: m.text.y, width, height: m.text.height, text, size: m.sizes.text, colorKey: "text", align: /** @type {const} */ ("left") };
    // A phone has room for one line, shrunk to fit; a wide card wraps it.
    this.add(compact ? new Label({ ...line, fit: true }) : new TextBlock(line));
    if (track !== null) {
      this.add(new StepTrack({ id: `${id}.track`, x: m.inset, y: m.track.y, width, height: m.track.height, steps: track, named: !compact }));
    }
  }
}
