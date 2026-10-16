/**
 * The picture of a shared game (application/social/shareCard): the game's
 * name, the outcome in large letters, the two players face to face with the
 * life they ended on, the length of the game, where to play. Drawn at
 * 1200 × 630 (the proportions social feeds show) and scaled to any area:
 * the image a ping carries and its preview in the share dialog are the same
 * painting.
 *
 * Players show their profile pictures (their initials until a picture is
 * there), a challenge's character its painted portrait. On screen the
 * pictures are the usual ones (Theme.avatars); saved as an image, they come
 * through the game server, since a canvas that draws another site's picture
 * can no longer be saved.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { isCharacterAccount } from "../../application/daily/characters.js";
import { withTimeout } from "./withTimeout.js";
import { withAlpha } from "../theme/color.js";
import { bodyFont, displayFont } from "../theme/Theme.js";
import { drawAvatar } from "../ui/avatar.js";
import { drawTextInRect, fillRoundedRect, radialGradient, verticalGradient } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";

/** The painting's own size. */
export const SHARE_CARD_SIZE = Object.freeze({ width: 1200, height: 630 });
const AVATAR_RADIUS = 92;
const SEATS = Object.freeze({ left: 300, right: 900, y: 360 });

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../../application/social/shareCard.js").ShareCard} card
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 */
export function paintShareCard(context, theme, card, area) {
  const { colors } = theme;
  const tone = toneOf(theme, card.outcome);
  const { width, height } = SHARE_CARD_SIZE;
  context.save();
  context.translate(area.x, area.y);
  context.scale(area.width / width, area.height / height);
  const frame = { x: 0, y: 0, width, height };
  context.fillStyle = verticalGradient(context, frame, [[0, colors.panel], [1, colors.background]]);
  context.fillRect(0, 0, width, height);
  context.fillStyle = radialGradient(context, { x: width / 2, y: 190 }, 520, [[0, withAlpha(tone, 0.32)], [1, withAlpha(tone, 0)]]);
  context.fillRect(0, 0, width, height);
  fillRoundedRect(context, { x: 14, y: 14, width: width - 28, height: height - 28 }, { stroke: withAlpha(colors.accent, 0.7), radius: 24, lineWidth: 3 });

  drawTextInRect(context, "KIJAM", { x: 48, y: 36, width: 400, height: 60 }, { font: `bold 46px ${theme.fonts.titleFamily ?? theme.fonts.displayFamily}`, color: colors.accentLight, align: "left" });
  drawTextInRect(context, card.kind, { x: 600, y: 36, width: 552, height: 60 }, { font: bodyFont(theme, 28, "bold"), color: colors.textMuted, align: "right" });
  context.save();
  context.shadowColor = tone;
  context.shadowBlur = 24;
  drawTextInRect(context, card.title.toUpperCase(), { x: 0, y: 110, width, height: 120 }, { font: displayFont(theme, 104), color: tone });
  context.restore();

  paintPlayer(context, theme, card.me, SEATS.left);
  paintPlayer(context, theme, card.opponent, SEATS.right);
  drawTextInRect(context, "VS", { x: 500, y: SEATS.y - 40, width: 200, height: 80 }, { font: displayFont(theme, 56), color: withAlpha(colors.text, 0.75) });
  drawTextInRect(context, `${card.turns} turns`, { x: 450, y: SEATS.y + 50, width: 300, height: 40 }, { font: bodyFont(theme, 26), color: colors.textMuted });
  drawTextInRect(context, `Play at ${card.site}`, { x: 48, y: 560, width: 700, height: 40 }, { font: bodyFont(theme, 24), color: colors.textMuted, align: "left" });
  drawTextInRect(context, "#kijam", { x: 752, y: 560, width: 400, height: 40 }, { font: bodyFont(theme, 24, "bold"), color: colors.accent, align: "right" });
  context.restore();
}

/**
 * A player: portrait (initial, or a character's painting), name, the life they ended on.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../../application/social/shareCard.js").CardPlayer} player
 * @param {number} x the seat's centre
 */
