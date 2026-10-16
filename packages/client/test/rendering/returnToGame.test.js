/**
 * Back to an online game the player is not looking at while it runs: a page
 * reopened mid-game goes straight into the match from the main menu; on any
 * other screen a toast stays up until it is clicked or the game ends.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OnlineStatus } from "../../src/application/online/OnlineService.js";
import { GAME_TOAST_KEY, returnToGame } from "../../src/rendering/scenes/returnToGame.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";

/** A running game's session, as OnlineService holds it. */
const session = (gameId = "g1") => ({ gameId, hasSnapshot: true });

function world({ scene = /** @type {string | null} */ (SceneId.MAIN_MENU) } = {}) {
  const listeners = new Set();
  const online = {
    /** @type {any} */
    state: { status: OnlineStatus.OFFLINE, session: null, opponent: null },
    resumed: 0,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    resume: () => ((online.resumed += 1), online.state.session),
    /** The server says something: the state changes. */
    set: (changes) => {
      online.state = { ...online.state, ...changes };
      listeners.forEach((listener) => listener(online.state));
    },
  };
  const navigations = new Set();
  const scenes = {
    currentId: scene,
    /** @type {any} */
    current: null,
    /** @type {{ sceneId: string, params: any }[]} */
    visits: [],
    navigate: (sceneId, params = {}) => {
      scenes.visits.push({ sceneId, params });
      scenes.currentId = sceneId;
      scenes.current = sceneId === SceneId.MATCH ? { session: params.session } : {};
      navigations.forEach((listener) => listener(sceneId));
      return true;
    },
    onNavigate: (listener) => (navigations.add(listener), () => navigations.delete(listener)),
  };
  const toasts = {
    /** @type {any[]} */
    shown: [],
    show: (message) => {
      toasts.shown = [...toasts.shown.filter((toast) => toast.key !== message.key), message];
    },
    dismiss: (key) => {
      toasts.shown = toasts.shown.filter((toast) => toast.key !== key);
    },
  };
  return { online, scenes, toasts };
}

const matches = (scenes) => scenes.visits.filter((visit) => visit.sceneId === SceneId.MATCH).length;

describe("returnToGame", () => {
  it("takes a page reopened mid-game from the main menu straight into the match", () => {
    const { online, scenes, toasts } = world();
    returnToGame({ online, scenes, toasts });
    online.set({ status: OnlineStatus.CONNECTING });
    online.set({ status: OnlineStatus.PLAYING, session: session(), opponent: "bob" });
    assert.deepEqual(scenes.visits.map((visit) => visit.sceneId), [SceneId.MATCH]);
    assert.equal(scenes.visits[0].params.session, online.state.session);
    assert.equal(scenes.visits[0].params.againScene, SceneId.ONLINE);
    assert.deepEqual(toasts.shown, []);
  });

  it("does the same from Home, where the game now opens", () => {
    const { online, scenes, toasts } = world({ scene: SceneId.HOME });
    returnToGame({ online, scenes, toasts });
    online.set({ status: OnlineStatus.PLAYING, session: session(), opponent: "bob" });
    assert.deepEqual(scenes.visits.map((visit) => visit.sceneId), [SceneId.MATCH]);
    assert.deepEqual(toasts.shown, []);
  });

  it("brings a daily challenge back to its own screen, and names its character", () => {
    const { online, scenes, toasts } = world({ scene: SceneId.SHOP });
    returnToGame({ online, scenes, toasts, nameOf: (account) => (account === "ai_kael" ? "Kael" : null) });
    online.set({ status: OnlineStatus.PLAYING, session: session(), opponent: "ai_kael", mode: "daily" });
    assert.match(toasts.shown[0].body, /against Kael\./);
    scenes.navigate(SceneId.MAIN_MENU);
    online.set({ status: OnlineStatus.PLAYING, session: session("g2"), opponent: "ai_kael", mode: "daily" });
    assert.equal(scenes.visits.at(-1).params.againScene, SceneId.DAILY);
  });

  it("counts a game heard of before it started as just learned of", () => {
    const { online, scenes, toasts } = world({ scene: null });
    online.set({ status: OnlineStatus.PLAYING, session: session(), opponent: "bob" });
    returnToGame({ online, scenes, toasts });
    scenes.navigate(SceneId.MAIN_MENU);
    assert.equal(matches(scenes), 1);
  });

  it("waits for the first screen when the game is heard of before any shows", () => {
    const { online, scenes, toasts } = world({ scene: null });
    returnToGame({ online, scenes, toasts });
    online.set({ status: OnlineStatus.PLAYING, session: session(), opponent: "bob" });
    assert.deepEqual(scenes.visits, []);
    assert.deepEqual(toasts.shown, []);
    scenes.navigate(SceneId.MAIN_MENU);
    assert.deepEqual(scenes.visits.map((visit) => visit.sceneId), [SceneId.MAIN_MENU, SceneId.MATCH]);
  });

  it("does not pull a busy player away: a toast stays until clicked, then goes when the match shows", () => {
    const { online, scenes, toasts } = world({ scene: SceneId.SHOP });
    const back = returnToGame({ online, scenes, toasts });
    online.set({ status: OnlineStatus.PLAYING, session: session(), opponent: "bob" });
    assert.deepEqual(scenes.visits, [], "the player stays where they are");
    assert.equal(toasts.shown.length, 1);
    const { body, ...toast } = toasts.shown[0];
    assert.deepEqual(toast, { key: GAME_TOAST_KEY, sticky: true, tone: "info", account: "bob", title: "Resume your game" });
    assert.match(body, /game in progress against @bob/);
    online.set({ opponent: "bob" });
    scenes.navigate(SceneId.COLLECTION);
    assert.equal(toasts.shown.length, 1, "shown once, not again on every update or screen");

    back.open();
    assert.equal(scenes.currentId, SceneId.MATCH);
    assert.equal(online.resumed, 1);
    assert.deepEqual(toasts.shown, [], "in the match: no reminder");
  });

  it("reminds again when the player leaves the match while the game runs, and stops when it ends", () => {
    const { online, scenes, toasts } = world({ scene: SceneId.ONLINE });
    returnToGame({ online, scenes, toasts });
    online.set({ status: OnlineStatus.MATCHED, session: { gameId: "g1", hasSnapshot: false }, opponent: "bob" });
    online.set({ status: OnlineStatus.PLAYING, session: session() });
    assert.equal(toasts.shown.length, 1, "on the lobby while it runs");
    scenes.navigate(SceneId.MATCH, { session: online.state.session });
    assert.deepEqual(toasts.shown, []);
    scenes.navigate(SceneId.NOTIFICATIONS);
    assert.equal(toasts.shown.length, 1, "left it (a toast was clicked): reminded");
    online.set({ status: OnlineStatus.OVER });
    assert.deepEqual(toasts.shown, [], "the game is over: nothing to go back to");
    assert.equal(matches(scenes), 1, "never pulled into it");
  });

  it("does not pull into a game the page saw being found, nor count a practice match as the online game", () => {
    const { online, scenes, toasts } = world();
    returnToGame({ online, scenes, toasts });
    online.set({ status: OnlineStatus.MATCHED, session: { gameId: "g1", hasSnapshot: false }, opponent: "bob" });
    online.set({ status: OnlineStatus.PLAYING, session: session() });
    assert.equal(matches(scenes), 0, "not a reopened page");
    assert.equal(toasts.shown.length, 1);
    scenes.navigate(SceneId.MATCH, { session: { gameId: "practice" } });
    assert.equal(toasts.shown.length, 1, "a practice match is not the online game");
  });
});
