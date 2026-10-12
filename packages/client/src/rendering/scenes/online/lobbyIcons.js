/**
 * The lobby's pictograms, drawn rather than typed: a fan of cards (casual
 * play), crossed swords (a game),
 * a trophy (the season's prize), a heap of coins (the jackpot) and a padlock
 * (ranked play not open yet), and the enamelled badge they sit on. Swords
 * and trophy are shaded as metal (steel blades, gilt hilts and cup) with a
 * dark outline that keeps them legible at the size of a tab. Paths in
 * logical units; every colour comes from the caller.
 */
import { mix, withAlpha } from "../../theme/color.js";
import { roundedRectPath } from "../../ui/drawing.js";
import { starPath } from "../../ui/shapes.js";

/**
 * @typedef {import("../../ui/shapes.js").Point} Point
 * @typedef {Readonly<{ base: string, light: string, dark: string }>} Tone
 * @typedef {Readonly<{ steel: Tone, gold: Tone, grip: string, outline: string }>} Metals the pictograms' materials
 */

/** The lobby's two ways to play. */
export const PlayKind = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });

/**
 * The colours of a way to play: casual in the cool blue of the theme's focus, ranked in its gold.
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {string} kind one of PlayKind
 * @returns {Tone}
 */
export function playTone(theme, kind) {
  const { accent, accentLight, accentDark, resource, focus, panelDark } = theme.colors;
  return kind === PlayKind.RANKED ? { base: accent, light: accentLight, dark: accentDark } : { base: resource, light: focus, dark: mix(resource, panelDark, 0.7) };
}

/**
 * The pictograms' materials from the theme: steel from its text greys, gilt from its gold, a dark leather grip.
 * @param {import("../../theme/Theme.js").Theme} theme
 * @returns {Metals}
 */
export function iconMetals(theme) {
  const { text, textMuted, panelBorder, accent, accentLight, accentDark, letterbox } = theme.colors;
  return {
    steel: { light: text, base: mix(text, textMuted, 0.55), dark: mix(textMuted, panelBorder, 0.5) },
    gold: { light: accentLight, base: accent, dark: accentDark },
    grip: mix(accentDark, letterbox, 0.55),
    outline: mix(letterbox, panelBorder, 0.25),
  };
}

/** The fan of cards: each card's height and width (in the fan's size), how far the outer ones lean, the pivot below the middle. */
const FAN = Object.freeze({ height: 0.68, aspect: 0.68, lean: 0.52, pivot: 0.5 });

/**
 * Three cards fanned out from a point under them, backs up: in the tone, framed in gilt, a gilt diamond in the middle.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size overall height
 * @param {{ tone: Tone, metals: Metals }} style
 */
export function drawCardFan(context, center, size, { tone, metals }) {
  const height = size * FAN.height;
  const width = height * FAN.aspect;
  const pivot = { x: center.x, y: center.y + size * FAN.pivot };
  for (const lean of [-FAN.lean, FAN.lean, 0]) {
    context.save();
    context.translate(pivot.x, pivot.y);
    context.rotate(lean);
    drawCardBack(context, { x: -width / 2, y: -size * FAN.pivot - height / 2, width, height }, { tone, metals });
    context.restore();
  }
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number, width: number, height: number }} card
 * @param {{ tone: Tone, metals: Metals }} style
 */
function drawCardBack(context, card, { tone, metals }) {
  const { gold, outline } = metals;
  const radius = card.width * 0.14;
  roundedRectPath(context, card, radius);
  const back = context.createLinearGradient(card.x, card.y, card.x + card.width, card.y + card.height);
  back.addColorStop(0, tone.light);
  back.addColorStop(0.45, tone.base);
  back.addColorStop(1, tone.dark);
  context.fillStyle = back;
  context.fill();
  context.lineWidth = Math.max(1, card.width * 0.07);
  context.strokeStyle = outline;
  context.stroke();
  const inset = card.width * 0.14;
  roundedRectPath(context, { x: card.x + inset, y: card.y + inset, width: card.width - 2 * inset, height: card.height - 2 * inset }, radius * 0.5);
  context.lineWidth = Math.max(0.75, card.width * 0.05);
  context.strokeStyle = gold.base;
  context.stroke();
  const middle = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  const reach = card.width * 0.2;
  context.beginPath();
  context.moveTo(middle.x, middle.y - reach * 1.4);
  context.lineTo(middle.x + reach, middle.y);
  context.lineTo(middle.x, middle.y + reach * 1.4);
  context.lineTo(middle.x - reach, middle.y);
  context.closePath();
  context.fillStyle = gilt(context, { top: middle.y - reach * 1.4, height: reach * 2.8 }, gold);
  context.fill();
  context.lineWidth = Math.max(0.5, card.width * 0.03);
  context.strokeStyle = gold.dark;
  context.stroke();
}

