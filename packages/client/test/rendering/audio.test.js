/**
 * What the game sounds like where it is shown: widgets making their sound
 * as they are activated, the match heard in step with the board, the music
 * following the player, the services' sounds, the toasts' chimes and the
 * sound settings.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AudioService } from "../../src/application/audio/AudioService.js";
import { MusicTrack, SoundCue } from "../../src/application/audio/SoundCue.js";
import { CoinFace, CoinToss } from "../../src/application/match/CoinToss.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { OnlineStatus } from "../../src/application/online/OnlineService.js";
import { BuyStage } from "../../src/application/sales/SalesService.js";
import { PurchaseStage } from "../../src/application/shop/ShopService.js";
import { NullAudioOutput } from "../../src/infrastructure/audio/NullAudioOutput.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { MusicDirector } from "../../src/rendering/audio/MusicDirector.js";
import { soundOnline, soundSales, soundShop } from "../../src/rendering/audio/serviceSounds.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { CoinFlip } from "../../src/rendering/board/CoinFlip.js";
import { GameOverMood, GameOverSequence } from "../../src/rendering/board/GameOverSequence.js";
import { MatchPresenter } from "../../src/rendering/board/MatchPresenter.js";
import { MatchSoundscape } from "../../src/rendering/board/MatchSoundscape.js";
import { blowLandsAfter } from "../../src/rendering/cards/CardVisual.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { buildAudioSettingsModal } from "../../src/rendering/scenes/audioSettings.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { Scene } from "../../src/rendering/scenes/Scene.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { OptionRow } from "../../src/rendering/ui/OptionRow.js";
import { ToastLayer } from "../../src/rendering/ui/ToastLayer.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { loadBundledContent } from "../application/fixtures.js";
import { loadTheme } from "./fakes.js";

const theme = loadTheme();
const { animation } = theme;

/** The game's sound as the scenes see it, recording what they ask for. */
function recorder() {
  return {
    /** @type {{ cue: string, options: Record<string, number> }[]} */
    played: [],
    mutes: 0,
    play(cue, options = {}) {
      this.played.push({ cue, options });
      return true;
    },
    toggleMute() {
      this.mutes += 1;
    },
  };
}

/** @param {ReturnType<typeof recorder>} sound */
const cues = (sound) => sound.played.map((entry) => entry.cue);

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

const down = (x, y) => ({ type: "down", x, y, button: 0, pointerId: 1, pointerType: "mouse" });
const up = (x, y) => ({ type: "up", x, y, button: 0, pointerId: 1, pointerType: "mouse" });
const key = (name) => ({ type: "keydown", key: name, repeat: false });

/** @param {Scene} scene @param {import("../../src/rendering/ui/UiNode.js").UiNode} node */
function click(scene, node) {
  const { x, y, width, height } = node.bounds;
  scene.onPointer(down(x + width / 2, y + height / 2));
  scene.onPointer(up(x + width / 2, y + height / 2));
}

/** A real practice session on a hand-made board: P1 human, P2 the AI. */
async function matchFor(spec, sound) {
  const { engine } = createScenario(spec);
  const session = new MatchSession({ engine, controllers: new Map([[P1, humanController], [P2, new BasicAiController()]]), scheduler: immediateScheduler, logger: new MemoryLogger() });
  session.start();
  await session.whenIdle();
  const scene = new MatchScene(services({ sound }));
  scene.enter({ session });
  return { scene, session };
}

/** Steps the scene in small frames until `reached`. */
function advance(scene, reached, label, limitMs = 20000) {
  for (let elapsed = 0; elapsed <= limitMs; elapsed += 20) {
    if (reached()) {
      return;
    }
    scene.update(20);
  }
  assert.fail(`never reached: ${label}`);
}

/** @param {MatchScene} scene @param {string} name */
function cardNamed(scene, name) {
  /** @type {CardNode | null} */
  let found = null;
  const visit = (node) => {
    if (node instanceof CardNode && node.card.name === name) {
      found = node;
    }
    node.children.forEach(visit);
  };
  visit(scene.root);
  return /** @type {CardNode} */ (/** @type {unknown} */ (found));
}

/** A node of the board, which must be there. */
function onBoard(scene, id) {
  const node = scene.root.findById(id);
  assert.ok(node, `${id} is on the board`);
  return node;
}

