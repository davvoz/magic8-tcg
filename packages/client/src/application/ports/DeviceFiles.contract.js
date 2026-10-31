/**
 * What the device does with text the player takes out of the game (the
 * export of their wallet, docs/tcg/29-google.md): copy it, or save it as a
 * file. Implemented over the browser (infrastructure/browser).
 *
 * @typedef {object} Clipboard
 * @property {(text: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail>} write
 *
 * @typedef {object} FileSaver
 * @property {(name: string, text: string) => import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail} save
 *   offers the text as a file to download, named `name`
 */

export const CLIPBOARD_METHODS = Object.freeze(["write"]);
export const FILE_SAVER_METHODS = Object.freeze(["save"]);
