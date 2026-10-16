/**
 * Brings the player back to their online game when it runs and they are not
 * looking at it. Its clock does not wait: a seat away for a minute has its
 * turn played by the server, away for three minutes it forfeits (TurnClock).
 * - The page learns of a game it did not know (it was reopened, or
 *   reloaded, mid-game) and the player is on the Home screen: straight into
 *   the match, nothing else on screen matters more.
 * - Otherwise, while the game runs and another screen shows: a toast that
 *   stays until it is clicked (it opens the match) or the game ends.
 */
import { OnlineStatus } from "../../application/online/OnlineService.js";
import { SceneId } from "./sceneIds.js";

/** The key of the "your game is in progress" toast (its click opens the match: `open`). */
export const GAME_TOAST_KEY = "online.game";

/**
 * Into the match of the online game in progress. A daily challenge goes back to its own screen when it ends; any
 * other game to the lobby.
 * @param {(sceneId: string, params?: Readonly<Record<string, unknown>>) => unknown} navigate
 * @param {Pick<import("../../application/online/OnlineService.js").OnlineService, "state" | "resume">} online
 */
export function resumeGame(navigate, online) {
  navigate(SceneId.MATCH, { session: online.resume(), againScene: online.state.mode === "daily" ? SceneId.DAILY : SceneId.ONLINE });
}

/**
 * Whether the player has an online game running that they can go back to.
 * @param {Pick<import("../../application/online/OnlineService.js").OnlineService, "state">} online
 */
export function hasGameInProgress(online) {
  const { status, session } = online.state;
  return status === OnlineStatus.PLAYING && session !== null && session.hasSnapshot;
}

/**
 * @param {{
 *   online: Pick<import("../../application/online/OnlineService.js").OnlineService, "state" | "subscribe" | "resume">,
 *   scenes: { readonly currentId: string | null, readonly current: any, navigate: (sceneId: string, params?: Readonly<Record<string, unknown>>) => boolean, onNavigate: (listener: (sceneId: string) => void) => () => void },
 *   toasts: Pick<import("../ui/ToastLayer.js").ToastLayer, "show" | "dismiss">,
 *   nameOf?: (account: string) => string | null,
 * }} deps `nameOf`: a seat's name when it is not a STEEM account (a daily challenge's character)
 * @returns {{ open: () => void }} `open`: into the match of the game in progress
 */
export function returnToGame({ online, scenes, toasts, nameOf = () => null }) {
  /** The game this page last knew of: none yet, so a game already heard of before this started counts as just learned of. @type {string | null} */
  let known = null;
  /** A game the page just learned of, not yet acted on (no screen was showing). @type {string | null} */
  let arriving = null;
  /** The game the toast is up for. @type {string | null} */
  let toastFor = null;

  const open = () => resumeGame(scenes.navigate, online);
  const dismiss = () => {
    if (toastFor !== null) {
      toastFor = null;
      toasts.dismiss(GAME_TOAST_KEY);
    }
  };
  /** Notes a game the page had not heard of: one already running when heard of is "arriving". */
  const note = () => {
    const { status, session } = online.state;
    if (session !== null && session.gameId !== known) {
      known = session.gameId;
      arriving = status === OnlineStatus.PLAYING ? session.gameId : null;
    }
  };
  /** @param {{ gameId: string }} session @param {string | null} opponent */
  const remind = (session, opponent) => {
    if (toastFor === session.gameId) {
      return;
    }
    toastFor = session.gameId;
    const character = opponent === null ? null : nameOf(opponent);
    const against = opponent === null ? "your opponent" : (character ?? "@" + opponent);
    toasts.show({
      key: GAME_TOAST_KEY,
      sticky: true,
      tone: "info",
      ...(opponent === null ? {} : { account: opponent }),
      title: "Resume your game",
      body: `You have a game in progress against ${against}. Its clock is running.`,
    });
  };
  /** @returns {boolean} whether the page just learned of the game and the player, on the Home screen, was taken into it */
  const tookIn = (/** @type {{ gameId: string }} */ session) => {
    if (arriving !== session.gameId) {
      return false;
    }
    arriving = null;
    if (scenes.currentId !== SceneId.HOME && scenes.currentId !== SceneId.MAIN_MENU) {
      return false;
    }
    open();
    return true;
  };
  const follow = () => {
    note();
    const { status, session, opponent } = online.state;
    if (status !== OnlineStatus.PLAYING || session === null || !session.hasSnapshot) {
      dismiss();
      return;
    }
    if (scenes.currentId === SceneId.MATCH && scenes.current?.session === session) {
      arriving = null;
      dismiss();
      return;
    }
    // No screen yet (the page is starting): decided once one shows.
    if (arriving === session.gameId && scenes.currentId === null) {
      return;
    }
    if (!tookIn(session)) {
      remind(session, opponent);
    }
  };
  online.subscribe(follow);
  scenes.onNavigate(follow);
  follow();
  return Object.freeze({ open });
}
