/**
 * Combat. Attackers are declared with a blade drawn over a low drum, a
 * block with the knock of a shield; each blow is a whoosh as the creature
 * lunges, then the hit as it lands — a creature struck is a punch, a player
 * struck is heavier, with the ring of their life crystal in it. A creature
 * that dies crumbles: a falling rumble that breaks up as it goes.
 *
 * The scene scales a hit with the damage it does (`gain`, `pitch`): the
 * patches are the blow of an ordinary creature.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { hz } from "../synth/notes.js";

/** @type {readonly import("../SoundBank.js").SoundPatch[]} */
export const COMBAT_PATCHES = Object.freeze([
  {
    cue: SoundCue.ATTACK_DECLARE,
    space: 0.25,
    vary: 0.02,
    render: (voice) => {
      voice.noise({ attack: 0.03, hold: 0.05, decay: 0.18, peak: 0.09, filter: { type: "bandpass", freq: 1800, to: 7000, q: 2.5 } });
      voice.bell({ at: 0.08, freq: hz("A6"), ratio: 3.01, index: 1, attack: 0.002, decay: 0.5, peak: 0.022 });
      voice.tone({ freq: 110, to: 70, attack: 0.003, decay: 0.2, peak: 0.12 });
    },
  },
  {
    cue: SoundCue.BLOCK_DECLARE,
    space: 0.2,
    vary: 0.03,
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.001, decay: 0.1, peak: 0.18, filter: { type: "lowpass", freq: 900 } });
      voice.tone({ freq: 180, to: 110, attack: 0.002, decay: 0.15, peak: 0.2 });
      voice.bell({ freq: 620, ratio: 1.41, index: 2, attack: 0.001, decay: 0.35, peak: 0.045 });
    },
  },
  {
    cue: SoundCue.LUNGE,
    space: 0.12,
    vary: 0.06,
    render: (voice) => {
      voice.noise({ color: "pink", attack: 0.07, decay: 0.12, peak: 0.13, filter: { type: "bandpass", freq: 500, to: 2200, q: 1.2 } });
    },
  },
  {
    cue: SoundCue.HIT_CREATURE,
    space: 0.15,
    vary: 0.06,
    render: (voice) => {
      voice.tone({ freq: 170, to: 60, attack: 0.002, decay: 0.14, peak: 0.28 });
      voice.noise({ color: "pink", attack: 0.001, decay: 0.07, peak: 0.2, filter: { type: "lowpass", freq: 2800, to: 600 } });
    },
  },
  {
    cue: SoundCue.HIT_PLAYER,
    space: 0.25,
    vary: 0.04,
    render: (voice) => {
      voice.tone({ freq: 120, to: 38, attack: 0.003, decay: 0.3, peak: 0.33 });
      voice.noise({ color: "pink", attack: 0.001, decay: 0.14, peak: 0.2, filter: { type: "lowpass", freq: 2000, to: 300 } });
      voice.bell({ at: 0.01, freq: 1480, ratio: 2.4, index: 1.4, attack: 0.001, decay: 0.4, peak: 0.035 });
    },
  },
  {
    cue: SoundCue.CREATURE_DEATH,
    space: 0.3,
    vary: 0.04,
    render: (voice) => {
      voice.noise({ color: "brown", attack: 0.01, hold: 0.05, decay: 0.5, peak: 0.2, filter: { type: "lowpass", freq: 1400, to: 180 }, flutter: { rate: 18, to: 6, depth: 0.6 } });
      voice.tone({ freq: 130, to: 45, attack: 0.01, decay: 0.45, peak: 0.15 });
      voice.tone({ wave: "triangle", freq: hz("G2"), attack: 0.05, decay: 0.6, peak: 0.045, filter: { type: "lowpass", freq: 600 } });
    },
  },
]);
