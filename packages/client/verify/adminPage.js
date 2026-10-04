/**
 * The operations page (admin.html). It only reads the admin API and asks
 * Keychain to sign refunds and season prizes on the operator's computer; the
 * server decides nothing from what this page says. Only textContent is written.
 */
const REQUEST_HEADER = { "x-m8-request": "1" };
const REFRESH_MS = 15_000;

/** @param {string} id */
const element = (id) => /** @type {HTMLElement & HTMLInputElement} */ (document.getElementById(id));

/** @param {string} text @param {"good" | "bad" | ""} tone */
function notice(text, tone = "") {
  element("notice").textContent = text;
  element("notice").className = tone;
}

/** @param {number} ms */
const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

/**
 * @param {string} path
 * @param {unknown} [body]
 * @param {"GET" | "POST" | "PUT" | "DELETE"} [method]
 */
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const json = body === undefined ? {} : { "content-type": "application/json" };
  const init = method === "GET" ? {} : { method, headers: { ...REQUEST_HEADER, ...json }, body: body === undefined ? undefined : JSON.stringify(body) };
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(answer.error?.message ?? `HTTP ${response.status}`);
  }
  return answer;
}

/**
 * @param {string} tag
 * @param {string | Node} content
 */
function cell(tag, content) {
  const node = document.createElement(tag);
  node.append(content);
  return node;
}

/** @param {readonly (string | Node)[]} cells */
function row(cells) {
  const tr = document.createElement("tr");
  tr.append(...cells.map((content) => cell("td", content)));
  return tr;
}

/**
 * @param {string} label
 * @param {number | string} value
 * @param {"" | "bad" | "wait"} tone
 */
function stat(label, value, tone = "") {
  const box = document.createElement("div");
  box.className = `stat ${tone}`;
  box.append(cell("b", String(value)), label);
  return box;
}

/** @param {Record<string, number>} counts */
const total = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0);

async function showOverview() {
  const overview = await api("/api/admin/overview");
  const waiting = overview.outbox.filter((entry) => entry.status === "BUILT");
  const oldest = waiting.reduce((min, entry) => Math.min(min, entry.oldest), Number.POSITIVE_INFINITY);
  const backlogMinutes = Number.isFinite(oldest) ? Math.round((overview.at - oldest) / 60000) : 0;
  element("stats").replaceChildren(
    stat("open chain alerts", overview.openAlerts, overview.openAlerts > 0 ? "bad" : ""),
    stat("records waiting to publish", total(Object.fromEntries(waiting.map((entry) => [entry.kind, entry.count]))), backlogMinutes > 10 ? "wait" : ""),
    stat("oldest waiting record (min)", backlogMinutes, backlogMinutes > 10 ? "wait" : ""),
    stat("refunds to send", overview.refunds.PENDING ?? 0, (overview.refunds.PENDING ?? 0) > 0 ? "wait" : ""),
    stat("payments awaiting confirmation", overview.paymentsAwaitingConfirmation.count),
    stat("live games", total(overview.games)),
    stat("open orders", total(overview.orders)),
    stat("connected players", overview.runtime.connections),
  );
}

/**
 * Asks Keychain for a transfer from the shop account: a refund or a season prize.
 * @param {{ from: string, to: string, amountText: string, asset: string, memo: string }} transfer
 * @param {string} what "Refund", "Prize"
 * @param {(enabled: boolean) => void} setEnabled
 */
function pay(transfer, what, setEnabled) {
  const keychain = /** @type {any} */ (window).steem_keychain;
  if (keychain === undefined || typeof keychain.requestTransfer !== "function") {
    notice(`Keychain is not available. Send exactly ${transfer.amountText} ${transfer.asset} from @${transfer.from} to @${transfer.to} with memo "${transfer.memo}".`, "bad");
    return;
  }
  setEnabled(false);
  keychain.requestTransfer(transfer.from, transfer.to, transfer.amountText, transfer.memo, transfer.asset, (/** @type {any} */ response) => {
    if (response?.success) {
      notice(`${what} sent to @${transfer.to}; it closes once the chain confirms it.`, "good");
    } else {
      setEnabled(true);
      notice(`${what} not sent: ${response?.message ?? "refused"}`, "bad");
    }
  }, true);
}

/**
 * The button that pays a pending transfer.
 * @param {{ from: string, to: string, amountText: string, asset: string, memo: string }} transfer
 * @param {string} what
 * @param {boolean} pending
 */
function payButton(transfer, what, pending) {
  const button = document.createElement("button");
  button.textContent = "Pay with Keychain";
  button.disabled = !pending;
  button.addEventListener("click", () =>
    pay(transfer, what, (enabled) => {
      button.disabled = !enabled;
    }),
  );
  return button;
}

