/**
 * The FileSaver port over the browser: the text becomes a file the page
 * offers to download, made here, never sent anywhere.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export class BrowserFileSaver {
  #document;
  #urls;

  /**
   * @param {{ document: Pick<Document, "createElement">, urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> }} deps
   */
  constructor({ document, urls }) {
    this.#document = document;
    this.#urls = urls;
  }

  /**
   * @param {string} name
   * @param {string} text
   */
  save(name, text) {
    let url = null;
    try {
      url = this.#urls.createObjectURL(new globalThis.Blob([text], { type: "text/plain;charset=utf-8" }));
      const link = this.#document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      link.click();
      return ok(undefined);
    } catch {
      return fail("SAVE_FAILED", "the file could not be saved");
    } finally {
      // Once the download has started, the address can go.
      const made = url;
      if (made !== null) {
        globalThis.setTimeout(() => this.#urls.revokeObjectURL(made), 60_000);
      }
    }
  }
}
