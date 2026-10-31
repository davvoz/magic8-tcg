/**
 * The navigation shell around a screen: the top bar (TopBar), with names
 * that never change. There is no rail of sections: Home lists them, and
 * the other sections' screens have Back to Home (navigation.js). It is the scene's chrome (Scene.chrome): drawn beneath the
 * scene's own tree, reached after it, and left alone when the scene
 * rebuilds itself. Its own dialogs (settings, account, a locked section's
 * reason) are the scene's overlay, above whatever the scene shows.
 *
 * It follows what the bar shows — the player signing in or out, their
 * account loading, unread notifications (and challenges open), their wallet and entries, a purchase paid and on its
 * way (ArrivalChip: from any screen, back to the one that follows it) — and
 * lays itself out again on each change, and when the screen changes shape.
 * The wallet and the entries are read once when nothing is known of them.
 * A screen may put buttons of its own in the bar (`setActions`), left of
 * the player's things: Play's live games and the player's own games.
 */
import { roundMoneyText } from "../../application/money/moneyText.js";
import { isArriving } from "../../application/payments/purchaseProgress.js";
import { buyingTrack } from "../../application/sales/SalesService.js";
import { shopTrack } from "../../application/shop/ShopService.js";
import { AccountStatus } from "../../application/account/AccountService.js";
import { IdentityStatus, SignInMethod } from "../../application/identity/IdentityService.js";
import { WalletExportStatus } from "../../application/wallet/WalletExport.js";
import { SceneId } from "../scenes/sceneIds.js";
import { Button } from "../ui/Button.js";
import { Icon } from "../ui/icons.js";
import { Glyph } from "../ui/glyphs.js";
import { IconButton } from "../ui/IconButton.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { UiNode } from "../ui/UiNode.js";
import { buildAccountDialog } from "./AccountDialog.js";
import { buildExportWalletDialog } from "./ExportWalletDialog.js";
import { ArrivalChip } from "./ArrivalChip.js";
import { Chip } from "./Chip.js";
import { ProfileButton } from "./ProfileButton.js";
import { sectionById, sectionTabs } from "./sections.js";
import { buildSettingsDialog } from "./SettingsDialog.js";
import { LogoLight } from "./LogoLight.js";
import { TopBar } from "./TopBar.js";

/** The bar's controls' widths, wide and compact (a phone, where the wallet shows its figure alone and the profile its picture). */
const WIDTHS = Object.freeze({
  wide: Object.freeze({ wallet: 250, entries: 210, profile: 240, signIn: 150, arrival: 190 }),
  compact: Object.freeze({ wallet: 140, entries: 112, profile: 0, signIn: 110, arrival: 96 }),
});
/** What gives way first when the bar is short of room: the entries, then the wallet, the screen's own buttons, a purchase on its way. */
const DROP = Object.freeze({ entries: 1, wallet: 2, action: 3, arrival: 4 });
/** A screen's own button in the bar: its width with its caption (a phone shows the icon alone, square). */
const ACTION_WIDTH = 190;
/** A bar button's room besides its caption (the icon, the gap, the plate's ornate ends), and a caption's width per character. */
const ACTION_CHROME = 124;
const ACTION_CHARACTER = 8.5;
const WALLET_ASSET = "STEEM";
/** The dialog that says why a section is locked. */
const NOTICE = Object.freeze({ width: 520, height: 230, button: 48 });

/**
 * A section and where it leads now.
 * @typedef {Readonly<{ section: import("./sections.js").Section, destination: import("./sections.js").SectionDestination }>} SectionEntry
 */
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

/**
 * @typedef {Readonly<{ id: string, icon: string, caption: string, enabled?: boolean, onActivate: () => void }>} BarAction a screen's own button in the bar
 * @typedef {Readonly<{ scene: string, track: () => import("../../application/payments/purchaseProgress.js").PurchaseTrack | null }>} Arrival
 *   a purchase on its way: the screen that follows it, and where it stands
 */

