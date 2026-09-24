/**
 * Declarative route table. Each route states its security requirements
 * (authentication, CSRF protection, rate limit) next to its handler, so a
 * reviewer sees them in one place and the HttpApp enforces them uniformly.
 */

export const Auth = Object.freeze({ NONE: "none", OPTIONAL: "optional", REQUIRED: "required" });

const METHODS = Object.freeze(["GET", "POST", "PUT", "DELETE"]);
const SEGMENT_PATTERN = /^(?::[a-zA-Z]+|[a-z0-9-]+)$/;
const PARAM_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `body` is sent as JSON; `raw` is sent byte for byte as application/json
 * (for payloads whose exact bytes matter, e.g. hashed content).
 * @typedef {Readonly<{ status: number, body?: unknown, raw?: string, headers?: Readonly<Record<string, string>>, cookies?: readonly string[] }>} RouteResponse
 * @typedef {Readonly<{
 *   method: string,
 *   path: string,
 *   params: Readonly<Record<string, string>>,
 *   query: URLSearchParams,
 *   ip: string,
 *   origin: string | null,
 *   cookies: ReadonlyMap<string, string>,
 *   principal: any,
 *   readJson: () => Promise<unknown>,
 *   header: (name: string) => string | null,
 *   requestId: string,
 * }>} RouteContext
 * @typedef {Readonly<{
 *   method: string,
 *   path: string,
 *   auth?: string,
 *   csrf?: boolean,
 *   rateLimit?: import("./RateLimiter.js").BucketPolicy & { by?: "ip" | "user" },
 *   handler: (context: RouteContext) => Promise<RouteResponse>,
 * }>} RouteDefinition
 */

export class Router {
  /** @type {{ definition: RouteDefinition, segments: readonly string[] }[]} */
  #routes = [];

  /** @param {RouteDefinition} definition */
  add(definition) {
    if (!METHODS.includes(definition.method)) {
      throw new TypeError(`Router: unsupported method ${definition.method}`);
    }
    const segments = definition.path.split("/").slice(1);
    if (!definition.path.startsWith("/") || !segments.every((segment) => SEGMENT_PATTERN.test(segment))) {
      throw new TypeError(`Router: invalid path ${definition.path}`);
    }
    if (this.#routes.some((route) => route.definition.method === definition.method && route.definition.path === definition.path)) {
      throw new TypeError(`Router: duplicate route ${definition.method} ${definition.path}`);
    }
    this.#routes.push({ definition: Object.freeze({ auth: Auth.NONE, csrf: definition.method !== "GET", ...definition }), segments: Object.freeze(segments) });
    return this;
  }

  /**
   * @param {string} method
   * @param {string} path
   * @returns {{ route: RouteDefinition, params: Readonly<Record<string, string>> } | { route: null, methodMismatch: boolean }}
   */
  match(method, path) {
    const segments = path.split("/").slice(1);
    let methodMismatch = false;
    for (const { definition, segments: pattern } of this.#routes) {
      const params = matchSegments(pattern, segments);
      if (params === null) {
        continue;
      }
      if (definition.method === method) {
        return { route: definition, params };
      }
      methodMismatch = true;
    }
    return { route: null, methodMismatch };
  }

  get size() {
    return this.#routes.length;
  }
}

/**
 * @param {readonly string[]} pattern
 * @param {readonly string[]} segments
 * @returns {Readonly<Record<string, string>> | null}
 */
function matchSegments(pattern, segments) {
  if (pattern.length !== segments.length) {
    return null;
  }
  /** @type {Record<string, string>} */
  const params = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = segments[index];
    if (expected.startsWith(":")) {
      if (!PARAM_VALUE_PATTERN.test(actual)) {
        return null;
      }
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return Object.freeze(params);
}
