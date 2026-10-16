/**
 * One way to play on the Play screen: its picture on the left, then what
 * kind of play it is ("SOLO · REWARDS"), its name, a line on what it is for
 * and where the player stands with it, and its buttons. On a phone the
 * tile keeps its name, a short status and its buttons. A HomeCard with a
 * picture.
 */
import { CharacterPortrait } from "../daily/CharacterPortrait.js";
import { HomeCard } from "../home/HomeCard.js";
import { TileArt } from "./TileArt.js";

/**
 * The picture: flush with the tile's left, top and bottom edges (over its painted corners on that side), as wide as
 * the paintings' shape asks for that height (data/art/Play_*.jpg, 620×630), up to a share of the tile's width.
 */
const ART = Object.freeze({ aspect: 620 / 630, share: 0.55 });
/** Below this height a phone's tile has room for its name and buttons only. */
const COMPACT_ROOMY = 150;

/**
 * @typedef {Readonly<{ piece: string, icon: string, faction: string }> | Readonly<{ portrait: import("../daily/CharacterPortrait.js").PortraitCharacter, clock: () => number }>} TilePicture
 *   a painting (a UiPiece, with the emblem shown until it is ready), or a challenge character's portrait
 * @typedef {Readonly<{ text: string, colorKey?: string }>} TileStatus
 */

export class PlayTile extends HomeCard {
  /**
   * @param {{
   *   id: string, x: number, y: number, width: number, height: number, compact: boolean,
   *   picture: TilePicture, kicker: string, kickerKey?: string, title: string, text: string, status?: TileStatus | null,
   *   actions: readonly import("../home/HomeCard.js").CardAction[], primary?: boolean,
   * }} options `primary`: the tile holds the screen's gold button
   */
  constructor({ picture, kicker, kickerKey = "accent", title, text, status = null, actions, primary = false, ...frame }) {
    const artWidth = Math.round(Math.min(frame.height * ART.aspect, frame.width * ART.share));
    super({ ...frame, lead: artWidth, glowKey: primary ? "accent" : null });
    this.#buildPicture(picture, { id: frame.id, width: artWidth });
    this.#buildText({ id: frame.id, kicker, kickerKey, title, text, status, actions });
  }

  /**
   * The words and the buttons, right of the picture. A short phone tile keeps its name and buttons only.
   * @param {{ id: string, kicker: string, kickerKey: string, title: string, text: string, status: TileStatus | null, actions: readonly import("../home/HomeCard.js").CardAction[] }} parts
   */
  #buildText({ id, kicker, kickerKey, title, text, status, actions }) {
    const roomy = !this.compact || this.height >= COMPACT_ROOMY;
    if (roomy) {
      this.addKicker(kicker, kickerKey);
    }
    this.addTitle(title, { id: `${id}.title` });
    if (!this.compact) {
      this.addText(text, { id: `${id}.text`, lines: 4 });
    }
    const note = roomy && status !== null ? status.text : null;
    this.addActions(actions, { note, noteId: `${id}.status`, noteKey: status?.colorKey ?? "textMuted" });
  }

  /**
   * @param {TilePicture} picture
   * @param {{ id: string, width: number }} where `width`: the room kept for it on the tile's left
   */
  #buildPicture(picture, { id, width }) {
    const frame = { id: `${id}.art`, x: 0, y: 0, width, height: this.height };
    if ("portrait" in picture) {
      this.add(new CharacterPortrait({ ...frame, character: picture.portrait, layout: "stacked", clock: picture.clock }));
      return;
    }
    this.add(new TileArt({ ...frame, piece: picture.piece, icon: picture.icon, faction: picture.faction }));
  }
}
