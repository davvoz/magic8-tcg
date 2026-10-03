/**
 * Cards: stiff paper on felt. A draw slides off the deck, a pick is a short
 * flick, a creature put down lands with a soft thump and the slap of its
 * edge, a card turned over is two quick flicks; a discard slides away and
 * drops, a card sent back to its hand lifts off with a rising whoosh.
 *
 * All noise, filtered: paper has no pitch. The pitch that wanders on each
 * play moves the filters, so no two draws sound alike.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const CARD_PATCHES = Object.freeze([
  {
    cue: SoundCue.CARD_DRAW,
    space: 0.06,
    vary: 0.07,
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.012, hold: 0.03, decay: 0.09, peak: 0.15, filter: { type: "bandpass", freq: 1800, to: 4200, q: 0.9 } });
      voice.noise({ at: 0.085, attack: 0.001, decay: 0.016, peak: 0.045, filter: { type: "highpass", freq: 5000 } });
    },
  },
  {
    cue: SoundCue.CARD_PICK,
    space: 0.05,
    vary: 0.05,
    render: (voice) => {
      voice.noise({ attack: 0.002, decay: 0.035, peak: 0.09, filter: { type: "highpass", freq: 3000 } });
      voice.tone({ freq: 1200, to: 1600, attack: 0.002, decay: 0.04, peak: 0.035 });
    },
  },
  {
    cue: SoundCue.CARD_PLACE,
    space: 0.1,
    vary: 0.05,
    render: (voice) => {
      voice.tone({ freq: 150, to: 62, attack: 0.002, decay: 0.12, peak: 0.28 });
      voice.noise({ color: "pink", attack: 0.002, decay: 0.07, peak: 0.15, filter: { type: "lowpass", freq: 1400, to: 500 } });
      voice.noise({ attack: 0.001, decay: 0.02, peak: 0.055, filter: { type: "bandpass", freq: 2500, q: 1 } });
    },
  },
  {
    cue: SoundCue.CARD_FLIP,
    space: 0.06,
    vary: 0.05,
    render: (voice) => {
      voice.noise({ attack: 0.002, decay: 0.03, peak: 0.09, filter: { type: "bandpass", freq: 3000, q: 1.2 } });
      voice.noise({ at: 0.05, attack: 0.002, decay: 0.035, peak: 0.075, filter: { type: "bandpass", freq: 3600, q: 1.2 } });
    },
  },
  {
    cue: SoundCue.CARD_DISCARD,
    space: 0.1,
    vary: 0.05,
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.01, hold: 0.02, decay: 0.16, peak: 0.12, filter: { type: "bandpass", freq: 3500, to: 900, q: 1 } });
      voice.tone({ at: 0.17, freq: 120, to: 70, attack: 0.002, decay: 0.08, peak: 0.08 });
    },
  },
  {
    cue: SoundCue.CARD_RETURN,
    space: 0.2,
    vary: 0.03,
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.08, decay: 0.14, peak: 0.11, filter: { type: "bandpass", freq: 700, to: 3200, q: 1.1 } });
      voice.tone({ freq: 400, to: 800, attack: 0.05, decay: 0.15, peak: 0.035 });
    },
  },
]);
