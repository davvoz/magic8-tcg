/**
 * Serves the browser client from fixed mounts. Never lists directories,
 * refuses paths escaping a mount, serves only known file types, and gives
 * HTML pages a strict Content-Security-Policy that allows their own inline
 * blocks (the import map, the host style) by hash instead of 'unsafe-inline'.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
});
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const INLINE_BLOCK = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g;

/**
 * @typedef {Readonly<{ prefix: string, directory: string }>} Mount
 */

/**
 * The page CSP for an HTML document: inline <script> (with content) and <style> blocks are allowed by hash only.
 * @param {string} html
 */
export function pageCsp(html) {
  const hashes = { script: [], style: [] };
  for (const [, tag, content] of html.matchAll(INLINE_BLOCK)) {
    if (content.trim().length > 0) {
      hashes[/** @type {"script" | "style"} */ (tag)].push(`'sha256-${createHash("sha256").update(content).digest("base64")}'`);
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.script.join(" ")}`.trim(),
    `style-src 'self' ${hashes.style.join(" ")}`.trim(),
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export class StaticFiles {
  #mounts;

  /** @param {readonly Mount[]} mounts first matching prefix wins; prefixes end with "/" */
  constructor(mounts) {
    this.#mounts = Object.freeze(mounts.map((mount) => Object.freeze({ ...mount })));
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {string} pathname
   * @returns {Promise<boolean>} false when no file matched (the caller answers 404)
   */
  async handle(request, response, pathname) {
    const path = this.#resolve(pathname);
    if (path === null) {
      return false;
    }
    const type = MIME_TYPES[/** @type {keyof typeof MIME_TYPES} */ (extname(path).toLowerCase())];
    let info;
    try {
      info = await stat(path);
    } catch {
      return false;
    }
    if (type === undefined || !info.isFile() || info.size > MAX_FILE_BYTES) {
      return false;
    }
    const content = await readFile(path);
    const headers = { "Content-Type": type, "Content-Length": content.length, "Cache-Control": "no-cache" };
    if (type.startsWith("text/html")) {
      headers["Content-Security-Policy"] = pageCsp(content.toString("utf8"));
    }
    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : content);
    return true;
  }

  /** @param {string} pathname */
  #resolve(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const mount = this.#mounts.find((candidate) => decoded.startsWith(candidate.prefix));
    if (mount === undefined || decoded.includes("\0")) {
      return null;
    }
    const inner = decoded.slice(mount.prefix.length);
    const target = inner === "" || inner.endsWith("/") ? `${inner}index.html` : inner;
    const absolute = normalize(join(mount.directory, target));
    const root = mount.directory.endsWith(sep) ? mount.directory : mount.directory + sep;
    return absolute.startsWith(root) ? absolute : null;
  }
}
