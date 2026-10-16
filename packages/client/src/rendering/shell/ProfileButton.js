/**
 * The signed-in player in the top bar: their STEEM profile picture and
 * name in a pill (the picture alone where there is no room), which opens
 * their account. A click, a tap or Enter calls `onActivate`.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { drawAvatar } from "../ui/avatar.js";
import { drawTextInRect, fillRoundedRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { fitText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { scalableFont } from "../theme/Theme.js";

const INSET = 4;
const NAME_GAP = 10;

export class ProfileButton extends UiNode {
  account;
  /** Whether the name is shown beside the picture. */
  named;
  /** @type {() => void} */
  onActivate;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, account: string, named: boolean, onActivate: () => void }} options
   */
  constructor(options) {
    super(options);
    this.account = options.account;
    this.named = options.named;
    this.onActivate = options.onActivate;
    this.interactive = true;
    this.focusable = true;
    this.activationCue = SoundCue.UI_SELECT;
  }

  activate() {
    if (this.isEffectivelyEnabled) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const radius = area.height / 2;
    const lifted = this.hovered || this.pressed;
    fillRoundedRect(context, area, { fill: withAlpha(lifted ? colors.panelLight : colors.panel, 0.9), stroke: this.focused ? colors.focus : colors.panelBorder, radius, lineWidth: this.focused ? 3 : 1.5 });
    const pictureRadius = radius - INSET;
    drawAvatar(context, theme, { account: this.account, center: { x: area.x + radius, y: area.y + radius }, radius: pictureRadius });
    if (!this.named) {
      return;
    }
    const nameX = area.x + 2 * radius + NAME_GAP - INSET;
    const width = area.x + area.width - radius / 2 - nameX;
    const fitted = fitText(context, { text: `@${this.account}`, font: scalableFont(theme, "small", "bold"), size: theme.fonts.sizes.small, width, minScale: 0.8 });
    drawTextInRect(context, fitted.text, { x: nameX, y: area.y, width, height: area.height }, { font: fitted.font, color: lifted ? colors.accentLight : colors.text, align: "left" });
  }
}
