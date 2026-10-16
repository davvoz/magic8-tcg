/**
 * The Home screen: the guide's next step (and hiding it), a game in progress
 * to resume, today's challenge, online play and the season, each locked
 * with its reason where it cannot be used, and one gold button.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { DailyService } from "../../src/application/daily/DailyService.js";
import { Milestone, OnboardingProgress } from "../../src/application/onboarding/OnboardingProgress.js";
import { OnlineStatus } from "../../src/application/online/OnlineService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { IdentityStatus } from "../../src/application/identity/IdentityService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredOnboarding } from "../../src/infrastructure/persistence/StoredOnboarding.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { HomeScene } from "../../src/rendering/scenes/HomeScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { DAY } from "../application/dailyFixtures.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const NOW = DAY.endsAt - (2 * 60 + 5) * 60_000;
const STANDING = Object.freeze({ season: { id: "season-1", name: "Season 1" }, rating: 1612, deviation: 80, provisional: false, rank: 4, games: 0, wins: 0, losses: 0, draws: 0, eligible: false, casualGamesNeeded: 2, practiceGamesNeeded: 3 });
const JACKPOT = Object.freeze({
  season: { id: "season-1", name: "Season 1", startsAt: 0, endsAt: NOW + 86_400_000, status: "running" },
  bank: "verdu.green",
  asset: "STEEM",
  share: { numerator: 2, denominator: 3 },
  jackpot: "866.666",
  opening: "666.666",
  readAt: 0,
  places: [{ place: 1, percent: 65, amount: "563.332", account: "alice", rating: 1700, paid: null }],
});

/**
 * @param {{ day?: object, standing?: object, milestones?: string[], online?: object, offline?: boolean, size?: { cssWidth: number, cssHeight: number } }} [options]
 */
function world({ day = DAY, standing = STANDING, milestones = [], online = { status: OnlineStatus.IDLE, session: null, opponent: null, mode: null }, offline = false, size = { cssWidth: 1600, cssHeight: 900 } } = {}) {
  const account = accountWorld(content);
  const onboarding = new OnboardingProgress({ preferences: new StoredOnboarding({ store: new InMemoryStore(), logger: new MemoryLogger() }) });
  milestones.forEach((milestone) => onboarding.reach(milestone, "alice"));
  const listeners = new Set();
  const onlineService = { state: online, subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)), resume: () => online.session };
  const app = {
    content,
    deckSelection: { listDecks: () => [] },
    deckBuilding: account.builder,
    environment: { version: "test", storage: "local" },
    identity: offline ? { state: { status: IdentityStatus.OFFLINE, user: null }, subscribe: () => () => undefined } : account.identity,
    account: account.account,
    daily: new DailyService({ api: { today: async () => ok(day), chooseTrack: async () => ok(day), play: async () => ok({ gameId: "g" }) } }),
    ranking: new RankingService({ api: { standing: async () => ok(standing), leaderboard: async () => ok({ season: standing.season, entries: [] }) } }),
    jackpot: { state: { loading: false, loaded: true, jackpot: JACKPOT, error: null }, subscribe: () => () => undefined, watch: () => () => undefined, now: () => NOW },
    online: onlineService,
    onboarding,
    tutorial: { start: () => ({ ok: false, error: { message: "not in tests" } }) },
  };
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  const scene = new HomeScene(services, /** @type {any} */ (app), { now: () => NOW });
  return { ...account, app, scene, navigated, onboarding };
}

async function signIn(home) {
  home.identity.become(ALICE);
  await settle();
  await settle();
}

const byId = (scene, id) => scene.findNode(id);
const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};
/** The gold buttons on screen. */
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

