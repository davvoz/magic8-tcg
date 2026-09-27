/**
 * Image loader over the browser's <img> decoder, for the card illustrations.
 * Resolves once the image is decoded (drawing it then never stalls a frame);
 * rejects when the file is missing or not an image. Same-origin URLs only:
 * the page CSP allows images from 'self'.
 * @param {string} url
 * @returns {Promise<import("../../rendering/cards/CardIllustrations.js").LoadedImage>}
 */
export async function loadBrowserImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return Object.freeze({ source: image, width: image.naturalWidth, height: image.naturalHeight });
}