function paintPlayer(context, theme, player, x) {
  drawAvatar(context, theme, { account: player.account ?? player.name, center: { x, y: SEATS.y }, radius: AVATAR_RADIUS, picture: player.account !== null });
  const below = SEATS.y + AVATAR_RADIUS + 14;
  drawTextInRect(context, player.name, { x: x - 260, y: below, width: 520, height: 46 }, { font: displayFont(theme, 36), color: theme.colors.text });
  drawTextInRect(context, `${player.life} life`, { x: x - 260, y: below + 46, width: 520, height: 36 }, { font: bodyFont(theme, 28, "bold"), color: player.life > 0 ? theme.colors.accentLight : theme.colors.danger });
}

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} outcome
 */
function toneOf(theme, outcome) {
  if (outcome === "win") {
    return theme.colors.accentLight;
  }
  return outcome === "loss" ? theme.colors.danger : theme.colors.text;
}

/** The share card shown in a dialog, at the size of its box (which keeps the card's proportions). */
export class ShareCardNode extends UiNode {
  #card;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, card: import("../../application/social/shareCard.js").ShareCard }} options
   */
  constructor({ card, ...frame }) {
    super(frame);
    this.passthrough = true;
    this.#card = card;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    paintShareCard(context, theme, this.#card, this.bounds);
  }
}

/**
 * The share card painted on a canvas of its own and saved as a JPEG: the ShareImage of the browser.
 */
export class CanvasShareImage {
  #theme;
  #createCanvas;
  #pictureOf;
  #quality;
  #waitMs;

  /**
   * @param {{
   *   theme: import("../theme/Theme.js").Theme,
   *   createCanvas: () => HTMLCanvasElement,
   *   pictureOf?: (account: string) => Promise<import("../images/ImageCache.js").LoadedImage | null>,
   *   quality?: number,
   *   waitMs?: number,
   * }} deps `pictureOf`: a player's profile picture fit for saving (the page's own); `waitMs`: how long pictures are waited for before initials stand in
   */
  constructor({ theme, createCanvas, pictureOf = async () => null, quality = 0.88, waitMs = 4000 }) {
    this.#theme = theme;
    this.#createCanvas = createCanvas;
    this.#pictureOf = pictureOf;
    this.#quality = quality;
    this.#waitMs = waitMs;
  }

  /** @param {import("../../application/social/shareCard.js").ShareCard} card */
  async render(card) {
    try {
      const theme = await this.#withPictures(card);
      const canvas = this.#createCanvas();
      canvas.width = SHARE_CARD_SIZE.width;
      canvas.height = SHARE_CARD_SIZE.height;
      const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
      paintShareCard(context, theme, card, { x: 0, y: 0, ...SHARE_CARD_SIZE });
      const [, base64] = canvas.toDataURL("image/jpeg", this.#quality).split(",");
      return base64 === undefined || base64.length === 0 ? fail("IMAGE_FAILED", "the canvas gave no image") : ok(base64);
    } catch (error) {
      return fail("IMAGE_FAILED", error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * The theme the picture is painted with: the players' profile pictures are the saveable ones, or none (their initials).
   * @param {import("../../application/social/shareCard.js").ShareCard} card
   */
  async #withPictures(card) {
    const accounts = /** @type {string[]} */ ([card.me.account, card.opponent.account].filter((account) => account !== null && !isCharacterAccount(account)));
    /** @type {Map<string, import("../images/ImageCache.js").LoadedImage>} */
    const pictures = new Map();
    await Promise.all(accounts.map(async (account) => {
      const picture = await withTimeout(this.#pictureOf(account), this.#waitMs, null).catch(() => null);
      if (picture !== null) {
        pictures.set(account, picture);
      }
    }));
    return Object.freeze({ ...this.#theme, avatars: { imageFor: (/** @type {string} */ account) => pictures.get(account) ?? null } });
  }
}
