/**
 * A purchase under way, as the player follows it: four steps in a row —
 * Order, Payment, Blockchain, Delivered — those behind it ticked, the one
 * under way pulsing; under them what is happening now and, while the
 * blockchain makes the payment final, a bar filling over the usual wait
 * with the time left beside it; then what the player may do meanwhile.
 *
 * The same for the shop and the player market: it reads where the purchase
 * stands (`track`: ShopService's `shopTrack`, SalesService's `buyingTrack`)
 * and the clock itself (`now`), so the
 * bar moves and the time left counts down between the scene's rebuilds:
 * the scene calls `tick(dtMs)` from its update and draws again when it
 * says so (a few times a second while a step is under way, never once the
 * purchase is delivered).
 */
import { ChainPhase, PURCHASE_STEP_COUNT, PurchaseStep, purchaseProgress } from "../../../application/payments/purchaseProgress.js";
import { moneyText } from "../../../application/money/moneyText.js";
import { Label } from "../../ui/Label.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { UiNode } from "../../ui/UiNode.js";
import { fillRoundedRect, horizontalGradient, radialGradient } from "../../ui/drawing.js";
import { drawCheckIcon } from "../../ui/shapes.js";
import { withAlpha } from "../../theme/color.js";
import { fontFor } from "../../theme/Theme.js";

/** The steps after the first, whose name depends on what is bought (`first`: an order, a reservation). */
const LATER_STEPS = Object.freeze(["Payment", "Blockchain", "Delivered"]);
/**
 * Wide and on a phone: a step's dot (radius), its name's line, the gap under the names, the line of what is
 * happening, the bar's thickness, how wide the time left beside it is, a line of the note under it, and the text sizes.
 * @typedef {Readonly<{ dot: number, name: number, gap: number, title: number, bar: number, aside: number, line: number, nameSize: import("../../theme/Theme.js").FontSize, textSize: import("../../theme/Theme.js").FontSize }>} TrackerSizes
 * @type {Readonly<{ wide: TrackerSizes, compact: TrackerSizes }>}
 */
const SIZES = Object.freeze({
  wide: Object.freeze({ dot: 11, name: 20, gap: 10, title: 24, bar: 10, aside: 124, line: 20, nameSize: "small", textSize: "small" }),
  compact: Object.freeze({ dot: 8, name: 16, gap: 5, title: 20, bar: 8, aside: 64, line: 17, nameSize: "tiny", textSize: "tiny" }),
});
/** How often it draws again while a step is under way: the pulse and the bar's light need no more. */
const FRAME_MS = 50;
/** One beat of the step under way, and how far its light sweeps along the bar per second (in bar widths). */
const PULSE_MS = 1400;
const SWEEP_PER_SECOND = 0.45;
const KEEP_PLAYING = "You can keep playing meanwhile: a notification tells you when it arrives.";

/**
 * @typedef {Readonly<{ title: string, colorKey: string, aside: string, note: string }>} TrackerText
 */

