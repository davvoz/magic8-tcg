/**
 * The room the effects are played in: a convolution reverb whose impulse is
 * made here (decaying stereo noise, darker as it fades) rather than
 * downloaded. Short and soft — a stone hall heard from close by — it is what
 * keeps synthesised sounds from feeling pasted on: a chime rings out, a blow
 * has a space to land in. Patches choose how much of themselves to send it.
 */

/** The impulse: how long it rings, how fast it fades, and how much of it comes back. */
const ROOM = Object.freeze({ seconds: 1.8, fade: 3.2, level: 0.55, damping: 5200, preDelay: 0.012 });

export class RoomReverb {
  /** Where voices send what they want reverberated. */
  input;
  /** Its wet signal. */
  output;

  /**
   * @param {BaseAudioContext} context
   * @param {() => number} random
   */
  constructor(context, random) {
    const preDelay = context.createDelay(0.1);
    preDelay.delayTime.value = ROOM.preDelay;
    const convolver = context.createConvolver();
    convolver.buffer = impulse(context, random);
    const damping = context.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = ROOM.damping;
    const level = context.createGain();
    level.gain.value = ROOM.level;
    preDelay.connect(convolver);
    convolver.connect(damping);
    damping.connect(level);
    this.input = preDelay;
    this.output = level;
  }
}

/**
 * @param {BaseAudioContext} context
 * @param {() => number} random
 */
function impulse(context, random) {
  const length = Math.floor(context.sampleRate * ROOM.seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let index = 0; index < length; index += 1) {
      const through = index / length;
      // Brighter at first, duller as it dies: a one-pole lowpass closing over the tail.
      const closing = 0.15 + 0.8 * through;
      smooth = smooth * closing + (random() * 2 - 1) * (1 - closing);
      data[index] = smooth * (1 - through) ** ROOM.fade;
    }
  }
  return buffer;
}
