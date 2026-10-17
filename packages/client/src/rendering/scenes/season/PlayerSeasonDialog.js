/**
 * A player's season, opened from their line on the leaderboard: their
 * portrait and name, their place in the season, their figures (SeasonStats:
 * place, rating, games, wins, losses, win rate), and the way to their games.
 */
import { AvatarNode } from "../../ui/AvatarNode.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { SeasonStats } from "../home/SeasonStats.js";

/** The dialog, wide and on a phone: its largest size, the portrait, the title and line under it, the buttons, the gaps. */
const SIZES = Object.freeze({
  wide: Object.freeze({ width: 620, height: 470, avatar: 72, title: 40, line: 26, button: 52, gap: 16 }),
  compact: Object.freeze({ width: 560, height: 340, avatar: 48, title: 30, line: 20, button: 46, gap: 8 }),
});

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number },
 *   compact: boolean,
 *   season: string,
 *   entry: import("../../../application/ports/RankingApi.contract.js").LeaderboardEntry,
 *   mine: boolean,
 *   onGames: (() => void) | null,
 *   onClose: () => void,
 * }} request `mine`: the line is the player's own; `onGames`: opens their games (null: there is nowhere to)
 * @returns {Modal}
 */
export function buildPlayerSeasonDialog({ viewport, compact, season, entry, mine, onGames, onClose }) {
  const m = compact ? SIZES.compact : SIZES.wide;
  const width = Math.min(m.width, viewport.logicalWidth - 16);
  const height = Math.min(m.height, viewport.logicalHeight - 16);
  const modal = new Modal({ id: "player", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const side = panel.titleInset;
  const inner = width - 2 * side;
  const top = compact ? 10 : 24;
  panel.add(new AvatarNode({ x: side, y: top, size: m.avatar, account: entry.account }));
  const textX = side + m.avatar + 14;
  const textWidth = width - side - textX;
  const nameY = top + (m.avatar - m.title - m.line) / 2;
  panel.add(new Label({ id: "player.name", x: textX, y: nameY, width: textWidth, height: m.title, text: mine ? `@${entry.account} · You` : `@${entry.account}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Label({ id: "player.place", x: textX, y: nameY + m.title, width: textWidth, height: m.line, text: placeLine(season, entry), size: "small", colorKey: "textMuted", align: "left", fit: true }));
  const buttonY = height - (compact ? 10 : 24) - m.button;
  const statsY = top + m.avatar + m.gap;
  panel.add(new SeasonStats({ id: "player.stats", x: side, y: statsY, width: inner, height: buttonY - m.gap - statsY, standing: entry, caption: `${season} · in figures`.toUpperCase() }));
  const half = (inner - 12) / 2;
  // Close first, so that it takes the focus.
  panel.add(new Button({ id: "player.close", x: side + half + 12, y: buttonY, width: half, height: m.button, text: "Close", onActivate: onClose }));
  panel.add(new Button({ id: "player.games", x: side, y: buttonY, width: half, height: m.button, text: mine ? "Your games" : "Their games", enabled: onGames !== null, onActivate: () => onGames?.() }));
  return modal;
}

/**
 * "Season 1 · 4th place", "Season 1 · provisional rating".
 * @param {string} season
 * @param {import("../../../application/ports/RankingApi.contract.js").LeaderboardEntry} entry
 */
function placeLine(season, entry) {
  if (entry.provisional || entry.rank === null) {
    return `${season} · provisional: not placed yet`;
  }
  return `${season} · ${ordinal(entry.rank)} place`;
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st" @param {number} n */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) {
    return `${n}th`;
  }
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}
