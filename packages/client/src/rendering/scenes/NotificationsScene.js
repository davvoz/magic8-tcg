/**
 * Notifications (docs/tcg/15-notifiche.md): the player's feed, newest
 * first. Each entry says what happened, when, shows the cards involved
 * (with their rarity; a card opens its details) and leads to the screen
 * where it can be followed up (a click on the entry or its Open button).
 * Opening the screen marks everything read; what arrived unread stays lit
 * and marked "New" until the player opens it. Cards received are handed to
 * the collection, which lights them.
 */
import { NotificationTarget, describeNotification } from "../../application/notifications/describeNotification.js";
import { NotificationStatus } from "../../application/notifications/NotificationService.js";
import { CardThumb } from "../cards/CardThumb.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { unknownCard } from "../cards/unknownCard.js";
import { AvatarNode } from "../ui/AvatarNode.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

/**
 * Sizes of the feed, wide and compact (a phone in landscape: lower entries, fewer and smaller thumbnails, the text as wide as what is left).
 * @typedef {Readonly<{ entry: { height: number, gap: number, textWidth: number | null, open: number, openHeight: number, avatar: number }, thumb: { width: number, gap: number, max: number }, title: number, statusX: number }>} FeedMetrics
 *   `entry.textWidth`: null for whatever the thumbnails and Open leave; `entry.avatar`: the portrait leading a notification about another player
 */
/** @type {FeedMetrics} */
const WIDE = Object.freeze({ entry: Object.freeze({ height: 140, gap: 12, textWidth: 640, open: 150, openHeight: 48, avatar: 56 }), thumb: Object.freeze({ width: 66, gap: 10, max: 6 }), title: 400, statusX: 300 });
/** @type {FeedMetrics} */
const COMPACT = Object.freeze({ entry: Object.freeze({ height: 110, gap: 8, textWidth: null, open: 96, openHeight: 46, avatar: 40 }), thumb: Object.freeze({ width: 48, gap: 6, max: 3 }), title: 220, statusX: 220 });
/** The wide feed's panel; a compact one fills the frame's column area. */
const PANEL = Object.freeze({ top: 100, height: 770 });

const LIST_ID = "notifications.list";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TONE_KEYS = Object.freeze({ good: "success", bad: "danger", info: "accent" });

/** Scene a notification's follow-up lives in. */
const TARGET_SCENES = Object.freeze({
  [NotificationTarget.COLLECTION]: SceneId.COLLECTION,
  [NotificationTarget.TRADES]: SceneId.TRADES,
  [NotificationTarget.MARKET]: SceneId.MARKET,
  [NotificationTarget.SHOP]: SceneId.SHOP,
  [NotificationTarget.ONLINE]: SceneId.ONLINE,
});

/**
 * "just now", "5 min ago", "3 h ago", "2 days ago".
 * @param {number} at
 * @param {number} now
 */
