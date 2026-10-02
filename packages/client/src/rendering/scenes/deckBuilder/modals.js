/**
 * Card inspection modal for the deck builder (add/remove when a draft is
 * open). Returns a Modal for the scene to open; all actions are callbacks
 * so the builder stays pure. Confirmation dialogs come from ui/ConfirmModal.
 */
import { CardDetail } from "../../cards/CardDetail.js";
import { rarityColorKey, rarityLabel } from "../../theme/rarity.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { INSET, INSPECT } from "./layout.js";

const BUTTON_HEIGHT = 52;
const BUTTON_GAP = 14;
/** The inspect dialog on a compact screen (a phone in landscape): as tall as it allows. */
const COMPACT_INSPECT = Object.freeze({ width: 640, height: 380, card: Object.freeze({ width: 236, height: 344 }), inset: 18, buttonHeight: 46, buttonGap: 10 });

/**
 * @param {{ viewport: { compact?: boolean, logicalWidth: number, logicalHeight: number }, card: import("../../cards/CardDetail.js").CardLike, rarity?: string | null, count: number, maxCopies: number, canAdd: boolean, onAdd: () => void, onRemove: () => void, onClose: () => void }} request
 */
export function buildInspectModal({ viewport, card, rarity = null, count, maxCopies, canAdd, onAdd, onRemove, onClose }) {
  const compact = viewport.compact === true;
  const size = compact ? COMPACT_INSPECT : { ...INSPECT, inset: INSET, buttonHeight: BUTTON_HEIGHT, buttonGap: BUTTON_GAP };
  const inset = size.inset;
  const modal = new Modal({ id: "inspect", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: size.width, panelHeight: size.height, onDismiss: onClose });
  const { panel } = modal;
  panel.add(new CardDetail({ id: "inspect.card", x: inset, y: (size.height - size.card.height) / 2, width: size.card.width, height: size.card.height, card, rarity }));
  const x = inset + size.card.width + inset;
  const width = size.width - x - inset;
  panel.add(new Label({ x, y: inset + 10, width, height: 40, text: card.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Label({ id: "inspect.rarity", x, y: inset + 52, width, height: 28, text: rarity === null ? "Rarity unknown" : rarityLabel(rarity), weight: "bold", align: "left", colorKey: rarityColorKey(rarity) }));
  panel.add(new Label({ id: "inspect.count", x, y: inset + 84, width, height: 28, text: `In deck: ${count} / ${maxCopies}`, size: "small", align: "left", colorKey: "textMuted" }));
  const actions = [
    { id: "inspect.add", text: "Add to deck", enabled: canAdd, variant: "primary", onActivate: onAdd },
    { id: "inspect.remove", text: "Remove one", enabled: count > 0, variant: "secondary", onActivate: onRemove },
    { id: "inspect.close", text: "Close", enabled: true, variant: "secondary", onActivate: onClose },
  ];
  actions.forEach((action, index) => {
    panel.add(new Button({ ...action, variant: /** @type {"primary" | "secondary"} */ (action.variant), x, y: size.height - inset - (actions.length - index) * (size.buttonHeight + size.buttonGap) + size.buttonGap, width, height: size.buttonHeight }));
  });
  return modal;
}
