/**
 * Which three opponents a day brings (docs/tcg/24-sfide.md): two characters
 * and a boss, the same for every player, so a day's boss is something
 * players can talk about. The pick is a pure function of the date and the
 * roster: every server process agrees without storing anything, and any
 * past or future day's schedule can be told.
 *
 * Each list goes round in turns (Rotation): every character is met once
 * before any is met again, in an order shuffled anew each round, and no
 * opponent comes back the day after (with enough of them to choose from).
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { startOf } from "./dailyDay.js";

/** @typedef {import("./DailyRoster.js").Opponent} Opponent */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hands out a list's items a group a day: in rounds that each go through
 * the whole list in a shuffled order, so no item comes back before the rest
 * have had their turn. Where one round ends and the next begins, the new
 * round's first group is kept clear of the last group of the round before
 * (by swapping with the next group, which needs at least three groups).
 * @template {{ id: string }} T
 */
export class Rotation {
  #items;
  #size;
  #salt;

  /**
   * @param {readonly T[]} items
   * @param {number} size items a day
   * @param {string} salt sets the shuffles
   */
  constructor(items, size, salt) {
    if (items.length < size) {
      throw new RangeError(`a rotation of ${size} a day needs at least ${size} items`);
    }
    this.#items = items;
    this.#size = size;
    this.#salt = salt;
  }

  /**
   * @param {number} index the day's number (days since 1970-01-01)
   * @returns {readonly T[]}
   */
  groupOn(index) {
    const perRound = Math.floor(this.#items.length / this.#size);
    const round = Math.floor(index / perRound);
    const slot = index % perRound;
    return Object.freeze(this.#orderOf(round).slice(slot * this.#size, (slot + 1) * this.#size));
  }

  /** @param {number} round */
  #orderOf(round) {
    const order = this.#shuffled(round);
    if (round === 0) {
      return order;
    }
    const perRound = Math.floor(this.#items.length / this.#size);
    const before = this.#shuffled(round - 1).slice((perRound - 1) * this.#size, perRound * this.#size);
    const met = (item) => before.some((other) => other.id === item.id);
    for (let index = 0; index < this.#size; index += 1) {
      if (!met(order[index])) {
        continue;
      }
      const swap = order.findIndex((item, position) => position >= this.#size && position < 2 * this.#size && !met(item));
      if (swap !== -1) {
        [order[index], order[swap]] = [order[swap], order[index]];
      }
    }
    return order;
  }

  /** @param {number} round */
  #shuffled(round) {
    const order = [...this.#items];
    const units = unitSequence(hashString(`${this.#salt}|${round}`), order.length);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const other = Math.floor(units[index] * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    return order;
  }
}

export class DailySchedule {
  #characters;
  #bosses;

  /**
   * @param {import("./DailyRoster.js").DailyRoster} roster
   * @param {string} [salt] changes every day's pick (a new season of challenges, say)
   */
  constructor(roster, salt = "") {
    this.#characters = new Rotation(roster.characters, 2, `${salt}|characters`);
    this.#bosses = new Rotation(roster.bosses, 1, `${salt}|bosses`);
  }

  /**
   * @param {string} day "YYYY-MM-DD", UTC
   * @returns {readonly Opponent[]} the two characters, then the boss
   */
  forDay(day) {
    const index = Math.floor(startOf(day) / DAY_MS);
    return Object.freeze([...this.#characters.groupOn(index), ...this.#bosses.groupOn(index)]);
  }
}
