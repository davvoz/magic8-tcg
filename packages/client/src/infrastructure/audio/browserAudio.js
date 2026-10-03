/**
 * The page's side of sound: browsers let audio start only from a gesture,
 * and a page in the background should be quiet. Both are wired here, once,
 * by the composition root.
 */

/** Gestures that count as the player's permission to make sound (iOS takes it from a touch's end, others from its start). */
const GESTURES = Object.freeze(["pointerdown", "pointerup", "touchend", "keydown"]);

/**
 * @typedef {{ unlock: () => void, readonly isUnlocked: boolean, setActive: (active: boolean) => void }} UnlockableOutput
 */

/**
 * Unlocks the output on the player's gestures until it is running.
 * @param {Pick<EventTarget, "addEventListener" | "removeEventListener">} target the window
 * @param {UnlockableOutput} output
 */
export function unlockOnGesture(target, output) {
  const listener = () => {
    output.unlock();
    if (output.isUnlocked) {
      GESTURES.forEach((type) => target.removeEventListener(type, listener, true));
    }
  };
  GESTURES.forEach((type) => target.addEventListener(type, listener, { capture: true, passive: true }));
}

/**
 * Suspends the output while the page is hidden, and wakes it (on the next gesture, if the browser insists) when it is back.
 * @param {Pick<Document, "addEventListener" | "visibilityState">} page the document
 * @param {UnlockableOutput} output
 */
export function followVisibility(page, output) {
  page.addEventListener("visibilitychange", () => output.setActive(page.visibilityState === "visible"));
}

/**
 * The browser's AudioContext (older Safari names it webkitAudioContext), or null where there is none.
 * @param {{ AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }} scope the window
 * @returns {AudioContext | null}
 */
export function createBrowserAudioContext(scope) {
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  return Context === undefined ? null : new Context({ latencyHint: "interactive" });
}
