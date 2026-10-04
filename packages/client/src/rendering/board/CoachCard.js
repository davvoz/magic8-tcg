/**
 * The tutorial on the board, so that it is always clear what the coach is
 * talking about:
 * - the lesson's card, set where it hides nothing it talks about (over the
 *   middle of the table, or above or below it), its card names and button
 *   names in colour (RichText), and how far along the lessons are;
 * - the spotlight: while a lesson is read the table dims, all but what the
 *   lesson is about;
 * - the focus: a pulsing ring round each thing the coach points at, and an
 *   arrow from the lesson (or from the task's line) to it, bobbing gently;
 * - the task's line, on a plate over the middle of the table.
 * All of them but the card's Next button let taps through.
 */
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { Button } from "../ui/Button.js";
import { fillRoundedRect, glowRoundedRect } from "../ui/drawing.js";
import { Label } from "../ui/Label.js";
import { Panel, SMALL_PANEL_INSET } from "../ui/Panel.js";
import { RICH_LINE_GAP, RichTextBlock, paintRichLines, richMeasure, wrapRich } from "../ui/RichText.js";
import { drawArrow } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

/** @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect */
/** @typedef {import("@magic8/engine/shared/geometry.js").Point} Point */

/**
 * The card's parts, wide and compact (a phone in landscape): its widest, its
 * height, its inset, the title's height, the text's size, and the Next
 * button (right of the text). Room for four lines of a lesson on a phone, five on a desktop.
 */
const WIDE = Object.freeze({ width: 640, height: 200, inset: 22, title: 36, titleSize: /** @type {const} */ ("heading"), gap: 6, text: /** @type {const} */ ("body"), button: Object.freeze({ width: 150, height: 52 }), progress: 24 });
const COMPACT = Object.freeze({ width: 580, height: 140, inset: SMALL_PANEL_INSET, title: 24, titleSize: /** @type {const} */ ("body"), gap: 4, text: /** @type {const} */ ("small"), button: Object.freeze({ width: 120, height: 46 }), progress: 18 });
/** How far the card keeps from the edges of the board. */
const MARGIN = 4;
/** The focus ring: how far it stands off what it marks, its line, its halo, and how long one pulse takes. */
const RING = Object.freeze({ offset: 6, lineWidth: 3, blur: 18, periodMs: 1400, minAlpha: 0.35 });
/** The arrows: their length, wide and compact, how far they bob, their line and head. */
const ARROW = Object.freeze({ length: 70, compactLength: 40, bob: 8, width: 7, outline: 5, head: 24, gap: 4 });
/** How dark the table gets around what a lesson is about. */
const SPOTLIGHT_ALPHA = 0.62;
/** Far enough to stand for "from that side". */
const FAR = 10000;
/** The task's plate: its padding, and how much of the banner's width its text may take. */
const HINT = Object.freeze({ padX: 18, padY: 7, share: 0.72, compactShare: 0.98 });

/**
 * The lesson's card, placed clear of what it is about.
 * @param {{ lesson: Readonly<{ title: string, text: string, number: number, of: number }>, layout: import("./BoardLayout.js").BoardLayout, avoid: readonly Rect[], onNext: () => void }} options
 *   `avoid`: what the lesson points at
 * @returns {Panel}
 */
