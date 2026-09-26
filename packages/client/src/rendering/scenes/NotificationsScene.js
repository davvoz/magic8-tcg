/**
 * Notifications (docs/tcg/15-notifiche.md): the player's feed, newest
 * first. Each entry says what happened, when, shows the cards involved
 * (with their rarity; a card opens its details) and leads to the screen
 * where it can be followed up. What was unread when the screen opened is
 * marked "New" and then read.
 */
import { NotificationTarget, describeNotification } from "../../application/notifications/describeNotification.js";
import { NotificationStatus } from "../../application/notifications/NotificationService.js";
import { CardThumb } from "../cards/CardThumb.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { unknownCard } from "../cards/unknownCard.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { HEADER, INSET } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const PANEL = Object.freeze({ top: 100, height: 770 });
const ENTRY = Object.freeze({ height: 140, gap: 12, textWidth: 640, open: 150 });
const THUMB = Object.freeze({ width: 66, gap: 10, max: 6 });
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
  #app;
  #now;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** Ids unread when the screen opened: shown as new. @type {Set<number>} */
  #fresh = new Set();
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
    this.#fresh = new Set(notifications.state.items.filter((item) => !item.read).map((item) => item.id));
    this.#unsubscribe = notifications.subscribe((state) => {
      for (const item of state.items) {
        if (!item.read) {
          this.#fresh.add(item.id);
        }
      }
      this.#rebuild();
    });
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
    const width = viewport.logicalWidth - 2 * HEADER.sideMargin;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 400, height: HEADER.height, text: "Notifications", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const status = state.error ?? (state.status === NotificationStatus.LOADING ? "Loading…" : "What happened to your orders, trades and sales.");
    this.root.add(new Label({ id: "notifications.status", x: HEADER.sideMargin + 300, y: HEADER.y, width: width - 300 - HEADER.backWidth - 16, height: HEADER.height, text: status, size: "small", align: "left", colorKey: state.error === null ? "textMuted" : "danger", fit: true }));
    const back = this.root.add(new Button({ id: "notifications.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back to menu", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    const panel = this.root.add(new Panel({ x: HEADER.sideMargin, y: PANEL.top, width, height: PANEL.height }));
    this.#buildList(panel, width - 2 * INSET, state);
    this.focus(this.root.findById(focusedId) ?? back);
    this.services.requestRender();
  }

  /**
   * @param {Panel} panel
   * @param {number} width
   * @param {import("../../application/notifications/NotificationService.js").NotificationState} state
   */
  #buildList(panel, width, state) {
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: INSET, width, height: PANEL.height - 2 * INSET }));
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
    const fresh = this.#fresh.has(item.id);
    list.add(new Panel({ id: `notifications.entry.${item.id}`, x: 0, y, width: list.rowWidth, height: ENTRY.height }));
    const x = 16;
    list.add(new Label({ id: `notifications.title.${item.id}`, x, y: y + 10, width: ENTRY.textWidth, height: 30, text: fresh ? `New · ${text.title}` : text.title, weight: "bold", align: "left", colorKey: TONE_KEYS[text.tone], fit: true }));
    list.add(new Label({ x, y: y + 40, width: ENTRY.textWidth, height: 22, text: timeAgo(item.createdAt, now), size: "tiny", align: "left", colorKey: "textMuted" }));
    list.add(new TextBlock({ id: `notifications.body.${item.id}`, x, y: y + 64, width: ENTRY.textWidth, height: ENTRY.height - 72, text: text.body, size: "small", colorKey: "text" }));
    const thumbsX = x + ENTRY.textWidth + 20;
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
          highlight: card.finish === "foil",
          rarity: rarityOf(this.#app, card.definitionId),
          onActivate: definition === undefined ? null : () => this.#showCard(definition, card),
        }),
      );
    });
    const scene = text.target === null ? undefined : TARGET_SCENES[/** @type {keyof typeof TARGET_SCENES} */ (text.target)];
    if (scene !== undefined && this.services.hasScene(scene)) {
      list.add(new Button({ id: `notifications.open.${item.id}`, x: list.rowWidth - ENTRY.open - 16, y: y + (ENTRY.height - 48) / 2, width: ENTRY.open, height: 48, text: "Open", onActivate: () => this.services.navigate(scene) }));
    }
  }

  /**
   * @param {import("../cards/CardDetail.js").CardLike & { id: string }} definition
   * @param {import("../../application/notifications/describeNotification.js").NotificationCard} card
   */
  #showCard(definition, card) {
    const lines = [card.serial === undefined ? "" : `Serial #${card.serial}`, card.finish === undefined ? "" : `Finish: ${card.finish}`, (card.count ?? 1) > 1 ? `Copies: ${card.count}` : ""].filter((line) => line.length > 0);
    this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card: definition, rarity: rarityOf(this.#app, definition.id), lines, onClose: () => this.closeModal() }));
  }

  #notifications() {
    if (this.#app.notifications === undefined) {
      throw new Error("NotificationsScene needs the notification service");
    }
    return this.#app.notifications;
  }
}
