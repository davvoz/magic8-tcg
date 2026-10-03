/**
 * The opening toss. The coin is flicked off a thumb with a bright ting,
 * whirs as it spins through its arc — the whir beating fast and slowing as
 * the coin tumbles toward the table — lands with a clink and a couple of
 * smaller bounces, and the verdict comes in on a warm chord.
 *
 * The metal is FM at an inharmonic ratio (2.76, like a struck disc): a
 * whole ratio would ring like a bell, not a coin.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";

/** How a struck coin's partials sit above its fundamental. */
export const COIN_RATIO = 2.76;
/** How long the coin is in the air when the toss does not say. */
const DEFAULT_FLIGHT_S = 1.5;

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const COIN_PATCHES = Object.freeze([
  {
    cue: SoundCue.COIN_TOSS,
    space: 0.18,
    vary: 0.02,
    render: (voice, { durationMs }) => {
      const flight = durationMs === undefined ? DEFAULT_FLIGHT_S : Math.max(0.3, durationMs / 1000);
      voice.noise({ attack: 0.001, decay: 0.03, peak: 0.09, filter: { type: "highpass", freq: 2500 } });
      voice.bell({ freq: 3150, ratio: COIN_RATIO, index: 2.5, attack: 0.001, decay: 0.4, peak: 0.06 });
      voice.noise({ at: 0.03, attack: 0.08, hold: Math.max(0, flight - 0.25), decay: 0.12, peak: 0.045, filter: { type: "bandpass", freq: 6200, q: 2.2 }, flutter: { rate: 26, to: 9, depth: 0.9 } });
      voice.bell({ at: 0.05, freq: 4400, ratio: 1.5, index: 0.5, attack: 0.12, hold: flight * 0.5, decay: 0.3, peak: 0.01 });
    },
  },
  {
    cue: SoundCue.COIN_LAND,
    space: 0.14,
    vary: 0.02,
    render: (voice) => {
      voice.tone({ freq: 180, to: 90, attack: 0.002, decay: 0.08, peak: 0.13 });
      voice.noise({ color: "pink", attack: 0.001, decay: 0.045, peak: 0.08, filter: { type: "lowpass", freq: 1500 } });
      voice.bell({ freq: 2900, ratio: COIN_RATIO, index: 3, attack: 0.001, decay: 0.28, peak: 0.09 });
      voice.bell({ at: 0.11, freq: 3050, ratio: COIN_RATIO, index: 2.4, attack: 0.001, decay: 0.2, peak: 0.05 });
      voice.bell({ at: 0.18, freq: 2980, ratio: COIN_RATIO, index: 2, attack: 0.001, decay: 0.15, peak: 0.025 });
    },
  },
  {
    cue: SoundCue.TOSS_VERDICT,
    space: 0.35,
    vary: 0,
    render: (voice) => {
      for (const note of ["C4", "E4", "G4"]) {
        voice.tone({ wave: "triangle", freq: hz(note), attack: 0.02, hold: 0.15, decay: 1, peak: 0.06, filter: { type: "lowpass", freq: 2400, to: 1200 } });
      }
      voice.bell({ at: 0.05, freq: hz("C6"), ratio: 2, index: 1, attack: 0.002, decay: 1.2, peak: 0.055 });
    },
  },
]);
