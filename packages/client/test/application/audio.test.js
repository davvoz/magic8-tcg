import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AudioChannel, DEFAULT_AUDIO_SETTINGS, audibleLevel, parseAudioSettings, snapLevel, withLevel } from "../../src/application/audio/AudioSettings.js";
import { AudioService } from "../../src/application/audio/AudioService.js";
import { CUE_MIN_GAP_MS, MusicTrack, SOUND_CUES, SoundCue } from "../../src/application/audio/SoundCue.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { NullAudioOutput } from "../../src/infrastructure/audio/NullAudioOutput.js";

/** Preferences kept in memory; `failing` makes saving throw. */
function memoryPreferences(stored = null, { failing = false } = {}) {
  return {
    stored,
    saves: 0,
    load() {
      return this.stored;
    },
    save(settings) {
      if (failing) {
        throw new Error("disk full");
      }
      this.saves += 1;
      this.stored = settings;
    },
  };
}

function world({ stored = null, failing = false } = {}) {
  const clock = { now: 1000 };
  const output = new NullAudioOutput();
  const preferences = memoryPreferences(stored, { failing });
  const logger = new MemoryLogger();
  const audio = new AudioService({ output, preferences, now: () => clock.now, logger });
  return { audio, output, preferences, clock, logger };
}

describe("AudioSettings", () => {
  it("snaps levels to tenths within 0–1, and treats anything else as silence", () => {
    assert.equal(snapLevel(0.44), 0.4);
    assert.equal(snapLevel(0.46), 0.5);
    assert.equal(snapLevel(3), 1);
    assert.equal(snapLevel(-1), 0);
    assert.equal(snapLevel(Number.NaN), 0);
  });

  it("parses what storage gives back, keeping what is valid and defaulting the rest", () => {
    assert.equal(parseAudioSettings(null), DEFAULT_AUDIO_SETTINGS);
    assert.equal(parseAudioSettings("loud"), DEFAULT_AUDIO_SETTINGS);
    assert.deepEqual(parseAudioSettings({ music: 0.33, effects: "x", muted: true }), { music: 0.3, effects: DEFAULT_AUDIO_SETTINGS.effects, muted: true });
    assert.ok(Object.isFrozen(parseAudioSettings({})));
  });

  it("changes one channel at a time and is silent while muted", () => {
    const settings = withLevel(DEFAULT_AUDIO_SETTINGS, AudioChannel.MUSIC, 0.9);
    assert.equal(settings.music, 0.9);
    assert.equal(settings.effects, DEFAULT_AUDIO_SETTINGS.effects);
    assert.equal(withLevel(settings, "volume", 0), settings, "an unknown channel changes nothing");
    assert.equal(audibleLevel(settings, AudioChannel.MUSIC), 0.9);
    assert.equal(audibleLevel({ ...settings, muted: true }, AudioChannel.EFFECTS), 0);
  });
});

describe("SoundCue", () => {
  it("names every cue once, and gives the music tracks their own names", () => {
    assert.equal(new Set(SOUND_CUES).size, SOUND_CUES.length);
    assert.ok(Object.keys(CUE_MIN_GAP_MS).every((cue) => SOUND_CUES.includes(cue)), "gaps only for known cues");
    assert.deepEqual(Object.values(MusicTrack).sort(), ["match", "menu"]);
  });
});

describe("AudioService", () => {
  it("starts from the saved settings and hands the output the levels they play at", () => {
    const { audio, output } = world({ stored: { music: 0.2, effects: 0.6, muted: false } });
    assert.deepEqual(audio.settings, { music: 0.2, effects: 0.6, muted: false });
    assert.deepEqual(output.levels, { music: 0.2, effects: 0.6 });
  });

  it("plays cues, but not while the effects are silent", () => {
    const { audio, output } = world();
    assert.equal(audio.play(SoundCue.CARD_PLACE, { delayMs: 80, pan: 0.2 }), true);
    assert.deepEqual(output.played, [{ cue: SoundCue.CARD_PLACE, options: { delayMs: 80, pan: 0.2 } }]);
    audio.toggleMute();
    assert.equal(audio.play(SoundCue.CARD_PLACE), false);
    audio.toggleMute();
    audio.setLevel(AudioChannel.EFFECTS, 0);
    assert.equal(audio.play(SoundCue.HEAL), false);
    assert.equal(output.played.length, 1);
  });

  it("drops a cue asked for again too soon after itself, by when each would start", () => {
    const { audio, output, clock } = world();
    assert.equal(audio.play(SoundCue.CARD_DRAW), true);
    assert.equal(audio.play(SoundCue.CARD_DRAW), false, "a second draw at the same moment is noise");
    assert.equal(audio.play(SoundCue.CARD_DRAW, { delayMs: CUE_MIN_GAP_MS[SoundCue.CARD_DRAW] }), true, "dealt a moment later, it is heard");
    assert.equal(audio.play(SoundCue.HEAL), true, "another cue is not held back");
    clock.now += 1000;
    assert.equal(audio.play(SoundCue.CARD_DRAW), true);
    assert.equal(audio.play(SoundCue.CLOCK_TICK), true);
    assert.equal(audio.play(SoundCue.CLOCK_TICK, { delayMs: 1 }), true, "the clock is never held back");
    assert.equal(output.played.length, 6);
  });

  it("asks for each track once, and remembers it", () => {
    const { audio, output } = world();
    audio.playMusic(MusicTrack.MENU);
    audio.playMusic(MusicTrack.MENU);
    assert.equal(output.track, MusicTrack.MENU);
    assert.equal(audio.track, MusicTrack.MENU);
    audio.playMusic(null);
    assert.equal(output.track, null);
  });

  it("steps levels, saves every change, tells its listeners, and unmutes when turned up", () => {
    const { audio, output, preferences } = world();
    /** @type {unknown[]} */
    const heard = [];
    audio.subscribe((settings) => heard.push(settings));
    audio.step(AudioChannel.MUSIC, -1);
    assert.equal(audio.settings.music, 0.4);
    audio.toggleMute();
    assert.deepEqual(output.levels, { music: 0, effects: 0 });
    audio.step(AudioChannel.EFFECTS, 1);
    assert.deepEqual(audio.settings, { music: 0.4, effects: 0.9, muted: false });
    assert.deepEqual(output.levels, { music: 0.4, effects: 0.9 });
    assert.equal(preferences.saves, 3);
    assert.equal(heard.length, 3);
    audio.step(AudioChannel.EFFECTS, 1);
    audio.step(AudioChannel.EFFECTS, 1);
    assert.equal(audio.settings.effects, 1);
    assert.equal(preferences.saves, 4, "a step past the top changes nothing, so nothing is saved");
  });

  it("keeps the change when it cannot be saved, and says so", () => {
    const { audio, logger } = world({ failing: true });
    audio.toggleMute();
    assert.equal(audio.settings.muted, true);
    assert.equal(logger.entries[0]?.message, "sound settings not saved");
  });
});
