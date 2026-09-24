/**
 * The shop: what is on sale on the left; on the right the selected
 * product, what it contains, its pack odds, the quantity and Buy. Paying
 * goes through the wallet (Keychain shows the exact transfer); when the
 * order is fulfilled the cards received are revealed, pack by pack.
 */
import { PurchaseStage, ShopStatus } from "../../application/shop/ShopService.js";
import { CardStrip } from "../cards/CardStrip.js";
import { unknownCard } from "../cards/unknownCard.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { ACTION, COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "shop.products";
const LINE = 28;
const BUY = Object.freeze({ height: 60, width: 420 });
const REVEAL = Object.freeze({ width: 1100, height: 780, row: 44, gap: 6, packGap: 16 });

/** What the player sees at each step of a purchase. */
const STAGE_TEXT = Object.freeze({
  [PurchaseStage.ORDERING]: () => "Creating your order…",
  [PurchaseStage.SIGNING]: (purchase) => `Approve the transfer in Keychain: ${purchase.order.payment.amount} ${purchase.order.payment.asset} to @${purchase.order.payment.to}.`,
  [PurchaseStage.CONFIRMING]: () => "Payment sent. Waiting for the STEEM blockchain to make it final (about a minute)…",
  [PurchaseStage.DONE]: () => "Done: your cards are in your collection.",
});

