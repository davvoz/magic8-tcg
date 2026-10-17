/**
 * Getting ranked entries where they are needed, without going to the shop:
 * the tickets the player holds and how many this order adds, what entries
 * are for, how many to buy (− and +, up to the shop's limit per order),
 * what the wallet holds, then Buy, which pays with the wallet the player
 * signed in with (Keychain, or their active key) as the shop does. The
 * dialog follows the purchase until the entries are there; it may be closed
 * meanwhile (the entries arrive all the same, with a notification).
 *
 * The scene keeps one for as long as it shows, builds its modal again with
 * itself (`build`) and says when it opens (`prepare`). A purchase the shop
 * screen started is not this dialog's: while it runs, Buy waits.
 */
import { entriesText, rankedEntriesText } from "../../../application/entries/EntryService.js";
import { moneyText } from "../../../application/money/moneyText.js";
import { BUSY_STAGES, PurchaseStage, ShopStatus } from "../../../application/shop/ShopService.js";
import { multiplyAmount, priceOf, rankedEntryProduct } from "../../../application/shop/shopCatalog.js";
import { Button } from "../../ui/Button.js";
import { Glyph } from "../../ui/glyphs.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { approveTransferText, transferPreviewText } from "../walletText.js";
import { EntryTickets } from "./EntryTickets.js";

/**
 * The dialog, wide and on a phone: its largest size, its title, the tickets' height, the lines on what entries are,
 * a line's height, a row of controls (− and + `step` wide, the count `count` wide) and the gaps.
 * @typedef {Readonly<{ width: number, height: number, title: number, tickets: number, about: number, line: number, row: number, step: number, count: number, gap: number }>} DialogSizes
 * @type {Readonly<{ wide: DialogSizes, compact: DialogSizes }>}
 */
const SIZES = Object.freeze({
  wide: Object.freeze({ width: 720, height: 400, title: 40, tickets: 104, about: 3, line: 26, row: 52, step: 56, count: 70, gap: 14 }),
  compact: Object.freeze({ width: 640, height: 330, title: 32, tickets: 60, about: 2, line: 22, row: 46, step: 46, count: 52, gap: 8 }),
});
/** How many entries the dialog offers first. */
const DEFAULT_QUANTITY = 5;
/** What the dialog says entries are for, wide and on a phone. */
const ABOUT = Object.freeze({
  full: "Every ranked game uses 1 ticket. Buy as many as you like with one payment: tickets never expire, and every ticket goes into the season's jackpot.",
  short: "Every ranked game uses 1 ticket. Tickets never expire and all go into the season's jackpot.",
});

/**
 * @typedef {{ text: string, colorKey: string }} Line
 */

export class EntryPurchaseDialog {
  #app;
  #onClose;
  #onPlay;
  #refresh;
  #quantity = DEFAULT_QUANTITY;
  /** Whether the purchase on show is the one this dialog started. */
  #started = false;

  /**
   * @param {import("../../../application/AppContext.js").AppContext} app
   * @param {{ onClose: () => void, onPlay?: () => void, refresh: () => void }} host `onClose`: the player closed it;
   *   `onPlay`: the player, the tickets there, goes on to play (closing it too, by default); `refresh`: build it again
   */
  constructor(app, { onClose, onPlay = onClose, refresh }) {
    this.#app = app;
    this.#onClose = onClose;
    this.#onPlay = onPlay;
    this.#refresh = refresh;
  }

  /** Whether entries are on sale here at all (a shop to buy from). */
  get available() {
    return this.#app.shop !== undefined;
  }

  /** The dialog opens: a fresh purchase (a finished one is forgotten), the wallet and the prices read again. */
  prepare() {
    const shop = this.#app.shop;
    this.#started = false;
    this.#quantity = DEFAULT_QUANTITY;
    if (shop === undefined) {
      return;
    }
    if (!BUSY_STAGES.includes(shop.state.purchase.stage) && shop.state.purchase.stage !== PurchaseStage.NONE) {
      shop.dismiss();
    }
    if (shop.state.listing === null && shop.state.status !== ShopStatus.LOADING) {
      void shop.load();
    }
    void this.#app.balance?.refresh();
  }

