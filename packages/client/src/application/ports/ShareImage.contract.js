/**
 * The picture of a shared game: a ShareCard painted and encoded, ready to
 * upload (rendering/share/CanvasShareImage in the browser), and the painting
 * itself, so the share dialog shows exactly the picture that is posted.
 *
 * @typedef {Readonly<{ base64: string, image: Readonly<{ source: unknown, width: number, height: number }> }>} SharePicture
 *   `base64`: the JPEG to upload; `image`: the painting, for the screen to draw
 * @typedef {object} ShareImage
 * @property {(card: import("../social/shareCard.js").ShareCard) => Promise<import("@magic8/engine/shared/Result.js").Ok<SharePicture> | import("@magic8/engine/shared/Result.js").Fail>} render
 */

export const SHARE_IMAGE_METHODS = Object.freeze(["render"]);
