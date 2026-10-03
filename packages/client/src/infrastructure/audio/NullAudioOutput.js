/**
 * AudioOutput that plays nothing: under test, in tools, and wherever the
 * browser has no Web Audio. It remembers what it was asked, for tests.
 */

/** @typedef {import("../../application/ports/AudioOutput.contract.js").AudioOutput} AudioOutput */

/** @implements {AudioOutput} */
export class NullAudioOutput {
  /** Cues asked for, oldest first. @type {{ cue: string, options: import("../../application/ports/AudioOutput.contract.js").PlayOptions }[]} */
  played = [];
  /** @type {string | null} */
  track = null;
  levels = { music: 0, effects: 0 };

  /**
   * @param {string} cue
   * @param {import("../../application/ports/AudioOutput.contract.js").PlayOptions} [options]
   */
  play(cue, options = {}) {
    this.played.push({ cue, options });
  }

  /** @param {string | null} track */
  playMusic(track) {
    this.track = track;
  }

  /** @param {Readonly<{ music: number, effects: number }>} levels */
  setLevels(levels) {
    this.levels = { ...levels };
  }

  unlock() {
    // Nothing to wake.
  }

  /** @param {boolean} _active */
  setActive(_active) {
    // Nothing to suspend.
  }
}
