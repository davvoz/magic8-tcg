/**
 * The picture of a shared game (application/social/shareCard), dressed as
 * the game's own screens: the painted menu backdrop with its glow and motes,
 * a gold frame with the panels' painted corners, the game's logo, the kind
 * of game on a plate, the outcome in the title face over the title divider,
 * the two players face to face (the winner lit, the loser in shadow, each
 * with a ribbon and their life in the board's gem), the length of the game,
 * where to play. Drawn at 1200 × 630 (the proportions social feeds show) and
 * scaled to any area: the image a ping carries and its preview in the share
 * dialog are the same painting.
 *
 * Players show their profile pictures (their initials until a picture is
 * there), a challenge's character its painted portrait. On screen the
 * pictures are the usual ones (Theme.avatars); saved as an image, they come
 * through the game server, since a canvas that draws another site's picture
 * can no longer be saved.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { isCharacterAccount } from "../../application/daily/characters.js";
import { UiPiece } from "../images/UiArt.js";
import { withTimeout } from "./withTimeout.js";
import { shade, withAlpha } from "../theme/color.js";
import { bodyFont, displayFont } from "../theme/Theme.js";
import { drawAvatar } from "../ui/avatar.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { drawOutlinedText, drawTextInRect, fillRoundedRect, glowRoundedRect, radialGradient, verticalGradient } from "../ui/drawing.js";
import { Ornament } from "../ui/Ornament.js";
import { paintCorners } from "../ui/Panel.js";
import { drawGem } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

/** The painting's own size. */
export const SHARE_CARD_SIZE = Object.freeze({ width: 1200, height: 630 });
const AVATAR_RADIUS = 86;
const SEATS = Object.freeze({ left: 300, right: 900, y: 352 });
const FRAME_INSET = 16;
/** The logo, top left: its box (the image keeps its proportions inside). */
const LOGO = Object.freeze({ x: 34, y: 18, width: 250, height: 150 });

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../../application/social/shareCard.js").ShareCard} card
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 */
export function paintShareCard(context, theme, card, area) {
  const { width, height } = SHARE_CARD_SIZE;
  const tone = toneOf(theme, card.outcome);
  context.save();
  context.translate(area.x, area.y);
  context.scale(area.width / width, area.height / height);
  paintBackground(context, theme, tone);
  paintLogo(context, theme);
  paintKind(context, theme, card.kind);
  paintTitle(context, theme, card.title, tone);
  const winner = winnerSide(card.outcome);
  paintPlayer(context, theme, { player: card.me, x: SEATS.left, lit: winner !== "opponent", ribbon: ribbonOf(card.outcome, "me") });
  paintPlayer(context, theme, { player: card.opponent, x: SEATS.right, lit: winner !== "me", ribbon: ribbonOf(card.outcome, "opponent") });
  paintMiddle(context, theme, card.turns);
  paintFooter(context, theme, card.site);
  context.restore();
}

/**
 * The menu backdrop, the outcome's light behind the title, the gold frame and its corners.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} tone
 */
function paintBackground(context, theme, tone) {
  const { width, height } = SHARE_CARD_SIZE;
  const frame = { x: 0, y: 0, width, height };
  drawSceneBackdrop(context, { ...theme, ambience: undefined }, frame, { seed: "share-card" });
  context.fillStyle = radialGradient(context, { x: width / 2, y: 170 }, 470, [[0, withAlpha(tone, 0.28)], [0.6, withAlpha(tone, 0.08)], [1, withAlpha(tone, 0)]]);
  context.fillRect(0, 0, width, height);
  context.fillStyle = verticalGradient(context, frame, [[0, withAlpha(theme.colors.background, 0)], [0.7, withAlpha(theme.colors.background, 0.15)], [1, withAlpha(theme.colors.background, 0.7)]]);
  context.fillRect(0, 0, width, height);
  const inner = { x: FRAME_INSET, y: FRAME_INSET, width: width - 2 * FRAME_INSET, height: height - 2 * FRAME_INSET };
  glowRoundedRect(context, inner, { color: withAlpha(theme.colors.accent, 0.55), radius: 18, blur: 18, lineWidth: 2 });
  fillRoundedRect(context, inner, { stroke: withAlpha(theme.colors.accent, 0.85), radius: 18, lineWidth: 2.5 });
  fillRoundedRect(context, { x: inner.x + 8, y: inner.y + 8, width: inner.width - 16, height: inner.height - 16 }, { stroke: withAlpha(theme.colors.accentDark, 0.8), radius: 12, lineWidth: 1 });
  paintCorners(context, theme, inner, { maxScale: 0.16 });
}

/**
 * The game's logo (the menu's own picture), or its name in the title face until the picture is there.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 */