export function buildCoachCard({ lesson, layout, avoid, onNext }) {
  const { m, frame, text } = coachCardLayout(layout, avoid);
  const panel = new Panel({ id: "coach", ...frame, glowKey: "accent", smallCorners: true });
  const buttonX = frame.width - m.inset - m.button.width;
  panel.add(new Label({ id: "coach.title", x: m.inset, y: m.inset, width: text.width, height: m.title, text: lesson.title, size: m.titleSize, weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Label({ id: "coach.progress", x: buttonX, y: m.inset, width: m.button.width, height: m.progress, text: `${lesson.number} / ${lesson.of}`, size: "small", colorKey: "textMuted", align: "right" }));
  panel.add(new RichTextBlock({ id: "coach.text", ...text, text: lesson.text }));
  panel.add(new Button({ id: "coach.next", x: buttonX, y: frame.height - m.inset - m.button.height, width: m.button.width, height: m.button.height, text: "Next", variant: "primary", onActivate: onNext }));
  return panel;
}

/**
 * Where the card goes on a board, clear of what it points at as far as it
 * can be (over the middle of the table first, then beside, above or below
 * it), and where its text is read (relative to the card).
 * @param {import("./BoardLayout.js").BoardLayout} layout
 * @param {readonly Rect[]} [avoid]
 */
export function coachCardLayout(layout, avoid = []) {
  const m = layout.compact ? COMPACT : WIDE;
  const { banner } = layout;
  // A phone's card is wider than the middle column: it may lie over the portraits and the action column.
  const room = layout.compact ? { x: layout.x, width: layout.width } : { x: banner.x, width: banner.width };
  const width = Math.min(m.width, room.width - 2 * MARGIN);
  const height = Math.min(m.height, layout.height - 2 * MARGIN);
  const centreX = Math.round(Math.min(Math.max(room.x + MARGIN, banner.x + (banner.width - width) / 2), room.x + room.width - MARGIN - width));
  const xs = [...new Set([centreX, Math.round(room.x + MARGIN), Math.round(room.x + room.width - MARGIN - width)])];
  const ys = [Math.round(banner.y + banner.height / 2 - height / 2), layout.y + MARGIN, layout.y + layout.height - MARGIN - height];
  const clearance = RING.offset + (layout.compact ? ARROW.compactLength : ARROW.length) + ARROW.gap;
  const keepOut = avoid.map((area) => inflate(area, clearance));
  let best = { x: xs[0], y: ys[0], overlap: Number.POSITIVE_INFINITY };
  for (const y of ys) {
    for (const x of xs) {
      const overlap = keepOut.reduce((sum, area) => sum + overlapArea({ x, y, width, height }, area), 0);
      if (overlap < best.overlap) {
        best = { x, y, overlap };
      }
    }
  }
  const textY = m.inset + m.title + m.gap;
  return Object.freeze({
    m,
    frame: Object.freeze({ x: best.x, y: best.y, width, height }),
    text: Object.freeze({ x: m.inset, y: textY, width: width - 2 * m.inset - m.button.width - m.gap * 2, height: height - textY - m.inset, size: m.text }),
  });
}

/** The table, dimmed all round what a lesson is about. */
export class CoachSpotlight extends UiNode {
  #holes;

  /**
   * @param {{ area: Rect, holes: readonly Rect[] }} options `area`: what it dims; `holes`: what stays lit
   */
  constructor({ area, holes }) {
    super({ id: "coach.spotlight", ...area });
    this.#holes = holes.map((hole) => inflate(hole, RING.offset));
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    context.save();
    context.beginPath();
    context.rect(area.x, area.y, area.width, area.height);
    for (const hole of this.#holes) {
      addRoundedRect(context, hole, theme.spacing.radius + RING.offset);
    }
    context.fillStyle = withAlpha("#000000", SPOTLIGHT_ALPHA);
    context.fill("evenodd");
    context.restore();
  }
}

/**
 * How a task's arrows find their way: from the side of the middle column
 * for what lies beside it (the portraits, the side panel), from above or
 * else below for what lies in it, never across the task's line.
 * @typedef {Readonly<{ column: Rect, bounds: Rect, keepClear: Rect }>} ArrowRoom
 *   `column`: the table's middle column; `bounds`: what an arrow must stay in; `keepClear`: the task's line
 */

/** Rings round what the coach points at, and an arrow to each thing; taps go through. */
export class CoachFocus extends UiNode {
  #rects;
  #targets;
  /** @type {Point | null} */
  #origin;
  /** @type {ArrowRoom | null} */
  #room;
  #clock;
  #length;

  /**
   * @param {{ targets: readonly (readonly Rect[])[], origin?: Point, room?: ArrowRoom, clock: () => number, compact?: boolean }} options
   *   `targets`: each thing pointed at, in the areas it takes (a ring round each, one arrow to them all);
   *   `origin`: where a lesson's arrows come from (its card); `room`: how a task's find their way instead;
   *   `clock`: milliseconds, for the pulse
   */
  constructor({ targets, origin, room, clock, compact = false }) {
    super({ id: "coach.focus" });
    this.#rects = targets.flat();
    this.#targets = targets.filter((areas) => areas.length > 0).map(union);
    this.#origin = origin ?? null;
    this.#room = room ?? null;
    this.#clock = clock;
    this.#length = compact ? ARROW.compactLength : ARROW.length;
    this.passthrough = true;
  }

  /** The arrows drawn, tip and tail, at rest: one per thing pointed at. */
  get arrows() {
    return this.#targets.flatMap((area) => {
      const arrow = this.#arrowTo(area);
      return arrow === null ? [] : [arrow];
    });
  }

  /** @param {Rect} area */
  #arrowTo(area) {
    if (this.#origin !== null) {
      return arrowTo(area, this.#origin, this.#length);
    }
    return this.#room === null ? null : arrowWithRoom(area, this.#room, this.#length);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const phase = (this.#clock() % RING.periodMs) / RING.periodMs;
    const wave = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const color = theme.colors.accentLight;
    for (const area of this.#rects) {
      glowRoundedRect(context, inflate(area, RING.offset), { color: withAlpha(color, RING.minAlpha + (1 - RING.minAlpha) * wave), radius: theme.spacing.radius + RING.offset, blur: RING.blur, lineWidth: RING.lineWidth });
    }
    for (const { tip, tail, direction } of this.arrows) {
      const bob = ARROW.bob * wave;
      const from = { x: tail.x + direction.x * bob, y: tail.y + direction.y * bob };
      const to = { x: tip.x + direction.x * bob, y: tip.y + direction.y * bob };
      drawArrow(context, from, to, { color: withAlpha("#000000", 0.8), width: ARROW.width + ARROW.outline, headSize: ARROW.head + ARROW.outline });
      drawArrow(context, from, to, { color, width: ARROW.width, headSize: ARROW.head });
    }
  }
}

