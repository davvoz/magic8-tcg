import { drawAvatar } from "./avatar.js";
import { UiNode } from "./UiNode.js";

/**
 * A player's portrait (their STEEM profile picture, or their initial) filling a square box.
 */
export class AvatarNode extends UiNode {
  /** @type {string} */
  account;

  /**
   * @param {{ id?: string, x?: number, y?: number, size: number, account: string, visible?: boolean }} options
   */
  constructor({ size, account, ...options }) {
    super({ ...options, width: size, height: size });
    this.account = account;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { x, y, width } = this.bounds;
    drawAvatar(context, theme, { account: this.account, center: { x: x + width / 2, y: y + width / 2 }, radius: width / 2 });
  }
}