function paintLogo(context, theme) {
  const logo = theme.uiArt?.imageFor(UiPiece.TITLE) ?? null;
  if (logo === null) {
    drawOutlinedText(context, "KIJAM", { ...LOGO, y: LOGO.y + 40, height: 70 }, { font: `900 54px ${theme.fonts.titleFamily ?? theme.fonts.displayFamily}`, color: theme.colors.accentLight, outline: withAlpha("#000000", 0.8), outlineWidth: 6, glow: theme.colors.accent, glowBlur: 16 });
    return;
  }
  const scale = Math.min(LOGO.width / logo.width, LOGO.height / logo.height);
  const drawn = { width: logo.width * scale, height: logo.height * scale };
  context.save();
  context.shadowColor = withAlpha("#000000", 0.7);
  context.shadowBlur = 12;
  context.drawImage(/** @type {CanvasImageSource} */ (logo.source), LOGO.x + (LOGO.width - drawn.width) / 2, LOGO.y + (LOGO.height - drawn.height) / 2, drawn.width, drawn.height);
  context.restore();
}

/**
 * The kind of game on a dark plate with a gold rim, top right.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} kind
 */
function paintKind(context, theme, kind) {
  const font = bodyFont(theme, 24, "bold");
  context.font = font;
  const width = Math.min(460, context.measureText(kind).width + 56);
  const plate = { x: SHARE_CARD_SIZE.width - 52 - width, y: 56, width, height: 48 };
  fillRoundedRect(context, plate, { fill: withAlpha(theme.colors.panelDark, 0.85), stroke: withAlpha(theme.colors.accent, 0.9), radius: 24, lineWidth: 2 });
  drawTextInRect(context, kind, plate, { font, color: theme.colors.accentLight });
}

/**
 * The outcome in the title face, gold or red, glowing, over the title divider.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} title
 * @param {string} tone
 */
function paintTitle(context, theme, title, tone) {
  const box = { x: 250, y: 92, width: 700, height: 116 };
  const fill = context.createLinearGradient(0, box.y + 20, 0, box.y + box.height - 20);
  fill.addColorStop(0, shade(tone, 0.35));
  fill.addColorStop(1, shade(tone, -0.15));
  drawOutlinedText(context, title.toUpperCase(), box, { font: `900 88px ${theme.fonts.titleFamily ?? theme.fonts.displayFamily}`, color: /** @type {any} */ (fill), outline: withAlpha("#000000", 0.85), outlineWidth: 8, glow: withAlpha(tone, 0.9), glowBlur: 30 });
  new Ornament({ x: 330, y: 214, width: 540, height: 16 }).paint(context, theme);
}

/**
 * A player: portrait in a gold ring (lit for the winner, in shadow for the loser), the ribbon across its foot, name, life.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ player: import("../../application/social/shareCard.js").CardPlayer, x: number, lit: boolean, ribbon: { text: string, colorKey: string } | null }} seat
 */
function paintPlayer(context, theme, { player, x, lit, ribbon }) {
  const { colors } = theme;
  const center = { x, y: SEATS.y };
  const halo = lit ? colors.accentLight : colors.textMuted;
  context.fillStyle = radialGradient(context, center, AVATAR_RADIUS * 1.9, [[0.45, withAlpha(halo, lit ? 0.45 : 0.12)], [1, withAlpha(halo, 0)]]);
  context.fillRect(center.x - AVATAR_RADIUS * 2, center.y - AVATAR_RADIUS * 2, AVATAR_RADIUS * 4, AVATAR_RADIUS * 4);
  ring(context, center, AVATAR_RADIUS + 9, { color: withAlpha(colors.accentDark, 0.9), width: 6 });
  drawAvatar(context, theme, { account: player.account ?? player.name, center, radius: AVATAR_RADIUS, picture: player.account !== null });
  if (!lit) {
    context.fillStyle = withAlpha(colors.background, 0.45);
    context.beginPath();
    context.arc(center.x, center.y, AVATAR_RADIUS, 0, Math.PI * 2);
    context.fill();
  }
  ring(context, center, AVATAR_RADIUS + 3, { color: lit ? colors.accentLight : withAlpha(colors.accent, 0.7), width: 4 });
  if (ribbon !== null) {
    paintRibbon(context, theme, { x, y: SEATS.y + AVATAR_RADIUS - 6 }, ribbon);
  }
  const below = SEATS.y + AVATAR_RADIUS + 26;
  drawOutlinedText(context, player.name, { x: x - 250, y: below, width: 500, height: 48 }, { font: displayFont(theme, 38), color: colors.text, outline: withAlpha("#000000", 0.8), outlineWidth: 5 });
  paintLife(context, theme, { x, y: below + 82 }, player.life);
}

/**
 * A ribbon across the foot of a portrait: WINNER, DEFEATED.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} at its centre
 * @param {{ text: string, colorKey: string }} ribbon
 */
