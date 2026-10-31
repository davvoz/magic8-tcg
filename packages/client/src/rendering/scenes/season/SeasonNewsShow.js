/**
 * The season's news as a show (SeasonNews): one page at a time over a
 * living backdrop in the season's colours — light turning slowly from
 * above, motes rising — each page with its own entrance.
 *
 * - intro: the season's number spaced out over a growing rule, its name in
 *   gold landing from a little larger (a shine crossing it every few
 *   seconds), the text rising under it, and up to three cards flying into a
 *   fan that breathes
 * - features: a column for each, its card rising with its faction's glow
 * - cards: every card face down, turned over one after another; an epic or
 *   legendary one bursts in its rarity's colour as it lands
 * - cycle: the cards on a wheel, each popping in over its faction's halo,
 *   then arrows drawn from each to the next and flowing on
 * - changes: each card with its old and new cost and rarity (the old ones
 *   struck through), and a stamp slammed onto it (nerf, buff, changed) with
 *   a jolt of the page
 *
 * A page change slides the old page out and the new one in. Sounds play as
 * things land (`play`). Time comes from `tick`; `settled` starts every page
 * at its end, silent (previews, tests). The page dots are drawn at the
 * bottom, between the dialog's buttons.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { ChangeTag, NewsPageKind } from "../../../application/season/SeasonNews.js";
import { Easing } from "../../animation/Tween.js";
import { CARD_SIZE } from "../../board/BoardLayout.js";
import { CardFaceProfile } from "../../cards/CardFace.js";
import { drawCard, drawCardBack } from "../../cards/CardRenderer.js";
import { wrapText } from "../../text/textUtils.js";
import { mix, withAlpha } from "../../theme/color.js";
import { rarityColor, rarityLabel } from "../../theme/rarity.js";
import { bodyFont, displayFont, factionTones } from "../../theme/Theme.js";
import { glowRoundedRect, radialGradient, roundedRectPath } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";

const CARD_ASPECT = CARD_SIZE.battlefield.width / CARD_SIZE.battlefield.height;
/** A page's clock when it is shown settled: past every entrance. */
const SETTLED_MS = 60_000;
const TRANSITION = Object.freeze({ ms: 460, shift: 60 });
/** Below this height a card is drawn with the phone's face, below the second with the board's (above, the inspect face). */
const FACE_BELOW = Object.freeze({ mini: 120, compact: 300 });
const RAYS = Object.freeze({ count: 12, width: 0.11, turnPerMs: 0.000035 });
const MOTES = 46;

/**
 * @typedef {Readonly<{ pad: number, title: number, heading: number, body: number, small: number, eyebrow: number, featureName: number, dots: number, stamp: number, arrow: number, dot: number }>} Sizes
 * @type {Readonly<{ wide: Sizes, compact: Sizes }>}
 */
const SIZES = Object.freeze({
  wide: Object.freeze({ pad: 48, title: 104, heading: 46, body: 19, small: 15, eyebrow: 26, featureName: 28, dots: 56, stamp: 42, arrow: 4, dot: 10 }),
  compact: Object.freeze({ pad: 16, title: 50, heading: 24, body: 12, small: 10, eyebrow: 14, featureName: 15, dots: 44, stamp: 22, arrow: 2.5, dot: 7 }),
});
const STAMPS = Object.freeze({
  [ChangeTag.NERF]: Object.freeze({ text: "NERF", color: "danger" }),
  [ChangeTag.BUFF]: Object.freeze({ text: "BUFF", color: "success" }),
  [ChangeTag.CHANGE]: Object.freeze({ text: "CHANGED", color: "accent" }),
});

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {{ x: number, y: number }} Point
 * @typedef {import("../../theme/Theme.js").Theme} Theme
 * @typedef {import("../../../application/season/SeasonNews.js").SeasonNews} SeasonNews
 * @typedef {import("../../../application/season/SeasonNews.js").NewsPage} NewsPage
 * @typedef {import("../../cards/CardFace.js").CardFaceModel} CardFaceModel
 * @typedef {(cue: string, options?: { delayMs?: number, gain?: number }) => void} PlaySound
 * @typedef {{
 *   context: CanvasRenderingContext2D, theme: Theme, size: Sizes, clockMs: number, news: SeasonNews,
 *   cardOf: (cardId: string) => CardFaceModel | null, rarityOf: (cardId: string) => string | null,
 * }} Stage what every painter draws with: the canvas, the look, the show's clock, the cards
 * @typedef {{ x: number, y: number, size: number, speed: number, phase: number, light: boolean }} Mote
 * @typedef {Readonly<{ atMs: number, cue: string, gain?: number }>} Beat a sound of a page, at its time
 */

export class SeasonNewsShow extends UiNode {
  #news;
  #cardOf;
  #rarityOf;
  #play;
  #size;
  #settled;
  #page = 0;
  #pageMs = 0;
  #clockMs = 0;
  /** The page sliding out: which, and how long ago it started to. @type {{ index: number, ms: number } | null} */
  #leaving = null;
  /** @type {Beat[]} the page's sounds still to play */
  #beats = [];
  /** @type {Mote[]} */
  #motes;

  /**
   * @param {{ id?: string, x?: number, y?: number, width: number, height: number, news: SeasonNews, cardOf: (cardId: string) => CardFaceModel | null, rarityOf: (cardId: string) => string | null, play?: PlaySound, compact?: boolean, settled?: boolean, startPage?: number }} options
   */
  constructor(options) {
    super(options);
    this.passthrough = true;
    this.#news = options.news;
    this.#cardOf = options.cardOf;
    this.#rarityOf = options.rarityOf;
    this.#play = options.play ?? (() => undefined);
    this.#size = options.compact === true ? SIZES.compact : SIZES.wide;
    this.#settled = options.settled === true;
    this.#motes = motesFor(options.news.id);
    this.#enter(Math.min(Math.max(0, options.startPage ?? 0), this.pageCount - 1));
  }

  get page() {
    return this.#page;
  }

  get pageCount() {
    return this.#news.pages.length;
  }

  get isLast() {
    return this.#page === this.pageCount - 1;
  }

