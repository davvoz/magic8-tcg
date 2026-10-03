/**
 * The background music: one track at a time, looped without a gap (decoded
 * whole into an AudioBuffer, which loops sample-exact where an <audio>
 * element would stutter at the seam), faded in, and crossfaded into the
 * next. A track is fetched and decoded the first time it is asked for and
 * kept; one that cannot be read is logged once and stays silent — the game
 * plays on without it.
 */

const FADE = Object.freeze({ inS: 1.8, outS: 1.2 });

export class MusicPlayer {
  #context;
  #destination;
  #load;
  #logger;
  /** Each track's decoded audio, by URL; null for one that could not be read. @type {Map<string, Promise<AudioBuffer | null>>} */
  #buffers = new Map();
  /** The URL asked for last, or null. @type {string | null} */
  #url = null;
  /** @type {{ source: AudioBufferSourceNode, level: GainNode } | null} */
  #playing = null;

  /**
   * @param {{ context: BaseAudioContext, destination: AudioNode, load: (url: string) => Promise<ArrayBuffer>, logger: import("../../application/ports/Logger.contract.js").Logger }} deps
   */
  constructor({ context, destination, load, logger }) {
    this.#context = context;
    this.#destination = destination;
    this.#load = load;
    this.#logger = logger;
  }

  /** The URL asked for last. */
  get url() {
    return this.#url;
  }

  /**
   * Fades the current track out and the one at `url` in; the same URL keeps playing.
   * @param {string | null} url
   */
  play(url) {
    if (url === this.#url) {
      return;
    }
    this.#url = url;
    this.#fadeOut();
    if (url === null) {
      return;
    }
    void this.#buffer(url).then((buffer) => {
      if (buffer !== null && this.#url === url && this.#playing === null) {
        this.#start(buffer);
      }
    });
  }

  /** @param {string} url */
  #buffer(url) {
    let buffer = this.#buffers.get(url);
    if (buffer === undefined) {
      buffer = this.#load(url)
        .then((bytes) => this.#context.decodeAudioData(bytes))
        .catch((error) => {
          this.#logger.warn("music unavailable", { url, reason: error instanceof Error ? error.message : String(error) });
          return null;
        });
      this.#buffers.set(url, buffer);
    }
    return buffer;
  }

  /** @param {AudioBuffer} buffer */
  #start(buffer) {
    const now = this.#context.currentTime;
    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const level = this.#context.createGain();
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(1, now + FADE.inS);
    source.connect(level);
    level.connect(this.#destination);
    source.start(now);
    this.#playing = { source, level };
  }

  #fadeOut() {
    const playing = this.#playing;
    if (playing === null) {
      return;
    }
    this.#playing = null;
    const now = this.#context.currentTime;
    const { source, level } = playing;
    level.gain.cancelScheduledValues(now);
    level.gain.setValueAtTime(level.gain.value, now);
    level.gain.linearRampToValueAtTime(0, now + FADE.outS);
    source.addEventListener("ended", () => level.disconnect());
    source.stop(now + FADE.outS + 0.05);
  }
}