export class ShopScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {string | null} */
  #selectedId = null;
  #quantity = 1;
  /** The reveal of the last fulfilled order was closed. */
  #revealClosed = false;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    const shop = this.#shop();
    this.#unsubscribe = shop.subscribe(() => this.#rebuild());
    this.#revealClosed = false;
    if (shop.state.status === ShopStatus.IDLE || shop.state.status === ShopStatus.FAILED) {
      shop.load();
    }
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
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "shop" });
    super.render(context);
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    const list = this.root.findById(LIST_ID);
    const scrollY = list instanceof ScrollList ? list.scrollY : 0;
    this.closeModal();
    this.root.clear();
    const products = this.#shop().state.listing?.products ?? [];
    this.#keepSelectionIn(products);
    const back = this.#buildHeader();
    const firstRow = this.#buildProducts(products, scrollY);
    const buy = this.#buildDetail(products.find((product) => product.id === this.#selectedId));
    const reveal = this.#openRevealIfDone();
    this.focus(reveal ?? this.root.findById(focusedId) ?? buy ?? firstRow ?? back);
    this.services.requestRender();
  }

  /**
   * The selected product stays selected while it is on sale; otherwise the first one is.
   * @param {readonly import("../../application/ports/MarketApi.contract.js").Product[]} products
   */
  #keepSelectionIn(products) {
    if (!products.some((product) => product.id === this.#selectedId)) {
      this.#selectedId = products[0]?.id ?? null;
      this.#quantity = 1;
    }
  }

  /** @returns {Button} */
  #buildHeader() {
    const { viewport } = this.services;
    const account = this.#app.account?.state.account ?? null;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 200, height: HEADER.height, text: "Shop", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const note = account === null ? "Sign in with Keychain to buy. Prices are paid in STEEM, straight from your wallet." : `Buying as @${account}. Payments go straight from your wallet; nothing is stored in the game.`;
    this.root.add(new Label({ x: HEADER.sideMargin + 200, y: HEADER.y, width: viewport.logicalWidth - 2 * HEADER.sideMargin - 200 - HEADER.backWidth - INSET, height: HEADER.height, text: note, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    return this.root.add(new Button({ id: "shop.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back to menu", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
  }

  /**
   * @param {readonly import("../../application/ports/MarketApi.contract.js").Product[]} products
   * @param {number} scrollY
   * @returns {Button | null}
   */
  #buildProducts(products, scrollY) {
    const panel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const width = COLUMNS.left.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 36, text: "For sale", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: 60, width, height: COLUMNS.height - 60 - INSET }));
    const { status, error } = this.#shop().state;
    if (products.length === 0) {
      const text = status === ShopStatus.FAILED ? `The shop could not be loaded: ${error?.message ?? "unknown error"}` : "Loading the shop…";
      list.add(new Label({ id: "shop.empty", x: 0, y: 0, width: list.rowWidth, height: ROW.height, text, colorKey: status === ShopStatus.FAILED ? "danger" : "textMuted", fit: true }));
      list.contentHeight = ROW.height;
      return null;
    }
    /** @type {Button | null} */
    let first = null;
    products.forEach((product, index) => {
      const price = product.prices[0];
      const row = list.add(
        new OptionRow({
          id: `shop.product.${product.id}`,
          x: 0,
          y: rowY(index),
          width: list.rowWidth,
          height: ROW.height,
          text: product.name,
          subtitle: `${price.amount} ${price.asset} · ${product.cards} card${product.cards === 1 ? "" : "s"} · ${product.kind}`,
          selected: product.id === this.#selectedId,
          onActivate: () => this.#select(product.id),
        }),
      );
      first ??= row;
    });
    list.contentHeight = rowsHeight(products.length);
    list.scrollTo(scrollY);
    return first;
  }

  /**
   * @param {import("../../application/ports/MarketApi.contract.js").Product | undefined} product
   * @returns {Button | null} the Buy button
   */
  #buildDetail(product) {
    const panel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    if (product === undefined) {
      return null;
    }
    const width = COLUMNS.right.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 40, text: product.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new TextBlock({ x: INSET, y: 62, width, height: 3 * LINE, text: product.description, size: "small", colorKey: "textMuted" }));
    const lines = [...this.#contentLines(product), ...this.#oddsLines(product)];
    lines.forEach((line, index) => panel.add(new Label({ x: INSET, y: 150 + index * LINE, width, height: LINE, text: line.text, size: "small", align: "left", colorKey: line.colorKey, fit: true })));
    return this.#buildPurchase(panel, product);
  }

  /**
   * @param {Panel} panel
   * @param {import("../../application/ports/MarketApi.contract.js").Product} product
   */
  #buildPurchase(panel, product) {
    const shop = this.#shop();
    const { purchase } = shop.state;
    const price = product.prices[0];
    const y = COLUMNS.height - INSET - BUY.height - 2 * LINE - INSET - 52;
    const quantityY = y;
    panel.add(new Button({ id: "shop.less", x: INSET, y: quantityY, width: ACTION.small, height: 52, text: "−", enabled: this.#quantity > 1, onActivate: () => this.#changeQuantity(-1, product) }));
    panel.add(new Label({ id: "shop.quantity", x: INSET + ACTION.small, y: quantityY, width: 80, height: 52, text: String(this.#quantity), size: "heading", weight: "bold" }));
    panel.add(new Button({ id: "shop.more", x: INSET + ACTION.small + 80, y: quantityY, width: ACTION.small, height: 52, text: "+", enabled: this.#quantity < product.perOrder, onActivate: () => this.#changeQuantity(1, product) }));
    const total = `${multiplyAmount(price.amount, this.#quantity)} ${price.asset}`;
    const buyY = quantityY + 52 + INSET;
    const buy = panel.add(
      new Button({
        id: "shop.buy",
        x: INSET,
        y: buyY,
        width: BUY.width,
        height: BUY.height,
        text: `Buy for ${total}`,
        variant: "primary",
        enabled: this.#canBuy(),
        onActivate: () => shop.buy({ productId: product.id, quantity: this.#quantity, asset: price.asset }),
      }),
    );
    const status = this.#statusLine(purchase);
    panel.add(new TextBlock({ id: "shop.status", x: INSET, y: buyY + BUY.height + 8, width: COLUMNS.right.width - 2 * INSET, height: 2 * LINE, text: status.text, size: "small", colorKey: status.colorKey }));
    if (purchase.stage === PurchaseStage.FAILED && purchase.order?.payment) {
      const x = INSET + BUY.width + INSET;
      const half = (COLUMNS.right.width - x - INSET - ACTION.gap) / 2;
      panel.add(new Button({ id: "shop.payAgain", x, y: buyY, width: half, height: BUY.height, text: "Pay again", onActivate: () => shop.payAgain() }));
      panel.add(new Button({ id: "shop.cancel", x: x + half + ACTION.gap, y: buyY, width: half, height: BUY.height, text: "Cancel order", variant: "danger", textSize: "small", onActivate: () => shop.cancel() }));
    }
    return buy;
  }

  #canBuy() {
    const shop = this.#shop();
    const busy = [PurchaseStage.ORDERING, PurchaseStage.SIGNING, PurchaseStage.CONFIRMING].includes(shop.state.purchase.stage);
    return shop.state.status === ShopStatus.READY && (this.#app.account?.state.account ?? null) !== null && !busy;
  }

  /**
   * @param {import("../../application/shop/ShopService.js").Purchase} purchase
   * @returns {{ text: string, colorKey: string }}
   */
  #statusLine(purchase) {
    if (purchase.error !== null) {
      return { text: purchase.error.message, colorKey: purchase.stage === PurchaseStage.FAILED ? "danger" : "accent" };
    }
    const text = STAGE_TEXT[/** @type {keyof typeof STAGE_TEXT} */ (purchase.stage)];
    if (text !== undefined) {
      return { text: text(purchase), colorKey: purchase.stage === PurchaseStage.DONE ? "success" : "accent" };
    }
    return (this.#app.account?.state.account ?? null) === null ? { text: "Sign in to buy.", colorKey: "textMuted" } : { text: "Keychain will show the exact transfer before anything is paid.", colorKey: "textMuted" };
  }

  /** @param {import("../../application/ports/MarketApi.contract.js").Product} product */
  #contentLines(product) {
    const { content } = this.#app;
    const listing = this.#shop().state.listing;
    /** @type {Record<string, (item: import("../../application/ports/MarketApi.contract.js").ProductContent) => string>} */
    const describe = {
      card: (item) => `${content.catalog.get(item.ref)?.name ?? item.ref}${item.finish === "foil" ? " (foil)" : ""}`,
      pack: (item) => `booster pack of ${listing?.dropTables.find((table) => table.id === item.ref)?.size ?? 0} cards`,
      deck: (item) => {
        const deck = content.preconDecks.find((candidate) => candidate.id === item.ref);
        return `complete deck: ${deck?.name ?? item.ref} (${deck?.totalCards ?? "?"} cards), saved to your account`;
      },
      product: (item) => listing?.products.find((candidate) => candidate.id === item.ref)?.name ?? item.ref,
    };
    return product.contents.map((item) => ({ text: `${item.count} × ${(describe[item.type] ?? (() => item.ref))(item)}`, colorKey: "text" }));
  }

  /**
   * Pack odds, as the server publishes them (products may nest packs in bundles).
   * @param {import("../../application/ports/MarketApi.contract.js").Product} product
   */
  #oddsLines(product) {
    const listing = this.#shop().state.listing;
    const tableIds = new Set(packTablesOf(product, listing?.products ?? []));
    return [...tableIds].flatMap((tableId) => {
      const table = listing?.dropTables.find((candidate) => candidate.id === tableId);
      if (table === undefined) {
        return [];
      }
      const slots = table.slots.map((slot, index) => {
        const odds = Object.entries(slot.odds).map(([rarity, chance]) => `${rarity} ${percent(chance)}`).join(" · ");
        return { text: `Slot ${index + 1} (${slot.count} card${slot.count === 1 ? "" : "s"}): ${odds}`, colorKey: "textMuted" };
      });
      return [{ text: "Pack odds", colorKey: "accentLight" }, ...slots, { text: `Each card is foil with probability ${percent(table.foil)}. Packs are provably fair: see /api/pack-epochs.`, colorKey: "textMuted" }];
    });
  }

  /** @returns {import("../ui/UiNode.js").UiNode | null} the node to focus in the reveal */
  #openRevealIfDone() {
    const { purchase } = this.#shop().state;
    const fulfilment = purchase.order?.fulfilment;
    if (purchase.stage !== PurchaseStage.DONE || fulfilment === null || fulfilment === undefined || this.#revealClosed) {
      return null;
    }
    const { viewport } = this.services;
    const close = () => {
      this.#revealClosed = true;
      this.#shop().dismiss();
    };
    const modal = new Modal({ id: "reveal", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: REVEAL.width, panelHeight: REVEAL.height, onDismiss: close });
    const { panel } = modal;
    const width = REVEAL.width - 2 * INSET;
    const total = fulfilment.cards.length + fulfilment.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
    panel.add(new Label({ x: INSET, y: INSET, width, height: 44, text: `You received ${total} card${total === 1 ? "" : "s"}`, size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    this.#buildRevealList(panel.add(new ScrollList({ id: "reveal.cards", x: INSET, y: 80, width, height: REVEAL.height - 80 - 2 * INSET - 56 })), fulfilment);
    const buttonWidth = (width - ACTION.gap) / 2;
    const buttonsY = REVEAL.height - INSET - 56;
    const view = panel.add(
      new Button({
        id: "reveal.collection",
        x: INSET,
        y: buttonsY,
        width: buttonWidth,
        height: 56,
        text: "View collection",
        variant: "primary",
        enabled: this.services.hasScene(SceneId.COLLECTION),
        onActivate: () => {
          close();
          this.services.navigate(SceneId.COLLECTION);
        },
      }),
    );
    panel.add(new Button({ id: "reveal.close", x: INSET + buttonWidth + ACTION.gap, y: buttonsY, width: buttonWidth, height: 56, text: "Keep shopping", onActivate: close }));
    this.openModal(modal);
    return view;
  }

  /**
   * The cards received, the order's own first, then pack by pack.
   * @param {ScrollList} list
   * @param {import("../../application/ports/MarketApi.contract.js").Fulfilment} fulfilment
   */
  #buildRevealList(list, fulfilment) {
    let y = 0;
    const groups = [...(fulfilment.cards.length > 0 ? [{ title: null, cards: fulfilment.cards }] : []), ...fulfilment.packs.map((pack) => ({ title: `Pack ${pack.index + 1}`, cards: pack.cards }))];
    for (const group of groups) {
      if (group.title !== null) {
        list.add(new Label({ x: 0, y, width: list.rowWidth, height: 30, text: group.title, size: "small", weight: "bold", align: "left", colorKey: "accent" }));
        y += 30;
      }
      for (const card of group.cards) {
        const definition = this.#app.content.catalog.get(card.definitionId);
        const foil = card.finish === "foil";
        list.add(new CardStrip({ x: 0, y, width: list.rowWidth - 220, height: REVEAL.row, card: definition ?? unknownCard(card.definitionId), broken: definition === undefined }));
        list.add(new Label({ x: list.rowWidth - 210, y, width: 210, height: REVEAL.row, text: `#${card.serial}${foil ? " · foil" : ""}`, size: "small", align: "left", colorKey: foil ? "accentLight" : "textMuted" }));
        y += REVEAL.row + REVEAL.gap;
      }
      y += REVEAL.packGap;
    }
    list.contentHeight = y;
  }

  /** @param {string} productId */
  #select(productId) {
    this.#selectedId = productId;
    this.#quantity = 1;
    this.#rebuild();
  }

  /**
   * @param {number} delta
   * @param {import("../../application/ports/MarketApi.contract.js").Product} product
   */
  #changeQuantity(delta, product) {
    this.#quantity = Math.min(product.perOrder, Math.max(1, this.#quantity + delta));
    this.#rebuild();
  }

  #shop() {
    if (this.#app.shop === undefined) {
      throw new Error("ShopScene needs a shop service");
    }
    return this.#app.shop;
  }
}

/**
 * Drop tables a product's packs come from, following bundles.
 * @param {import("../../application/ports/MarketApi.contract.js").Product} product
 * @param {readonly import("../../application/ports/MarketApi.contract.js").Product[]} products
 * @param {number} [depth]
 * @returns {string[]}
 */
function packTablesOf(product, products, depth = 0) {
  if (depth > 4) {
    return [];
  }
  return product.contents.flatMap((item) => {
    if (item.type === "pack") {
      return [item.ref];
    }
    const nested = item.type === "product" ? products.find((candidate) => candidate.id === item.ref) : undefined;
    return nested === undefined ? [] : packTablesOf(nested, products, depth + 1);
  });
}

/**
 * Display only (the server's total is what gets paid): "1.000" × 3 → "3.000", exactly.
 * @param {string} amount
 * @param {number} times
 */
export function multiplyAmount(amount, times) {
  const [whole, fraction = ""] = amount.split(".");
  const units = BigInt(`${whole}${fraction}`) * BigInt(times);
  const digits = units.toString().padStart(fraction.length + 1, "0");
  return fraction.length === 0 ? digits : `${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}`;
}

/** @param {{ numerator: number, denominator: number }} chance */
function percent({ numerator, denominator }) {
  const value = (100 * numerator) / denominator;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
