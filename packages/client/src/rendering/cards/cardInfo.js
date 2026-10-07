/**
 * A card's details, the same on every screen that shows a card to sell,
 * buy, trade or look at: the card at full size (rarity gem included) and,
 * beside it, its name, rarity, type, cost and stats, keywords and rules
 * text (the keywords in gold) and whatever the screen adds (serial, edition, price…). Returns a Modal
 * for the scene to open; Close and Escape call `onClose`. On a compact
 * screen (a phone in landscape) it is as tall as the screen allows.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { capitalize } from "../text/textUtils.js";
import { rulesTextFor } from "../text/keywordText.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { TextBlock } from "../ui/TextBlock.js";
import { CardDetail } from "./CardDetail.js";

/** @typedef {Readonly<{ panel: { width: number, height: number }, card: { width: number, height: number }, inset: number, line: number, button: number, name: number }>} InfoSize */
/** @type {InfoSize} */
const WIDE = Object.freeze({ panel: Object.freeze({ width: 920, height: 620 }), card: Object.freeze({ width: 380, height: 560 }), inset: 30, line: 30, button: 52, name: 44 });
/** @type {InfoSize} */
const COMPACT = Object.freeze({ panel: Object.freeze({ width: 700, height: 384 }), card: Object.freeze({ width: 250, height: 352 }), inset: 16, line: 24, button: 44, name: 36 });

/**
 * The card's rarity, as the app knows it (null when it does not).
 * @param {{ rarities?: import("../../application/content/CardRarities.js").CardRarities }} app
 * @param {string} cardId
 */
export const rarityOf = (app, cardId) => app.rarities?.of(cardId) ?? null;

/** Names players read for the sets an edition id starts with ("core-1" is Core Set 1). */
const SET_NAMES = new Map([["core", "Core Set"]]);

/**
 * An edition (a printing, e.g. "core-1") as players read it: "Core Set 1".
 * @param {string} edition
 */
export function editionLabel(edition) {
  const [set = "", ...rest] = edition.split("-").filter((part) => part.length > 0);
  return [SET_NAMES.get(set) ?? capitalize(set), ...rest.map(capitalize)].join(" ");
}

/**
 * One copy as every screen names it: "Copy #2 · Core Set 1".
 * @param {{ serial: number, edition: string }} copy
 */
export const copyLabel = (copy) => `Copy #${copy.serial} · ${editionLabel(copy.edition)}`;

/**
 * @param {{
 *   viewport: { compact?: boolean, logicalWidth: number, logicalHeight: number },
 *   card: import("./CardDetail.js").CardLike,
 *   rarity: string | null,
 *   lines?: readonly string[],
 *   onClose: () => void,
 * }} request `lines`: extra facts about this copy or offer, one per line
 */
export function buildCardInfoModal({ viewport, card, rarity, lines = [], onClose }) {
  const { panel: PANEL, card: CARD, inset: INSET, line: LINE, button: BUTTON_HEIGHT, name } = viewport.compact === true ? COMPACT : WIDE;
  const modal = new Modal({ id: "cardInfo", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: Math.min(PANEL.width, viewport.logicalWidth - 8), panelHeight: PANEL.height, onDismiss: onClose });
  const { panel } = modal;
  panel.add(new CardDetail({ id: "cardInfo.card", x: INSET, y: (PANEL.height - CARD.height) / 2, width: CARD.width, height: CARD.height, card, rarity }));
  const x = INSET + CARD.width + INSET;
  const width = modal.panel.width - x - INSET;
  let y = INSET;
  panel.add(new Label({ id: "cardInfo.name", x, y, width, height: name, text: card.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  y += name + 6;
  panel.add(new Label({ id: "cardInfo.rarity", x, y, width, height: LINE, text: rarity === null ? "Rarity unknown" : rarityLabel(rarity), weight: "bold", align: "left", colorKey: rarityColorKey(rarity) }));
  y += LINE;
  const facts = [`${capitalize(card.type)} · ${capitalize(card.faction)} · cost ${card.cost}`, ...(card.type === CardType.CREATURE ? [`Attack ${card.attack} · Health ${card.health}`] : [])];
  for (const text of facts) {
    panel.add(new Label({ x, y, width, height: LINE, text, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    y += LINE;
  }
  const keywords = card.keywords ?? [];
  if (keywords.length > 0) {
    panel.add(new Label({ id: "cardInfo.keywords", x, y, width, height: LINE, text: keywords.map(capitalize).join(" · "), size: "small", weight: "bold", align: "left", colorKey: "accentLight", fit: true }));
    y += LINE;
  }
  y += 8;
  const closeY = PANEL.height - INSET - BUTTON_HEIGHT;
  const extraHeight = lines.length * LINE;
  const textHeight = Math.max(LINE, closeY - y - extraHeight - 16);
  panel.add(new TextBlock({ id: "cardInfo.text", x, y, width, height: textHeight, text: rulesTextFor(card) || "No rules text.", size: "small", align: "left", colorKey: "text", keywords }));
  y += textHeight + 8;
  lines.forEach((text, index) => panel.add(new Label({ id: `cardInfo.line.${index}`, x, y: y + index * LINE, width, height: LINE, text, size: "small", align: "left", colorKey: "accentLight", fit: true })));
  panel.add(new Button({ id: "cardInfo.close", x, y: closeY, width, height: BUTTON_HEIGHT, text: "Close", onActivate: onClose }));
  return modal;
}
