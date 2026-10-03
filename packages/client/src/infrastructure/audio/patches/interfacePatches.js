/**
 * The interface: buttons, choices, refusals and the toasts that arrive on
 * any screen. Short, soft and dry — heard hundreds of times, they must never
 * tire the ear: a wooden tick for an ordinary button, a two-note pluck to
 * confirm, a low muted knock before something that cannot be undone. The
 * notifications are chimes, rising for good news and falling for bad.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const INTERFACE_PATCHES = Object.freeze([
  {
    cue: SoundCue.UI_CLICK,
    space: 0.04,
    vary: 0.03,
    render: (voice) => {
      voice.noise({ attack: 0.001, decay: 0.028, peak: 0.09, filter: { type: "bandpass", freq: 3600, q: 1.6 } });
      voice.tone({ freq: 1500, to: 950, attack: 0.001, decay: 0.04, peak: 0.08 });
    },
  },
  {
    cue: SoundCue.UI_CONFIRM,
    space: 0.12,
    vary: 0,
    render: (voice) => {
      const pluck = { wave: "triangle", attack: 0.003, decay: 0.2, peak: 0.11, filter: { type: "lowpass", freq: 3800, to: 1600 } };
      voice.tone({ ...pluck, freq: hz("E5") });
      voice.tone({ ...pluck, at: 0.055, freq: hz("B5"), peak: 0.1 });
      voice.noise({ attack: 0.001, decay: 0.02, peak: 0.05, filter: { type: "bandpass", freq: 4200, q: 1.5 } });
    },
  },
  {
    cue: SoundCue.UI_SELECT,
    space: 0.1,
    vary: 0.01,
    render: (voice) => {
      voice.tone({ wave: "triangle", freq: hz("A5"), attack: 0.002, decay: 0.13, peak: 0.09, filter: { type: "lowpass", freq: 4200, to: 1800 } });
      voice.noise({ attack: 0.001, decay: 0.018, peak: 0.05, filter: { type: "highpass", freq: 3500 } });
    },
  },
  {
    cue: SoundCue.UI_DANGER,
    space: 0.15,
    vary: 0,
    render: (voice) => {
      voice.tone({ freq: 220, to: 140, attack: 0.003, decay: 0.24, peak: 0.2 });
      voice.tone({ wave: "triangle", freq: 110, attack: 0.004, decay: 0.3, peak: 0.1, filter: { type: "lowpass", freq: 700 } });
      voice.noise({ color: "pink", attack: 0.002, decay: 0.08, peak: 0.08, filter: { type: "lowpass", freq: 900 } });
    },
  },
  {
    cue: SoundCue.UI_ERROR,
    space: 0.08,
    vary: 0,
    render: (voice) => {
      const note = { wave: "triangle", attack: 0.004, decay: 0.12, peak: 0.12, filter: { type: "lowpass", freq: 1800 } };
      voice.tone({ ...note, freq: hz("G4") });
      voice.tone({ ...note, at: 0.1, freq: hz("Eb4"), decay: 0.18 });
    },
  },
  {
    cue: SoundCue.NOTIFY_INFO,
    space: 0.3,
    vary: 0,
    render: (voice) => {
      voice.bell({ freq: hz("E6"), ratio: 2, index: 1.1, attack: 0.002, decay: 0.9, peak: 0.07 });
      voice.tone({ freq: hz("E7"), attack: 0.002, decay: 0.35, peak: 0.015 });
    },
  },
  {
    cue: SoundCue.NOTIFY_GOOD,
    space: 0.3,
    vary: 0,
    render: (voice) => {
      voice.bell({ freq: hz("C6"), ratio: 2, index: 1, attack: 0.002, decay: 0.75, peak: 0.07 });
      voice.bell({ at: 0.09, freq: hz("G6"), ratio: 2, index: 1, attack: 0.002, decay: 0.95, peak: 0.065 });
    },
  },
  {
    cue: SoundCue.NOTIFY_BAD,
    space: 0.25,
    vary: 0,
    render: (voice) => {
      const note = { wave: "triangle", attack: 0.005, decay: 0.4, peak: 0.1, filter: { type: "lowpass", freq: 2000 } };
      voice.tone({ ...note, freq: hz("A4") });
      voice.tone({ ...note, at: 0.12, freq: hz("F4"), decay: 0.55 });
    },
  },
  {
    cue: SoundCue.CHALLENGE,
    space: 0.35,
    vary: 0,
    duck: { depth: 0.4, ms: 1200 },
    render: (voice) => {
      voice.tone({ freq: 98, to: 58, attack: 0.003, decay: 0.32, peak: 0.16 });
      ["G5", "B5", "D6", "G6"].forEach((note, index) => {
        voice.bell({ at: 0.04 + index * 0.08, freq: hz(note), ratio: 2, index: 1.2, attack: 0.002, decay: 0.9 + index * 0.1, peak: 0.065 });
      });
    },
  },
  {
    cue: SoundCue.MATCH_FOUND,
    space: 0.4,
    vary: 0,
    duck: { depth: 0.5, ms: 1800 },
    render: (voice) => {
      for (const note of ["C4", "E4", "G4"]) {
        for (const detune of [-7, 7]) {
          voice.tone({ wave: "sawtooth", freq: hz(note), detune, attack: 0.25, hold: 0.2, decay: 0.9, peak: 0.022, filter: { type: "lowpass", freq: 300, to: 2400, glide: 0.45 } });
        }
      }
      voice.bell({ at: 0.3, freq: hz("C6"), ratio: 2, index: 1.2, attack: 0.002, decay: 1.1, peak: 0.06 });
      voice.bell({ at: 0.42, freq: hz("G6"), ratio: 2, index: 1.2, attack: 0.002, decay: 1.3, peak: 0.05 });
    },
  },
]);
