/**
 * The living air around a character on the challenges screen: particles in
 * the spirit of its faction, drawn from nothing but the time. Ember throws
 * sparks upwards, Iron sheds bright filings, Shadow breathes slow wisps,
 * Verdant lets leaves drift down, Arcane keeps motes circling.
 *
 * Every particle is a pure function of the clock and its seed (where it is
 * in its own loop), so there is no state to keep and two frames at the same
 * moment are the same picture. A faction's look is data (AURAS): a new one
 * is a new entry, not new code.
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { factionTones } from "../../theme/Theme.js";
import { withAlpha } from "../../theme/color.js";

/**
 * @typedef {"spark" | "wisp" | "leaf" | "mote"} ParticleShape
 * @typedef {Readonly<{
 *   count: number, motion: "rise" | "fall" | "orbit", sway: number, size: number, maxSize: number,
 *   period: number, maxPeriod: number, shape: ParticleShape, tone: "base" | "light",
 * }>} Aura `sway`: how far a particle wanders sideways (share of the width); `size` to `maxSize`: in pixels at a 200-pixel-tall portrait; `period` to `maxPeriod`: one loop, in ms
 */

/** @type {Readonly<Record<string, Aura>>} */
export const AURAS = Object.freeze({
  ember: Object.freeze({ count: 26, motion: "rise", sway: 0.06, size: 1.4, maxSize: 3.4, period: 1800, maxPeriod: 3600, shape: "spark", tone: "light" }),
  iron: Object.freeze({ count: 18, motion: "fall", sway: 0.03, size: 1, maxSize: 2.4, period: 1300, maxPeriod: 2600, shape: "spark", tone: "light" }),
  shadow: Object.freeze({ count: 12, motion: "rise", sway: 0.1, size: 8, maxSize: 18, period: 4200, maxPeriod: 7600, shape: "wisp", tone: "base" }),
  verdant: Object.freeze({ count: 14, motion: "fall", sway: 0.14, size: 2.6, maxSize: 5, period: 5200, maxPeriod: 9400, shape: "leaf", tone: "light" }),
  arcane: Object.freeze({ count: 18, motion: "orbit", sway: 0.04, size: 1.4, maxSize: 3, period: 3600, maxPeriod: 7200, shape: "mote", tone: "light" }),
  neutral: Object.freeze({ count: 10, motion: "rise", sway: 0.05, size: 1, maxSize: 2, period: 5000, maxPeriod: 8000, shape: "mote", tone: "light" }),
});

/** Sizes are given for a portrait this tall, and scale with it. */
const REFERENCE_HEIGHT = 200;
const TAU = Math.PI * 2;

/**
 * Paints the aura's particles over `area` (the caller clips).
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ area: import("@magic8/engine/shared/geometry.js").Rect, faction: string, timeMs: number, seed: string, intensity?: number, share?: readonly [number, number] }} aura
 *   `intensity`: 0..1, how bright (a locked opponent's air is dim); `share`: which slice of the particles to draw (a layer behind the figure, one in front)
 */
export function paintAura(context, theme, { area, faction, timeMs, seed, intensity = 1, share = [0, 1] }) {
  const style = AURAS[faction] ?? AURAS.neutral;
  const color = factionTones(theme, faction)[style.tone];
  const scale = area.height / REFERENCE_HEIGHT;
  const first = Math.floor(style.count * share[0]);
  const last = Math.floor(style.count * share[1]);
  for (let index = first; index < last; index += 1) {
    const [phase, place, size, period, wander] = unitSequence(hashString(`${seed}|${index}`), 5);
    const loop = style.period + period * (style.maxPeriod - style.period);
    const progress = (timeMs / loop + phase) % 1;
    const point = positionOf(style, area, { progress, place, wander, phase });
    const radius = (style.size + size * (style.maxSize - style.size)) * scale;
    const alpha = Math.sin(Math.PI * progress) * intensity;
    paintParticle(context, style.shape, { ...point, radius, color, alpha, turn: (phase + progress) * TAU });
  }
}

/**
 * Where a particle is in its loop.
 * @param {Aura} style
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {{ progress: number, place: number, wander: number, phase: number }} particle
 */
function positionOf(style, area, { progress, place, wander, phase }) {
  if (style.motion === "orbit") {
    const angle = (progress + phase) * TAU;
    const reach = (0.22 + 0.24 * place) * Math.min(area.width, area.height * 1.6);
    return { x: area.x + area.width / 2 + Math.cos(angle) * reach, y: area.y + area.height * 0.48 + Math.sin(angle) * reach * 0.42 };
  }
  const swing = Math.sin(progress * TAU * (1 + wander) + phase * TAU) * style.sway * area.width;
  const x = area.x + place * area.width + swing;
  const travel = progress * area.height * 1.1;
  return { x, y: style.motion === "rise" ? area.y + area.height - travel : area.y - area.height * 0.05 + travel };
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {ParticleShape} shape
 * @param {{ x: number, y: number, radius: number, color: string, alpha: number, turn: number }} particle
 */
function paintParticle(context, shape, { x, y, radius, color, alpha, turn }) {
  if (alpha <= 0.01) {
    return;
  }
  context.save();
  if (shape === "leaf") {
    context.translate(x, y);
    context.rotate(turn);
    context.fillStyle = withAlpha(color, alpha * 0.85);
    context.beginPath();
    context.ellipse(0, 0, radius * 1.8, radius * 0.8, 0, 0, TAU);
    context.fill();
  } else {
    const glow = shape === "wisp" ? 1 : 2.6;
    const halo = context.createRadialGradient(x, y, 0, x, y, radius * glow);
    halo.addColorStop(0, withAlpha(color, alpha * (shape === "wisp" ? 0.35 : 0.95)));
    halo.addColorStop(1, withAlpha(color, 0));
    context.fillStyle = halo;
    context.beginPath();
    context.arc(x, y, radius * glow, 0, TAU);
    context.fill();
  }
  context.restore();
}
