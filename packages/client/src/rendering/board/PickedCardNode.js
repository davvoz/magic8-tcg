/**
 * The hand card picked to be played, held up large over the middle of the
 * table so it can be read before the player confirms it (MatchInteraction's
 * `confirmPlays`, on a phone). Decorative: taps go through it to the board,
 * so another card can still be picked or the picked one put back.
 */
import { CardFaceProfile } from "../cards/CardFace.js";
import { drawCard } from "../cards/CardRenderer.js";
import { withAlpha } from "../theme/color.js";
import { glowRoundedRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";

const HALO = Object.freeze({ blur: 28, alpha: 0.6 });

export class PickedCardNode extends UiNode {
  #card;

  /**
   * @param {{ card: import("../cards/CardRenderer.js").BoardCard, layout: import("./BoardLayout.js").BoardLayout }} options
   *   centred on the banner between the two fields, at the board's `reveal` size
   */
  constructor({ card, layout }) {
    const { width, height } = layout.sizes.reveal;
    const top = Math.max(layout.y + 4, Math.round(layout.banner.y + layout.banner.height / 2 - height / 2));
    super({ id: "picked", x: Math.round(layout.banner.x + layout.banner.width / 2 - width / 2), y: top, width, height });
    this.#card = card;
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    glowRoundedRect(context, area, { color: withAlpha(theme.colors.accent, HALO.alpha), radius: area.width * 0.06, blur: HALO.blur, lineWidth: 2 });
    drawCard(context, theme, this.#card, { ...area, alpha: 1, highlight: "selected", profile: CardFaceProfile.COMPACT });
  }
}