  /** @param {number} index */
  go(index) {
    if (index < 0 || index >= this.pageCount || index === this.#page) {
      return;
    }
    this.#leaving = this.#settled ? null : { index: this.#page, ms: 0 };
    this.#enter(index);
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether to draw again (always: the backdrop lives)
   */
  tick(dtMs) {
    this.#clockMs += dtMs;
    this.#pageMs += dtMs;
    if (this.#leaving !== null) {
      this.#leaving.ms += dtMs;
      if (this.#leaving.ms >= TRANSITION.ms) {
        this.#leaving = null;
      }
    }
    while (this.#beats.length > 0 && this.#beats[0].atMs <= this.#pageMs) {
      const beat = /** @type {Beat} */ (this.#beats.shift());
      this.#play(beat.cue, beat.gain === undefined ? {} : { gain: beat.gain });
    }
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    /** @type {Stage} */
    const stage = { context, theme, size: this.#size, clockMs: this.#clockMs, news: this.#news, cardOf: this.#cardOf, rarityOf: this.#rarityOf };
    context.save();
    roundedRectPath(context, area, theme.spacing.radius);
    context.clip();
    paintBackdrop(stage, area, this.#motes);
    const stageArea = { x: area.x, y: area.y, width: area.width, height: area.height - this.#size.dots };
    if (this.#leaving === null) {
      this.#paintPage(stage, stageArea, { index: this.#page, ms: this.#pageMs, alpha: 1, shift: 0 });
    } else {
      const t = Easing.easeInOutQuad(this.#leaving.ms / TRANSITION.ms);
      this.#paintPage(stage, stageArea, { index: this.#leaving.index, ms: SETTLED_MS, alpha: 1 - t, shift: -TRANSITION.shift * t });
      this.#paintPage(stage, stageArea, { index: this.#page, ms: this.#pageMs, alpha: t, shift: TRANSITION.shift * (1 - t) });
    }
    paintDots(stage, { x: area.x, y: area.y + area.height - this.#size.dots, width: area.width, height: this.#size.dots }, { page: this.#page, count: this.pageCount });
    context.restore();
  }

  /** @param {number} index */
  #enter(index) {
    this.#page = index;
    this.#pageMs = this.#settled ? SETTLED_MS : 0;
    this.#beats = this.#settled ? [] : [...beatsOf(this.#news.pages[index], this.#rarityOf)].sort((a, b) => a.atMs - b.atMs);
  }

  /**
   * @param {Stage} stage
   * @param {Rect} area
   * @param {{ index: number, ms: number, alpha: number, shift: number }} look which page, at what point of its clock, how faded and slid
   */
  #paintPage(stage, area, { index, ms, alpha, shift }) {
    if (alpha <= 0) {
      return;
    }
    const { context, size } = stage;
    const page = this.#news.pages[index];
    context.save();
    context.globalAlpha *= alpha;
    context.translate(shift, 0);
    const inner = { x: area.x + size.pad, y: area.y + size.pad * 0.6, width: area.width - 2 * size.pad, height: area.height - size.pad * 0.6 };
    PAINTERS[page.kind](stage, inner, /** @type {any} */ (page), ms);
    context.restore();
  }
}

// ── The pages ──────────────────────────────────────────────────────────────

/** @type {Readonly<Record<string, (stage: Stage, area: Rect, page: any, ms: number) => void>>} */
const PAINTERS = Object.freeze({
  [NewsPageKind.INTRO]: paintIntro,
  [NewsPageKind.FEATURES]: paintFeatures,
  [NewsPageKind.CARDS]: paintCards,
  [NewsPageKind.CYCLE]: paintCycle,
  [NewsPageKind.CHANGES]: paintChanges,
});

/** When the intro's parts come in. */
const INTRO = Object.freeze({ eyebrow: [0, 450], rule: [150, 800], title: [250, 900], text: [850, 1400], cards: 1000, cardStep: 190, cardMs: 650, shineEvery: 3600, shineMs: 1000, shineFrom: 1300 });

/**
 * @param {Stage} stage
 * @param {Rect} area
 * @param {import("../../../application/season/SeasonNews.js").IntroPage} page
 * @param {number} ms
 */
function paintIntro(stage, area, page, ms) {
  const { context, theme, size, news } = stage;
  const hasCards = page.cardIds.length > 0;
  const textWidth = hasCards ? area.width * 0.5 : area.width;
  const left = area.x;
  // The text block, vertically centred: eyebrow, rule, title, text.
  context.font = bodyFont(theme, size.body);
  const lines = wrapText((text) => context.measureText(text).width, page.text, textWidth * 0.92);
  const lineHeight = size.body * 1.45;
  const titleSize = fitSize(context, news.name, { font: titleFont(theme, size.title), size: size.title, width: textWidth });
  const blockHeight = size.eyebrow * 1.6 + titleSize * 1.15 + size.body + lines.length * lineHeight;
  const top = area.y + Math.max(0, (area.height - blockHeight) / 2);

  const eyebrow = progress(ms, INTRO.eyebrow);
  context.save();
  context.globalAlpha *= eyebrow;
  context.font = displayFont(theme, size.eyebrow);
  context.fillStyle = theme.colors.accentLight;
  context.textBaseline = "top";
  context.textAlign = "left";
  drawSpaced(context, news.eyebrow.toUpperCase(), { x: left, y: top + (1 - eyebrow) * 10, spacing: size.eyebrow * 0.28 });
  context.restore();
  const ruleWidth = textWidth * 0.7 * Easing.easeOutCubic(progress(ms, INTRO.rule));
  const ruleY = top + size.eyebrow * 1.3;
  context.save();
  context.fillStyle = horizontalFade(context, { x: left, y: ruleY, width: ruleWidth, color: withAlpha(theme.colors.accent, 0.9) });
  context.fillRect(left, ruleY, ruleWidth, 2);
  context.restore();

  const titleY = ruleY + size.eyebrow * 0.3;
  const landing = Easing.easeOutCubic(progress(ms, INTRO.title));
  paintGoldTitle(stage, news.name, { x: left, y: titleY, size: titleSize, scale: 1 + 0.25 * (1 - landing), alpha: landing, shine: shineAt(ms) });

  const words = Easing.easeOutCubic(progress(ms, INTRO.text));
  context.save();
  context.globalAlpha *= words;
  context.font = bodyFont(theme, size.body);
  context.fillStyle = theme.colors.text;
  context.textAlign = "left";
  context.textBaseline = "top";
  const textY = titleY + titleSize * 1.15 + size.body * 0.6 + (1 - words) * 16;
  lines.forEach((line, index) => context.fillText(line, left, textY + index * lineHeight));
  context.restore();

  if (hasCards) {
    paintFan(stage, { x: area.x + area.width * 0.55, y: area.y, width: area.width * 0.45, height: area.height }, page.cardIds, ms);
  }
}

/** @param {number} ms the intro's clock @returns {number | null} where the shine crosses the title (0–1), null between shines */
function shineAt(ms) {
  if (ms < INTRO.shineFrom) {
    return null;
  }
  const into = (ms - INTRO.shineFrom) % INTRO.shineEvery;
  return into < INTRO.shineMs ? into / INTRO.shineMs : null;
}

/**
 * Up to three cards flying in and settling into a fan that breathes, over a glow.
 * @param {Stage} stage
 * @param {Rect} area
 * @param {readonly string[]} cardIds
 * @param {number} ms
 */
function paintFan(stage, area, cardIds, ms) {
  const { context, theme, clockMs } = stage;
  const spread = 0.8;
  const height = Math.min(area.height * 0.66, area.width / (1 + spread * (cardIds.length - 1)) / CARD_ASPECT);
  const width = height * CARD_ASPECT;
  const center = { x: area.x + area.width / 2, y: area.y + area.height * 0.5 };
  const tones = factionTones(theme, stage.news.accent);
  const glow = 0.55 + 0.15 * Math.sin(clockMs * 0.002);
  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = radialGradient(context, center, height * 0.95, [[0, withAlpha(tones.base, 0.55 * glow)], [0.6, withAlpha(tones.dark, 0.25 * glow)], [1, withAlpha(tones.dark, 0)]]);
  context.fillRect(center.x - height, center.y - height, height * 2, height * 2);
  context.restore();
  const middle = (cardIds.length - 1) / 2;
  const order = cardIds.map((cardId, index) => ({ cardId, index })).sort((a, b) => Math.abs(b.index - middle) - Math.abs(a.index - middle));
  for (const { cardId, index } of order) {
    const card = stage.cardOf(cardId);
    const start = INTRO.cards + index * INTRO.cardStep;
    const flight = progress(ms, [start, start + INTRO.cardMs]);
    if (card === null || flight <= 0) {
      continue;
    }
    const eased = Easing.easeOutBack(flight);
    const offset = index - middle;
    const bob = Math.sin(clockMs * 0.0016 + index * 1.7) * height * 0.012;
    paintCardAt(stage, card, {
      x: center.x + offset * width * spread,
      y: center.y + Math.abs(offset) * height * 0.06 + bob + (1 - eased) * area.height * 0.7,
      height,
      angle: offset * 0.16 + (1 - eased) * offset * 0.5,
      alpha: Math.min(1, flight * 2),
      rarity: stage.rarityOf(cardId),
    });
  }
}

/** When a feature column comes in, after the heading. */
const FEATURE = Object.freeze({ first: 300, step: 220, ms: 600 });

/**
 * @param {Stage} stage
 * @param {Rect} area
 * @param {import("../../../application/season/SeasonNews.js").FeaturesPage} page
 * @param {number} ms
 */
function paintFeatures(stage, area, page, ms) {
  const { context, theme, size } = stage;
  const top = paintHeading(stage, page.title, area, ms);
  const gap = size.pad * 0.6;
  const count = page.items.length;
  const columnWidth = (area.width - gap * (count - 1)) / count;
  const cardHeight = Math.min((area.y + area.height - top) * 0.5, (columnWidth * 0.62) / CARD_ASPECT);
  page.items.forEach((item, index) => {
    const start = FEATURE.first + index * FEATURE.step;
    const rise = Easing.easeOutCubic(progress(ms, [start, start + FEATURE.ms]));
    if (rise <= 0) {
      return;
    }
    const x = area.x + index * (columnWidth + gap);
    const middle = x + columnWidth / 2;
    const lift = (1 - rise) * 40;
    context.save();
    context.globalAlpha *= rise;
    const card = stage.cardOf(item.cardId);
    const cardCenter = { x: middle, y: top + cardHeight / 2 + size.pad * 0.2 + lift };
    if (card !== null) {
      paintHalo(context, factionTones(theme, card.faction).base, { center: cardCenter, radius: cardHeight * 0.75, strength: 0.5 + 0.12 * Math.sin(stage.clockMs * 0.002 + index) });
      paintCardAt(stage, card, { ...cardCenter, height: cardHeight, angle: 0, alpha: 1, rarity: stage.rarityOf(item.cardId) });
    }
    const nameY = top + cardHeight + size.pad * 0.55 + lift;
    context.font = displayFont(theme, size.featureName);
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillStyle = theme.colors.accentLight;
    context.shadowColor = withAlpha(theme.colors.accent, 0.6);
    context.shadowBlur = 12;
    context.fillText(item.name, middle, nameY);
    context.shadowBlur = 0;
    context.font = bodyFont(theme, size.body * 0.92);
    context.fillStyle = theme.colors.text;
    const lineHeight = size.body * 1.35;
    const textY = nameY + size.featureName * 1.5;
    const fits = Math.max(1, Math.floor((area.y + area.height - textY) / lineHeight));
    wrapText((text) => context.measureText(text).width, item.text, columnWidth * 0.92)
      .slice(0, fits)
      .forEach((line, lineIndex) => context.fillText(line, middle, textY + lineIndex * lineHeight));
    context.restore();
  });
}

/** When the cards turn over: the first, the gap between two, how long a turn takes, and an epic card's burst. */
const FLIP = Object.freeze({ first: 550, step: 125, ms: 420, burstMs: 750 });
const BURSTING = Object.freeze(["epic", "legendary"]);

/**
 * @param {Stage} stage
 * @param {Rect} area
 * @param {import("../../../application/season/SeasonNews.js").CardsPage} page
 * @param {number} ms
 */
function paintCards(stage, area, page, ms) {
  const { context, theme, size } = stage;
  let top = paintHeading(stage, page.title, area, ms);
  if (page.text.length > 0) {
    context.save();
    context.globalAlpha *= progress(ms, [200, 600]);
    context.font = bodyFont(theme, size.body);
    context.fillStyle = theme.colors.textMuted;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(page.text, area.x + area.width / 2, top - size.heading * 0.15);
    context.restore();
    top += size.body * 1.6;
  }
  const count = page.cardIds.length;
  const rows = count <= 7 ? 1 : 2;
  const columns = Math.ceil(count / rows);
  const gap = size.pad * 0.3;
  const room = { width: area.width, height: area.y + area.height - top - gap };
  const height = Math.min((room.height - gap * (rows - 1)) / rows, (room.width - gap * (columns - 1)) / columns / CARD_ASPECT);
  const width = height * CARD_ASPECT;
  const blockTop = top + (room.height - (rows * height + (rows - 1) * gap)) / 2;
  page.cardIds.forEach((cardId, index) => {
    const row = Math.floor(index / columns);
    const inRow = row === rows - 1 ? count - columns * (rows - 1) : columns;
    const rowLeft = area.x + (area.width - (inRow * width + (inRow - 1) * gap)) / 2;
    const center = { x: rowLeft + (index - row * columns) * (width + gap) + width / 2, y: blockTop + row * (height + gap) + height / 2 };
    paintFlip(stage, { cardId, center, width, height }, ms - (FLIP.first + index * FLIP.step));
  });
}

/**
 * A card turning over in place: its back, squeezed to an edge, its face; an epic or legendary one glowing once up.
 * @param {Stage} stage
 * @param {{ cardId: string, center: Point, width: number, height: number }} spot
 * @param {number} since ms since it started to turn
 */
function paintFlip(stage, { cardId, center, width, height }, since) {
  const { context, theme } = stage;
  const turn = Math.min(1, Math.max(0, since / FLIP.ms));
  const card = stage.cardOf(cardId);
  const rarity = stage.rarityOf(cardId);
  if (turn >= 1 && rarity !== null && BURSTING.includes(rarity)) {
    paintRarityGlow(stage, rarity, { center, width, height, since: since - FLIP.ms });
  }
  const swell = 1 + 0.06 * Math.sin(turn * Math.PI);
  context.save();
  context.translate(center.x, center.y - Math.sin(turn * Math.PI) * height * 0.06);
  context.scale(Math.abs(Math.cos(turn * Math.PI)) * swell, swell);
  const at = { x: -width / 2, y: -height / 2, width, height };
  if (turn < 0.5 || card === null) {
    drawCardBack(context, theme, at);
  } else {
    drawCard(context, theme, card, { ...at, alpha: 1, profile: faceFor(height), rarity });
  }
  context.restore();
}

/**
 * The lasting glow of an epic or legendary card, and the ring that bursts from it as it lands.
 * @param {Stage} stage
 * @param {string} rarity
 * @param {{ center: Point, width: number, height: number, since: number }} card `since`: ms since it landed
 */
function paintRarityGlow(stage, rarity, { center, width, height, since }) {
  const { context } = stage;
  const color = rarityColor(stage.theme, rarity);
  const pulse = 0.55 + 0.25 * Math.sin(stage.clockMs * 0.004);
  context.save();
  glowRoundedRect(context, { x: center.x - width / 2, y: center.y - height / 2, width, height }, { color: withAlpha(color, pulse), radius: width * 0.06, blur: width * 0.25, lineWidth: 2 });
  if (since < FLIP.burstMs) {
    const t = since / FLIP.burstMs;
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = withAlpha(color, 1 - t);
    context.lineWidth = 3 * (1 - t) + 1;
    context.beginPath();
    context.arc(center.x, center.y, height * (0.3 + 0.8 * Easing.easeOutCubic(t)), 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = radialGradient(context, center, height * 0.9, [[0, withAlpha(color, 0.45 * (1 - t))], [1, withAlpha(color, 0)]]);
    context.fillRect(center.x - height, center.y - height, height * 2, height * 2);
  }
  context.restore();
}

/** When the wheel's cards pop in, and when its arrows are drawn after them. */
const WHEEL = Object.freeze({ first: 300, step: 170, popMs: 450, arrowMs: 480, arrowStep: 170, flowPerMs: 0.045 });

/**
 * @param {Stage} stage
 * @param {Rect} area
 * @param {import("../../../application/season/SeasonNews.js").CyclePage} page
 * @param {number} ms
 */
function paintCycle(stage, area, page, ms) {
  const { theme } = stage;
  const textWidth = area.width * 0.36;
  paintSideText(stage, { x: area.x, y: area.y, width: textWidth, height: area.height }, page, ms);
  const wheelArea = { x: area.x + textWidth, y: area.y, width: area.width - textWidth, height: area.height };
  const center = { x: wheelArea.x + wheelArea.width / 2, y: wheelArea.y + wheelArea.height / 2 };
  const radius = Math.min(wheelArea.width * 0.36, wheelArea.height * 0.37);
  const cardHeight = radius * 0.66;
  const count = page.steps.length;
  const spots = page.steps.map((_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
  paintRuneRings(stage, center, radius * 0.42, ms);
  const arrowsFrom = WHEEL.first + count * WHEEL.step + WHEEL.popMs * 0.5;
  page.steps.forEach((step, index) => {
    const start = arrowsFrom + index * WHEEL.arrowStep;
    const victim = page.steps[(index + 1) % count];
    paintArrow(stage, {
      from: spots[index],
      to: spots[(index + 1) % count],
      center,
      clearance: cardHeight * 0.62,
      color: factionTones(theme, step.faction).light,
      victim: { name: victim.faction.toUpperCase(), color: factionTones(theme, victim.faction).light },
      drawn: Easing.easeOutCubic(progress(ms, [start, start + WHEEL.arrowMs])),
    });
  });
  page.steps.forEach((step, index) => {
    const start = WHEEL.first + index * WHEEL.step;
    paintWheelCard(stage, { cardId: step.cardId, faction: step.faction, at: spots[index], height: cardHeight, index }, progress(ms, [start, start + WHEEL.popMs]));
  });
}

/**
 * A card of the wheel, popping in over its faction's halo and ring.
 * @param {Stage} stage
 * @param {{ cardId: string, faction: string, at: Point, height: number, index: number }} spot
 * @param {number} pop 0–1
 */
function paintWheelCard(stage, { cardId, faction, at, height, index }, pop) {
  const { context, theme } = stage;
  const card = stage.cardOf(cardId);
  if (pop <= 0 || card === null) {
    return;
  }
  const scale = Easing.easeOutBack(pop);
  const tones = factionTones(theme, faction);
  const alpha = Math.min(1, pop * 2);
  paintHalo(context, tones.base, { center: at, radius: height * 0.85 * scale, strength: 0.6 + 0.15 * Math.sin(stage.clockMs * 0.003 + index) });
  context.save();
  context.globalAlpha *= alpha;
  context.strokeStyle = withAlpha(tones.light, 0.55);
  context.lineWidth = 2;
  context.beginPath();
  context.arc(at.x, at.y, height * 0.66 * scale, 0, Math.PI * 2);
  context.stroke();
  context.restore();
  paintCardAt(stage, card, { ...at, height: height * scale, angle: 0, alpha, rarity: stage.rarityOf(cardId) });
}

/**
 * Two dashed rings turning in opposite directions at the wheel's heart.
 * @param {Stage} stage
 * @param {Point} center
 * @param {number} radius
 * @param {number} ms
 */
function paintRuneRings(stage, center, radius, ms) {
  const { context } = stage;
  const tones = factionTones(stage.theme, stage.news.accent);
  context.save();
  context.globalAlpha *= progress(ms, [0, 600]) * 0.55;
  context.strokeStyle = tones.light;
  [
    { r: radius, dash: [radius * 0.12, radius * 0.08], turn: 1, width: 2 },
    { r: radius * 0.72, dash: [3, radius * 0.1], turn: -1.6, width: 3 },
  ].forEach(({ r, dash, turn, width }) => {
    context.save();
    context.translate(center.x, center.y);
    context.rotate(stage.clockMs * 0.0003 * turn);
    context.setLineDash(dash);
    context.lineWidth = width;
    context.beginPath();
    context.arc(0, 0, r, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  });
  context.fillStyle = radialGradient(context, center, radius, [[0, withAlpha(tones.base, 0.35)], [1, withAlpha(tones.base, 0)]]);
  context.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  context.restore();
}

/**
 * An arrow bowing outwards from one card of the wheel to the next: drawn
 * out over `drawn` (0–1), then its dashes flow towards its head, the
 * faction it strikes named beside it.
 * @param {Stage} stage
 * @param {{ from: Point, to: Point, center: Point, clearance: number, color: string, victim: { name: string, color: string }, drawn: number }} arrow
 */
function paintArrow(stage, { from, to, center, clearance, color, victim, drawn }) {
  if (drawn <= 0) {
    return;
  }
  const { context, size } = stage;
  const startAt = Math.min(0.45, clearance / Math.hypot(to.x - from.x, to.y - from.y));
  const until = startAt + (1 - 2 * startAt) * drawn;
  const steps = 32;
  const points = Array.from({ length: steps + 1 }, (_, step) => arcPoint({ from, to, center }, startAt + ((until - startAt) * step) / steps));
  const width = size.arrow;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.shadowColor = color;
  context.shadowBlur = width * 3;
  if (drawn >= 1) {
    context.setLineDash([width * 3, width * 2.2]);
    context.lineDashOffset = -stage.clockMs * WHEEL.flowPerMs;
  }
  context.beginPath();
  points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
  context.stroke();
  context.setLineDash([]);
  const head = points[points.length - 1];
  const direction = unit({ x: head.x - points[points.length - 2].x, y: head.y - points[points.length - 2].y });
  const barb = width * 3.2;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(head.x + direction.x * barb, head.y + direction.y * barb);
  context.lineTo(head.x - direction.y * barb * 0.75, head.y + direction.x * barb * 0.75);
  context.lineTo(head.x + direction.y * barb * 0.75, head.y - direction.x * barb * 0.75);
  context.closePath();
  context.fill();
  const mid = arcPoint({ from, to, center }, 0.5);
  const away = unit({ x: mid.x - center.x, y: mid.y - center.y });
  context.globalAlpha *= drawn;
  context.font = displayFont(stage.theme, size.small, "bold");
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = victim.color;
  context.shadowColor = "#000000";
  context.shadowBlur = 6;
  context.fillText(victim.name, mid.x + away.x * size.small * 3, mid.y + away.y * size.small * 2.2);
  context.restore();
}

/** When a change's parts come in: the card, each fact, the strike through the old values, the stamp. */
const CHANGE = Object.freeze({ card: [150, 650], fact: 500, factStep: 220, factMs: 400, strike: 300, strikeMs: 250, stamp: 1250, stampMs: 210, shakeMs: 320, rowStep: 450 });

/**
 * @param {Stage} stage
 * @param {Rect} area
 * @param {import("../../../application/season/SeasonNews.js").ChangesPage} page
 * @param {number} ms
 */
function paintChanges(stage, area, page, ms) {
  const { context } = stage;
  const top = paintHeading(stage, page.title, area, ms);
  const rowHeight = (area.y + area.height - top) / page.items.length;
  page.items.forEach((item, index) => {
    const local = ms - index * CHANGE.rowStep;
    const sinceStamp = local - CHANGE.stamp - CHANGE.stampMs;
    const shake = sinceStamp > 0 && sinceStamp < CHANGE.shakeMs ? Math.sin(sinceStamp * 0.12) * (1 - sinceStamp / CHANGE.shakeMs) * 7 : 0;
    context.save();
    context.translate(shake, shake * 0.4);
    paintChange(stage, { x: area.x, y: top + index * rowHeight, width: area.width, height: rowHeight }, item, local);
    context.restore();
  });
}

/**
 * @typedef {import("../../../application/season/SeasonNews.js").ChangesPage["items"][number]} ChangeItem
 * @typedef {{ label: string, before: string, after: string, beforeColor: string, afterColor: string }} Fact
 */

/**
 * A changed card: the card, its name, each fact old and new, the reason, the stamp.
 * @param {Stage} stage
 * @param {Rect} row
 * @param {ChangeItem} item
 * @param {number} ms
 */
function paintChange(stage, row, item, ms) {
  const { context, theme, size } = stage;
  const card = stage.cardOf(item.cardId);
  const cardHeight = Math.min(row.height * 0.92, (row.width * 0.32) / CARD_ASPECT);
  const cardWidth = cardHeight * CARD_ASPECT;
  const slide = Easing.easeOutCubic(progress(ms, CHANGE.card));
  const left = row.x + (row.width - (cardWidth + size.pad + row.width * 0.42)) / 2;
  const cardCenter = { x: left + cardWidth / 2 - (1 - slide) * 80, y: row.y + row.height / 2 };
  if (card !== null && slide > 0) {
    paintHalo(context, factionTones(theme, card.faction).base, { center: cardCenter, radius: cardHeight * 0.7, strength: 0.5 });
    paintCardAt(stage, card, { ...cardCenter, height: cardHeight, angle: 0, alpha: slide, rarity: stage.rarityOf(item.cardId) });
  }
  const facts = factsOf(theme, item);
  const text = { x: left + cardWidth + size.pad, name: size.heading * 0.9, fact: size.heading * 0.85, lines: item.text.length > 0 ? 2 : 0 };
  let y = row.y + (row.height - (text.name * 1.4 + facts.length * text.fact * 1.5 + text.lines * size.body * 1.4)) / 2;
  context.save();
  context.textBaseline = "top";
  context.textAlign = "left";
  context.globalAlpha *= progress(ms, [CHANGE.fact - 200, CHANGE.fact + 200]);
  context.font = displayFont(theme, text.name);
  context.fillStyle = theme.colors.accentLight;
  context.fillText(card?.name ?? item.cardId, text.x, y);
  context.restore();
  y += text.name * 1.4;
  facts.forEach((fact, index) => {
    paintFact(stage, fact, { x: text.x, y, size: text.fact }, ms - (CHANGE.fact + index * CHANGE.factStep));
    y += text.fact * 1.5;
  });
  if (text.lines > 0) {
    const from = CHANGE.fact + facts.length * CHANGE.factStep;
    context.save();
    context.globalAlpha *= progress(ms, [from, from + 400]);
    context.font = bodyFont(theme, size.body);
    context.fillStyle = theme.colors.text;
    context.textAlign = "left";
    context.textBaseline = "top";
    wrapText((line) => context.measureText(line).width, item.text, row.width * 0.42)
      .slice(0, text.lines)
      .forEach((line, index) => context.fillText(line, text.x, y + size.body * 0.4 + index * size.body * 1.4));
    context.restore();
  }
  paintStamp(stage, STAMPS[item.tag], { x: cardCenter.x + cardWidth * 0.18, y: cardCenter.y - cardHeight * 0.3 }, ms - CHANGE.stamp);
}

/**
 * The cost and rarity a change touched, old and new, coloured: a new cost by the change's tag, a rarity by its own colour.
 * @param {Theme} theme
 * @param {ChangeItem} item
 * @returns {Fact[]}
 */
function factsOf(theme, item) {
  const { before, after } = item;
  /** @type {Fact[]} */
  const facts = [];
  if (before.cost !== undefined || after.cost !== undefined) {
    const tagColor = /** @type {Record<string, string>} */ (theme.colors)[STAMPS[item.tag].color] ?? theme.colors.accent;
    facts.push({ label: "Cost", before: String(before.cost ?? "–"), after: String(after.cost ?? "–"), beforeColor: theme.colors.textMuted, afterColor: tagColor });
  }
  if (before.rarity !== undefined || after.rarity !== undefined) {
    facts.push({ label: "Rarity", before: rarityLabel(before.rarity), after: rarityLabel(after.rarity), beforeColor: rarityColor(theme, before.rarity), afterColor: rarityColor(theme, after.rarity) });
  }
  return facts;
}

/**
 * One fact of a change: its label, the old value struck through, an arrow, the new value lit.
 * @param {Stage} stage
 * @param {Fact} fact
 * @param {{ x: number, y: number, size: number }} at
 * @param {number} since ms since it started to come in
 */
function paintFact(stage, fact, at, since) {
  const { context, theme, size } = stage;
  const shown = Easing.easeOutCubic(progress(since, [0, CHANGE.factMs]));
  const strike = progress(since, [CHANGE.strike, CHANGE.strike + CHANGE.strikeMs]);
  const middle = at.y + at.size * 0.6;
  context.save();
  context.globalAlpha *= shown;
  context.textBaseline = "middle";
  context.textAlign = "left";
  let x = at.x + (1 - shown) * 30;
  context.font = bodyFont(theme, size.small, "bold");
  context.fillStyle = theme.colors.textMuted;
  context.fillText(fact.label.toUpperCase(), x, middle);
  x += Math.max(context.measureText("RARITY").width, size.small * 4) + size.pad * 0.4;
  context.font = displayFont(theme, at.size);
  const faded = context.globalAlpha;
  context.globalAlpha = faded * 0.75;
  context.fillStyle = fact.beforeColor;
  context.fillText(fact.before, x, middle);
  context.globalAlpha = faded;
  const beforeWidth = context.measureText(fact.before).width;
  context.strokeStyle = theme.colors.danger;
  context.lineWidth = Math.max(2, at.size * 0.08);
  context.beginPath();
  context.moveTo(x - 4, middle);
  context.lineTo(x - 4 + (beforeWidth + 8) * strike, middle);
  context.stroke();
  x += beforeWidth + size.pad * 0.4;
  context.fillStyle = theme.colors.accent;
  context.fillText("➜", x, middle);
  x += context.measureText("➜").width + size.pad * 0.4;
  context.font = displayFont(theme, at.size * 1.15);
  context.fillStyle = fact.afterColor;
  context.shadowColor = fact.afterColor;
  context.shadowBlur = 14 * strike;
  context.fillText(fact.after, x, middle);
  context.restore();
}

/**
 * A stamp slammed down: from large and clear to its place, then a ring where it struck.
 * @param {Stage} stage
 * @param {{ text: string, color: string }} stamp
 * @param {Point} at
 * @param {number} since ms since it started falling
 */
function paintStamp(stage, stamp, at, since) {
  if (since <= 0) {
    return;
  }
  const { context, theme, size } = stage;
  const fall = Easing.easeInCubic(Math.min(1, since / CHANGE.stampMs));
  const color = /** @type {Record<string, string>} */ (theme.colors)[stamp.color] ?? theme.colors.danger;
  context.save();
  context.translate(at.x, at.y);
  context.rotate(-0.22);
  context.scale(2.4 - 1.4 * fall, 2.4 - 1.4 * fall);
  context.globalAlpha *= fall;
  context.font = titleFont(theme, size.stamp);
  const width = context.measureText(stamp.text).width + size.stamp * 0.9;
  const height = size.stamp * 1.5;
  context.fillStyle = withAlpha(mix(color, "#000000", 0.55), 0.55);
  roundedRectPath(context, { x: -width / 2, y: -height / 2, width, height }, size.stamp * 0.2);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, size.stamp * 0.1);
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.stroke();
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(stamp.text, 0, size.stamp * 0.05);
  context.restore();
  const after = since - CHANGE.stampMs;
  if (after > 0 && after < 600) {
    const t = after / 600;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = withAlpha(color, 1 - t);
    context.lineWidth = 3;
    context.beginPath();
    context.arc(at.x, at.y, size.stamp * (1 + 3 * Easing.easeOutCubic(t)), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}

// ── Shared pieces ──────────────────────────────────────────────────────────

/**
 * The season's backdrop: its faction's dark sky, light turning slowly from above, rising motes, a vignette.
 * @param {Stage} stage
 * @param {Rect} area
 * @param {readonly Mote[]} motes
 */
function paintBackdrop(stage, area, motes) {
  const { context, theme, clockMs } = stage;
  const tones = factionTones(theme, stage.news.accent);
  context.save();
  context.fillStyle = theme.colors.background;
  context.fillRect(area.x, area.y, area.width, area.height);
  context.fillStyle = radialGradient(context, { x: area.x + area.width * 0.72, y: area.y + area.height * 0.32 }, area.width * 0.65, [[0, withAlpha(tones.base, 0.42)], [0.5, withAlpha(tones.dark, 0.5)], [1, withAlpha(tones.dark, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  context.fillStyle = radialGradient(context, { x: area.x + area.width * 0.15, y: area.y + area.height * 0.95 }, area.width * 0.5, [[0, withAlpha(theme.colors.accent, 0.14)], [1, withAlpha(theme.colors.accent, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  context.globalCompositeOperation = "lighter";
  paintRays(stage, { x: area.x + area.width * 0.62, y: area.y - area.height * 0.25 }, Math.hypot(area.width, area.height) * 1.1);
  for (const mote of motes) {
    const y = area.y + area.height * (1 - ((mote.y + clockMs * mote.speed) % 1));
    const x = area.x + area.width * mote.x + Math.sin(clockMs * 0.0009 + mote.phase) * 14;
    const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clockMs * 0.004 + mote.phase * 3));
    context.fillStyle = withAlpha(mote.light ? tones.light : theme.colors.accentLight, 0.75 * twinkle);
    context.beginPath();
    context.arc(x, y, mote.size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalCompositeOperation = "source-over";
  const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  context.fillStyle = radialGradient(context, middle, Math.hypot(area.width, area.height) * 0.6, [[0, withAlpha("#000000", 0)], [0.6, withAlpha("#000000", 0)], [1, withAlpha("#000000", 0.65)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  context.restore();
}

/**
 * Shafts of light fanning down from a point above, swaying and breathing.
 * @param {Stage} stage
 * @param {Point} source
 * @param {number} reach
 */
function paintRays(stage, source, reach) {
  const { context, clockMs } = stage;
  const light = factionTones(stage.theme, stage.news.accent).light;
  context.save();
  context.translate(source.x, source.y);
  context.rotate(Math.sin(clockMs * RAYS.turnPerMs) * 0.35);
  for (let ray = 0; ray < RAYS.count; ray += 1) {
    const angle = Math.PI * 0.15 + (ray / RAYS.count) * Math.PI * 0.7;
    const breathe = 0.5 + 0.5 * Math.sin(clockMs * 0.0011 + ray * 2.3);
    context.fillStyle = radialGradient(context, { x: 0, y: 0 }, reach, [[0, withAlpha(light, 0.1 * breathe)], [1, withAlpha(light, 0)]]);
    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, reach, angle, angle + RAYS.width * (0.6 + breathe * 0.6));
    context.closePath();
    context.fill();
  }
  context.restore();
}

/**
 * A page's heading in gold, centred at the top, sliding down into place; returns where the page goes on under it.
 * @param {Stage} stage
 * @param {string} text
 * @param {Rect} area
 * @param {number} ms
 */
function paintHeading(stage, text, area, ms) {
  const { context, theme, size } = stage;
  const shown = Easing.easeOutCubic(progress(ms, [0, 500]));
  const center = area.x + area.width / 2;
  context.save();
  context.globalAlpha *= shown;
  context.font = titleFont(theme, size.heading);
  context.textAlign = "center";
  context.textBaseline = "top";
  const y = area.y - (1 - shown) * 14;
  context.fillStyle = goldFill(context, theme, { top: y, size: size.heading });
  context.shadowColor = withAlpha(theme.colors.accent, 0.55);
  context.shadowBlur = 20;
  context.fillText(text, center, y);
  context.shadowBlur = 0;
  const ruleWidth = Math.min(area.width * 0.4, context.measureText(text).width * 1.3) * shown;
  const ruleY = y + size.heading * 1.2;
  context.fillStyle = horizontalFade(context, { x: center - ruleWidth / 2, y: ruleY, width: ruleWidth, color: theme.colors.accent, centred: true });
  context.fillRect(center - ruleWidth / 2, ruleY, ruleWidth, 2);
  context.restore();
  return area.y + size.heading * 1.2 + size.pad * 0.5;
}

/**
 * A page's title and text down the left side, centred in height.
 * @param {Stage} stage
 * @param {Rect} area
 * @param {{ title: string, text: string }} words
 * @param {number} ms
 */
function paintSideText(stage, area, { title, text }, ms) {
  const { context, theme, size } = stage;
  context.save();
  context.font = bodyFont(theme, size.body);
  const lines = wrapText((line) => context.measureText(line).width, text, area.width * 0.95);
  const lineHeight = size.body * 1.45;
  const titleSize = fitSize(context, title, { font: titleFont(theme, size.heading), size: size.heading, width: area.width });
  const top = area.y + Math.max(0, (area.height - (titleSize * 1.6 + lines.length * lineHeight)) / 2);
  const shown = Easing.easeOutCubic(progress(ms, [0, 500]));
  context.globalAlpha *= shown;
  context.font = titleFont(theme, titleSize);
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = goldFill(context, theme, { top, size: titleSize });
  context.shadowColor = withAlpha(theme.colors.accent, 0.55);
  context.shadowBlur = 18;
  context.fillText(title, area.x - (1 - shown) * 20, top);
  context.shadowBlur = 0;
  const ruleWidth = area.width * 0.6 * shown;
  context.fillStyle = horizontalFade(context, { x: area.x, y: top + titleSize * 1.2, width: ruleWidth, color: theme.colors.accent });
  context.fillRect(area.x, top + titleSize * 1.2, ruleWidth, 2);
  context.globalAlpha *= progress(ms, [250, 750]);
  context.font = bodyFont(theme, size.body);
  context.fillStyle = theme.colors.text;
  lines.forEach((line, index) => context.fillText(line, area.x, top + titleSize * 1.6 + index * lineHeight));
  context.restore();
}

/**
 * The season's name: gold, outlined, glowing in the season's colour, with a band of light crossing it when `shine` is set.
 * @param {Stage} stage
 * @param {string} text
 * @param {{ x: number, y: number, size: number, scale: number, alpha: number, shine: number | null }} look
 */
function paintGoldTitle(stage, text, { x, y, size, scale, alpha, shine }) {
  if (alpha <= 0) {
    return;
  }
  const { context, theme } = stage;
  context.save();
  context.globalAlpha *= alpha;
  context.translate(x, y + size / 2);
  context.scale(scale, scale);
  context.font = titleFont(theme, size);
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.shadowColor = withAlpha(factionTones(theme, stage.news.accent).base, 0.9);
  context.shadowBlur = size * 0.45;
  context.strokeStyle = withAlpha("#000000", 0.85);
  context.lineWidth = Math.max(3, size * 0.07);
  context.strokeText(text, 0, 0);
  context.shadowBlur = 0;
  context.fillStyle = goldFill(context, theme, { top: -size / 2, size });
  context.fillText(text, 0, 0);
  if (shine !== null) {
    const width = context.measureText(text).width;
    const band = -width * 0.3 + shine * width * 1.6;
    const light = context.createLinearGradient(band - size, -size / 2, band + size, size / 2);
    light.addColorStop(0, withAlpha("#ffffff", 0));
    light.addColorStop(0.5, withAlpha("#ffffff", 0.85));
    light.addColorStop(1, withAlpha("#ffffff", 0));
    context.fillStyle = light;
    context.fillText(text, 0, 0);
  }
  context.restore();
}

/**
 * A card drawn centred on a point, turned by `angle`, over its shadow, with its face chosen for its size.
 * @param {Stage} stage
 * @param {CardFaceModel} card
 * @param {{ x: number, y: number, height: number, angle: number, alpha: number, rarity: string | null }} at
 */
function paintCardAt(stage, card, { x, y, height, angle, alpha, rarity }) {
  if (height <= 0 || alpha <= 0) {
    return;
  }
  const { context } = stage;
  const width = height * CARD_ASPECT;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.shadowColor = withAlpha("#000000", 0.6);
  context.shadowBlur = height * 0.08;
  context.shadowOffsetY = height * 0.03;
  context.fillStyle = withAlpha("#000000", 0.4 * alpha);
  roundedRectPath(context, { x: -width / 2, y: -height / 2, width, height }, width * 0.06);
  context.fill();
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  drawCard(context, stage.theme, card, { x: -width / 2, y: -height / 2, width, height, alpha, profile: faceFor(height), rarity });
  context.restore();
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {string} color
 * @param {{ center: Point, radius: number, strength: number }} halo `strength`: 0–1
 */
function paintHalo(context, color, { center, radius, strength }) {
  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = radialGradient(context, center, radius, [[0, withAlpha(color, 0.6 * strength)], [1, withAlpha(color, 0)]]);
  context.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  context.restore();
}

/**
 * Where the pages stand: a dot each, the current one a lit bar.
 * @param {Stage} stage
 * @param {Rect} area
 * @param {{ page: number, count: number }} pages
 */
function paintDots(stage, area, { page, count }) {
  if (count < 2) {
    return;
  }
  const { context, theme, size } = stage;
  const current = size.dot * 3.2;
  const gap = size.dot * 0.9;
  let x = area.x + (area.width - ((count - 1) * (size.dot + gap) + current)) / 2;
  const y = area.y + area.height / 2 - size.dot / 2;
  context.save();
  for (let index = 0; index < count; index += 1) {
    const lit = index === page;
    const width = lit ? current : size.dot;
    context.shadowColor = theme.colors.accent;
    context.shadowBlur = lit ? 12 : 0;
    context.fillStyle = lit ? theme.colors.accentLight : withAlpha(theme.colors.textMuted, 0.5);
    roundedRectPath(context, { x, y, width, height: size.dot }, size.dot / 2);
    context.fill();
    x += width + gap;
  }
  context.restore();
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * The sounds of a page, at their times.
 * @param {NewsPage} page
 * @param {(cardId: string) => string | null} rarityOf
 * @returns {Beat[]}
 */
function beatsOf(page, rarityOf) {
  switch (page.kind) {
    case NewsPageKind.INTRO:
      return [{ atMs: INTRO.title[0], cue: SoundCue.RARE_REVEAL, gain: 0.9 }, ...page.cardIds.map((_, index) => ({ atMs: INTRO.cards + index * INTRO.cardStep + INTRO.cardMs * 0.6, cue: SoundCue.CARD_PLACE, gain: 0.8 }))];
    case NewsPageKind.FEATURES:
      return page.items.map((_, index) => ({ atMs: FEATURE.first + index * FEATURE.step, cue: SoundCue.CARD_PICK, gain: 0.8 }));
    case NewsPageKind.CARDS:
      return page.cardIds.flatMap((cardId, index) => {
        const start = FLIP.first + index * FLIP.step;
        const rarity = rarityOf(cardId);
        return [{ atMs: start, cue: SoundCue.CARD_FLIP, gain: 0.55 }, ...(rarity !== null && BURSTING.includes(rarity) ? [{ atMs: start + FLIP.ms, cue: SoundCue.RARE_REVEAL }] : [])];
      });
    case NewsPageKind.CYCLE: {
      const arrowsFrom = WHEEL.first + page.steps.length * WHEEL.step + WHEEL.popMs * 0.5;
      return [...page.steps.map((_, index) => ({ atMs: WHEEL.first + index * WHEEL.step, cue: SoundCue.CARD_PLACE, gain: 0.7 })), ...page.steps.map((_, index) => ({ atMs: arrowsFrom + index * WHEEL.arrowStep, cue: SoundCue.TARGET_SEEK, gain: 0.5 }))];
    }
    case NewsPageKind.CHANGES:
      return page.items.flatMap((_, index) => [{ atMs: index * CHANGE.rowStep + CHANGE.card[0], cue: SoundCue.CARD_PLACE }, { atMs: index * CHANGE.rowStep + CHANGE.stamp + CHANGE.stampMs, cue: SoundCue.HIT_CREATURE }]);
    default:
      return [];
  }
}

/**
 * How far into `[start, end]` the clock is, 0–1.
 * @param {number} ms
 * @param {readonly number[]} window
 */
function progress(ms, [start, end]) {
  return Math.min(1, Math.max(0, (ms - start) / (end - start)));
}

/** @param {number} height */
function faceFor(height) {
  if (height < FACE_BELOW.mini) {
    return CardFaceProfile.MINI;
  }
  return height < FACE_BELOW.compact ? CardFaceProfile.COMPACT : CardFaceProfile.FULL;
}

/** @param {Theme} theme @param {number} pixels */
function titleFont(theme, pixels) {
  return `900 ${Math.max(1, Math.round(pixels))}px ${theme.fonts.titleFamily}`;
}

/**
 * The largest size up to `size` at which `text` fits `width` in `font` (a font string sized `size`).
 * @param {CanvasRenderingContext2D} context
 * @param {string} text
 * @param {{ font: string, size: number, width: number }} room
 */
function fitSize(context, text, { font, size, width }) {
  context.save();
  context.font = font;
  const measured = context.measureText(text).width;
  context.restore();
  return measured > width && measured > 0 ? Math.max(size * 0.5, (size * width) / measured) : size;
}

/**
 * Gold from light to dark down a line of text.
 * @param {CanvasRenderingContext2D} context
 * @param {Theme} theme
 * @param {{ top: number, size: number }} line
 */
function goldFill(context, theme, { top, size }) {
  const gold = context.createLinearGradient(0, top, 0, top + size);
  gold.addColorStop(0, "#fff6d8");
  gold.addColorStop(0.45, theme.colors.accentLight);
  gold.addColorStop(0.55, theme.colors.accent);
  gold.addColorStop(1, theme.colors.accentDark);
  return gold;
}

/**
 * A colour fading out to the right (or from the middle out both ways), for rules under titles.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number, width: number, color: string, centred?: boolean }} rule
 */
function horizontalFade(context, { x, y, width, color, centred = false }) {
  const fade = context.createLinearGradient(x, y, x + Math.max(1, width), y);
  if (centred) {
    fade.addColorStop(0, withAlpha(color, 0));
    fade.addColorStop(0.5, color);
  } else {
    fade.addColorStop(0, color);
  }
  fade.addColorStop(1, withAlpha(color, 0));
  return fade;
}

/**
 * Draws `text` letter by letter, `spacing` apart.
 * @param {CanvasRenderingContext2D} context
 * @param {string} text
 * @param {{ x: number, y: number, spacing: number }} at
 */
function drawSpaced(context, text, { x, y, spacing }) {
  let along = x;
  for (const letter of text) {
    context.fillText(letter, along, y);
    along += context.measureText(letter).width + spacing;
  }
}

/**
 * A point along the wheel's arc from `from` to `to`, bowing away from `center`.
 * @param {{ from: Point, to: Point, center: Point }} arc
 * @param {number} t 0–1
 */
function arcPoint({ from, to, center }, t) {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const away = unit({ x: mid.x - center.x, y: mid.y - center.y });
  const bow = Math.hypot(to.x - from.x, to.y - from.y) * 0.22;
  const control = { x: mid.x + away.x * bow, y: mid.y + away.y * bow };
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y };
}

/** @param {Point} vector */
function unit({ x, y }) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * The backdrop's motes, the same for a season every time (seeded by its id).
 * @param {string} seed
 * @returns {Mote[]}
 */
function motesFor(seed) {
  let state = [...seed].reduce((hash, letter) => Math.imul(hash ^ letter.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: MOTES }, () => ({ x: next(), y: next(), size: 0.8 + next() * 2.2, speed: 0.00002 + next() * 0.00005, phase: next() * Math.PI * 2, light: next() < 0.6 }));
}
