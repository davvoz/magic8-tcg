/**
 * Minimal, strict cookie handling: bounded parsing, no decoding surprises,
 * explicit attributes on every Set-Cookie.
 */

const MAX_COOKIE_HEADER = 4096;
const MAX_COOKIES = 50;
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_NAME_PATTERN = /^__Host-[A-Za-z0-9_-]{1,56}$/;
const VALUE_PATTERN = /^[A-Za-z0-9_-]{0,512}$/;

/**
 * @param {string | undefined} header
 * @returns {ReadonlyMap<string, string>} first value wins for duplicate names
 */
export function parseCookies(header) {
  const cookies = new Map();
  if (typeof header !== "string" || header.length > MAX_COOKIE_HEADER) {
    return cookies;
  }
  for (const part of header.split(";").slice(0, MAX_COOKIES)) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if ((NAME_PATTERN.test(name) || HOST_NAME_PATTERN.test(name)) && VALUE_PATTERN.test(value) && !cookies.has(name)) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/**
 * @param {{ name: string, value: string, maxAgeSeconds: number, secure: boolean, httpOnly?: boolean, sameSite?: "Strict" | "Lax" }} cookie
 * @returns {string}
 */
export function serializeCookie({ name, value, maxAgeSeconds, secure, httpOnly = true, sameSite = "Strict" }) {
  if (!(NAME_PATTERN.test(name) || HOST_NAME_PATTERN.test(name)) || !VALUE_PATTERN.test(value)) {
    throw new TypeError("serializeCookie: invalid name or value");
  }
  if (name.startsWith("__Host-") && !secure) {
    throw new TypeError("serializeCookie: __Host- cookies must be Secure");
  }
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`, `SameSite=${sameSite}`];
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
