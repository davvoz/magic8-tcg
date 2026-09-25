/**
 * The game verifier page (verify.html): reads the chain straight from STEEM
 * nodes and runs the same verification as the server and the CLI
 * (verifyGameOnChain). Only textContent is ever written to the page.
 */
import { GAME_ID_PATTERN, verifyGameOnChain } from "@magic8/protocol";
import { SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient, recoverSigner } from "@magic8/steem";
import { receiptsKey } from "../src/application/online/AckReceipts.js";
import { checklist, verdictBanner } from "./checklist.js";

const DEFAULT_ROOT = "luciojolly";
const DEFAULT_NODES = Object.freeze(["https://api.moecki.online", "https://api.justyy.com", "https://api.steemit.com"]);
const LOCAL_HOSTS = Object.freeze(["127.0.0.1", "localhost"]);

/** @param {string} id */
const element = (id) => /** @type {HTMLElement & HTMLInputElement} */ (document.getElementById(id));

/** @param {string} text */
function showBanner(text, tone) {
  const banner = element("banner");
  banner.hidden = false;
  banner.className = tone;
  banner.textContent = text;
}

/** @param {boolean | null} ok */
function stateOf(ok) {
  if (ok === null) {
    return "skip";
  }
  return ok ? "ok" : "fail";
}

/** @param {readonly { label: string, ok: boolean | null, detail: string }[]} checks */
function showChecks(checks) {
  const list = element("checks");
  list.replaceChildren(
    ...checks.map((check) => {
      const item = document.createElement("li");
      const state = stateOf(check.ok);
      item.className = state;
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = { ok: "✓", fail: "✗", skip: "–" }[state];
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = check.detail;
      item.append(mark, check.label, detail);
      return item;
    }),
  );
}

/** @param {readonly string[]} nodes */
function readerFor(nodes) {
  // A local test node over plain http is accepted only when the page itself is local.
  const allowInsecureHosts = LOCAL_HOSTS.includes(location.hostname) ? [...LOCAL_HOSTS] : [];
  const rpc = new SteemRpcClient({ nodes, fetch: (input, options) => fetch(input, options), allowInsecureHosts });
  return new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc }) });
}

/** @param {string} gameId */
async function indexedBlocks(gameId) {
  const response = await fetch(`/api/games/${gameId}/chain`, { headers: { accept: "application/json" } });
  return response.ok ? (await response.json()).blocks : null;
}

/** @param {string} hash */
async function fetchContent(hash) {
  const response = await fetch(`/api/content/${hash}`);
  return response.ok ? response.text() : null;
}

/**
 * The signed acks this browser kept while playing the game (docs/tcg/11).
 * @param {string} gameId
 * @returns {unknown[]}
 */
function keptAcks(gameId) {
  try {
    const stored = JSON.parse(globalThis.localStorage.getItem(receiptsKey(gameId)) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

async function run() {
  const gameId = element("game").value.trim();
  const root = element("root").value.trim() || DEFAULT_ROOT;
  const nodes = element("nodes").value.split(",").map((node) => node.trim()).filter((node) => node !== "");
  if (!GAME_ID_PATTERN.test(gameId)) {
    showBanner("A game id is 26 lowercase letters and digits.", "bad");
    return;
  }
  element("run").disabled = true;
  showBanner("Reading the chain…", "wait");
  showChecks([]);
  element("raw").hidden = true;
  try {
    const blocks = element("scan").checked ? null : await indexedBlocks(gameId);
    const result = await verifyGameOnChain({ gameId, reader: readerFor(nodes.length > 0 ? nodes : DEFAULT_NODES), rootAccount: root, blocks, fetchContent, acks: keptAcks(gameId), recoverSigner });
    const banner = verdictBanner(result.verdict, result.acks);
    showBanner(banner.text, banner.tone);
    showChecks(checklist(result, { root, indexed: blocks !== null }));
    element("json").textContent = JSON.stringify(result, null, 2);
    element("raw").hidden = false;
  } catch (error) {
    showBanner(`Could not verify: ${error instanceof Error ? error.message : String(error)}`, "bad");
  } finally {
    element("run").disabled = false;
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  element("game").value = params.get("game") ?? "";
  element("root").value = params.get("root") ?? DEFAULT_ROOT;
  element("nodes").value = params.get("nodes") ?? DEFAULT_NODES.join(", ");
  element("scan").checked = params.get("scan") === "1";
  element("verify").addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
  if (GAME_ID_PATTERN.test(element("game").value)) {
    run();
  }
}

init();
