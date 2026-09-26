/**
 * The face of a card, drawn procedurally at any size: a bevelled frame in
 * the faction's tones with a gold rim, a cost gem, the name on a banner,
 * the art window (see CardArt), a type ribbon ending in the rarity gem (when
 * the rarity is known), the rules text box and, for creatures, attack and
 * health gems. Runtime state (damage, summoning
 * sickness, exhaustion) is layered on top when present, so the deck
 * builder's inspect view and the board share one painter.
 *
 * Layout is proportional to the frame; a profile chooses the type sizes
 * so a compact board card and a full-size inspect card each stay legible.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { rarityColor, rarityLabel } from "../theme/rarity.js";
import { bodyFont, displayFont, factionTones } from "../theme/Theme.js";
import { bevelRoundedRect, drawOutlinedText, drawTextInRect, fillRoundedRect, insetRect, roundedRectPath, verticalGradient } from "../ui/drawing.js";
import { capitalize, ellipsize, wrapText } from "../text/textUtils.js";
import { paintCardArt } from "./CardArt.js";
import { drawGem } from "../ui/shapes.js";
import { drawCostGem, drawStatGem } from "./statGem.js";

const ELLIPSIS = "…";

/**
 * @typedef {Readonly<{
 *   name: string, type: string, faction: string, cost: number, attack: number, health: number, text: string,
 *   keywords?: readonly string[], definitionId?: string, id?: string,
 *   maxHealth?: number, damage?: number, summoningSick?: boolean, exhausted?: boolean,
 * }>} CardFaceModel
 *
 * @typedef {Readonly<{
 *   id: string,
 *   nameRatio: number, textRatio: number, typeRatio: number, statRatio: number, costRatio: number,
 *   lineGapRatio: number, artRatio: number, keywordsLine: boolean,
 * }>} CardFaceProfile ratios are fractions of the frame height (cost: of the width)
 *
 * @typedef {Readonly<{
 *   frame: Rect, header: Rect, cost: { x: number, y: number, radius: number }, art: Rect, typeLine: Rect, textBox: Rect,
 *   attack: { x: number, y: number, radius: number }, health: { x: number, y: number, radius: number },
 *   textFont: number, textInset: number, lineHeight: number, textLines: number,
 * }>} CardFaceLayout
 *
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 */

/** @type {Readonly<Record<"COMPACT" | "FULL", CardFaceProfile>>} */
export const CardFaceProfile = Object.freeze({
  COMPACT: Object.freeze({ id: "compact", nameRatio: 0.07, textRatio: 0.06, typeRatio: 0.048, statRatio: 0.07, costRatio: 0.095, lineGapRatio: 0.009, artRatio: 0.25, keywordsLine: false }),
  FULL: Object.freeze({ id: "full", nameRatio: 0.058, textRatio: 0.036, typeRatio: 0.03, statRatio: 0.055, costRatio: 0.075, lineGapRatio: 0.009, artRatio: 0.42, keywordsLine: true }),
});

/** Vertical proportions shared by both profiles. */
const BAND = Object.freeze({ headerTop: 0.035, headerHeight: 0.1, artTop: 0.155, gap: 0.012, typeHeight: 0.06, creatureTextBottom: 0.85, spellTextBottom: 0.95, statsY: 0.925 });
const SIDE_INSET = 0.06;
const STAT_X = Object.freeze({ attack: 0.17, health: 0.83 });
const STATUS_TEXT = Object.freeze({ summoningSick: "Summoning sick", exhausted: "Exhausted" });

/**
 * Where everything goes for a frame and a profile. Pure, so tests can
 * check that the text box holds a sensible number of lines.
 * @param {Rect} frame
 * @param {CardFaceProfile} profile
 * @param {string} type
 * @returns {CardFaceLayout}
 */
