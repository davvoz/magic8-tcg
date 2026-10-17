/**
 * The ranked season on the Home screen: its jackpot (the amount, the time
 * left, the places and who holds them, JackpotPanel; a phone's narrow card
 * keeps the amount and the time left), where the player stands — their
 * season in figures where there is room (a wide screen: SeasonStats), else
 * a line — and the way to the leaderboard.
 */
import { countdownText, describeJackpot } from "../../../application/jackpot/describeJackpot.js";
import { JACKPOT_HEIGHT, JackpotPanel } from "../jackpot/JackpotPanel.js";
import { Label } from "../../ui/Label.js";
import { HomeCard } from "./HomeCard.js";
import { SeasonStats } from "./SeasonStats.js";

/** The least room the player's figures are shown in, and the gap above them. */
const STATS = Object.freeze({ least: 150, gap: 14 });

/**
 * What the card shows.
 * @typedef {Readonly<{ kind: "locked", reason: string }>
 *   | Readonly<{ kind: "open", season: string | null, jackpot: import("../../../application/ports/JackpotApi.contract.js").Jackpot | null, now: () => number, standing: string, figures?: import("../../../application/ports/RankingApi.contract.js").Standing | null }>} SeasonView
 *   `standing`: where the player stands, in a line; `figures`: their season's standing, once they play ranked in it
 */

export class SeasonCard extends HomeCard {
  /** @type {JackpotPanel | null} */
  #jackpot = null;
  /** A phone's countdown line, with what it is counted from. @type {{ label: Label, jackpot: import("../../../application/ports/JackpotApi.contract.js").Jackpot, now: () => number } | null} */
  #countdown = null;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean, view: SeasonView, canOpen: boolean, onOpen: () => void }} options
   *   `canOpen`: whether there is a leaderboard to open
   */
  constructor({ view, canOpen, onOpen, ...frame }) {
    super({ ...frame, glowKey: view.kind === "open" && view.jackpot !== null ? "accent" : null });
    const open = { id: "home.season.open", text: this.compact ? "Leaderboard" : "Open the leaderboard", onActivate: onOpen };
    if (view.kind === "locked") {
      this.addKicker("Season");
      this.addTitle("Climb the leaderboard");
      this.addText("Ranked games count for the season; the best players share its jackpot.", { lines: 3 });
      this.addActions([{ ...open, locked: true }], { note: view.reason, noteId: "home.season.note" });
      return;
    }
    this.addKicker(view.season ?? "Season");
    this.#buildJackpot(view);
    // Where the player stands: their figures where there is room for them, else a line.
    if (!this.#buildFigures(view.figures ?? null)) {
      const { inset, line, sizes } = this.metrics;
      this.add(new Label({ id: "home.season.standing", x: inset, y: Math.min(this.cursor, this.footTop - line), width: this.inner, height: line, text: view.standing, size: sizes.text, weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    }
    this.addActions([{ ...open, enabled: canOpen }]);
  }

  /**
   * The season's jackpot: whole on a wide card with room for it, its amount and time left on a phone's; without one,
   * what the season is for.
   * @param {Extract<SeasonView, { kind: "open" }>} view
   */
  #buildJackpot(view) {
    const { inset, gap } = this.metrics;
    const height = JACKPOT_HEIGHT.card;
    if (view.jackpot !== null && this.compact) {
      this.#buildPocketJackpot(view.jackpot, view.now);
    } else if (view.jackpot !== null && this.cursor + height <= this.footTop) {
      this.#jackpot = this.add(new JackpotPanel({ id: "home.season.jackpot", x: inset, y: this.cursor, width: this.inner, height, jackpot: view.jackpot, now: view.now, layout: "card" }));
      this.advance(height + gap);
    } else if (view.jackpot === null) {
      this.addTitle("Climb the leaderboard");
      this.addText("Ranked games count for the season: win them to rise.", { lines: 2 });
    }
  }

  /**
   * The player's season in figures, on a wide card with room for them.
   * @param {import("../../../application/ports/RankingApi.contract.js").Standing | null} figures
   * @returns {boolean} whether they are shown
   */
  #buildFigures(figures) {
    const room = this.footTop - this.cursor - STATS.gap - this.metrics.gap;
    if (this.compact || figures === null || room < STATS.least) {
      return false;
    }
    // In the middle of the room between the jackpot and the button.
    const height = SeasonStats.heightIn(room);
    this.add(new SeasonStats({ x: this.metrics.inset, y: this.cursor + STATS.gap + (room - height) / 2, width: this.inner, height, standing: figures }));
    return true;
  }

  /**
   * The jackpot on a phone's narrow card: its amount, and the time the season has left.
   * @param {import("../../../application/ports/JackpotApi.contract.js").Jackpot} jackpot
   * @param {() => number} now
   */
  #buildPocketJackpot(jackpot, now) {
    const { inset, line, gap, sizes } = this.metrics;
    const text = describeJackpot(jackpot, now());
    this.add(new Label({ x: inset, y: this.cursor, width: this.inner, height: line, text: "Jackpot", size: sizes.text, colorKey: "textMuted", align: "left" }));
    this.advance(line);
    this.addTitle(text.amount, { id: "home.season.jackpot" });
    const label = this.add(new Label({ x: inset, y: this.cursor, width: this.inner, height: line, text: text.countdown, size: sizes.text, colorKey: "text", align: "left", fit: true }));
    this.advance(line + gap);
    this.#countdown = { label, jackpot, now };
  }

  /** Moves the jackpot's countdown on. @returns {boolean} whether it needs drawing again */
  tick() {
    const countdown = this.#countdown;
    if (countdown !== null) {
      const text = countdownText(countdown.jackpot, countdown.now());
      const changed = text !== countdown.label.text;
      countdown.label.text = text;
      return changed;
    }
    return this.#jackpot?.tick() ?? false;
  }
}
