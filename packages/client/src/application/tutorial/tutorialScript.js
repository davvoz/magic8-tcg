/**
 * The tutorial match, written out: both decks in the order they are dealt
 * (the match is not shuffled), what the opponent does each turn, and what
 * the coach says along the way. In plain English for players who have never
 * played a card game; the words are the ones the board and the Info screen
 * use (mana, the sword and the shield, End phase, End turn). Each lesson is
 * about one thing, and points at it; card names read as `{Name}`, buttons
 * as `[Label]`.
 *
 * The lesson, turn by turn (the player goes first; both start at 10 life):
 *   1. play a creature (Scrap Golem); end the turn.
 *   2. the opponent's Kindling Sprite (Haste) attacks: block it with the Golem.
 *   3. play Flame Scout (Haste), go to combat, attack with both: 3 damage.
 *   4. the opponent plays Rivet Hound.
 *   5. cast Ember Bolt on the Hound, attack again (3 damage), play Ember Imp.
 *   6. the opponent plays Wandering Sellsword.
 *   7. no more hints: the opponent is on 4 life, the player finishes it.
 * From turn 7 on the opponent plays as the practice AI does.
 */
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";

/** Both players' life: a short match (a real one starts at 20). */
export const TUTORIAL_LIFE = 10;

export const TUTORIAL_SEATS = Object.freeze({
  player: Object.freeze({ id: "player", name: "You" }),
  opponent: Object.freeze({ id: "trainer", name: "Trainer" }),
});

/** The cards the lesson talks about. */
const CARD = Object.freeze({
  golem: "scrap_golem",
  scout: "flame_scout",
  bolt: "ember_bolt",
  imp: "ember_imp",
  sprite: "kindling_sprite",
  hound: "rivet_hound",
  sellsword: "wandering_sellsword",
});

/**
 * The player's deck, top first: the opening hand is Golem, Scout, two Bolts
 * and the Imp; then Cinder Hound, Lava Brute and Ash Raider are drawn on
 * turns 3, 5 and 7. The rest only makes the deck legal (30 cards).
 */
export const PLAYER_DECK = new DeckList({
  id: "tutorial_player",
  name: "Tutorial",
  entries: [
    { cardId: CARD.golem, count: 1 },
    { cardId: CARD.scout, count: 1 },
    { cardId: CARD.bolt, count: 2 },
    { cardId: CARD.imp, count: 1 },
    { cardId: "cinder_hound", count: 1 },
    { cardId: "lava_brute", count: 1 },
    { cardId: "ash_raider", count: 1 },
    { cardId: "kindling_sprite", count: 3 },
    { cardId: "ember_zealot", count: 3 },
    { cardId: "ember_shaman", count: 3 },
    { cardId: "magma_hurler", count: 3 },
    { cardId: "pyre_drake", count: 3 },
    { cardId: "blazing_titan", count: 3 },
    { cardId: "molten_rhino", count: 3 },
    { cardId: "fire_surge", count: 1 },
  ],
});

/** The opponent's deck, top first: the three creatures it plays are in its opening hand. */
export const OPPONENT_DECK = new DeckList({
  id: "tutorial_trainer",
  name: "Trainer",
  entries: [
    { cardId: CARD.sprite, count: 1 },
    { cardId: CARD.hound, count: 1 },
    { cardId: CARD.sellsword, count: 1 },
    { cardId: "stone_guardian", count: 3 },
    { cardId: "caravan_guard", count: 3 },
    { cardId: "steel_sentinel", count: 3 },
    { cardId: "clockwork_knight", count: 3 },
    { cardId: "iron_watcher", count: 3 },
    { cardId: "bulwark_engine", count: 3 },
    { cardId: "traveling_merchant", count: 3 },
    { cardId: "village_militia", count: 3 },
    { cardId: "giant_of_the_hills", count: 3 },
  ],
});

