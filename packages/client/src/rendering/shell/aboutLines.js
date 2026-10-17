/**
 * What the game says about itself, for a player who wants to know (the
 * settings): whether it reaches the game server and who is signed in, what
 * the game holds, where custom decks are kept, and which release they run.
 */
import { IdentityStatus } from "../../application/identity/IdentityService.js";
import { deckStorageText } from "../scenes/deckStorage.js";

/**
 * "Signed in as @alice (steem)", "Not signed in", or that the game plays offline.
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function connectionLine(app) {
  const state = app.identity?.state;
  if (state === undefined || state.status === IdentityStatus.OFFLINE) {
    return "Offline: no game server, practice against the AI";
  }
  if (state.status === IdentityStatus.SIGNED_IN && state.user !== null) {
    return `Signed in as @${state.user.account} (${state.user.network})`;
  }
  return state.status === IdentityStatus.UNKNOWN ? "Connecting to the game server…" : "Not signed in";
}

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
 * The lines, in order.
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function aboutLines(app) {
  return [connectionLine(app), contentLine(app), storageLine(app), versionLine(app)];
}
