# 17 — Lobby, giocatori online e sfide

**Stato:** 2026-10-01.
- **Server:** modulo `lobby` (`LobbyService`: chi è online, sfide in memoria). La partita di una sfida accettata la crea il matchmaking (`MatchmakingService.startDirect`).
- **Client:** `LobbyService` (lista e sfide, attivo da quando il giocatore entra), colonna "Players online" nella lobby, finestre di sfida, toast su ogni schermata. Immagini di profilo STEEM nella lobby, nei toast, nella partita online, nel menu principale e in classifica.

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

## Classificata automatica

Accanto a *Casual* e *Ranked* la lobby ha una terza modalità, **Auto** (23): il giocatore sceglie un mazzo e uno stile, paga un ingresso ranked ed entra nella lista automatica. L'AI gioca il suo mazzo contro il prossimo che entra, anche ore dopo; il risultato arriva come notifica, con il replay. Non serve nessuno online.

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
- **Lobby** a tre colonne: i tuoi mazzi, i giocatori online, la partita. Le sfide ricevute stanno in cima alla lista dei giocatori.
  - Clic su un giocatore: finestra "Challenge @x" con *Casual game* / *Ranked game*, giocata con il mazzo selezionato.
  - Clic su una sfida ricevuta: finestra con *Accept* (con il mazzo selezionato), *Decline* o *Not now*.
  - Mentre aspetta una risposta, la colonna della partita lo dice e offre *Withdraw challenge*.
- **Toast:** sfida ricevuta, accettata, rifiutata, scaduta, ritirata. Ognuno mostra l'immagine dell'altro giocatore; un clic apre la lobby.

## Immagini di profilo

- Sono quelle che ogni account ha nel suo profilo STEEM. Il client le chiede al servizio immagini di STEEM: `https://steemitimages.com/u/<account>/avatar/medium` (128 px). Il servizio risponde per qualunque account, anche senza immagine, con un'immagine predefinita.
- Il nome dell'account viene messo nell'URL solo se ha la forma di un nome STEEM (`^[a-z][a-z0-9-.]{2,15}$`).
- Ogni immagine viene scaricata una volta per sessione. Finché non è pronta, o se il download fallisce, al suo posto c'è l'iniziale su un colore che dipende dal nome. Un servizio non raggiungibile produce un solo avviso nel log.
- La CSP delle pagine permette immagini da `https://steemitimages.com` (`img-src`). Il canvas non legge mai i pixel, quindi le immagini di un'altra origine non creano problemi.
- Dove compaiono:
  - righe della lobby e finestre di sfida;
  - toast delle sfide;
  - HUD dei due giocatori in una partita online (anche per gli spettatori);
  - angolo in alto a sinistra del menu principale;
  - righe della classifica.
