/**
 * Port for sound. The application asks for cues and music by name
 * (SoundCue, MusicTrack); the adapter (infrastructure/audio) knows what they
 * sound like and how the browser plays them. Implemented by WebAudioOutput
 * (the browser) and NullAudioOutput (tests, browsers without Web Audio).
 *
 * Nothing here may throw or wait: a sound that cannot be played is not played.
 *
 * @typedef {Readonly<{ delayMs?: number, gain?: number, pan?: number, pitch?: number, durationMs?: number }>} PlayOptions
 *   `delayMs`: how long from now it starts (so it lands with an animation);
 *   `gain`: how loud, relative to the cue's own level (1 as designed);
 *   `pan`: where it is heard, -1 left to 1 right;
 *   `pitch`: a playback rate (1 as designed, 2 an octave up);
 *   `durationMs`: how long a sound that follows an animation lasts (a coin in the air)
 *
 * @typedef {object} AudioOutput
 * @property {(cue: string, options?: PlayOptions) => void} play
 * @property {(track: string | null) => void} playMusic the track to loop (a MusicTrack), crossfading from the one playing; null for silence
 * @property {(levels: Readonly<{ music: number, effects: number }>) => void} setLevels how loud each channel plays, 0–1 (0 while muted)
 */

export const AUDIO_OUTPUT_METHODS = Object.freeze(["play", "playMusic", "setLevels"]);
