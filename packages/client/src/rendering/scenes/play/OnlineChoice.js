/**
 * Play online: casual or ranked? A dialog over the Play screen with the two
 * ways side by side (ModeCard), each saying what it gives and what it
 * needs, so the player knows before choosing:
 *
 * - Casual: free, nothing at stake, anyone can be challenged.
 * - Ranked: the season's leaderboard and its jackpot; it takes ranked
 *   entries (how many the player holds, and that they lack them) and opens
 *   after a few casual games (how many are left).
 *
 * Each card's button opens its lobby; Ranked opens even while it is locked
 * or the player holds no entries: its lobby says what is missing and gets it.
 */
import { entriesText } from "../../../application/entries/EntryService.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { PlayKind } from "../online/lobbyIcons.js";
import { ModeCard } from "../online/ModeCard.js";
import { StepState } from "../online/StepList.js";
import { SceneId } from "../sceneIds.js";

/** The dialog, wide and on a phone: its largest size, its padding, its title, the line under it, the gap between the cards. */
const SIZES = Object.freeze({
  wide: Object.freeze({ width: 940, height: 520, pad: 24, title: 44, subtitle: 28, gap: 24, close: 44 }),
  compact: Object.freeze({ width: 760, height: 360, pad: 8, title: 46, subtitle: 0, gap: 8, close: 46 }),
});

/**
 * @typedef {{
 *   viewport: { logicalWidth: number, logicalHeight: number },
 *   compact: boolean,
 *   margin: number,
 *   ranked: import("../home/PlayViews.js").RankedView,
 *   choose: (sceneId: string) => void,
 *   close: () => void,
 * }} ChoiceRequest `margin`: the least room kept round the dialog; `choose`: opens a lobby
 */

/**
 * @param {ChoiceRequest} request
 * @returns {Modal}
 */
export function onlineChoice({ viewport, compact, margin, ranked, choose, close }) {
  const m = compact ? SIZES.compact : SIZES.wide;
  const width = Math.min(m.width, viewport.logicalWidth - 2 * margin);
  const height = Math.min(m.height, viewport.logicalHeight - 2 * margin);
  const modal = new Modal({ id: "choice", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: close });
  const { panel } = modal;
  const inner = width - 2 * m.pad;
  const titleInset = panel.titleInset;
  panel.add(new Label({ id: "choice.title", x: titleInset, y: m.pad, width: width - 2 * titleInset - m.close - 8, height: m.title, text: "Play online", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  if (m.subtitle > 0) {
    panel.add(new Label({ id: "choice.subtitle", x: titleInset, y: m.pad + m.title, width: width - 2 * titleInset, height: m.subtitle, text: "Real players, live. How do you want to play?", size: "body", colorKey: "textMuted", align: "left", fit: true }));
  }
  const top = m.pad + m.title + m.subtitle + m.gap;
  const card = { y: top, width: (inner - m.gap) / 2, height: height - top - m.pad, compact };
  panel.add(new ModeCard({ ...card, ...casualCard(choose), x: m.pad }));
  panel.add(new ModeCard({ ...card, ...rankedCard(ranked, choose), x: m.pad + card.width + m.gap }));
  // Last, so the focus starts on the cards.
  panel.add(new Button({ id: "choice.close", x: width - titleInset - m.close, y: m.pad, width: m.close, height: m.close, text: "✕", textSize: "small", onActivate: close }));
  return modal;
}

/** @param {(sceneId: string) => void} choose */
function casualCard(choose) {
  return {
    id: "choice.casual",
    kind: PlayKind.CASUAL,
    title: "Casual",
    tagline: "Just play: against anyone online, or a friend you challenge.",
    steps: [
      { text: "Free, always", state: StepState.DONE },
      { text: "No rating at stake", state: StepState.DONE },
      { text: "Challenge any player online", state: StepState.DONE },
    ],
    action: { id: "choice.casual.play", text: "Play casual", onActivate: () => choose(SceneId.CASUAL) },
  };
}

/**
 * @param {import("../home/PlayViews.js").RankedView} ranked
 * @param {(sceneId: string) => void} choose
 */
function rankedCard({ lock, entries, jackpot }, choose) {
  /** @type {import("../online/StepList.js").Step[]} */
  const steps = [];
  if (lock !== null) {
    steps.push({ text: lock, state: StepState.LOCKED, colorKey: "accent" });
  }
  if (entries !== null) {
    const uses = `A game uses ${entriesText(entries.perGame)}`;
    steps.push(entries.held >= entries.perGame ? { text: `${uses} · you have ${entries.held}`, state: StepState.DONE } : { text: `${uses} · you have none yet`, state: StepState.MISSING });
  }
  steps.push({ text: "Climb the season's leaderboard", state: StepState.DONE });
  steps.push({ text: jackpot === null ? "The best players share the jackpot" : `The best share the jackpot: ${jackpot}`, state: StepState.DONE });
  return {
    id: "choice.ranked",
    kind: PlayKind.RANKED,
    title: "Ranked",
    tagline: "Play for the season: win to climb, and to share its jackpot.",
    locked: lock !== null,
    steps,
    action: { id: "choice.ranked.play", text: "Play ranked", variant: /** @type {const} */ ("primary"), onActivate: () => choose(SceneId.RANKED) },
  };
}