/** The task's line on a plate over the middle of the table; taps go through. */
export class CoachHint extends UiNode {
  text;
  #compact;

  /**
   * @param {{ text: string, layout: import("./BoardLayout.js").BoardLayout }} options centred on the banner
   */
  constructor({ text, layout }) {
    const share = layout.compact ? HINT.compactShare : HINT.share;
    const width = Math.round(layout.banner.width * share);
    super({ id: "coach.hint", x: Math.round(layout.banner.x + (layout.banner.width - width) / 2), y: layout.banner.y, width, height: layout.banner.height });
    this.text = text;
    this.#compact = layout.compact;
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const size = this.#compact ? "small" : "body";
    const measure = richMeasure(context, theme, size);
    const lines = wrapRich(measure, this.text, area.width - 2 * HINT.padX);
    const lineHeight = theme.fonts.sizes[size] + RICH_LINE_GAP;
    const space = measure(" ", "plain");
    const widest = Math.max(...lines.map((line) => line.reduce((sum, word, at) => sum + (at === 0 ? 0 : space) + word.reduce((total, piece) => total + measure(piece.text, piece.style), 0), 0)));
    const plate = { width: Math.min(area.width, widest + 2 * HINT.padX), height: lines.length * lineHeight + 2 * HINT.padY };
    const frame = { x: area.x + (area.width - plate.width) / 2, y: area.y + area.height / 2 - plate.height / 2, ...plate };
    fillRoundedRect(context, frame, { fill: withAlpha(theme.colors.panelDark, 0.94), radius: frame.height / 2 });
    glowRoundedRect(context, frame, { color: withAlpha(theme.colors.accent, 0.85), radius: frame.height / 2, blur: 12, lineWidth: 2 });
    context.font = fontFor(theme, size);
    paintRichLines(context, theme, lines, { area: { x: frame.x + HINT.padX, y: frame.y + HINT.padY, width: plate.width - 2 * HINT.padX, height: lines.length * lineHeight }, lineHeight, size, color: theme.colors.text, align: "center" });
  }
}

