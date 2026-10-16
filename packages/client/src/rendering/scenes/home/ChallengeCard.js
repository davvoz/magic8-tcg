/**
 * Today's challenge on the Home screen: the opponent to beat next, in their
 * living portrait, and Fight (which opens the challenges). Once the day's
 * three are beaten, when new ones come; signed out or offline, the
 * challenges locked with the reason. Whatever the day, a character's
 * portrait fills the card: the next opponent, the day's boss once it is
 * won, the Archmage (veiled) before the day is known (PlayViews.challenger).
 */
import { CharacterPortrait } from "../daily/CharacterPortrait.js";
import { Label } from "../../ui/Label.js";
import { HomeCard } from "./HomeCard.js";

/**
 * What the card shows.
 * @typedef {Readonly<{ kind: "locked", reason: string }>
 *   | Readonly<{ kind: "waiting", text: string }>
 *   | Readonly<{ kind: "next", opponent: import("../../../application/ports/DailyApi.contract.js").DailyOpponent, stage: number }>
 *   | Readonly<{ kind: "done", renewsIn: string }>} ChallengeView
 *   `waiting`: the day not read yet (or not readable): Fight still opens the challenges, which say more
 */

/** A phone's portrait: the figure beside the name, at most this tall. */
const COMPACT_PORTRAIT = 110;
/** The least room a portrait is worth showing in, wide and on a phone. */
const MIN_PORTRAIT = Object.freeze({ wide: 90, compact: 48 });

export class ChallengeCard extends HomeCard {
  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean, view: ChallengeView, challenger: import("../daily/CharacterPortrait.js").PortraitCharacter, primary: boolean, clock: () => number, onFight: () => void }} options
   *   `challenger`: who stands for the day when there is no opponent to fight next; `primary`: Fight is the screen's gold button
   */
  constructor({ view, challenger, primary, clock, onFight, ...frame }) {
    super({ ...frame, glowKey: view.kind === "next" && primary ? "focus" : null });
    this.addKicker("Today's challenge", "focus");
    const fight = { id: "home.challenge.fight", onActivate: onFight, variant: /** @type {import("../../ui/Button.js").ButtonVariant} */ (primary ? "primary" : "secondary") };
    switch (view.kind) {
      case "locked":
        this.addTitle("Three opponents a day");
        this.addText("Beat all three to win a pack of cards.");
        this.#buildChallenger(challenger, clock);
        this.addActions([{ ...fight, text: "Fight", locked: true }], { note: view.reason, noteId: "home.challenge.note" });
        return;
      case "waiting":
        this.addTitle("Three opponents a day");
        this.addText(view.text);
        this.#buildChallenger(challenger, clock);
        this.addActions([{ ...fight, text: "See the challenges" }]);
        return;
      case "done":
        this.addTitle("All three beaten today", { colorKey: "success" });
        this.addText("Your pack of cards is in your collection.");
        this.#buildChallenger(challenger, clock);
        this.addActions([{ ...fight, text: "See the challenges", variant: "secondary" }], { note: `New opponents in ${view.renewsIn}.` });
        return;
      default:
        this.#buildOpponent(view.opponent, clock);
        this.addActions([{ ...fight, text: "Fight" }], { note: view.opponent.boss ? "The boss of the day: win to take the pack." : `Challenge ${view.stage + 1} of 3 · win all three for a pack.`, noteId: "home.challenge.note" });
    }
  }

  /**
   * The character standing for the day, in the room left under the words.
   * @param {import("../daily/CharacterPortrait.js").PortraitCharacter} character
   * @param {() => number} clock
   */
  #buildChallenger(character, clock) {
    const room = this.takePictureRoom(this.compact ? MIN_PORTRAIT.compact : MIN_PORTRAIT.wide);
    if (room !== null) {
      this.add(new CharacterPortrait({ id: "home.challenge.portrait", ...room, character, layout: "stacked", clock }));
    }
  }

  /**
   * @param {import("../../../application/ports/DailyApi.contract.js").DailyOpponent} opponent
   * @param {() => number} clock
   */
  #buildOpponent(opponent, clock) {
    const { inset, title, line, gap, sizes } = this.metrics;
    if (this.compact) {
      const height = Math.min(COMPACT_PORTRAIT, this.footTop - this.cursor - gap);
      const portrait = this.add(new CharacterPortrait({ id: "home.challenge.portrait", x: inset, y: this.cursor, width: this.inner, height, character: opponent, layout: "beside", clock }));
      const text = portrait.textArea;
      const nameY = this.cursor + (height - title - line) / 2;
      this.add(new Label({ id: "home.challenge.name", x: inset + text.x + 8, y: nameY, width: text.width - 12, height: title, text: opponent.name, size: sizes.title, weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
      this.add(new Label({ x: inset + text.x + 8, y: nameY + title, width: text.width - 12, height: line, text: opponent.title, size: sizes.text, colorKey: "text", align: "left", fit: true }));
      this.advance(height + gap);
      return;
    }
    const height = this.footTop - this.cursor - title - line - 2 * gap;
    if (height >= MIN_PORTRAIT.wide) {
      this.add(new CharacterPortrait({ id: "home.challenge.portrait", x: inset, y: this.cursor, width: this.inner, height, character: opponent, layout: "stacked", clock }));
      this.advance(height + gap);
    }
    this.addTitle(opponent.name, { id: "home.challenge.name" });
    this.add(new Label({ x: inset, y: this.cursor, width: this.inner, height: line, text: opponent.title, size: sizes.text, colorKey: "textMuted", align: "left", fit: true }));
    this.advance(line + gap);
  }
}
