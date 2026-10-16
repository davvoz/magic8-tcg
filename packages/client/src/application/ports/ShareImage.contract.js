/**
 * The picture of a shared game: a ShareCard painted and encoded, ready to
 * upload (rendering/share/CanvasShareImage in the browser).
 *
 * @typedef {object} ShareImage
 * @property {(card: import("../social/shareCard.js").ShareCard) => Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} render
 *   resolves to the picture, a JPEG, base64-encoded
 */

export const SHARE_IMAGE_METHODS = Object.freeze(["render"]);
