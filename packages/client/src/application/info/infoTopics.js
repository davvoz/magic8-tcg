/**
 * The Info screen's topics, in plain English for players new to card games
 * and to the Steem blockchain: how a game is played, how purchases work,
 * how signing in works, ranked games and their entries, and every way to
 * get cards. Pure: the numbers of the rules come from the game content, so
 * the text cannot drift from the rules the engine plays by.
 *
 * Each topic is a list of blocks: a heading, a paragraph, a bullet, or a
 * numbered step (`marker` its number). A topic may carry a link (the free
 * account sign-up).
 */

/** Where a new player gets a Steem account (their wallet), created for them for free. */
export const JOIN_URL = "https://join.cur8.fun";

export const InfoTopicId = Object.freeze({
  MECHANICS: "mechanics",
  PURCHASES: "purchases",
  ACCOUNT: "account",
  RANKED: "ranked",
  SHOP: "shop",
});

/**
 * @typedef {Readonly<{ kind: "heading" | "paragraph" | "bullet", text: string, marker?: string }>} InfoBlock `marker`: a numbered step's number ("1.")
 * @typedef {Readonly<{ text: string, url: string }>} InfoLink
 * @typedef {Readonly<{ id: string, title: string, shortTitle: string, blocks: readonly InfoBlock[], link: InfoLink | null }>} InfoTopic `shortTitle`: its name where room is short (a phone)
 */

/** @param {string} text @returns {InfoBlock} */
const heading = (text) => Object.freeze({ kind: "heading", text });
/** @param {string} text @returns {InfoBlock} */
const paragraph = (text) => Object.freeze({ kind: "paragraph", text });
/** @param {string} text @returns {InfoBlock} */
const bullet = (text) => Object.freeze({ kind: "bullet", text });
/** @param {readonly string[]} texts @returns {InfoBlock[]} numbered steps */
const steps = (texts) => texts.map((text, index) => Object.freeze({ kind: "bullet", text, marker: `${index + 1}.` }));

/**
 * @param {{ gameRules: import("@magic8/engine/domain/game/GameRules.js").GameRules, deckRules: { minSize: number, maxSize: number, maxCopies: number } }} content
 * @returns {readonly InfoTopic[]}
 */
export function infoTopics(content) {
  return Object.freeze([
    topic({ id: InfoTopicId.MECHANICS, title: "How to play", shortTitle: "How to play" }, mechanics(content)),
    topic({ id: InfoTopicId.PURCHASES, title: "Purchases", shortTitle: "Purchases" }, purchases()),
    topic({ id: InfoTopicId.ACCOUNT, title: "Account & sign in", shortTitle: "Sign in", link: { text: "Create a free account: join.cur8.fun", url: JOIN_URL } }, account()),
    topic({ id: InfoTopicId.RANKED, title: "Ranked games", shortTitle: "Ranked" }, ranked()),
    topic({ id: InfoTopicId.SHOP, title: "Shop & cards", shortTitle: "Shop" }, shop()),
  ]);
}

/**
 * @param {{ id: string, title: string, shortTitle: string, link?: InfoLink }} name
 * @param {InfoBlock[]} blocks
 * @returns {InfoTopic}
 */
function topic({ id, title, shortTitle, link }, blocks) {
  return Object.freeze({ id, title, shortTitle, blocks: Object.freeze(blocks), link: link === undefined ? null : Object.freeze({ ...link }) });
}

