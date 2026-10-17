/**
 * The Play screen: the four ways to play with where the player stands, locked with their reason
 * where they cannot be used, the links in the bar to live games and to the player's
 * own, and one gold button.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { DailyService } from "../../src/application/daily/DailyService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { SelectedDeck } from "../../src/application/decks/SelectedDeck.js";
import { Milestone, OnboardingProgress } from "../../src/application/onboarding/OnboardingProgress.js";
import { OnlineStatus } from "../../src/application/online/OnlineService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredOnboarding } from "../../src/infrastructure/persistence/StoredOnboarding.js";
import { StoredSelectedDeck } from "../../src/infrastructure/persistence/StoredSelectedDeck.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { UiPiece } from "../../src/rendering/images/UiArt.js";
import { CharacterPortrait } from "../../src/rendering/scenes/daily/CharacterPortrait.js";
import { PlayScene, playLayout } from "../../src/rendering/scenes/PlayScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { DAY } from "../application/dailyFixtures.js";
import { loadBundledContent } from "../application/fixtures.js";
import { loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const STANDING = Object.freeze({ season: { id: "season-1", name: "Season 1" }, rating: 1500, deviation: 350, provisional: true, rank: null, games: 0, wins: 0, losses: 0, draws: 0, eligible: true, casualGamesNeeded: 0, practiceGamesNeeded: 0 });

function world({ size = { cssWidth: 1600, cssHeight: 900 } } = {}) {
  const account = accountWorld(content);
  const logger = new MemoryLogger();
  const selectedDeck = new SelectedDeck({ preferences: new StoredSelectedDeck({ store: new InMemoryStore(), logger }) });
  const onboarding = new OnboardingProgress({ preferences: new StoredOnboarding({ store: new InMemoryStore(), logger }) });
  const app = {
    content,
    deckSelection: new DeckSelectionService({ content, repository: account.repository, logger }),
    deckBuilding: account.builder,
    environment: { version: "test", storage: "local" },
    identity: account.identity,
    account: account.account,
    selectedDeck,
    onboarding,
    daily: new DailyService({ api: { today: async () => ok(DAY), chooseTrack: async () => ok(DAY), play: async () => ok({ gameId: "g" }) } }),
    ranking: new RankingService({ api: { standing: async () => ok(STANDING), leaderboard: async () => ok({ season: STANDING.season, entries: [] }) } }),
    online: { state: { status: OnlineStatus.IDLE, session: null, opponent: null, mode: null }, subscribe: () => () => undefined, decks: () => [] },
    tutorial: { start: () => ({ ok: false, error: { message: "not in tests" } }) },
    matchSetup: {},
    createSeed: () => "9f".repeat(32),
    logger,
  };
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
  const navigated = [];
  const services = { theme, viewport, logger, requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  return { ...account, app: /** @type {any} */ (app), services, navigated, selectedDeck, onboarding };
}

const byId = (scene, id) => scene.findNode(id);
const golden = (scene) => {
  const found = [];
  const visit = (node) => {
    if (node.variant === "primary" && node.isEffectivelyEnabled) {
      found.push(node.id);
    }
    node.children.forEach(visit);
  };
  visit(scene.root);
  return found;
};

describe("PlayScene", () => {
  it("offers the four ways to play, locked where they need an account, practice and the tutorial for everyone", () => {
    const play = world();
    const scene = new PlayScene(play.services, play.app);
    scene.enter({});
    assert.deepEqual(["play.daily.title", "play.online.title", "play.practice.title", "play.tutorial.title"].map((id) => byId(scene, id)?.text), ["Daily challenges", "Online", "Practice vs AI", "Tutorial"]);
    assert.equal(byId(scene, "play.daily.play").isEffectivelyEnabled, false);
    assert.equal(byId(scene, "play.daily.status").text, "Sign in to take on the challenges.");
    assert.equal(byId(scene, "play.online.casual").isEffectivelyEnabled, false);
    assert.deepEqual(golden(scene), ["play.practice.play"], "signed out, practice is the gold button");
    byId(scene, "play.practice.play").activate();
    assert.equal(play.navigated.at(-1).id, SceneId.DECK_SELECTION);
    assert.equal(byId(scene, "play.watch").isEffectivelyEnabled, false, "watching needs an account");
    assert.ok(scene.chrome.findById("play.watch") && scene.chrome.findById("play.history"), "both links are in the bar");
    assert.equal(byId(scene, "play.tutorial.play").text, "Start the tutorial");
    assert.deepEqual(["play.online.art", "play.practice.art", "play.tutorial.art"].map((id) => byId(scene, id)?.piece), [UiPiece.PLAY_ONLINE_ARENA, UiPiece.PLAY_PRACTICE, UiPiece.PLAY_TUTORIAL], "each way to play has its painting");
    assert.ok(byId(scene, "play.daily.art") instanceof CharacterPortrait, "the challenges show a character even before today's are known");
  });

  it("says the tutorial is done once it is", () => {
    const play = world();
    play.onboarding.reach(Milestone.TUTORIAL);
    const scene = new PlayScene(play.services, play.app);
    scene.enter({});
    assert.equal(byId(scene, "play.tutorial.status").text, "Completed");
    assert.equal(byId(scene, "play.tutorial.play").text, "Play again");
  });

  it("signed in: today's challenge first, online open, the player's games one click away", async () => {
    const play = world();
    const scene = new PlayScene(play.services, play.app);
    scene.enter({});
    play.identity.become(ALICE);
    await settle();
    await settle();
    assert.equal(byId(scene, "play.daily.status").text, "Today: 0 of 3 beaten · next, Kael");
    assert.ok(byId(scene, "play.daily.art"), "the opponent's portrait");
    assert.deepEqual(golden(scene), ["play.daily.play"]);
    byId(scene, "play.online.ranked").activate();
    assert.deepEqual(play.navigated.at(-1), { id: SceneId.ONLINE, params: { mode: "ranked" } });
    byId(scene, "play.history").activate();
    assert.deepEqual(play.navigated.at(-1), { id: SceneId.GAME_HISTORY, params: { back: SceneId.PLAY, backParams: {} } });
  });

  it("leaves the deck to where each way to play starts", () => {
    const play = world();
    const scene = new PlayScene(play.services, play.app);
    scene.enter({});
    assert.equal(byId(scene, "play.deck"), null, "no deck bar");
    const [top] = playLayout(play.services.viewport).tiles;
    assert.equal(top.y, byId(scene, "play.daily").y, "the tiles start at the top");
  });
});
