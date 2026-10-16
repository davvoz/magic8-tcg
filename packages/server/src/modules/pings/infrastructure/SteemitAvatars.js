/**
 * Players' profile pictures as steemitimages.com serves them (the large
 * size). Only that host is ever asked, and only for a valid account name: a
 * redirect elsewhere, an answer that is not an image (an account without a
 * picture gets JSON) or one too large is no picture.
 */

const DEFAULT_BASE = "https://steemitimages.com";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export class SteemitAvatars {
  #fetch;
  #base;
  #timeoutMs;

  /**
   * @param {{ fetch: typeof globalThis.fetch, base?: string, timeoutMs?: number }} deps
   */
  constructor({ fetch, base = DEFAULT_BASE, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.#fetch = fetch;
    this.#base = new URL(base);
    this.#timeoutMs = timeoutMs;
  }

  /**
   * @param {string} account a valid STEEM account name (the caller checks it)
   * @returns {Promise<{ contentType: string, bytes: Uint8Array } | null>} null: no picture; throws when the host cannot be reached
   */
  async picture(account) {
    const response = await this.#fetch(new URL(`/u/${account}/avatar/large`, this.#base), { signal: globalThis.AbortSignal.timeout(this.#timeoutMs) });
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok || new URL(response.url || this.#base.href).host !== this.#base.host || !IMAGE_TYPES.includes(contentType)) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? { contentType, bytes } : null;
  }
}
