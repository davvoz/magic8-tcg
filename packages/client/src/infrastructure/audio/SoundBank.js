/**
 * Registry of what each cue sounds like. A patch is code, registered here
 * once (registerCorePatches.js), never data: it lays the layers of a Voice.
 * A cue nobody registered is simply silent; `missing` lets a test hold the
 * bank to every SoundCue.
 *
 * Registration errors are programmer errors and throw, like the engine's
 * EffectRegistry.
 *
 * @typedef {Readonly<{ durationMs?: number }>} PatchParams what a patch may be told about the moment it plays in
 * @typedef {object} SoundPatch
 * @property {string} cue the SoundCue it plays
 * @property {(voice: import("./synth/Voice.js").Voice, params: PatchParams) => void} render lays its layers
 * @property {number} [space] how much of it goes to the room reverb, 0–1 (default 0.15)
 * @property {number} [vary] how far its pitch may wander on each play, as a fraction (default 0.02; 0 for anything musical)
 * @property {Readonly<{ depth: number, ms: number }>} [duck] how far the music dips under it (0–1) and for how long: the stings worth hearing over it
 */

export class SoundBank {
  /** @type {Map<string, SoundPatch>} */
  #patches = new Map();

  /**
   * @param {SoundPatch} patch
   * @returns {this}
   */
  register(patch) {
    if (typeof patch?.cue !== "string" || patch.cue === "" || typeof patch.render !== "function") {
      throw new TypeError("SoundBank: a patch needs a cue and a render function");
    }
    if (this.#patches.has(patch.cue)) {
      throw new Error(`SoundBank: cue "${patch.cue}" is already registered`);
    }
    for (const field of /** @type {const} */ (["space", "vary"])) {
      const value = patch[field];
      if (value !== undefined && !(Number.isFinite(value) && value >= 0 && value <= 1)) {
        throw new RangeError(`SoundBank: "${patch.cue}" ${field} must be within 0–1`);
      }
    }
    this.#patches.set(patch.cue, Object.freeze({ ...patch }));
    return this;
  }

  /**
   * @param {readonly SoundPatch[]} patches
   * @returns {this}
   */
  registerAll(patches) {
    patches.forEach((patch) => this.register(patch));
    return this;
  }

  /** @param {string} cue */
  get(cue) {
    return this.#patches.get(cue);
  }

  /** @returns {readonly string[]} */
  cues() {
    return Object.freeze([...this.#patches.keys()]);
  }

  /**
   * @param {readonly string[]} cues
   * @returns {readonly string[]} those with no patch
   */
  missing(cues) {
    return Object.freeze(cues.filter((cue) => !this.#patches.has(cue)));
  }
}
