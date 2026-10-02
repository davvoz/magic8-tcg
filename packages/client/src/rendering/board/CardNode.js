/**
 * A card on the board as a widget: hit-tested and focused at its layout
 * slot, drawn wherever its CardVisual currently is. Tapping it reports the
 * instance id to the scene; the interaction state machine decides what
 * that means. A tappable card lifts slightly under the pointer or focus:
 * the node tells its visual when to be raised, and the visual — which
 * outlives the node across rebuilds — eases the card up and down.
 */
import { CardFaceProfile } from "../cards/CardFace.js";
import { drawCard } from "../cards/CardRenderer.js";
import { UiNode } from "../ui/UiNode.js";

/** How much a hovered or focused tappable card grows around its centre. */
const LIFT_SCALE = 1.06;

export class CardNode extends UiNode {
  /** @type {import("../cards/CardRenderer.js").BoardCard} */
  card;
  /** @type {import("../cards/CardVisual.js").CardVisual} */
  visual;
  /** @type {string | null} */
  highlight;
  /** @type {(instanceId: string) => void} */
  onTap;
  /** The face it is drawn with. @type {import("../cards/CardFace.js").CardFaceProfile} */
  profile;

  /**
   * @param {{ card: import("@magic8/engine/domain/game/GameSnapshot.js").CardView, visual: import("../cards/CardVisual.js").CardVisual, slot: import("@magic8/engine/shared/geometry.js").Rect, highlight: string | null, enabled: boolean, onTap: (instanceId: string) => void, profile?: import("../cards/CardFace.js").CardFaceProfile }} options
   *   `profile`: the board's card face (the mini one on a phone)
   */
  constructor({ card, visual, slot, highlight, enabled, onTap, profile = CardFaceProfile.COMPACT }) {
    super({ id: card.instanceId, ...slot, enabled });
    this.profile = profile;
    this.card = card;
    this.visual = visual;
    this.highlight = highlight;
    this.onTap = onTap;
    this.interactive = true;
    this.focusable = enabled;
  }

  activate() {
    if (this.isEffectivelyEnabled) {
      this.onTap(this.id);
    }
  }

  /** Whether the card is drawn raised: focused, or hovered while tappable. */
  get isLifted() {
    return this.focused || (this.hovered && this.enabled);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    if (this.visual.isLeaving) {
      return;
    }
    const lifted = this.isLifted;
    this.visual.liftTo(lifted);
    const scale = 1 + (LIFT_SCALE - 1) * this.visual.lift;
    drawCard(context, theme, this.card, { ...liftedPlacement(this.visual.state, scale), highlight: this.highlight, focused: lifted, flash: this.visual.flash, profile: this.profile });
  }
}

/**
 * Grows a placement around its centre.
 * @param {import("../cards/CardVisual.js").VisualState} state
 * @param {number} scale
 */
function liftedPlacement(state, scale) {
  if (scale === 1) {
    return state;
  }
  const width = state.width * scale;
  const height = state.height * scale;
  return { ...state, x: state.x - (width - state.width) / 2, y: state.y - (height - state.height) / 2, width, height };
}