export class Shell {
  /** The bar, in the scene's (content) coordinates. */
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
  /** The light that lives in the logo: kept across the bar's rebuilds, so it never starts over. */
  #logoLight = new LogoLight();
  /** The screen's own buttons in the bar. @type {readonly BarAction[]} */
  #actions = [];
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** The design area last laid out for. */
  #laidOutFor = "";
  /** Whether the wallet and the entries were asked for already. */
  #read = false;
  /** Stops the open settings following the sound (muted from anywhere), or null while they are closed. @type {(() => void) | null} */
  #unfollowSound = null;
  #now;
  /** The purchase on its way, as last built into the bar. @type {ArrivalChip | null} */
  #arrivalChip = null;
  /** Whether the exported wallet is shown over the screen. */
  #exportShown = false;
  /** What the last Copy or Download of the exported wallet did. */
  #exportNotice = "";

  /**
   * @param {{ host: ShellHost, app: import("../../application/AppContext.js").AppContext, scene: string, section: string | null, heading: import("./TopBar.js").Heading, now?: () => number }} options
   *   `scene`: the screen's SceneId; `section`: the one it belongs to (SectionId), whose tabs the bar shows; null for none;
   *   `now`: the clock a purchase's wait is timed by
   */
  constructor({ host, app, scene, section, heading, now = () => Date.now() }) {
    this.#host = host;
    this.#now = now;
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
    // The challenges open count with the unread notifications: the bar changes only when their number does.
    if (typeof app.lobby?.subscribe === "function") {
      let open = app.lobby.state.incoming.length;
      this.#unsubscribes.push(
        app.lobby.subscribe((state) => {
          if (state.incoming.length !== open) {
            open = state.incoming.length;
            rebuild();
          }
        }),
      );
    }
    // A purchase comes on its way or arrives: the bar changes only then, not at each step of it.
    let arriving = this.#arrivalKey();
    for (const service of [app.shop, app.sales]) {
      if (typeof service?.subscribe === "function") {
        this.#unsubscribes.push(
          service.subscribe(() => {
            if (this.#arrivalKey() !== arriving) {
              arriving = this.#arrivalKey();
              rebuild();
            }
          }),
        );
      }
    }
    // The exported wallet shows over whatever screen the player is on (back from signing in at Google again: Home).
    if (typeof app.walletExport?.subscribe === "function") {
      this.#unsubscribes.push(app.walletExport.subscribe((state) => this.#showExport(state)));
    }
    this.#rebuild();
  }

  /** Stops following the services (the scene is left). */
  /**
   * Moves the logo's light on.
   * @param {number} dtMs
   * @returns {boolean} whether the bar needs drawing again
   */
  update(dtMs) {
    const ticked = this.#arrivalChip?.tick(dtMs) ?? false;
    return this.#logoLight.update(dtMs) || ticked;
  }

  detach() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#stopFollowingSound();
    // The keys go with the screen they were shown on.
    if (this.#exportShown) {
      this.#exportShown = false;
      this.#app.walletExport?.close();
    }
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
    const backChanged = next.back !== this.#heading.back;
    this.#heading = next;
    // The bar shows no title: only a Back that comes or goes changes it.
    if (backChanged) {
      this.#rebuild();
    }
  }

  /**
   * Puts the screen's own buttons in the bar, left of the player's things (none: `[]`).
   * @param {readonly BarAction[]} actions
   */
  setActions(actions) {
    const key = (/** @type {readonly BarAction[]} */ list) => list.map((action) => `${action.id}:${action.caption}:${action.enabled !== false}`).join("|");
    const changed = key(actions) !== key(this.#actions);
    this.#actions = actions;
    if (changed) {
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
    // The logo leads Home, from every screen but Home itself.
    const onHome = this.#scene !== SceneId.HOME && this.#host.services.hasScene(SceneId.HOME) ? () => this.#host.services.navigate(SceneId.HOME) : null;
    this.#bar = this.node.add(new TopBar({ layout, origin, screen, heading: this.#heading, controls: this.#controls(layout.compact), tabs: this.#tabs(context), onHome, light: this.#logoLight }));
    const arrival = this.node.findById("shell.arrival");
    this.#arrivalChip = arrival instanceof ArrivalChip ? arrival : null;
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

  /**
   * Opens a section's screen (Home's cards): a locked one says why instead.
   * @param {string} sectionId one of SectionId
   */
  openSection(sectionId) {
    const section = sectionById(sectionId);
    if (section !== undefined) {
      this.#open({ section, destination: section.destination({ hasScene: this.#host.services.hasScene, app: this.#app }) });
    }
  }

  /** @param {SectionEntry} entry */
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
    return Object.freeze({ entries: sectionTabs(section, context), current: this.#scene, onOpen: (/** @type {import("./sections.js").TabEntry} */ tab) => this.#openTab(tab) });
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
   * What the bell counts: the notifications unread, and the challenges waiting for an answer (they lead the feed while
   * they are open).
   * @param {NonNullable<import("../../application/AppContext.js").AppContext["notifications"]>} notifications
   */
  #unread(notifications) {
    return notifications.state.unread + (this.#app.lobby?.state.incoming.length ?? 0);
  }

  /**
   * A screen the bar opens (the notifications, Info), its Back leading back here; nothing when it is the one on show.
   * @param {string} sceneId
   */
  /**
   * The tickets in the bar, clicked: buying more, quickly. On the Ranked screen its purchase opens in place; anywhere
   * else that screen opens on it, and closing it comes back here.
   */
  #buyTickets() {
    const host = /** @type {{ sceneId?: string, getEntries?: () => void }} */ (/** @type {unknown} */ (this.#host));
    if (host.sceneId === SceneId.RANKED && typeof host.getEntries === "function") {
      host.getEntries();
      return;
    }
    this.#host.services.navigate(SceneId.RANKED, { buy: true, quick: true, ...this.#host.backHere() });
  }

  #openFromBar(sceneId) {
    if (sceneId !== this.#scene) {
      this.#host.services.navigate(sceneId, this.#host.backHere());
    }
  }

  /**
   * The purchase paid and on its way, from the shop or the player market; null for none.
   * @returns {Arrival | null}
   */
  #arrival() {
    const { shop, sales } = this.#app;
    // Screens built over stand-ins may have a shop or a market with nothing bought.
    if (shop?.state?.purchase !== undefined && isArriving(shopTrack(shop.state.purchase))) {
      return { scene: SceneId.SHOP, track: () => shopTrack(shop.state.purchase) };
    }
    if (sales?.state?.buying !== undefined && isArriving(buyingTrack(sales.state.buying))) {
      return { scene: SceneId.MARKET, track: () => buyingTrack(sales.state.buying) };
    }
    return null;
  }

  /**
   * A signed-in player's purchase on its way, but not on the screen that follows it already, step by step.
   * @param {number} width
   * @param {boolean} compact
   * @returns {import("./TopBar.js").BarControl[]}
   */
  #arrivalControls(width, compact) {
    const arrival = this.#signedIn() ? this.#arrival() : null;
    if (arrival === null || arrival.scene === this.#scene) {
      return [];
    }
    const opens = this.#host.services.hasScene(arrival.scene) ? () => this.#openFromBar(arrival.scene) : null;
    return [{ id: "shell.arrival", width, drop: DROP.arrival, make: (box) => new ArrivalChip({ id: "shell.arrival", ...box, compact, track: arrival.track, now: this.#now, onActivate: opens }) }];
  }

  /** What the bar shows of a purchase on its way: where it is followed, or nothing. */
  #arrivalKey() {
    return this.#arrival()?.scene ?? "";
  }

  /** Whether the player is signed in and their account is loaded. */
  #signedIn() {
    return this.#app.account?.state?.status === AccountStatus.READY;
  }

  /**
   * The bar's controls, left to right: the screen's own, wallet, entries, notifications, settings, the account.
   * @param {boolean} compact
   * @returns {import("./TopBar.js").BarControl[]}
   */
  #controls(compact) {
    const widths = compact ? WIDTHS.compact : WIDTHS.wide;
    const square = this.#viewport.shell.controls.height;
    /** @type {import("./TopBar.js").BarControl[]} */
    const controls = this.#actions.map((action) => ({
      id: action.id,
      width: compact ? square : actionWidth(action.caption),
      drop: DROP.action,
      make: (/** @type {import("@magic8/engine/shared/geometry.js").Rect} */ box) => new IconButton({ id: action.id, ...box, icon: action.icon, caption: compact ? "" : action.caption, enabled: action.enabled !== false, onActivate: action.onActivate }),
    }));
    const signedIn = this.#signedIn();
    const { balance, entries, notifications } = this.#app;
    controls.push(...this.#arrivalControls(widths.arrival, compact));
    if (signedIn && balance?.state !== undefined) {
      controls.push({ id: "shell.wallet", width: widths.wallet, drop: DROP.wallet, make: (box) => new Chip({ id: "shell.wallet", ...box, label: compact ? "" : "Wallet", value: walletText(balance), valueKey: "accentLight", glyph: Glyph.STEEM }) });
    }
    const ranked = entries?.ranked ?? null;
    if (signedIn && ranked !== null) {
      controls.push({ id: "shell.entries", width: widths.entries, drop: DROP.entries, make: (box) => new Chip({ id: "shell.entries", ...box, label: compact ? "" : "Ranked tickets", value: String(ranked.balance), glyph: Glyph.TICKET, onActivate: this.#host.services.hasScene(SceneId.RANKED) ? () => this.#buyTickets() : null }) });
    }
    if (signedIn && notifications?.state !== undefined) {
      const badge = unreadBadge(this.#unread(notifications));
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
      void identity.signOut().then(() => services.navigate(SceneId.HOME));
    };
    const walletExport = this.#app.walletExport;
    const onExport =
      walletExport !== undefined && identity.state.method === SignInMethod.GOOGLE
        ? () => {
            close();
            void walletExport.open();
          }
        : null;
    this.#host.showOverlay(buildAccountDialog({ viewport: services.viewport, user, method: identity.state.method, onSignOut, onClose: close, onExport }));
  }

  /**
   * The exported wallet, or why it could not be shown, over the screen while WalletExport says so.
   * @param {import("../../application/wallet/WalletExport.js").WalletExportState} state
   */
  #showExport(state) {
    const walletExport = this.#app.walletExport;
    const shows = state.status === WalletExportStatus.SHOWN || state.status === WalletExportStatus.FAILED;
    if (walletExport === undefined || !shows) {
      if (this.#exportShown) {
        this.#exportShown = false;
        this.#exportNotice = "";
        this.#host.hideOverlay();
      }
      return;
    }
    const redraw = () => this.#showExport(walletExport.state);
    const onCopy = (/** @type {string} */ label, /** @type {string} */ text) => {
      void walletExport.copy(text).then((copied) => {
        this.#exportNotice = copied.ok ? `${label} copied.` : "This browser does not let the game copy: use Download file.";
        redraw();
      });
    };
    const onDownload = () => {
      this.#exportNotice = walletExport.download().ok ? "The file is in your downloads. Keep it somewhere safe." : "The file could not be saved.";
      redraw();
    };
    this.#exportShown = true;
    this.#host.showOverlay(buildExportWalletDialog({ viewport: this.#host.services.viewport, state, notice: this.#exportNotice, onCopy, onDownload, onClose: () => walletExport.close() }));
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
    modal.panel.add(new Label({ x: modal.panel.titleInset, y: PANEL_INSET - 8, width: width - 2 * modal.panel.titleInset, height: 40, text: title, size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
    modal.panel.add(new TextBlock({ x: PANEL_INSET, y: PANEL_INSET + 40, width: inner, height: 60, text: reason, size: "small", align: "center", colorKey: "textMuted" }));
    modal.panel.add(new Button({ id: "shell.notice.close", x: PANEL_INSET, y: NOTICE.height - PANEL_INSET - NOTICE.button, width: inner, height: NOTICE.button, text: "OK", onActivate: close }));
    this.#host.showOverlay(modal);
  }
}

/**
 * A screen's button in the bar: wide enough for its icon and caption between the plate's ornate ends.
 * @param {string} caption
 */
function actionWidth(caption) {
  return Math.max(ACTION_WIDTH, Math.round(ACTION_CHROME + caption.length * ACTION_CHARACTER));
}

/**
 * "12 STEEM" (rounded down: at a glance), or a dash while unknown ("…" while it is read).
 * @param {import("../../application/wallet/BalanceService.js").BalanceService} balance
 */
function walletText(balance) {
  const amount = balance.amountOf(WALLET_ASSET);
  if (amount !== null) {
    return roundMoneyText(amount, WALLET_ASSET);
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
