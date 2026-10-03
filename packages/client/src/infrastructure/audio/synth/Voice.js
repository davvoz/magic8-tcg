/**
 * One sound being made: the layers a patch stacks (tones, noise, FM bells),
 * all starting from one moment and ending in one output — its level and
 * place in the stereo field — that feeds the effects bus and, for the
 * patches that want some room around them, the reverb.
 *
 * Every layer is shaped by the same envelope: a quick or slow rise to its
 * peak, an optional hold, then an exponential fall to silence, which is
 * what struck and plucked things do. Frequencies (and the filters that
 * shape noise) follow the voice's pitch, so a slightly different pitch on
 * each play keeps a repeated sound from turning mechanical.
 *
 * Once its last layer has stopped, the voice disconnects itself and says so
 * (`onDone`): nothing lingers in the graph.
 */

/** The level an exponential fall ends at: inaudible, and above the 0 an exponential ramp cannot reach. */
const SILENCE = 0.0001;
/** What a source plays past the end of its envelope, so it never stops on a click. */
const TAIL_S = 0.02;

/**
 * @typedef {Readonly<{ type: "lowpass" | "highpass" | "bandpass" | string, freq: number, to?: number, q?: number, glide?: number }>} FilterSpec
 *   a filter swept from `freq` to `to` (Hz) over `glide` seconds (the whole layer by default)
 * @typedef {Readonly<{ at?: number, attack?: number, hold?: number, decay?: number, peak?: number, filter?: FilterSpec }>} Shape
 *   when the layer starts (seconds after the voice) and its envelope: rise, hold and fall in seconds, `peak` its level
 * @typedef {Shape & Readonly<{ wave?: "sine" | "triangle" | "square" | "sawtooth" | string, freq: number, to?: number, glide?: number, detune?: number }>} ToneSpec
 *   an oscillator at `freq` Hz, gliding to `to` over `glide` seconds (the whole layer by default); `detune` in cents
 * @typedef {Shape & Readonly<{ color?: "white" | "pink" | "brown", rate?: number, flutter?: Readonly<{ rate: number, to?: number, depth: number }> }>} NoiseSpec
 *   noise of a colour, played at `rate`; `flutter` beats its level `rate` times a second (moving to `to`), `depth` 0–1 deep
 * @typedef {Shape & Readonly<{ freq: number, ratio?: number, index?: number, indexTo?: number }>} BellSpec
 *   two-operator FM: a sine at `freq` modulated by one at `freq × ratio`, `index` deep, falling to `indexTo` as it rings
 *   (a whole ratio rings like a bell, an odd one like struck metal)
 */

export class Voice {
  #context;
  #input;
  /** @type {AudioNode[]} */
  #nodes;
  #start;
  #pitch;
  #noise;
  #random;
  #onDone;
  #sources = 0;
  #sealed = false;
  #done = false;
  #endsAt;

  /**
   * @param {{
   *   context: BaseAudioContext,
   *   destination: AudioNode,
   *   send?: AudioNode | null,
   *   when: number,
   *   gain?: number,
   *   pan?: number,
   *   pitch?: number,
   *   space?: number,
   *   noise: import("./NoiseBank.js").NoiseBank,
   *   random: () => number,
   *   onDone?: () => void,
   * }} options `when`: the context time it starts at; `send`: the reverb's input, `space` how much of the voice goes to it
   */
  constructor({ context, destination, send = null, when, gain = 1, pan = 0, pitch = 1, space = 0, noise, random, onDone }) {
    this.#context = context;
    this.#start = when;
    this.#endsAt = when;
    this.#pitch = pitch;
    this.#noise = noise;
    this.#random = random;
    this.#onDone = onDone;
    const output = context.createGain();
    output.gain.value = gain;
    this.#input = output;
    this.#nodes = [output];
    let tail = /** @type {AudioNode} */ (output);
    if (pan !== 0 && typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      output.connect(panner);
      this.#nodes.push(panner);
      tail = panner;
    }
    tail.connect(destination);
    if (send !== null && space > 0) {
      const sendLevel = context.createGain();
      sendLevel.gain.value = space;
      tail.connect(sendLevel);
      sendLevel.connect(send);
      this.#nodes.push(sendLevel);
    }
  }