  /**
   * @param {{ viewport: { logicalWidth: number, logicalHeight: number }, compact: boolean, inset: number }} frame
   * @returns {Modal}
   */
  build({ viewport, compact, inset }) {
    const m = compact ? SIZES.compact : SIZES.wide;
    const width = Math.min(m.width, viewport.logicalWidth - 2 * inset);
    const height = Math.min(m.height, viewport.logicalHeight - 2 * inset);
    const modal = new Modal({ id: "tickets", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: () => this.#onClose() });
    const { panel } = modal;
    const inner = width - 2 * inset;
    const product = rankedEntryProduct(this.#app.shop?.state.listing ?? null);
    const held = this.#app.entries?.ranked?.balance ?? null;
    panel.add(new Label({ id: "tickets.title", x: panel.titleInset, y: inset, width: width - 2 * panel.titleInset, height: m.title, text: "Buy ranked tickets", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const top = inset + m.title + m.gap;
    const ticketsWidth = EntryTickets.widthFor(m.tickets);
    const face = product === null ? null : moneyText(priceOf(product).amount, priceOf(product).asset);
    panel.add(new EntryTickets({ id: "tickets.held", x: inset, y: top, width: ticketsWidth, height: m.tickets, count: held, title: "Ranked", face, seed: "purchase" }));
    panel.add(new Label({ id: "tickets.added", x: inset, y: top + m.tickets + 4, width: ticketsWidth, height: m.line, text: `+${entriesText(this.#quantity)}`, size: "body", weight: "bold", colorKey: "success", fit: true }));
    const x = inset + ticketsWidth + 2 * m.gap;
    const right = inset + inner - x;
    panel.add(new TextBlock({ id: "tickets.about", x, y: top, width: right, height: m.about * m.line, text: compact ? ABOUT.short : ABOUT.full, size: "small", colorKey: "textMuted" }));
    const rowY = top + m.about * m.line + m.gap;
    const lineY = rowY + m.row + m.gap;
    const buttonY = height - inset - m.row;
    const line = this.#line(product);
    panel.add(new TextBlock({ id: "tickets.status", x, y: lineY, width: right, height: Math.max(0, buttonY - m.gap - lineY), text: line.text, size: "small", colorKey: line.colorKey }));
    // The buttons before the quantity, so the focus starts on Buy.
    this.#buildButtons(panel, { x: inset, y: buttonY, width: inner, height: m.row, gap: m.gap, product });
    this.#buildQuantity(panel, { x, y: rowY, width: right, m, product });
    return modal;
  }

  /**
   * − how many + and what they cost.
   * @param {import("../../ui/Panel.js").Panel} panel
   * @param {{ x: number, y: number, width: number, m: DialogSizes, product: import("../../../application/ports/MarketApi.contract.js").Product | null }} row
   */
  #buildQuantity(panel, { x, y, width, m, product }) {
    const limit = product?.perOrder ?? 1;
    const idle = !this.#busy();
    panel.add(new Button({ id: "tickets.less", x, y, width: m.step, height: m.row, text: "−", enabled: idle && this.#quantity > 1, onActivate: () => this.#change(-1, limit) }));
    panel.add(new Label({ id: "tickets.quantity", x: x + m.step, y, width: m.count, height: m.row, text: String(this.#quantity), size: "heading", weight: "bold" }));
    panel.add(new Button({ id: "tickets.more", x: x + m.step + m.count, y, width: m.step, height: m.row, text: "+", enabled: idle && product !== null && this.#quantity < limit, onActivate: () => this.#change(1, limit) }));
    const totalX = x + 2 * m.step + m.count + m.gap;
    const total = product === null ? "" : `Total ${moneyText(this.#amount(product), priceOf(product).asset)}`;
    panel.add(new Label({ id: "tickets.total", x: totalX, y, width: Math.max(0, x + width - totalX), height: m.row, text: total, size: "body", weight: "bold", colorKey: "accentLight", align: "left", fit: true, glyph: product === null ? null : Glyph.STEEM }));
  }

  /**
   * Close (or cancel the order a failed payment left) and Buy (or pay again, or play once the entries are there).
   * @param {import("../../ui/Panel.js").Panel} panel
   * @param {{ x: number, y: number, width: number, height: number, gap: number, product: import("../../../application/ports/MarketApi.contract.js").Product | null }} row
   */
  #buildButtons(panel, { x, y, width, height, gap, product }) {
    const close = Math.round((width - gap) * 0.36);
    const main = width - gap - close;
    const shop = this.#app.shop;
    const purchase = this.#mine();
    const unpaid = purchase !== null && purchase.stage === PurchaseStage.FAILED && purchase.order !== null && purchase.order.payment !== null;
    const closing = unpaid
      ? { id: "tickets.cancelOrder", text: "Cancel order", onActivate: () => void shop?.cancel() }
      : { id: "tickets.close", text: purchase?.stage === PurchaseStage.DONE ? "Close" : "Not now", onActivate: () => this.#onClose() };
    panel.add(new Button({ keepPlate: true, ...this.#mainButton(product, unpaid), x: x + close + gap, y, width: main, height, variant: "primary", textSize: "small" }));
    panel.add(new Button({ ...closing, x, y, width: close, height, textSize: "small" }));
  }

  /**
   * @param {import("../../../application/ports/MarketApi.contract.js").Product | null} product
   * @param {boolean} unpaid a payment failed on an order that can still be paid
   * @returns {{ id: string, text: string, enabled: boolean, onActivate: () => void }}
   */
  #mainButton(product, unpaid) {
    const shop = this.#app.shop;
    const purchase = this.#mine();
    if (purchase?.stage === PurchaseStage.DONE) {
      return { id: "tickets.play", text: "Play ranked", enabled: true, onActivate: () => this.#onPlay() };
    }
    if (unpaid) {
      return { id: "tickets.payAgain", text: "Pay again", enabled: true, onActivate: () => void shop?.payAgain() };
    }
    if (product === null) {
      return { id: "tickets.buy", text: "Buy", enabled: false, onActivate: () => undefined };
    }
    const { asset } = priceOf(product);
    const amount = this.#amount(product);
    const ready = shop !== undefined && shop.state.status === ShopStatus.READY && !this.#busy() && !(this.#app.balance?.isShort(amount, asset) ?? false);
    return {
      id: "tickets.buy",
      text: `Buy ${entriesText(this.#quantity)} · ${moneyText(amount, asset)}`,
      enabled: ready,
      onActivate: () => {
        this.#started = true;
        void shop?.buy({ productId: product.id, quantity: this.#quantity, asset });
        this.#refresh();
      },
    };
  }

  /**
   * What the dialog says under the quantity: where the purchase stands, else what is missing, else the wallet.
   * @param {import("../../../application/ports/MarketApi.contract.js").Product | null} product
   * @returns {Line}
   */
  #line(product) {
    const shop = this.#app.shop;
    const purchase = this.#mine();
    if (purchase !== null) {
      return purchaseLine(purchase, this.#app, this.#quantity);
    }
    if (shop !== undefined && BUSY_STAGES.includes(shop.state.purchase.stage)) {
      return { text: "Another purchase is under way: wait for it to finish.", colorKey: "accent" };
    }
    return this.#readyLine(product);
  }

  /**
   * Before buying: the prices still being read, or nothing on sale; else what the wallet holds against what this costs.
   * @param {import("../../../application/ports/MarketApi.contract.js").Product | null} product
   * @returns {Line}
   */
  #readyLine(product) {
    const shop = this.#app.shop;
    if (product === null) {
      const reading = shop === undefined || shop.state.status === ShopStatus.LOADING || shop.state.status === ShopStatus.IDLE;
      return { text: reading ? "Reading the prices…" : "Ranked tickets are not on sale right now.", colorKey: reading ? "textMuted" : "danger" };
    }
    const { asset } = priceOf(product);
    const amount = this.#amount(product);
    const balance = this.#app.balance;
    const holds = balance?.amountOf(asset) ?? null;
    if (balance?.isShort(amount, asset)) {
      return { text: `Not enough ${asset}: this costs ${moneyText(amount, asset)}, your wallet holds ${moneyText(String(holds), asset)}.`, colorKey: "danger" };
    }
    const preview = transferPreviewText(this.#app);
    const wallet = holds === null ? "" : `Your wallet holds ${moneyText(holds, asset)}. `;
    return { text: `${wallet}${preview[0].toUpperCase()}${preview.slice(1)} before anything is paid.`, colorKey: "textMuted" };
  }

  /** The purchase this dialog started, while the shop still shows it; else null. */
  #mine() {
    const purchase = this.#app.shop?.state.purchase ?? null;
    return this.#started && purchase !== null && purchase.stage !== PurchaseStage.NONE ? purchase : null;
  }

  #busy() {
    const stage = this.#app.shop?.state.purchase.stage ?? PurchaseStage.NONE;
    return BUSY_STAGES.includes(stage);
  }

  /** @param {import("../../../application/ports/MarketApi.contract.js").Product} product */
  #amount(product) {
    return multiplyAmount(priceOf(product).amount, this.#quantity);
  }

  /**
   * @param {number} step
   * @param {number} limit
   */
  #change(step, limit) {
    this.#quantity = Math.max(1, Math.min(limit, this.#quantity + step));
    this.#refresh();
  }
}

/**
 * Where the dialog's purchase stands.
 * @param {import("../../../application/shop/ShopService.js").Purchase} purchase
 * @param {import("../../../application/AppContext.js").AppContext} app
 * @param {number} quantity
 * @returns {Line}
 */
function purchaseLine(purchase, app, quantity) {
  if (purchase.error !== null) {
    return { text: `The purchase did not go through: ${purchase.error.message}.`, colorKey: purchase.stage === PurchaseStage.FAILED ? "danger" : "accent" };
  }
  const payment = purchase.order?.payment ?? null;
  switch (purchase.stage) {
    case PurchaseStage.ORDERING:
      return { text: "Creating your order…", colorKey: "accent" };
    case PurchaseStage.SIGNING:
      return { text: payment === null ? `${approveTransferText(app)}.` : `${approveTransferText(app)}: ${moneyText(payment.amount, payment.asset)} to @${payment.to}.`, colorKey: "accent" };
    case PurchaseStage.CONFIRMING:
      return { text: "Payment sent. Your tickets arrive in about a minute, once the chain confirms it: you can close this, a notification will tell you.", colorKey: "accent" };
    case PurchaseStage.DONE:
      return { text: `Done: ${rankedEntriesText(quantity)} added. Good luck in the season!`, colorKey: "success" };
    default:
      return { text: "", colorKey: "textMuted" };
  }
}
