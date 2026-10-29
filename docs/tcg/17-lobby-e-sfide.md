# 17 — Lobby, giocatori online e sfide

**Stato:** 2026-10-01.
- **Server:** modulo `lobby` (`LobbyService`: chi è online, sfide in memoria). La partita di una sfida accettata la crea il matchmaking (`MatchmakingService.startDirect`).
- **Client:** `LobbyService` (lista e sfide, attivo da quando il giocatore entra), colonna "Players online" nella lobby, finestre di sfida, toast su ogni schermata. Immagini di profilo STEEM nella lobby, nei toast, nella partita online, nella barra in alto e in classifica.

## L'idea

Prima l'unico modo per giocare online era la coda: due giocatori che volevano sfidarsi dovevano entrare in coda nello stesso momento e sperare di trovarsi. Adesso nella lobby si vede **chi è online** e cosa sta facendo. Con un clic su un giocatore gli si propone una partita **casual o classificata**. Lui la riceve su qualunque schermata si trovi, la accetta con un suo mazzo e la partita parte subito, come se li avesse abbinati la coda.

## Chi è online

- **Online** vuol dire collegato adesso al WebSocket del server: un giocatore che ha fatto l'accesso e ha la pagina aperta. La fonte è il `ConnectionHub`.
- Ogni giocatore compare con quello che sta facendo:
  - `idle`: libero;
  - `searching`: in coda;
  - `playing`: in una partita non ancora finita, anche se aspetta la firma Keychain.
- L'ordine è: prima i liberi, poi chi è in coda, poi chi gioca; a parità, per nome. Massimo 200 giocatori. Il richiedente non compare nella sua lista.
- La lista viene costruita al massimo una volta ogni 2 secondi ed è condivisa da tutte le richieste. Il client la rilegge ogni 5 secondi solo mentre la lobby è aperta.

## Due lobby: Casual e Ranked

**Stato:** 2026-10-17 (prima, dal 2026-10-13, erano due schede della stessa lobby). In Play il riquadro *Online* ha un solo pulsante, **Play online**, che apre una scelta: **Casual** o **Ranked**, affiancate (`play/OnlineChoice`, carte `online/ModeCard`), ognuna con cosa dà e cosa chiede. Ogni scelta apre la **sua** schermata (`CasualScene`, `RankedScene`, scene `casual` e `ranked`): stesse colonne a sinistra (i mazzi, i giocatori online e le sfide ricevute, base comune `lobby/LobbyScene`), pannello di destra diverso.

