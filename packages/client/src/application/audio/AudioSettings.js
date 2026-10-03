/**
 * How loud the game is: the music and the effects each have a level, from
 * 0 (silent) to 1 (full), moved in tenths; muting silences both without
 * forgetting them. A value object: every change makes a new one, and
 * whatever is read back from storage goes through `parseAudioSettings`, so a
 * corrupt or foreign value only ever means the defaults.
 */

/** The steps a level moves by, and how many there are. */
export const VOLUME_STEP = 0.1;
const STEPS = Math.round(1 / VOLUME_STEP);

/** @enum {string} */
export const AudioChannel = Object.freeze({
  MUSIC: "music",
  EFFECTS: "effects",
});

/**
 * @typedef {Readonly<{ music: number, effects: number, muted: boolean }>} AudioSettings
 */

/** Music under the game, effects over it. @type {AudioSettings} */
export const DEFAULT_AUDIO_SETTINGS = Object.freeze({ music: 0.5, effects: 0.8, muted: false });

/**
 * A level as stored: within 0–1 and on a step.
 * @param {number} level
 */
export function snapLevel(level) {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, level)) * STEPS) / STEPS;
}

/**
 * Settings read from anywhere (storage, an older version): what is valid is kept, the rest is the default.
 * @param {unknown} raw
 * @returns {AudioSettings}
 */
export function parseAudioSettings(raw) {
  if (raw === null || typeof raw !== "object") {
    return DEFAULT_AUDIO_SETTINGS;
  }
  const value = /** @type {Record<string, unknown>} */ (raw);
  return Object.freeze({
    music: typeof value.music === "number" ? snapLevel(value.music) : DEFAULT_AUDIO_SETTINGS.music,
    effects: typeof value.effects === "number" ? snapLevel(value.effects) : DEFAULT_AUDIO_SETTINGS.effects,
    muted: typeof value.muted === "boolean" ? value.muted : DEFAULT_AUDIO_SETTINGS.muted,
  });
}

/**
 * @param {AudioSettings} settings
 * @param {string} channel an AudioChannel
 * @param {number} level
 * @returns {AudioSettings}
 */
export function withLevel(settings, channel, level) {
  if (channel !== AudioChannel.MUSIC && channel !== AudioChannel.EFFECTS) {
    return settings;
  }
  return Object.freeze({ ...settings, [channel]: snapLevel(level) });
}

/**
 * How loud a channel actually plays: nothing while muted.
 * @param {AudioSettings} settings
 * @param {string} channel an AudioChannel
 */
export function audibleLevel(settings, channel) {
  if (settings.muted) {
    return 0;
  }
  return channel === AudioChannel.MUSIC ? settings.music : settings.effects;
}
