/**
 * The sounds the game asks for, by what happened rather than by how it
 * sounds: a scene plays `SoundCue.CARD_PLACE`, and the audio adapter decides
 * what a card landing on the table sounds like (infrastructure/audio). A new
 * sound is a new cue here and a patch registered for it there; nothing that
 * plays cues changes.
 *
 * Grouped by where they are heard: the interface, the opening toss, the
 * cards, spells and abilities, combat, the turn and its clock, the end of a
 * match, and the economy (shop, market, collection).
 */
export const SoundCue = Object.freeze({
  // Interface
  UI_CLICK: "ui.click",
  UI_CONFIRM: "ui.confirm",
  UI_SELECT: "ui.select",
  UI_DANGER: "ui.danger",
  UI_ERROR: "ui.error",
  NOTIFY_INFO: "notify.info",
  NOTIFY_GOOD: "notify.good",
  NOTIFY_BAD: "notify.bad",
  CHALLENGE: "notify.challenge",
  MATCH_FOUND: "online.matchFound",

  // The opening toss
  COIN_TOSS: "coin.toss",
  COIN_LAND: "coin.land",
  TOSS_VERDICT: "coin.verdict",

  // Cards
  CARD_DRAW: "card.draw",
  CARD_PICK: "card.pick",
  CARD_PLACE: "card.place",
  CARD_FLIP: "card.flip",
  CARD_DISCARD: "card.discard",
  CARD_RETURN: "card.return",

  // Spells and abilities
  SPELL_CAST: "magic.cast",
  SPELL_STRIKE: "magic.strike",
  ABILITY_TRIGGER: "magic.ability",
  TARGET_SEEK: "magic.seek",
  BUFF: "magic.buff",
  DEBUFF: "magic.debuff",
  HEAL: "magic.heal",

  // Combat
  ATTACK_DECLARE: "combat.attack",
  BLOCK_DECLARE: "combat.block",
  LUNGE: "combat.lunge",
  HIT_CREATURE: "combat.hitCreature",
  HIT_PLAYER: "combat.hitPlayer",
  CREATURE_DEATH: "combat.death",

  // The turn and its clock
  TURN_MINE: "turn.mine",
  TURN_THEIRS: "turn.theirs",
  TURN_END: "turn.end",
  CLOCK_TICK: "clock.tick",
  CLOCK_URGENT: "clock.urgent",

  // The end of a match
  CRYSTAL_CRACK: "end.crack",
  CRYSTAL_SHATTER: "end.shatter",
  VICTORY: "end.victory",
  DEFEAT: "end.defeat",
  DRAW: "end.draw",

  // The economy
  COINS: "economy.coins",
  PURCHASE_COMPLETE: "economy.purchase",
  RARE_REVEAL: "economy.rareReveal",
  CART_ADD: "economy.cartAdd",
  CART_REMOVE: "economy.cartRemove",
});

/** Every cue, for the adapters to check they can play them all. @type {readonly string[]} */
export const SOUND_CUES = Object.freeze(Object.values(SoundCue));

/**
 * The shortest time between two plays of a cue, in ms, where it is not the
 * default: sounds that may be asked for in bursts (a hand drawn, a volley of
 * blows) would otherwise pile up into noise. The clock ticks on its own.
 * @type {Readonly<Record<string, number>>}
 */
export const CUE_MIN_GAP_MS = Object.freeze({
  [SoundCue.CARD_DRAW]: 55,
  [SoundCue.CARD_DISCARD]: 70,
  [SoundCue.HIT_CREATURE]: 45,
  [SoundCue.CREATURE_DEATH]: 90,
  [SoundCue.UI_CLICK]: 25,
  [SoundCue.NOTIFY_INFO]: 400,
  [SoundCue.NOTIFY_GOOD]: 400,
  [SoundCue.NOTIFY_BAD]: 400,
  [SoundCue.CLOCK_TICK]: 0,
  [SoundCue.CLOCK_URGENT]: 0,
});

/** The background music, by where the player is. */
export const MusicTrack = Object.freeze({
  MENU: "menu",
  MATCH: "match",
});
