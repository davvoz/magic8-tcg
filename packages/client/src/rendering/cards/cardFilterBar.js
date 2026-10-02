/**
 * The card filter bar, the same on every screen that lists cards: a row per
 * field (faction, rarity, type), each a label and a button per value, the
 * chosen one highlighted. Adds its nodes to a panel or list; the screen
 * keeps the filter and rebuilds when `onChange` gives it a new one.
 *
 * A phone's column has no room for it: there the screen shows one button
 * naming the filter (`buildCardFilterButton`), which opens the whole bar in
 * a dialog; the choice is applied when the dialog is closed with Done.
 */
import { CARD_FILTER_FIELDS, describeCardFilter, isFiltering, withCardFilter } from "../../application/content/CardFilter.js";
import { capitalize } from "../text/textUtils.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";

const ROW = Object.freeze({ height: 34, gap: 6 });
/** The rows in the filter dialog, tall enough for a finger. */
const DIALOG_ROW = Object.freeze({ height: 42, gap: 8 });
const LABEL_WIDTH = 74;
const BUTTON_GAP = 6;
const TITLES = Object.freeze({ faction: "Faction", rarity: "Rarity", type: "Type" });

/** Height of the bar: one row per field. */
export const CARD_FILTER_BAR_HEIGHT = CARD_FILTER_FIELDS.length * (ROW.height + ROW.gap) - ROW.gap;
/** Height of the one-button filter of a compact screen. */
export const CARD_FILTER_BUTTON_HEIGHT = 46;
/** The filter dialog: its panel, margins and the Done button. */
const DIALOG = Object.freeze({ width: 760, inset: 24, title: 40, done: Object.freeze({ width: 160, height: 46 }) });

/**
 * @param {import("../ui/UiNode.js").UiNode} parent
 * @param {{
 *   id: string,
 *   x: number,
 *   y: number,
 *   width: number,
 *   filter: import("../../application/content/CardFilter.js").CardFilter,
 *   options: import("../../application/content/CardFilter.js").CardFilterOptions,
 *   onChange: (filter: import("../../application/content/CardFilter.js").CardFilter) => void,
 *   rows?: { height: number, gap: number },
 * }} bar buttons get the ids `${id}.faction.ember`, `${id}.rarity.all`…; `rows`: their height and spacing (the bar's own by default)
 * @returns {Button | null} the first button
 */
export function buildCardFilterBar(parent, { id, x, y, width, filter, options, onChange, rows = ROW }) {
  /** @type {Button | null} */
  let first = null;
  CARD_FILTER_FIELDS.forEach((field, row) => {
    const rowY = y + row * (rows.height + rows.gap);
    parent.add(new Label({ x, y: rowY, width: LABEL_WIDTH, height: rows.height, text: TITLES[field], size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const values = options[field];
    const buttonsX = x + LABEL_WIDTH;
    const buttonWidth = (width - LABEL_WIDTH - (values.length - 1) * BUTTON_GAP) / values.length;
    values.forEach((value, index) => {
      const button = parent.add(
        new Button({
          id: `${id}.${field}.${value}`,
          x: buttonsX + index * (buttonWidth + BUTTON_GAP),
          y: rowY,
          width: buttonWidth,
          height: rows.height,
          text: capitalize(value),
          variant: filter[field] === value ? "primary" : "secondary",
          textSize: "small",
          onActivate: () => onChange(withCardFilter(filter, field, value)),
        }),
      );
      first ??= button;
    });
  });
  return first;
}

/**
 * One button naming the filter in use; it opens the whole filter bar in a
 * dialog (through `open`), and the choice made there is handed to
 * `onChange` when the dialog is closed with Done.
 * @param {import("../ui/UiNode.js").UiNode} parent
 * @param {{
 *   id: string, x: number, y: number, width: number,
 *   filter: import("../../application/content/CardFilter.js").CardFilter,
 *   options: import("../../application/content/CardFilter.js").CardFilterOptions,
 *   onChange: (filter: import("../../application/content/CardFilter.js").CardFilter) => void,
 *   dialog: { viewport: { logicalWidth: number, logicalHeight: number }, open: (modal: Modal) => void, close: () => void },
 * }} request
 * @returns {Button}
 */
export function buildCardFilterButton(parent, { id, x, y, width, filter, options, onChange, dialog }) {
  const text = isFiltering(filter) ? `Filter: ${describeCardFilter(filter)}` : "Filter: all cards";
  return parent.add(
    new Button({ id: `${id}.open`, x, y, width, height: CARD_FILTER_BUTTON_HEIGHT, text, textSize: "small", variant: isFiltering(filter) ? "primary" : "secondary", onActivate: () => dialog.open(cardFilterDialog({ id, filter, options, onChange, dialog })) }),
  );
}

/**
 * The filter bar in a dialog, on a filter of its own until Done applies it.
 * @param {{ id: string, filter: import("../../application/content/CardFilter.js").CardFilter, options: import("../../application/content/CardFilter.js").CardFilterOptions, onChange: (filter: import("../../application/content/CardFilter.js").CardFilter) => void, dialog: { viewport: { logicalWidth: number, logicalHeight: number }, close: () => void } }} request
 * @returns {Modal}
 */
function cardFilterDialog({ id, filter, options, onChange, dialog }) {
  const { viewport } = dialog;
  const width = Math.min(DIALOG.width, viewport.logicalWidth - 2 * DIALOG.inset);
  const barHeight = CARD_FILTER_FIELDS.length * (DIALOG_ROW.height + DIALOG_ROW.gap) - DIALOG_ROW.gap;
  const height = Math.min(viewport.logicalHeight - 8, 2 * DIALOG.inset + DIALOG.title + barHeight + 12 + DIALOG.done.height);
  const modal = new Modal({ id: `${id}.dialog`, width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: () => dialog.close() });
  let chosen = filter;
  const fill = () => {
    modal.panel.clear();
    modal.panel.add(new Label({ x: DIALOG.inset, y: DIALOG.inset - 6, width: width - 2 * DIALOG.inset - DIALOG.done.width - 12, height: DIALOG.title, text: "Show cards", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    modal.panel.add(
      new Button({
        id: `${id}.done`,
        x: width - DIALOG.inset - DIALOG.done.width,
        y: height - DIALOG.inset - DIALOG.done.height,
        width: DIALOG.done.width,
        height: DIALOG.done.height,
        text: "Done",
        variant: "primary",
        onActivate: () => {
          dialog.close();
          onChange(chosen);
        },
      }),
    );
    buildCardFilterBar(modal.panel, {
      id,
      x: DIALOG.inset,
      y: DIALOG.inset + DIALOG.title,
      width: width - 2 * DIALOG.inset,
      filter: chosen,
      options,
      rows: DIALOG_ROW,
      onChange: (next) => {
        chosen = next;
        fill();
      },
    });
  };
  fill();
  return modal;
}
