/** Keyboard bindings. Values are KeyboardEvent.key strings. */
export const KeyMap = Object.freeze({
  CONFIRM: Object.freeze(["Enter", " "]),
  CANCEL: Object.freeze(["Escape"]),
  NEXT: Object.freeze(["ArrowDown", "ArrowRight", "Tab"]),
  PREVIOUS: Object.freeze(["ArrowUp", "ArrowLeft"]),
  END_TURN: Object.freeze(["e", "E"]),
  /** Secondary action on the focused node (card inspect); same as right-click / long-press. */
  INSPECT: Object.freeze(["i", "I"]),
});

/** Keys whose browser default (scrolling, focus change) must be suppressed while the game has focus. */
export const KEYS_WITH_SUPPRESSED_DEFAULT = Object.freeze([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]);

/**
 * @param {string} key
 * @param {readonly string[]} binding
 */
export function isKey(key, binding) {
  return binding.includes(key);
}
