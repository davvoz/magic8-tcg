/**
 * JSON-RPC 2.0 client for STEEM API nodes, with failover.
 *
 * - Nodes are tried in priority order; a node that fails at transport level
 *   (network error, timeout, HTTP 429/5xx, unreadable or oversized body,
 *   mismatched id) or answers with a node-specific error (method not
 *   supported, internal error) is skipped and put on cooldown.
 * - Any other JSON-RPC error is an answer, not a node failure: it is thrown
 *   to the caller without trying other nodes.
 * - Responses are size-capped before parsing; `fetch` and the clock are
 *   injected so the client is testable without a network.
 */

export const RpcErrorCode = Object.freeze({
  ALL_NODES_FAILED: "ALL_NODES_FAILED",
  RPC_ERROR: "RPC_ERROR",
});

export class RpcError extends Error {
  /**
   * @param {string} code one of RpcErrorCode
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.details = details ?? null;
  }
}

/** JSON-RPC error codes that mean "this node cannot serve this", not "the request is wrong". */
const NODE_SPECIFIC_ERROR_CODES = Object.freeze(new Set([-32003, -32002, -32603, -32000]));
const RETRYABLE_HTTP_STATUS = (status) => status === 429 || status >= 500;
const METHOD_PATTERN = /^[a-z_]+\.[a-z_]+$/;

class NodeFailure extends Error {}

/**
 * @typedef {{ nodes: readonly string[], fetch?: typeof fetch, now?: () => number, timeoutMs?: number, maxResponseBytes?: number, cooldownMs?: number, allowInsecureHosts?: readonly string[] }} RpcClientOptions
 */

export class SteemRpcClient {
  #nodes;
  #fetch;
  #now;
  #timeoutMs;
  #maxResponseBytes;
  #cooldownMs;
  /** @type {Map<string, number>} node → time until which it is skipped */
  #cooldownUntil = new Map();
  #nextId = 1;

  /** @param {RpcClientOptions} options */
  constructor({ nodes, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000, maxResponseBytes = 4 * 1024 * 1024, cooldownMs = 30_000, allowInsecureHosts = [] }) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new TypeError("SteemRpcClient: at least one node is required");
    }
    this.#nodes = Object.freeze(nodes.map((node) => validateNodeUrl(node, allowInsecureHosts)));
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
    this.#cooldownMs = cooldownMs;
  }

  get nodes() {
    return this.#nodes;
  }

  /**
   * @param {string} method e.g. "condenser_api.get_accounts"
   * @param {unknown} params
   * @returns {Promise<unknown>} the `result` member
   */
  async call(method, params) {
    if (typeof method !== "string" || !METHOD_PATTERN.test(method)) {
      throw new TypeError(`SteemRpcClient: invalid method "${method}"`);
    }
    const failures = [];
    for (const node of this.#orderedNodes()) {
      try {
        return await this.#callNode(node, method, params);
      } catch (error) {
        if (!(error instanceof NodeFailure)) {
          throw error;
        }
        this.#cooldownUntil.set(node, this.#now() + this.#cooldownMs);
        failures.push({ node, reason: error.message });
      }
    }
    throw new RpcError(RpcErrorCode.ALL_NODES_FAILED, `${method}: every node failed`, { failures });
  }

  /** Healthy nodes first (in priority order), then nodes on cooldown as a last resort. */
  #orderedNodes() {
    const now = this.#now();
    const healthy = this.#nodes.filter((node) => (this.#cooldownUntil.get(node) ?? 0) <= now);
    const cooling = this.#nodes.filter((node) => !healthy.includes(node));
    return [...healthy, ...cooling];
  }

  /**
   * @param {string} node
   * @param {string} method
   * @param {unknown} params
   */
  async #callNode(node, method, params) {
    const id = this.#nextId;
    this.#nextId += 1;
    const body = await this.#post(node, JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const reply = parseReply(body, id);
    if (reply.error !== undefined) {
      const code = typeof reply.error?.code === "number" ? reply.error.code : null;
      if (code !== null && NODE_SPECIFIC_ERROR_CODES.has(code)) {
        throw new NodeFailure(`node error ${code}`);
      }
      throw new RpcError(RpcErrorCode.RPC_ERROR, `${method}: ${String(reply.error?.message ?? "error")}`.slice(0, 300), { code });
    }
    return reply.result;
  }

  /**
   * @param {string} node
   * @param {string} payload
   * @returns {Promise<string>}
   */
  async #post(node, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: payload,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw new NodeFailure(RETRYABLE_HTTP_STATUS(response.status) ? `HTTP ${response.status}` : `unexpected HTTP ${response.status}`);
      }
      return await readCapped(response, this.#maxResponseBytes);
    } catch (error) {
      if (error instanceof NodeFailure) {
        throw error;
      }
      throw new NodeFailure(controller.signal.aborted ? "timeout" : "network error");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * @param {string} node
 * @param {readonly string[]} allowInsecureHosts
 */
function validateNodeUrl(node, allowInsecureHosts) {
  let url;
  try {
    url = new URL(node);
  } catch {
    throw new TypeError(`SteemRpcClient: invalid node URL "${node}"`);
  }
  const insecureAllowed = url.protocol === "http:" && allowInsecureHosts.includes(url.hostname);
  if (url.protocol !== "https:" && !insecureAllowed) {
    throw new TypeError(`SteemRpcClient: node "${node}" must use https`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new TypeError("SteemRpcClient: credentials in node URLs are not allowed");
  }
  return url.href;
}

/**
 * Reads a response body, failing as soon as it exceeds `maxBytes`.
 * @param {Response} response
 * @param {number} maxBytes
 */
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new NodeFailure("response too large");
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new NodeFailure("response too large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(concat(chunks, total));
}

/**
 * @param {Uint8Array[]} chunks
 * @param {number} total
 */
function concat(chunks, total) {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * @param {string} body
 * @param {number} id
 * @returns {{ result?: unknown, error?: any }}
 */
function parseReply(body, id) {
  let reply;
  try {
    reply = JSON.parse(body);
  } catch {
    throw new NodeFailure("invalid JSON");
  }
  if (reply === null || typeof reply !== "object" || Array.isArray(reply) || reply.jsonrpc !== "2.0" || reply.id !== id) {
    throw new NodeFailure("invalid JSON-RPC envelope");
  }
  if (!("result" in reply) && !("error" in reply)) {
    throw new NodeFailure("JSON-RPC reply without result");
  }
  return reply;
}