/**
 * An arrow pointing at `area` from the side `origin` lies on, its tip just off the ring.
 * @param {Rect} area
 * @param {Point} origin
 * @param {number} length
 * @returns {{ tip: Point, tail: Point, direction: Point } | null} `direction`: from the tip towards the tail; null when the origin is inside
 */
export function arrowTo(area, origin, length) {
  const ring = inflate(area, RING.offset + ARROW.gap);
  const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const dx = origin.x - centre.x;
  const dy = origin.y - centre.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || (Math.abs(dx) <= ring.width / 2 && Math.abs(dy) <= ring.height / 2)) {
    return null;
  }
  const direction = { x: dx / distance, y: dy / distance };
  const reach = Math.min(direction.x === 0 ? Number.POSITIVE_INFINITY : ring.width / 2 / Math.abs(direction.x), direction.y === 0 ? Number.POSITIVE_INFINITY : ring.height / 2 / Math.abs(direction.y));
  const tip = { x: centre.x + direction.x * reach, y: centre.y + direction.y * reach };
  return { tip, tail: { x: tip.x + direction.x * length, y: tip.y + direction.y * length }, direction };
}

/**
 * An arrow at `area` coming from where there is room for it (see ArrowRoom).
 * @param {Rect} area
 * @param {ArrowRoom} room
 * @param {number} length
 */
function arrowWithRoom(area, { column, bounds, keepClear }, length) {
  const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const beside = centre.x < column.x || centre.x > column.x + column.width;
  const directions = beside ? [{ x: Math.sign(column.x + column.width / 2 - centre.x), y: 0 }] : [{ x: 0, y: -1 }, { x: 0, y: 1 }];
  const arrows = directions.map((direction) => arrowTo(area, { x: centre.x + direction.x * FAR, y: centre.y + direction.y * FAR }, length)).filter((arrow) => arrow !== null);
  const fits = (/** @type {{ tip: Point, tail: Point }} */ arrow) => {
    const span = inflate(union([{ ...arrow.tip, width: 0, height: 0 }, { ...arrow.tail, width: 0, height: 0 }]), ARROW.head / 2);
    return overlapArea(span, keepClear) === 0 && span.x >= bounds.x && span.y >= bounds.y && span.x + span.width <= bounds.x + bounds.width && span.y + span.height <= bounds.y + bounds.height;
  };
  return arrows.find(fits) ?? arrows[0] ?? null;
}

/**
 * Adds a rounded rectangle to the path being built (roundedRectPath starts a new one).
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {number} radius
 */
function addRoundedRect(context, { x, y, width, height }, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * The smallest rectangle holding them all.
 * @param {readonly Rect[]} areas at least one
 * @returns {Rect}
 */
function union(areas) {
  const left = Math.min(...areas.map((area) => area.x));
  const top = Math.min(...areas.map((area) => area.y));
  const right = Math.max(...areas.map((area) => area.x + area.width));
  const bottom = Math.max(...areas.map((area) => area.y + area.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * @param {Rect} area
 * @param {number} by
 * @returns {Rect}
 */
function inflate(area, by) {
  return { x: area.x - by, y: area.y - by, width: area.width + 2 * by, height: area.height + 2 * by };
}

/**
 * @param {Rect} a
 * @param {Rect} b
 */
function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}