  /** The context time the voice starts at. */
  get start() {
    return this.#start;
  }

  /** The context time its last layer stops at. */
  get endsAt() {
    return this.#endsAt;
  }

  /**
   * A value between `min` and `max`, different on each play: how many clinks a handful of coins makes, how the shards scatter.
   * @param {number} min
   * @param {number} max
   */
  vary(min, max) {
    return min + (max - min) * this.#random();
  }

  /**
   * An oscillator.
   * @param {ToneSpec} spec
   * @returns {this}
   */
  tone({ wave = "sine", freq, to, glide, detune = 0, ...shape }) {
    const t0 = this.#at(shape);
    const length = shapeLength(shape);
    const oscillator = this.#context.createOscillator();
    oscillator.type = /** @type {OscillatorType} */ (wave);
    oscillator.frequency.setValueAtTime(freq * this.#pitch, t0);
    if (to !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to * this.#pitch), t0 + (glide ?? length));
    }
    if (detune !== 0) {
      oscillator.detune.setValueAtTime(detune, t0);
    }
    this.#play(oscillator, this.#envelope(oscillator, t0, shape), t0);
    return this;
  }

  /**
   * Noise, mostly heard through a filter: a slide of paper, a whoosh, a rumble.
   * @param {NoiseSpec} spec
   * @returns {this}
   */
  noise({ color = "white", rate = 1, flutter, ...shape }) {
    const t0 = this.#at(shape);
    const source = this.#context.createBufferSource();
    const buffer = this.#noise.buffer(color);
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.setValueAtTime(rate, t0);
    let head = /** @type {AudioNode} */ (source);
    const end = t0 + shapeLength(shape) + TAIL_S;
    if (flutter !== undefined) {
      head = this.#flutter(source, flutter, t0, end);
    }
    this.#envelope(head, t0, shape);
    this.#play(source, end, t0, this.#random() * buffer.duration);
    return this;
  }

  /**
   * A two-operator FM tone: bells, chimes, coins, struck metal.
   * @param {BellSpec} spec
   * @returns {this}
   */
  bell({ freq, ratio = 2, index = 1.5, indexTo = 0.05, ...shape }) {
    const t0 = this.#at(shape);
    const length = shapeLength(shape);
    const carrier = this.#context.createOscillator();
    const modulator = this.#context.createOscillator();
    const depth = this.#context.createGain();
    const hz = freq * this.#pitch;
    carrier.frequency.setValueAtTime(hz, t0);
    modulator.frequency.setValueAtTime(hz * ratio, t0);
    depth.gain.setValueAtTime(hz * index, t0);
    depth.gain.exponentialRampToValueAtTime(Math.max(SILENCE, hz * indexTo), t0 + length);
    modulator.connect(depth);
    depth.connect(carrier.frequency);
    this.#nodes.push(depth);
    const end = this.#envelope(carrier, t0, shape);
    this.#play(carrier, end, t0);
    this.#play(modulator, end, t0);
    return this;
  }

  /**
   * The patch has laid every layer: a voice with none is done at once.
   */
  seal() {
    this.#sealed = true;
    if (this.#sources === 0) {
      this.#finish();
    }
  }

  /** Every layer has ended: lets go of the voice's nodes. */
  #finish() {
    if (this.#done) {
      return;
    }
    this.#done = true;
    for (const node of this.#nodes) {
      node.disconnect();
    }
    this.#onDone?.();
  }

