/**
 * Yes/no confirmation modal. The safe choice (Cancel) is the first focusable
 * node, so Enter never confirms a destructive action by accident.
 */
import { Button } from "./Button.js";
import { Label } from "./Label.js";
import { Modal } from "./Modal.js";

const SIZE = Object.freeze({ width: 640, height: 260 });
const INSET = 20;
const BUTTON_HEIGHT = 52;
const BUTTON_GAP = 14;

/**
 * @param {{ viewport: { logicalWidth: number, logicalHeight: number }, title: string, message: string, confirmText: string, destructive?: boolean, onConfirm: () => void, onCancel: () => void }} request
 *   `destructive` draws the confirm button in the danger colour (concede, delete, discard).
 */
export function buildConfirmModal({ viewport, title, message, confirmText, destructive = false, onConfirm, onCancel }) {
  const modal = new Modal({ id: "confirm", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: SIZE.width, panelHeight: SIZE.height, onDismiss: onCancel });
  const { panel } = modal;
  const width = SIZE.width - 2 * INSET;
  panel.add(new Label({ x: INSET, y: INSET + 10, width, height: 40, text: title, size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  panel.add(new Label({ x: INSET, y: INSET + 60, width, height: 30, text: message, size: "small", colorKey: "textMuted", fit: true }));
  const buttonWidth = (width - BUTTON_GAP) / 2;
  const y = SIZE.height - INSET - BUTTON_HEIGHT;
  panel.add(new Button({ id: "confirm.cancel", x: INSET, y, width: buttonWidth, height: BUTTON_HEIGHT, text: "Cancel", onActivate: onCancel }));
  panel.add(new Button({ id: "confirm.ok", x: INSET + buttonWidth + BUTTON_GAP, y, width: buttonWidth, height: BUTTON_HEIGHT, text: confirmText, variant: destructive ? "danger" : "primary", onActivate: onConfirm }));
  return modal;
}