export class PurchaseTracker extends UiNode {
  #track;
  #now;
  #sizes;
  #compact;
  #approve;
  #done;
  #first;
  #ordering;
  /** Time it has been on show, for the pulse and the light. */
  #clockMs = 0;
  #sinceFrameMs = 0;
  /** @type {Label} */
  #title;
  /** @type {Label} */
  #aside;
  /** @type {TextBlock} */
  #note;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, compact: boolean, track: () => import("../../../application/payments/purchaseProgress.js").PurchaseTrack | null, now: () => number, approve: string, done: string, first?: string, ordering?: string }} options
   *   `track`: where the purchase stands now; `approve`: how the player approves the transfer ("Approve the transfer in
   *   Keychain"); `done`: what the player reads once it is delivered; `first`: the first step's name, and `ordering`:
   *   what the player reads during it (an order being created, by default)
   */
  constructor({ id = "purchase.tracker", x, y, width, height, compact, track, now, approve, done, first = "Order", ordering = "Creating your order…" }) {
    super({ id, x, y, width, height });
    this.#track = track;
    this.#now = now;
    this.#compact = compact;
    this.#sizes = compact ? SIZES.compact : SIZES.wide;
    this.#approve = approve;
    this.#done = done;
    this.#first = first;
    this.#ordering = ordering;
    const m = this.#sizes;
    const titleY = this.#barTop - m.title - 2;
    this.#title = this.add(new Label({ id: `${id}.title`, x: 0, y: titleY, width, height: m.title, text: "", size: m.textSize, weight: "bold", colorKey: "accent", align: "left", fit: true }));
    this.#aside = this.add(new Label({ id: `${id}.left`, x: width - m.aside, y: this.#barTop + m.bar / 2 - m.line / 2, width: m.aside, height: m.line, text: "", size: m.textSize, weight: "bold", colorKey: "accentLight", align: "right", fit: true }));
    const noteY = this.#barTop + m.bar + m.gap;
    this.#note = this.add(new TextBlock({ id: `${id}.note`, x: 0, y: noteY, width, height: Math.max(0, height - noteY), text: "", size: m.textSize, colorKey: "textMuted" }));
    this.#write();
  }

  /** Whether the purchase is still under way (not delivered, not failed): it moves, so it is drawn again and again. */
  get active() {
    const progress = purchaseProgress(this.#track(), this.#now());
    return progress !== null && progress.step < PURCHASE_STEP_COUNT;
  }

  /**
   * Time passes: the pulse beats, the bar fills, the time left counts down.
   * @param {number} dtMs
   * @returns {boolean} whether it needs drawing again
   */
  tick(dtMs) {
    if (!this.active) {
      return false;
    }
    this.#clockMs += dtMs;
    this.#sinceFrameMs += dtMs;
    if (this.#sinceFrameMs < FRAME_MS) {
      return false;
    }
    this.#sinceFrameMs = 0;
    this.#write();
    return true;
  }

  /** The words, as the purchase stands now. */
  #write() {
    const text = trackerText(this.#track(), this.#now(), { approve: this.#approve, done: this.#done, ordering: this.#ordering, compact: this.#compact });
    this.#title.text = text.title;
    this.#title.colorKey = text.colorKey;
    this.#aside.text = text.aside;
    this.#note.text = text.note;
  }

  /** Where the bar starts, under the steps' names and the line of what is happening. */
  get #barTop() {
    const m = this.#sizes;
    return 2 * m.dot + 4 + m.name + m.gap + m.title + 2;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const progress = purchaseProgress(this.#track(), this.#now());
    if (progress === null) {
      return;
    }
    this.#paintSteps(context, theme, progress.step);
    this.#paintBar(context, theme, progress);
  }

  /**
   * The four dots on their line, each with its name under it.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {number} step the one under way
   */
  #paintSteps(context, theme, step) {
    const { colors } = theme;
    const m = this.#sizes;
    const { x, y, width } = this.bounds;
    const slot = width / PURCHASE_STEP_COUNT;
    const centreY = y + m.dot + 2;
    const centreX = (/** @type {number} */ index) => x + slot * (index + 0.5);
    // The line through the dots: gold as far as the purchase has come.
    const reached = centreX(Math.min(step, PURCHASE_STEP_COUNT - 1));
    context.fillStyle = withAlpha(colors.textMuted, 0.35);
    context.fillRect(centreX(0), centreY - 1.5, centreX(PURCHASE_STEP_COUNT - 1) - centreX(0), 3);
    context.fillStyle = colors.accent;
    context.fillRect(centreX(0), centreY - 1.5, reached - centreX(0), 3);
    const beat = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.#clockMs) / PULSE_MS);
    [this.#first, ...LATER_STEPS].forEach((name, index) => {
      const centre = { x: centreX(index), y: centreY };
      const state = stepState(index, step);
      if (state === "now") {
        context.fillStyle = radialGradient(context, centre, m.dot * (2 + beat), [[0, withAlpha(colors.accentLight, 0.55)], [1, withAlpha(colors.accent, 0)]]);
        context.fillRect(centre.x - 3 * m.dot, centre.y - 3 * m.dot, 6 * m.dot, 6 * m.dot);
      }
      context.beginPath();
      context.arc(centre.x, centre.y, m.dot, 0, 2 * Math.PI);
      context.fillStyle = { done: colors.success, now: colors.accent, next: colors.panelDark }[state];
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = state === "next" ? withAlpha(colors.textMuted, 0.6) : colors.accentLight;
      context.stroke();
      if (state === "done") {
        drawCheckIcon(context, centre, m.dot * 1.1, { color: colors.accentText });
      }
      context.font = fontFor(theme, m.nameSize, state === "now" ? "bold" : "normal");
      context.fillStyle = { done: colors.text, now: colors.accentLight, next: colors.textMuted }[state];
      context.textAlign = "center";
      context.textBaseline = "middle";
      // A narrow tracker (beside a phone's card) squeezes a long name into its own slot rather than into its neighbours'.
      context.fillText(name, centre.x, centreY + m.dot + 4 + m.name / 2, slot - 4);
    });
  }