/** @param {Parameters<typeof infoTopics>[0]} content */
function mechanics({ gameRules: rules, deckRules: deck }) {
  const { resource } = rules;
  const first = resource.startingMax + resource.gainPerTurn;
  const second = Math.min(resource.max, first + resource.gainPerTurn);
  const fatigue = rules.emptyLibrary.damagePerDraw;
  return [
    heading("The goal"),
    paragraph(`Each player starts with ${rules.startingLife} life points. Bring your opponent's life down to 0 and you win. If both players reach 0 at the same moment, the game is a draw. You also lose if you concede or leave an online game.`),

    heading("Your deck and your hand"),
    paragraph(`A deck has ${deck.minSize} to ${deck.maxSize} cards, with at most ${deck.maxCopies} copies of the same card. You can mix cards from any faction.`),
    paragraph(`At the start each player draws ${rules.startingHandSize} cards. A coin toss decides who goes first${rules.firstPlayerSkipsFirstDraw ? ", and the first player does not draw on their very first turn" : ""}. You can hold up to ${rules.maxHandSize} cards: extra cards are discarded at the end of your turn. When your deck is empty, every card you should draw costs you ${fatigue} life instead.`),

    heading("Creatures and spells"),
    paragraph("There are two kinds of cards:"),
    bullet(`Creatures stay on the battlefield. Each has an attack (the sword, bottom left) and a health (the shield, bottom right). They attack, block, and many have abilities. You can have up to ${rules.maxBattlefieldCreatures} creatures on the battlefield.`),
    bullet("Spells do their effect right away (deal damage, heal, draw cards, destroy a creature…) and then go to the graveyard."),
    paragraph("Every card shows its mana cost in the gem at the top. To read a card in full, right-click it, press and hold it on a phone, or select it and press I."),

    heading("Damage and health"),
    bullet("When two creatures fight, each deals damage equal to its attack to the other."),
    bullet("A creature dies when the damage it has taken reaches its health."),
    bullet("Damage stays: a hurt creature does not heal at the end of the turn (its shield turns red). Only healing effects fix it."),

    heading("Creature abilities"),
    paragraph("Some creatures have a keyword:"),
    bullet("Haste: it can attack on the turn it is played."),
    bullet("Trample: when blocked, it deals just enough damage to kill the blocker, and the rest hits the player. Example: 5 attack against a blocker with 2 health means 2 damage to the blocker and 3 to the player."),
    bullet("Vigilance: attacking does not exhaust it, so it can still block on your opponent's turn."),
    paragraph("Other abilities trigger on their own, at a given moment: when the creature enters the battlefield, when it dies, when you cast a spell, or at the start of your turn. The card text tells you when and what."),
    paragraph("Effects you will meet: damage; destroy; drain (deal damage and gain that much life); heal; draw cards; discard (your opponent discards random cards); mill (cards go from the deck to the graveyard); boosts and penalties to attack and health, sometimes just for the turn; return a creature to its owner's hand; sacrifice (put one of your own creatures in the graveyard: its \"when it dies\" ability still triggers)."),

    heading("Mana"),
    paragraph("Mana pays for your cards. You see it as blue orbs next to your portrait, with a counter such as \"3 / 5 resources\": the mana you have left, out of your mana for this turn."),
    bullet(`At the start of each of your turns your mana grows by ${resource.gainPerTurn} (up to ${resource.max}) and refills completely. So you have ${first} mana on your first turn, ${second} on your second, and so on.`),
    bullet("Playing a card spends mana equal to its cost. Lit orbs are mana you can still spend, dim orbs are spent."),
    bullet("Mana you do not spend is not saved for later: try to use it every turn."),

    heading("How a turn works"),
    paragraph("Each turn goes through these phases, in order. The side panel shows whose turn it is and the current phase."),
    ...steps([
      "Turn start (automatic): your mana grows and refills, your creatures are ready again, you draw a card, and \"at the start of your turn\" abilities trigger.",
      "Main 1: play creatures and spells.",
      "Combat, attackers: choose which creatures attack, or none.",
      "Combat, blockers: your opponent chooses how to block. Skipped when nobody attacks.",
      "Combat, damage (automatic): the fight is resolved.",
      "Main 2: play more cards after the fight.",
      "Turn end (automatic): \"until end of turn\" effects wear off, extra cards are discarded, and the turn passes to your opponent.",
    ]),

    heading("Attacking and blocking"),
    ...(rules.combat.summoningSickness ? [bullet("A creature cannot attack on the turn it is played (it shows \"Summoning sick\"), unless it has Haste.")] : []),
    bullet("A creature that attacks becomes \"Exhausted\" until your next turn, so it cannot block on your opponent's turn, unless it has Vigilance."),
    bullet(`Each of your ready creatures can block one attacker, and each attacker can be blocked by ${blockersText(rules.combat.maxBlockersPerAttacker)}.`),
    bullet("An attacker that is not blocked hits the player."),

    heading("What to click"),
    paragraph("The side panel always tells you, in one line, what you can do now, and shows the buttons for it. Cards you can play or choose glow."),
    bullet("Play a card: click a glowing card in your hand. On a phone, tap the card, then tap \"Play\"."),
    bullet("Choose a target: when a card needs one, click a glowing creature, or a player's portrait to aim at the player."),
    bullet("Attack: in the attackers phase, click each creature that should attack (click again to take it back), then click \"Attack with…\". Click \"Skip combat\" to attack with nobody."),
    bullet("Block: when your opponent attacks, click one of your creatures, then the attacker it should block. Repeat for more blockers, then click \"Confirm…\", or \"No blocks\"."),
    bullet("\"Cancel\" undoes the choice you are making."),
    bullet("\"End phase\" moves on to the next phase. \"End turn\" (or the E key) ends your whole turn."),
    bullet("\"Concede\" gives up the game. The Battle log beside the board lists everything that happened."),

    heading("Online games: time limits"),
    bullet("You have 90 seconds per turn, plus a 90-second reserve for the whole game. You have 60 seconds to choose your blocks."),
    bullet("When the time runs out, the game moves on for you (it ends the phase, or blocks nothing)."),
    bullet("If your connection drops the game goes on: come back quickly and you find it as it was. After 3 minutes away (or 3 skipped turns) you lose."),
    bullet("Practice games against the AI have no timer."),
  ];
}

