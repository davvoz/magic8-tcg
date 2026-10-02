/**
 * The opening coin toss, drawn over the whole board. It reads a CoinFlip
 * every frame and holds no state of its own: the table dims, each player's
 * name stands beside the face they hold, the gold coin is thrown and spins
 * end over end (squeezed as it turns edge-on), lands in a flash, and the
 * winning face and who plays first are announced.
 *
 * The coin is the painted one (Theme.coinArt) as soon as a face's image is
 * ready; until then, or without it, that face is drawn procedurally: gold,
 * with a sun for heads and a star for tails, its rim showing when tilted.
 *
 * The node covers the scene and takes pointer presses, so nothing on the
 * board underneath can be played while the coin is in the air.
 */
import { CoinFace } from "../../application/match/CoinToss.js";
import { withAlpha } from "../theme/color.js";
import { displayFont } from "../theme/Theme.js";
import { drawOutlinedText, radialGradient } from "../ui/drawing.js";
import { starPath } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

const VEIL = Object.freeze({ dim: 0.72, glow: 0.55, glowReach: 0.55 });
/** The coin, in logical pixels: its size, where it rests below the centre, how high it is thrown and how much nearer it seems at the top. */
const COIN = Object.freeze({ radius: 74, rest: 40, rise: 250, grow: 0.35, edge: 0.14, rim: 0.08, ring: 0.8, thinnest: 0.04 });
const SHADOW = Object.freeze({ drop: 1.1, flatness: 0.22, alpha: 0.45, shrink: 0.5 });
const SHINE = Object.freeze({ reach: 1.6, ringWidth: 4, blur: 30, halo: 2.4, haloAlpha: 0.35 });
/** The players' plates, either side of the coin. */
const PLATE = Object.freeze({ offset: 420, slide: 60, emblem: 38, width: 360, nameFont: 30, faceFont: 18, nameGap: 26, lineHeight: 36, winnerBlur: 28 });
const TITLE = Object.freeze({ top: 290, font: 44, height: 56, subtitleFont: 20, subtitleGap: 8, spread: 400 });
const VERDICT = Object.freeze({ top: 170, font: 60, height: 72, captionFont: 28, captionHeight: 40, spread: 400, rise: 24 });
/** The emblems struck on each face: a sun for heads, a star for tails. */
const EMBLEM = Object.freeze({ sunRadius: 0.52, sunRays: 12, sunInner: 0.72, sunDisc: 0.3, starRadius: 0.5, starPoints: 5, starInner: 0.45 });

const FACE_NAMES = Object.freeze({ [CoinFace.HEADS]: "Heads", [CoinFace.TAILS]: "Tails" });

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ at: Point, radius: number, face: string, squeeze: number }} CoinPose where the coin's face is centred, how big, which face, and how far it has turned (1 flat, 0 edge-on)
 */

export class CoinTossNode extends UiNode {
  #flip;
  #viewerId;
  #nameOf;

  /**
   * @param {{ flip: import("./CoinFlip.js").CoinFlip, x?: number, y?: number, width: number, height: number, viewerId: string | null, nameOf: (playerId: string) => string }} options
   *   `viewerId`: the player looking at the board (shown on the left and addressed as "you"), null for a spectator;
   *   `nameOf`: how to name a player on the plates
   */
  constructor({ flip, x = 0, y = 0, width, height, viewerId, nameOf }) {
    super({ id: "coinToss", x, y, width, height });
    this.interactive = true;
    this.#flip = flip;
    this.#viewerId = viewerId;
    this.#nameOf = nameOf;
  }

  /** Presses land here and go no further while the coin is tossed. */
  activate() {
    // Nothing on the board may be played until the toss is over.
  }

  /** @returns {string} what the toss says once the coin has landed */
  get verdictText() {
    const first = this.#flip.toss.firstPlayerId;
    return first === this.#viewerId ? "You play first" : `${this.#nameOf(first)} plays first`;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    this.#paintVeil(context, theme, centre);
    this.#paintTitle(context, theme, centre);
    this.#paintPlates(context, theme, centre);
    this.#paintCoin(context, theme, centre);
    this.#paintVerdict(context, theme, centre);
  }

