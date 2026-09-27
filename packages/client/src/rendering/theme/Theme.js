/**
 * Visual tokens (colours, fonts, spacing, logical resolution) loaded from
 * data/ui/theme.json and validated like every other data file. Draw code
 * reads tokens from here and never hardcodes colours or sizes.
 */
import { Issues, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";

export const THEME_SCHEMA_VERSION = 2;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"\-_]{1,120}$/;
const THEME_KEYS = Object.freeze(["schemaVersion", "layout", "colors", "fonts", "spacing", "animation"]);
const COLOR_KEYS = Object.freeze([
  "background",
  "backgroundGlow",
  "letterbox",
  "panel",
  "panelLight",
  "panelDark",
  "panelBorder",
  "text",
  "textMuted",
  "accent",
  "accentLight",
  "accentDark",
  "accentText",
  "danger",
  "success",
  "disabled",
  "disabledText",
  "focus",
  "hover",
  "resource",
  "attack",
  "health",
  "cardFace",
  "cardText",
]);
/** Every faction carries three tones: its identity colour, a highlight and a shadow. */
const FACTION_TONE_KEYS = Object.freeze(["base", "light", "dark"]);
const FONT_SIZE_KEYS = Object.freeze(["title", "heading", "body", "small", "tiny", "micro"]);
const ANIMATION_KEYS = Object.freeze(["shortMs", "mediumMs", "longMs"]);
const LAYOUT_BOUNDS = Object.freeze({ min: 320, max: 8192 });
const FONT_BOUNDS = Object.freeze({ min: 6, max: 200 });
const SPACING_BOUNDS = Object.freeze({ min: 0, max: 64 });
const ANIMATION_BOUNDS = Object.freeze({ min: 0, max: 5000 });
const MAX_FACTIONS = 16;

/**
 * @typedef {Readonly<{ base: string, light: string, dark: string }>} FactionTones
 * @typedef {"title" | "heading" | "body" | "small" | "tiny" | "micro"} FontSize
 * @typedef {Readonly<{
 *   layout: Readonly<{ logicalWidth: number, logicalHeight: number }>,
 *   colors: Readonly<Record<string, string>> & Readonly<{ factions: Readonly<Record<string, FactionTones>> }>,
 *   fonts: Readonly<{ family: string, displayFamily: string, sizes: Readonly<Record<FontSize, number>> }>,
 *   spacing: Readonly<{ unit: number, radius: number }>,
 *   animation: Readonly<Record<string, number>>,
 *   illustrations?: import("../cards/CardIllustrations.js").IllustrationSource,
 * }>} Theme `illustrations` is not read from theme.json: the composition root attaches the
 *   painted card art, and without it every card is drawn procedurally
 */

/**
 * @param {unknown} raw
 * @returns {import("@magic8/engine/shared/Result.js").Ok<Theme> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateTheme(raw) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "theme", THEME_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "theme.schemaVersion", { min: THEME_SCHEMA_VERSION, max: THEME_SCHEMA_VERSION });
  const theme = {
    layout: checkLayout(issues, object.layout),
    colors: checkColors(issues, object.colors),
    fonts: checkFonts(issues, object.fonts),
    spacing: checkNumbers(issues, object.spacing, { path: "theme.spacing", keys: ["unit", "radius"], bounds: SPACING_BOUNDS }),
    animation: checkNumbers(issues, object.animation, { path: "theme.animation", keys: ANIMATION_KEYS, bounds: ANIMATION_BOUNDS }),
  };
  if (!issues.isEmpty) {
    return issues.toResult(undefined);
  }
  // Every check passed, so each part has the shape the checks enforce.
  return issues.toResult(/** @type {Theme} */ (Object.freeze(theme)));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 */
