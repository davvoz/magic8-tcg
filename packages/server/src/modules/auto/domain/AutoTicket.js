/**
 * Auto tickets (docs/tcg/23-automatica.md). A player's place in the auto
 * list: their deck, the style the AI plays it with, their entropy, and the
 * entry they paid on joining.
 *
 * - PREPARED: the server made the ticket's secret and told the player only
 *   its commitment, so the secret was fixed before the player's entropy.
 * - WAITING: the player joined (deck, style, entropy) and paid. Once in,
 *   they stay in: there is no leaving the list.
 * - MATCHED: its game was played.
 * - REFUNDED: the season ended before an opponent came; the entry went back.
 * - FAILED: its game could not be played (a bug); the entry went back.
 */
import { AI_STYLES } from "@magic8/engine/domain/ai/BasicAi.js";

export const AutoTicketStatus = Object.freeze({ PREPARED: "PREPARED", WAITING: "WAITING", MATCHED: "MATCHED", REFUNDED: "REFUNDED", FAILED: "FAILED" });

/** The styles a player may choose, as the engine's AI knows them. */
export const AUTO_STYLES = AI_STYLES;

/** A player's entropy: 16 random bytes, lowercase hex (the size the game protocol takes). */
export const ENTROPY_PATTERN = /^[0-9a-f]{32}$/;

/** Why a waiting ticket left the list without a game. */
export const AutoCloseReason = Object.freeze({ SEASON_ENDED: "season_ended", FAILED: "failed" });
