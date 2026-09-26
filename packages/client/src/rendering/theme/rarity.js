/**
 * How a rarity looks: its theme colour (common → legendary, from muted to
 * gold) and its label. Shared by the card face, the card strips and every
 * screen that names a rarity, so a rarity reads the same everywhere.
 */
import { capitalize } from "../text/textUtils.js";

/** Rarity → theme colour key. */
const RARITY_COLOR_KEYS = Object.freeze({ common: "textMuted", uncommon: "success", rare: "resource", epic: "attack", legendary: "accent" });

/**
 * Theme colour key of a rarity ("textMuted" when unknown).
 * @param {string | null | undefined} rarity
 */
export const rarityColorKey = (rarity) => RARITY_COLOR_KEYS[/** @type {keyof typeof RARITY_COLOR_KEYS} */ (rarity ?? "")] ?? "textMuted";

/**
 * @param {import("./Theme.js").Theme} theme
 * @param {string | null | undefined} rarity
 */
export const rarityColor = (theme, rarity) => /** @type {Record<string, string>} */ (theme.colors)[rarityColorKey(rarity)] ?? theme.colors.textMuted;

/**
 * "Rare"; empty when unknown.
 * @param {string | null | undefined} rarity
 */
export const rarityLabel = (rarity) => (rarity ? capitalize(rarity) : "");
