/**
 * A purchase on its way, in the top bar on every screen: once the wallet
 * has paid it, until it is delivered. A ring fills as the blockchain's
 * usual wait goes by, around a dot that beats, then the time left
 * ("Arriving 0:40"; on a phone the time alone). A click opens the screen
 * that follows the purchase step by step (the shop, the player market).
 *
 * It reads the purchase and the clock itself, like the tracker: the shell
 * calls `tick(dtMs)` and draws again when the time shown changes or the
 * dot beats.
 */
import { ChainPhase, purchaseProgress } from "../../application/payments/purchaseProgress.js";
import { withAlpha } from "../theme/color.js";
import { Chip } from "./Chip.js";

/** How often it draws again (the beat needs no more), and one beat. */
const FRAME_MS = 80;
const PULSE_MS = 1400;

export class ArrivalChip extends Chip {
  #track;
  #now;
  #compact;
  #clockMs = 0;
  #sinceFrameMs = 0;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean, track: () => import("../../application/payments/purchaseProgress.js").PurchaseTrack | null, now: () => number, onActivate: (() => void) | null }} options
   *   `track`: where the purchase stands now
   */
  constructor({ compact, track, now, ...options }) {
    super({ ...options, label: compact ? "" : "Arriving", value: "", valueKey: "accentLight" });
    this.#track = track;
    this.#now = now;
    this.#compact = compact;
    this.value = this.#timeText();
  }

  /**
   * Time passes: the dot beats, the ring fills, the time left counts down.
   * @param {number} dtMs
   * @returns {boolean} whether it needs drawing again
   */
  tick(dtMs) {
    this.#clockMs += dtMs;
    this.#sinceFrameMs += dtMs;
    if (this.#sinceFrameMs < FRAME_MS) {
      return false;
    }
    this.#sinceFrameMs = 0;
    this.value = this.#timeText();
    return true;
  }

  /** The time left of the usual wait; past it, or once the payment is final, that it comes soon. */
  #timeText() {
    const chain = purchaseProgress(this.#track(), this.#now())?.chain ?? null;
    if (chain === null || chain.phase === ChainPhase.FINAL || chain.phase === ChainPhase.LATE) {
      return this.#compact ? "soon" : "any moment";
    }
    const seconds = Math.ceil(chain.leftMs / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  /** @param {number} height */
  leadWidth(height) {
    return height;
  }

  /**
   * The ring of the wait, filled as far as it has come, around the beating dot.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number, height: number }} at
   */
  paintLead(context, theme, { x, y, height }) {
    const { colors } = theme;
    const radius = height / 2;
    const centre = { x: x + radius, y };
    const share = purchaseProgress(this.#track(), this.#now())?.chain?.share ?? 0;
    context.lineWidth = Math.max(2, radius * 0.28);
    context.strokeStyle = withAlpha(colors.textMuted, 0.4);
    context.beginPath();
    context.arc(centre.x, centre.y, radius - context.lineWidth / 2, 0, 2 * Math.PI);
    context.stroke();
    context.strokeStyle = colors.accent;
    context.beginPath();
    context.arc(centre.x, centre.y, radius - context.lineWidth / 2, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * share);
    context.stroke();
    const beat = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.#clockMs) / PULSE_MS);
    context.fillStyle = withAlpha(colors.accentLight, 0.55 + 0.45 * beat);
    context.beginPath();
    context.arc(centre.x, centre.y, radius * (0.28 + 0.12 * beat), 0, 2 * Math.PI);
    context.fill();
  }
}