  /**
   * The bar of the blockchain's wait: empty before the payment, filling while the chain confirms it, full once delivered.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {import("../../../application/payments/purchaseProgress.js").PurchaseProgress} progress
   */
  #paintBar(context, theme, progress) {
    const { colors } = theme;
    const m = this.#sizes;
    const { x, y, width } = this.bounds;
    const track = { x, y: y + this.#barTop, width: width - m.aside - 8, height: m.bar };
    const radius = m.bar / 2;
    fillRoundedRect(context, track, { fill: colors.panelDark, stroke: withAlpha(colors.textMuted, 0.4), radius, lineWidth: 1 });
    const share = barShare(progress);
    if (share <= 0) {
      return;
    }
    const filled = { ...track, width: Math.max(m.bar, track.width * share) };
    const delivered = progress.step >= PURCHASE_STEP_COUNT;
    fillRoundedRect(context, filled, { fill: horizontalGradient(context, filled, delivered ? [[0, colors.success], [1, colors.success]] : [[0, colors.accentDark], [1, colors.accentLight]]), radius });
    if (delivered) {
      return;
    }
    // A light running along what is filled: the wait is alive, not stuck.
    const sweep = ((this.#clockMs / 1000) * SWEEP_PER_SECOND) % 1;
    const centre = { x: filled.x + filled.width * sweep, y: filled.y + filled.height / 2 };
    context.save();
    context.beginPath();
    context.rect(filled.x, filled.y, filled.width, filled.height);
    context.clip();
    context.fillStyle = radialGradient(context, centre, m.bar * 3, [[0, withAlpha("#ffffff", 0.7)], [1, withAlpha("#ffffff", 0)]]);
    context.fillRect(centre.x - m.bar * 3, filled.y, m.bar * 6, filled.height);
    context.restore();
  }
}

/**
 * @param {number} index
 * @param {number} step the one under way
 * @returns {"done" | "now" | "next"}
 */
function stepState(index, step) {
  if (index < step) {
    return "done";
  }
  return index === step ? "now" : "next";
}

/**
 * How full the bar is: nothing before the payment is sent, the chain's share while it confirms, all once delivered.
 * @param {import("../../../application/payments/purchaseProgress.js").PurchaseProgress} progress
 */
function barShare(progress) {
  if (progress.step >= PURCHASE_STEP_COUNT) {
    return 1;
  }
  return progress.chain?.share ?? 0;
}

/**
 * What the tracker says: what is happening now, the time left beside the bar, and the note under it.
 * @param {import("../../../application/payments/purchaseProgress.js").PurchaseTrack | null} track
 * @param {number} nowMs
 * @param {{ approve: string, done: string, ordering: string, compact: boolean }} words
 * @returns {TrackerText}
 */
export function trackerText(track, nowMs, { approve, done, ordering, compact }) {
  const progress = purchaseProgress(track, nowMs);
  if (progress === null) {
    return { title: "", colorKey: "accent", aside: "", note: "" };
  }
  if (progress.step >= PURCHASE_STEP_COUNT) {
    return { title: "Delivered!", colorKey: "success", aside: "", note: done };
  }
  if (progress.step === PurchaseStep.ORDER) {
    return { title: ordering, colorKey: "accent", aside: "", note: "" };
  }
  if (progress.step === PurchaseStep.PAYMENT) {
    const payment = track?.payment ?? null;
    const what = payment === null ? "" : `${moneyText(payment.amount, payment.asset)} to @${payment.to}. `;
    return { title: approve, colorKey: "accent", aside: "", note: `${what}Nothing is paid until you approve it.` };
  }
  return chainText(/** @type {import("../../../application/payments/purchaseProgress.js").ChainProgress} */ (progress.chain), compact);
}

/**
 * @param {import("../../../application/payments/purchaseProgress.js").ChainProgress} chain
 * @param {boolean} compact
 * @returns {TrackerText}
 */
function chainText(chain, compact) {
  const seconds = Math.ceil(chain.leftMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const left = compact ? `~${clock}` : `about ${clock} left`;
  switch (chain.phase) {
    case ChainPhase.FINAL:
      return { title: "Payment final: delivering…", colorKey: "accent", aside: compact ? "soon" : "almost there", note: KEEP_PLAYING };
    case ChainPhase.LATE:
      // A phone's tracker has a line for its note (under a single's card): the short of it.
      return { title: "Taking longer than usual", colorKey: "accent", aside: "", note: compact ? "Nothing is lost: a notification tells you when it arrives." : "Nothing is lost: it arrives as soon as the blockchain confirms your payment, and a notification tells you." };
    case ChainPhase.SEEN:
      return { title: "The blockchain has your payment: making it final", colorKey: "accent", aside: left, note: KEEP_PLAYING };
    default:
      return { title: "Payment sent: the blockchain is confirming it", colorKey: "accent", aside: left, note: KEEP_PLAYING };
  }
}