export function cardFaceLayout(frame, profile, type) {
  const { x, y, width, height } = frame;
  const costRadius = width * profile.costRatio;
  const artTop = y + height * BAND.artTop;
  const art = { x: x + width * SIDE_INSET, y: artTop, width: width * (1 - 2 * SIDE_INSET), height: height * profile.artRatio };
  const typeLine = { x: art.x, y: art.y + art.height + height * BAND.gap, width: art.width, height: height * BAND.typeHeight };
  const textTop = typeLine.y + typeLine.height + height * BAND.gap;
  const textBottom = y + height * (type === CardType.CREATURE ? BAND.creatureTextBottom : BAND.spellTextBottom);
  const textFont = height * profile.textRatio;
  const lineHeight = textFont + height * profile.lineGapRatio;
  const textBox = { x: art.x, y: textTop, width: art.width, height: Math.max(0, textBottom - textTop) };
  const textInset = height * BAND.gap;
  const statRadius = height * profile.statRatio;
  const statsY = y + height * BAND.statsY;
  return Object.freeze({
    frame,
    header: { x: x + costRadius * 2 + width * SIDE_INSET + width * 0.03, y: y + height * BAND.headerTop, width: width * (1 - SIDE_INSET * 2) - costRadius * 2 - width * 0.03, height: height * BAND.headerHeight },
    cost: { x: x + width * SIDE_INSET + costRadius, y: y + height * BAND.headerTop + height * BAND.headerHeight / 2, radius: costRadius },
    art,
    typeLine,
    textBox,
    attack: { x: x + width * STAT_X.attack, y: statsY, radius: statRadius },
    health: { x: x + width * STAT_X.health, y: statsY, radius: statRadius },
    textFont,
    textInset,
    lineHeight,
    textLines: Math.floor((textBox.height - textInset) / lineHeight),
  });
}

/**
 * Type ribbon text: "Creature · Ember", and "· Rare" when the rarity is given.
 * @param {Pick<CardFaceModel, "type" | "faction">} model
 * @param {string | null} [rarity]
 */
export function typeLineFor(model, rarity = null) {
  const base = `${capitalize(model.type)} · ${capitalize(model.faction)}`;
  return rarity ? `${base} · ${rarityLabel(rarity)}` : base;
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {CardFaceModel} model
 * @param {{ frame: Rect, profile: CardFaceProfile, rarity?: string | null }} placement `rarity`: the card's, when known
 */
export function paintCardFace(context, theme, model, { frame, profile, rarity = null }) {
  if (frame.width <= 0 || frame.height <= 0) {
    return;
  }
  const face = { context, theme, model, tones: factionTones(theme, model.faction), layout: cardFaceLayout(frame, profile, model.type), profile, rarity };
  paintFrame(face);
  paintArtWindow(face);
  paintHeader(face);
  paintTypeLine(face);
  paintRulesText(face);
  if (model.type === CardType.CREATURE) {
    paintStats(face);
  }
  paintStatus(face);
}

/**
 * @typedef {{ context: CanvasRenderingContext2D, theme: import("../theme/Theme.js").Theme, model: CardFaceModel, tones: import("../theme/Theme.js").FactionTones, layout: CardFaceLayout, profile: CardFaceProfile, rarity: string | null }} Face
 */

/** Outer slab in the faction's dark tone, bevelled, with a gold hairline just inside the edge. @param {Face} face */
function paintFrame({ context, theme, tones, layout }) {
  const { frame } = layout;
  const radius = frame.width * 0.06;
  const border = Math.max(1.5, frame.width * 0.02);
  fillRoundedRect(context, frame, { fill: verticalGradient(context, frame, [[0, shade(tones.base, -0.15)], [0.5, tones.dark], [1, shade(tones.dark, -0.4)]]), stroke: shade(tones.dark, -0.5), radius, lineWidth: 1 });
  bevelRoundedRect(context, frame, { light: withAlpha(tones.light, 0.35), dark: withAlpha("#000000", 0.6), radius });
  fillRoundedRect(context, insetRect(frame, border * 2), { stroke: withAlpha(theme.colors.accent, 0.55), radius: Math.max(0, radius - border * 2), lineWidth: Math.max(0.8, frame.width * 0.008) });
}

/** The illustration with a thin gold frame and a shadow under the top edge. @param {Face} face */
function paintArtWindow({ context, theme, model, layout }) {
  const { art } = layout;
  paintCardArt(context, theme, model, art);
  context.save();
  roundedRectPath(context, art, 3);
  context.clip();
  context.fillStyle = verticalGradient(context, { ...art, height: art.height * 0.25 }, [[0, withAlpha("#000000", 0.45)], [1, withAlpha("#000000", 0)]]);
  context.fillRect(art.x, art.y, art.width, art.height * 0.25);
  context.restore();
  fillRoundedRect(context, art, { stroke: withAlpha(theme.colors.accent, 0.7), radius: 3, lineWidth: Math.max(0.8, art.width * 0.01) });
}

/** Cost gem and name banner. @param {Face} face */
function paintHeader({ context, theme, model, tones, layout, profile }) {
  const { header, cost, frame } = layout;
  fillRoundedRect(context, { x: header.x - cost.radius, y: header.y, width: header.width + cost.radius, height: header.height }, { fill: verticalGradient(context, header, [[0, withAlpha(tones.dark, 0.9)], [1, withAlpha("#000000", 0.75)]]), radius: header.height / 2 });
  const budget = header.width - frame.width * 0.04;
  const { font: nameFont, text: name } = fitName(context, theme, model.name, { size: frame.height * profile.nameRatio, budget });
  drawOutlinedText(context, name, header, { font: nameFont, color: theme.colors.accentLight, outline: withAlpha("#000000", 0.8), outlineWidth: Math.max(1.5, frame.height * 0.012), align: "left", padding: frame.width * 0.02 });
  drawCostGem(context, theme, { center: cost, radius: cost.radius, value: model.cost });
}

/** Steps the display face down until the name fits its banner, ellipsizing only past the smallest step. */
const NAME_FIT_STEPS = Object.freeze([1, 0.86, 0.74]);

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} name
 * @param {{ size: number, budget: number }} fit
 * @returns {{ font: string, text: string }}
 */
