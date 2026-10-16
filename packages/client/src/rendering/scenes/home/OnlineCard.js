/**
 * Online play on the Home screen: a real opponent, casual or ranked. Ranked
 * stays beside Casual, locked with what it waits for, until the player may
 * play it; signed out or offline, both are locked with the reason.
 */
import { HomeCard } from "./HomeCard.js";

/**
 * What the card shows.
 * @typedef {Readonly<{ kind: "locked", reason: string }> | Readonly<{ kind: "open", rankedLock: string | null, note: string | null }>} OnlineView
 *   `rankedLock`: why ranked is not open yet (null: it is)
 */

export class OnlineCard extends HomeCard {
  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean, view: OnlineView, primary: boolean, onPlay: (mode: "casual" | "ranked") => void }} options
   *   `primary`: Casual is the screen's gold button
   */
  constructor({ view, primary, onPlay, ...frame }) {
    super(frame);
    this.addKicker("Online");
    this.addTitle("Play a real opponent");
    this.addText(this.compact ? "Casual to practise, Ranked to climb the season." : "Casual to practise. Ranked to climb the season and win a share of the jackpot.", { lines: 3 });
    const locked = view.kind === "locked";
    const rankedLocked = locked || view.rankedLock !== null;
    const note = view.kind === "locked" ? view.reason : (view.rankedLock ?? view.note);
    this.addActions(
      [
        { id: "home.online.casual", text: "Casual", locked, variant: primary ? "primary" : "secondary", onActivate: () => onPlay("casual") },
        { id: "home.online.ranked", text: "Ranked", locked: rankedLocked, onActivate: () => onPlay("ranked") },
      ],
      { note, noteId: "home.online.note" },
    );
  }
}
