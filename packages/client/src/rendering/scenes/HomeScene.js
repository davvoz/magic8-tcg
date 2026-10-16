/**
 * Home: where the game opens, and what to do now. Across the top, the one
 * thing to do next — a game in progress to resume, or the first-time
 * guide's next step (OnboardingGuide: tutorial, starter deck, first
 * challenge, first online game, ranked), with its gold button and a way to
 * hide the guide. Under it, three cards: today's challenge (the opponent to
 * beat, in their portrait), online play (Casual, and Ranked locked until
 * the player may play it) and the ranked season (its jackpot and where the
 * player stands). What needs an account or the game server stays in its
 * place, locked, saying why.
 *
 * One gold button: the top card's; without one, the challenge's Fight (or
 * Casual).
 */
import { GUIDE_STEPS, guideFor } from "../../application/onboarding/OnboardingGuide.js";
import { SectionId } from "../shell/sections.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { ChallengeCard } from "./home/ChallengeCard.js";
import { HEADLINE_HEIGHT, HeadlineCard } from "./home/HeadlineCard.js";
import { STEP_NAMES, stepCopy } from "./home/nextStep.js";
import { OnlineCard } from "./home/OnlineCard.js";
import { PlayViews } from "./home/PlayViews.js";
import { SeasonCard } from "./home/SeasonCard.js";
import { hasGameInProgress, resumeGame } from "./returnToGame.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";
import { startTutorial } from "./startTutorial.js";

/** The frame: margins round the cards and the gap between them. */
const FRAME = Object.freeze({ wide: Object.freeze({ margin: 20, gap: 20 }), compact: Object.freeze({ margin: 8, gap: 8 }) });
const MINUTE = 60_000;

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 */

export class HomeScene extends SectionScene {
  #app;
  #now;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** @type {SeasonCard | null} */
  #season = null;
  /** The animation time of the challenge's portrait. */
  #animationMs = 0;
  /** The minute the challenge card was last built for (it says when new opponents come). */
  #minute = -1;
  /** Whether the player's account was ready when last looked at: becoming ready reads what Home shows of it. */
  #ready = false;
  /** What each way to play shows. */
  #views;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {{ now?: () => number }} [clock]
   */
  constructor(services, app, { now = () => Date.now() } = {}) {
    super(services, app, { section: SectionId.HOME, title: "Home" });
    this.#app = app;
    this.#now = now;
    this.#views = new PlayViews({ app, hasScene: services.hasScene, now });
  }

  enter() {
    const app = this.#app;
    const rebuild = () => this.#rebuild();
    const follow = (/** @type {{ subscribe?: (listener: () => void) => () => void } | undefined} */ service) => {
      if (typeof service?.subscribe === "function") {
        this.#unsubscribes.push(service.subscribe(rebuild));
      }
    };
    [app.daily, app.ranking, app.onboarding, app.online].forEach(follow);
    if (app.account !== undefined) {
      this.#unsubscribes.push(app.account.subscribe(() => this.#onAccount()));
    }
    const jackpot = app.jackpot;
    if (jackpot !== undefined) {
      this.#unsubscribes.push(jackpot.subscribe(rebuild), jackpot.watch());
    }
    this.#ready = false;
    this.#onAccount();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#season = null;
    super.exit();
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {number} dtMs */
  update(dtMs) {
    this.#animationMs += dtMs;
    if (Math.floor(this.#now() / MINUTE) !== this.#minute) {
      this.#rebuild();
    }
    const base = super.update(dtMs);
    const ticked = this.#season?.tick() ?? false;
    // The challenge's portrait breathes while it is on screen.
    return this.root.findById("home.challenge.portrait") !== null || ticked || base;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "home" });
    super.render(context);
  }