function paintRibbon(context, theme, at, { text, colorKey }) {
  const color = theme.colors[colorKey] ?? theme.colors.accent;
  const box = { x: at.x - 92, y: at.y - 17, width: 184, height: 34 };
  context.save();
  context.beginPath();
  context.moveTo(box.x - 14, box.y);
  context.lineTo(box.x + box.width + 14, box.y);
  context.lineTo(box.x + box.width, at.y);
  context.lineTo(box.x + box.width + 14, box.y + box.height);
  context.lineTo(box.x - 14, box.y + box.height);
  context.lineTo(box.x, at.y);
  context.closePath();
  context.fillStyle = verticalGradient(context, box, [[0, shade(color, 0.05)], [1, shade(color, -0.45)]]);
  context.shadowColor = withAlpha("#000000", 0.6);
  context.shadowBlur = 10;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 2;
  context.strokeStyle = withAlpha(theme.colors.accentLight, 0.85);
  context.stroke();
  context.restore();
  drawOutlinedText(context, text, box, { font: bodyFont(theme, 20, "bold"), color: theme.colors.text, outline: withAlpha("#000000", 0.7), outlineWidth: 3 });
}

/**
 * The life a player ended on, in the board's gem.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} at
 * @param {number} life
 */
function paintLife(context, theme, at, life) {
  const { colors } = theme;
  const color = life <= 5 ? colors.danger : colors.health;
  const radius = 26;
  const gem = { x: at.x - 50, y: at.y };
  const box = { x: gem.x - radius, y: gem.y - radius, width: radius * 2, height: radius * 2 };
  context.save();
  context.shadowColor = withAlpha(color, 0.7);
  context.shadowBlur = 14;
  drawGem(context, gem, radius, { fill: verticalGradient(context, box, [[0, shade(color, 0.25)], [1, shade(color, -0.55)]]), rim: colors.accent, highlight: withAlpha("#ffffff", 0.3), sides: 6, rimWidth: 2.5 });
  context.restore();
  drawOutlinedText(context, String(life), box, { font: bodyFont(theme, 26, "bold"), color: colors.text, outline: withAlpha("#000000", 0.85), outlineWidth: 4 });
  drawTextInRect(context, "life", { x: gem.x + radius + 10, y: gem.y - 18, width: 120, height: 36 }, { font: bodyFont(theme, 24, "bold"), color: colors.textMuted, align: "left" });
}

/**
 * VS between the players, and the length of the game on a plate under it.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {number} turns
 */
function paintMiddle(context, theme, turns) {
  const x = SHARE_CARD_SIZE.width / 2;
  drawOutlinedText(context, "VS", { x: x - 100, y: SEATS.y - 50, width: 200, height: 90 }, { font: `900 64px ${theme.fonts.titleFamily ?? theme.fonts.displayFamily}`, color: theme.colors.accentLight, outline: withAlpha("#000000", 0.85), outlineWidth: 6, glow: withAlpha(theme.colors.accent, 0.8), glowBlur: 18 });
  const plate = { x: x - 90, y: SEATS.y + 52, width: 180, height: 40 };
  fillRoundedRect(context, plate, { fill: withAlpha(theme.colors.panelDark, 0.8), stroke: withAlpha(theme.colors.accent, 0.7), radius: 20, lineWidth: 1.5 });
  drawTextInRect(context, `${turns} turns`, plate, { font: bodyFont(theme, 22, "bold"), color: theme.colors.text });
}

/**
 * Where to play and the game's hashtag, centred at the foot, clear of the painted corners.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} site
 */
function paintFooter(context, theme, site) {
  const y = SHARE_CARD_SIZE.height - 66;
  const play = `Play at ${site}`;
  const tag = "#kijam";
  const gap = "   ·   ";
  const playFont = bodyFont(theme, 22);
  const tagFont = bodyFont(theme, 22, "bold");
  context.font = playFont;
  const playWidth = context.measureText(play + gap).width;
  context.font = tagFont;
  const tagWidth = context.measureText(tag).width;
  const x = (SHARE_CARD_SIZE.width - playWidth - tagWidth) / 2;
  drawTextInRect(context, play + gap, { x, y, width: playWidth, height: 32 }, { font: playFont, color: theme.colors.textMuted, align: "left" });
  drawTextInRect(context, tag, { x: x + playWidth, y, width: tagWidth, height: 32 }, { font: tagFont, color: theme.colors.accent, align: "left" });
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {{ color: string, width: number }} stroke
 */
function ring(context, center, radius, { color, width }) {
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.stroke();
}

/**
 * Which side won: the player's ("me"), the opponent's, or neither (a draw).
 * @param {string} outcome
 * @returns {"me" | "opponent" | null}
 */
function winnerSide(outcome) {
  if (outcome === "win") {
    return "me";
  }
  return outcome === "loss" ? "opponent" : null;
}

/**
 * The ribbon under a portrait: WINNER for the winner, DEFEATED for the loser, none in a draw.
 * @param {string} outcome
 * @param {"me" | "opponent"} side
 */
function ribbonOf(outcome, side) {
  const winner = winnerSide(outcome);
  if (winner === null) {
    return null;
  }
  return winner === side ? { text: "WINNER", colorKey: "accentDark" } : { text: "DEFEATED", colorKey: "danger" };
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
  constructor({ theme, createCanvas, pictureOf = async () => null, quality = 0.88, waitMs = 10_000 }) {
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
      return base64 === undefined || base64.length === 0 ? fail("IMAGE_FAILED", "the canvas gave no image") : ok(Object.freeze({ base64, image: Object.freeze({ source: canvas, width: canvas.width, height: canvas.height }) }));
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
