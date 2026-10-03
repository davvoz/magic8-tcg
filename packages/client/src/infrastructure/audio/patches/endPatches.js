/**
 * The end of a match. The fallen player's crystal crackles, the cracks
 * coming faster as they run, over a low rumble; it bursts with a boom, a
 * hiss of glass and a scatter of bright shards. Then the outcome: a short
 * fanfare for a victory — two pickup notes into a full major chord over a
 * timpani stroke, sparkles on top; a slow descent into a minor chord for a
 * defeat; an unresolved chord for a draw. Each dips the music beneath it.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";

/** How long the crystal cracks when the sequence does not say. */
const DEFAULT_CRACK_S = 0.45;
const CRACKLES = 9;
const SHARDS = 14;

/**
 * A brassy note: two sawtooths a few cents apart, through a lowpass that opens on the attack and closes as it rings.
 * @param {import("../synth/Voice.js").Voice} voice
 * @param {{ at: number, note: string, hold: number, decay: number, peak: number, bright?: number }} spec
 */
function brass(voice, { at, note, hold, decay, peak, bright = 2400 }) {
  for (const detune of [-5, 5]) {
    voice.tone({ wave: "sawtooth", at, freq: hz(note), detune, attack: 0.025, hold, decay, peak, filter: { type: "lowpass", freq: bright, to: bright * 0.35, glide: hold + decay } });
  }
}

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const END_PATCHES = Object.freeze([
  {
    cue: SoundCue.CRYSTAL_CRACK,
    space: 0.2,
    vary: 0.02,
    render: (voice, { durationMs }) => {
      const length = durationMs === undefined ? DEFAULT_CRACK_S : Math.max(0.15, durationMs / 1000);
      for (let index = 0; index < CRACKLES; index += 1) {
        const through = index / (CRACKLES - 1);
        voice.noise({ at: length * through ** 0.6, attack: 0.001, decay: voice.vary(0.012, 0.03), peak: 0.05 + 0.07 * through, filter: { type: "bandpass", freq: voice.vary(3000, 7000), q: 4 } });
      }
      voice.noise({ color: "brown", attack: length, decay: 0.1, peak: 0.06, filter: { type: "lowpass", freq: 300 } });
    },
  },
  {
    cue: SoundCue.CRYSTAL_SHATTER,
    space: 0.45,
    vary: 0.02,
    duck: { depth: 0.6, ms: 2500 },
    render: (voice) => {
      voice.tone({ freq: 80, to: 35, attack: 0.003, decay: 0.5, peak: 0.3 });
      voice.noise({ attack: 0.001, decay: 0.45, peak: 0.16, filter: { type: "highpass", freq: 2500 } });
      for (let index = 0; index < SHARDS; index += 1) {
        voice.bell({ at: voice.vary(0, 0.35), freq: voice.vary(2200, 6200), ratio: voice.vary(1.5, 2.9), index: 1.5, attack: 0.001, decay: voice.vary(0.15, 0.45), peak: voice.vary(0.018, 0.045) });
      }
      voice.noise({ attack: 0.05, decay: 0.9, peak: 0.018, filter: { type: "highpass", freq: 8000 } });
    },
  },
  {
    cue: SoundCue.VICTORY,
    space: 0.45,
    vary: 0,
    duck: { depth: 0.7, ms: 2800 },
    render: (voice) => {
      brass(voice, { at: 0, note: "G4", hold: 0.08, decay: 0.12, peak: 0.045 });
      brass(voice, { at: 0.16, note: "C5", hold: 0.08, decay: 0.12, peak: 0.045 });
      for (const note of ["C4", "C5", "E5", "G5"]) {
        brass(voice, { at: 0.34, note, hold: 0.5, decay: 1.2, peak: 0.035 });
      }
      voice.tone({ at: 0.34, freq: 98, to: 60, attack: 0.003, decay: 0.55, peak: 0.2 });
      voice.noise({ at: 0.34, color: "pink", attack: 0.002, decay: 0.3, peak: 0.07, filter: { type: "lowpass", freq: 900 } });
      voice.bell({ at: 0.55, freq: hz("C7"), ratio: 2, index: 1, attack: 0.002, decay: 1, peak: 0.022 });
      voice.bell({ at: 0.68, freq: hz("E7"), ratio: 2, index: 1, attack: 0.002, decay: 1.1, peak: 0.018 });
    },
  },
  {
    cue: SoundCue.DEFEAT,
    space: 0.5,
    vary: 0,
    duck: { depth: 0.7, ms: 3000 },
    render: (voice) => {
      voice.tone({ freq: 70, to: 40, attack: 0.005, decay: 0.8, peak: 0.18 });
      brass(voice, { at: 0, note: "A3", hold: 0.3, decay: 0.6, peak: 0.04, bright: 1100 });
      brass(voice, { at: 0.45, note: "F3", hold: 0.3, decay: 0.6, peak: 0.04, bright: 1000 });
      for (const note of ["D3", "F3", "A3"]) {
        brass(voice, { at: 0.9, note, hold: 0.4, decay: 1.4, peak: 0.032, bright: 900 });
      }
    },
  },
  {
    cue: SoundCue.DRAW,
    space: 0.45,
    vary: 0,
    duck: { depth: 0.6, ms: 2200 },
    render: (voice) => {
      for (const note of ["D4", "G4", "A4"]) {
        voice.tone({ wave: "triangle", freq: hz(note), attack: 0.05, hold: 0.3, decay: 1.2, peak: 0.05, filter: { type: "lowpass", freq: 2000 } });
      }
      voice.bell({ at: 0.1, freq: hz("D6"), ratio: 2, index: 1, attack: 0.002, decay: 1.2, peak: 0.035 });
    },
  },
]);
