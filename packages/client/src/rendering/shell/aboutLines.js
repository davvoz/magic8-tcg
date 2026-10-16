/**
 * What the game says about itself, for a player who wants to know (the
 * settings): what the game holds, where custom decks are kept, and which
 * release they run.
 */
import { deckStorageText } from "../scenes/deckStorage.js";

/**
 * "120 cards · 10 preconstructed decks · factions: ember · iron · …".
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function contentLine(app) {
  const { content } = app;
  const factions = content.deckRules.factions.join(" · ");
  return `${content.catalog.size} cards · ${content.preconDecks.length} preconstructed decks · factions: ${factions}`;
}

/**
 * "2 custom decks saved in this browser".
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function storageLine(app) {
  const saved = app.deckSelection.listDecks().filter((option) => option.source === "custom").length;
  return `${saved} custom deck${saved === 1 ? "" : "s"} ${deckStorageText(app)}`;
}

/**
 * The game's release (so a player can tell which one they run), then the engine's.
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function versionLine(app) {
  const { release, version } = app.environment;
  return release === undefined ? `engine ${version}` : `KIJAM ${release} · engine ${version}`;
}

/**
 * The three lines, in order.
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function aboutLines(app) {
  return [contentLine(app), storageLine(app), versionLine(app)];
}
