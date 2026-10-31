/**
 * The Clipboard port over the browser's asynchronous clipboard (it needs a
 * secure page and a tap: the player's tap on Copy is one).
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export class BrowserClipboard {
  #clipboard;

  /** @param {{ clipboard: Pick<globalThis.Clipboard, "writeText"> | undefined }} deps navigator.clipboard, absent on an insecure page */
  constructor({ clipboard }) {
    this.#clipboard = clipboard;
  }

  /** @param {string} text */
  async write(text) {
    if (this.#clipboard === undefined) {
      return fail("CLIPBOARD_UNAVAILABLE", "this browser does not let the game copy");
    }
    try {
      await this.#clipboard.writeText(text);
      return ok(undefined);
    } catch {
      return fail("CLIPBOARD_REFUSED", "the browser refused to copy");
    }
  }
}