  /** @param {Shape} shape */
  #at(shape) {
    return this.#start + Math.max(0, shape.at ?? 0);
  }

  /**
   * Shapes `source` with the envelope (through its filter, if any) into the voice.
   * @param {AudioNode} source
   * @param {number} t0
   * @param {Shape} shape
   * @returns {number} when the layer is silent
   */
  #envelope(source, t0, { attack = 0.004, hold = 0, decay = 0.25, peak = 0.3, filter }) {
    const envelope = this.#context.createGain();
    const level = envelope.gain;
    level.setValueAtTime(0, t0);
    level.linearRampToValueAtTime(peak, t0 + Math.max(0.001, attack));
    if (hold > 0) {
      level.setValueAtTime(peak, t0 + attack + hold);
    }
    level.exponentialRampToValueAtTime(SILENCE, t0 + attack + hold + Math.max(0.005, decay));
    const length = attack + hold + decay;
    let head = source;
    if (filter !== undefined) {
      const node = this.#filter(filter, t0, length);
      source.connect(node);
      head = node;
    }
    head.connect(envelope);
    envelope.connect(this.#input);
    this.#nodes.push(envelope);
    return t0 + length + TAIL_S;
  }

  /**
   * @param {FilterSpec} spec
   * @param {number} t0
   * @param {number} length
   */
  #filter({ type, freq, to, q = 0.7, glide }, t0, length) {
    const filter = this.#context.createBiquadFilter();
    filter.type = /** @type {BiquadFilterType} */ (type);
    filter.frequency.setValueAtTime(clampFrequency(freq * this.#pitch), t0);
    if (to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(clampFrequency(to * this.#pitch), t0 + Math.max(0.005, glide ?? length));
    }
    filter.Q.setValueAtTime(q, t0);
    this.#nodes.push(filter);
    return filter;
  }

  /**
   * The level of `source` beating like a spinning coin.
   * @param {AudioNode} source
   * @param {{ rate: number, to?: number, depth: number }} flutter
   * @param {number} t0
   * @param {number} end
   * @returns {AudioNode} the beating signal
   */
  #flutter(source, { rate, to, depth }, t0, end) {
    const amplitude = this.#context.createGain();
    const swing = Math.max(0, Math.min(1, depth)) / 2;
    amplitude.gain.setValueAtTime(1 - swing, t0);
    const lfo = this.#context.createOscillator();
    lfo.type = "triangle";
    lfo.frequency.setValueAtTime(rate, t0);
    if (to !== undefined) {
      lfo.frequency.exponentialRampToValueAtTime(Math.max(0.1, to), end);
    }
    const lfoDepth = this.#context.createGain();
    lfoDepth.gain.setValueAtTime(swing, t0);
    lfo.connect(lfoDepth);
    lfoDepth.connect(amplitude.gain);
    source.connect(amplitude);
    this.#nodes.push(amplitude, lfoDepth);
    this.#play(lfo, end, t0);
    return amplitude;
  }

  /**
   * Starts and stops a source, and counts it until it has ended.
   * @param {AudioScheduledSourceNode} source
   * @param {number} end
   * @param {number} t0
   * @param {number} [offset] where in a buffer it starts
   */
  #play(source, end, t0, offset) {
    this.#sources += 1;
    this.#endsAt = Math.max(this.#endsAt, end);
    this.#nodes.push(source);
    source.addEventListener("ended", () => {
      this.#sources -= 1;
      if (this.#sources === 0 && this.#sealed) {
        this.#finish();
      }
    });
    if (offset === undefined) {
      source.start(t0);
    } else {
      /** @type {AudioBufferSourceNode} */ (source).start(t0, offset);
    }
    source.stop(end);
  }
}

/** @param {Shape} shape the whole length of a layer's envelope, in seconds */
function shapeLength({ attack = 0.004, hold = 0, decay = 0.25 }) {
  return attack + hold + decay;
}

/** @param {number} hz a frequency a filter can take */
function clampFrequency(hz) {
  return Math.max(20, Math.min(20000, hz));
}
