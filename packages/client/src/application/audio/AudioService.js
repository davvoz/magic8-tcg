/**
 * The game's sound, as a use case: what the screens ask to hear (cues and
 * the music for where the player is) and how loud they want it.
 *
 * Settings are the player's: loaded once, saved on every change, and handed
 * to the output as the levels it plays at. A cue asked for again too soon
 * after itself (CUE_MIN_GAP_MS: a hand drawn, a volley of blows) is
 * dropped rather than stacked; nothing is sent to the output while the
 * effects are silent. The music asked for is remembered, so turning the
 * music back up resumes the track for where the player is.
 *
 * Nothing here plays a sound or reads a clock: the output and `now` are ports.
 */
import { AudioChannel, VOLUME_STEP, audibleLevel, parseAudioSettings, withLevel } from "./AudioSettings.js";
import { CUE_MIN_GAP_MS } from "./SoundCue.js";

/** The shortest time between two plays of the same cue, unless CUE_MIN_GAP_MS says otherwise. */
const DEFAULT_MIN_GAP_MS = 35;

export class AudioService {
  #output;
  #preferences;
  #now;
  #logger;
  /** @type {import("./AudioSettings.js").AudioSettings} */
  #settings;
  /** The track asked for last (a MusicTrack), or null for silence. @type {string | null} */
  #track = null;
  /** When each cue was last scheduled to start, on `now`'s clock. @type {Map<string, number>} */
  #lastPlayed = new Map();
  /** @type {Set<(settings: import("./AudioSettings.js").AudioSettings) => void>} */
  #listeners = new Set();

  /**
   * @param {{
   *   output: import("../ports/AudioOutput.contract.js").AudioOutput,
   *   preferences: import("../ports/AudioPreferences.contract.js").AudioPreferences,
   *   now: () => number,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ output, preferences, now, logger }) {
    this.#output = output;
    this.#preferences = preferences;
    this.#now = now;
    this.#logger = logger;
    this.#settings = parseAudioSettings(preferences.load());
    this.#output.setLevels(this.#levels());
  }

  /** @returns {import("./AudioSettings.js").AudioSettings} */
  get settings() {
    return this.#settings;
  }

  /** The track asked for last, or null. */
  get track() {
    return this.#track;
  }

  /**
   * @param {(settings: import("./AudioSettings.js").AudioSettings) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Plays a cue, unless the effects are silent or it played a moment ago.
   * @param {string} cue a SoundCue
   * @param {import("../ports/AudioOutput.contract.js").PlayOptions} [options]
   * @returns {boolean} whether it was sent to the output
   */
  play(cue, options = {}) {
    if (audibleLevel(this.#settings, AudioChannel.EFFECTS) === 0) {
      return false;
    }
    const startsAt = this.#now() + Math.max(0, options.delayMs ?? 0);
    const last = this.#lastPlayed.get(cue);
    if (last !== undefined && Math.abs(startsAt - last) < (CUE_MIN_GAP_MS[cue] ?? DEFAULT_MIN_GAP_MS)) {
      return false;
    }
    this.#lastPlayed.set(cue, startsAt);
    this.#output.play(cue, options);
    return true;
  }

  /**
   * The music for where the player is now; the same track keeps playing.
   * @param {string | null} track a MusicTrack, or null for silence
   */
  playMusic(track) {
    if (track === this.#track) {
      return;
    }
    this.#track = track;
    this.#output.playMusic(track);
  }

  /**
   * @param {string} channel an AudioChannel
   * @param {number} level 0–1, snapped to a step
   */
  setLevel(channel, level) {
    this.#change(withLevel(this.#settings, channel, level));
  }

  /**
   * One step up (1) or down (-1); a channel turned up from silence unmutes the game.
   * @param {string} channel an AudioChannel
   * @param {number} direction
   */
  step(channel, direction) {
    const current = channel === AudioChannel.MUSIC ? this.#settings.music : this.#settings.effects;
    const next = withLevel(this.#settings, channel, current + Math.sign(direction) * VOLUME_STEP);
    this.#change(direction > 0 ? Object.freeze({ ...next, muted: false }) : next);
  }

  toggleMute() {
    this.#change(Object.freeze({ ...this.#settings, muted: !this.#settings.muted }));
  }

  /** @param {import("./AudioSettings.js").AudioSettings} settings */
  #change(settings) {
    if (settings.music === this.#settings.music && settings.effects === this.#settings.effects && settings.muted === this.#settings.muted) {
      return;
    }
    this.#settings = settings;
    this.#output.setLevels(this.#levels());
    try {
      this.#preferences.save(settings);
    } catch (error) {
      this.#logger.warn("sound settings not saved", error instanceof Error ? error.message : String(error));
    }
    for (const listener of this.#listeners) {
      listener(settings);
    }
  }

  #levels() {
    return Object.freeze({ music: audibleLevel(this.#settings, AudioChannel.MUSIC), effects: audibleLevel(this.#settings, AudioChannel.EFFECTS) });
  }
}