/**
 * What the opponent does on turns 1 to 6 (ScriptedAiController): on the
 * player's turns it never blocks.
 * @type {Readonly<Record<number, import("../match/ScriptedAiController.js").ScriptedTurn>>}
 */
export const OPPONENT_SCRIPT = Object.freeze({
  1: {},
  2: { play: [CARD.sprite], attack: [CARD.sprite] },
  3: {},
  4: { play: [CARD.hound] },
  5: {},
  6: { play: [CARD.sellsword] },
});

/** @typedef {import("./TutorialCoach.js").TutorialView} View */
/** @typedef {import("./TutorialCoach.js").Intent} Intent */
/** @typedef {import("./TutorialCoach.js").TutorialStep} Step */

/** How the lesson names its cards, marked as card names. */
const NAME = Object.freeze({
  golem: "{Scrap Golem}",
  scout: "{Flame Scout}",
  bolt: "{Ember Bolt}",
  imp: "{Ember Imp}",
  sprite: "{Kindling Sprite}",
  hound: "{Rivet Hound}",
});
const WATCH = "The opponent's turn: watch what they do.";

/** @param {string} kind a focus kind ("card", "cost", "attack", "health") @param {readonly string[]} ids @returns {string[]} */
const at = (kind, ids) => ids.map((id) => `${kind}:${id}`);
/** @param {View} view */
const golemOnField = (view) => view.ids(CARD.golem, "mine", "battlefield");
/** The player's creatures that attack in the lesson. @param {View} view */
const myAttackers = (view) => [...view.ids(CARD.scout, "mine", "battlefield"), ...golemOnField(view)];
/** @param {Intent} intent @param {View} view */
const attackingWithBoth = (intent, view) => {
  const wanted = myAttackers(view);
  return wanted.length === 2 && intent.attackerIds.length === 2 && wanted.every((id) => intent.attackerIds.includes(id));
};
/** Done once turn `turn` is over. @param {number} turn */
const after = (turn) => (/** @type {View} */ view) => view.turn > turn || view.isOver;
/** @param {View} view */
const afterMyCombat = (view) => view.awaitsMeIn(GamePhase.MAIN_2);

/**
 * A lesson: a title, a sentence or two, and what it is about.
 * @param {string} id
 * @param {string} title
 * @param {string} text
 * @param {(view: View) => readonly string[]} [focus]
 * @returns {Step}
 */
const lesson = (id, title, text, focus = () => []) => ({ id, title, text, focus });

/**
 * The opponent's turn, until `until`.
 * @param {string} id
 * @param {(view: View) => boolean} until
 * @returns {Step}
 */
const wait = (id, until) => ({ id, hint: WATCH, until });

/**
 * Play a card from the hand: tap it (on a phone, then press Play).
 * @param {string} id
 * @param {keyof typeof CARD} card
 * @param {string} [why] said before the instruction
 * @returns {Step}
 */
function playStep(id, card, why = "") {
  const inHand = (/** @type {View} */ view) => view.ids(CARD[card], "mine", "hand");
  const picked = (/** @type {View} */ view, /** @type {Intent} */ intent) => intent.pickedCardId !== null && inHand(view).includes(intent.pickedCardId);
  return {
    id,
    hint: (view, intent) => (picked(view, intent) ? `Press [Play] to play ${NAME[card]}.` : `${why}Tap ${NAME[card]} in your hand to play it.`),
    taps: inHand,
    until: (view) => view.has(CARD[card], "mine", "battlefield"),
    focus: (view, intent) => (picked(view, intent) ? ["button:confirm"] : at("card", inHand(view))),
  };
}

/**
 * End the turn.
 * @param {string} id
 * @param {number} turn the turn it ends
 * @param {string} [hint]
 * @returns {Step}
 */
const endTurnStep = (id, turn, hint = "Press [End turn].") => ({ id, hint, buttons: ["endTurn"], until: after(turn), focus: () => ["button:endTurn"] });

