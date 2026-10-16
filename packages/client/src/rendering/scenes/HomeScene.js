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
 *
 * A phone has no rail, and its Home is not the wide one: under the top card
 * (when there is one), the four other sections as cards to open (NavCard):
 * Play, Decks, Market and Season, each with its picture and a line on what
 * is there; a locked one says why.
 */
import { GUIDE_STEPS, guideFor } from "../../application/onboarding/OnboardingGuide.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { ChallengeCard } from "./home/ChallengeCard.js";
import { HEADLINE_HEIGHT, HeadlineCard } from "./home/HeadlineCard.js";
import { STEP_NAMES, stepCopy } from "./home/nextStep.js";
import { OnlineCard } from "./home/OnlineCard.js";
import { PlayViews } from "./home/PlayViews.js";
import { NavCard } from "./home/NavCard.js";
import { SeasonCard } from "./home/SeasonCard.js";
import { UiPiece } from "../images/UiArt.js";
import { TablePiece } from "../images/TableArt.js";
import { SECTIONS, SectionId } from "../shell/sections.js";
import { hasGameInProgress, resumeGame } from "./returnToGame.js";
import { Icon } from "../ui/icons.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";
import { startTutorial } from "./startTutorial.js";

/** The frame: margins round the cards and the gap between them. */
const FRAME = Object.freeze({ wide: Object.freeze({ margin: 20, gap: 20 }), compact: Object.freeze({ margin: 8, gap: 8 }) });
/** What each section's card on a phone's Home shows above its name: a painting, and the emblem until it is ready. */
const SECTION_PICTURES = Object.freeze({
  [SectionId.PLAY]: Object.freeze({ piece: UiPiece.PLAY_ONLINE, icon: Icon.PLAY, faction: "ember" }),
  [SectionId.DECKS]: Object.freeze({ piece: TablePiece.CARD_BACK, from: /** @type {const} */ ("table"), icon: Icon.DECKS, faction: "arcane" }),
  [SectionId.MARKET]: Object.freeze({ piece: "", icon: Icon.MARKET, faction: "verdant" }),
  [SectionId.SEASON]: Object.freeze({ piece: "", icon: Icon.SEASON, faction: "iron" }),
});
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
    super(services, app, { scene: SceneId.HOME, title: "Home" });
    this.#app = app;
    this.#now = now;
    this.#views = new PlayViews({ app, hasScene: services.hasScene, now });
  }

  /** @param {Readonly<Record<string, unknown>>} [params] */
  enter(params = {}) {
    this.routeBack(params);
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
    if (compact) {
      this.#buildSections(layout.cards);
    } else {
      this.#buildPlayCards(layout.cards, headline === null);
    }
    this.focus(this.findNode(focusedId) ?? first ?? this.root.focusableNodes()[0] ?? null);
    this.services.requestRender();
  }

  /**
   * The wide Home's cards: today's challenge, online play, the season.
   * @param {readonly Rect[]} frames
   * @param {boolean} primary whether the gold button is theirs (there is no top card)
   */
  #buildPlayCards([left, middle, right], primary) {
    const challenge = this.#views.challenge();
    const online = this.#views.online();
    this.root.add(new ChallengeCard({ id: "home.challenge", ...left, compact: false, view: challenge, challenger: this.#views.challenger(challenge), primary: primary && challenge.kind === "next", clock: () => this.#animationMs, onFight: () => this.services.navigate(SceneId.DAILY, this.backHere()) }));
    this.root.add(new OnlineCard({ id: "home.online", ...middle, compact: false, view: online, primary: primary && challenge.kind !== "next" && online.kind === "open", onPlay: (mode) => this.services.navigate(SceneId.ONLINE, { mode, ...this.backHere() }) }));
    this.#season = this.root.add(new SeasonCard({ id: "home.season", ...right, compact: false, view: this.#views.season(), canOpen: this.services.hasScene(SceneId.SEASON), onOpen: () => this.services.navigate(SceneId.SEASON) }));
  }

  /**
   * A phone's way to the other sections: a card each, opening it as its entry on the rail would.
   * @param {readonly Rect[]} frames
   */
  #buildSections(frames) {
    const context = { hasScene: this.services.hasScene, app: this.#app };
    SECTIONS.filter((section) => section.id !== SectionId.HOME).forEach((section, index) => {
      const destination = section.destination(context);
      const locked = "locked" in destination;
      this.root.add(
        new NavCard({
          id: `home.section.${section.id}`,
          ...frames[index],
          picture: SECTION_PICTURES[section.id],
          name: section.label,
          line: locked ? destination.locked : this.#sectionLine(section.id),
          locked,
          onActivate: () => this.openSection(section.id),
        }),
      );
    });
  }

  /**
   * What a section's card on a phone says is there, or where the player stands with it.
   * @param {string} sectionId
   */
  #sectionLine(sectionId) {
    switch (sectionId) {
      case SectionId.PLAY: {
        const challenge = this.#views.challenge();
        return challenge.kind === "next" ? `Today's challenge: ${challenge.opponent.name}` : "Challenges, online, practice";
      }
      case SectionId.DECKS: {
        if (this.#app.account?.needsStarter === true) {
          return "Your free starter deck";
        }
        const count = this.#app.deckSelection.listDecks().length;
        return `${count} deck${count === 1 ? "" : "s"} · your cards`;
      }
      case SectionId.MARKET:
        return "Packs, cards, trades";
      default: {
        const jackpot = this.#app.jackpot?.state.jackpot ?? null;
        return jackpot === null ? "Leaderboard and jackpot" : `Jackpot ${jackpot.jackpot} ${jackpot.asset}`;
      }
    }
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
    return { text: action.text, enabled: this.services.hasScene(action.scene), onActivate: () => this.services.navigate(action.scene, { ...action.params, ...this.backHere() }) };
  }
}

/**
 * The top card (when there is one) across the content, and the cards side by side under it: three, or on a phone the
 * four sections'.
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
  const count = compact ? SECTIONS.length - 1 : 3;
  const cardWidth = Math.floor((width - (count - 1) * gap) / count);
  const cardHeight = viewport.logicalHeight - top - margin;
  return Object.freeze({
    headline: headline ? Object.freeze({ x: margin, y: margin, width, height }) : null,
    cards: Object.freeze(Array.from({ length: count }, (_, index) => index).map((index) => Object.freeze({ x: margin + index * (cardWidth + gap), y: top, width: cardWidth, height: cardHeight }))),
  });
}
