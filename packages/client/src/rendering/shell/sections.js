/**
 * The game's five sections, always on the rail under the same names: Home
 * (what to do now), Play (every way to play), Decks (decks and cards),
 * Market (buying, selling, trading) and Season (the leaderboard and its
 * prizes). Each knows the screen it opens on — which may depend on where
 * the player stands (signed in, the starter deck still to take) — or, when
 * none is available here, why: the rail then shows it locked, with that
 * reason, instead of hiding it.
 *
 * Every screen inside the shell names the section it belongs to, which the
 * rail lights.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { SceneId } from "../scenes/sceneIds.js";
import { Icon } from "../ui/icons.js";

export const SectionId = Object.freeze({
  HOME: "home",
  PLAY: "play",
  DECKS: "decks",
  MARKET: "market",
  SEASON: "season",
});

/** Why a section has nothing to open without the game server. */
const OFFLINE_REASON = "Not available offline: it needs the game server.";

/**
 * Where a section leads: a screen to open (with what it is told), or why it is locked.
 * @typedef {Readonly<{ scene: string, params?: Readonly<Record<string, unknown>> }> | Readonly<{ locked: string }>} SectionDestination
 * @typedef {Readonly<{ hasScene: (sceneId: string) => boolean, app: import("../../application/AppContext.js").AppContext }>} SectionContext
 *   what a section looks at to choose its screen
 * @typedef {Readonly<{ id: string, label: string, icon: string, destination: (context: SectionContext) => SectionDestination }>} Section
 */

/**
 * The first of the screens that exists, or the reason the section is locked.
 * @param {SectionContext} context
 * @param {readonly string[]} scenes in order of preference
 * @returns {SectionDestination}
 */
function firstOf(context, scenes) {
  const scene = scenes.find((sceneId) => context.hasScene(sceneId));
  return scene === undefined ? Object.freeze({ locked: OFFLINE_REASON }) : Object.freeze({ scene });
}

/** @param {SectionContext} context whether the player is signed in and their account is loaded */
function accountReady({ app }) {
  return app.account?.state?.status === AccountStatus.READY;
}

/** @type {readonly Section[]} */
export const SECTIONS = Object.freeze([
  Object.freeze({ id: SectionId.HOME, label: "Home", icon: Icon.HOME, destination: (context) => firstOf(context, [SceneId.MAIN_MENU]) }),
  Object.freeze({
    id: SectionId.PLAY,
    label: "Play",
    icon: Icon.PLAY,
    // Signed in, online play first; otherwise practice against the AI, which needs no account.
    destination: (context) => firstOf(context, accountReady(context) && context.app.online !== undefined ? [SceneId.ONLINE, SceneId.DECK_SELECTION] : [SceneId.DECK_SELECTION]),
  }),
  Object.freeze({
    id: SectionId.DECKS,
    label: "Decks",
    icon: Icon.DECKS,
    destination: (context) => {
      if (!accountReady(context)) {
        return firstOf(context, [SceneId.DECK_BUILDER]);
      }
      return firstOf(context, context.app.account?.needsStarter === true ? [SceneId.STARTER, SceneId.DECK_BUILDER] : [SceneId.COLLECTION, SceneId.DECK_BUILDER]);
    },
  }),
  Object.freeze({ id: SectionId.MARKET, label: "Market", icon: Icon.MARKET, destination: (context) => firstOf(context, [SceneId.SHOP, SceneId.MARKET]) }),
  Object.freeze({ id: SectionId.SEASON, label: "Season", icon: Icon.SEASON, destination: (context) => firstOf(context, [SceneId.LEADERBOARD]) }),
]);

/**
 * @param {string} sectionId
 * @returns {Section | undefined}
 */
export function sectionById(sectionId) {
  return SECTIONS.find((section) => section.id === sectionId);
}
