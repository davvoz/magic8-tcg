/**
 * The player's decks in a dialog, to pick the one they play with: each a
 * row striped with its faction mix, the one in use lit, those that break
 * the rules disabled with the first problem.
 */
import { deckMix } from "../../../application/decks/deckMix.js";
import { deckSummary, mixBands } from "../../cards/deckStripe.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { OptionRow } from "../../ui/OptionRow.js";
import { PANEL_INSET, SMALL_PANEL_INSET } from "../../ui/Panel.js";
import { ScrollList } from "../../ui/ScrollList.js";

const WIDE = Object.freeze({ width: 720, height: 620, inset: PANEL_INSET, title: 44, row: 68, gap: 10, button: 52 });
const COMPACT = Object.freeze({ width: 620, height: 0, inset: SMALL_PANEL_INSET, title: 30, row: 52, gap: 6, button: 46 });
/** A phone's dialog keeps this far from the screen's edges. */
const COMPACT_MARGIN = 10;

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number, compact?: boolean, designArea?: { width: number, height: number } },
 *   theme: import("../../theme/Theme.js").Theme,
 *   content: import("../../../application/content/ContentService.js").GameContent,
 *   decks: readonly import("../../../application/decks/DeckSelectionService.js").DeckOption[],
 *   selectedId: string | null,
 *   onChoose: (deckId: string) => void,
 *   onClose: () => void,
 * }} request
 * @returns {Modal}
 */
export function buildDeckPicker({ viewport, theme, content, decks, selectedId, onChoose, onClose }) {
  const compact = viewport.compact === true;
  const m = compact ? COMPACT : WIDE;
  const area = viewport.designArea ?? { width: viewport.logicalWidth, height: viewport.logicalHeight };
  const width = Math.min(m.width, area.width - 2 * COMPACT_MARGIN);
  const height = compact ? area.height - 2 * COMPACT_MARGIN : Math.min(m.height, area.height - 2 * COMPACT_MARGIN);
  const modal = new Modal({ id: "deckPicker", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const inner = width - 2 * m.inset;
  panel.add(new Label({ x: m.inset, y: m.inset - 6, width: inner, height: m.title, text: "Choose the deck you play with", size: compact ? "body" : "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  const listTop = m.inset + m.title + 4;
  const buttonY = height - m.inset - m.button;
  const list = panel.add(new ScrollList({ id: "deckPicker.list", x: m.inset, y: listTop, width: inner, height: buttonY - listTop - 10 }));
  decks.forEach((option, index) => {
    const mix = deckMix(content, option.deck.entries);
    const problem = option.report.valid ? [] : [`not playable: ${option.report.problems[0]?.message ?? "fix it in the Deck Builder"}`];
    list.add(
      new OptionRow({
        id: `deckPicker.deck.${option.deck.id}`,
        x: 0,
        y: index * (m.row + m.gap),
        width: list.rowWidth,
        height: m.row,
        text: option.deck.name,
        subtitle: deckSummary(option.deck.totalCards, mix, problem),
        stripe: mixBands(theme, mix),
        enabled: option.report.valid,
        selected: option.deck.id === selectedId,
        onActivate: () => onChoose(option.deck.id),
      }),
    );
  });
  list.contentHeight = Math.max(0, decks.length * (m.row + m.gap) - m.gap);
  panel.add(new Button({ id: "deckPicker.close", x: m.inset, y: buttonY, width: inner, height: m.button, text: "Close", onActivate: onClose }));
  return modal;
}
