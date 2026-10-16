/**
 * Players' profile pictures, passed through the game server so the picture
 * of a shared game can show them (docs/tcg/26-ping.md): a browser may draw
 * another site's image on a canvas, but then can no longer save that canvas
 * as an image, and steemitimages.com does not allow it otherwise. Served as
 * a data URL, the picture is the page's own.
 *
 * Pictures are kept a few minutes (a couple of hundred at most), so sharing
 * games does not fetch the same faces again and again; "no picture" only a
 * minute, since the service may simply not have had it ready.
 */
import { AppError } from "../../../kernel/AppError.js";

const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/;
const KEPT_MS = 10 * 60_000;
const NONE_KEPT_MS = 60_000;
const MAX_KEPT = 200;

/**
 * @typedef {{ picture: (account: string) => Promise<{ contentType: string, bytes: Uint8Array } | null> }} AvatarSource
 */

export class AvatarProxy {
  #source;
  #clock;
  /** @type {Map<string, { dataUrl: string | null, atMs: number }>} */
  #kept = new Map();

  /**
   * @param {{ source: AvatarSource, clock: import("../../../kernel/time.js").Clock }} deps
   */
  constructor({ source, clock }) {
    this.#source = source;
    this.#clock = clock;
  }

  /**
   * @param {unknown} account
   * @returns {Promise<string>} the picture as a data URL; NOT_FOUND when the account has none
   */
  async pictureOf(account) {
    if (typeof account !== "string" || !ACCOUNT.test(account)) {
      throw new AppError("VALIDATION", "not an account name");
    }
    const now = this.#clock.now();
    let kept = this.#kept.get(account);
    if (kept === undefined || now - kept.atMs > (kept.dataUrl === null ? NONE_KEPT_MS : KEPT_MS)) {
      kept = { dataUrl: await this.#fetch(account), atMs: now };
      this.#keep(account, kept);
    }
    if (kept.dataUrl === null) {
      throw new AppError("NOT_FOUND", "this account has no profile picture");
    }
    return kept.dataUrl;
  }

  /** @param {string} account */
  async #fetch(account) {
    let picture;
    try {
      picture = await this.#source.picture(account);
    } catch {
      throw new AppError("CHAIN_UNAVAILABLE", "the profile picture cannot be read right now");
    }
    return picture === null ? null : `data:${picture.contentType};base64,${Buffer.from(picture.bytes).toString("base64")}`;
  }

  /**
   * Keeps a picture, the oldest going when too many are kept.
   * @param {string} account
   * @param {{ dataUrl: string | null, atMs: number }} kept
   */
  #keep(account, kept) {
    this.#kept.delete(account);
    this.#kept.set(account, kept);
    if (this.#kept.size > MAX_KEPT) {
      this.#kept.delete(/** @type {string} */ (this.#kept.keys().next().value));
    }
  }
}