export function timeAgo(at, now) {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)} min ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)} h ago`;
  }
  const days = Math.floor(elapsed / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export class NotificationsScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  /** @returns {FeedMetrics} */
  get #m() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  /** Where the feed's panel goes. */
  get #panel() {
    return this.#screen.compact ? { top: this.#screen.columns.top, height: this.#screen.columns.height } : PANEL;
  }

  relayout() {
    this.#rebuild();
  }

  #app;
  #now;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  #scrollY = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now]
   */
  constructor(services, app, now = () => Date.now()) {
    super(services);
    this.#app = app;
    this.#now = now;
  }

  enter() {
    const notifications = this.#notifications();
    this.#unsubscribe = notifications.subscribe(() => this.#rebuild());
    notifications.refresh().then(() => notifications.markAllRead());
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    this.services.navigate(SceneId.MAIN_MENU);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "notifications" });
    super.render(context);
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    const list = this.root.findById(LIST_ID);
    if (list instanceof ScrollList) {
      this.#scrollY = list.scrollY;
    }
    this.root.clear();
    const { viewport } = this.services;
    const state = this.#notifications().state;
    const width = viewport.logicalWidth - 2 * this.#screen.header.sideMargin;
    const { title, statusX } = this.#m;
    this.root.add(new Label({ x: this.#screen.header.sideMargin, y: this.#screen.header.y, width: title, height: this.#screen.header.height, text: "Notifications", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true, fit: true }));
    const status = state.error ?? (state.status === NotificationStatus.LOADING ? "Loading…" : "What happened to your orders, trades and sales.");
    this.root.add(new Label({ id: "notifications.status", x: this.#screen.header.sideMargin + statusX, y: this.#screen.header.y, width: width - statusX - this.#screen.header.backWidth - 16, height: this.#screen.header.height, text: status, size: "small", align: "left", colorKey: state.error === null ? "textMuted" : "danger", fit: true }));
    const back = this.root.add(new Button({ id: "notifications.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: this.#screen.backText, onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.header.sideMargin, y: this.#panel.top, width, height: this.#panel.height }));
    this.#buildList(panel, width - 2 * this.#screen.inset, state);
    this.focus(this.root.findById(focusedId) ?? back);
    this.services.requestRender();
  }

  /**
   * @param {Panel} panel
   * @param {number} width
   * @param {import("../../application/notifications/NotificationService.js").NotificationState} state
   */
  #buildList(panel, width, state) {
    const ENTRY = this.#m.entry;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: this.#screen.inset, y: this.#screen.inset, width, height: this.#panel.height - 2 * this.#screen.inset }));
    if (state.items.length === 0) {
      const empty = state.status === NotificationStatus.LOADING ? "Loading…" : "Nothing yet. When your cards arrive, someone answers a trade or buys your card, you will find it here.";
      list.add(new TextBlock({ id: "notifications.empty", x: 0, y: 0, width: list.rowWidth, height: 80, text: empty, size: "body", colorKey: "textMuted" }));
      list.contentHeight = 80;
      return;
    }
    const now = this.#now();
    state.items.forEach((item, index) => this.#buildEntry(list, item, index * (ENTRY.height + ENTRY.gap), now));
    let height = state.items.length * (ENTRY.height + ENTRY.gap) - ENTRY.gap;
    if (state.more) {
      list.add(new Button({ id: "notifications.more", x: 0, y: height + ENTRY.gap, width: list.rowWidth, height: 52, text: "Show older", onActivate: () => this.#notifications().loadMore() }));
      height += ENTRY.gap + 52;
    }
    list.contentHeight = height;
    list.scrollTo(this.#scrollY);
  }

  /**
   * @param {ScrollList} list
   * @param {import("../../application/ports/NotificationsApi.contract.js").PlayerNotification} item
   * @param {number} y
   * @param {number} now
   */
  #buildEntry(list, item, y, now) {
    const text = describeNotification(item, this.#app.content.catalog);
    const fresh = this.#notifications().state.unopened.has(item.id);
    const open = this.#followUp(item, text);
    const { entry: ENTRY, thumb: THUMB } = this.#m;
    list.add(new Panel({ id: `notifications.entry.${item.id}`, x: 0, y, width: list.rowWidth, height: ENTRY.height, glowKey: fresh ? "accent" : null, onActivate: open, smallCorners: this.#screen.compact }));
    // A notification about another player leads with their portrait; the texts move over for it.
    const lead = text.account === undefined ? 0 : ENTRY.avatar + 16;
    if (text.account !== undefined) {
      list.add(new AvatarNode({ id: `notifications.avatar.${item.id}`, x: 16, y: y + 12, size: ENTRY.avatar, account: text.account }));
    }
    const x = 16 + lead;
    // The texts' column: fixed when wide, whatever the thumbnails and Open leave on a phone.
    const column = ENTRY.textWidth ?? list.rowWidth - 16 - THUMB.max * (THUMB.width + THUMB.gap) - ENTRY.open - 2 * 16;
    const textWidth = column - lead;
    list.add(new Label({ id: `notifications.title.${item.id}`, x, y: y + 10, width: textWidth, height: 30, text: fresh ? `New · ${text.title}` : text.title, weight: "bold", align: "left", colorKey: TONE_KEYS[text.tone], fit: true }));
    list.add(new Label({ x, y: y + 40, width: textWidth, height: 22, text: timeAgo(item.createdAt, now), size: "tiny", align: "left", colorKey: "textMuted" }));
    list.add(new TextBlock({ id: `notifications.body.${item.id}`, x, y: y + 64, width: textWidth, height: ENTRY.height - 72, text: text.body, size: "small", colorKey: "text" }));
    const thumbsX = 16 + column + (this.#screen.compact ? 12 : 20);
    text.cards.slice(0, THUMB.max).forEach((card, index) => {
      const definition = this.#app.content.catalog.get(card.definitionId);
      list.add(
        new CardThumb({
          id: `notifications.card.${item.id}.${index}`,
          x: thumbsX + index * (THUMB.width + THUMB.gap),
          y: y + 12,
          width: THUMB.width,
          card: definition ?? { ...unknownCard(card.definitionId), text: "" },
          caption: card.caption ?? ((card.count ?? 1) > 1 ? `× ${card.count}` : ""),
          rarity: rarityOf(this.#app, card.definitionId),
          onActivate: definition === undefined ? null : () => this.#showCard(definition, card),
        }),
      );
    });
    if (open !== null) {
      list.add(new Button({ id: `notifications.open.${item.id}`, x: list.rowWidth - ENTRY.open - 16, y: y + (ENTRY.height - ENTRY.openHeight) / 2, width: ENTRY.open, height: ENTRY.openHeight, text: "Open", variant: fresh ? "primary" : "secondary", onActivate: open }));
    }
  }

  /**
   * What following the notification up does, or null when it leads nowhere here.
   * @param {import("../../application/ports/NotificationsApi.contract.js").PlayerNotification} item
   * @param {import("../../application/notifications/describeNotification.js").NotificationText} text
   * @returns {(() => void) | null}
   */
  #followUp(item, text) {
    const scene = text.target === null ? undefined : TARGET_SCENES[/** @type {keyof typeof TARGET_SCENES} */ (text.target)];
    return scene !== undefined && this.services.hasScene(scene) ? () => this.#open(item, text, scene) : null;
  }

  /**
   * Follows a notification up: it stops being lit, and the collection is
   * told which cards came with it so it can light them.
   * @param {import("../../application/ports/NotificationsApi.contract.js").PlayerNotification} item
   * @param {import("../../application/notifications/describeNotification.js").NotificationText} text
   * @param {string} scene
   */
  #open(item, text, scene) {
    const fresh = text.cards.map((card) => Object.freeze({ definitionId: card.definitionId, count: card.count ?? 1, serial: card.serial }));
    this.services.navigate(scene, scene === SceneId.COLLECTION ? { fresh, from: SceneId.NOTIFICATIONS } : {});
    // After leaving: this screen no longer listens, so it is not rebuilt under the click.
    this.#notifications().markOpened(item.id);
  }

  /**
   * @param {import("../cards/CardDetail.js").CardLike & { id: string }} definition
   * @param {import("../../application/notifications/describeNotification.js").NotificationCard} card
   */
  #showCard(definition, card) {
    const lines = [card.serial === undefined ? "" : `Serial #${card.serial}`, (card.count ?? 1) > 1 ? `Copies: ${card.count}` : ""].filter((line) => line.length > 0);
    this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card: definition, rarity: rarityOf(this.#app, definition.id), lines, onClose: () => this.closeModal() }));
  }

  #notifications() {
    if (this.#app.notifications === undefined) {
      throw new Error("NotificationsScene needs the notification service");
    }
    return this.#app.notifications;
  }
}
