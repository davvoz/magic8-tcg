/**
 * A card at inspect size: the shared card face in its full profile (larger
 * art, every keyword and the whole rules text) with a soft halo in the
 * faction's colour. Used by the deck builder's inspect overlay and the
 * match's inspect modal. Reads plain properties of the card; never mutates it.
 */
import { withAlpha } from "../theme/color.js";
import { factionTones } from "../theme/Theme.js";
import { glowRoundedRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { CardFaceProfile, paintCardFace } from "./CardFace.js";

const HALO_BLUR = 36;

/**
 * @typedef {import("./CardFace.js").CardFaceModel} CardLike
 * Satisfied by both a CardDefinition (deck builder) and a snapshot CardView (board).
 */

export class CardDetail extends UiNode {
  /** @type {CardLike} */
  card;

  /**
   * @param {{ id?: string, x?: number, y?: number, width: number, height: number, card: CardLike }} options
   */
  constructor(options) {
    super(options);
    this.card = options.card;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const frame = this.bounds;
    const tones = factionTones(theme, this.card.faction);
    glowRoundedRect(context, frame, { color: withAlpha(tones.light, 0.55), radius: frame.width * 0.06, blur: HALO_BLUR, lineWidth: 2 });
    paintCardFace(context, theme, this.card, { frame, profile: CardFaceProfile.FULL });
  }
}
