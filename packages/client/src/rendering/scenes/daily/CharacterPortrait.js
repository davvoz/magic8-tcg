/**
 * A challenge character's living portrait: their painted image breathing
 * slowly (Theme.characterArt), or until one is painted a medallion with
 * their initial, floating in their faction's light. Either way the air
 * around them moves with their faction's aura (FactionAura), a boss is ringed
 * in red, and where the player stands shows in the light: the next opponent
 * is bright, a beaten or locked one dimmed.
 *
 * Everything is drawn from the clock the scene keeps, so the node holds no
 * animation state of its own.
 */
import { paintAura } from "./FactionAura.js";
import { factionTones, displayFont } from "../../theme/Theme.js";
import { shade, withAlpha } from "../../theme/color.js";
import { drawImageCover, drawTextInRect, radialGradient, roundedRectPath, verticalGradient, horizontalGradient } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";

/**
 * @typedef {"stacked" | "beside"} PortraitLayout `stacked`: the figure above, the name under it on the image; `beside`: the figure on the left, the name to its right (a phone's short card)
 * @typedef {"beaten" | "next" | "locked"} PortraitState
 * @typedef {Readonly<{ id: string, name: string, faction: string, boss: boolean, state: PortraitState }>} PortraitCharacter what a portrait shows of a character
 */

/** How lit each state is: the aura's strength and the veil over the portrait. */
const LIGHT = Object.freeze({
  next: Object.freeze({ aura: 1, veil: 0 }),
  beaten: Object.freeze({ aura: 0.5, veil: 0.3 }),
  locked: Object.freeze({ aura: 0.35, veil: 0.5 }),
});
/** One loop of each motion, in ms. */
const PERIOD = Object.freeze({ breath: 7000, bob: 3200, pulse: 2600, ring: 24_000 });
const TAU = Math.PI * 2;