/**
 * Move on from main phase 1 to combat.
 * @param {string} id
 * @param {string} hint
 * @returns {Step}
 */
const toCombatStep = (id, hint) => ({ id, hint, buttons: ["endPhase"], until: (view) => !view.awaitsMeIn(GamePhase.MAIN_1), focus: () => ["button:endPhase"] });

/**
 * Attack with both creatures: tap one, the other, then confirm.
 * @param {string} id
 * @returns {Step}
 */
function attackStep(id) {
  /** @type {(view: View, intent: Intent) => { hint: string, focus: readonly string[] }} */
  const next = (view, intent) => {
    if (!view.awaitsMeIn(GamePhase.COMBAT_ATTACKERS)) {
      return { hint: "Your creatures attack!", focus: [] };
    }
    const left = myAttackers(view).filter((attacker) => !intent.attackerIds.includes(attacker));
    if (left.length === 0) {
      return { hint: "Press [Attack with 2] to send them in.", focus: ["button:confirm"] };
    }
    if (intent.attackerIds.length === 0) {
      return { hint: `Tap ${NAME.scout} and ${NAME.golem}: both will attack.`, focus: at("card", left) };
    }
    const other = view.ids(CARD.scout, "mine", "battlefield").includes(left[0]) ? NAME.scout : NAME.golem;
    return { hint: `Now tap ${other} too.`, focus: at("card", left) };
  };
  return { id, hint: (view, intent) => next(view, intent).hint, taps: myAttackers, confirm: attackingWithBoth, until: afterMyCombat, focus: (view, intent) => next(view, intent).focus };
}

