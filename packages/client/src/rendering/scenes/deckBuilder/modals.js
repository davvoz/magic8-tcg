/**
 * Card inspection modal for the deck builder (add/remove when a draft is
 * open). Returns a Modal for the scene to open; all actions are callbacks
 * so the builder stays pure. Confirmation dialogs come from ui/ConfirmModal.
 */
import { CardDetail } from "../../cards/CardDetail.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { INSET, INSPECT } from "./layout.js";

const BUTTON_HEIGHT = 52;
const BUTTON_GAP = 14;

/**
 * @param {{ viewport: { logicalWidth: number, logicalHeight: number }, card: import("../../cards/CardDetail.js").CardLike, count: number, maxCopies: number, canAdd: boolean, onAdd: () => void, onRemove: () => void, onClose: () => void }} request
 */
export function buildInspectModal({ viewport, card, count, maxCopies, canAdd, onAdd, onRemove, onClose }) {
  const modal = new Modal({ id: "inspect", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: INSPECT.width, panelHeight: INSPECT.height, onDismiss: onClose });
  const { panel } = modal;
  panel.add(new CardDetail({ id: "inspect.card", x: INSET, y: (INSPECT.height - INSPECT.card.height) / 2, width: INSPECT.card.width, height: INSPECT.card.height, card }));
  const x = INSET + INSPECT.card.width + INSET;
  const width = INSPECT.width - x - INSET;
  panel.add(new Label({ x, y: INSET + 10, width, height: 40, text: card.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Label({ id: "inspect.count", x, y: INSET + 56, width, height: 28, text: `In deck: ${count} / ${maxCopies}`, size: "small", align: "left", colorKey: "textMuted" }));
  const actions = [
    { id: "inspect.add", text: "Add to deck", enabled: canAdd, variant: "primary", onActivate: onAdd },
    { id: "inspect.remove", text: "Remove one", enabled: count > 0, variant: "secondary", onActivate: onRemove },
    { id: "inspect.close", text: "Close", enabled: true, variant: "secondary", onActivate: onClose },
  ];
  actions.forEach((action, index) => {
    panel.add(new Button({ ...action, variant: /** @type {"primary" | "secondary"} */ (action.variant), x, y: INSPECT.height - INSET - (actions.length - index) * (BUTTON_HEIGHT + BUTTON_GAP) + BUTTON_GAP, width, height: BUTTON_HEIGHT }));
  });
  return modal;
}
