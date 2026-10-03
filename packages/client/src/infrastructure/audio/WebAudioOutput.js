/**
 * AudioOutput in the browser, on the Web Audio API.
 *
 *   voices ─┬──────────────► effects ──┐
 *           └─► room reverb ─┘          ├─► master ─► limiter ─► speakers
 *   music ─► music level ─► duck ───────┘
 *
 * Effects are synthesised as they are asked for: each cue's patch
 * (SoundBank) lays the layers of a fresh Voice, started a few milliseconds
 * ahead (or `delayMs` later, to land with an animation) and a hair off its
 * designed pitch so repeats stay natural. The stings worth hearing over the
 * music dip it for a moment. A gentle limiter on the master keeps a volley
 * of blows from clipping.
 *
 * Browsers only let sound start from a gesture: the context is created on
 * the first one (`unlock`); until then cues are dropped and the music asked
 * for waits. A page sent to the background is suspended (`setActive`).
 * Without Web Audio, nothing plays and nothing breaks.
 */
import { MusicPlayer } from "./MusicPlayer.js";
import { NoiseBank } from "./synth/NoiseBank.js";
import { RoomReverb } from "./synth/RoomReverb.js";
import { Voice } from "./synth/Voice.js";

/** How far ahead of now a cue is scheduled, so it starts whole rather than mid-attack. */
const START_LEAD_S = 0.005;
const DEFAULT_SPACE = 0.15;
const DEFAULT_VARY = 0.02;
/** At most this many voices sound at once; more are dropped (they would be lost in the din anyway). */
const MAX_VOICES = 28;
/** Headroom: the master sits a little under full scale, and the music under the effects. */
const MASTER_LEVEL = 0.9;
const MUSIC_LEVEL = 0.7;
const LIMITER = Object.freeze({ threshold: -10, knee: 8, ratio: 6, attack: 0.003, release: 0.25 });
/** How quickly a level follows a change (time constant, seconds), and how a dip under a sting comes and goes. */
const LEVEL_GLIDE_S = 0.06;
const DUCK_GLIDE = Object.freeze({ downS: 0.08, upS: 0.45 });

/**
 * @typedef {{ effects: GainNode, musicLevel: GainNode, duck: GainNode, reverb: RoomReverb, noise: NoiseBank, music: MusicPlayer }} Graph
 */

/** @typedef {import("../../application/ports/AudioOutput.contract.js").AudioOutput} AudioOutput */

/** @implements {AudioOutput} */
export class WebAudioOutput {
  #createContext;
  #bank;
  #musicUrls;
  #loadAudio;
  #logger;
  #random;
  /** @type {AudioContext | null} */
  #context = null;
  /** @type {Graph | null} */
  #graph = null;
  /** Whether creating the context failed: it is not tried again. */
  #failed = false;
  /** Whether the page is in front. */
  #active = true;
  #levels = { music: 0, effects: 0 };
  /** @type {string | null} */
  #track = null;
  #voices = 0;

  /**
   * @param {{
   *   createContext: () => AudioContext | null,
   *   bank: import("./SoundBank.js").SoundBank,
   *   music: { urls: Readonly<Record<string, string>>, load: (url: string) => Promise<ArrayBuffer> },
   *   logger: import("../../application/ports/Logger.contract.js").Logger,
   *   random?: () => number,
   * }} deps `createContext`: null where Web Audio is missing; `music.urls`: each MusicTrack's file
   */
  constructor({ createContext, bank, music, logger, random = Math.random }) {
    this.#createContext = createContext;
    this.#bank = bank;
    this.#musicUrls = music.urls;
    this.#loadAudio = music.load;
    this.#logger = logger;
    this.#random = random;
  }

  /** Whether sound can play: the context exists and runs. */
  get isUnlocked() {
    return this.#context?.state === "running";
  }

  /** How many voices are sounding. */
  get voices() {
    return this.#voices;
  }

