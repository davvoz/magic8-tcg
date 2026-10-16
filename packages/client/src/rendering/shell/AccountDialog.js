/**
 * The signed-in account, opened from the player's picture in the top bar:
 * who they are, how they signed in, and Sign out.
 */
import { SignInMethod } from "../../application/identity/IdentityService.js";
import { AvatarNode } from "../ui/AvatarNode.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";

const SIZE = Object.freeze({ width: 460, height: 250, compactHeight: 210, avatar: 64, button: 52, inset: 24 });

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number, compact?: boolean },
 *   user: import("../../application/ports/AuthApi.contract.js").SessionUser,
 *   method: string | null,
 *   onSignOut: () => void,
 *   onClose: () => void,
 * }} request `method`: one of SignInMethod
 * @returns {Modal}
 */
export function buildAccountDialog({ viewport, user, method, onSignOut, onClose }) {
  const width = Math.min(SIZE.width, viewport.logicalWidth - 20);
  const height = viewport.compact === true ? SIZE.compactHeight : SIZE.height;
  const modal = new Modal({ id: "account", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const { inset, avatar } = SIZE;
  panel.add(new AvatarNode({ x: inset, y: inset, size: avatar, account: user.account }));
  const textX = inset + avatar + 16;
  panel.add(new Label({ x: textX, y: inset, width: width - textX - inset, height: avatar / 2, text: `@${user.account}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Label({ x: textX, y: inset + avatar / 2, width: width - textX - inset, height: avatar / 2, text: signedInWith(method, user.network), size: "small", colorKey: "textMuted", align: "left", fit: true }));
  const half = (width - 2 * inset - 12) / 2;
  const buttonY = height - inset - SIZE.button;
  // Close first, so that it takes the focus: Enter never signs out by accident.
  panel.add(new Button({ id: "account.close", x: inset + half + 12, y: buttonY, width: half, height: SIZE.button, text: "Close", onActivate: onClose }));
  panel.add(new Button({ id: "signOut", x: inset, y: buttonY, width: half, height: SIZE.button, text: "Sign out", variant: "danger", onActivate: onSignOut }));
  return modal;
}

/**
 * How the player signed in, as their account dialog says it.
 * @param {string | null} method one of SignInMethod
 * @param {string} network
 */
function signedInWith(method, network) {
  const how = method === SignInMethod.KEYS ? "with your posting key" : "with Steem Keychain";
  return `Signed in on ${network} ${how}`;
}