  /**
   * The table dims, with a pool of light where the coin will fly.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Point} centre
   */
  #paintVeil(context, theme, centre) {
    const area = this.bounds;
    const { veil } = this.#flip.frame;
    context.save();
    context.fillStyle = withAlpha(theme.colors.letterbox, VEIL.dim * veil);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = radialGradient(context, centre, Math.max(area.width, area.height) * VEIL.glowReach, [
      [0, withAlpha(theme.colors.backgroundGlow, VEIL.glow * veil)],
      [1, withAlpha(theme.colors.backgroundGlow, 0)],
    ]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Point} centre
   */
  #paintTitle(context, theme, centre) {
    const { calls, verdict } = this.#flip.frame;
    const box = { x: centre.x - TITLE.spread, y: centre.y - TITLE.top, width: 2 * TITLE.spread, height: TITLE.height };
    context.save();
    context.globalAlpha = calls * (1 - verdict);
    drawOutlinedText(context, "Coin toss", box, { font: displayFont(theme, TITLE.font), color: theme.colors.accentLight, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: 5, glow: withAlpha(theme.colors.accent, 0.8), glowBlur: 18 });
    const subtitle = { ...box, y: box.y + TITLE.height + TITLE.subtitleGap, height: TITLE.subtitleFont * 1.6 };
    drawOutlinedText(context, "Heads or tails: who plays first?", subtitle, { font: displayFont(theme, TITLE.subtitleFont, "normal"), color: theme.colors.textMuted, outline: withAlpha(theme.colors.letterbox, 0.8), outlineWidth: 3 });
    context.restore();
  }

  /**
   * Each player's name, the face they hold, and a small coin showing it;
   * the winner's lights up once the result is in.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Point} centre
   */
  #paintPlates(context, theme, centre) {
    const { toss, frame } = this.#flip;
    const [left, right] = this.#seatingOrder();
    for (const [playerId, side] of /** @type {const} */ ([[left, -1], [right, 1]])) {
      const face = /** @type {string} */ (toss.faceOf(playerId));
      const won = playerId === toss.firstPlayerId;
      const at = { x: centre.x + side * (PLATE.offset + (1 - frame.calls) * PLATE.slide), y: centre.y - PLATE.emblem };
      context.save();
      context.globalAlpha = frame.calls * (won ? 1 : 1 - 0.45 * frame.verdict);
      if (won && frame.verdict > 0) {
        paintHalo(context, at, PLATE.emblem * 1.4, { color: theme.colors.accentLight, alpha: frame.verdict, blur: PLATE.winnerBlur });
      }
      paintCoinFace(context, theme, { at, radius: PLATE.emblem, face, squeeze: 1 });
      const nameBox = { x: at.x - PLATE.width / 2, y: at.y + PLATE.emblem + PLATE.nameGap, width: PLATE.width, height: PLATE.lineHeight };
      const nameColor = won && frame.verdict > 0 ? theme.colors.accentLight : theme.colors.text;
      drawOutlinedText(context, this.#plateName(playerId), nameBox, { font: displayFont(theme, PLATE.nameFont), color: nameColor, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: 4 });
      const faceBox = { ...nameBox, y: nameBox.y + PLATE.lineHeight };
      drawOutlinedText(context, FACE_NAMES[face], faceBox, { font: displayFont(theme, PLATE.faceFont, "normal"), color: theme.colors.accent, outline: withAlpha(theme.colors.letterbox, 0.8), outlineWidth: 3 });
      context.restore();
    }
  }

  /**
   * The coin in its arc: nearer and higher at the top, its shadow on the
   * table shrinking beneath it, and a flash when it lands.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Point} centre
   */
  #paintCoin(context, theme, centre) {
    const flip = this.#flip;
    const { veil, shine } = flip.frame;
    const lift = flip.lift;
    const rest = { x: centre.x, y: centre.y + COIN.rest };
    const at = { x: rest.x, y: rest.y - lift * COIN.rise };
    const radius = COIN.radius * (1 + COIN.grow * lift);
    context.save();
    context.globalAlpha = veil;
    paintShadow(context, theme, { rest, radius: COIN.radius * (1 - SHADOW.shrink * lift), strength: veil * (1 - SHADOW.shrink * lift) });
    if (shine > 0) {
      paintShine(context, theme, { at, radius, shine });
    }
    paintCoinFace(context, theme, { at, radius, face: flip.faceShown, squeeze: flip.squeeze });
    context.restore();
  }

  /**
   * The face the coin came up on, and who that makes first.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Point} centre
   */
  #paintVerdict(context, theme, centre) {
    const { verdict } = this.#flip.frame;
    if (verdict <= 0) {
      return;
    }
    const top = centre.y + VERDICT.top + (1 - verdict) * VERDICT.rise;
    const box = { x: centre.x - VERDICT.spread, y: top, width: 2 * VERDICT.spread, height: VERDICT.height };
    context.save();
    context.globalAlpha = verdict;
    drawOutlinedText(context, `${FACE_NAMES[this.#flip.toss.landed]}!`, box, { font: displayFont(theme, VERDICT.font), color: theme.colors.accentLight, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: 6, glow: withAlpha(theme.colors.accent, 0.9), glowBlur: 22 });
    const caption = { ...box, y: top + VERDICT.height, height: VERDICT.captionHeight };
    drawOutlinedText(context, this.verdictText, caption, { font: displayFont(theme, VERDICT.captionFont), color: theme.colors.text, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: 4 });
    context.restore();
  }

  /** @returns {[string, string]} the viewer on the left, else the toss's own order */
  #seatingOrder() {
    const [first, second] = this.#flip.toss.playerIds;
    return second === this.#viewerId ? [second, first] : [first, second];
  }

  /** @param {string} playerId */
  #plateName(playerId) {
    return playerId === this.#viewerId ? "You" : this.#nameOf(playerId);
  }
}

