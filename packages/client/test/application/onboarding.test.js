/**
 * The first-time guide: the milestones this browser keeps (and how it reads
 * them back), the five steps and the next one, and the milestones noted as
 * the player reaches them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { GuideStep, guideFor } from "../../src/application/onboarding/OnboardingGuide.js";
import { Milestone, OnboardingProgress, parseOnboarding } from "../../src/application/onboarding/OnboardingProgress.js";
import { followMilestones } from "../../src/application/onboarding/followMilestones.js";
import { OnlineStatus } from "../../src/application/online/OnlineService.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { TutorialService } from "../../src/application/tutorial/TutorialService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { ONBOARDING_STORAGE_KEY, StoredOnboarding } from "../../src/infrastructure/persistence/StoredOnboarding.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();

function progressOver(store = new InMemoryStore()) {
  return { store, progress: new OnboardingProgress({ preferences: new StoredOnboarding({ store, logger: new MemoryLogger() }) }) };
}

const STANDING = Object.freeze({ season: { id: "s1", name: "Season 1" }, rating: 1500, deviation: 350, provisional: true, rank: null, games: 0, wins: 0, losses: 0, draws: 0, eligible: false, casualGamesNeeded: 3, practiceGamesNeeded: 3 });
const facts = (overrides = {}) => ({ server: true, account: "alice", needsStarter: false, standing: STANDING, ...overrides });

describe("OnboardingProgress", () => {
  it("keeps the tutorial for the browser and the rest for each account, between visits", () => {
    const { store, progress } = progressOver();
    const heard = [];
    progress.subscribe((record) => heard.push(record));
    progress.reach(Milestone.TUTORIAL);
    progress.reach(Milestone.CHALLENGE, "alice");
    progress.reach(Milestone.CHALLENGE, "alice");
    progress.reach(Milestone.ONLINE, null);
    assert.equal(heard.length, 2, "a milestone already noted, or one without its account, changes nothing");
    const again = progressOver(store).progress;
    assert.equal(again.has(Milestone.TUTORIAL, null), true);
    assert.equal(again.has(Milestone.CHALLENGE, "alice"), true);
    assert.equal(again.has(Milestone.CHALLENGE, "bob"), false, "another account has its own");
    assert.equal(again.has(Milestone.ONLINE, "alice"), false);
    again.dismiss();
    assert.equal(progressOver(store).progress.dismissed, true, "hiding the guide is remembered");
    assert.ok(store.read(ONBOARDING_STORAGE_KEY).value.includes("alice"));
  });

  it("reads back only what it wrote: anything else is not done", () => {
    assert.deepEqual(parseOnboarding(null), { tutorial: false, dismissed: false, accounts: {} });
    assert.deepEqual(parseOnboarding({ tutorial: "yes", dismissed: 1, accounts: { alice: { challenge: true, online: "no" }, "<script>": { online: true } } }), { tutorial: false, dismissed: false, accounts: { alice: { challenge: true, online: false } } });
  });
});

describe("OnboardingGuide", () => {
  const progress = (done = [], dismissed = false) => ({ has: (milestone) => done.includes(milestone), dismissed });

  it("goes through the five steps in order", () => {
    assert.equal(guideFor(progress(), facts({ account: null })).current, GuideStep.TUTORIAL);
    const signedOut = guideFor(progress([Milestone.TUTORIAL]), facts({ account: null }));
    assert.deepEqual([signedOut.current, signedOut.number, signedOut.shown], [GuideStep.STARTER, 2, true], "signed out, the starter deck waits for an account");
    assert.equal(guideFor(progress([Milestone.TUTORIAL]), facts({ needsStarter: true })).current, GuideStep.STARTER);
    assert.equal(guideFor(progress([Milestone.TUTORIAL]), facts()).current, GuideStep.CHALLENGE);
    assert.equal(guideFor(progress([Milestone.TUTORIAL, Milestone.CHALLENGE]), facts()).current, GuideStep.ONLINE);
    const ranked = guideFor(progress([Milestone.TUTORIAL, Milestone.CHALLENGE, Milestone.ONLINE]), facts());
    assert.deepEqual([ranked.current, ranked.number], [GuideStep.RANKED, 5]);
    const over = guideFor(progress([Milestone.TUTORIAL, Milestone.CHALLENGE, Milestone.ONLINE]), facts({ standing: { ...STANDING, games: 1 } }));
    assert.deepEqual([over.current, over.shown], [null, false], "every step done: the guide is over");
  });

  it("counts a step done when a later one is, and hides when asked or with nothing to offer", () => {
    const veteran = guideFor(progress(), facts({ standing: { ...STANDING, games: 12 } }));
    assert.equal(veteran.current, null, "a ranked player is not sent to the tutorial");
    assert.ok(veteran.steps.every((step) => step.done));
    assert.equal(guideFor(progress([], true), facts()).shown, false, "hidden by the player");
    assert.equal(guideFor(progress(), facts({ server: false, account: null })).shown, true, "offline, the tutorial is still offered");
    assert.equal(guideFor(progress([Milestone.TUTORIAL]), facts({ server: false, account: null })).shown, false, "and nothing after it");
  });
});

describe("followMilestones", () => {
  /** A service whose state the test sets. */
  const source = (state) => {
    const listeners = new Set();
    return { state, subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)), set: (next) => listeners.forEach((listener) => listener(next)) };
  };

  it("notes a challenge won and an online game finished, for the signed-in account", () => {
    const { progress } = progressOver();
    const identity = { state: { user: { account: "alice" } }, subscribe: () => () => undefined };
    const daily = source({ day: { run: null } });
    const online = source({ status: OnlineStatus.IDLE, mode: null });
    const stop = followMilestones({ progress, identity, daily, online });
    daily.state = { day: { run: { stage: 0, rewarded: false } } };
    daily.set(daily.state);
    assert.equal(progress.has(Milestone.CHALLENGE, "alice"), false, "nothing won yet");
    daily.state = { day: { run: { stage: 1, rewarded: false } } };
    daily.set(daily.state);
    assert.equal(progress.has(Milestone.CHALLENGE, "alice"), true);
    online.state = { status: OnlineStatus.OVER, mode: "daily" };
    online.set(online.state);
    assert.equal(progress.has(Milestone.ONLINE, "alice"), false, "a challenge is not an online game against a player");
    online.state = { status: OnlineStatus.OVER, mode: "casual" };
    online.set(online.state);
    assert.equal(progress.has(Milestone.ONLINE, "alice"), true);
    stop();
  });

  it("notes the tutorial once it is won, not when it is left", () => {
    const { progress } = progressOver();
    const matchSetup = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const tutorial = new TutorialService({ matchSetup, content });
    followMilestones({ progress, tutorial });
    const lost = tutorial.start();
    assert.equal(lost.ok, true);
    lost.value.session.start();
    lost.value.session.submit({ type: CommandType.CONCEDE, playerId: "player" });
    assert.equal(progress.has(Milestone.TUTORIAL, null), false, "conceded: not done");
    const won = tutorial.start();
    assert.equal(won.ok, true);
    won.value.session.start();
    won.value.session.submit({ type: CommandType.CONCEDE, playerId: "trainer" });
    assert.equal(progress.has(Milestone.TUTORIAL, null), true);
  });
});