| Schermata | Cosa mostra |
|---|---|
| **Scelta** (dialogo su Play) | *Casual* (blu, ventaglio di carte): *Free, always*, *No rating at stake*, *Challenge any player online*, **Play casual**. *Ranked* (oro, coppa): se chiusa un lucchetto e *Ranked opens after 2 more casual games.*; *A game uses 1 ticket · you have 3* (in rosso *you have none yet*); *Climb the season's leaderboard*; *The best share the jackpot: 866.666 STEEM*; **Play ranked** (si apre sempre: la schermata dice cosa manca). |
| **Casual** | *Casual game*, le pillole (*Free to play*, *No rating at stake*, *Challenge anyone*), tre passi numerati (scegli un mazzo, cerca o sfida, gioca), lo stato, la nota sul fair play e **Find a casual match**. Cliccare un giocatore propone una partita casual. Solo partite casual: niente della classificata (dal 2026-10-17 non c'è più il rimando alla Ranked né quante partite mancano per sbloccarla; lo dicono la scelta in Play e la schermata Ranked). |
| **Ranked** (pannello illuminato d'oro) | Il nome della stagione e il rating (lo **stemma**, *NEW* se provvisorio). Una fascia **YOUR RANKED TICKETS**: i **biglietti** del giocatore (la pila con il sigillo ×N), quanti ne ha (*3 tickets*; in rosso *None yet*), *A game uses 1 · 1.000 STEEM each* e *All go into the jackpot: 866.666 STEEM*, con **Get tickets** / **Get more**. Poi **READY TO PLAY?**: classificata aperta, ingressi, mazzo, ognuno con la spunta o con cosa manca (lucchetto + **Play casual**; *!* in rosso). Poi *Live match* / *Auto · the AI plays*, lo stato, le regole e il pulsante principale: **Find a ranked match · 1 ticket**, oppure **Get ranked tickets** senza ingressi, **Play casual to unlock** se chiusa. Nella barra: **How ranked works** (apre Info, sezione Ranked games, dove è spiegato tutto); **Leaderboard** (Season) solo quando non c'è il pannello del premio, che ha già il suo pulsante. Cliccare un giocatore propone una partita classificata. |

- **Il premio della stagione** (`jackpot/PrizeShowcase`, dal 2026-10-17): sopra mazzi e giocatori, un pannello d'oro con *SEASON 1 · PRIZE POOL*, il montepremi in grande (*866 STEEM*), il conto alla rovescia, quanto è cresciuto, come si divide (*the top 3 of the leaderboard share it: 65% · 25% · 10%*) e un **podio** a tre gradini (oro, argento, bronzo) con ritratto, nome, quota e premio di chi occupa ogni posto (*Open seat* con un punto di domanda se è libero, una corona sul primo, *· You* sul proprio); sotto, dove sta il giocatore (*You: #4 · rating 1612*) e **Leaderboard**, che apre Season. Sul telefono è una fascia bassa con montepremi, conto alla rovescia e podio piccolo; toccarla apre la classifica.
- **Come funziona, su PC** (2026-10-17): sotto la didascalia *HOW RANKED WORKS*, tre riquadri con bordo dorato, uno per passo (numero, figura, titolo e una frase: *Buy tickets · 1 STEEM each: buy them before you play*, *Play ranked · Each game uses 1 ticket, back if called off*, *Win the jackpot · Every ticket feeds it: the top 3 share it*), uniti da frecce dorate. Lo stesso in Season (PC), accanto alla classifica. Sul telefono (Ranked e Season) la versione breve: i numeri dei passi hanno una riga loro sopra le figure (non ci si sovrappongono più), con titoli di una parola (*Buy · 1 STEEM a ticket*, *Play · 1 ticket a game*, *Win · Top 3 win it*); niente frecce (l'ordine lo danno i numeri); le figure si rimpiccioliscono quando lo spazio è poco, così numeri, titoli e due righe di testo ci stanno sempre. **Telefono, in alto:** solo i ticket (la pila, *3 tickets* o in rosso *No tickets*, *1 STEEM each*) e *Buy*; il rating non c'è più lì.
- **Come funziona, sempre in vista.** Nella Ranked, finché non succede nulla (nessuna ricerca, partita, sfida o errore), al posto dello stato ci sono le tre figure di *How ranked works* (in breve se lo spazio è poco, sempre sul telefono: *Tickets · 1 STEEM each*, *Play · 1 ticket a game*, *Jackpot · The top 3 share it*); appena succede qualcosa torna lo stato. Su telefono, se manca qualcosa (ticket, sblocco), lo stato lo dice al posto della guida.
- **Ingressi al volo.** *Get tickets* apre un dialogo nella schermata Ranked (`entries/EntryPurchaseDialog`): i biglietti posseduti e quanti se ne aggiungono, − quantità + (5 all'inizio, fino al limite per ordine), il totale in STEEM, quanto ha il portafoglio, **Buy 5 tickets · 5.000 STEEM**. Paga come lo shop (Keychain o chiave attiva, `ShopService.buy`), segue l'acquisto tappa per tappa (le quattro tappe e la barra dell'attesa della blockchain, `purchase/PurchaseTracker`, al posto di quantità e testo) fino a *Delivered!*, e si può chiudere intanto: gli ingressi arrivano comunque, con la notifica. Lo scaffale *Ranked* dello shop resta.
- **Una partita costa ingressi, non STEEM.** I pulsanti dicono *· 1 ticket* (prima dicevano *· 1.000 STEEM*, come se si pagasse la partita). Lo STEEM compare solo dove si comprano gli ingressi.
- Una sfida ricevuta si risponde nella lobby della sua modalità: una casual in Casual, una classificata in Ranked (la Casual non mostra nulla della Ranked). Una classificata senza ingressi offre **Buy tickets** al posto di *Accept*, con il dialogo d'acquisto lì.
- La fine di una partita torna alla lobby della sua modalità (`lobbyOf`); un toast di sfida apre la lobby della sfida; *Your ranked tickets are ready* apre la Ranked.
- **Telefono:** Casual con i tre passi in breve; Ranked con i biglietti, il rating in breve e **Get**/**More**, poi *Live* · *Auto*. La scelta in Play ha le due carte affiancate.
- Anteprima: `/tools/preview/?scene=casual`, `?scene=ranked` (`&entries=0`, `&eligible=0`, `&way=auto`, `&guide=1`, `&buy=1`), `?scene=play&press=play.online.play`.

## Classificata automatica

Nella schermata *Ranked*, accanto a *Live match*, c'è **Auto** (23): il giocatore sceglie un mazzo e uno stile, paga un ingresso ranked ed entra nella lista automatica. L'AI gioca il suo mazzo contro il prossimo che entra, anche ore dopo; il risultato arriva come notifica, con il replay. Non serve nessuno online.

## Sfide

| Regola | Perché |
|---|---|
| Si sfida solo chi è online, attivo e non in partita. Chi è in coda si può sfidare: se accetta esce dalla coda. | Una sfida a chi non può rispondere resterebbe appesa. |
| Il mazzo dello sfidante viene validato (regole e possesso) e **congelato** all'invio, come un biglietto di coda. Chi accetta sceglie il suo mazzo, che viene validato all'accettazione. | Vendere o modificare carte dopo l'invio non cambia la partita. |
| Classificata solo se **entrambi** possono giocarla (stagione in corso, partite casual minime, 09). Lo sfidante riceve un messaggio diverso se è lui a non poterla giocare o se è l'altro. | Gli stessi requisiti della coda classificata. |
| Le partite classificate da sfida contano come quelle della coda: dopo `maxRatedGamesPerPairPerDay` partite fra la stessa coppia in 24 ore, la sfida classificata viene rifiutata all'invio (`LIMIT_REACHED`, il messaggio dice fra quanto e perché) e all'accettazione (la sfida si chiude con `pair_limit`) (T24). | La sfida diretta rende più facile accordarsi sui risultati: il limite per coppia esiste già per questo. |
| Una sola sfida in uscita per giocatore: una nuova sostituisce la precedente, e il destinatario della vecchia viene avvisato. | Niente raffiche di sfide. |
| Al massimo 5 sfide in attesa per destinatario (`LIMIT_REACHED`). | Nessuno viene sommerso. |
| Dopo un rifiuto, lo stesso sfidante aspetta 30 secondi prima di sfidare di nuovo la stessa persona (`RATE_LIMITED`). | Evita le insistenze. |
| Una sfida senza risposta scade dopo 60 secondi. Un job ogni 5 secondi la chiude e avvisa entrambi. | Nessuna sfida resta appesa. |
| Accettare crea la partita **subito**, nella stessa unità di lavoro in cui vengono cancellati i biglietti di coda di entrambi (`startDirect`). | Nessuno finisce in due partite. Se la coda tiene il biglietto (`FOR UPDATE`), la cancellazione aspetta; se nel frattempo la coda ha dato una partita a uno dei due, l'accettazione fallisce (`CONFLICT`) e lo sfidante riceve `busy`. |
| Dopo l'accettazione, tutte le altre sfide aperte dei due giocatori vengono chiuse con `busy`. | Ormai stanno giocando. |
| Chi si disconnette porta con sé le sue sfide, inviate e ricevute (`offline`). L'annuncio di una manutenzione le chiude tutte (`maintenance`) e ne impedisce di nuove (`MAINTENANCE`). | Le stesse regole della coda. |
| Le sfide vivono **in memoria**, come le partite che ne nascono (un solo processo, 06). | Una sfida dura al massimo un minuto: un riavvio la chiude come una disconnessione. Il client la dimentica appena la connessione cade. |

La partita di una sfida è identica a una partita della coda: `match.found`, entropia, firma Keychain di entrambi (12), timer e risultato sulla catena. Lo sfidante siede al posto `s0`, ma chi gioca per primo lo decide il lancio della moneta.

## Messaggi WebSocket

Client → server:

| `t` | `d` | Risposta |
|---|---|---|
| `lobby.list` | `{}` | `lobby.players` `{ "players": [{ "account", "status" }], "challenges": { "incoming": [<sfida>], "outgoing": <sfida> \| null } }` |
| `challenge.send` | `{ "to": "<account>", "mode": "casual"\|"ranked", "deckId" }` | `challenge.sent` `<sfida>` |
| `challenge.accept` | `{ "challengeId", "deckId" }` | `challenge.accepted` `{ "challengeId", "gameId" }`, poi `match.found` a entrambi |
| `challenge.decline` | `{ "challengeId" }` | `challenge.declined` `{ "challengeId" }` |
| `challenge.cancel` | `{ "challengeId" }` | `challenge.cancelled` `{ "challengeId" }` |

Server → client:

| `t` | `d` |
|---|---|
| `challenge.received` | `<sfida>`, al destinatario |
| `challenge.closed` | `{ "challengeId", "reason", "gameId"? }` a chi deve saperlo. `reason`: `accepted` (allo sfidante, con `gameId`), `declined`, `cancelled`, `expired`, `offline`, `busy`, `maintenance`, `pair_limit` (allo sfidante: all'accettazione la coppia aveva già raggiunto il limite di partite classificate) |

`<sfida>` = `{ "id", "from", "to", "mode", "expiresAt", "expiresInMs" }`. Il client calcola la scadenza dal proprio orologio con `expiresInMs`, così l'ora del server non conta.

Errori: `NOT_FOUND` (giocatore non online, sfida non più aperta), `CONFLICT` (uno dei due è in partita, oppure l'altro non può giocare in classificata), `FORBIDDEN` (lo sfidante non può giocare in classificata), `LIMIT_REACHED`, `RATE_LIMITED`, `VALIDATION`, `MAINTENANCE`.

## Client

- `LobbyService` parte all'accesso, insieme a `OnlineService`. Così una sfida arriva su qualunque schermata, e anche la partita di una sfida accettata. Se il giocatore è altrove quando l'altro accetta, il client lo porta nella lobby: lì Keychain chiede la firma della partita.
- **Lobby** a tre colonne: i tuoi mazzi, i giocatori online, la partita. Ogni giocatore compare una volta sola nella lista.
  - Clic su un giocatore: finestra "Challenge @x" con *Casual game* / *Ranked game*, giocata con il mazzo selezionato.
  - Sfida ricevuta (2026-10-29): nella colonna della partita, al posto dello stato, l'immagine dello sfidante, *@x challenges you*, il tempo per rispondere che scende (*Casual game · 0:42 to answer*; sul telefono *Casual · 0:42 left*) e il mazzo con cui si gioca (si cambia a sinistra). Il pulsante grande diventa **Accept**, accanto a **Decline**; niente finestra. In Ranked prende il posto dei modi di gioco, sotto i ticket. Con più sfide si risponde alla più vecchia e il testo dice quante ne seguono. Nella lista, la riga dello sfidante dice *Challenging you* e un clic porta su *Accept*.
  - Mentre aspetta una risposta, la colonna della partita lo dice e offre *Withdraw challenge*.
- **Toast:** sfida ricevuta, accettata, rifiutata, scaduta, ritirata. Ognuno mostra l'immagine dell'altro giocatore; un clic apre la lobby della modalità della sfida.
- **Notifiche:** finché è aperta, una sfida ricevuta sta in cima al feed delle notifiche, con il tempo che scende e **Answer**, che apre la lobby della sua modalità. Non è salvata sul server (dura un minuto): il feed la legge da `LobbyService` e la toglie quando si chiude. La campanella la conta tra le non lette finché è aperta.

## Immagini di profilo

- Sono quelle che ogni account ha nel suo profilo STEEM. Il client le chiede al servizio immagini di STEEM: `https://steemitimages.com/u/<account>/avatar/medium` (128 px). Il servizio risponde per qualunque account, anche senza immagine, con un'immagine predefinita.
- Il nome dell'account viene messo nell'URL solo se ha la forma di un nome STEEM (`^[a-z][a-z0-9-.]{2,15}$`).
- Ogni immagine viene scaricata una volta per sessione. Finché non è pronta, o se il download fallisce, al suo posto c'è l'iniziale su un colore che dipende dal nome. Un servizio non raggiungibile produce un solo avviso nel log.
- La CSP delle pagine permette immagini da `https://steemitimages.com` (`img-src`). Il canvas non legge mai i pixel, quindi le immagini di un'altra origine non creano problemi.
- Dove compaiono:
  - righe della lobby, finestre di sfida e sfida ricevuta nella colonna della partita;
  - sfide aperte nel feed delle notifiche;
  - toast delle sfide;
  - HUD dei due giocatori in una partita online (anche per gli spettatori);
  - barra in alto di ogni schermata (l'account, 27);
  - righe della classifica.
