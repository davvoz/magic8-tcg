/**
 * What the lights living in the painted menu backdrop share (the storm, the
 * glimmer of its gold figures): the contract the backdrop painter and the
 * game loop see, the painting's light laid over itself, and the seeded
 * randomness that makes each of them play the same for the same seed.
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {import("@magic8/engine/shared/geometry.js").Point} Point
 * @typedef {Rect & Readonly<{ image?: import("../images/ImageCache.js").LoadedImage }>} Painting where the
 *   whole painted image lies on screen, cropped parts included, and the image, for the light it catches
 * @typedef {Readonly<{
 *   update: (dtMs: number) => boolean,
 *   draw: (context: CanvasRenderingContext2D, colors: Readonly<Record<string, string>>, painting: Painting) => void,
 * }>} BackdropLight one of the lights in the backdrop (Theme.ambience). `update`: time moves on
 *   (fed by the game loop); whether a frame is needed. `draw`: over the painting and its tint
 */

/** Values drawn from a seed at a time. */
const RANDOM_BLOCK = 64;

/**
 * A point given as fractions of the painting, on screen.
 * @param {Painting} painting
 * @param {{ x: number, y: number }} fraction
 * @returns {Point}
 */
export function onPainting(painting, { x, y }) {
  return { x: painting.x + x * painting.width, y: painting.y + y * painting.height };
}

/**
 * The painting laid over itself (with the "lighter" blend set by the caller)
 * in nested discs around a light, so it brightens most at the centre and
 * fades out by `radius` — only what is bright in it, the gold and the
 * clouds, lights up.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../images/ImageCache.js").LoadedImage} image
 * @param {Rect} painting where the whole image lies
 * @param {{ center: Point, radius: number, alpha: number, steps: number }} light `alpha`: at the centre
 */
export function glint(context, image, painting, { center, radius, alpha, steps }) {
  for (let step = 1; step <= steps; step += 1) {
    context.save();
    context.beginPath();
    context.arc(center.x, center.y, (radius * step) / steps, 0, Math.PI * 2);
    context.clip();
    context.globalAlpha = alpha / steps;
    context.drawImage(image.source, painting.x, painting.y, painting.width, painting.height);
    context.restore();
  }
}

/**
 * An endless deterministic stream of values in [0, 1), drawn from the seed a block at a time.
 * @param {string} seed
 * @returns {() => number}
 */
export function randomStream(seed) {
  let block = 0;
  /** @type {readonly number[]} */
  let values = [];
  let index = 0;
  return () => {
    if (index === values.length) {
      values = unitSequence(hashString(`${seed}#${block}`), RANDOM_BLOCK);
      block += 1;
      index = 0;
    }
    const value = values[index];
    index += 1;
    return value;
  };
}
