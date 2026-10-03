/**
 * The single place where the game's sounds are made available. A new sound
 * is a patch in one of these families (or a new family registered here);
 * whatever plays cues needs no change.
 */
import { SoundBank } from "./SoundBank.js";
import { CARD_PATCHES } from "./patches/cardPatches.js";
import { COIN_PATCHES } from "./patches/coinPatches.js";
import { COMBAT_PATCHES } from "./patches/combatPatches.js";
import { ECONOMY_PATCHES } from "./patches/economyPatches.js";
import { END_PATCHES } from "./patches/endPatches.js";
import { INTERFACE_PATCHES } from "./patches/interfacePatches.js";
import { MAGIC_PATCHES } from "./patches/magicPatches.js";
import { TURN_PATCHES } from "./patches/turnPatches.js";

/** @returns {SoundBank} */
export function createCoreSoundBank() {
  return new SoundBank()
    .registerAll(INTERFACE_PATCHES)
    .registerAll(COIN_PATCHES)
    .registerAll(CARD_PATCHES)
    .registerAll(MAGIC_PATCHES)
    .registerAll(COMBAT_PATCHES)
    .registerAll(TURN_PATCHES)
    .registerAll(END_PATCHES)
    .registerAll(ECONOMY_PATCHES);
}