/** @param {number} count how many creatures may block one attacker */
function blockersText(count) {
  return count === 1 ? "only one creature" : `up to ${count} creatures`;
}

function purchases() {
  return [
    heading("How buying works"),
    paragraph("Everything in the game is paid in STEEM, the coin of the Steem blockchain. There is no balance to top up inside the game: each purchase is a transfer straight from your own Steem wallet, and you always see it and confirm it before it is sent."),
    ...steps([
      "In the Shop, pick what you want, then click \"Buy for…\", or \"Add to cart\" to pay for several things at once.",
      "The game tells you exactly how much to pay, to which account and with which memo.",
      "Confirm the transfer: Steem Keychain shows it to you first. If you signed in with your posting key, the game asks for your active key instead (see \"Account & sign in\").",
      "Wait about a minute: the game waits until your payment is final on the blockchain.",
      "Your cards arrive: packs are opened in front of you, and a notification tells you the order is delivered. You can keep playing in the meantime.",
    ]),

    heading("Good to know"),
    bullet("Prices are set by the game and locked in your order, even if the price list changes afterwards."),
    bullet("The Shop shows how much STEEM your wallet holds. You cannot pay for more than that."),
    bullet("Never change the amount or the memo of a transfer. A wrong payment (wrong amount, an expired or cancelled order, another currency) is never kept: it goes into a refund queue and the money is sent back to you."),
    bullet("If your wallet does not answer or the connection drops, check your wallet history before paying again: the transfer may already have gone through."),
    bullet("Every purchase is recorded publicly on the Steem blockchain, as a receipt of what you bought and which cards you received."),

    heading("Fair packs"),
    paragraph("Nobody can rig a pack, not even us. Before packs go on sale, the game publishes on the blockchain a sealed fingerprint of a secret. What is inside each pack depends on that secret and on your payment, which we cannot know in advance. Later the secret is revealed, and anyone can check every pack that was sold."),

    heading("Buying from other players"),
    paragraph("On the Market you pay the seller directly, from your wallet to theirs. The game never touches the money and takes no fee. That is also why the game cannot refund a wrong payment on the Market: you would need to ask the seller."),
  ];
}

