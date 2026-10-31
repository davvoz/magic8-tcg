/**
 * Export wallet (docs/tcg/29-google.md): the keys of the account KIJAM kept
 * for a player who signed in with Google, each with Copy, and the whole
 * wallet as a file. A warning first: whoever has these keys has the account.
 * Shown over the screen while WalletExport shows the wallet, or says why it
 * could not.
 */
import { WalletExportStatus } from "../../application/wallet/WalletExport.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";

const WIDTH = 760;
const WIDE = Object.freeze({ top: 16, title: 40, warning: 48, account: 32, row: 44, notice: 28, button: 52 });
const COMPACT = Object.freeze({ top: 8, title: 34, warning: 40, account: 26, row: 34, notice: 22, button: 44 });
const LABEL_WIDTH = 150;
const COPY_WIDTH = 96;
const FAILED_HEIGHT = 250;

/** The secrets of the wallet, in the order they are shown and saved. */
const SECRETS = Object.freeze([
  Object.freeze({ key: "masterPassword", label: "Master password" }),
  Object.freeze({ key: "owner", label: "Owner key" }),
  Object.freeze({ key: "active", label: "Active key" }),
  Object.freeze({ key: "posting", label: "Posting key" }),
  Object.freeze({ key: "memo", label: "Memo key" }),
]);

const WARNING = "Anyone with these keys controls your account and its STEEM. Keep them private: KIJAM will never ask you for them.";

/** Why the wallet could not be shown, by the server's code; anything else shows its message. */
const FAILURE_TEXT = Object.freeze({
  REAUTH_REQUIRED: "Signing in with Google again did not go through, so your keys stay hidden. Try again.",
  RATE_LIMITED: "Too many exports in a short time. Wait a few minutes and try again.",
  NETWORK: "The game server cannot be reached.",
  UNAVAILABLE: "The game server is not available.",
});

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number, compact?: boolean },
 *   state: import("../../application/wallet/WalletExport.js").WalletExportState,
 *   notice: string,
 *   onCopy: (label: string, text: string) => void,
 *   onDownload: () => void,
 *   onClose: () => void,
 * }} request `notice`: what the last Copy or Download did
 * @returns {Modal}
 */
export function buildExportWalletDialog({ viewport, state, notice, onCopy, onDownload, onClose }) {
  if (state.status !== WalletExportStatus.SHOWN || state.wallet === null) {
    return failedDialog(viewport, state.error, onClose);
  }
  const { wallet } = state;
  const size = viewport.compact === true ? COMPACT : WIDE;
  const width = Math.min(WIDTH, viewport.logicalWidth - 20);
  const height = Math.min(viewport.logicalHeight - 16, PANEL_INSET * 2 + size.top + size.title + size.warning + size.account + SECRETS.length * size.row + size.notice + size.button);
  const modal = new Modal({ id: "exportWallet", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const inner = width - 2 * PANEL_INSET;
  let y = PANEL_INSET + size.top - 12;
  panel.add(new Label({ x: panel.titleInset, y, width: width - 2 * panel.titleInset, height: size.title, text: "Your wallet", size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  y += size.title;
  panel.add(new TextBlock({ x: PANEL_INSET, y, width: inner, height: size.warning, text: WARNING, size: "small", align: "center", colorKey: "danger" }));
  y += size.warning;
  panel.add(new Label({ x: PANEL_INSET, y, width: inner, height: size.account, text: `Account: @${wallet.account}`, weight: "bold", colorKey: "text", fit: true }));
  y += size.account;
  for (const { key, label } of SECRETS) {
    const secret = wallet[/** @type {keyof typeof wallet} */ (key)];
    const rowHeight = size.row - 6;
    panel.add(new Label({ x: PANEL_INSET, y, width: LABEL_WIDTH, height: rowHeight, text: label, size: "small", colorKey: "textMuted", align: "left", fit: true }));
    panel.add(new Label({ x: PANEL_INSET + LABEL_WIDTH, y, width: inner - LABEL_WIDTH - COPY_WIDTH - 12, height: rowHeight, text: secret, size: "small", colorKey: "text", align: "left", fit: true }));
    panel.add(new Button({ id: `exportWallet.copy.${key}`, x: PANEL_INSET + inner - COPY_WIDTH, y, width: COPY_WIDTH, height: rowHeight, text: "Copy", textSize: "small", onActivate: () => onCopy(label, secret) }));
    y += size.row;
  }
  panel.add(new Label({ x: panel.titleInset, y, width: width - 2 * panel.titleInset, height: size.notice, text: notice, size: "small", colorKey: "success", fit: true }));
  const side = panel.titleInset;
  const gap = 14;
  const half = (width - 2 * side - gap) / 2;
  const buttonY = height - PANEL_INSET - size.button + 10;
  // Close first, so that it takes the focus.
  panel.add(new Button({ id: "exportWallet.close", x: side + half + gap, y: buttonY, width: half, height: size.button, text: "Close", onActivate: onClose }));
  panel.add(new Button({ id: "exportWallet.download", x: side, y: buttonY, width: half, height: size.button, text: "Download file", variant: "primary", onActivate: onDownload }));
  return modal;
}

/**
 * @param {{ logicalWidth: number, logicalHeight: number }} viewport
 * @param {Readonly<{ code: string, message: string }> | null} error
 * @param {() => void} onClose
 */
function failedDialog(viewport, error, onClose) {
  const width = Math.min(520, viewport.logicalWidth - 20);
  const modal = new Modal({ id: "exportWallet", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: FAILED_HEIGHT, onDismiss: onClose });
  const { panel } = modal;
  const inner = width - 2 * PANEL_INSET;
  panel.add(new Label({ x: panel.titleInset, y: PANEL_INSET - 8, width: width - 2 * panel.titleInset, height: 40, text: "Export wallet", size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  const text = error === null ? "" : (FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (error.code)] ?? sentence(error.message));
  panel.add(new TextBlock({ x: PANEL_INSET, y: PANEL_INSET + 40, width: inner, height: 80, text, size: "small", align: "center", colorKey: "textMuted" }));
  panel.add(new Button({ id: "exportWallet.close", x: panel.titleInset, y: FAILED_HEIGHT - PANEL_INSET - 52 + 10, width: width - 2 * panel.titleInset, height: 52, text: "OK", onActivate: onClose }));
  return modal;
}

/** @param {string} text */
function sentence(text) {
  if (text.length === 0) {
    return text;
  }
  const stop = /[.!?]$/.test(text) ? "" : ".";
  return `${text[0].toUpperCase()}${text.slice(1)}${stop}`;
}
