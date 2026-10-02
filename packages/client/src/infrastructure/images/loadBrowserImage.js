/**
 * Image loader over the browser's <img> decoder, for the painted art (card
 * illustrations, the coin of the opening toss).
 * Resolves once the image is decoded (drawing it then never stalls a frame);
 * rejects when the file is missing or not an image. Same-origin URLs only:
 * the page CSP allows images from 'self'.
 * @param {string} url
 * @returns {Promise<import("../../rendering/images/ImageCache.js").LoadedImage>}
 */
export async function loadBrowserImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return Object.freeze({ source: image, width: image.naturalWidth, height: image.naturalHeight });
}

/**
 * A loader that keeps images no wider than `maxWidth`: a larger one is
 * decoded, scaled down once (createImageBitmap) and the full-size decode let
 * go. A phone draws a card's illustration a few hundred pixels wide, and 93
 * full-size illustrations decoded at once (about 4 MB each) are more memory
 * than a phone's browser grants a page. Where createImageBitmap is missing
 * the image is kept as decoded.
 * @param {number} maxWidth
 * @returns {(url: string) => Promise<import("../../rendering/images/ImageCache.js").LoadedImage>}
 */
export function scaledImageLoader(maxWidth) {
  return async (url) => {
    const loaded = await loadBrowserImage(url);
    if (loaded.width <= maxWidth || typeof globalThis.createImageBitmap !== "function") {
      return loaded;
    }
    const height = Math.max(1, Math.round((loaded.height * maxWidth) / loaded.width));
    const bitmap = await globalThis.createImageBitmap(/** @type {HTMLImageElement} */ (loaded.source), { resizeWidth: maxWidth, resizeHeight: height, resizeQuality: "high" });
    return Object.freeze({ source: bitmap, width: bitmap.width, height: bitmap.height });
  };
}
