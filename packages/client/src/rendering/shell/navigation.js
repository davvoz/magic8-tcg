/**
 * Where each screen lives and where its Back leads: one rule for every
 * screen inside the shell.
 *
 * - Every screen belongs to one section (or to none: the notifications,
 *   Info).
 * - A section's own screens — the one Home's card opens and its tabs —
 *   have Back to Home, where the sections are (Home itself has none); the
 *   tabs are the way around within the section.
 * - Any other screen goes Back to the screen it was opened from, when that
 *   one said so (`back`, with what it is told again, `backParams`), and
 *   otherwise to its section's own screen (Home for a screen of no
 *   section). Never to a menu it did not come from.
 *
 * A screen that opens another hands it `returnTo(...)` so that Back there
 * comes back to it, as it was (and its own Back still leads where it did).
 */
import { SceneId } from "../scenes/sceneIds.js";
import { SectionId, sectionById } from "./sections.js";

/** How many screens deep a trail of Backs is kept; beyond it, the oldest step gives way to its section's screen. */
const MAX_DEPTH = 6;

/** Which section each screen belongs to; a screen not named here belongs to none. @type {ReadonlyMap<string, string>} */
const SCREEN_SECTIONS = new Map([
  [SceneId.HOME, SectionId.HOME],
  [SceneId.PLAY, SectionId.PLAY],
  [SceneId.DAILY, SectionId.PLAY],
  [SceneId.ONLINE, SectionId.PLAY],
  [SceneId.DECK_SELECTION, SectionId.PLAY],
  [SceneId.LIVE_GAMES, SectionId.PLAY],
  [SceneId.GAME_HISTORY, SectionId.PLAY],
  [SceneId.DECKS, SectionId.DECKS],
  [SceneId.COLLECTION, SectionId.DECKS],
  [SceneId.DECK_BUILDER, SectionId.DECKS],
  [SceneId.STARTER, SectionId.DECKS],
  [SceneId.SHOP, SectionId.MARKET],
  [SceneId.MARKET, SectionId.MARKET],
  [SceneId.TRADES, SectionId.MARKET],
  [SceneId.SEASON, SectionId.SEASON],
]);

/**
 * A screen to go back to, and what it is told.
 * @typedef {Readonly<{ scene: string, params: Readonly<Record<string, unknown>> }>} BackTarget
 */

/**
 * The section a screen belongs to, or null for none.
 * @param {string} sceneId
 * @returns {import("./sections.js").Section | null}
 */
export function sectionOf(sceneId) {
  const id = SCREEN_SECTIONS.get(sceneId);
  return id === undefined ? null : (sectionById(id) ?? null);
}

/**
 * Whether a screen is one of its section's own: the one Home's card opens, or one of its tabs.
 * @param {string} sceneId
 * @param {import("./sections.js").SectionContext} context
 */
export function isSectionScreen(sceneId, context) {
  const section = sectionOf(sceneId);
  if (section === null) {
    return false;
  }
  const destination = section.destination(context);
  return ("scene" in destination && destination.scene === sceneId) || section.tabs.some((tab) => tab.scene === sceneId);
}

/**
 * The screen the opener named (`params.back`), when there is one to go back to.
 * @param {string} sceneId the screen Back is for
 * @param {Readonly<Record<string, unknown>>} params what it was opened with
 * @param {(sceneId: string) => boolean} hasScene
 * @returns {BackTarget | null}
 */
export function namedBack(sceneId, params, hasScene) {
  const { back, backParams } = params;
  if (typeof back !== "string" || back === sceneId || !hasScene(back)) {
    return null;
  }
  return Object.freeze({ scene: back, params: isRecord(backParams) ? backParams : Object.freeze({}) });
}

/**
 * Where Back leads from a screen, by the rule above; null when it has no Back.
 * @param {string} sceneId
 * @param {Readonly<Record<string, unknown>>} params what the screen was opened with
 * @param {import("./sections.js").SectionContext} context
 * @returns {BackTarget | null}
 */
export function backTarget(sceneId, params, context) {
  const named = namedBack(sceneId, params, context.hasScene);
  if (named !== null) {
    return named;
  }
  const section = sectionOf(sceneId);
  if (isSectionScreen(sceneId, context)) {
    return section?.id !== SectionId.HOME && context.hasScene(SceneId.HOME) ? Object.freeze({ scene: SceneId.HOME, params: Object.freeze({}) }) : null;
  }
  const home = section === null ? { scene: SceneId.HOME } : section.destination(context);
  if (!("scene" in home) || home.scene === sceneId || !context.hasScene(home.scene)) {
    return null;
  }
  return Object.freeze({ scene: home.scene, params: home.params ?? Object.freeze({}) });
}

/**
 * What a screen tells the one it opens so that Back there returns to it: the screen, what it was opened with
 * (`params`) and, when it was told where its own Back leads, that too. The trail is kept to MAX_DEPTH screens.
 * @param {string} sceneId the screen to come back to
 * @param {Readonly<Record<string, unknown>>} [params] what it is to be opened with again
 * @param {BackTarget | null} [back] where its own Back was named to lead (null: its section's screen, which needs no telling)
 * @returns {Readonly<{ back: string, backParams: Readonly<Record<string, unknown>> }>}
 */
export function returnTo(sceneId, params = {}, back = null) {
  const backParams = back === null ? { ...params } : { ...params, back: back.scene, backParams: back.params };
  return Object.freeze({ back: sceneId, backParams: trimmed(backParams, MAX_DEPTH - 1) });
}

/**
 * The trail of Backs within `depth` more steps: the step beyond it loses its `back`.
 * @param {Readonly<Record<string, unknown>>} params
 * @param {number} depth
 * @returns {Readonly<Record<string, unknown>>}
 */
function trimmed(params, depth) {
  if (typeof params.back !== "string") {
    return Object.freeze(params);
  }
  if (depth <= 0) {
    return Object.freeze(Object.fromEntries(Object.entries(params).filter(([key]) => key !== "back" && key !== "backParams")));
  }
  return Object.freeze({ ...params, backParams: trimmed(isRecord(params.backParams) ? params.backParams : {}, depth - 1) });
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