  /** From a user gesture: creates the context, or wakes it. */
  unlock() {
    const context = this.#ensureContext();
    if (context === null) {
      return;
    }
    if (context.state !== "running" && this.#active) {
      context.resume().catch((error) => this.#warn("sound could not start", error));
    }
    this.#syncMusic();
  }

  /**
   * The page came to the front (true) or went to the background (false).
   * @param {boolean} active
   */
  setActive(active) {
    this.#active = active;
    const context = this.#context;
    if (context === null) {
      return;
    }
    const change = active ? context.resume() : context.suspend();
    change.catch((error) => this.#warn("sound could not follow the page", error));
  }

  /**
   * @param {string} cue
   * @param {import("../../application/ports/AudioOutput.contract.js").PlayOptions} [options]
   */
  play(cue, options = {}) {
    const patch = this.#bank.get(cue);
    if (patch === undefined || !this.#canPlay()) {
      return;
    }
    const voice = this.#voiceFor(patch, options);
    try {
      patch.render(voice, { durationMs: options.durationMs });
    } catch (error) {
      this.#warn(`sound "${cue}" failed`, error);
    } finally {
      voice.seal();
    }
    if (patch.duck !== undefined) {
      this.#duck(patch.duck, voice.start);
    }
  }

  /** @param {string | null} track */
  playMusic(track) {
    this.#track = track;
    this.#syncMusic();
  }

  /** @param {Readonly<{ music: number, effects: number }>} levels */
  setLevels(levels) {
    this.#levels = { music: clampLevel(levels.music), effects: clampLevel(levels.effects) };
    this.#applyLevels();
    this.#syncMusic();
  }

  /** Whether a cue can be heard now: sound has started, the effects are up, and there is room for another voice. */
  #canPlay() {
    return this.#context?.state === "running" && this.#graph !== null && this.#levels.effects > 0 && this.#voices < MAX_VOICES;
  }

  /**
   * A fresh voice for `patch`, counted until it is done.
   * @param {import("./SoundBank.js").SoundPatch} patch
   * @param {import("../../application/ports/AudioOutput.contract.js").PlayOptions} options
   */
  #voiceFor(patch, options) {
    const context = /** @type {AudioContext} */ (this.#context);
    const graph = /** @type {Graph} */ (this.#graph);
    const vary = patch.vary ?? DEFAULT_VARY;
    this.#voices += 1;
    return new Voice({
      context,
      destination: graph.effects,
      send: graph.reverb.input,
      when: context.currentTime + START_LEAD_S + Math.max(0, options.delayMs ?? 0) / 1000,
      gain: Math.max(0, Math.min(2, options.gain ?? 1)),
      pan: options.pan ?? 0,
      pitch: (options.pitch ?? 1) * (1 + (this.#random() * 2 - 1) * vary),
      space: patch.space ?? DEFAULT_SPACE,
      noise: graph.noise,
      random: this.#random,
      onDone: () => {
        this.#voices -= 1;
      },
    });
  }

  /**
   * @param {string} message
   * @param {unknown} error
   */
  #warn(message, error) {
    this.#logger.warn(message, error instanceof Error ? error.message : String(error));
  }

  /** @returns {AudioContext | null} */
  #ensureContext() {
    if (this.#context !== null || this.#failed) {
      return this.#context;
    }
    try {
      const context = this.#createContext();
      if (context === null) {
        this.#failed = true;
        return null;
      }
      this.#context = context;
      this.#graph = this.#build(context);
      this.#applyLevels();
      return context;
    } catch (error) {
      this.#failed = true;
      this.#warn("sound unavailable", error);
      return null;
    }
  }

  /**
   * @param {AudioContext} context
   * @returns {Graph}
   */
  #build(context) {
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    limiter.connect(context.destination);
    const master = context.createGain();
    master.gain.value = MASTER_LEVEL;
    master.connect(limiter);
    const effects = context.createGain();
    effects.connect(master);
    const reverb = new RoomReverb(context, this.#random);
    reverb.output.connect(effects);
    const duck = context.createGain();
    duck.connect(master);
    const musicLevel = context.createGain();
    musicLevel.connect(duck);
    const music = new MusicPlayer({ context, destination: musicLevel, load: this.#loadAudio, logger: this.#logger });
    return { effects, musicLevel, duck, reverb, noise: new NoiseBank(context, this.#random), music };
  }

  #applyLevels() {
    const context = this.#context;
    const graph = this.#graph;
    if (context === null || graph === null) {
      return;
    }
    graph.effects.gain.setTargetAtTime(loudness(this.#levels.effects), context.currentTime, LEVEL_GLIDE_S);
    graph.musicLevel.gain.setTargetAtTime(loudness(this.#levels.music) * MUSIC_LEVEL, context.currentTime, LEVEL_GLIDE_S);
  }

  /** Plays the track asked for while the music is audible; stops it while it is not. */
  #syncMusic() {
    const graph = this.#graph;
    if (graph === null) {
      return;
    }
    const url = this.#track !== null && this.#levels.music > 0 ? this.#musicUrls[this.#track] ?? null : null;
    graph.music.play(url);
  }

  /**
   * Dips the music under a sting starting at `when`, and lets it back up after.
   * @param {Readonly<{ depth: number, ms: number }>} spec
   * @param {number} when
   */
  #duck({ depth, ms }, when) {
    const { duck } = /** @type {Graph} */ (this.#graph);
    duck.gain.cancelScheduledValues(when);
    duck.gain.setTargetAtTime(1 - Math.max(0, Math.min(1, depth)), when, DUCK_GLIDE.downS);
    duck.gain.setTargetAtTime(1, when + ms / 1000, DUCK_GLIDE.upS);
  }
}

/** @param {number} level */
function clampLevel(level) {
  return Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
}

/**
 * A level (0–1, as the player sets it) as a gain: squared, so each step sounds like an even step.
 * @param {number} level
 */
function loudness(level) {
  return level * level;
}
