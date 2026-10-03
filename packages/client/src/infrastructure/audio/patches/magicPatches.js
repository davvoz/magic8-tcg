/**
 * Spells and abilities. A cast gathers: a dark pad opening up under a few
 * high notes and a breath of air, while the card is held up to be read. It
 * strikes with a low boom and a crack that closes as it falls, a spark
 * above. An ability's rune is a pair of chimes a fifth apart; the
 * crosshair of a random discard ticks from card to card.
 *
 * What the spells did is coloured by its direction: a rising major
 * arpeggio for a creature made stronger, a falling minor one for one
 * weakened, a slow shimmering chord for healing.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";

/** The high notes a cast's shimmer is picked from: a pentatonic, which no order of them can make sour. */
const SHIMMER = Object.freeze(["E6", "G6", "A6", "C7", "D7"].map(hz));

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const MAGIC_PATCHES = Object.freeze([
  {
    cue: SoundCue.SPELL_CAST,
    space: 0.45,
    vary: 0.02,
    render: (voice) => {
      for (const detune of [-8, 8]) {
        voice.tone({ wave: "sawtooth", freq: hz("A3"), detune, attack: 0.35, hold: 0.15, decay: 0.5, peak: 0.03, filter: { type: "lowpass", freq: 300, to: 2600, glide: 0.7 } });
      }
      for (let index = 0; index < 4; index += 1) {
        const note = SHIMMER[Math.floor(voice.vary(0, SHIMMER.length))];
        voice.tone({ at: 0.1 + index * 0.09, freq: note, attack: 0.004, decay: 0.5, peak: 0.022 });
      }
      voice.noise({ color: "pink", attack: 0.4, decay: 0.4, peak: 0.03, filter: { type: "highpass", freq: 6000 } });
    },
  },
  {
    cue: SoundCue.SPELL_STRIKE,
    space: 0.35,
    vary: 0.03,
    render: (voice) => {
      voice.tone({ freq: 95, to: 42, attack: 0.003, decay: 0.35, peak: 0.3 });
      voice.noise({ attack: 0.001, decay: 0.22, peak: 0.17, filter: { type: "lowpass", freq: 6000, to: 400 } });
      voice.bell({ freq: hz("C7"), ratio: 3, index: 2, attack: 0.001, decay: 0.5, peak: 0.025 });
    },
  },
  {
    cue: SoundCue.ABILITY_TRIGGER,
    space: 0.45,
    vary: 0,
    render: (voice) => {
      voice.bell({ freq: hz("E5"), ratio: 2, index: 1.5, attack: 0.002, decay: 1.1, peak: 0.065 });
      voice.bell({ at: 0.07, freq: hz("B5"), ratio: 2, index: 1.5, attack: 0.002, decay: 1.1, peak: 0.045 });
      voice.tone({ wave: "triangle", freq: hz("E4"), attack: 0.08, decay: 0.6, peak: 0.03, filter: { type: "lowpass", freq: 1500 } });
    },
  },
  {
    cue: SoundCue.TARGET_SEEK,
    space: 0.08,
    vary: 0.01,
    render: (voice) => {
      voice.tone({ freq: 1900, attack: 0.001, decay: 0.03, peak: 0.045 });
      voice.noise({ attack: 0.001, decay: 0.015, peak: 0.04, filter: { type: "bandpass", freq: 4000, q: 2 } });
    },
  },
  {
    cue: SoundCue.BUFF,
    space: 0.3,
    vary: 0,
    render: (voice) => {
      ["C5", "E5", "G5"].forEach((note, index) => voice.tone({ at: index * 0.06, freq: hz(note), attack: 0.004, decay: 0.35, peak: 0.065 }));
      voice.noise({ attack: 0.05, decay: 0.3, peak: 0.022, filter: { type: "highpass", freq: 7000 } });
    },
  },
  {
    cue: SoundCue.DEBUFF,
    space: 0.25,
    vary: 0,
    render: (voice) => {
      ["G4", "Eb4", "C4"].forEach((note, index) => voice.tone({ wave: "triangle", at: index * 0.07, freq: hz(note), attack: 0.004, decay: 0.3, peak: 0.075, filter: { type: "lowpass", freq: 1500 } }));
      voice.tone({ freq: 200, to: 120, attack: 0.01, decay: 0.3, peak: 0.055 });
    },
  },
  {
    cue: SoundCue.HEAL,
    space: 0.5,
    vary: 0,
    render: (voice) => {
      for (const note of ["G5", "B5", "D6"]) {
        voice.tone({ freq: hz(note), attack: 0.12, hold: 0.1, decay: 0.7, peak: 0.035 });
      }
      voice.bell({ at: 0.1, freq: hz("G6"), ratio: 2, index: 0.8, attack: 0.002, decay: 0.8, peak: 0.028 });
      voice.noise({ color: "pink", attack: 0.2, decay: 0.4, peak: 0.02, filter: { type: "highpass", freq: 5000 } });
    },
  },
]);
