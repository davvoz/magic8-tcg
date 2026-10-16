/**
 * Where a ping goes on cur8.fun, as the game server tells it: the latest
 * wall, a root post of micro.cur8 under which every ping is a comment, and
 * whether a ping can carry a picture, which the server hosts
 * (docs/tcg/26-ping.md).
 *
 * @typedef {Readonly<{ author: string, permlink: string, images: boolean }>} PingWall
 * @typedef {object} PingsApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<PingWall> | import("@magic8/engine/shared/Result.js").Fail>} wall
 * @property {(image: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} uploadImage
 *   hosts a picture (a JPEG, base64-encoded); resolves to its https address
 */

export const PINGS_API_METHODS = Object.freeze(["wall", "uploadImage"]);
