/**
 * Players' profile pictures as steemitimages.com serves them, in the size
 * the game's screens show (medium): the very picture the player already sees
 * by their opponent, which the service then has ready. Only that host is
 * ever asked, and only for a valid account name: a redirect elsewhere, an
 * answer that is not an image (the service answers JSON when it has none to
 * give) or one too large is no picture.
 */

const DEFAULT_BASE = "https://steemitimages.com";
const DEFAULT_SIZE = "medium";
const DEFAULT_TIMEOUT_MS = 8000;
/** Asked for as a browser asks for an image. */
const REQUEST_HEADERS = Object.freeze({ Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" });
const MAX_BYTES = 512 * 1024;
const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export class SteemitAvatars {
  #fetch;
  #base;
  #size;
  #timeoutMs;

  /**
   * @param {{ fetch: typeof globalThis.fetch, base?: string, size?: "small" | "medium" | "large", timeoutMs?: number }} deps
   */
  constructor({ fetch, base = DEFAULT_BASE, size = DEFAULT_SIZE, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.#fetch = fetch;
    this.#base = new URL(base);
    this.#size = size;
    this.#timeoutMs = timeoutMs;
  }

  /**
   * @param {string} account a valid STEEM account name (the caller checks it)
   * @returns {Promise<{ contentType: string, bytes: Uint8Array } | null>} null: no picture; throws when the host cannot be reached
   */
  async picture(account) {
    const response = await this.#fetch(new URL(`/u/${account}/avatar/${this.#size}`, this.#base), { headers: REQUEST_HEADERS, signal: globalThis.AbortSignal.timeout(this.#timeoutMs) });
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok || new URL(response.url || this.#base.href).host !== this.#base.host || !IMAGE_TYPES.includes(contentType)) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? { contentType, bytes } : null;
  }
}