/** A sword's parts, in its lengths: the blade's width, where its point ends, where the guard sits, the guard, grip and pommel. */
const SWORD = Object.freeze({ blade: 0.14, point: 0.2, guard: 0.18, guardWidth: 0.46, guardHeight: 0.08, grip: 0.085, pommel: 0.07 });
/** How far each of the crossed swords leans from upright (radians). */
const CROSS = 0.62;

/**
 * Two swords crossed, their points up and their hilts apart.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size overall height
 * @param {Metals} metals
 */
export function drawCrossedSwords(context, center, size, metals) {
  const length = size / Math.cos(CROSS);
  for (const lean of [CROSS, -CROSS]) {
    context.save();
    context.translate(center.x, center.y);
    context.rotate(lean);
    drawSword(context, length, metals);
    context.restore();
  }
}

/**
 * One sword, point up, centred on the origin: a bevelled steel blade, a gilt crossguard and pommel, a dark grip.
 * @param {CanvasRenderingContext2D} context
 * @param {number} length
 * @param {Metals} metals
 */
function drawSword(context, length, { steel, gold, grip, outline }) {
  const half = length / 2;
  const width = length * SWORD.blade;
  const guard = length * SWORD.guard;
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, length * 0.035);
  context.strokeStyle = outline;
  // The blade: lit on one bevel, shaded on the other.
  context.beginPath();
  context.moveTo(0, -half);
  context.lineTo(width / 2, -half + length * SWORD.point);
  context.lineTo(width / 2, guard);
  context.lineTo(-width / 2, guard);
  context.lineTo(-width / 2, -half + length * SWORD.point);
  context.closePath();
  const bevel = context.createLinearGradient(-width / 2, 0, width / 2, 0);
  bevel.addColorStop(0, steel.base);
  bevel.addColorStop(0.45, steel.light);
  bevel.addColorStop(0.55, steel.dark);
  bevel.addColorStop(1, steel.base);
  context.fillStyle = bevel;
  context.fill();
  context.stroke();
  // The grip, then the guard over its top, then the pommel at its end.
  const gripTop = guard + length * SWORD.guardHeight;
  const pommel = { y: half - length * SWORD.pommel, radius: length * SWORD.pommel };
  context.beginPath();
  context.rect((-length * SWORD.grip) / 2, gripTop, length * SWORD.grip, pommel.y - gripTop);
  context.fillStyle = grip;
  context.fill();
  context.stroke();
  const guardWidth = length * SWORD.guardWidth;
  const guardHeight = length * SWORD.guardHeight;
  roundedRectPath(context, { x: -guardWidth / 2, y: guard, width: guardWidth, height: guardHeight }, guardHeight / 2);
  context.fillStyle = gilt(context, { top: guard, height: guardHeight }, gold);
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(0, pommel.y, pommel.radius, 0, Math.PI * 2);
  context.fillStyle = gilt(context, { top: pommel.y - pommel.radius, height: 2 * pommel.radius }, gold);
  context.fill();
  context.stroke();
}

/**
 * Gilt lit from above: light at the top, the gold, dark at the foot.
 * @param {CanvasRenderingContext2D} context
 * @param {{ top: number, height: number }} span
 * @param {Tone} gold
 */
function gilt(context, { top, height }, gold) {
  const shine = context.createLinearGradient(0, top, 0, top + height);
  shine.addColorStop(0, gold.light);
  shine.addColorStop(0.5, gold.base);
  shine.addColorStop(1, gold.dark);
  return shine;
}