describe("HomeScene, signed out", () => {
  it("offers the tutorial first, and keeps the rest in place, locked, with why", () => {
    const home = world();
    home.scene.enter({});
    assert.equal(byId(home.scene, "home.headline.title").text, "Learn the game in a few minutes");
    assert.equal(byId(home.scene, "home.next").text, "Start the tutorial");
    assert.ok(rendered(home.scene).includes("NEXT STEP · 1 OF 5"));
    assert.equal(byId(home.scene, "home.challenge.fight").isEffectivelyEnabled, false);
    assert.equal(byId(home.scene, "home.challenge.note").text, "Sign in to take on the challenges.");
    assert.equal(byId(home.scene, "home.online.casual").isEffectivelyEnabled, false);
    assert.equal(byId(home.scene, "home.online.note").text, "Sign in to play online.");
    assert.equal(byId(home.scene, "home.season.standing").text, "Sign in to take part in the season.");
    assert.ok(byId(home.scene, "home.season.jackpot"), "the jackpot is for everyone to see");
    assert.deepEqual(golden(home.scene), ["home.next"], "one gold button");
  });

  it("sends a player who has played the tutorial to sign in for their starter deck", () => {
    const home = world();
    home.onboarding.reach(Milestone.TUTORIAL);
    home.scene.enter({});
    assert.equal(byId(home.scene, "home.headline.title").text, "Take your free starter deck");
    byId(home.scene, "home.next").activate();
    assert.equal(home.navigated.at(-1).id, SceneId.LOGIN);
  });

  it("locks what needs the game server, offline", () => {
    const home = world({ offline: true });
    home.scene.enter({});
    assert.equal(byId(home.scene, "home.challenge.note").text, "Not available offline.");
    assert.equal(byId(home.scene, "home.online.note").text, "Not available offline.");
    assert.equal(byId(home.scene, "home.season.note").text, "Not available offline.");
  });
});

describe("HomeScene, signed in", () => {
  it("leads to the starter deck, then to today's challenge, and shows the opponent to beat", async () => {
    const home = world({ milestones: [] });
    home.onboarding.reach(Milestone.TUTORIAL);
    home.scene.enter({});
    await signIn(home);
    assert.equal(byId(home.scene, "home.next").text, "Choose your deck");
    byId(home.scene, "home.next").activate();
    assert.equal(home.navigated.at(-1).id, SceneId.STARTER);
    await home.account.claimStarter("precon_ember");
    await settle();
    assert.equal(byId(home.scene, "home.headline.title").text, "Win your first daily challenge");
    assert.equal(byId(home.scene, "home.challenge.name").text, "Kael");
    assert.ok(byId(home.scene, "home.challenge.portrait"));
    byId(home.scene, "home.challenge.fight").activate();
    assert.equal(home.navigated.at(-1).id, SceneId.DAILY);
    assert.equal(byId(home.scene, "home.season.standing").text, "You: not ranked yet");
  });

  it("keeps Ranked beside Casual, locked with what it waits for", async () => {
    const home = world();
    home.scene.enter({});
    await signIn(home);
    assert.equal(byId(home.scene, "home.online.ranked").isEffectivelyEnabled, false);
    assert.equal(byId(home.scene, "home.online.note").text, "Ranked opens after 2 more casual games.");
    byId(home.scene, "home.online.casual").activate();
    assert.deepEqual(home.navigated.at(-1), { id: SceneId.ONLINE, params: { mode: "casual", back: SceneId.HOME, backParams: {} } }, "Back there returns Home");
  });

  it("hides the guide for good, and gives its gold to today's challenge", async () => {
    const home = world();
    home.scene.enter({});
    await signIn(home);
    byId(home.scene, "home.hideGuide").activate();
    assert.equal(byId(home.scene, "home.headline"), null);
    assert.equal(home.onboarding.dismissed, true);
    assert.deepEqual(golden(home.scene), ["home.challenge.fight"]);
  });

  it("says when new opponents come once the day's three are beaten", async () => {
    const home = world({ day: { ...DAY, opponents: DAY.opponents.map((opponent) => ({ ...opponent, state: "beaten" })), run: { track: "hard", stage: 3, gameId: null, attempts: 3, rewarded: true, last: null, reward: null } } });
    home.scene.enter({});
    await signIn(home);
    assert.ok(rendered(home.scene).includes("New opponents in 2h 5m."));
  });

  it("puts a game in progress first, to resume", async () => {
    const session = { gameId: "g-1", hasSnapshot: true };
    const home = world({ online: { status: OnlineStatus.PLAYING, session, opponent: "bob", mode: "casual" } });
    home.scene.enter({});
    await signIn(home);
    assert.equal(byId(home.scene, "home.headline.title").text, "Your game against @bob");
    byId(home.scene, "home.resume").activate();
    assert.deepEqual(home.navigated.at(-1), { id: SceneId.MATCH, params: { session, againScene: SceneId.ONLINE } });
  });
});