  /** The account loaded (signed in): read the day's challenges and the standing it shows. */
  #onAccount() {
    const ready = this.#signedIn();
    if (ready && !this.#ready) {
      void this.#app.daily?.refresh();
      void this.#app.ranking?.refresh();
    }
    this.#ready = ready;
    this.#rebuild();
  }

  #signedIn() {
    return this.#views.signedIn;
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    this.#season = null;
    this.#minute = Math.floor(this.#now() / MINUTE);
    const { viewport } = this.services;
    const compact = viewport.compact === true;
    const headline = this.#headline();
    const layout = homeLayout(viewport, headline !== null);
    let first = null;
    if (headline !== null && layout.headline !== null) {
      first = this.root.add(new HeadlineCard({ id: "home.headline", ...layout.headline, compact, ...headline })).action;
    }
    const primary = headline === null;
    const challenge = this.#views.challenge();
    const online = this.#views.online();
    const [left, middle, right] = layout.cards;
    this.root.add(new ChallengeCard({ id: "home.challenge", ...left, compact, view: challenge, primary: primary && challenge.kind === "next", clock: () => this.#animationMs, onFight: () => this.services.navigate(SceneId.DAILY) }));
    this.root.add(new OnlineCard({ id: "home.online", ...middle, compact, view: online, primary: primary && challenge.kind !== "next" && online.kind === "open", onPlay: (mode) => this.services.navigate(SceneId.ONLINE, { mode }) }));
    this.#season = this.root.add(new SeasonCard({ id: "home.season", ...right, compact, view: this.#views.season(), canOpen: this.services.hasScene(SceneId.LEADERBOARD), onOpen: () => this.services.navigate(SceneId.LEADERBOARD, { back: SceneId.HOME }) }));
    this.focus(this.findNode(focusedId) ?? first ?? this.root.focusableNodes()[0] ?? null);
    this.services.requestRender();
  }

  /**
   * The top card: a game in progress to resume, else the guide's next step; null when there is neither.
   * @returns {Omit<ConstructorParameters<typeof HeadlineCard>[0], "id" | "x" | "y" | "width" | "height" | "compact"> | null}
   */
  #headline() {
    const online = this.#app.online;
    if (online !== undefined && hasGameInProgress(online)) {
      const opponent = online.state.opponent;
      const against = opponent === null ? "your opponent" : (this.#app.daily?.characterOf(opponent)?.name ?? `@${opponent}`);
      return {
        kicker: "Game in progress",
        title: `Your game against ${against}`,
        text: "Its clock is running: a seat left too long plays itself, then forfeits.",
        action: { id: "home.resume", text: "Resume the game", onActivate: () => resumeGame(this.services.navigate, online) },
      };
    }
    return this.#nextStep();
  }

  /** The guide's next step, when the guide is on show. */
  #nextStep() {
    const progress = this.#app.onboarding;
    if (progress === undefined) {
      return null;
    }
    const signedIn = this.#signedIn();
    const standing = this.#app.ranking?.state.standing ?? null;
    const guide = guideFor(progress, { server: this.#views.server, account: signedIn ? (this.#app.account?.state.account ?? null) : null, needsStarter: this.#app.account?.needsStarter === true, standing });
    if (!guide.shown || guide.current === null) {
      return null;
    }
    const copy = stepCopy(guide.current, { signedIn, standing });
    return {
      kicker: `Next step · ${guide.number} of ${GUIDE_STEPS.length}`,
      title: copy.title,
      text: copy.text,
      track: guide.steps.map((step) => Object.freeze({ name: STEP_NAMES[step.id], done: step.done, current: step.id === guide.current })),
      action: { id: "home.next", ...this.#stepButton(copy.action) },
      secondary: { id: "home.hideGuide", text: this.services.viewport.compact ? "Hide" : "Hide the guide", onActivate: () => progress.dismiss() },
    };
  }

  /**
   * What the guide's button does: start the tutorial, or open the step's screen (disabled where there is none).
   * @param {import("./home/nextStep.js").StepAction} action
   */
  #stepButton(action) {
    if ("tutorial" in action) {
      const tutorial = this.#app.tutorial;
      return { text: action.text, enabled: tutorial !== undefined, onActivate: () => tutorial !== undefined && startTutorial(this.services, tutorial) };
    }
    return { text: action.text, enabled: this.services.hasScene(action.scene), onActivate: () => this.services.navigate(action.scene, action.params ?? {}) };
  }
}

/**
 * The top card (when there is one) across the content, and the three cards side by side under it.
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport the content area
 * @param {boolean} headline
 * @returns {{ headline: Rect | null, cards: readonly Rect[] }}
 */
export function homeLayout(viewport, headline) {
  const compact = viewport.compact === true;
  const { margin, gap } = compact ? FRAME.compact : FRAME.wide;
  const width = viewport.logicalWidth - 2 * margin;
  const height = compact ? HEADLINE_HEIGHT.compact : HEADLINE_HEIGHT.wide;
  const top = headline ? margin + height + gap : margin;
  const cardWidth = Math.floor((width - 2 * gap) / 3);
  const cardHeight = viewport.logicalHeight - top - margin;
  return Object.freeze({
    headline: headline ? Object.freeze({ x: margin, y: margin, width, height }) : null,
    cards: Object.freeze([0, 1, 2].map((index) => Object.freeze({ x: margin + index * (cardWidth + gap), y: top, width: cardWidth, height: cardHeight }))),
  });
}
