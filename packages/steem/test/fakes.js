/**
 * A scriptable fake of `fetch` for JSON-RPC nodes: each node URL maps to a
 * handler that receives the parsed request and returns a reply description.
 */

/**
 * @param {Record<string, (request: any, call: number) => { status?: number, body?: string, json?: unknown, reply?: unknown, error?: unknown, delayMs?: number, throws?: boolean }>} handlers
 */
export function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const request = JSON.parse(init.body);
    calls.push({ url, request });
    const handler = handlers[url];
    if (handler === undefined) {
      throw new TypeError("fetch failed");
    }
    const outcome = handler(request, calls.filter((call) => call.url === url).length);
    if (outcome.throws) {
      throw new TypeError("fetch failed");
    }
    if (outcome.delayMs !== undefined) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, outcome.delayMs);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    let body = outcome.body;
    if (body === undefined) {
      const payload = outcome.error === undefined ? { jsonrpc: "2.0", id: request.id, result: outcome.reply } : { jsonrpc: "2.0", id: request.id, error: outcome.error };
      body = JSON.stringify(outcome.json ?? payload);
    }
    return new Response(body, { status: outcome.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl, calls };
}

/** A STEEM account as condenser_api.get_accounts returns it (only the fields we read). */
export function rawAccount(name, postingKeys, { threshold = 1, activeKeys = postingKeys, ownerKeys = activeKeys, balance = "0.000 STEEM", sbdBalance = "0.000 SBD" } = {}) {
  return {
    name,
    balance,
    sbd_balance: sbdBalance,
    owner: { weight_threshold: 1, account_auths: [], key_auths: ownerKeys.map((key) => [key, 1]) },
    posting: { weight_threshold: threshold, account_auths: [["some.app", 1]], key_auths: postingKeys.map((key) => [key, 1]) },
    active: { weight_threshold: 1, account_auths: [], key_auths: activeKeys.map((key) => [key, 1]) },
    memo_key: postingKeys[0],
  };
}
