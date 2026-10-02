/**
 * Registers the game's service worker (sw.js at the site root): with
 * app.webmanifest it makes the game installable as an app, and it lets the
 * last version played open without a network. It goes to the network first,
 * so it never serves an old version while the server answers: after a deploy
 * a reload is all it takes to update. Without service workers (an old browser,
 * a page not on https or localhost) the game plays as before.
 */

export const SERVICE_WORKER_URL = "/sw.js";

/**
 * @param {Pick<ServiceWorkerContainer, "register"> | undefined} container navigator.serviceWorker
 * @param {import("../../application/ports/Logger.contract.js").Logger} logger
 * @returns {Promise<boolean>} whether it is registered
 */
export async function registerServiceWorker(container, logger) {
  if (container === undefined) {
    return false;
  }
  try {
    // updateViaCache "none": the browser always asks the server for sw.js, never its HTTP cache.
    await container.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
    return true;
  } catch (error) {
    logger.warn("service worker not registered: the game is not installable", error instanceof Error ? error.message : String(error));
    return false;
  }
}
