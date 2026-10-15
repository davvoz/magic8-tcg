/**
 * One JSON object per line, like the game server's log: what each bot does,
 * readable with `docker compose logs bots`. Nothing secret reaches it (the
 * keys never leave the bots' memory), and an Error is written as its message.
 */

const LEVELS = Object.freeze({ info: 20, warn: 30, error: 40 });

/**
 * @param {unknown} data
 * @returns {unknown}
 */
function plain(data) {
  if (data instanceof Error) {
    return { name: data.name, message: data.message };
  }
  return data;
}

/**
 * @param {{ write: (line: string) => void, level?: string, now?: () => number }} options
 * @returns {import("@magic8/client/src/application/ports/Logger.contract.js").Logger}
 */
export function createLineLogger({ write, level = "info", now = Date.now }) {
  const threshold = LEVELS[/** @type {keyof typeof LEVELS} */ (level)] ?? LEVELS.info;
  const log = (/** @type {keyof typeof LEVELS} */ name) => (/** @type {string} */ message, /** @type {unknown} */ data) => {
    if (LEVELS[name] < threshold) {
      return;
    }
    write(`${JSON.stringify({ at: new Date(now()).toISOString(), level: name, message, ...(data === undefined ? {} : { data: plain(data) }) })}\n`);
  };
  return Object.freeze({ info: log("info"), warn: log("warn"), error: log("error") });
}
