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

const CONTRADICTED = new Set(["DIVERGENT", "OMITTED"]);

/**
 * Game protocol v2 (docs/tcg/12): every player move signed by the seat's
 * session key, and each key authorised by the seat account's posting key.
 * @param {any} result
 * @returns {Check[]}
 */
export function signatureChecks({ signatures, sessions }) {
  if (signatures === undefined || signatures.status === "NOT_REQUIRED") {
    return [];
  }
  const checks = [{ label: "Signed moves", ok: signatures.status === "VALID", detail: signatures.status === "VALID" ? "every player move is signed by the player's own session key" : signatures.message }];
  if (sessions.length > 0) {
    const forged = sessions.some((session) => session.status === "FORGED" || session.status === "NOT_AUTHORIZED");
    const allAuthorized = sessions.every((session) => session.status === "AUTHORIZED");
    const detail = sessions.map((session) => `@${session.account} ${session.status.toLowerCase().replaceAll("_", " ")}`).join(", ");
    checks.push({ label: "Session keys", ok: forged ? false : allAuthorized || null, detail });
  }
  return checks;
}
const WORTHLESS = new Set(["BAD_SIGNATURE", "UNTRUSTED_KEY", "INVALID"]);

/**
 * The acks this browser kept for the game (docs/tcg/11), held against the chain.
 * @param {readonly { status: string, seq: number | null }[]} acks
 * @returns {Check}
 */
export function ackCheck(acks) {
  const count = (statuses) => acks.filter((ack) => statuses.has(ack.status));
  const contradicted = count(CONTRADICTED);
  if (contradicted.length > 0) {
    const events = contradicted.map((ack) => `${ack.seq} (${ack.status.toLowerCase()})`).join(", ");
    return { label: "Your signed acks", ok: false, detail: `PROOF: the server acknowledged moves the published game contradicts, at event(s) ${events}` };
  }
  const worthless = count(WORTHLESS).length;
  const agreed = count(new Set(["CONSISTENT"])).length;
  const waiting = count(new Set(["NOT_PUBLISHED"])).length;
  const parts = [`${agreed} of ${acks.length} agree with the chain`];
  if (waiting > 0) {
    parts.push(`${waiting} not published yet`);
  }
  if (worthless > 0) {
    parts.push(`${worthless} prove nothing (bad signature or a key the root never named)`);
  }
  return { label: "Your signed acks", ok: worthless === 0 ? true : null, detail: parts.join("; ") };
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
    ...signatureChecks(result),
    contentCheck(content),
  ];
  if (replay !== null) {
    const outcome = replay.outcome === null ? "" : ` — winner ${replay.outcome.winner ?? "none"} (${replay.outcome.reason})`;
    checks.push({ label: "Reveals and replay", ok: replay.status === "VALID", detail: `${replay.message ?? replay.status.toLowerCase()}${outcome}` });
  }
  if ((result.acks ?? []).length > 0) {
    checks.push(ackCheck(result.acks));
  }
  return Object.freeze(checks.map((check) => Object.freeze(check)));
}

/**
 * @param {string} verdict
 * @param {readonly { status: string }[]} [acks] the kept acks, checked
 * @returns {Readonly<{ text: string, tone: "good" | "bad" | "wait" }>}
 */
export function verdictBanner(verdict, acks = []) {
  if (acks.some((ack) => CONTRADICTED.has(ack.status))) {
    return Object.freeze({ text: "CONTRADICTED — the chain differs from moves the server acknowledged to you (see below)", tone: "bad" });
  }
  if (verdict === "VALID") {
    return Object.freeze({ text: "VALID — every move and the result follow from the chain", tone: "good" });
  }
  if (verdict === "IN_PROGRESS") {
    return Object.freeze({ text: "IN PROGRESS — the game is not over (or not all of it is irreversible yet)", tone: "wait" });
  }
  return Object.freeze({ text: "INVALID — see the failed check below", tone: "bad" });
}
