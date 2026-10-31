/**
 * Export wallet (docs/tcg/29-google.md): the account dialog offers it to a
 * Google player only; the dialog shows every key with Copy, and why not when
 * it could not.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SignInMethod } from "../../src/application/identity/IdentityService.js";
import { WalletExportStatus } from "../../src/application/wallet/WalletExport.js";
import { buildAccountDialog } from "../../src/rendering/shell/AccountDialog.js";
import { buildExportWalletDialog } from "../../src/rendering/shell/ExportWalletDialog.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const VIEWPORT = Object.freeze({ logicalWidth: 1280, logicalHeight: 720 });
const COMPACT = Object.freeze({ logicalWidth: 960, logicalHeight: 432, compact: true });
const WALLET = Object.freeze({ account: "newbie", masterPassword: "P5master", owner: "5owner", active: "5active", posting: "5posting", memo: "5memo" });
const USER = Object.freeze({ id: "u1", network: "steem", account: "newbie" });

/** @param {any} root */
function nodes(root) {
  /** @type {any[]} */
  const found = [];
  const visit = (/** @type {any} */ node) => {
    found.push(node);
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return found;
}

/** @param {any} modal */
function texts(modal) {
  const context = new FakeContext2D();
  modal.draw(context, theme);
  return context.texts;
}

describe("Export wallet", () => {
  it("is offered in the account dialog to a Google player only", () => {
    const exported = [];
    const google = buildAccountDialog({ viewport: VIEWPORT, user: USER, method: SignInMethod.GOOGLE, onSignOut: () => undefined, onClose: () => undefined, onExport: () => exported.push(true) });
    const button = nodes(google).find((node) => node.id === "account.export");
    assert.ok(button);
    button.activate();
    assert.deepEqual(exported, [true]);
    const keychain = buildAccountDialog({ viewport: VIEWPORT, user: USER, method: SignInMethod.KEYCHAIN, onSignOut: () => undefined, onClose: () => undefined });
    assert.equal(nodes(keychain).some((node) => node.id === "account.export"), false);
  });

  it("shows every key with Copy, the warning first, wide and on a phone", () => {
    for (const viewport of [VIEWPORT, COMPACT]) {
      const copied = [];
      const modal = buildExportWalletDialog({ viewport, state: { status: WalletExportStatus.SHOWN, wallet: WALLET, error: null }, notice: "", onCopy: (label, text) => copied.push([label, text]), onDownload: () => undefined, onClose: () => undefined });
      const shown = texts(modal);
      assert.ok(shown.some((text) => text.includes("Anyone with these keys controls your account")));
      assert.ok(shown.some((text) => text.includes("@newbie")));
      nodes(modal).find((node) => node.id === "exportWallet.copy.active")?.activate();
      assert.deepEqual(copied, [["Active key", "5active"]]);
      assert.ok(nodes(modal).some((node) => node.id === "exportWallet.download"), "Download file");
    }
    const wide = texts(buildExportWalletDialog({ viewport: VIEWPORT, state: { status: WalletExportStatus.SHOWN, wallet: WALLET, error: null }, notice: "", onCopy: () => undefined, onDownload: () => undefined, onClose: () => undefined }));
    for (const secret of ["P5master", "5owner", "5active", "5posting", "5memo"]) {
      assert.ok(wide.includes(secret), `written out on a wide screen: ${secret}`);
    }
  });

  it("says why the wallet could not be shown", () => {
    const modal = buildExportWalletDialog({ viewport: VIEWPORT, state: { status: WalletExportStatus.FAILED, wallet: null, error: { code: "REAUTH_REQUIRED", message: "x" } }, notice: "", onCopy: () => undefined, onDownload: () => undefined, onClose: () => undefined });
    assert.ok(texts(modal).some((text) => text.includes("Signing in with Google again did not go through")));
  });
});
