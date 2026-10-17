/**
 * The casual lobby: free online games against real players, nothing at
 * stake. Its panel says what casual play gives, how a game starts in three
 * steps (a deck, an opponent, the game), then the status and the big
 * button, which finds a casual opponent; a click on a player online
 * proposes a casual game. Only casual play: nothing here of ranked play,
 * which has its own lobby.
 */
import { Label } from "../ui/Label.js";
import { LobbyScene } from "./lobby/LobbyScene.js";
import { PlayKind } from "./online/lobbyIcons.js";
import { Perks } from "./online/Perks.js";
import { StepList } from "./online/StepList.js";
import { SceneId } from "./sceneIds.js";

/** The panel on a wide screen: its pills under the title, the steps under them. */
const WIDE = Object.freeze({ perks: Object.freeze({ y: 60, height: 30 }), steps: Object.freeze({ y: 106, row: 40 }), gap: 14 });
/** On a phone: a step's row. */
const COMPACT = Object.freeze({ row: 30, gap: 6 });
/** How a casual game starts, wide and in short on a phone. */
const STEPS = Object.freeze({
  full: Object.freeze(["Choose one of your decks on the left.", "Find a match, or click a player online to challenge them.", "Play! The first player is drawn by lot."]),
  short: Object.freeze(["Pick a deck on the left.", "Find a match, or challenge a player.", "Play! First player by lot."]),
});

export class CasualScene extends LobbyScene {
  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now]
   */
  constructor(services, app, now = () => Date.now()) {
    super(services, app, { scene: SceneId.CASUAL, title: "Casual", now });
  }

  /** @returns {"casual"} */
  get queueMode() {
    return "casual";
  }

  idleText() {
    return "Choose a deck, then find an opponent or challenge a player online. The first player is drawn by lot.";
  }

  findText() {
    return "Find a casual match";
  }

  /**
   * On a wide screen: the title, what casual play gives and its three steps; on a phone, the steps in short. Then the
   * status and the button.
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {{ width: number, height: number }} room
   */
  buildGame(panel, room) {
    const { inset, compact } = this.screen;
    if (compact) {
      return this.#buildCompact(panel, room);
    }
    const { width } = room;
    panel.add(new Label({ id: "casual.title", x: this.screen.titleInset, y: this.metrics.titleY, width: width - 2 * (this.screen.titleInset - inset), height: 36, text: "Casual game", size: "subheading", weight: "bold", colorKey: "focus", align: "left", fit: true }));
    panel.add(new Perks({ id: "online.perks", x: inset, y: WIDE.perks.y, width, height: WIDE.perks.height, items: ["Free to play", "No rating at stake", "Challenge anyone"], kind: PlayKind.CASUAL }));
    const stepsHeight = STEPS.full.length * WIDE.steps.row;
    panel.add(new StepList({ id: "casual.steps", x: inset, y: WIDE.steps.y, width, height: stepsHeight, kind: PlayKind.CASUAL, steps: STEPS.full.map((text) => ({ text })) }));
    return this.buildPlay(panel, room, { top: WIDE.steps.y + stepsHeight + WIDE.gap, fair: true, foot: null });
  }

  /**
   * On a phone: the three steps in short, the status and the button.
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {{ width: number, height: number }} room
   */
  #buildCompact(panel, room) {
    const inset = this.screen.inset;
    const { width } = room;
    let y = this.metrics.top;
    const stepsHeight = STEPS.short.length * COMPACT.row;
    panel.add(new StepList({ id: "casual.steps", x: inset, y, width, height: stepsHeight, kind: PlayKind.CASUAL, steps: STEPS.short.map((text) => ({ text })) }));
    y += stepsHeight + COMPACT.gap;
    return this.buildPlay(panel, room, { top: y, fair: false, foot: null });
  }
}