/** @type {readonly Step[]} */
export const TUTORIAL_STEPS = Object.freeze([
  { id: "deal", until: (view) => view.myMainPhaseFrom(1) },
  lesson("welcome", "Welcome to KIJAM!", "This short match teaches you how to play, one step at a time. Press [Next] to go on."),
  lesson("goal", "Your goal", `This is your opponent's life. Bring it down to 0 and you win! Here it starts at ${TUTORIAL_LIFE} (a real match starts at 20).`, () => ["life:theirs"]),
  lesson("hand", "Your hand", "These are your cards. Your opponent can't see them.", () => ["hand:mine"]),
  lesson("mana", "Mana", "This is your mana: 1 right now. You get 1 more every turn, and it refills at the start of each of your turns.", () => ["mana:mine"]),
  lesson("cost", "Card cost", `The gem at a card's top left is its cost in mana. ${NAME.golem} costs 1: you can play it.`, (view) => at("cost", view.ids(CARD.golem, "mine", "hand"))),
  playStep("play-golem", "golem"),
  lesson("creatures", "Creatures", `${NAME.golem} is on the battlefield now. The sword is its attack (1), the shield its health (2).`, (view) => [...at("attack", golemOnField(view)), ...at("health", golemOnField(view))]),
  lesson("not-yet", "Not this turn", "A creature can't attack on the turn it's played, but it can block. Tip: right-click a card, or press and hold it, to read it.", (view) => at("card", golemOnField(view))),
  endTurnStep("end-turn-1", 1, "Nothing else to do: press [End turn]."),
  wait("opponent-attacks", (view) => view.awaitsMeIn(GamePhase.COMBAT_BLOCKERS)),
  lesson("under-attack", "Under attack!", `${NAME.sprite} attacks you! It has Haste: it can attack on the very turn it's played.`, (view) => at("card", view.ids(CARD.sprite, "theirs", "battlefield"))),
  {
    id: "block",
    hint: (view, intent) => {
      if (intent.blocks.length > 0) {
        return "Press [Confirm 1 block].";
      }
      return intent.pendingBlockerId === null ? `Tap your ${NAME.golem} to block with it.` : `Now tap ${NAME.sprite}: the attacker it blocks.`;
    },
    taps: (view) => [...golemOnField(view), ...view.ids(CARD.sprite, "theirs", "battlefield")],
    confirm: (intent, view) => intent.blocks.length === 1 && golemOnField(view).includes(intent.blocks[0].blockerId),
    until: (view) => !view.awaitsMeIn(GamePhase.COMBAT_BLOCKERS),
    focus: (view, intent) => {
      if (intent.blocks.length > 0) {
        return ["button:confirm"];
      }
      return intent.pendingBlockerId === null ? at("card", golemOnField(view)) : at("card", view.ids(CARD.sprite, "theirs", "battlefield"));
    },
  },
  lesson("blocked", "Blocked!", `The two creatures hit each other at the same time. ${NAME.sprite} is destroyed, and your life is still ${TUTORIAL_LIFE}.`, () => ["life:mine"]),
  lesson("damage-stays", "Damage stays", `${NAME.golem} survived, but its red shield shows it has 1 health left. Damage stays until a creature is healed.`, (view) => at("health", golemOnField(view))),
  wait("turn-3", (view) => view.myMainPhaseFrom(3)),
  lesson("new-turn", "Your turn", "At the start of your turn you draw a card, and your mana grows: you have 2 now.", () => ["mana:mine"]),
  lesson("haste", "Haste", `${NAME.scout} has Haste, like the Sprite: it can attack on the turn it's played.`, (view) => at("card", view.ids(CARD.scout, "mine", "hand"))),
  playStep("play-scout", "scout"),
  toCombatStep("to-combat", "Press [End phase] to move on to combat."),
  attackStep("attack"),
  lesson("direct-hit", "Direct hit!", `Nobody blocked, so your creatures hit the opponent: 3 damage, ${TUTORIAL_LIFE - 3} life left.`, () => ["life:theirs"]),
  lesson("exhausted", "Exhausted", "Creatures that attacked rest until your next turn, so they can't block.", (view) => at("card", myAttackers(view))),
  endTurnStep("end-turn-3", 3),
  wait("turn-5", (view) => view.myMainPhaseFrom(5)),
  lesson("new-enemy", "A new enemy", `The opponent played ${NAME.hound}: 2 attack, 3 health.`, (view) => at("card", view.ids(CARD.hound, "theirs", "battlefield"))),
  lesson("spells", "Spells", `A spell acts once, then goes to the graveyard. ${NAME.bolt} deals 3 damage: enough to destroy ${NAME.hound}.`, (view) => at("card", view.ids(CARD.bolt, "mine", "hand"))),
  {
    id: "cast-bolt",
    hint: (view, intent) => {
      if (intent.targetingCardId !== null) {
        return `Now tap ${NAME.hound}: the target of the Bolt.`;
      }
      return intent.pickedCardId === null ? `Tap an ${NAME.bolt} in your hand.` : `Press [Play] to cast ${NAME.bolt}.`;
    },
    taps: (view) => [...view.ids(CARD.bolt, "mine", "hand"), ...view.ids(CARD.hound, "theirs", "battlefield")],
    until: (view) => !view.has(CARD.hound, "theirs", "battlefield"),
    focus: (view, intent) => {
      if (intent.targetingCardId !== null) {
        return at("card", view.ids(CARD.hound, "theirs", "battlefield"));
      }
      return intent.pickedCardId === null ? at("card", view.ids(CARD.bolt, "mine", "hand")) : ["button:confirm"];
    },
  },
  toCombatStep("to-combat-again", "The way is clear: press [End phase] to attack."),
  attackStep("attack-again"),
  playStep("play-imp", "imp", "You still have 1 mana, and unspent mana is lost. "),
  endTurnStep("end-turn-5", 5),
  wait("turn-7", (view) => view.myMainPhaseFrom(7)),
  lesson("finish", "Finish it!", `The opponent has 4 life left. ${NAME.bolt} can hit a player too: tap their portrait as its target. Now win it your way!`, () => ["life:theirs"]),
  { id: "free-play", hint: "No more hints: bring the opponent's life to 0!", free: true, until: (view) => view.isOver },
]);