/** The trophy's parts, in its heights: the cup's rim and half-width, where the cup ends, the stem, the foot and the plinth. */
const CUP = Object.freeze({ rim: -0.42, half: 0.31, bottom: 0.1, stem: 0.05, foot: 0.27, footHalf: 0.19, plinth: 0.36, plinthHalf: 0.27, end: 0.47 });

/**
 * A gilt cup on a stem, two handles, a stepped plinth, a star on its face.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size overall height
 * @param {Metals} metals
 */
export function drawTrophy(context, center, size, { gold, outline }) {
  const s = size;
  context.save();
  context.translate(center.x, center.y);
  context.lineJoin = "round";
  context.lineCap = "round";
  // Gilt shaded across: dark at the edges, lit left of the middle.
  const metal = context.createLinearGradient(-CUP.half * s, 0, CUP.half * s, 0);
  metal.addColorStop(0, gold.dark);
  metal.addColorStop(0.32, gold.light);
  metal.addColorStop(0.6, gold.base);
  metal.addColorStop(1, gold.dark);
  // The handles, behind the cup: an outline, then the gold inside it.
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(side * 0.24 * s, -0.36 * s);
    context.bezierCurveTo(side * 0.56 * s, -0.4 * s, side * 0.52 * s, 0.02 * s, side * 0.1 * s, 0.04 * s);
    context.strokeStyle = outline;
    context.lineWidth = Math.max(2, s * 0.12);
    context.stroke();
    context.strokeStyle = gold.base;
    context.lineWidth = Math.max(1, s * 0.06);
    context.stroke();
  }
  context.lineWidth = Math.max(1, s * 0.035);
  context.strokeStyle = outline;
  context.fillStyle = metal;
  // The cup.
  context.beginPath();
  context.moveTo(-CUP.half * s, CUP.rim * s);
  context.lineTo(CUP.half * s, CUP.rim * s);
  context.bezierCurveTo(CUP.half * s, -0.05 * s, 0.16 * s, 0.08 * s, CUP.stem * s, CUP.bottom * s);
  context.lineTo(-CUP.stem * s, CUP.bottom * s);
  context.bezierCurveTo(-0.16 * s, 0.08 * s, -CUP.half * s, -0.05 * s, -CUP.half * s, CUP.rim * s);
  context.closePath();
  context.fill();
  context.stroke();
  // Its mouth, seen from a little above.
  context.beginPath();
  context.ellipse(0, CUP.rim * s, CUP.half * s, 0.055 * s, 0, 0, Math.PI * 2);
  context.fillStyle = gold.dark;
  context.fill();
  context.stroke();
  // Stem, foot and plinth.
  context.fillStyle = metal;
  context.beginPath();
  context.rect(-CUP.stem * s, CUP.bottom * s, 2 * CUP.stem * s, (CUP.foot - CUP.bottom) * s);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(-CUP.stem * 2 * s, CUP.foot * s);
  context.lineTo(CUP.stem * 2 * s, CUP.foot * s);
  context.lineTo(CUP.footHalf * s, CUP.plinth * s);
  context.lineTo(-CUP.footHalf * s, CUP.plinth * s);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.rect(-CUP.plinthHalf * s, CUP.plinth * s, 2 * CUP.plinthHalf * s, (CUP.end - CUP.plinth) * s);
  context.fill();
  context.stroke();
  // A star on the cup's face, and a glint down its left side.
  starPath(context, { x: 0, y: -0.2 * s }, 0.1 * s, { points: 5 });
  context.fillStyle = gold.light;
  context.fill();
  context.lineWidth = Math.max(0.75, s * 0.02);
  context.strokeStyle = gold.dark;
  context.stroke();
  context.beginPath();
  context.moveTo(-0.22 * s, -0.33 * s);
  context.quadraticCurveTo(-0.22 * s, -0.08 * s, -0.08 * s, 0.03 * s);
  context.strokeStyle = withAlpha("#ffffff", 0.55);
  context.lineWidth = Math.max(1, s * 0.035);
  context.stroke();
  context.restore();
}

/**
 * A low heap of coins seen from the side: stacks of discs, the top face of each lit.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center the middle of the heap's base
 * @param {number} width
 * @param {{ fill: string, rim: string, shine: string }} style
 */
