/**
 * A player's season in figures (on Home's season card, the player's; in the
 * leaderboard's dialog, anyone's): their place, their rating, the games
 * they played, won and lost, and how often they win — six tiles, three by
 * two, under a caption ("YOUR SEASON" by default). A figure the
 * season has not given yet (no game played) is a dash. Drawing only:
 * pointer queries look through it.
 */
import { withAlpha } from "../../theme/color.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { Label } from "../../ui/Label.js";
import { UiNode } from "../../ui/UiNode.js";

/** The caption's height, the gap between tiles, and in each tile the figure's share of its height. */
const LAYOUT = Object.freeze({ caption: 24, gap: 10, columns: 3, rows: 2, figure: 0.58 });
/** The most a tile is tall: past it, the tiles keep to the top of their room. */
const MAX_TILE = 96;
const DASH = "—";

/**
 * @typedef {Readonly<{ label: string, value: string, colorKey?: string }>} Stat
 * @typedef {Readonly<{ rank: number | null, provisional: boolean, rating: number, games: number, wins: number, losses: number, draws: number }>} Figures
 *   a season's standing or a leaderboard's line: what the figures are made of
 */

export class SeasonStats extends UiNode {
  /** The figures, in the order they are shown. @type {readonly Stat[]} */
  stats;
  #tile;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, standing: Figures, caption?: string }} options
   */
  constructor({ id = "home.season.stats", standing, caption = "YOUR SEASON", ...frame }) {
    super({ id, ...frame });
    this.passthrough = true;
    this.stats = seasonStats(standing);
    const tileWidth = (frame.width - (LAYOUT.columns - 1) * LAYOUT.gap) / LAYOUT.columns;
    const tileHeight = Math.min(MAX_TILE, (frame.height - LAYOUT.caption - (LAYOUT.rows - 1) * LAYOUT.gap) / LAYOUT.rows);
    this.#tile = { width: tileWidth, height: tileHeight };
    this.add(new Label({ id: `${id}.caption`, x: 0, y: 0, width: frame.width, height: LAYOUT.caption, text: caption, size: "tiny", weight: "bold", colorKey: "accent", align: "left", fit: true }));
    this.stats.forEach((stat, index) => {
      const at = this.#tileAt(index);
      const figure = tileHeight * LAYOUT.figure;
      this.add(new Label({ id: `${id}.value.${index + 1}`, x: at.x + 4, y: at.y + 4, width: tileWidth - 8, height: figure, text: stat.value, size: tileHeight >= 84 ? "heading" : "subheading", weight: "bold", colorKey: stat.colorKey ?? "accentLight", fit: true }));
      this.add(new Label({ id: `${id}.label.${index + 1}`, x: at.x + 4, y: at.y + figure, width: tileWidth - 8, height: tileHeight - figure - 4, text: stat.label, size: "small", colorKey: "textMuted", fit: true }));
    });
  }

  /**
   * How tall the figures are in this much room (their tiles grow no taller than MAX_TILE).
   * @param {number} room
   */
  static heightIn(room) {
    const tile = Math.min(MAX_TILE, (room - LAYOUT.caption - (LAYOUT.rows - 1) * LAYOUT.gap) / LAYOUT.rows);
    return LAYOUT.caption + LAYOUT.rows * tile + (LAYOUT.rows - 1) * LAYOUT.gap;
  }

  /** @param {number} index */
  #tileAt(index) {
    const column = index % LAYOUT.columns;
    const row = Math.floor(index / LAYOUT.columns);
    return { x: column * (this.#tile.width + LAYOUT.gap), y: LAYOUT.caption + row * (this.#tile.height + LAYOUT.gap) };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { colors } = theme;
    const area = this.bounds;
    this.stats.forEach((_, index) => {
      const at = this.#tileAt(index);
      fillRoundedRect(context, { x: area.x + at.x, y: area.y + at.y, ...this.#tile }, { fill: withAlpha(colors.panelDark, 0.7), stroke: withAlpha(colors.accent, 0.3), radius: theme.spacing.radius, lineWidth: 1 });
    });
  }
}

/**
 * The six figures of a player's season.
 * @param {Figures} standing
 * @returns {readonly Stat[]}
 */
export function seasonStats(standing) {
  const played = standing.games > 0;
  const place = standing.provisional || standing.rank === null ? "New" : `#${standing.rank}`;
  const rate = played ? `${Math.round((100 * standing.wins) / standing.games)}%` : DASH;
  return Object.freeze([
    { label: "Place", value: played ? place : DASH },
    { label: "Rating", value: String(standing.rating) },
    { label: "Games", value: String(standing.games), colorKey: "text" },
    { label: standing.draws > 0 ? `Wins · ${standing.draws} drawn` : "Wins", value: String(standing.wins), colorKey: "success" },
    { label: "Losses", value: String(standing.losses), colorKey: "danger" },
    { label: "Win rate", value: rate },
  ]);
}
