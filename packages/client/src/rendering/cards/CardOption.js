/**
 * A card strip that is itself the button: for lists where a card is picked
 * (the copies offered in a trade, the cards asked for, the copy put up for
 * sale). It reads like every other card list (faction colours, cost,
 * rarity, stats) and adds what a choice needs: a gold rim and check once
 * chosen, a brighter strip under the pointer, dimmed when it cannot be
 * chosen. Behaves exactly like a Button: `text` is the card's name for
 * keyboard users and tests.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { Button } from "../ui/Button.js";
import { glowRoundedRect } from "../ui/drawing.js";
import { CardStrip } from "./CardStrip.js";

const FOCUS_BLUR = 14;

export class CardOption extends Button {
  #strip;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, card: import("./CardStrip.js").StripCard, rarity?: string | null, badge?: string | null, broken?: boolean, selected?: boolean, onActivate: () => void }} options
   *   `badge`: a short tag on the right (a copy's serial, how many are asked)
   */
  constructor(options) {
    super({ ...options, text: options.card.name, variant: "secondary", align: "left" });
    this.activationCue = SoundCue.UI_SELECT;
    this.#strip = this.add(new CardStrip({ x: 0, y: 0, width: options.width, height: options.height, card: options.card, rarity: options.rarity, badge: options.badge, broken: options.broken, selected: options.selected }));
  }

  get selected() {
    return this.#strip.selected;
  }

  set selected(value) {
    this.#strip.selected = value;
  }

  /** The tag on the right, or null. */
  get badge() {
    return this.#strip.badge;
  }

  /**
   * The strip (a child, drawn next) takes this row's state; the focus ring goes around it.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const enabled = this.isEffectivelyEnabled;
    this.#strip.muted = !enabled;
    this.#strip.lifted = enabled && this.hovered && !this.pressed;
    if (this.focused) {
      glowRoundedRect(context, this.bounds, { color: theme.colors.focus, radius: theme.spacing.radius, blur: FOCUS_BLUR, lineWidth: 3 });
    }
  }
}
