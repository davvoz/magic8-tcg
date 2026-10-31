/**
 * The signed-in account, opened from the player's picture in the top bar:
 * who they are, how they signed in, and Sign out; for a Google sign-in,
 * Export wallet too (docs/tcg/29-google.md).
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
 *   onExport?: (() => void) | null,
 * }} request `method`: one of SignInMethod; `onExport`: the wallet KIJAM keeps can be exported (none: no such button)
 * @returns {Modal}
 */
export function buildAccountDialog({ viewport, user, method, onSignOut, onClose, onExport = null }) {
  const width = Math.min(SIZE.width, viewport.logicalWidth - 20);
  const exportRow = onExport === null ? 0 : SIZE.button + 12;
  const height = (viewport.compact === true ? SIZE.compactHeight : SIZE.height) + exportRow;
  const modal = new Modal({ id: "account", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const { inset, avatar } = SIZE;
  panel.add(new AvatarNode({ x: inset, y: inset, size: avatar, account: user.account }));
  const textX = inset + avatar + 16;
  panel.add(new Label({ x: textX, y: inset, width: width - textX - inset, height: avatar / 2, text: `@${user.account}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Label({ x: textX, y: inset + avatar / 2, width: width - textX - inset, height: avatar / 2, text: signedInWith(method, user.network), size: "small", colorKey: "textMuted", align: "left", fit: true }));
  // Along the dialog's foot: clear of its painted corners.
  const side = panel.titleInset;
  const half = (width - 2 * side - 12) / 2;
  const buttonY = height - inset - SIZE.button;
  // Close first, so that it takes the focus: Enter never signs out by accident.
  panel.add(new Button({ id: "account.close", x: side + half + 12, y: buttonY, width: half, height: SIZE.button, text: "Close", onActivate: onClose }));
  panel.add(new Button({ id: "signOut", x: side, y: buttonY, width: half, height: SIZE.button, text: "Sign out", variant: "danger", onActivate: onSignOut }));
  if (onExport !== null) {
    panel.add(new Button({ id: "account.export", x: side, y: buttonY - exportRow, width: width - 2 * side, height: SIZE.button, text: "Export wallet", onActivate: onExport }));
  }
  return modal;
}

/**
 * How the player signed in, as their account dialog says it.
 * @param {string | null} method one of SignInMethod
 * @param {string} network
 */
function signedInWith(method, network) {
  return `Signed in on ${network} ${SIGNED_IN_WITH[/** @type {keyof typeof SIGNED_IN_WITH} */ (method)] ?? SIGNED_IN_WITH[SignInMethod.KEYCHAIN]}`;
}

/** How each way of signing in reads in the account dialog. */
const SIGNED_IN_WITH = Object.freeze({
  [SignInMethod.KEYCHAIN]: "with Steem Keychain",
  [SignInMethod.KEYS]: "with your posting key",
  [SignInMethod.GOOGLE]: "with Google",
});
