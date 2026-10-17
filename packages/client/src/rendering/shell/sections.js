/**
 * The game's five sections, always under the same names: Home (what to do
 * now, and the way to the other four), Play (every way to play), Decks
 * (decks and cards), Market (buying, selling, trading) and Season (the
 * leaderboard and its prizes). Each knows the screen it opens on — which
 * may depend on where the player stands (signed in, the starter deck still
 * to take) — or, when none is available here, why: Home then shows it
 * locked, with that reason, instead of hiding it.
 *
 * A section with more than one screen of its own (Decks: the player's decks
 * and their cards; Market: the shop, the player market and the trades) has
 * them as tabs, in the top bar of each. A tab that cannot be opened stays
 * there too, locked, with its reason.
 *
 * Which section each screen belongs to, and where Back leads, is
 * navigation.js's.
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

/** Why a section (or a tab) has nothing to open without the game server. */
export const OFFLINE_REASON = "Not available offline: it needs the game server.";

/**
 * Where a section leads: a screen to open (with what it is told), or why it is locked.
 * @typedef {Readonly<{ scene: string, params?: Readonly<Record<string, unknown>> }> | Readonly<{ locked: string }>} SectionDestination
 * @typedef {Readonly<{ hasScene: (sceneId: string) => boolean, app: import("../../application/AppContext.js").AppContext }>} SectionContext
 *   what a section looks at to choose its screen
 * @typedef {Readonly<{ scene: string, label: string, short?: string, lock?: (context: SectionContext) => string | null }>} SectionTab
 *   one of a section's own screens: `short`, its name where room is short (a phone); `lock`, why it cannot be opened now (null: it can)
 * @typedef {Readonly<{ scene: string, label: string, short: string, locked: string | null }>} TabEntry
 *   a tab as the bar shows it: `locked`, why it cannot be opened (null: it can)
 * @typedef {Readonly<{ id: string, label: string, icon: string, destination: (context: SectionContext) => SectionDestination, tabs: readonly SectionTab[] }>} Section
 *   `tabs`: the section's own screens when it has more than one (none otherwise)
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

/**
 * A tab that needs the player signed in: locked with `reason` while they are not.
 * @param {string} reason
 * @returns {(context: SectionContext) => string | null}
 */
function needsSignIn(reason) {
  return ({ app }) => (app.account === undefined || app.account.state?.status === AccountStatus.SIGNED_OUT ? reason : null);
}

/** @type {readonly Section[]} */
export const SECTIONS = Object.freeze([
  Object.freeze({ id: SectionId.HOME, label: "Home", icon: Icon.HOME, tabs: [], destination: (context) => firstOf(context, [SceneId.HOME]) }),
  Object.freeze({
    id: SectionId.PLAY,
    label: "Play",
    icon: Icon.PLAY,
    tabs: [],
    // Every way to play; without that screen (tools), online play when signed in, else practice against the AI.
    destination: (context) => firstOf(context, accountReady(context) && context.app.online !== undefined ? [SceneId.PLAY, SceneId.ONLINE, SceneId.DECK_SELECTION] : [SceneId.PLAY, SceneId.DECK_SELECTION]),
  }),
  Object.freeze({
    id: SectionId.DECKS,
    label: "Decks",
    icon: Icon.DECKS,
    tabs: Object.freeze([
      Object.freeze({ scene: SceneId.DECKS, label: "My decks", short: "Decks" }),
      Object.freeze({ scene: SceneId.COLLECTION, label: "Collection", short: "Cards", lock: needsSignIn("Sign in to see the cards you own.") }),
    ]),
    destination: (context) => firstOf(context, [SceneId.DECKS, SceneId.DECK_BUILDER]),
  }),
  Object.freeze({
    id: SectionId.MARKET,
    label: "Market",
    icon: Icon.MARKET,
    tabs: Object.freeze([
      Object.freeze({ scene: SceneId.SHOP, label: "Shop" }),
      Object.freeze({ scene: SceneId.MARKET, label: "Player market", short: "Market" }),
      Object.freeze({ scene: SceneId.TRADES, label: "Trades", lock: needsSignIn("Sign in to trade cards with other players.") }),
    ]),
    destination: (context) => firstOf(context, [SceneId.SHOP, SceneId.MARKET]),
  }),
  Object.freeze({ id: SectionId.SEASON, label: "Season", icon: Icon.SEASON, tabs: [], destination: (context) => firstOf(context, [SceneId.SEASON]) }),
]);

/**
 * @param {string} sectionId
 * @returns {Section | undefined}
 */
export function sectionById(sectionId) {
  return SECTIONS.find((section) => section.id === sectionId);
}

/**
 * A section's tabs as the bar shows them: each with why it cannot be opened, if it cannot.
 * @param {Section} section
 * @param {SectionContext} context
 * @returns {readonly TabEntry[]}
 */
export function sectionTabs(section, context) {
  return section.tabs.map((tab) =>
    Object.freeze({ scene: tab.scene, label: tab.label, short: tab.short ?? tab.label, locked: context.hasScene(tab.scene) ? (tab.lock?.(context) ?? null) : OFFLINE_REASON }),
  );
}
