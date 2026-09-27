/**
 * The card filter bar, the same on every screen that lists cards: a row per
 * field (faction, rarity, type), each a label and a button per value, the
 * chosen one highlighted. Adds its nodes to a panel or list; the screen
 * keeps the filter and rebuilds when `onChange` gives it a new one.
 */
import { CARD_FILTER_FIELDS, withCardFilter } from "../../application/content/CardFilter.js";
import { capitalize } from "../text/textUtils.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";

const ROW = Object.freeze({ height: 34, gap: 6 });
const LABEL_WIDTH = 74;
const BUTTON_GAP = 6;
const TITLES = Object.freeze({ faction: "Faction", rarity: "Rarity", type: "Type" });

/** Height of the bar: one row per field. */
export const CARD_FILTER_BAR_HEIGHT = CARD_FILTER_FIELDS.length * (ROW.height + ROW.gap) - ROW.gap;

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
 * }} bar buttons get the ids `${id}.faction.ember`, `${id}.rarity.all`…
 * @returns {Button | null} the first button
 */
export function buildCardFilterBar(parent, { id, x, y, width, filter, options, onChange }) {
  /** @type {Button | null} */
  let first = null;
  CARD_FILTER_FIELDS.forEach((field, row) => {
    const rowY = y + row * (ROW.height + ROW.gap);
    parent.add(new Label({ x, y: rowY, width: LABEL_WIDTH, height: ROW.height, text: TITLES[field], size: "small", align: "left", colorKey: "textMuted", fit: true }));
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
          height: ROW.height,
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
