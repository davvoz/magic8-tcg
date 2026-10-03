/**
 * The economy: buying, selling, the cart. A payment is a handful of coins
 * set down — a few clinks, never the same twice; cards arriving are a
 * rising arpeggio of bells over a soft pad, and a rare card among them adds
 * a sweep of light and a high chord. The cart takes and gives back with a
 * soft pop, a coin's ting in what goes in.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";
import { COIN_RATIO } from "./coinPatches.js";

/** The clinks of a payment, as offsets in seconds. */
const CLINKS = Object.freeze([0, 0.055, 0.11, 0.19]);

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const ECONOMY_PATCHES = Object.freeze([
  {
    cue: SoundCue.COINS,
    space: 0.15,
    vary: 0,
    render: (voice) => {
      voice.tone({ freq: 300, to: 200, attack: 0.002, decay: 0.04, peak: 0.04 });
      CLINKS.forEach((at, index) => {
        voice.bell({ at: at + voice.vary(0, 0.012), freq: voice.vary(2600, 3600), ratio: COIN_RATIO, index: 2.2, attack: 0.001, decay: voice.vary(0.18, 0.3), peak: 0.07 - index * 0.01 });
      });
    },
  },
  {
    cue: SoundCue.PURCHASE_COMPLETE,
    space: 0.45,
    vary: 0,
    duck: { depth: 0.5, ms: 1800 },
    render: (voice) => {
      ["C5", "E5", "G5", "C6"].forEach((note, index) => {
        voice.bell({ at: index * 0.08, freq: hz(note), ratio: 2, index: 1.1, attack: 0.002, decay: 0.9, peak: 0.065 });
      });
      for (const note of ["C4", "G4"]) {
        voice.tone({ wave: "triangle", freq: hz(note), attack: 0.1, decay: 1.2, peak: 0.03, filter: { type: "lowpass", freq: 1600 } });
      }
      voice.noise({ color: "pink", attack: 0.3, decay: 0.8, peak: 0.022, filter: { type: "highpass", freq: 6000 } });
    },
  },
  {
    cue: SoundCue.RARE_REVEAL,
    space: 0.55,
    vary: 0,
    duck: { depth: 0.5, ms: 2000 },
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.5, decay: 0.3, peak: 0.055, filter: { type: "bandpass", freq: 600, to: 5000, q: 1.5, glide: 0.6 } });
      voice.tone({ freq: 110, attack: 0.4, decay: 0.8, peak: 0.07 });
      ["E6", "B6", "E7"].forEach((note, index) => {
        voice.bell({ at: 0.45 + index * 0.1, freq: hz(note), ratio: 2, index: 1.2, attack: 0.002, decay: 1.3, peak: 0.055 - index * 0.01 });
      });
    },
  },
  {
    cue: SoundCue.CART_ADD,
    space: 0.1,
    vary: 0.02,
    render: (voice) => {
      voice.tone({ freq: 520, to: 880, attack: 0.002, decay: 0.07, peak: 0.12 });
      voice.bell({ at: 0.04, freq: 3200, ratio: COIN_RATIO, index: 2, attack: 0.001, decay: 0.2, peak: 0.032 });
    },
  },
  {
    cue: SoundCue.CART_REMOVE,
    space: 0.08,
    vary: 0.02,
    render: (voice) => {
      voice.tone({ freq: 760, to: 420, attack: 0.002, decay: 0.08, peak: 0.11 });
      voice.noise({ attack: 0.001, decay: 0.02, peak: 0.04, filter: { type: "bandpass", freq: 2500, q: 1.5 } });
    },
  },
]);
