/**
 * Turns a chain verification (verifyGameOnChain) into the checklist the
 * verifier page shows: what was checked, whether it held, and why not.
 * Pure: no DOM, tested in Node.
 */

/**
 * @typedef {Readonly<{ label: string, ok: boolean | null, detail: string }>} Check ok null: not reached
 */

/** @param {readonly string[]} accounts */
const accountList = (accounts) => (accounts.length === 0 ? "none" : accounts.map((account) => `@${account}`).join(", "));

/** @param {readonly { reason: string }[]} rejected */
function rejectedDetail(rejected) {
  if (rejected.length === 0) {
    return "none seen";
  }
  const reasons = [...new Set(rejected.map((rejection) => rejection.reason))].join(", ");
  return `${rejected.length} ignored (${reasons})`;
}

/** @param {any} content */
function contentCheck(content) {
  if (content.declared === null) {
    return { label: "Content", ok: null, detail: "not declared yet" };
  }
  const state = content.verified ? "downloaded and checked" : "not available";
  return { label: "Content", ok: content.verified, detail: `${content.declared.hash.slice(0, 16)}… (engine ${content.declared.engineVersion}) ${state}` };
}

/**
 * @param {any} result
 * @param {{ root: string, indexed: boolean }} context
 * @returns {readonly Check[]}
 */
export function checklist(result, { root, indexed }) {
  const { history, replay, content } = result;
  const pending = result.pendingBlocks.length > 0 ? `; ${result.pendingBlocks.length} block(s) not irreversible yet` : "";
  /** @type {Check[]} */
  const checks = [
    { label: "Trust anchor", ok: result.broadcasters.length > 0, detail: `@${root} authorises ${accountList(result.broadcasters)}` },
    { label: "Records found", ok: history.records.length > 0, detail: `${history.records.length} record(s) ${indexed ? "in the indexed blocks" : "in the broadcasters' histories"}${pending}` },
    { label: "Forged operations ignored", ok: true, detail: rejectedDetail(result.rejected) },
    { label: "Hash chain and lifecycle", ok: history.status === "COMPLETE", detail: history.problem === null ? `${history.events.length} events, ${history.status.toLowerCase()}` : history.problem.message },
    contentCheck(content),
  ];
  if (replay !== null) {
    const outcome = replay.outcome === null ? "" : ` — winner ${replay.outcome.winner ?? "none"} (${replay.outcome.reason})`;
    checks.push({ label: "Reveals and replay", ok: replay.status === "VALID", detail: `${replay.message ?? replay.status.toLowerCase()}${outcome}` });
  }
  return Object.freeze(checks.map((check) => Object.freeze(check)));
}

/**
 * @param {string} verdict
 * @returns {Readonly<{ text: string, tone: "good" | "bad" | "wait" }>}
 */
export function verdictBanner(verdict) {
  if (verdict === "VALID") {
    return Object.freeze({ text: "VALID — every move and the result follow from the chain", tone: "good" });
  }
  if (verdict === "IN_PROGRESS") {
    return Object.freeze({ text: "IN PROGRESS — the game is not over (or not all of it is irreversible yet)", tone: "wait" });
  }
  return Object.freeze({ text: "INVALID — see the failed check below", tone: "bad" });
}