/**
 * One face of the coin seen at an angle: `squeeze` 1 is flat to the viewer,
 * towards 0 it turns edge-on. The painted face when its image is ready,
 * else the drawn one.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {CoinPose} pose
 */
function paintCoinFace(context, theme, pose) {
  const art = theme.coinArt?.imageFor(pose.face) ?? null;
  if (art === null) {
    paintDrawnCoin(context, theme, pose);
  } else {
    paintPaintedCoin(context, art, pose);
  }
}

/**
 * The painted face, scaled so its disc has the coin's radius and sits on
 * the coin's centre, and squashed top to bottom as the coin turns.
 * @param {CanvasRenderingContext2D} context
 * @param {import("./CoinArt.js").CoinImage} art
 * @param {CoinPose} pose
 */
function paintPaintedCoin(context, { image, disc }, { at, radius, squeeze }) {
  const tilt = Math.max(COIN.thinnest, squeeze);
  const scale = radius / (disc.radius * image.width);
  const width = image.width * scale;
  const height = image.height * scale * tilt;
  context.drawImage(image.source, at.x - disc.x * width, at.y - disc.y * height, width, height);
}

/**
 * A gold coin drawn from shapes, its rim showing beneath the face when tilted.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {CoinPose} pose
 */
function paintDrawnCoin(context, theme, { at, radius, face, squeeze }) {
  const tilt = Math.max(COIN.thinnest, squeeze);
  const { accent, accentLight, accentDark } = theme.colors;
  const edge = radius * COIN.edge * (1 - squeeze);
  context.save();
  context.fillStyle = accentDark;
  context.beginPath();
  context.ellipse(at.x, at.y + edge, radius, radius * tilt, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = radialGradient(context, { x: at.x - radius * 0.35, y: at.y - radius * 0.35 * tilt }, radius * 1.6, [
    [0, accentLight],
    [0.45, accent],
    [1, accentDark],
  ]);
  context.beginPath();
  context.ellipse(at.x, at.y, radius, radius * tilt, 0, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = Math.max(1, radius * COIN.rim);
  context.strokeStyle = accentDark;
  context.stroke();
  context.lineWidth = Math.max(1, radius * COIN.rim * 0.4);
  context.strokeStyle = withAlpha(accentLight, 0.7);
  context.beginPath();
  context.ellipse(at.x, at.y, radius * COIN.ring, radius * COIN.ring * tilt, 0, 0, Math.PI * 2);
  context.stroke();
  context.translate(at.x, at.y);
  context.scale(1, tilt);
  paintEmblem(context, theme, face, radius);
  context.restore();
}

/**
 * The device struck on a face, centred on the origin: a sun for heads, a star for tails.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} face
 * @param {number} radius
 */
function paintEmblem(context, theme, face, radius) {
  const origin = { x: 0, y: 0 };
  context.fillStyle = theme.colors.accentDark;
  if (face === CoinFace.HEADS) {
    starPath(context, origin, radius * EMBLEM.sunRadius, { points: EMBLEM.sunRays, innerRatio: EMBLEM.sunInner });
    context.fill();
    context.fillStyle = theme.colors.accent;
    context.strokeStyle = theme.colors.accentDark;
    context.lineWidth = Math.max(1, radius * 0.05);
    context.beginPath();
    context.arc(0, 0, radius * EMBLEM.sunDisc, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    return;
  }
  starPath(context, origin, radius * EMBLEM.starRadius, { points: EMBLEM.starPoints, innerRatio: EMBLEM.starInner });
  context.fill();
}

/**
 * The coin's shadow on the table, smaller and fainter the higher it flies.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ rest: Point, radius: number, strength: number }} shadow `rest`: where the coin lies on the table
 */
function paintShadow(context, theme, { rest, radius, strength }) {
  const y = rest.y + COIN.radius * SHADOW.drop;
  context.save();
  context.fillStyle = radialGradient(context, { x: rest.x, y }, radius, [
    [0, withAlpha(theme.colors.letterbox, SHADOW.alpha * strength)],
    [1, withAlpha(theme.colors.letterbox, 0)],
  ]);
  context.beginPath();
  context.ellipse(rest.x, y, radius, radius * SHADOW.flatness, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/**
 * The landing: a ring of light spreading out and a glow that stays under the coin.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ at: Point, radius: number, shine: number }} flash `shine`: 0 → 1 through the flash
 */
function paintShine(context, theme, { at, radius, shine }) {
  const { accent, accentLight } = theme.colors;
  context.save();
  context.fillStyle = radialGradient(context, at, radius * SHINE.halo, [
    [0, withAlpha(accentLight, SHINE.haloAlpha * shine)],
    [1, withAlpha(accent, 0)],
  ]);
  context.fillRect(at.x - radius * SHINE.halo, at.y - radius * SHINE.halo, 2 * radius * SHINE.halo, 2 * radius * SHINE.halo);
  context.globalAlpha *= 1 - shine;
  context.strokeStyle = accentLight;
  context.shadowColor = withAlpha(accentLight, 0.9);
  context.shadowBlur = SHINE.blur;
  context.lineWidth = SHINE.ringWidth;
  context.beginPath();
  context.arc(at.x, at.y, radius * (1 + SHINE.reach * shine), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

/**
 * A soft ring of light behind the winner's coin.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} at
 * @param {number} radius
 * @param {{ color: string, alpha: number, blur: number }} style
 */
function paintHalo(context, at, radius, { color, alpha, blur }) {
  context.save();
  context.globalAlpha *= alpha;
  context.strokeStyle = withAlpha(color, 0.9);
  context.shadowColor = color;
  context.shadowBlur = blur;
  context.lineWidth = 3;
  context.beginPath();
  context.arc(at.x, at.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
