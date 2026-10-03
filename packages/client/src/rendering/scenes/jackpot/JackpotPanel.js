/**
 * The season's jackpot, lit in gold: the amount in large type, the time the
 * season has left (ticking to the second), where the money comes from and
 * how much it has grown, and the three paying places with their share,
 * their amount and who holds them now (who won them, once settled).
 *
 * Three layouts: `card` stacks everything (beside the menu's buttons),
 * `wide` puts the places beside the amount (across the leaderboard), and
 * `banner` fits it all in three lines (a phone's screen). Built from the
 * usual widgets; `tick()` rewrites the countdown when its second changes.
 */
import { describeJackpot } from "../../../application/jackpot/describeJackpot.js";
import { Label } from "../../ui/Label.js";
import { Panel, SMALL_PANEL_INSET } from "../../ui/Panel.js";

/** @typedef {"card" | "wide" | "banner"} JackpotLayout */

/** Heights each layout needs (the scenes size the panel with them). */
export const JACKPOT_HEIGHT = Object.freeze({ card: 276, wide: 172, banner: 76 });

const PAD = SMALL_PANEL_INSET;
/** The stacked text block: title, amount, countdown, source, growth. */
const INFO = Object.freeze({ title: { y: 12, height: 22 }, amount: { y: 34, height: 44 }, countdown: { y: 80, height: 26 }, source: { y: 108, height: 18 }, growth: { y: 126, height: 18 } });
const PLACE = Object.freeze({ height: 36, label: 96, amount: 160 });

export class JackpotPanel extends Panel {
  #jackpot;
  #now;
  #layout;
  /** @type {Label | null} */
  #countdown = null;
  /** The countdown's line as last written. */
  #shown = "";

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, jackpot: import("../../../application/ports/JackpotApi.contract.js").Jackpot, now: () => number, layout: JackpotLayout, onActivate?: (() => void) | null }} options
   */
  constructor({ id = "jackpot", x, y, width, height, jackpot, now, layout, onActivate = null }) {
    super({ id, x, y, width, height, glowKey: "accent", smallCorners: true, onActivate });
    this.#jackpot = jackpot;
    this.#now = now;
    this.#layout = layout;
    const text = describeJackpot(jackpot, now());
    if (layout === "banner") {
      this.#buildBanner(text);
    } else {
      this.#buildInfo(text, layout === "wide" ? Math.round(width * 0.42) : width - 2 * PAD);
      this.#buildPlaces(text, layout === "wide" ? { x: Math.round(width * 0.42) + 2 * PAD, y: Math.round((height - text.places.length * PLACE.height) / 2) + 3, width: width - Math.round(width * 0.42) - 3 * PAD } : { x: PAD, y: INFO.growth.y + INFO.growth.height + 8, width: width - 2 * PAD });
    }
    this.#shown = this.#countdownLine(text);
  }

  /**
   * Rewrites the countdown when the second it shows has changed.
   * @returns {boolean} whether the panel needs drawing again
   */
  tick() {
    if (this.#countdown === null) {
      return false;
    }
    const line = this.#countdownLine(describeJackpot(this.#jackpot, this.#now()));
    if (line === this.#shown) {
      return false;
    }
    this.#shown = line;
    this.#countdown.text = line;
    return true;
  }

  /** @param {import("../../../application/jackpot/describeJackpot.js").JackpotText} text */
  #countdownLine(text) {
    if (this.#layout !== "banner") {
      return text.countdown;
    }
    return `${text.countdown} · ${text.growth ?? text.pitch}`;
  }

  /**
   * @param {import("../../../application/jackpot/describeJackpot.js").JackpotText} text
   * @param {number} width
   */
  #buildInfo(text, width) {
    const line = (/** @type {{ y: number, height: number }} */ at, /** @type {Partial<ConstructorParameters<typeof Label>[0]> & { text: string }} */ options) =>
      this.add(new Label({ x: PAD, y: at.y, width, height: at.height, align: "left", fit: true, ...options }));
    line(INFO.title, { id: "jackpot.title", text: text.title.toUpperCase(), size: "small", weight: "bold", colorKey: "accent" });
    line(INFO.amount, { id: "jackpot.amount", text: text.amount, size: "heading", weight: "bold", colorKey: "accentLight", glow: true });
    this.#countdown = line(INFO.countdown, { id: "jackpot.countdown", text: text.countdown, size: "body", weight: "bold", colorKey: "text" });
    line(INFO.source, { id: "jackpot.source", text: text.source, size: "tiny", colorKey: "textMuted" });
    if (text.growth !== null) {
      line(INFO.growth, { id: "jackpot.growth", text: text.growth, size: "tiny", weight: "bold", colorKey: "success" });
    }
  }

  /**
   * One row per paying place: its rank and share, who holds it, what it wins.
   * @param {import("../../../application/jackpot/describeJackpot.js").JackpotText} text
   * @param {{ x: number, y: number, width: number }} area
   */
  #buildPlaces(text, area) {
    const holderWidth = area.width - PLACE.label - PLACE.amount;
    text.places.forEach((place, index) => {
      const y = area.y + index * PLACE.height;
      const holder = place.note === "" ? place.holder : `${place.holder} · ${place.note}`;
      this.add(new Label({ id: `jackpot.place.${index + 1}`, x: area.x, y, width: PLACE.label, height: PLACE.height - 6, text: `${place.label} · ${place.share}`, size: "small", weight: "bold", colorKey: "accent", align: "left" }));
      this.add(new Label({ x: area.x + PLACE.label, y, width: holderWidth, height: PLACE.height - 6, text: holder, size: "small", colorKey: place.account === null ? "textMuted" : "text", align: "left", fit: true, avatar: place.account }));
      this.add(new Label({ id: `jackpot.amount.${index + 1}`, x: area.x + PLACE.label + holderWidth, y, width: PLACE.amount, height: PLACE.height - 6, text: place.amount, size: "small", weight: "bold", colorKey: "accentLight", align: "right", fit: true }));
    });
  }

  /**
   * Three lines: the amount, the countdown (with the growth or the source), the places.
   * @param {import("../../../application/jackpot/describeJackpot.js").JackpotText} text
   */
  #buildBanner(text) {
    const width = this.width - 2 * PAD;
    this.add(new Label({ id: "jackpot.amount", x: PAD, y: 6, width, height: 26, text: `${text.title}: ${text.amount}`, size: "body", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    this.#countdown = this.add(new Label({ id: "jackpot.countdown", x: PAD, y: 32, width, height: 20, text: this.#countdownLine(text), size: "small", colorKey: "text", align: "left", fit: true }));
    const holder = (/** @type {{ account: string | null }} */ place) => (place.account === null ? [] : ["@" + place.account]);
    const places = text.places.map((place) => [place.label, place.share, place.figure, ...holder(place)].join(" ")).join(" · ") + " " + text.asset;
    this.add(new Label({ id: "jackpot.places", x: PAD, y: 52, width, height: 18, text: places, size: "tiny", weight: "bold", colorKey: "accent", align: "left", fit: true }));
  }
}
