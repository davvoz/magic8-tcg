/**
 * Notes by name, for the patches that are music (chimes, fanfares, chords):
 * equal temperament, A4 = 440 Hz.
 */

const SEMITONES = Object.freeze({ C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 });
const ACCIDENTALS = Object.freeze({ "": 0, "#": 1, b: -1 });
const NOTE = /^([A-G])([#b]?)(-?\d)$/;

/**
 * @param {string} name "C4", "F#5", "Bb3"
 * @returns {number} its frequency in Hz
 */
export function hz(name) {
  const match = NOTE.exec(name);
  if (match === null) {
    throw new RangeError(`notes: "${name}" is not a note`);
  }
  const [, letter, accidental, octave] = match;
  const fromA4 = SEMITONES[/** @type {keyof typeof SEMITONES} */ (letter)] + ACCIDENTALS[/** @type {keyof typeof ACCIDENTALS} */ (accidental)] + (Number(octave) - 4) * 12;
  return 440 * 2 ** (fromA4 / 12);
}
