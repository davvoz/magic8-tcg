/**
 * A player's portrait: their STEEM profile picture in a gold-rimmed disc (a
 * challenge character's painted portrait, Theme.characterArt, for its seat).
 * Until the picture is ready (or without one) the disc shows the account's
 * initial on a colour of its own, so the same player always looks the same.
 */
import { hashString } from "@magic8/engine/shared/hash.js";
import { characterIdOf, isCharacterAccount } from "../../application/daily/characters.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { bodyFont } from "../theme/Theme.js";
import { drawImageCover, drawTextInRect, radialGradient } from "./drawing.js";

/** Hues the initials' discs are drawn from: dark enough for light text. */
const FALLBACK_TONES = Object.freeze(["#7a3b2e", "#2e5a7a", "#4a6b2e", "#6b2e6b", "#7a6a2e", "#2e6b62", "#5a3b7a", "#7a2e45"]);

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ account: string, center: { x: number, y: number }, radius: number, picture?: boolean }} portrait
 *   `picture`: false for a seat with no STEEM account (the local AI): only its initial is drawn, and no picture is fetched
 */
export function drawAvatar(context, theme, { account, center, radius, picture = true }) {
  const { colors } = theme;
  const area = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
  const portrait = picture ? pictureOf(theme, account) : null;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  if (portrait === null) {
    const tone = FALLBACK_TONES[hashString(account) % FALLBACK_TONES.length];
    context.fillStyle = radialGradient(context, { x: center.x - radius * 0.3, y: center.y - radius * 0.35 }, radius * 1.6, [[0, shade(tone, 0.25)], [1, shade(mix(tone, colors.panelDark, 0.4), -0.3)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    drawTextInRect(context, initialOf(account), area, { font: bodyFont(theme, radius * 1.05, "bold"), color: colors.text });
  } else {
    drawImageCover(context, portrait.image, area, portrait.focus);
  }
  context.restore();
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.lineWidth = Math.max(1.5, radius / 12);
  context.strokeStyle = withAlpha(colors.accent, 0.85);
  context.stroke();
  context.restore();
}

/**
 * The picture in the disc when it is ready: a character's painted portrait, or the account's profile picture.
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} account
 * @returns {{ image: import("../images/ImageCache.js").LoadedImage, focus?: readonly [number, number] } | null}
 */
function pictureOf(theme, account) {
  if (isCharacterAccount(account)) {
    return theme.characterArt?.imageFor(characterIdOf(account)) ?? null;
  }
  const image = theme.avatars?.imageFor(account) ?? null;
  return image === null ? null : { image };
}

/** @param {string} account a STEEM account, or a daily challenge's character (its own initial: "ai_kael" is K) */
function initialOf(account) {
  const name = isCharacterAccount(account) ? characterIdOf(account) : account.replace(/^@/, "");
  return (name[0] ?? "?").toUpperCase();
}
