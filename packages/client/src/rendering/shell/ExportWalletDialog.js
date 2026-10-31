/**
 * Export wallet (docs/tcg/29-google.md): the keys of the account KIJAM kept
 * for a player who signed in with Google, each with Copy, and the whole
 * wallet as a file. A warning first: whoever has these keys has the account.
 * A phone has no room for five keys written out with buttons a finger can
 * tap: there, each key is a Copy button of its own, two by two, and the
 * file holds them written out.
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
/**
 * Where everything goes, top to bottom: `top`/`bottom` the margins inside the panel, `row` each key's (its Copy as tall
 * less `rowGap`). A phone's rows are tall enough for a finger, and the account is named in the title to make room.
 */
const WIDE = Object.freeze({ top: 38, title: 40, warning: 48, row: 46, rowGap: 6, notice: 28, button: 52, bottom: 24 });
/** A phone's: the keys' Copy buttons two to a row. */
const COMPACT = Object.freeze({ top: 12, title: 28, warning: 34, row: 52, rowGap: 6, notice: 20, button: 46, bottom: 12 });
const COMPACT_COLUMNS = 2;
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
  REAUTH_CANCELLED: "The Google sign-in was cancelled, so your keys stay hidden.",
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
  const compact = viewport.compact === true;
  const rows = compact ? Math.ceil(SECRETS.length / COMPACT_COLUMNS) : SECRETS.length;
  const height = Math.min(viewport.logicalHeight - 16, size.top + size.title + size.warning + rows * size.row + size.notice + size.button + size.bottom);
  const modal = new Modal({ id: "exportWallet", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const inner = width - 2 * PANEL_INSET;
  let y = size.top;
  panel.add(new Label({ x: panel.titleInset, y, width: width - 2 * panel.titleInset, height: size.title, text: `Your wallet: @${wallet.account}`, size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  y += size.title;
  panel.add(new TextBlock({ x: PANEL_INSET, y, width: inner, height: size.warning, text: WARNING, size: "small", align: "center", colorKey: "danger" }));
  y += size.warning;
  const place = { panel, x: PANEL_INSET, y, width: inner, row: size.row, height: size.row - size.rowGap };
  if (compact) {
    addCopyButtons(place, wallet, onCopy);
  } else {
    addKeyRows(place, wallet, onCopy);
  }
  y += rows * size.row;
  panel.add(new Label({ x: panel.titleInset, y, width: width - 2 * panel.titleInset, height: size.notice, text: notice, size: "small", colorKey: "success", fit: true }));
  const side = panel.titleInset;
  const gap = 14;
  const half = (width - 2 * side - gap) / 2;
  const buttonY = height - size.bottom - size.button;
  // Close first, so that it takes the focus.
  panel.add(new Button({ id: "exportWallet.close", x: side + half + gap, y: buttonY, width: half, height: size.button, text: "Close", onActivate: onClose }));
  panel.add(new Button({ id: "exportWallet.download", x: side, y: buttonY, width: half, height: size.button, text: "Download file", variant: "primary", onActivate: onDownload }));
  return modal;
}

/**
 * @typedef {{ panel: import("../ui/Panel.js").Panel, x: number, y: number, width: number, row: number, height: number }} RowPlace
 *   where the keys go: their area's left, top and width, each row's pitch and height
 */

/**
 * Each key written out, with its Copy beside it.
 * @param {RowPlace} place
 * @param {import("../../application/wallet/WalletExport.js").ExportedWallet} wallet
 * @param {(label: string, text: string) => void} onCopy
 */
function addKeyRows({ panel, x, y, width, row, height }, wallet, onCopy) {
  SECRETS.forEach(({ key, label }, index) => {
    const secret = wallet[/** @type {keyof typeof wallet} */ (key)];
    const top = y + index * row;
    panel.add(new Label({ x, y: top, width: LABEL_WIDTH, height, text: label, size: "small", colorKey: "textMuted", align: "left", fit: true }));
    panel.add(new Label({ x: x + LABEL_WIDTH, y: top, width: width - LABEL_WIDTH - COPY_WIDTH - 12, height, text: secret, size: "small", colorKey: "text", align: "left", fit: true }));
    panel.add(new Button({ id: `exportWallet.copy.${key}`, x: x + width - COPY_WIDTH, y: top, width: COPY_WIDTH, height, text: "Copy", textSize: "small", onActivate: () => onCopy(label, secret) }));
  });
}

/**
 * A phone's: one Copy button for each key, two to a row.
 * @param {RowPlace} place
 * @param {import("../../application/wallet/WalletExport.js").ExportedWallet} wallet
 * @param {(label: string, text: string) => void} onCopy
 */
function addCopyButtons({ panel, x, y, width, row, height }, wallet, onCopy) {
  const gap = 12;
  const cell = (width - gap * (COMPACT_COLUMNS - 1)) / COMPACT_COLUMNS;
  SECRETS.forEach(({ key, label }, index) => {
    const secret = wallet[/** @type {keyof typeof wallet} */ (key)];
    const column = index % COMPACT_COLUMNS;
    const line = Math.floor(index / COMPACT_COLUMNS);
    panel.add(new Button({ id: `exportWallet.copy.${key}`, x: x + column * (cell + gap), y: y + line * row, width: cell, height, text: `Copy ${label.toLowerCase()}`, textSize: "small", onActivate: () => onCopy(label, secret) }));
  });
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
