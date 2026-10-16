/**
 * Where a ping's picture is hosted: the image service cur8.fun uploads its
 * pings' images to (imridd's free_upload_image). It takes the image as
 * base64 in JSON and answers its public address.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_URL_LENGTH = 500;

export class ImriddImageHost {
  #url;
  #fetch;
  #timeoutMs;

  /**
   * @param {{ url: string, fetch: typeof globalThis.fetch, timeoutMs?: number }} deps `url`: the upload endpoint
   */
  constructor({ url, fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.#url = url;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
  }

  /**
   * @param {string} base64 the image, base64-encoded
   * @returns {Promise<string>} where the image is now, an https address; throws when the upload failed
   */
  async upload(base64) {
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: base64 }),
      signal: globalThis.AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`the image host answered ${response.status}`);
    }
    const url = /** @type {any} */ (await response.json())?.image_url;
    if (typeof url !== "string" || url.length > MAX_URL_LENGTH || new URL(url).protocol !== "https:") {
      throw new Error("the image host sent no https address");
    }
    return url;
  }
}