/** A node of the open dialog, which must be there. */
function inModal(scene, id) {
  const node = scene.modal === null ? null : scene.modal.findById(id);
  assert.ok(node, `${id} is in the dialog`);
  return node;
}

describe("widget sounds", () => {
  it("plays a widget's sound as it is activated, by pointer or by key; a disabled one is silent; M mutes", () => {
    const sound = recorder();
    const scene = new Scene(services({ sound }));
    const confirm = scene.root.add(new Button({ id: "confirm", x: 0, y: 0, width: 200, height: 50, text: "OK", variant: "primary", onActivate: () => undefined }));
    const cancel = scene.root.add(new Button({ id: "cancel", x: 0, y: 60, width: 200, height: 50, text: "Cancel", onActivate: () => undefined }));
    const concede = scene.root.add(new Button({ id: "concede", x: 0, y: 120, width: 200, height: 50, text: "Concede", variant: "danger", onActivate: () => undefined }));
    const quiet = scene.root.add(new Button({ id: "quiet", x: 0, y: 180, width: 200, height: 50, text: "Quiet", cue: null, onActivate: () => undefined }));
    const off = scene.root.add(new Button({ id: "off", x: 0, y: 240, width: 200, height: 50, text: "Off", enabled: false, onActivate: () => undefined }));
    const row = scene.root.add(new OptionRow({ id: "row", x: 0, y: 300, width: 200, height: 50, text: "Deck", onActivate: () => undefined }));
    for (const node of [confirm, cancel, concede, quiet, off, row]) {
      click(scene, node);
    }
    assert.deepEqual(cues(sound), [SoundCue.UI_CONFIRM, SoundCue.UI_CLICK, SoundCue.UI_DANGER, SoundCue.UI_SELECT]);
    scene.focus(cancel);
    scene.onKey(key("Enter"));
    assert.equal(cues(sound).at(-1), SoundCue.UI_CLICK);
    scene.onKey(key("m"));
    assert.equal(sound.mutes, 1);
  });

  it("works without sound, as under test and in tools", () => {
    const scene = new Scene(services());
    let clicks = 0;
    const button = scene.root.add(new Button({ x: 0, y: 0, width: 200, height: 50, text: "OK", onActivate: () => (clicks += 1) }));
    click(scene, button);
    scene.onKey(key("M"));
    assert.equal(clicks, 1);
  });
});