function fitName(context, theme, name, { size, budget }) {
  const measure = (text) => context.measureText(text).width;
  let font = displayFont(theme, size);
  for (const step of NAME_FIT_STEPS) {
    font = displayFont(theme, size * step);
    context.font = font;
    if (measure(name) <= budget) {
      return { font, text: name };
    }
  }
  return { font, text: ellipsize(measure, name, budget) };
}

/**
 * Faction-coloured ribbon with the type and, when known, the rarity: a gem
 * in the rarity's colour at its right end (named in full at inspect size).
 * @param {Face} face
 */
function paintTypeLine({ context, theme, model, tones, layout, profile, rarity }) {
  const { typeLine, frame } = layout;
  fillRoundedRect(context, typeLine, { fill: verticalGradient(context, typeLine, [[0, tones.base], [1, shade(tones.base, -0.4)]]), stroke: withAlpha(theme.colors.accent, 0.4), radius: typeLine.height / 2, lineWidth: 1 });
  const gem = rarity ? typeLine.height * 0.42 : 0;
  const textArea = rarity ? { ...typeLine, x: typeLine.x + gem * 2, width: typeLine.width - gem * 4 } : typeLine;
  const text = typeLineFor(model, profile.keywordsLine ? rarity : null);
  const font = bodyFont(theme, frame.height * profile.typeRatio, "bold");
  context.font = font;
  // The gem narrows the ribbon: only then may the text need shortening.
  const fitted = rarity ? ellipsize((value) => context.measureText(value).width, text, textArea.width) : text;
  drawOutlinedText(context, fitted, textArea, { font, color: theme.colors.text, outline: withAlpha(tones.dark, 0.8), outlineWidth: Math.max(1, frame.height * 0.008) });
  if (rarity) {
    const color = rarityColor(theme, rarity);
    const center = { x: typeLine.x + typeLine.width - typeLine.height / 2, y: typeLine.y + typeLine.height / 2 };
    const box = { x: center.x - gem, y: center.y - gem, width: gem * 2, height: gem * 2 };
    drawGem(context, center, gem, { fill: verticalGradient(context, box, [[0, mix(color, "#ffffff", 0.35)], [1, shade(color, -0.35)]]), rim: shade(color, -0.55), highlight: withAlpha("#ffffff", 0.4), sides: 4, rimWidth: Math.max(0.6, gem * 0.18) });
  }
}