function checkLayout(issues, raw) {
  return checkNumbers(issues, raw, { path: "theme.layout", keys: ["logicalWidth", "logicalHeight"], bounds: LAYOUT_BOUNDS });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 */
function checkColors(issues, raw) {
  const object = checkObject(issues, raw, "theme.colors", [...COLOR_KEYS, "factions"]);
  if (object === undefined) {
    return undefined;
  }
  /** @type {Record<string, unknown>} */
  const colors = {};
  for (const key of COLOR_KEYS) {
    colors[key] = checkString(issues, object[key], `theme.colors.${key}`, { pattern: COLOR_PATTERN });
  }
  const factions = checkObject(issues, object.factions, "theme.colors.factions");
  const factionColors = {};
  for (const [faction, tones] of Object.entries(factions ?? {}).slice(0, MAX_FACTIONS)) {
    factionColors[faction] = checkFactionTones(issues, tones, `theme.colors.factions.${faction}`);
  }
  colors.factions = Object.freeze(factionColors);
  return Object.freeze(colors);
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 */
function checkFactionTones(issues, raw, path) {
  const object = checkObject(issues, raw, path, FACTION_TONE_KEYS);
  if (object === undefined) {
    return undefined;
  }
  /** @type {Record<string, string | undefined>} */
  const tones = {};
  for (const key of FACTION_TONE_KEYS) {
    tones[key] = checkString(issues, object[key], `${path}.${key}`, { pattern: COLOR_PATTERN });
  }
  return Object.freeze(tones);
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 */
function checkFonts(issues, raw) {
  const object = checkObject(issues, raw, "theme.fonts", ["family", "displayFamily", "sizes"]);
  if (object === undefined) {
    return undefined;
  }
  return Object.freeze({
    family: checkString(issues, object.family, "theme.fonts.family", { pattern: FONT_FAMILY_PATTERN }),
    displayFamily: checkString(issues, object.displayFamily, "theme.fonts.displayFamily", { pattern: FONT_FAMILY_PATTERN }),
    sizes: checkNumbers(issues, object.sizes, { path: "theme.fonts.sizes", keys: FONT_SIZE_KEYS, bounds: FONT_BOUNDS }),
  });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {{ path: string, keys: readonly string[], bounds: { min: number, max: number } }} schema
 */
function checkNumbers(issues, raw, { path, keys, bounds }) {
  const object = checkObject(issues, raw, path, keys);
  if (object === undefined) {
    return undefined;
  }
  /** @type {Record<string, number | undefined>} */
  const numbers = {};
  for (const key of keys) {
    numbers[key] = checkInteger(issues, object[key], `${path}.${key}`, bounds);
  }
  return Object.freeze(numbers);
}

/** Sizes set in the display face (titles and headings read as game type, body text stays a UI face). */
const DISPLAY_SIZES = Object.freeze(["title", "heading"]);

/**
 * CSS font shorthand for a theme size.
 * @param {Theme} theme
 * @param {FontSize} size
 * @param {"normal" | "bold"} [weight]
 */
export function fontFor(theme, size, weight = "normal") {
  const family = DISPLAY_SIZES.includes(size) ? theme.fonts.displayFamily : theme.fonts.family;
  return `${weight} ${theme.fonts.sizes[size]}px ${family}`;
}

/**
 * CSS font shorthand in the display face at an arbitrary pixel size, for
 * card names and other decorative text that scales with its frame.
 * @param {Theme} theme
 * @param {number} pixels
 * @param {"normal" | "bold"} [weight]
 */
export function displayFont(theme, pixels, weight = "bold") {
  return `${weight} ${Math.max(1, Math.round(pixels))}px ${theme.fonts.displayFamily}`;
}

/**
 * CSS font shorthand in the body face at an arbitrary pixel size.
 * @param {Theme} theme
 * @param {number} pixels
 * @param {"normal" | "bold"} [weight]
 */
export function bodyFont(theme, pixels, weight = "normal") {
  return `${weight} ${Math.max(1, Math.round(pixels))}px ${theme.fonts.family}`;
}

/**
 * The three tones of a faction, falling back to neutral panel colours for
 * unknown factions so content never breaks the renderer.
 * @param {Theme} theme
 * @param {string} faction
 * @returns {FactionTones}
 */
export function factionTones(theme, faction) {
  return theme.colors.factions[faction] ?? Object.freeze({ base: theme.colors.panelBorder, light: theme.colors.textMuted, dark: theme.colors.panelDark });
}