describe("MatchSoundscape on the board", () => {
  it("thumps as a creature lands in its slot, placed in the stereo field where it lands", async () => {
    const sound = recorder();
    const { scene } = await matchFor({ p1: { hand: ["lava_brute"], resources: 5 } }, sound);
    cardNamed(scene, "Lava Brute").activate();
    const place = sound.played.find((entry) => entry.cue === SoundCue.CARD_PLACE);
    assert.ok(place, "the creature is heard landing");
    assert.equal(place.options.delayMs, animation.mediumMs * 0.8, "as its move from the hand ends");
    assert.ok(Math.abs(place.options.pan) <= 0.55);
  });

  it("hears a cast gather, strike, the blow land and the crystal break, then the victory — in that order", async () => {
    const sound = recorder();
    const { scene } = await matchFor({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 3 } }, sound);
    cardNamed(scene, "Ember Bolt").activate();
    scene.root.findById(P2)?.activate();
    advance(scene, () => scene.modal?.id === "gameOver", "the result is offered");
    const heard = cues(sound);
    const order = [SoundCue.SPELL_CAST, SoundCue.SPELL_STRIKE, SoundCue.HIT_PLAYER, SoundCue.CRYSTAL_CRACK, SoundCue.CRYSTAL_SHATTER, SoundCue.VICTORY];
    const at = order.map((cue) => heard.indexOf(cue));
    assert.ok(at.every((index) => index >= 0), `all heard: ${heard.join(", ")}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `in order: ${heard.join(", ")}`);
    assert.equal(heard.filter((cue) => cue === SoundCue.SPELL_STRIKE).length, 1, "the strike is heard once");
    assert.equal(heard.filter((cue) => cue === SoundCue.VICTORY).length, 1);
  });

  it("hears an attack declared, the lunge, and the blow as it lands", async () => {
    const sound = recorder();
    const { scene, session } = await matchFor({ p1: { battlefield: ["blazing_titan"] }, p2: { battlefield: ["scrap_golem"] } }, sound);
    scene.root.findById("endPhase")?.activate();
    cardNamed(scene, "Blazing Titan").activate();
    scene.root.findById("confirm")?.activate();
    await session.whenIdle();
    advance(scene, () => cues(sound).includes(SoundCue.HIT_PLAYER), "the blow is heard");
    const lands = blowLandsAfter(animation.shortMs);
    assert.ok(cues(sound).includes(SoundCue.ATTACK_DECLARE));
    assert.equal(sound.played.find((entry) => entry.cue === SoundCue.LUNGE)?.options.delayMs, lands - animation.shortMs);
    const hit = sound.played.find((entry) => entry.cue === SoundCue.HIT_PLAYER);
    assert.equal(hit?.options.delayMs, lands, "the hit lands with the lunge");
    assert.ok((hit?.options.gain ?? 0) > 1, "six damage is a heavy blow");
  });

  it("passes the turn with its own sound, then announces the opponent's turn and the player's own", async () => {
    const sound = recorder();
    const { scene, session } = await matchFor({ p1: {}, p2: {} }, sound);
    assert.equal(scene.root.findById("endTurn")?.activationCue, SoundCue.TURN_END);
    scene.onKey(key("e"));
    assert.equal(cues(sound)[0], SoundCue.TURN_END);
    await session.whenIdle();
    advance(scene, () => cues(sound).includes(SoundCue.TURN_MINE), "the player's turn comes back");
    assert.ok(cues(sound).indexOf(SoundCue.TURN_THEIRS) < cues(sound).indexOf(SoundCue.TURN_MINE));
  });

  it("ticks through the last seconds of the player's own clock, urgently at the end", () => {
    const sound = recorder();
    const soundscape = new MatchSoundscape({ sound, animation, viewerId: P1 });
    for (const [seconds, mine] of [[11, true], [10, true], [6, true], [5, true], [1, true], [0, true], [null, true], [3, false]]) {
      soundscape.tick(/** @type {number | null} */ (seconds), /** @type {boolean} */ (mine));
    }
    assert.deepEqual(cues(sound), [SoundCue.CLOCK_TICK, SoundCue.CLOCK_TICK, SoundCue.CLOCK_URGENT, SoundCue.CLOCK_URGENT]);
  });

  it("hears the coin thrown, landing and the verdict, once each, for as long as it flies", () => {
    const sound = recorder();
    const soundscape = new MatchSoundscape({ sound, animation, viewerId: P1 });
    const presenter = new MatchPresenter(animation);
    const flip = new CoinFlip({ toss: new CoinToss({ calls: { [P1]: CoinFace.HEADS, [P2]: CoinFace.TAILS }, landed: CoinFace.TAILS }), animation });
    while (!flip.isDone) {
      soundscape.follow({ presenter, toss: flip, ending: null });
      flip.update(25);
    }
    soundscape.follow({ presenter, toss: null, ending: null });
    assert.deepEqual(cues(sound), [SoundCue.COIN_TOSS, SoundCue.COIN_LAND, SoundCue.TOSS_VERDICT]);
    assert.equal(sound.played[0].options.durationMs, flip.flightMs);
  });

  it("hears a crystal break before the outcome, and only the outcome for a match conceded", () => {
    const hear = (mood, crystals) => {
      const sound = recorder();
      const soundscape = new MatchSoundscape({ sound, animation, viewerId: P1 });
      const presenter = new MatchPresenter(animation);
      const sequence = new GameOverSequence({ mood, title: "", subtitle: "", crystals, animation });
      while (!sequence.isDone) {
        sequence.update(25);
        soundscape.follow({ presenter, toss: null, ending: sequence });
      }
      return cues(sound);
    };
    assert.deepEqual(hear(GameOverMood.TRIUMPH, [{ x: 10, y: 10, radius: 20 }]), [SoundCue.CRYSTAL_CRACK, SoundCue.CRYSTAL_SHATTER, SoundCue.VICTORY]);
    assert.deepEqual(hear(GameOverMood.DEFEAT, []), [SoundCue.DEFEAT]);
    assert.deepEqual(hear(GameOverMood.NEUTRAL, []), [SoundCue.DRAW]);
  });

  it("makes no sound without the game's sound", () => {
    const soundscape = new MatchSoundscape({ sound: undefined, animation, viewerId: P1 });
    soundscape.tick(3, true);
    soundscape.rejected();
    soundscape.follow({ presenter: new MatchPresenter(animation), toss: null, ending: null });
  });
});

describe("MusicDirector", () => {
  it("plays each scene's track, the default elsewhere, from the scene the player is on", () => {
    /** @type {(string | null)[]} */
    const tracks = [];
    /** @type {((sceneId: string) => void) | null} */
    let listener = null;
    const scenes = { currentId: "mainMenu", onNavigate: (heard) => ((listener = heard), () => (listener = null)) };
    const director = new MusicDirector({ audio: { playMusic: (track) => tracks.push(track) }, tracks: { match: MusicTrack.MATCH, error: null }, fallback: MusicTrack.MENU });
    const stop = director.follow(scenes);
    listener?.("match");
    listener?.("error");
    listener?.("shop");
    assert.deepEqual(tracks, [MusicTrack.MENU, MusicTrack.MATCH, null, MusicTrack.MENU]);
    stop();
    assert.equal(listener, null);
  });
});

describe("service sounds", () => {
  /** A service whose state the test moves. */
  function observable(state) {
    const listeners = new Set();
    return {
      state,
      subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
      set(next) {
        this.state = { ...this.state, ...next };
        listeners.forEach((listener) => listener(this.state));
      },
    };
  }

  it("hears the cart fill and empty, coins as a payment is sent (not the cart emptying with it), and a purchase refused", () => {
    const sound = recorder();
    const shop = observable({ purchase: { stage: PurchaseStage.NONE }, cart: [] });
    const stop = soundShop(/** @type {any} */ (shop), sound);
    shop.set({ cart: [{ productId: "a", quantity: 1 }] });
    shop.set({ cart: [{ productId: "a", quantity: 2 }] });
    shop.set({ cart: [{ productId: "a", quantity: 1 }] });
    shop.set({ purchase: { stage: PurchaseStage.SIGNING } });
    shop.set({ purchase: { stage: PurchaseStage.CONFIRMING }, cart: [] });
    shop.set({ purchase: { stage: PurchaseStage.FAILED } });
    stop();
    shop.set({ cart: [{ productId: "b", quantity: 1 }] });
    assert.deepEqual(cues(sound), [SoundCue.CART_ADD, SoundCue.CART_ADD, SoundCue.CART_REMOVE, SoundCue.COINS, SoundCue.UI_ERROR]);
  });

  it("hears a market purchase paid or refused, and a game found", () => {
    const sound = recorder();
    const sales = observable({ buying: { stage: BuyStage.NONE } });
    const online = observable({ status: OnlineStatus.IDLE });
    soundSales(/** @type {any} */ (sales), sound);
    soundOnline(/** @type {any} */ (online), sound);
    sales.set({ buying: { stage: BuyStage.CONFIRMING } });
    sales.set({ buying: { stage: BuyStage.FAILED } });
    online.set({ status: OnlineStatus.SEARCHING });
    online.set({ status: OnlineStatus.MATCHED });
    online.set({ status: OnlineStatus.MATCHED, opponent: "bob" });
    assert.deepEqual(cues(sound), [SoundCue.COINS, SoundCue.UI_ERROR, SoundCue.MATCH_FOUND]);
  });

  it("chimes each toast by its tone, or with the sound it names", () => {
    const sound = recorder();
    const toasts = new ToastLayer({ viewport: { bounds: { x: 0, y: 0, width: 1600, height: 900 } }, onOpen: () => undefined, requestRender: () => undefined, sound });
    toasts.show({ title: "Cards arrived", body: "", tone: "good" });
    toasts.show({ title: "Refused", body: "", tone: "bad" });
    toasts.show({ title: "@bob challenges you", body: "", tone: "info", cue: SoundCue.CHALLENGE });
    assert.deepEqual(cues(sound), [SoundCue.NOTIFY_GOOD, SoundCue.NOTIFY_BAD, SoundCue.CHALLENGE]);
  });
});

describe("sound settings", () => {
  function audioWorld() {
    const output = new NullAudioOutput();
    const audio = new AudioService({ output, preferences: { load: () => null, save: () => undefined }, now: () => 0, logger: new MemoryLogger() });
    return { audio, output };
  }

  it("turns each channel down and up a step, heard at the effects' new level, and mutes everything", () => {
    const { audio, output } = audioWorld();
    let closed = 0;
    const modal = buildAudioSettingsModal({ viewport: { logicalWidth: 1600, logicalHeight: 900 }, audio, onClose: () => (closed += 1), requestRender: () => undefined });
    const byId = (id) => modal.findById(id);
    assert.equal(byId("audio.music.value").text, "50%");
    byId("audio.music.down").activate();
    byId("audio.effects.up").activate();
    assert.deepEqual(audio.settings, { music: 0.4, effects: 0.9, muted: false });
    assert.equal(byId("audio.effects.value").text, "90%");
    assert.deepEqual(output.played.map((entry) => entry.cue), [SoundCue.UI_SELECT], "a tick at the new effects level");
    assert.equal(byId("audio.effects.up").activationCue, null, "the effects' buttons leave the sound to that tick");
    byId("audio.mute").activate();
    assert.equal(byId("audio.mute").text, "Unmute");
    assert.equal(byId("audio.music.value").text, "Muted");
    byId("audio.music.up").activate();
    assert.equal(audio.settings.muted, false, "turning a channel up unmutes");
    byId("audio.close").activate();
    assert.equal(closed, 1);
    assert.deepEqual(audio.settings, { music: 0.5, effects: 0.9, muted: false });
  });

  it("opens in a match from the battle log — its panel, or a compact board's log dialog — and stays open while the opponent plays on", async () => {
    const { audio } = audioWorld();
    const { engine } = createScenario({ p1: {}, p2: {} });
    const session = new MatchSession({ engine, controllers: new Map([[P1, humanController], [P2, new BasicAiController()]]), scheduler: immediateScheduler, logger: new MemoryLogger() });
    session.start();
    await session.whenIdle();
    const scene = new MatchScene(services(), { audio });
    scene.enter({ session });
    const sound = onBoard(scene, "sound");
    assert.equal(sound.text, "Sound", "in the battle log's header");
    sound.activate();
    assert.equal(scene.modal?.id, "audio");
    inModal(scene, "audio.mute").activate();
    onBoard(scene, "endTurn").activate();
    await session.whenIdle();
    for (let frame = 0; frame < 50; frame += 1) {
      scene.update(40);
    }
    assert.equal(scene.modal?.id, "audio", "still open after the opponent's turn");
    inModal(scene, "audio.close").activate();
    assert.equal(scene.modal, null);
    assert.equal(onBoard(scene, "sound").text, "Muted");
    audio.toggleMute();
    assert.equal(onBoard(scene, "sound").text, "Sound", "follows the game being unmuted from anywhere");

    const compact = new Viewport(theme.layout);
    compact.resize({ cssWidth: 667, cssHeight: 375 });
    const phone = new MatchScene(services({ viewport: compact }), { audio });
    phone.enter({ session });
    assert.equal(phone.root.findById("sound"), null, "no log panel on a phone");
    onBoard(phone, "log.open").activate();
    inModal(phone, "logModal.sound").activate();
    assert.equal(phone.modal?.id, "audio");
    scene.exit();
    phone.exit();
  });

  it("opens from the main menu, whose Sound button follows the game being muted from anywhere", async () => {
    const { audio } = audioWorld();
    const content = await loadBundledContent();
    const app = { content, deckSelection: { listDecks: () => [] }, deckBuilding: {}, matchSetup: {}, createSeed: () => "9f".repeat(32), logger: new MemoryLogger(), environment: { version: "test", storage: "local" }, audio };
    const scene = new MainMenuScene(services(), /** @type {any} */ (app));
    scene.enter({});
    const button = scene.root.findById("sound");
    assert.equal(button?.text, "Sound");
    audio.toggleMute();
    assert.equal(button?.text, "Sound off");
    button?.activate();
    assert.equal(scene.modal?.id, "audio");
    scene.modal?.findById("audio.close")?.activate();
    assert.equal(scene.modal, null);
    scene.exit();
    audio.toggleMute();
    assert.equal(button?.text, "Sound off", "no longer followed once the menu is left");
  });
});