export class CharacterPortrait extends UiNode {
  #id;
  #faction;
  #boss;
  #state;
  #initial;
  #layout;
  #clock;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number,
   *   character: PortraitCharacter, layout: PortraitLayout, clock: () => number }} options `clock`: the scene's animation time, in ms
   */
  constructor({ character, layout, clock, ...frame }) {
    super(frame);
    this.passthrough = true;
    this.#id = character.id;
    this.#faction = character.faction;
    this.#boss = character.boss;
    this.#state = character.state;
    this.#initial = initialOf(character.name);
    this.#layout = layout;
    this.#clock = clock;
  }

  /** Where the name goes, inside the portrait: under the figure, or beside it. */
  get textArea() {
    const { width, height } = this;
    return this.#layout === "stacked" ? { x: 0, y: height * 0.62, width, height: height * 0.38 } : { x: height, y: 0, width: width - height, height };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const timeMs = this.#clock();
    const tones = factionTones(theme, this.#faction);
    const light = LIGHT[this.#state] ?? LIGHT.locked;
    const center = this.#figureCenter();
    const radius = theme.spacing.radius;
    const aura = { area, faction: this.#faction, timeMs, seed: this.#id, intensity: light.aura };

    context.save();
    roundedRectPath(context, area, radius);
    context.clip();
    context.fillStyle = radialGradient(context, center, Math.max(area.width, area.height) * 0.8, [[0, withAlpha(tones.base, 0.6)], [0.5, tones.dark], [1, shade(tones.dark, -0.5)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    paintAura(context, theme, { ...aura, share: [0, 0.5] });
    const art = theme.characterArt?.imageFor(this.#id) ?? null;
    if (art === null) {
      this.#paintMedallion(context, theme, { center, tones, timeMs });
    } else {
      this.#paintArt(context, theme, art, timeMs);
    }
    paintAura(context, theme, { ...aura, share: [0.5, 1] });
    this.#paintShade(context, theme, light.veil);
    context.restore();

    context.save();
    roundedRectPath(context, area, radius);
    context.lineWidth = 1.5;
    context.strokeStyle = withAlpha(this.#boss ? theme.colors.danger : tones.light, 0.55);
    context.stroke();
    context.restore();
  }

  /**
   * Where the painted portrait goes: the whole frame, or beside the name
   * only the square left of it (a strip that wide would put the face under
   * the name).
   */
  #artArea() {
    const { x, y, width, height } = this.bounds;
    return this.#layout === "stacked" ? { x, y, width, height } : { x, y, width: height * 1.3, height };
  }

  /**
   * The painted portrait, breathing; beside the name its right edge melts
   * into the dark under the name instead of ending in a cut.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {import("../../cards/CardIllustrations.js").Illustration} art
   * @param {number} timeMs
   */
  #paintArt(context, theme, art, timeMs) {
    const drawn = breathing(this.#artArea(), art.focus, timeMs);
    drawImageCover(context, art.image, drawn, art.focus);
    if (this.#layout === "beside") {
      const dark = theme.colors.panelDark;
      const fade = { x: drawn.x + drawn.width * 0.55, y: drawn.y, width: drawn.width * 0.45, height: drawn.height };
      context.fillStyle = horizontalGradient(context, fade, [[0, withAlpha(dark, 0)], [1, dark]]);
      context.fillRect(fade.x, fade.y, fade.width, fade.height);
      const { x, width } = this.bounds;
      context.fillStyle = dark;
      context.fillRect(fade.x + fade.width - 0.5, drawn.y, x + width - fade.x - fade.width + 0.5, drawn.height);
    }
  }

  /** The figure's centre, on the screen. */
  #figureCenter() {
    const { x, y, width, height } = this.bounds;
    return this.#layout === "stacked" ? { x: x + width / 2, y: y + height * 0.38 } : { x: x + height / 2, y: y + height / 2 };
  }

  /**
   * The medallion standing in for a portrait not painted yet: a disc in the
   * faction's colours with the initial, gently floating, its light pulsing,
   * a ring of runes turning round it.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ center: { x: number, y: number }, tones: import("../../theme/Theme.js").FactionTones, timeMs: number }} figure
   */
  #paintMedallion(context, theme, { center, tones, timeMs }) {
    const { height } = this.bounds;
    const size = this.#layout === "stacked" ? 0.28 : 0.36;
    const radius = height * (this.#boss ? size * 1.12 : size);
    const pulse = 0.75 + 0.25 * Math.sin((timeMs / PERIOD.pulse) * TAU);
    const disc = { x: center.x, y: center.y + Math.sin((timeMs / PERIOD.bob) * TAU) * height * 0.025 };
    const rim = this.#boss ? theme.colors.danger : tones.light;

    context.fillStyle = radialGradient(context, disc, radius * 1.9, [[0, withAlpha(rim, 0.4 * pulse)], [1, withAlpha(rim, 0)]]);
    context.fillRect(disc.x - radius * 2, disc.y - radius * 2, radius * 4, radius * 4);
    const runes = this.#boss ? 16 : 12;
    const turn = (timeMs / PERIOD.ring) * TAU;
    context.fillStyle = withAlpha(rim, 0.65);
    for (let index = 0; index < runes; index += 1) {
      const angle = turn + (index / runes) * TAU;
      context.beginPath();
      context.arc(disc.x + Math.cos(angle) * radius * 1.3, disc.y + Math.sin(angle) * radius * 1.3, Math.max(1, radius * 0.045), 0, TAU);
      context.fill();
    }
    context.beginPath();
    context.arc(disc.x, disc.y, radius, 0, TAU);
    context.fillStyle = radialGradient(context, { x: disc.x - radius * 0.3, y: disc.y - radius * 0.35 }, radius * 1.5, [[0, shade(tones.base, 0.15)], [1, shade(tones.dark, -0.2)]]);
    context.fill();
    context.lineWidth = Math.max(1.5, radius * 0.07);
    context.strokeStyle = rim;
    context.stroke();

    context.save();
    context.shadowColor = tones.light;
    context.shadowBlur = radius * 0.45 * pulse;
    const box = { x: disc.x - radius, y: disc.y - radius, width: radius * 2, height: radius * 2 };
    drawTextInRect(context, this.#initial, box, { font: displayFont(theme, radius * 1.1), color: tones.light });
    context.restore();
  }

  /**
   * The darkening that keeps the name readable on the image, a boss's red
   * vignette, and the veil of a beaten or locked opponent.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {number} veil
   */
  #paintShade(context, theme, veil) {
    const area = this.bounds;
    const dark = theme.colors.panelDark;
    const text = this.textArea;
    const under = { x: area.x + text.x, y: area.y + text.y, width: text.width, height: text.height };
    context.fillStyle = this.#layout === "stacked"
      ? verticalGradient(context, under, [[0, withAlpha(dark, 0)], [0.55, withAlpha(dark, 0.7)], [1, withAlpha(dark, 0.9)]])
      : horizontalGradient(context, under, [[0, withAlpha(dark, 0)], [0.3, withAlpha(dark, 0.6)], [1, withAlpha(dark, 0.8)]]);
    context.fillRect(under.x, under.y, under.width, under.height);
    if (this.#boss) {
      const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      context.fillStyle = radialGradient(context, middle, Math.hypot(area.width, area.height) / 2, [[0.55, withAlpha(theme.colors.danger, 0)], [1, withAlpha(theme.colors.danger, 0.4)]]);
      context.fillRect(area.x, area.y, area.width, area.height);
    }
    if (veil > 0) {
      context.fillStyle = withAlpha(dark, veil);
      context.fillRect(area.x, area.y, area.width, area.height);
    }
  }
}

/**
 * The painted portrait, a little larger than its frame and slowly swelling
 * round its focus: the figure seems to breathe.
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {readonly [number, number]} focus
 * @param {number} timeMs
 */
function breathing(area, [focusX, focusY], timeMs) {
  const scale = 1.04 + 0.02 * Math.sin((timeMs / PERIOD.breath) * TAU);
  const width = area.width * scale;
  const height = area.height * scale;
  return { x: area.x - (width - area.width) * focusX, y: area.y - (height - area.height) * focusY, width, height };
}

/** The medallion's letter: the name's last word ("Captain Varek" is V, "The Gravelord" G). */
function initialOf(name) {
  const words = name.trim().split(/\s+/);
  return (words.at(-1)?.[0] ?? "?").toUpperCase();
}
