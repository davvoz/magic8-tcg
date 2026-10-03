import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MusicTrack, SOUND_CUES, SoundCue } from "../../src/application/audio/SoundCue.js";
import { SoundBank } from "../../src/infrastructure/audio/SoundBank.js";
import { WebAudioOutput } from "../../src/infrastructure/audio/WebAudioOutput.js";
import { createBrowserAudioContext, followVisibility, unlockOnGesture } from "../../src/infrastructure/audio/browserAudio.js";
import { createCoreSoundBank } from "../../src/infrastructure/audio/registerCorePatches.js";
import { hz } from "../../src/infrastructure/audio/synth/notes.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { AUDIO_STORAGE_KEY, StoredAudioPreferences } from "../../src/infrastructure/persistence/StoredAudioPreferences.js";
import { FakeAudioContext } from "./fakeAudio.js";

const MUSIC_URLS = Object.freeze({ [MusicTrack.MENU]: "data/audio/menu.mp3", [MusicTrack.MATCH]: "data/audio/match.mp3" });

/** Lets pending promises (a track fetched and decoded) settle. */
async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A seeded stand-in for Math.random, so a patch's variations are the same on every run. */
function seededRandom(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function world({ bank = createCoreSoundBank(), load = async (url) => new TextEncoder().encode(url).buffer, levels = { music: 0.5, effects: 1 } } = {}) {
  const context = new FakeAudioContext();
  const logger = new MemoryLogger();
  /** @type {string[]} */
  const fetched = [];
  const output = new WebAudioOutput({
    createContext: () => /** @type {any} */ (context),
    bank,
    music: {
      urls: MUSIC_URLS,
      load: (url) => {
        fetched.push(url);
        return load(url);
      },
    },
    logger,
    random: seededRandom(),
  });
  output.setLevels(levels);
  return { context, output, logger, fetched };
}

describe("SoundBank", () => {
  it("has a patch for every cue the game plays, and none for a cue it does not know", () => {
    const bank = createCoreSoundBank();
    assert.deepEqual(bank.missing(SOUND_CUES), []);
    assert.deepEqual(bank.cues().filter((cue) => !SOUND_CUES.includes(cue)), []);
  });

  it("refuses a patch without a cue or a render, a cue registered twice, and levels outside 0–1", () => {
    const render = () => undefined;
    assert.throws(() => new SoundBank().register(/** @type {any} */ ({ cue: "", render })), TypeError);
    assert.throws(() => new SoundBank().register(/** @type {any} */ ({ cue: "x" })), TypeError);
    assert.throws(() => new SoundBank().register({ cue: "x", render }).register({ cue: "x", render }), /already registered/);
    assert.throws(() => new SoundBank().register({ cue: "x", render, space: 2 }), RangeError);
    assert.throws(() => new SoundBank().register({ cue: "x", render, vary: -0.1 }), RangeError);
    assert.equal(new SoundBank().get("x"), undefined);
  });
});

describe("notes", () => {
  it("names notes in equal temperament from A4 = 440 Hz", () => {
    assert.equal(hz("A4"), 440);
    assert.equal(hz("A5"), 880);
    assert.ok(Math.abs(hz("C4") - 261.63) < 0.01);
    assert.equal(hz("Bb3"), hz("A#3"));
    assert.throws(() => hz("H2"), RangeError);
  });
});

describe("WebAudioOutput", () => {
  it("makes no sound before the player's first gesture", () => {
    const { context, output } = world();
    output.play(SoundCue.UI_CLICK);
    output.playMusic(MusicTrack.MENU);
    assert.equal(context.sources.length, 0);
    assert.equal(output.isUnlocked, false);
  });

  it("plays every patch on a running context: each layer scheduled ahead, stopped after it starts, and let go once it has ended", () => {
    const { context, output, logger } = world();
    output.unlock();
    assert.equal(output.isUnlocked, true);
    context.currentTime = 10;
    for (const cue of SOUND_CUES) {
      const before = context.sources.length;
      output.play(cue, { delayMs: 40, pan: -0.4, gain: 1.2, pitch: 1.1, durationMs: 900 });
      const made = context.sources.slice(before);
      assert.ok(made.length > 0, `${cue} makes a sound`);
      for (const source of made) {
        assert.ok(/** @type {number} */ (source.started) >= 10.04, `${cue} starts when asked`);
        assert.ok(/** @type {number} */ (source.stopped) > /** @type {number} */ (source.started), `${cue} stops after it starts`);
      }
      context.endAll();
      assert.equal(output.voices, 0, `${cue} lets go of its voice`);
    }
    assert.deepEqual(logger.entries, []);
  });

  it("is quiet while the effects are, and holds a din to a bounded number of voices", () => {
    const { context, output } = world({ levels: { music: 0, effects: 0 } });
    output.unlock();
    output.play(SoundCue.HIT_CREATURE);
    assert.equal(context.sources.length, 0);
    output.setLevels({ music: 0, effects: 1 });
    for (let index = 0; index < 60; index += 1) {
      output.play(SoundCue.HIT_CREATURE);
    }
    assert.ok(output.voices <= 28, `${output.voices} voices at once`);
    output.play("no.such.cue");
  });

  it("dips the music under a sting, and lets it back up", () => {
    const { context, output } = world();
    output.unlock();
    output.play(SoundCue.VICTORY);
    const dips = context.gains.filter(({ gain }) => gain.events.some(([kind, value]) => kind === "target" && value < 1) && gain.events.some(([kind, value]) => kind === "target" && value === 1));
    assert.equal(dips.length, 1, "the music's gain goes down and comes back up");
  });

  it("does not let a patch that throws break the game", () => {
    const bank = new SoundBank().register({
      cue: SoundCue.UI_CLICK,
      render: () => {
        throw new Error("broken patch");
      },
    });
    const { output, logger } = world({ bank });
    output.unlock();
    output.play(SoundCue.UI_CLICK);
    assert.match(logger.entries[0]?.message ?? "", /failed/);
    assert.equal(output.voices, 0);
  });

  it("loops the track for where the player is, fetched once, crossfaded into the next, and silent while the music is off", async () => {
    const { context, output, fetched } = world();
    output.playMusic(MusicTrack.MENU);
    assert.deepEqual(fetched, [], "nothing is fetched before sound can start");
    output.unlock();
    await settle();
    assert.deepEqual(fetched, [MUSIC_URLS.menu]);
    const menu = context.bufferSources.find((source) => source.buffer?.numberOfChannels === 2);
    assert.ok(menu !== undefined && menu.loop && menu.started !== null, "the menu track loops");
    output.playMusic(MusicTrack.MENU);
    output.playMusic(MusicTrack.MATCH);
    await settle();
    assert.notEqual(menu.stopped, null, "the menu track fades out");
    assert.deepEqual(fetched, [MUSIC_URLS.menu, MUSIC_URLS.match]);
    output.setLevels({ music: 0, effects: 1 });
    output.playMusic(MusicTrack.MENU);
    output.setLevels({ music: 0.5, effects: 1 });
    await settle();
    assert.deepEqual(fetched, [MUSIC_URLS.menu, MUSIC_URLS.match], "a track heard before is not fetched again");
  });

  it("plays on without a track that cannot be read, and says so once", async () => {
    const { output, logger, fetched } = world({ load: async () => new ArrayBuffer(0) });
    output.unlock();
    output.playMusic(MusicTrack.MENU);
    await settle();
    output.playMusic(null);
    output.playMusic(MusicTrack.MENU);
    await settle();
    assert.equal(fetched.length, 1);
    assert.deepEqual(logger.entries.map((entry) => entry.message), ["music unavailable"]);
  });

  it("goes quiet while the page is hidden", () => {
    const { context, output } = world();
    output.setActive(false);
    output.unlock();
    assert.equal(context.state, "suspended", "a hidden page is not woken");
    output.setActive(true);
    assert.equal(context.state, "running");
    output.setActive(false);
    assert.equal(context.state, "suspended");
  });

  it("stays silent where the browser has no Web Audio", () => {
    const logger = new MemoryLogger();
    const output = new WebAudioOutput({ createContext: () => null, bank: createCoreSoundBank(), music: { urls: MUSIC_URLS, load: async () => new ArrayBuffer(1) }, logger });
    output.unlock();
    output.play(SoundCue.UI_CLICK);
    assert.equal(output.isUnlocked, false);
    const throwing = new WebAudioOutput({ createContext: () => { throw new Error("blocked"); }, bank: createCoreSoundBank(), music: { urls: MUSIC_URLS, load: async () => new ArrayBuffer(1) }, logger });
    throwing.unlock();
    throwing.unlock();
    assert.deepEqual(logger.entries.map((entry) => entry.message), ["sound unavailable"]);
  });
});

describe("browser audio", () => {
  it("unlocks sound on the player's gestures until it runs, then stops listening", () => {
    /** @type {Map<string, Function>} */
    const listeners = new Map();
    const target = { addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type) => listeners.delete(type) };
    let unlocks = 0;
    const output = { unlock: () => (unlocks += 1), isUnlocked: false, setActive: () => undefined };
    unlockOnGesture(/** @type {any} */ (target), output);
    assert.deepEqual([...listeners.keys()].sort(), ["keydown", "pointerdown", "pointerup", "touchend"]);
    listeners.get("pointerdown")?.();
    assert.equal(listeners.size, 4, "still locked: keeps listening");
    output.isUnlocked = true;
    listeners.get("keydown")?.();
    assert.equal(unlocks, 2);
    assert.equal(listeners.size, 0);
  });

  it("follows the page's visibility, and finds the browser's audio context where there is one", () => {
    /** @type {Function | undefined} */
    let onChange;
    const page = { visibilityState: "hidden", addEventListener: (_type, listener) => (onChange = listener) };
    /** @type {boolean[]} */
    const active = [];
    followVisibility(/** @type {any} */ (page), { unlock: () => undefined, isUnlocked: true, setActive: (value) => active.push(value) });
    onChange?.();
    page.visibilityState = "visible";
    onChange?.();
    assert.deepEqual(active, [false, true]);
    assert.equal(createBrowserAudioContext({}), null);
    const made = createBrowserAudioContext({ webkitAudioContext: /** @type {any} */ (FakeAudioContext) });
    assert.ok(made instanceof FakeAudioContext);
  });
});

describe("StoredAudioPreferences", () => {
  it("keeps the settings between visits, and forgets what it cannot read", () => {
    const store = new InMemoryStore();
    const logger = new MemoryLogger();
    const preferences = new StoredAudioPreferences({ store, logger });
    assert.equal(preferences.load(), null);
    preferences.save({ music: 0.3, effects: 0.7, muted: true });
    assert.deepEqual(preferences.load(), { music: 0.3, effects: 0.7, muted: true });
    store.write(AUDIO_STORAGE_KEY, "{broken");
    assert.equal(preferences.load(), null);
    assert.equal(logger.entries[0]?.message, "stored sound settings discarded");
  });
});