/**
 * Rules text in a sunken box; the keywords line (full profile) comes first
 * in bold, the last line is ellipsized when the text is longer than the box.
 * @param {Face} face
 */
function paintRulesText({ context, theme, model, tones, layout, profile }) {
  const { textBox, textFont, textInset, lineHeight, textLines } = layout;
  fillRoundedRect(context, textBox, { fill: withAlpha(theme.colors.cardText, 0.92), stroke: withAlpha(tones.light, 0.18), radius: 3, lineWidth: 1 });
  if (textLines <= 0) {
    return;
  }
  const padding = textBox.width * 0.05;
  const width = textBox.width - 2 * padding;
  const font = bodyFont(theme, textFont);
  context.font = font;
  const measure = (text) => context.measureText(text).width;
  const keywords = profile.keywordsLine ? (model.keywords ?? []) : [];
  const keywordLines = keywords.length === 0 ? [] : [keywords.join(" · ")];
  const lines = fitLines([...keywordLines, ...wrapText(measure, model.text, width)], textLines, measure, width);
  lines.forEach((line, index) => {
    const bold = index === 0 && keywordLines.length > 0;
    drawTextInRect(context, line, { x: textBox.x + padding, y: textBox.y + textInset + index * lineHeight, width, height: lineHeight }, { font: bold ? bodyFont(theme, textFont, "bold") : font, color: theme.colors.text, align: "left" });
  });
}

/**
 * Keeps at most `capacity` lines; if some are dropped, the last kept line ends with an ellipsis.
 * @param {string[]} lines
 * @param {number} capacity
 * @param {(text: string) => number} measure
 * @param {number} width
 */
function fitLines(lines, capacity, measure, width) {
  if (lines.length <= capacity) {
    return lines;
  }
  const kept = lines.slice(0, Math.max(0, capacity));
  if (kept.length > 0) {
    kept[kept.length - 1] = ellipsize(measure, `${kept[kept.length - 1]}${ELLIPSIS}`, width);
  }
  return kept;
}

/** Attack (sword) and health (shield) gems at the bottom corners; health turns red while damaged. @param {Face} face */
function paintStats({ context, theme, model, layout }) {
  const damaged = (model.damage ?? 0) > 0;
  drawStatGem(context, theme, { center: layout.attack, radius: layout.attack.radius, value: model.attack, color: theme.colors.attack, icon: "sword", glow: true });
  drawStatGem(context, theme, { center: layout.health, radius: layout.health.radius, value: model.health, color: damaged ? theme.colors.danger : theme.colors.health, icon: "shield", glow: true });
}

/** Exhausted cards dim; summoning-sick cards get a tag; both say so over the art. @param {Face} face */
function paintStatus({ context, theme, model, tones, layout }) {
  const tag = statusTextFor(model);
  if (tag === null) {
    return;
  }
  const { frame, art } = layout;
  if (model.exhausted === true) {
    fillRoundedRect(context, frame, { fill: withAlpha("#000000", 0.42), radius: frame.width * 0.06 });
  }
  const height = frame.height * 0.062;
  const pill = { x: art.x + art.width * 0.15, y: art.y + art.height - height * 1.3, width: art.width * 0.7, height };
  fillRoundedRect(context, pill, { fill: withAlpha(mix(tones.dark, "#000000", 0.4), 0.85), stroke: withAlpha(theme.colors.accent, 0.6), radius: height / 2, lineWidth: 1 });
  drawTextInRect(context, tag, pill, { font: bodyFont(theme, height * 0.62, "bold"), color: theme.colors.accentLight });
}

/**
 * @param {CardFaceModel} model
 * @returns {string | null}
 */
export function statusTextFor(model) {
  if (model.summoningSick === true) {
    return STATUS_TEXT.summoningSick;
  }
  return model.exhausted === true ? STATUS_TEXT.exhausted : null;
}
