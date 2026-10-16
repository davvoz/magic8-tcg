/**
 * The navigation shell around a screen: the rail of sections on the left
 * (NavRail) and the top bar (TopBar), both always there, with names that
 * never change. It is the scene's chrome (Scene.chrome): drawn beneath the
 * scene's own tree, reached after it, and left alone when the scene
 * rebuilds itself. Its own dialogs (settings, account, a locked section's
 * reason) are the scene's overlay, above whatever the scene shows.
 *
 * It follows what the bar shows — the player signing in or out, their
 * account loading, unread notifications, their wallet and entries — and
 * lays itself out again on each change, and when the screen changes shape.
 * The wallet and the entries are read once when nothing is known of them.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { IdentityStatus } from "../../application/identity/IdentityService.js";
import { landingScene } from "../scenes/landing.js";
import { SceneId } from "../scenes/sceneIds.js";
import { Button } from "../ui/Button.js";
import { Icon } from "../ui/icons.js";
import { IconButton } from "../ui/IconButton.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { UiNode } from "../ui/UiNode.js";
import { buildAccountDialog } from "./AccountDialog.js";
import { Chip } from "./Chip.js";
import { NavRail } from "./NavRail.js";
import { ProfileButton } from "./ProfileButton.js";
import { SECTIONS, sectionById, sectionTabs } from "./sections.js";
import { buildSettingsDialog } from "./SettingsDialog.js";
import { TopBar } from "./TopBar.js";

/** The bar's controls' widths, wide and compact (a phone, where the wallet shows its figure alone and the profile its picture). */
const WIDTHS = Object.freeze({
  wide: Object.freeze({ wallet: 250, entries: 210, profile: 240, signIn: 150 }),
  compact: Object.freeze({ wallet: 140, entries: 112, profile: 0, signIn: 110 }),
});
/** What gives way first when the bar is short of room: the entries, then the wallet. */
const DROP = Object.freeze({ entries: 1, wallet: 2 });
const WALLET_ASSET = "STEEM";
/** The dialog that says why a section is locked. */
const NOTICE = Object.freeze({ width: 520, height: 230, button: 48 });

/**
 * What the shell needs of the scene it surrounds.
 * @typedef {{
 *   services: import("../scenes/Scene.js").SceneServices,
 *   focusedNode: UiNode | null,
 *   focus: (node: UiNode | null) => void,
 *   showOverlay: (modal: Modal) => void,
 *   hideOverlay: () => void,
 *   backHere: () => Readonly<Record<string, unknown>>,
 * }} ShellHost `services.viewport` is the scene's ContentViewport; `backHere`: what a screen opened from the bar (the
 *   notifications, Info) is told so that its Back comes back to this one
 */

export class Shell {
  /** The rail and the bar, in the scene's (content) coordinates. */
  node = new UiNode({ id: "shell" });
  #host;
  #app;
  /** The screen's SceneId. */
  #scene;
  /** @type {string | null} */
  #section;
  /** @type {import("./TopBar.js").Heading} */
  #heading;
  /** @type {import("./TopBar.js").TopBar | null} */
  #bar = null;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** The design area last laid out for. */
  #laidOutFor = "";
  /** Whether the wallet and the entries were asked for already. */
  #read = false;
  /** Stops the open settings following the sound (muted from anywhere), or null while they are closed. @type {(() => void) | null} */
  #unfollowSound = null;

  /**
   * @param {{ host: ShellHost, app: import("../../application/AppContext.js").AppContext, scene: string, section: string | null, heading: import("./TopBar.js").Heading }} options
   *   `scene`: the screen's SceneId; `section`: the one it belongs to (SectionId), lit on the rail; null for none
   */
  constructor({ host, app, scene, section, heading }) {
    this.#host = host;
    this.#app = app;
    this.#scene = scene;
    this.#section = section;
    this.#heading = heading;
    this.node.unbounded = true;
    const rebuild = () => this.#rebuild();
    // Screens are also built over stand-ins that leave out what they do not use: only what can be followed is.
    for (const service of [app.identity, app.account, app.notifications, app.balance, app.entries]) {
      if (typeof service?.subscribe === "function") {
        this.#unsubscribes.push(service.subscribe(rebuild));
      }
    }
    this.#rebuild();
  }