function account() {
  return [
    heading("Your account is a Steem wallet"),
    paragraph("To play online, collect and buy cards you need a Steem account. It is your name in the game and also your wallet: it holds your STEEM. There is no password to create with us and no email to give."),
    paragraph("No account yet? We create one for you, for free, at join.cur8.fun. Use the button below, follow the steps, write down your keys somewhere safe, then come back and sign in."),
    paragraph("You can practise against the AI without any account."),

    heading("Two ways to sign in"),
    paragraph("Click \"Sign in\" in the main menu, then choose one of these:"),
    bullet("Keychain (best on a computer): Steem Keychain is a browser extension that keeps your keys. Type your account name and click \"Sign in\": Keychain asks you to sign a one-time login message. Your keys never leave the extension."),
    bullet("Posting key (best on a phone): type your account name and paste your private posting key (it starts with 5). It is checked on the blockchain and kept encrypted in this browser, so next time you are signed in straight away."),

    heading("Your keys, simply"),
    paragraph("A Steem account has several keys, each allowed to do different things:"),
    bullet("Posting key: for everyday actions. Here it signs you in and signs your moves. It cannot move your money. For your safety the game only accepts a key that is a posting key and nothing more."),
    bullet("Active key: it sends STEEM, so it is needed only to pay. Keychain uses it for you. If you signed in with your posting key, the game asks for your active key the first time you pay. You can save it in this browser, locked with a PIN of at least 4 characters (a longer PIN is safer). Once unlocked, it stays unlocked until you close the page."),
    bullet("Owner key and master password: never needed here. Never type them into the game, or into any site you do not fully trust."),

    heading("Safety"),
    bullet("Your private keys never reach our server: everything is signed in your browser (or in Keychain), and the server only checks the signature."),
    bullet("When an online game starts, your browser creates a key for that game only, and every move you make is signed with it. Nobody, not even the server, can make moves in your name."),
    bullet("You stay signed in for up to 7 days, or until you have been away for 24 hours."),
    bullet("\"Sign out\" in the main menu forgets the keys saved in this browser. Always sign out on a computer you share."),
  ];
}

function ranked() {
  return [
    heading("Ways to play"),
    bullet("Practice vs AI: free, no account needed, nothing at stake. The best way to learn."),
    bullet("Casual: online, against other players, free. Your result is recorded, your rating does not change."),
    bullet("Ranked: online, it changes your rating and your place in the season's leaderboard. Each game costs one ranked entry."),
    bullet("Watch: follow a game in progress as a spectator. You never see the players' hands."),

    heading("Starting a game online"),
    ...steps([
      "Sign in, and take your free starter deck from the main menu.",
      "Click \"Play online\".",
      "Pick one of your decks on the left.",
      "Choose \"Casual\" or \"Ranked\", then click \"Find a match\". Or click a player in the list of players online to challenge them.",
      "When a match is found, both players confirm it (Keychain asks you to sign; with a posting key it happens on its own), and the game starts.",
    ]),

    heading("Who can play ranked"),
    bullet("Finish 3 casual games first. Until then, Ranked stays locked and the lobby tells you how many games are left."),
    bullet("Have at least one ranked entry."),

    heading("Ranked entries: buy them in advance"),
    paragraph("Each ranked game costs one ranked entry. The price is shown on the Ranked button (1 STEEM today). Instead of paying before every game, you buy entries in advance: as many as you like, up to 50 in one order, with a single transfer. Then each ranked game uses one."),
    bullet("Buy them in the Shop, on the Ranked shelf. In the lobby, when you have none, the \"Get ranked entries\" button takes you there."),
    bullet("The lobby shows how many entries you have left."),
    bullet("An entry is used when the game is created: when the queue finds your opponent, or when a ranked challenge is accepted."),
    bullet("If the game is cancelled before it starts (a player does not confirm in time), both players get their entry back."),
    bullet("Once the game has started, the entry is spent, even if you concede, leave or run out of time."),
    bullet("Entries never expire: the ones you do not use stay for the next seasons. They cannot be refunded, traded or sold."),
    bullet("Every entry goes into the season's jackpot."),

    heading("Rating and seasons"),
    bullet("Everyone starts at 1500. Win to go up, lose to go down. Beating a stronger player is worth more."),
    bullet("A new player's rating moves fast. While it is still uncertain, you appear in the leaderboard as provisional, without a position."),
    bullet("Every season the ratings start again from scratch. The Leaderboard (in the online lobby) shows the top 100."),
    bullet("Fair play: after 3 ranked games in a day against the same opponent, further games between you still use an entry but do not change the rating."),

    heading("The season's jackpot"),
    paragraph("When the season has a jackpot, the main menu shows it: how much it holds, the prize for each place, who is leading and how long is left. It grows with every pack and every ranked entry sold. When the season ends, the top 3 players of the leaderboard share it."),
  ];
}

