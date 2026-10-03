/**
 * The turn and its clock. The player's own turn opens on two warm chimes
 * rising a fifth over a soft pad — an invitation, not an alarm; the
 * opponent's on a single low, muted one. Ending a turn is a soft pass of
 * air. The clock ticks like wood in its last seconds, a touch brighter and
 * with a tone in it in the very last ones.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const TURN_PATCHES = Object.freeze([
  {
    cue: SoundCue.TURN_MINE,
    space: 0.4,
    vary: 0,
    render: (voice) => {
      voice.bell({ freq: hz("G4"), ratio: 2, index: 1.2, attack: 0.002, decay: 1, peak: 0.075 });
      voice.bell({ at: 0.12, freq: hz("D5"), ratio: 2, index: 1.2, attack: 0.002, decay: 1.2, peak: 0.07 });
      for (const note of ["G3", "D4"]) {
        voice.tone({ wave: "triangle", freq: hz(note), attack: 0.1, decay: 0.9, peak: 0.035, filter: { type: "lowpass", freq: 1500 } });
      }
    },
  },
  {
    cue: SoundCue.TURN_THEIRS,
    space: 0.35,
    vary: 0,
    render: (voice) => {
      voice.tone({ wave: "triangle", freq: hz("D4"), attack: 0.01, decay: 0.5, peak: 0.07, filter: { type: "lowpass", freq: 1200 } });
      voice.bell({ freq: hz("D5"), ratio: 2, index: 0.6, attack: 0.002, decay: 0.6, peak: 0.025 });
    },
  },
  {
    cue: SoundCue.TURN_END,
    space: 0.15,
    vary: 0.02,
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.03, decay: 0.15, peak: 0.075, filter: { type: "bandpass", freq: 1200, to: 600, q: 1 } });
      voice.tone({ freq: 700, to: 500, attack: 0.003, decay: 0.12, peak: 0.045 });
    },
  },
  {
    cue: SoundCue.CLOCK_TICK,
    space: 0.06,
    vary: 0,
    render: (voice) => {
      voice.noise({ attack: 0.001, decay: 0.018, peak: 0.13, filter: { type: "bandpass", freq: 2600, q: 3 } });
      voice.tone({ freq: 1050, attack: 0.001, decay: 0.02, peak: 0.045 });
    },
  },
  {
    cue: SoundCue.CLOCK_URGENT,
    space: 0.08,
    vary: 0,
    render: (voice) => {
      voice.noise({ attack: 0.001, decay: 0.02, peak: 0.15, filter: { type: "bandpass", freq: 3200, q: 3 } });
      voice.tone({ freq: 1400, attack: 0.001, decay: 0.06, peak: 0.065 });
    },
  },
]);