async function showRefunds() {
  const { refunds } = await api("/api/admin/refunds");
  element("refunds").replaceChildren(
    ...refunds.map((refund) => {
      const button = payButton({ ...refund, to: refund.toAccount }, "Refund", refund.status === "PENDING");
      const status = refund.status === "SENT" ? `sent (${refund.transfer.txId.slice(0, 10)}…), waiting for irreversibility` : "pending";
      return row([`@${refund.toAccount}`, `${refund.amountText} ${refund.asset}`, cell("code", refund.memo), status, button]);
    }),
  );
}

async function showPrizes() {
  const { prizes } = await api("/api/admin/prizes");
  element("prizes").replaceChildren(
    ...prizes.map((prize) => {
      const button = payButton({ ...prize, to: prize.account }, "Prize", prize.status === "PENDING");
      const status = prize.status === "SENT" ? `sent (${prize.transfer.txId.slice(0, 10)}…), waiting for irreversibility` : "pending";
      return row([`${prize.season} #${prize.place}`, `@${prize.account}`, `${prize.amountText} ${prize.asset}`, cell("code", prize.memo), status, button]);
    }),
  );
}

/** @param {any} alert */
function resolveControl(alert) {
  if (alert.resolvedAt !== null) {
    return `resolved ${when(alert.resolvedAt)}`;
  }
  const form = document.createElement("form");
  const note = document.createElement("input");
  note.placeholder = "what you checked or did";
  const button = document.createElement("button");
  button.textContent = "Resolve";
  form.append(note, " ", button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/alerts/${alert.id}/resolve`, { note: note.value.trim() });
      notice(`Alert ${alert.id} resolved.`, "good");
      await refresh();
    } catch (error) {
      notice(`Not resolved: ${error instanceof Error ? error.message : String(error)}`, "bad");
    }
  });
  return form;
}

async function showAlerts() {
  const { alerts } = await api("/api/admin/alerts");
  element("alerts").replaceChildren(...alerts.map((alert) => row([alert.kind, cell("code", JSON.stringify(alert.details)), when(alert.createdAt), resolveControl(alert)])));
}

async function showAudit() {
  const query = new URLSearchParams();
  for (const [name, id] of [["action", "auditAction"], ["target", "auditTarget"]]) {
    if (element(id).value.trim() !== "") {
      query.set(name, element(id).value.trim());
    }
  }
  const { entries } = await api(`/api/admin/audit?${query}`);
  element("audit").replaceChildren(...entries.map((entry) => row([String(entry.seq), when(entry.at), entry.action, `${entry.targetKind ?? ""} ${entry.targetId ?? ""}`, cell("code", JSON.stringify(entry.details))])));
}

async function showMaintenance() {
  const { maintenance } = await api("/api/maintenance");
  const state = element("maintenanceState");
  if (maintenance === null) {
    state.textContent = "No maintenance announced: everything is open.";
  } else {
    const message = maintenance.message === null ? "" : ` ("${maintenance.message}")`;
    state.textContent = `Announced for ${when(Date.parse(maintenance.at))} UTC${message}: new orders, purchases and queue entries are closed.`;
  }
  state.className = maintenance === null ? "muted" : "closed";
  element("maintenanceEnd").disabled = maintenance === null;
}

/** The season being edited in the form, or null when the form adds one. @type {any} */
let editing = null;

/**
 * A datetime-local value (taken as UTC) as the API writes times, and back.
 * @param {string} value
 */
const toUtc = (value) => (value === "" ? null : `${value.slice(0, 16)}:00Z`);
/** @param {string} iso */
const fromUtc = (iso) => iso.slice(0, 16);

/**
 * @param {string} label
 * @param {() => void} onClick
 * @param {boolean} enabled
 */
function actionButton(label, onClick, enabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = !enabled;
  button.addEventListener("click", onClick);
  return button;
}

/** @param {any} season */
function seasonEndText(season) {
  if (season.endsAt !== null) {
    return when(Date.parse(season.endsAt));
  }
  return season.end === null ? "never" : `${when(Date.parse(season.end))} (next season starts)`;
}

async function showSeasons() {
  const view = await api("/api/admin/seasons");
  const pools = element("seasonPool");
  if (pools.options.length !== view.pools.length + 1) {
    const option = (/** @type {string} */ label, /** @type {string} */ value) => Object.assign(document.createElement("option"), { textContent: label, value });
    pools.replaceChildren(option("none", ""), ...view.pools.map((/** @type {string} */ pool) => option(pool, pool)));
  }
  element("seasons").replaceChildren(
    ...view.seasons.map((/** @type {any} */ season) => {
      const name = document.createElement("span");
      name.append(season.name, " ", cell("code", season.id));
      const phase = cell("span", season.phase);
      phase.className = `phase-${season.phase}`;
      const actions = document.createElement("span");
      actions.append(actionButton("Edit", () => editSeason(season), season.phase !== "ended"), actionButton("Delete", () => deleteSeason(season), season.phase === "upcoming"));
      return row([name, when(Date.parse(season.startsAt)), seasonEndText(season), String(season.entryFee), season.prizePool ?? "—", phase, actions]);
    }),
  );
}

/** What the form shows when it adds a season. */
const NEW_SEASON = Object.freeze({ id: "", name: "", startsAt: null, endsAt: null, entryFee: 1, prizePool: null, phase: "new" });

/** @param {any} season null: back to adding a season */
function editSeason(season) {
  editing = season;
  const shown = season ?? NEW_SEASON;
  element("seasonId").value = shown.id;
  element("seasonName").value = shown.name;
  element("seasonStarts").value = shown.startsAt === null ? "" : fromUtc(shown.startsAt);
  element("seasonEnds").value = shown.endsAt === null ? "" : fromUtc(shown.endsAt);
  element("seasonFee").value = String(shown.entryFee);
  element("seasonPool").value = shown.prizePool ?? "";
  // A running season changes only its name and end; the id never changes.
  element("seasonId").disabled = season !== null;
  for (const id of ["seasonStarts", "seasonFee", "seasonPool"]) {
    element(id).disabled = shown.phase === "running";
  }
  element("seasonSave").textContent = season === null ? "Add season" : `Save ${shown.id}`;
  element("seasonCancel").hidden = season === null;
  element(season === null ? "seasonId" : "seasonName").focus();
}

/** @param {any} season */
async function deleteSeason(season) {
  if (!window.confirm(`Delete the season "${season.name}" (${season.id})? It has not started yet.`)) {
    return;
  }
  try {
    await api(`/api/admin/seasons/${encodeURIComponent(season.id)}`, undefined, "DELETE");
    notice(`Season ${season.id} deleted.`, "good");
    if (editing?.id === season.id) {
      editSeason(null);
    }
    await showSeasons();
  } catch (error) {
    notice(`Not deleted: ${error instanceof Error ? error.message : String(error)}`, "bad");
  }
}

element("seasonForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  // A time left as it was goes back exactly (to the second): a running season's start must not move.
  const time = (/** @type {string} */ id, /** @type {string | null} */ original) => (original !== null && element(id).value === fromUtc(original) ? original : toUtc(element(id).value));
  const fields = {
    name: element("seasonName").value.trim(),
    startsAt: time("seasonStarts", editing?.startsAt ?? null),
    endsAt: time("seasonEnds", editing?.endsAt ?? null),
    prizePool: element("seasonPool").value === "" ? null : element("seasonPool").value,
    entryFee: Number(element("seasonFee").value),
  };
  if (editing?.phase === "running" && !window.confirm(`Change the running season "${editing.name}"? Players see the new name and end at once.`)) {
    return;
  }
  try {
    if (editing === null) {
      await api("/api/admin/seasons", { id: element("seasonId").value.trim(), ...fields });
      notice(`Season ${element("seasonId").value.trim()} added.`, "good");
    } else {
      await api(`/api/admin/seasons/${encodeURIComponent(editing.id)}`, fields, "PUT");
      notice(`Season ${editing.id} saved.`, "good");
    }
    editSeason(null);
    await showSeasons();
  } catch (error) {
    notice(`Not saved: ${error instanceof Error ? error.message : String(error)}`, "bad");
  }
});
element("seasonCancel").addEventListener("click", () => editSeason(null));

async function refresh() {
  try {
    await Promise.all([showOverview(), showMaintenance(), showSeasons(), showRefunds(), showPrizes(), showAlerts()]);
  } catch (error) {
    notice(error instanceof Error ? error.message : String(error), "bad");
  }
}

element("maintenanceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const minutes = Number(element("maintenanceMinutes").value);
  if (!window.confirm(`Close new orders, purchases and games now, for a maintenance in ${minutes} minutes?`)) {
    return;
  }
  try {
    const message = element("maintenanceMessage").value.trim();
    await api("/api/admin/maintenance", message === "" ? { minutes } : { minutes, message });
    notice("Maintenance announced: players see the countdown.", "good");
    await showMaintenance();
  } catch (error) {
    notice(`Not announced: ${error instanceof Error ? error.message : String(error)}`, "bad");
  }
});
element("maintenanceEnd").addEventListener("click", async () => {
  try {
    await api("/api/admin/maintenance", undefined, "DELETE");
    notice("Maintenance ended: everything is open again.", "good");
    await showMaintenance();
  } catch (error) {
    notice(`Not ended: ${error instanceof Error ? error.message : String(error)}`, "bad");
  }
});
element("auditForm").addEventListener("submit", (event) => {
  event.preventDefault();
  showAudit().catch((error) => notice(error.message, "bad"));
});
element("auditVerify").addEventListener("click", async () => {
  const result = await api("/api/admin/audit/verify");
  element("auditIntegrity").textContent = result.intact ? "hash chain intact" : `BROKEN at entry ${result.firstBrokenSeq}`;
});
refresh().then(() => showAudit());
window.setInterval(refresh, REFRESH_MS);
