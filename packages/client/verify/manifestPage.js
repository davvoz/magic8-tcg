/**
 * The manifest tool (manifest.html): builds the canonical `m8tcg_manifest`
 * payload and asks Steem Keychain to sign it with the root account's active
 * key. Nothing is sent to the game server.
 */
import { OperationId, broadcastersManifest } from "@magic8/protocol";

const DEFAULT_ROOT = "luciojolly";

/** @param {string} id */
const element = (id) => /** @type {HTMLElement & HTMLInputElement} */ (document.getElementById(id));

/** @param {string} text @param {"good" | "bad" | ""} tone */
function status(text, tone) {
  element("status").textContent = text;
  element("status").className = tone;
}

/** @returns {string | null} the payload, or null (with the reason shown) when the form is not valid */
function payload() {
  const accounts = element("accounts").value.split(",").map((account) => account.trim()).filter((account) => account !== "");
  const fromBlock = Number(element("from").value.trim() || "0");
  try {
    const json = broadcastersManifest({ accounts, fromBlock });
    element("preview").textContent = json;
    status("", "");
    return json;
  } catch (error) {
    element("preview").textContent = "";
    status(error instanceof Error ? error.message : String(error), "bad");
    return null;
  }
}

function publish() {
  const json = payload();
  const keychain = /** @type {any} */ (window).steem_keychain;
  const root = element("root").value.trim();
  if (json === null || root === "") {
    return;
  }
  if (keychain === undefined || typeof keychain.requestCustomJson !== "function") {
    status("Steem Keychain is not available in this browser. You can publish the JSON above as a custom_json with id m8tcg_manifest and the root account's active authority.", "bad");
    return;
  }
  element("publish").disabled = true;
  status("Waiting for Keychain…", "");
  keychain.requestCustomJson(root, OperationId.MANIFEST, "Active", json, "Magic8: authorise game record broadcasters", (/** @type {any} */ response) => {
    element("publish").disabled = false;
    if (response?.success) {
      const where = response.result?.id ? ` in transaction ${response.result.id}` : "";
      status(`Published${where}. It counts once its block is irreversible (about a minute).`, "good");
    } else {
      status(`Not published: ${response?.message ?? "refused"}`, "bad");
    }
  });
}

element("root").value = new URLSearchParams(location.search).get("root") ?? DEFAULT_ROOT;
for (const id of ["accounts", "from"]) {
  element(id).addEventListener("input", payload);
}
element("manifest").addEventListener("submit", (event) => {
  event.preventDefault();
  publish();
});
payload();