function shop() {
  return [
    heading("Where cards come from"),
    bullet("Free starter deck: once signed in, pick one of 5 decks, one per faction, ready to play. You get it once per account."),
    bullet("The Shop: packs, complete decks, single cards and ranked entries."),
    bullet("The Market: buy cards from other players, or sell your own."),
    bullet("Trades: swap cards with another player."),
    paragraph("Every card you own is a unique copy, with its own serial number (such as \"Ember Imp #4\") and its own history. Your Collection, in the main menu, lists them all."),

    heading("The Shop"),
    paragraph("Open it from the main menu. Pick a shelf with the tabs on the left; on the right you see the item you selected, its price and the buttons to buy it."),
    bullet("Packs: cards you do not know in advance. A Core Booster has 5 cards (3 common, 1 uncommon, 1 rare or better), a Core Mini Booster 3 cards (2 common, 1 uncommon or better). The exact odds are shown under \"Pack odds\"."),
    bullet("Decks: complete preconstructed decks, saved in your account ready to play. A deck costs the sum of its cards."),
    bullet("Singles: any card in the game, priced by rarity (common, uncommon, rare, epic, legendary). Filter them by faction, rarity and type."),
    bullet("Ranked: ranked entries, to play ranked games (see \"Ranked games\")."),
    bullet("Offers: special offers, when there are any."),

    heading("Buying in the Shop"),
    bullet("Choose the quantity with − and +, then click \"Buy for…\" to pay right away, or \"Add to cart\"."),
    bullet("Your cart, at the top of the Shop, collects things from every shelf. Change or remove them, then pay for everything with one transfer."),
    bullet("See \"Purchases\" for how paying works."),

    heading("The Market"),
    paragraph("Open it from your Collection, or with \"Player market\" in the Shop. It is a public board of cards that players sell for STEEM, at the price they choose."),
    bullet("To buy: pick a card on the board and click \"Buy for…\". It is reserved for you for 15 minutes: pay the seller with the transfer the game shows you. The card is yours as soon as the payment is final."),
    bullet("To sell: click \"Sell a card\", pick the copy and set your price. While it is on sale (up to 30 days) the card is locked: you cannot use it in a deck or trade it."),
    bullet("The seller gets the full price: the game takes no fee."),
    bullet("\"My sales & purchases\" lists what you are selling and what you bought."),

    heading("Trades"),
    paragraph("Open them from your Collection. A trade is card for card, without money."),
    bullet("Click \"New offer\": offer up to 10 of your cards and ask for up to 10 of the other player's cards. Asking for nothing makes it a gift."),
    bullet("The cards you offer stay locked until the other player answers with \"Accept\" or \"Decline\"."),
    bullet("If they accept, all the cards change hands at once. If they decline, if you cancel the offer, or after 72 hours, your cards are free again."),
    bullet("Every completed trade is recorded on the blockchain."),
  ];
}
