/**
 * Players' profile pictures: the one each STEEM account set in its profile,
 * served by the STEEM image service (one URL per account, whatever the
 * picture's origin; an account without one gets the service's default).
 * Downloaded on demand like the painted art: until a picture is ready, or
 * when it cannot be loaded, `imageFor` answers null and the painter draws
 * the account's initial instead. The page CSP allows that one image origin.
 */
import { ImageCache } from "./ImageCache.js";

/** @typedef {import("./ImageCache.js").LoadedImage} LoadedImage */
/** @typedef {Readonly<{ imageFor: (account: string) => LoadedImage | null }>} AvatarSource what the painters read (Theme.avatars) */

const AVATAR_SERVICE = "https://steemitimages.com";
/** STEEM account names (3–16 characters); anything else is never put in a URL. */
const ACCOUNT = /^[a-z][a-z0-9-.]{2,15}$/;

/**
 * The picture of an account, 128 px square (crisp up to about 64 logical pixels on a 2× screen).
 * @param {string} account
 */
export function steemAvatarUrl(account) {
  return `${AVATAR_SERVICE}/u/${account}/avatar/medium`;
}

/** @implements {AvatarSource} */
export class Avatars {
  #images;
  #urlFor;

  /**
   * @param {{
   *   loadImage: (url: string) => Promise<LoadedImage>,
   *   onLoaded?: () => void,
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   *   urlFor?: (account: string) => string,
   * }} deps
   */
  constructor({ loadImage, onLoaded = () => undefined, logger, urlFor = steemAvatarUrl }) {
    this.#urlFor = urlFor;
    let warned = false;
    this.#images = new ImageCache({
      loadImage,
      onLoaded,
      // One warning is enough: when the service is down, every picture fails.
      onFailed: ({ url, reason }) => {
        if (!warned) {
          warned = true;
          logger.warn("profile pictures unavailable", { url, reason });
        }
      },
    });
  }

  /**
   * The account's picture when it is ready; otherwise null, starting the download if needed.
   * @param {string} account
   * @returns {LoadedImage | null}
   */
  imageFor(account) {
    return ACCOUNT.test(account) ? this.#images.imageFor(account, this.#urlFor(account)) : null;
  }
}
