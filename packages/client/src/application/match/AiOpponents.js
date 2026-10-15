/**
 * The AI opponents a local match can seat, described as data (an AiSpec)
 * and built in one place: which engine AI, at which level, with which style.
 * Practice offers a few named ones; tools (the simulator) write specs as
 * text ("search:7:aggressive"); the daily challenges' characters will be
 * specs too (docs/tcg/24-sfide.md).
 */
import { AI_STYLES, AiStyle, BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { MAX_LEVEL, MIN_LEVEL } from "@magic8/engine/domain/ai/search/DifficultyScale.js";
import { SearchAi } from "@magic8/engine/domain/ai/search/SearchAi.js";
import { AiController } from "./AiController.js";

/** Which of the engine's AIs plays. */
export const AiKind = Object.freeze({
  /** BasicAi: fixed rules, no level. */
  BASIC: "basic",
  /** SearchAi: tries its options, at a level. */
  SEARCH: "search",
});

/**
 * @typedef {Readonly<{ kind: string, level?: number, style?: string }>} AiSpec
 *   `level`: SearchAi only, from MIN_LEVEL to MAX_LEVEL; `style`: one of AiStyle (default balanced)
 * @typedef {Readonly<{ id: string, label: string, spec: AiSpec }>} NamedOpponent
 */

/** The opponents practice offers, weakest first. */
export const PRACTICE_OPPONENTS = Object.freeze(
  /** @type {NamedOpponent[]} */ ([
    { id: "classic", label: "Classic", spec: { kind: AiKind.BASIC } },
    { id: "easy", label: "Easy", spec: { kind: AiKind.SEARCH, level: 2 } },
    { id: "normal", label: "Normal", spec: { kind: AiKind.SEARCH, level: 5 } },
    { id: "hard", label: "Hard", spec: { kind: AiKind.SEARCH, level: 8 } },
    { id: "expert", label: "Expert", spec: { kind: AiKind.SEARCH, level: MAX_LEVEL } },
  ]).map((opponent) => Object.freeze({ ...opponent, spec: Object.freeze(opponent.spec) })),
);

/** The practice opponent offered first. */
export const DEFAULT_PRACTICE_OPPONENT = "normal";

export class AiOpponentFactory {
  #content;
  #effects;

  /**
   * @param {{ content: import("../content/ContentService.js").GameContent, effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry }} deps
   *   the content and effects of the matches the opponents will play
   */
  constructor({ content, effects }) {
    this.#content = content;
    this.#effects = effects;
  }

  /**
   * @param {AiSpec} spec
   * @param {string} [salt] varies a SearchAi's misjudgements between opponents of the same spec
   * @returns {AiController}
   */
  controllerFor(spec, salt = "") {
    const style = spec.style ?? AiStyle.BALANCED;
    if (spec.kind === AiKind.BASIC) {
      return new AiController(new BasicAi(style));
    }
    if (spec.kind === AiKind.SEARCH) {
      return new AiController(new SearchAi({ rules: this.#content.gameRules, catalog: this.#content.catalog, effects: this.#effects, level: spec.level, style, salt }));
    }
    throw new TypeError(`unknown AI kind "${spec.kind}"; expected one of ${Object.values(AiKind).join(", ")}`);
  }
}

/**
 * Reads a spec written as text: "basic", "basic:aggressive", "search:7", "search:7:defensive".
 * @param {string} text
 * @returns {AiSpec}
 */
export function parseAiSpec(text) {
  const [kind, ...rest] = text.trim().toLowerCase().split(":");
  if (kind === AiKind.BASIC && rest.length <= 1) {
    return Object.freeze({ kind, style: styleOf(rest[0], text) });
  }
  if (kind === AiKind.SEARCH && rest.length >= 1 && rest.length <= 2) {
    const level = Number(rest[0]);
    if (!Number.isFinite(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new RangeError(`"${text}": the level must be a number from ${MIN_LEVEL} to ${MAX_LEVEL}`);
    }
    return Object.freeze({ kind, level, style: styleOf(rest[1], text) });
  }
  throw new TypeError(`"${text}" is not an AI: write basic[:style] or search:level[:style]`);
}

/**
 * @param {string | undefined} style
 * @param {string} text the whole spec, for the error
 */
function styleOf(style, text) {
  if (style === undefined) {
    return AiStyle.BALANCED;
  }
  if (!/** @type {readonly string[]} */ (AI_STYLES).includes(style)) {
    throw new TypeError(`"${text}": unknown style "${style}"; expected one of ${AI_STYLES.join(", ")}`);
  }
  return style;
}

/**
 * How a spec reads in a table: "search 7 aggressive".
 * @param {AiSpec} spec
 */
export function describeAiSpec(spec) {
  return [spec.kind, spec.level, spec.style ?? AiStyle.BALANCED].filter((part) => part !== undefined).join(" ");
}
