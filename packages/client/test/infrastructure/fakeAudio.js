/**
 * A stand-in for the Web Audio API, enough to build the game's graph and
 * play its patches under node --test. It records what is connected and
 * scheduled, and refuses what a browser would refuse (an exponential ramp
 * to zero, a source started twice or at no time).
 */

export class FakeParam {
  value;
  /** @type {[string, number, number][]} */
  events = [];

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value, time) {
    this.#check(value, time);
    this.events.push(["set", value, time]);
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value, time) {
    this.#check(value, time);
    this.events.push(["linear", value, time]);
    return this;
  }

  exponentialRampToValueAtTime(value, time) {
    this.#check(value, time);
    if (value <= 0) {
      throw new RangeError(`exponential ramp to ${value}`);
    }
    this.events.push(["exponential", value, time]);
    return this;
  }

  setTargetAtTime(value, time, constant) {
    this.#check(value, time);
    this.events.push(["target", value, time, constant]);
    return this;
  }

  cancelScheduledValues(time) {
    this.events.push(["cancel", 0, time]);
    return this;
  }

  #check(value, time) {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new TypeError(`non-finite automation (${value} at ${time})`);
    }
  }
}

export class FakeNode {
  /** @type {unknown[]} */
  connections = [];
  disconnected = false;

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeSource extends FakeNode {
  /** @type {(() => void)[]} */
  #listeners = [];
  /** @type {number | null} */
  started = null;
  /** @type {number | null} */
  stopped = null;

  addEventListener(type, listener) {
    if (type === "ended") {
      this.#listeners.push(listener);
    }
  }

  start(time = 0) {
    if (this.started !== null || !Number.isFinite(time)) {
      throw new Error("source started twice, or at no time");
    }
    this.started = time;
  }

  stop(time = 0) {
    if (!Number.isFinite(time)) {
      throw new TypeError("source stopped at no time");
    }
    this.stopped = time;
  }

  /** The source reached its stop time. */
  end() {
    this.#listeners.forEach((listener) => listener());
  }
}

class FakeOscillator extends FakeSource {
  type = "sine";
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
}

class FakeBufferSource extends FakeSource {
  /** @type {FakeBuffer | null} */
  buffer = null;
  loop = false;
  playbackRate = new FakeParam(1);
}

class FakeBiquad extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

class FakeConvolver extends FakeNode {
  /** @type {FakeBuffer | null} */
  buffer = null;
}

class FakeDelay extends FakeNode {
  delayTime = new FakeParam(0);
}

export class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    return this.data[channel];
  }
}

export class FakeAudioContext {
  state;
  currentTime = 0;
  /** Low, so the noise and the reverb's impulse are quick to make. */
  sampleRate = 4000;
  destination = new FakeNode();
  /** Every source made, oldest first. @type {FakeSource[]} */
  sources = [];
  /** Every buffer source made: the noise layers and the music. @type {FakeBufferSource[]} */
  bufferSources = [];
  /** Every gain made: the buses and each layer's envelope. @type {FakeGain[]} */
  gains = [];
  /** @type {unknown[]} */
  decoded = [];

  /** @param {{ state?: string }} [options] */
  constructor({ state = "suspended" } = {}) {
    this.state = state;
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const source = new FakeOscillator();
    this.sources.push(source);
    return source;
  }

  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    this.bufferSources.push(source);
    return source;
  }

  createBiquadFilter() {
    return new FakeBiquad();
  }

  createStereoPanner() {
    return new FakePanner();
  }

  createDynamicsCompressor() {
    return new FakeCompressor();
  }

  createConvolver() {
    return new FakeConvolver();
  }

  createDelay() {
    return new FakeDelay();
  }

  createBuffer(channels, length, sampleRate) {
    return new FakeBuffer(channels, length, sampleRate);
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }

  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }

  /** @param {ArrayBuffer} bytes empty bytes cannot be decoded */
  decodeAudioData(bytes) {
    this.decoded.push(bytes);
    return bytes.byteLength > 0 ? Promise.resolve(new FakeBuffer(2, 400, this.sampleRate)) : Promise.reject(new Error("undecodable"));
  }

  /** Every source made so far reaches its end. */
  endAll() {
    this.sources.forEach((source) => source.end());
  }
}
