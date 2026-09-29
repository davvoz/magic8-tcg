/**
 * The crosshair of a random discard. Which cards go is decided by the
 * engine, not by the caster, so the aim is shown as a draw: a crosshair
 * hops from card to card across the hand, quick at first and slowing down,
 * and comes to rest on a card that is going — which locks — then sets off
 * again for the next one, until every card that goes is locked.
 *
 * It lands where it must because it is told where from the start: the
 * cards are known before the aim is shown (StepBeats hands the board what a
 * beat announces together with what it will do). The hops in between only
 * look random: they come from a seed, so the same cast always plays the same
 * way.
 *
 * Presentation state only, and pure: `at(elapsedMs)` says where the
 * crosshair is and what has locked at any moment, and the cast or flare
 * that carries it feeds the time.
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { Easing } from "../animation/Tween.js";

/**
 * @typedef {Readonly<{ x: number, y: number }>} Point
 * @typedef {Readonly<{ from: number, to: number, startMs: number, durationMs: number }>} Hop indices into the candidates
 */

/** Hops before the crosshair settles on the first card, and on each after it. */
const HOPS = Object.freeze({ first: 8, next: 5 });
/** A hop's length: the first ones quick, the last ones slow, as multiples of the short duration. */
const HOP_SHORT = Object.freeze({ fastest: 0.7, slowest: 2.8 });
/** How long the crosshair takes to slide over to the next card, at most, as a multiple of the short duration. */
const SLIDE_SHORT = 0.75;
/** How long a locked card holds the crosshair before it sets off for the next, as a multiple of the medium duration. */
const LOCK_MEDIUM = 1.2;
/** Random numbers drawn for the hops: more than any roulette uses. */
const DRAWS = 128;

export class TargetRoulette {
  /** @type {readonly Point[]} */
  #candidates;
  /** @type {readonly number[]} */
  #picks;
  /** @type {readonly Hop[]} */
  #hops;
  /** When each pick locks, in order. @type {readonly number[]} */
  #locksAt;
  #durationMs;
  #slideMs;

  /**
   * @param {{ candidates: readonly Point[], picks: readonly number[], seed: string, animation: Readonly<Record<string, number>> }} options
   *   `candidates`: every card the crosshair may pass over; `picks`: the
   *   indices of those it must end on, in the order they lock; `seed`: what
   *   the hops in between are drawn from
   */
  constructor({ candidates, picks, seed, animation }) {
    this.#candidates = candidates;
    this.#picks = picks;
    this.#slideMs = animation.shortMs * SLIDE_SHORT;
    const draws = unitSequence(hashString(seed), DRAWS);
    let draw = 0;
    const next = () => draws[draw++ % DRAWS];
    /** @type {Hop[]} */
    const hops = [];
    /** @type {number[]} */
    const locksAt = [];
    let current = Math.floor(next() * candidates.length);
    let time = 0;
    picks.forEach((pick, index) => {
      const count = index === 0 ? HOPS.first : HOPS.next;
      for (let hop = 0; hop < count; hop += 1) {
        const to = hop === count - 1 ? pick : elsewhere(current, candidates.length, next());
        const slowing = (hop / (count - 1)) ** 2;
        const durationMs = animation.shortMs * (HOP_SHORT.fastest + (HOP_SHORT.slowest - HOP_SHORT.fastest) * slowing);
        hops.push(Object.freeze({ from: current, to, startMs: time, durationMs }));
        time += durationMs;
        current = to;
      }
      locksAt.push(time);
      time += animation.mediumMs * LOCK_MEDIUM;
    });
    this.#hops = Object.freeze(hops);
    this.#locksAt = Object.freeze(locksAt);
    this.#durationMs = time;
  }

  /** How long the draw takes, from the first hop to the last card held. */
  get durationMs() {
    return this.#durationMs;
  }

  /** @returns {readonly Point[]} where the cards the crosshair ends on stand, in the order they lock */
  get picked() {
    return this.#picks.map((index) => this.#candidates[index]);
  }

  /**
   * @param {number} elapsedMs time since the crosshair appeared
   * @returns {{ point: Point, locked: readonly Point[] }} where the crosshair is, and the cards locked so far
   */
  at(elapsedMs) {
    const time = Math.max(0, elapsedMs);
    const locked = this.picked.filter((_, index) => this.#locksAt[index] <= time);
    const hop = this.#hops.findLast((candidate) => candidate.startMs <= time) ?? this.#hops[0];
    if (hop === undefined) {
      return { point: this.#candidates[0] ?? { x: 0, y: 0 }, locked };
    }
    const from = this.#candidates[hop.from];
    const to = this.#candidates[hop.to];
    const slid = Easing.easeOutCubic(Math.min(1, (time - hop.startMs) / Math.min(this.#slideMs, hop.durationMs)));
    return { point: { x: from.x + (to.x - from.x) * slid, y: from.y + (to.y - from.y) * slid }, locked };
  }
}

/**
 * The stage of a cast's or a flare's timeline in which a random discard's
 * crosshair draws its cards: `seek` runs 0 → 1 in step with the draw. None
 * without a roulette.
 * @template {{ seek: number }} T
 * @param {T} sought the frame once the draw is over
 * @param {TargetRoulette | null} roulette
 * @returns {{ to: T, durationMs: number, easing: (t: number) => number }[]}
 */
export function withSeek(sought, roulette) {
  return roulette === null ? [] : [{ to: sought, durationMs: roulette.durationMs, easing: Easing.linear }];
}

/**
 * Another card than `current`, drawn from `unit` in [0, 1); the same one when it is the only one.
 * @param {number} current
 * @param {number} count
 * @param {number} unit
 */
function elsewhere(current, count, unit) {
  if (count <= 1) {
    return current;
  }
  const step = 1 + Math.floor(unit * (count - 1));
  return (current + step) % count;
}
