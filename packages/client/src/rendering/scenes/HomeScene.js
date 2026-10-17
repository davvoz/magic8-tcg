/**
 * Home: where the game opens, what to do now, and the way to the other
 * sections (there is no rail). Across the top, the one thing to do next —
 * a game in progress to resume, or the first-time guide's next step
 * (OnboardingGuide: tutorial, starter deck, first challenge, first online
 * game, ranked), with its gold button and a way to hide the guide. Under
 * it, the four other sections as cards to open (NavCard): Play, Decks,
 * Market and Season, each with its picture and a line on what is there; a
 * locked one says why.
 *
 * On a wide screen three columns: Play across the first two (its picture
 * beside its words), Decks and Market under it, and Season keeping
 * the whole height on the right as the ranked season's card (SeasonCard:
 * its jackpot and where the player stands). A phone has the four side by
 * side.
 */
import { roundMoneyText } from "../../application/money/moneyText.js";
import { GUIDE_STEPS, guideFor } from "../../application/onboarding/OnboardingGuide.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { HEADLINE_HEIGHT, HeadlineCard } from "./home/HeadlineCard.js";
import { STEP_NAMES, stepCopy } from "./home/nextStep.js";
import { PlayViews } from "./home/PlayViews.js";
import { NavCard } from "./home/NavCard.js";
import { SeasonCard } from "./home/SeasonCard.js";
import { UiPiece } from "../images/UiArt.js";
import { SECTIONS, SectionId } from "../shell/sections.js";
import { hasGameInProgress, resumeGame } from "./returnToGame.js";
import { Icon } from "../ui/icons.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";
import { startTutorial } from "./startTutorial.js";

/** The sections' cards on a phone, left to right. */
const COMPACT_ORDER = Object.freeze([SectionId.PLAY, SectionId.DECKS, SectionId.MARKET, SectionId.SEASON]);
/** The frame: margins round the cards and the gap between them. */
const FRAME = Object.freeze({ wide: Object.freeze({ margin: 20, gap: 20 }), compact: Object.freeze({ margin: 8, gap: 8 }) });
/**
 * What each section's card shows above its name: an upright painting filling the box (Play's, in a box wider than
 * tall, a landscape one), and the emblem until it is ready.
 * @type {Readonly<Record<string, import("./home/NavCard.js").NavPicture>>}
 */
const SECTION_PICTURES = Object.freeze({
  [SectionId.PLAY]: Object.freeze({ piece: UiPiece.PLAY_ONLINE_TALL, landscape: UiPiece.PLAY_ONLINE_WIDE, icon: Icon.PLAY, faction: "ember", cover: true }),
  [SectionId.DECKS]: Object.freeze({ piece: UiPiece.DECKS_TALL, icon: Icon.DECKS, faction: "arcane", cover: true }),
  [SectionId.MARKET]: Object.freeze({ piece: UiPiece.MARKET_TALL, icon: Icon.MARKET, faction: "verdant", cover: true }),
  [SectionId.SEASON]: Object.freeze({ piece: UiPiece.SEASON_TALL, icon: Icon.SEASON, faction: "iron", cover: true }),
});

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 */

export class HomeScene extends SectionScene {
  #app;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** @type {SeasonCard | null} */
  #season = null;
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
    const base = super.update(dtMs);
    const ticked = this.#season?.tick() ?? false;
    return ticked || base;
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
    const { viewport } = this.services;
    const compact = viewport.compact === true;
    const headline = this.#headline();
    const layout = homeLayout(viewport, headline !== null);
    let first = null;
    if (headline !== null && layout.headline !== null) {
      first = this.root.add(new HeadlineCard({ id: "home.headline", ...layout.headline, compact, ...headline })).action;
    }
    this.#buildSections(layout.sections, compact);
    this.focus(this.findNode(focusedId) ?? first ?? this.root.focusableNodes()[0] ?? null);
    this.services.requestRender();
  }

  /**
   * The way to the other sections: a card each, opening its screen; on a wide screen Season's is the season's own card.
   * @param {Readonly<Record<string, Rect>>} frames each section's card (SectionId → its box)
   * @param {boolean} compact
   */
  #buildSections(frames, compact) {
    const context = { hasScene: this.services.hasScene, app: this.#app };
    SECTIONS.filter((section) => section.id !== SectionId.HOME).forEach((section) => {
      const frame = frames[section.id];
      if (section.id === SectionId.SEASON && !compact) {
        this.#season = this.root.add(new SeasonCard({ id: "home.season", ...frame, compact, view: this.#views.season(), canOpen: this.services.hasScene(SceneId.SEASON), onOpen: () => this.services.navigate(SceneId.SEASON) }));
        return;
      }
      const destination = section.destination(context);
      const locked = "locked" in destination;
      this.root.add(
        new NavCard({
          id: `home.section.${section.id}`,
          ...frame,
          compact,
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
   * What a section's card says is there, or where the player stands with it.
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
        return jackpot === null || jackpot.jackpot === null ? "Leaderboard and jackpot" : `Jackpot ${roundMoneyText(jackpot.jackpot, jackpot.asset)}`;
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
 * The top card (when there is one) across the content, and the sections' cards under it: on a phone the four side by
 * side; on a wide screen three columns, Play across the first two over Decks and Market, Season down the third.
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport the content area
 * @param {boolean} headline
 * @returns {{ headline: Rect | null, sections: Readonly<Record<string, Rect>> }} `sections`: each section's card (SectionId → its box)
 */
export function homeLayout(viewport, headline) {
  const compact = viewport.compact === true;
  const { margin, gap } = compact ? FRAME.compact : FRAME.wide;
  const width = viewport.logicalWidth - 2 * margin;
  const height = compact ? HEADLINE_HEIGHT.compact : HEADLINE_HEIGHT.wide;
  const top = headline ? margin + height + gap : margin;
  const columns = compact ? COMPACT_ORDER.length : 3;
  const column = Math.floor((width - (columns - 1) * gap) / columns);
  const across = (/** @type {number} */ index) => margin + index * (column + gap);
  const tall = viewport.logicalHeight - top - margin;
  if (compact) {
    return Object.freeze({
      headline: headline ? Object.freeze({ x: margin, y: margin, width, height }) : null,
      sections: Object.freeze(Object.fromEntries(COMPACT_ORDER.map((id, index) => [id, Object.freeze({ x: across(index), y: top, width: column, height: tall })]))),
    });
  }
  const row = Math.floor((tall - gap) / 2);
  const lower = Object.freeze({ y: top + row + gap, height: tall - row - gap });
  return Object.freeze({
    headline: headline ? Object.freeze({ x: margin, y: margin, width, height }) : null,
    sections: Object.freeze({
      [SectionId.PLAY]: Object.freeze({ x: across(0), y: top, width: 2 * column + gap, height: row }),
      [SectionId.DECKS]: Object.freeze({ x: across(0), ...lower, width: column }),
      [SectionId.MARKET]: Object.freeze({ x: across(1), ...lower, width: column }),
      [SectionId.SEASON]: Object.freeze({ x: across(2), y: top, width: column, height: tall }),
    }),
  });
}
