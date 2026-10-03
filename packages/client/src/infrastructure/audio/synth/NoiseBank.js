/**
 * The noise the patches are carved from, made once per audio context: white
 * (every frequency alike: clicks, hiss, glass), pink (falling 3 dB an octave:
 * paper, air, whooshes) and brown (falling 6 dB: rumble, crumbling stone).
 * Each buffer is a couple of seconds long and looped; every voice starts it
 * somewhere else, so no two slides of a card sound quite alike.
 */

const SECONDS = 2;

/** @typedef {"white" | "pink" | "brown"} NoiseColor */

export class NoiseBank {
  #context;
  #random;
  /** @type {Map<NoiseColor, AudioBuffer>} */
  #buffers = new Map();

  /**
   * @param {BaseAudioContext} context
   * @param {() => number} random
   */
  constructor(context, random) {
    this.#context = context;
    this.#random = random;
  }

  /**
   * @param {NoiseColor} color
   * @returns {AudioBuffer}
   */
  buffer(color) {
    let buffer = this.#buffers.get(color);
    if (buffer === undefined) {
      buffer = this.#make(color);
      this.#buffers.set(color, buffer);
    }
    return buffer;
  }

  /** @param {NoiseColor} color */
  #make(color) {
    const length = Math.floor(this.#context.sampleRate * SECONDS);
    const buffer = this.#context.createBuffer(1, length, this.#context.sampleRate);
    const data = buffer.getChannelData(0);
    const white = () => this.#random() * 2 - 1;
    if (color === "white") {
      for (let index = 0; index < length; index += 1) {
        data[index] = white();
      }
      return buffer;
    }
    if (color === "brown") {
      let last = 0;
      for (let index = 0; index < length; index += 1) {
        last = (last + 0.02 * white()) / 1.02;
        data[index] = last * 3.5;
      }
      return buffer;
    }
    // Paul Kellet's economical pink filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let index = 0; index < length; index += 1) {
      const sample = white();
      b0 = 0.99765 * b0 + sample * 0.099046;
      b1 = 0.963 * b1 + sample * 0.2965164;
      b2 = 0.57 * b2 + sample * 1.0526913;
      data[index] = (b0 + b1 + b2 + sample * 0.1848) * 0.2;
    }
    return buffer;
  }
}