  /** Stops following the services (the scene is left). */
  detach() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#stopFollowingSound();
  }

  /** The screen changed shape: lay out again if the shell's place on it did. */
  relayout() {
    if (this.#designKey() !== this.#laidOutFor) {
      this.#rebuild();
    }
  }

  /**
   * Names the screen and says what its Back does; what is not given is kept.
   * @param {Partial<import("./TopBar.js").Heading>} heading
   */
  setHeading(heading) {
    const next = Object.freeze({ ...this.#heading, ...heading });
    if (next.title !== this.#heading.title || next.back !== this.#heading.back) {
      this.#heading = next;
      this.#rebuild();
    }
  }

  /** The bar's Back button, when the screen has one. */
  get backButton() {
    return this.#bar?.backButton ?? null;
  }

  /** The scene's view of the screen: the shell's content area. */
  get #viewport() {
    return /** @type {import("./ContentViewport.js").ContentViewport} */ (this.#host.services.viewport);
  }

  /** What the shell's layout depends on: the profile, and where the bar and the content are on the screen. */
  #designKey() {
    const { compact, bar, content } = this.#viewport.shell;
    return `${compact ? "compact" : "wide"}:${bar.x},${bar.y},${bar.width}|${content.x},${content.y},${content.width}x${content.height}`;
  }

  #rebuild() {
    const focused = this.#host.focusedNode;
    const focusedId = focused !== null && isWithin(focused, this.node) ? focused.id : "";
    this.#readOnce();
    this.node.clear();
    this.#laidOutFor = this.#designKey();
    const viewport = this.#viewport;
    const layout = viewport.shell;
    const origin = viewport.origin;
    const screen = () => viewport.bounds;
    const context = { hasScene: this.#host.services.hasScene, app: this.#app };
    const entries = SECTIONS.map((section) => Object.freeze({ section, destination: section.destination(context) }));
    this.node.add(new NavRail({ layout, origin, screen, entries, current: this.#section, onOpen: (entry) => this.#open(entry) }));
    this.#bar = this.node.add(new TopBar({ layout, origin, screen, heading: this.#heading, controls: this.#controls(layout.compact), tabs: this.#tabs(context) }));
    if (focusedId.length > 0) {
      this.#host.focus(this.node.findById(focusedId));
    }
    this.#host.services.requestRender();
  }

  /** The wallet and the entries, read once a signed-in player shows up and nothing is known of them yet. */
  #readOnce() {
    if (this.#read || !this.#signedIn()) {
      return;
    }
    this.#read = true;
    const { balance, entries } = this.#app;
    if (balance?.state !== undefined && balance.state.balances === null && !balance.state.loading) {
      void balance.refresh();
    }
    if (entries?.state !== undefined && entries.state.entries === null && !entries.state.loading) {
      void entries.refresh();
    }
  }

  /** @param {import("./NavRail.js").RailEntry} entry */
  #open({ section, destination }) {
    if ("locked" in destination) {
      this.#showNotice(section.label, destination.locked);
      return;
    }
    this.#host.services.navigate(destination.scene, destination.params ?? {});
  }

  /**
   * The section's tabs, when the screen is one of them.
   * @param {import("./sections.js").SectionContext} context
   * @returns {import("./TopBar.js").BarTabs | null}
   */
  #tabs(context) {
    const section = this.#section === null ? undefined : sectionById(this.#section);
    if (section === undefined || !section.tabs.some((tab) => tab.scene === this.#scene)) {
      return null;
    }
    return Object.freeze({ title: section.label, entries: sectionTabs(section, context), current: this.#scene, onOpen: (/** @type {import("./sections.js").TabEntry} */ tab) => this.#openTab(tab) });
  }

  /** @param {import("./sections.js").TabEntry} tab */
  #openTab(tab) {
    if (tab.locked !== null) {
      this.#showNotice(tab.label, tab.locked);
      return;
    }
    if (tab.scene !== this.#scene) {
      this.#host.services.navigate(tab.scene, {});
    }
  }

  /**
   * A screen the bar opens (the notifications, Info), its Back leading back here; nothing when it is the one on show.
   * @param {string} sceneId
   */
  #openFromBar(sceneId) {
    if (sceneId !== this.#scene) {
      this.#host.services.navigate(sceneId, this.#host.backHere());
    }
  }

  /** Whether the player is signed in and their account is loaded. */
  #signedIn() {
    return this.#app.account?.state?.status === AccountStatus.READY;
  }

  /**
   * The bar's controls, left to right: wallet, entries, notifications, settings, the account.
   * @param {boolean} compact
   * @returns {import("./TopBar.js").BarControl[]}
   */
  #controls(compact) {
    const widths = compact ? WIDTHS.compact : WIDTHS.wide;
    const square = this.#viewport.shell.controls.height;
    /** @type {import("./TopBar.js").BarControl[]} */
    const controls = [];
    const signedIn = this.#signedIn();
    const { balance, entries, notifications } = this.#app;
    if (signedIn && balance?.state !== undefined) {
      controls.push({ id: "shell.wallet", width: widths.wallet, drop: DROP.wallet, make: (box) => new Chip({ id: "shell.wallet", ...box, label: compact ? "" : "Wallet", value: walletText(balance), valueKey: "accentLight" }) });
    }
    const ranked = entries?.ranked ?? null;
    if (signedIn && ranked !== null) {
      controls.push({ id: "shell.entries", width: widths.entries, drop: DROP.entries, make: (box) => new Chip({ id: "shell.entries", ...box, label: compact ? "Entries" : "Ranked entries", value: String(ranked.balance) }) });
    }
    if (signedIn && notifications?.state !== undefined) {
      const badge = unreadBadge(notifications.state.unread);
      controls.push({ id: "notifications", width: square, drop: Infinity, make: (box) => new IconButton({ id: "notifications", ...box, icon: Icon.BELL, badge, enabled: this.#host.services.hasScene(SceneId.NOTIFICATIONS), onActivate: () => this.#openFromBar(SceneId.NOTIFICATIONS) }) });
    }
    controls.push({ id: "settings", width: square, drop: Infinity, make: (box) => new IconButton({ id: "settings", ...box, icon: Icon.SETTINGS, onActivate: () => this.#showSettings() }) });
    controls.push(...this.#accountControls(widths, square, compact));
    return controls;
  }

  /**
   * Signed out, Sign in; signed in, the player's picture (and name), which opens their account. Nothing offline.
   * @param {{ profile: number, signIn: number }} widths
   * @param {number} square
   * @param {boolean} compact
   * @returns {import("./TopBar.js").BarControl[]}
   */
  #accountControls(widths, square, compact) {
    const { services } = this.#host;
    const state = this.#app.identity?.state;
    if (state?.status === IdentityStatus.SIGNED_OUT) {
      return [{ id: "signIn", width: widths.signIn, drop: Infinity, make: (box) => new Button({ id: "signIn", ...box, text: "Sign in", variant: "primary", keepPlate: true, textSize: compact ? "small" : "body", enabled: services.hasScene(SceneId.LOGIN), onActivate: () => services.navigate(SceneId.LOGIN) }) }];
    }
    const user = state?.status === IdentityStatus.SIGNED_IN ? state.user : null;
    if (user === null || user === undefined) {
      return [];
    }
    const width = widths.profile || square;
    return [{ id: "profile", width, drop: Infinity, make: (box) => new ProfileButton({ id: "profile", ...box, account: user.account, named: width > square, onActivate: () => this.#showAccount(user) }) }];
  }

  #showSettings() {
    const { services } = this.#host;
    const close = () => {
      this.#stopFollowingSound();
      this.#host.hideOverlay();
    };
    const openInfo = services.hasScene(SceneId.INFO)
      ? () => {
          close();
          this.#openFromBar(SceneId.INFO);
        }
      : null;
    const { modal, refresh } = buildSettingsDialog({ viewport: services.viewport, app: this.#app, openInfo, onClose: close, requestRender: services.requestRender });
    this.#stopFollowingSound();
    this.#unfollowSound = this.#app.audio?.subscribe(refresh) ?? null;
    this.#host.showOverlay(modal);
  }

  #stopFollowingSound() {
    this.#unfollowSound?.();
    this.#unfollowSound = null;
  }

  /** @param {import("../../application/ports/AuthApi.contract.js").SessionUser} user */
  #showAccount(user) {
    const identity = this.#app.identity;
    if (identity === undefined) {
      return;
    }
    const { services } = this.#host;
    const close = () => this.#host.hideOverlay();
    const onSignOut = () => {
      close();
      void identity.signOut().then(() => services.navigate(landingScene(services.hasScene)));
    };
    this.#host.showOverlay(buildAccountDialog({ viewport: services.viewport, user, method: identity.state.method, onSignOut, onClose: close }));
  }

  /**
   * Why a section cannot be opened here.
   * @param {string} title the section's name
   * @param {string} reason
   */
  #showNotice(title, reason) {
    const { viewport } = this.#host.services;
    const close = () => this.#host.hideOverlay();
    const width = Math.min(NOTICE.width, viewport.logicalWidth - 20);
    const modal = new Modal({ id: "shell.notice", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: NOTICE.height, onDismiss: close });
    const inner = width - 2 * PANEL_INSET;
    modal.panel.add(new Label({ x: PANEL_INSET, y: PANEL_INSET - 8, width: inner, height: 40, text: title, size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
    modal.panel.add(new TextBlock({ x: PANEL_INSET, y: PANEL_INSET + 40, width: inner, height: 60, text: reason, size: "small", align: "center", colorKey: "textMuted" }));
    modal.panel.add(new Button({ id: "shell.notice.close", x: PANEL_INSET, y: NOTICE.height - PANEL_INSET - NOTICE.button, width: inner, height: NOTICE.button, text: "OK", onActivate: close }));
    this.#host.showOverlay(modal);
  }
}

/**
 * "12.500 STEEM", or a dash while unknown ("…" while it is read).
 * @param {import("../../application/wallet/BalanceService.js").BalanceService} balance
 */
function walletText(balance) {
  const amount = balance.amountOf(WALLET_ASSET);
  if (amount !== null) {
    return `${amount} ${WALLET_ASSET}`;
  }
  return balance.state.loading ? "…" : "—";
}

/**
 * What the bell's dot says: nothing when all is read, "99+" past 99.
 * @param {number} unread
 */
function unreadBadge(unread) {
  if (unread === 0) {
    return null;
  }
  return unread > 99 ? "99+" : String(unread);
}

/**
 * @param {UiNode} node
 * @param {UiNode} ancestor
 */
function isWithin(node, ancestor) {
  for (let current = /** @type {UiNode | null} */ (node); current !== null; current = current.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}
