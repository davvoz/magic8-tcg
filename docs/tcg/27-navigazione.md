# 27 — Navigazione: le cinque sezioni

Fuori dalla partita ogni schermata sta dentro la stessa cornice: una **barra in alto** con il titolo, *Back* e le cose del giocatore. Non c'è una barra laterale: il gioco si apre su **Home**, che mostra le altre quattro sezioni come card, e da ogni sezione *Back* riporta a Home.

## Le regole

- **Nomi fissi.** Nessun pulsante cambia nome o sparisce: ciò che non è ancora disponibile si vede bloccato, con un lucchetto e il motivo (*Sign in to play online*, *Ranked opens after 2 more casual games*, *Not available offline: it needs the game server*).
- **Un solo pulsante dorato per schermata**: l'azione principale. I modi di giocare sono riquadri con una riga che dice a cosa servono.
- **Navigazione sempre visibile.** *Back* torna alla schermata da cui si è arrivati, alla schermata della sezione, o da questa a Home.
- **Ogni cosa dove la si cerca.** Mazzi in *Decks*; negozio, bacheca e scambi in *Market*; le proprie partite e quelle da guardare in *Play*; classifica e jackpot in *Season*.
- **Saldo in vista, dettagli tecnici nascosti.** STEEM e ingressi ranked sempre in alto; versione, carte, salvataggi e stato della connessione nelle impostazioni.
- **Telefono in orizzontale**, come sempre (18): la barra in alto è più bassa; ogni comando è alto almeno 46 unità.

## La cornice

- **Nessuna barra laterale** (tolta il 2026-10-17, prima solo su PC): la barra in alto va da bordo a bordo, la Home mostra le altre quattro sezioni come card (`home/NavCard.js`: dipinto, nome, una riga su cosa c'è; una sezione senza schermata qui, offline, è bloccata e un clic dice perché) e le schermate di ogni sezione hanno *Back* verso la Home.
- **Barra in alto** (`TopBar.js`): a sinistra il logo del gioco (`GameLogo.js`) e *Back* (quando c'è); nessun titolo che dica dove si è; poi da destra l'account (foto e nome, oppure *Sign in*), le impostazioni, la campanella delle notifiche con il numero delle non lette, gli ingressi ranked e il saldo del wallet. Quando lo spazio non basta (telefono) lasciano il posto prima gli ingressi, poi il saldo.
- **Schede** (`SectionTabs.js`): una sezione con più schermate proprie le mostra come schede nella barra in alto, dopo *Back*, con quella aperta illuminata: *Decks* = *My decks* · *Collection*; *Market* = *Shop* · *Player market* · *Trades*. Una scheda non disponibile resta al suo posto, bloccata, con il motivo (*Sign in to trade cards with other players.*).
- **Impostazioni** (`SettingsDialog.js`): suono (musica, effetti, muto), *Info*, e le righe sul gioco: connessione e account, carte e mazzi del gioco, dove sono salvati i mazzi, versione.
- **Account** (`AccountDialog.js`): chi è connesso e come, *Sign out*.

La cornice è il `chrome` della scena (`Scene.js`): disegnata sotto, raggiunta dopo, e lasciata stare quando la scena si ricostruisce. Le scene la ereditano da `SectionScene`, che dà loro come viewport l'area rimasta (`ContentViewport`). Fuori dalla cornice: la partita, il replay, l'accesso, l'errore.

## Le sezioni

| Sezione | Schermata | Cosa c'è |
|---|---|---|
| **Home** | `HomeScene` | In alto il *Prossimo passo* per i nuovi (tutorial → starter → prima sfida → prima partita online → classificata; si nasconde, e sparisce a percorso finito) o la partita in corso da riprendere (anche da un toast ovunque). Sotto, le card delle sezioni: sul telefono *Play*, *Decks*, *Market*, *Season* affiancate; su PC tre colonne: in alto *Play* larga quanto due card (il dipinto ne prende la maggior parte, a sinistra; nome e riga a destra), sotto *Decks* e *Market*, e a destra per tutta l'altezza la card della stagione con il jackpot e la propria posizione. |
| **Play** | `PlayScene` | Quattro riquadri, ciascuno con il suo dipinto (le Sfide con il personaggio del giorno): *Daily challenges*, *Online* (*Casual* · *Ranked*), *Practice vs AI*, *Tutorial*; nella barra in alto, *Live games* e *My games*. |
| **Decks** | `DecksScene` · `CollectionScene` | I mazzi del giocatore al centro (quello con cui gioca illuminato: un clic ne sceglie un altro), *Edit*/*Copy* e *Delete*; lo starter gratuito finché non lo prende, il mazzo lasciato aperto nel Deck Builder, *New deck*. Scheda *Collection*: le carte possedute. Il Deck Builder serve solo a modificare un mazzo. |
| **Market** | `ShopScene` · `MarketScene` · `TradesScene` | Negozio (pacchetti, singole, mazzi, ingressi ranked; ordini da pagare), bacheca dei giocatori (con *My sales & purchases*), scambi. |
| **Season** | `SeasonScene` | Classifica con la propria riga e posizione, jackpot e premi, come funziona la classificata, *Play ranked* (bloccato con ciò che manca). Le stagioni passate non ci sono ancora: il server non le espone. |

Il mazzo con cui si gioca è uno solo per tutto il gioco (`application/decks/SelectedDeck.js`, salvato nel browser): lo usano Practice, Online e le Sfide, e si sceglie lì, prima di giocare (Play non ha una barra del mazzo); cambiarlo in una di queste schermate vale anche per le altre.

Il percorso del *Prossimo passo* (`application/onboarding/`) conosce lo starter dall'account e la classificata dalla posizione in stagione; tutorial finito, prima sfida vinta e prima partita online sono ricordati nel browser, per account.

## Back

Una sola regola per tutte le schermate (`rendering/shell/navigation.js`):

- ogni schermata appartiene a una sezione (o a nessuna: notifiche, Info);
- le schermate proprie di una sezione (quella che apre la sua card in Home e le sue schede) hanno *Back* verso **Home**, dove sono le sezioni; Home non ha *Back*; dentro una sezione ci si muove con le schede;
- ogni altra schermata torna a quella da cui è stata aperta, se questa l'ha detto (`back`, con i parametri con cui riaprirla, `backParams`), altrimenti alla schermata della sua sezione: le Sfide a *Play*, il Deck Builder a *Decks*, le notifiche e Info a *Home*.

Esempi: dalla sfida del giorno in Home, *Back* torna a Home; aperta da Play, torna a Play. Le carte vinte aperte da una sfida (Collection) hanno *Back* verso le Sfide, anche se Collection è una scheda. Una partita in un replay aperto da *My games* torna alle partite dello stesso giocatore. La catena dei *Back* è tenuta corta (sei passi al massimo).

Una schermata che ne apre un'altra le passa `backHere()` (`SectionScene`); i toast fanno lo stesso con la schermata su cui si clicca. *Esc* segue lo stesso *Back*.

## Anteprime

`tools/preview/?scene=home`, `…=play`, `…=mydecks`, `…=season` (con `&art=procedural` per non scaricare le illustrazioni delle carte).
