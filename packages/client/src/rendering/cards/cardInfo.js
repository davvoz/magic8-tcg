/**
 * A card's details, the same on every screen that shows a card to sell,
 * buy, trade or look at: the card at full size (rarity gem included) and,
 * beside it, its name, rarity, type, cost and stats, keywords, rules text
 * and whatever the screen adds (serial, finish, price…). Returns a Modal
 * for the scene to open; Close and Escape call `onClose`.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { capitalize } from "../text/textUtils.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { TextBlock } from "../ui/TextBlock.js";
import { CardDetail } from "./CardDetail.js";

const PANEL = Object.freeze({ width: 920, height: 620 });
const CARD = Object.freeze({ width: 380, height: 560 });
const INSET = 30;
const LINE = 30;
const BUTTON_HEIGHT = 52;

/**
 * The card's rarity, as the app knows it (null when it does not).
 * @param {{ rarities?: import("../../application/content/CardRarities.js").CardRarities }} app
 * @param {string} cardId
 */
export const rarityOf = (app, cardId) => app.rarities?.of(cardId) ?? null;

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number },
 *   card: import("./CardDetail.js").CardLike,
 *   rarity: string | null,
 *   lines?: readonly string[],
 *   onClose: () => void,
 * }} request `lines`: extra facts about this copy or offer, one per line
 */
export function buildCardInfoModal({ viewport, card, rarity, lines = [], onClose }) {
  const modal = new Modal({ id: "cardInfo", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: PANEL.width, panelHeight: PANEL.height, onDismiss: onClose });
  const { panel } = modal;
  panel.add(new CardDetail({ id: "cardInfo.card", x: INSET, y: (PANEL.height - CARD.height) / 2, width: CARD.width, height: CARD.height, card, rarity }));
  const x = INSET + CARD.width + INSET;
  const width = PANEL.width - x - INSET;
  let y = INSET;
  panel.add(new Label({ id: "cardInfo.name", x, y, width, height: 44, text: card.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  y += 50;
  panel.add(new Label({ id: "cardInfo.rarity", x, y, width, height: LINE, text: rarity === null ? "Rarity unknown" : rarityLabel(rarity), weight: "bold", align: "left", colorKey: rarityColorKey(rarity) }));
  y += LINE;
  const facts = [`${capitalize(card.type)} · ${capitalize(card.faction)} · cost ${card.cost}`, ...(card.type === CardType.CREATURE ? [`Attack ${card.attack} · Health ${card.health}`] : [])];
  const keywords = (card.keywords ?? []).map(capitalize).join(", ");
  for (const text of [...facts, ...(keywords.length === 0 ? [] : [`Keywords: ${keywords}`])]) {
    panel.add(new Label({ x, y, width, height: LINE, text, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    y += LINE;
  }
  y += 8;
  const closeY = PANEL.height - INSET - BUTTON_HEIGHT;
  const extraHeight = lines.length * LINE;
  const textHeight = Math.max(LINE, closeY - y - extraHeight - 16);
  panel.add(new TextBlock({ id: "cardInfo.text", x, y, width, height: textHeight, text: card.text.length > 0 ? card.text : "No rules text.", size: "small", align: "left", colorKey: "text" }));
  y += textHeight + 8;
  lines.forEach((text, index) => panel.add(new Label({ id: `cardInfo.line.${index}`, x, y: y + index * LINE, width, height: LINE, text, size: "small", align: "left", colorKey: "accentLight", fit: true })));
  panel.add(new Button({ id: "cardInfo.close", x, y: closeY, width, height: BUTTON_HEIGHT, text: "Close", onActivate: onClose }));
  return modal;
}