export function drawCoinHeap(context, center, width, { fill, rim, shine }) {
  const coin = { rx: width * 0.17, ry: width * 0.06, step: width * 0.055 };
  /** Each stack: its offset across the heap (in widths) and how many coins it holds. */
  const stacks = [
    { x: -0.3, coins: 2 },
    { x: 0.3, coins: 3 },
    { x: 0, coins: 4 },
  ];
  context.save();
  context.lineWidth = Math.max(0.75, width * 0.012);
  for (const stack of stacks) {
    const x = center.x + stack.x * width;
    for (let index = 0; index < stack.coins; index += 1) {
      const y = center.y - coin.ry - index * coin.step;
      context.beginPath();
      context.ellipse(x, y + coin.step * 0.5, coin.rx, coin.ry, 0, 0, Math.PI);
      context.lineTo(x - coin.rx, y);
      context.ellipse(x, y, coin.rx, coin.ry, 0, Math.PI, 0, true);
      context.closePath();
      context.fillStyle = mix(fill, rim, 0.35);
      context.fill();
      context.strokeStyle = rim;
      context.stroke();
      context.beginPath();
      context.ellipse(x, y, coin.rx, coin.ry, 0, 0, Math.PI * 2);
      context.fillStyle = index === stack.coins - 1 ? shine : fill;
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

/**
 * A closed padlock.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size overall height
 * @param {{ fill: string, rim: string }} style
 */
export function drawPadlock(context, center, size, { fill, rim }) {
  const body = { width: size * 0.78, height: size * 0.56 };
  const top = center.y - size / 2;
  context.save();
  context.lineWidth = Math.max(1.5, size * 0.12);
  context.strokeStyle = rim;
  context.beginPath();
  context.arc(center.x, top + size * 0.32, size * 0.24, Math.PI, 0);
  context.lineTo(center.x + size * 0.24, top + size * 0.46);
  context.moveTo(center.x - size * 0.24, top + size * 0.46);
  context.lineTo(center.x - size * 0.24, top + size * 0.32);
  context.stroke();
  context.beginPath();
  context.rect(center.x - body.width / 2, center.y + size / 2 - body.height, body.width, body.height);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = Math.max(1, size * 0.06);
  context.stroke();
  context.beginPath();
  context.arc(center.x, center.y + size / 2 - body.height * 0.55, size * 0.07, 0, Math.PI * 2);
  context.fillStyle = rim;
  context.fill();
  context.restore();
}

/**
 * An enamelled badge in a tone: a ring of metal in the tone, lit from the top left, around a dark enamel face the
 * pictograms stand out on.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} radius
 * @param {{ tone: Tone, shadow: string, lit?: boolean }} style `lit`: in the tone's full colour, else dim (a choice not taken)
 */
export function drawMedallion(context, center, radius, { tone, shadow, lit = true }) {
  const enamel = radius * 0.8;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  const ring = context.createLinearGradient(center.x - radius, center.y - radius, center.x + radius, center.y + radius);
  ring.addColorStop(0, lit ? tone.light : mix(tone.base, shadow, 0.35));
  ring.addColorStop(0.5, lit ? tone.base : mix(tone.base, shadow, 0.55));
  ring.addColorStop(1, mix(tone.dark, shadow, 0.3));
  context.shadowColor = withAlpha(shadow, 0.6);
  context.shadowBlur = radius * 0.4;
  context.fillStyle = ring;
  context.fill();
  context.shadowBlur = 0;
  context.beginPath();
  context.arc(center.x, center.y, enamel, 0, Math.PI * 2);
  const face = context.createRadialGradient(center.x - enamel * 0.3, center.y - enamel * 0.35, enamel * 0.1, center.x, center.y, enamel);
  face.addColorStop(0, mix(tone.dark, tone.base, lit ? 0.35 : 0.15));
  face.addColorStop(1, mix(tone.dark, shadow, 0.55));
  context.fillStyle = face;
  context.fill();
  context.lineWidth = Math.max(1, radius * 0.06);
  context.strokeStyle = mix(tone.dark, shadow, 0.4);
  context.stroke();
  context.restore();
}
