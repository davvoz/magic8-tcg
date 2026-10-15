# 24 — Sfide giornaliere

**Stato:** 2026-10-15. **Fase 1 fatta**: la SearchAi nel motore, provabile nell'allenamento (sotto, *L'IA*). **Fase 2 fatta**: il server (modulo `daily`, migrazione `021_daily_challenges.sql`, dati in `data/daily/`), sotto *Sul server*. **Fase 3 fatta**: la schermata *Challenges* nel client (sotto, *Nel client*). Restano i contenuti definitivi (fase 4) e il bilanciamento (fase 5).

## L'idea

Una modalità per giocatore singolo che dà un motivo per tornare ogni giorno. Ogni giorno ci sono **tre sfide contro l'IA**: due contro **personaggi** e la terza contro un **boss**. Chi le vince tutte e tre riceve **un pacchetto**. Ogni avversario è un personaggio con un nome, un ritratto, un mazzo e un modo di giocare suo, e parla prima e dopo la partita: le sfide sono incontri, non partite contro "il computer".

## Le regole

| Regola | Stato |
|---|---|
| Ogni giorno **3 sfide**: personaggio, personaggio, **boss**. Si giocano in quest'ordine; il boss si sblocca dopo aver battuto i due personaggi. | deciso |
| Non serve giocarle di fila: se ne gioca una, si esce e si torna più tardi nello stesso giorno. | deciso |
| Vinte tutte e tre, si riceve **un pacchetto**. | deciso |
| Alla prima sfida del giorno si sceglie il **percorso**: *Normale* (premio un Core Mini Booster) o *Difficile* (premio un Core Booster, IA più forte). | deciso |
| Le carte vinte sono **del giocatore**: si scambiano e si vendono come quelle comprate. | deciso |
| Il percorso scelto resta fisso fino alla fine del giorno. | fatto |
| Il giorno cambia a **mezzanotte UTC**. Le sfide non finite si perdono, il premio già ricevuto resta. | fatto |
| Gli avversari del giorno sono **gli stessi per tutti** (si può parlare del boss di oggi), a rotazione: ogni personaggio torna solo dopo che sono passati tutti, e nessuno torna il giorno dopo. | fatto |
| Una sfida persa si **rigioca** quante volte si vuole contro lo stesso avversario. Il premio resta uno al giorno. Pareggio e resa valgono come sconfitta. | fatto |
| Si gioca con **i propri mazzi online** (solo carte possedute), come in casual. | fatto |
| Nessun requisito per giocare: basta l'account (niente partite minime). | fatto |
| Un turno può durare **10 minuti**, senza riserva. Chi esce dalla partita la perde dopo **15 minuti** di assenza. | fatto |

## I due percorsi

| | Normale | Difficile |
|---|---|---|
| Livello dell'IA (personaggio, personaggio, boss) | 2, 3, 5 | 6, 7, 10 |
| Premio | **Core Mini Booster** (3 carte: 2 comuni, 1 non comune o meglio) | **Core Booster** (5 carte: 3 comuni, 1 non comune, 1 rara o meglio) |

Sono i due pacchetti che lo shop vende già (`data/economy/drop-tables`). Altri pacchetti più avanti. I numeri stanno in `data/daily/tracks.json`.

Il boss è più forte per il livello dell'IA, per il mazzo (il precostruito della fazione con la sua carta simbolo in più copie) e per la sua **condizione** (sotto, *Le condizioni dei boss*).

I numeri si regolano dopo le prove: l'obiettivo è che un giocatore con uno starter vinca il percorso Normale in buona parte dei giorni, e il Difficile solo con un mazzo migliorato.

## I personaggi

Uno per ogni mazzo precostruito, più un boss per fazione. Nomi, carattere e testi sono **provvisori**. Lo stile è quello dell'IA (23): *Aggressive*, *Balanced*, *Defensive*.

| Personaggio | Mazzo | Stile | Carattere |
|---|---|---|---|
| Kael, Avanguardia di Brace | Ember Vanguard | Aggressive | soldato impaziente, attacca per primo e chiede dopo |
| Sira Fiammaselvaggia | Ember Wildfire | Aggressive | piromane allegra, gioca per lo spettacolo |
| Mastro Brunn | Iron Foundry | Balanced | fabbro brontolone, rispetta solo il lavoro fatto bene |
| Capitano Varek | Iron Legion | Defensive | ufficiale rigido, tiene la linea a ogni costo |
| Morwen la Mietitrice | Grave Harvest | Balanced | becchina gentile e inquietante |
| Il Notaio del Patto | Shadow Pact | Balanced | mercante d'anime cortese, parla di contratti |
| Elda del Boschetto | Verdant Grove | Defensive | eremita paziente, lascia crescere la foresta |
| Rook il Cacciatore | Wild Hunt | Aggressive | cacciatore di poche parole |
| Magistra Ilyra | Arcane Conclave | Defensive | studiosa sprezzante, ti corregge mentre giochi |
| Thessaly della Guglia | Spire Bastion | Defensive | guardiana stanca, ha visto cadere molti sfidanti |

**Boss**, uno per fazione, ciascuno con il precostruito della fazione e la sua carta simbolo in più copie (33 carte). Mazzi più curati in fase 4:

| Boss | Fazione | Carta simbolo |
|---|---|---|
| Il Wyrm Vulcanico | Ember | Volcanic Wyrm |
| Il Colosso di Ferro | Iron | Iron Colossus |
| Il Signore delle Tombe | Shadow | Gravelord |
| La Radice del Mondo | Verdant | Worldroot Colossus |
| L'Arcimago della Guglia | Arcane | Archmage of the Spire |

I boss sono il ponte verso la futura campagna: la storia potrà partire da loro.

### Dialoghi

Ogni personaggio ha poche battute, in un file di dati, senza codice:

- **prima** della partita (2–3 varianti, una a caso);
- quando **scende a 5 punti vita** o meno (una volta per partita);
- **dopo** la partita, diversa se vince o se perde;
- per i boss, una battuta in più quando si sblocca la sfida.

I personaggi possono citarsi a vicenda ("Hai battuto Varek? Con me non andrà così").

## Le condizioni dei boss

Ogni boss porta al tavolo una regola che vale solo in quella partita. Le condizioni sono dati (`conditions` del boss in `data/daily/characters.json`), con un nome e una riga di testo per il giocatore, e una **portata**: tutti (`everyone`), solo il boss (`opponent`), solo lo sfidante (`challenger`).

| Boss | Condizione | Portata |
|---|---|---|
| Il Wyrm Vulcanico | *Scorched Earth*: a inizio turno chi gioca perde 1 vita | tutti |
| Il Colosso di Ferro | *Fortress*: le sue creature entrano con +0/+2 | il boss |
| Il Signore delle Tombe | *Curse of the Grave*: le tue magie costano 1 in più | lo sfidante |
| La Radice del Mondo | *Ancient Forest*: le creature costano 1 in meno a tutti | tutti |
| L'Arcimago | *Forbidden Library*: tutti pescano una carta in più a turno | tutti |

**Nel motore** (`packages/engine/src/domain/conditions/`) una condizione è una regola della partita con i giocatori per cui vale. Il motore la interroga in pochi punti fissi: preparazione, inizio turno, pagamento di una carta, ingresso in campo di una creatura. Ogni tipo è una classe a sé, quindi un tipo nuovo non tocca il motore.

| Tipo (`kind`) | Effetto |
|---|---|
| `cost` | le carte che corrispondono al filtro costano `amount` in più (meno se negativo, mai sotto 0) |
| `enter_stats` | le creature che corrispondono al filtro entrano con +`attack`/+`health` permanenti |
| `keyword` | le creature che corrispondono al filtro entrano con una parola chiave (Rapidità, Sfondare, Vigilanza) |
| `turn_start` | a inizio del proprio turno il giocatore perde o guadagna `amount` vita, o pesca `amount` carte |
| `extra_draw` | il giocatore pesca `amount` carte in più a inizio turno |
| `starting_hand` | il giocatore parte con `amount` carte in più |
| `starting_life` | il giocatore parte con `amount` vita in più (anche la vita massima) |

Il filtro, quando c'è, sceglie per tipo di carta, fazione o parola chiave.

- Le condizioni sono **scritte nella partita** (`cond` del `GAME_CREATED`, 03, e `games.conditions`): ripresa dopo un riavvio e replay giocano con le stesse regole. Una partita senza condizioni ha esattamente il record e lo stato di prima.
- Lo **snapshot** le mostra (`conditions`), insieme al costo attuale delle carte in mano (`cost`, con `printedCost`), alle parole chiave ricevute e alla vita massima di ciascun giocatore. Il client le userà per mostrare la condizione (fase 3).
- **L'IA le conosce senza codice in più**: la SearchAi ricostruisce la partita dallo snapshot, condizioni comprese, e simula sul motore vero.

## L'IA

L'IA attuale (`BasicAi`, 23) sceglie una mossa alla volta con regole fisse e senza guardare avanti: gioca sempre la carta più cara (con 4 di energia e in mano un 3 e due 2 gioca il 3), usa la rimozione sempre sulla creatura più forte e non confronta alternative. Per le sfide serve un'IA più forte.

**SearchAi** (fatta, `packages/engine/src/domain/ai/search/`), nel motore accanto a `BasicAi`. Prova le mosse su una copia della partita e tiene quella che porta alla posizione migliore.

| Parte | Cosa fa |
|---|---|
| `PerspectiveWorld` | Ricostruisce una partita giocabile da ciò che il giocatore vede: tavolo, vita, energia, cimiteri e combattimento esatti; mano dell'avversario e mazzi come carte "sconosciute" (stesso numero, mai giocabili). **Non bara:** non sa più di un umano al suo posto. |
| `TurnPlanner` | Pianifica il resto del proprio turno con una *beam search*: quali carte, in che ordine, con quali bersagli, quale attacco. Le linee migliori restano aperte (`beamWidth`), le altre si scartano. |
| `BlockPlanner` | Sceglie i blocchi provandoli: parte da "nessun blocco" e dai blocchi di `BasicAi`, poi migliora un blocco alla volta. |
| `OpponentModel` | Come si aspetta che l'avversario risponda nella simulazione (blocchi, e il suo turno con il *lookahead*): oggi `BasicAi`. |
| `PositionEvaluator` | Dà un punteggio alla posizione: vita (su una curva, conta di più quando è bassa), creature, carte in mano, e i danni che il prossimo attacco di ciascuno farebbe passare. |
| `EvaluationWeights` | Il **carattere**: quanto pesa ogni voce. Uno per stile (*aggressive*, *balanced*, *defensive*); un personaggio può avere pesi suoi. |
| `DifficultyScale` | Il **livello**, da 1 a 10 con i decimali: punti di ancoraggio e interpolazione lineare fra loro. Regola ampiezza della ricerca, combinazioni d'attacco, giri sui blocchi, *lookahead*, budget di simulazioni e "rumore" (errori di valutazione). |
| `DecisionNoise` | Gli errori dei livelli bassi: deterministici (hash della posizione), non casuali. |

- **Deterministica**, come `BasicAi`: stessa posizione, livello, stile e *salt* danno la stessa mossa; il budget conta le mosse simulate, non il tempo.
- **Versione** `SEARCH_AI_VERSION = 1`. La classificata automatica non la usa.
- Il motore ha due aggiunte per lei: `GameEngine.fork()` (una copia che va per conto suo, quasi gratis) e `GameEngine.resume()`; lo snapshot mostra anche i `modifiers` di ogni creatura (pubblici come il resto del tavolo).

**Misure** (`npm run simulate -- 6 --versus=search:N,basic` o equivalente: tutti gli abbinamenti dei 10 precostruiti, specchi compresi, ogni IA su entrambi i posti, 600 partite per riga):

| Livello | Vince contro `BasicAi` | Tempo medio per partita (entrambe le IA) |
|---|---|---|
| 1 | 35% | ~70 ms |
| 3 | 53% | |
| 5 | 72% | ~250 ms |
| 7 | 83% | |
| 10 | 86% | ~650 ms |

Livello 10 contro 5: 64%; 10 contro 7: 54% (400 partite). Al livello 7 i tre stili si equivalgono (82–84% contro `BasicAi`). Cambiare i pesi della valutazione di ±30% sposta il risultato meno dell'errore di misura: la forza viene dalla ricerca, i pesi danno il carattere.

**Nell'allenamento**, il pulsante **Opponent** nella scelta del mazzo sceglie l'avversario: *Classic* (`BasicAi`), *Easy* (livello 2), *Normal* (5, il predefinito), *Hard* (8), *Expert* (10). Gli avversari sono descritti come dati (`AiSpec`, `application/match/AiOpponents.js`), come lo saranno i personaggi.

La classificata automatica resta su `BasicAi` finché non si decide altrimenti (`AI_VERSION`).

**Riuso per i bot della classificata.** La stessa IA servirà ai bot ranked (documento a parte, dopo le sfide): ogni livello avrà un rating misurato e il bot da affiancare a un giocatore si sceglie dal suo rating. Per questo il livello è una scala e non due modalità. Le partite delle sfide danno i primi dati su come vanno i giocatori veri contro ciascun livello.

## Sul server

Le partite delle sfide si giocano **sul server**, come quelle online, con l'IA al posto del secondo giocatore. Nel browser il client conoscerebbe il seme della partita, quindi la mano dell'IA e le carte che pescherà, e potrebbe riprovare finché non vince: con un premio che vale STEEM non basta.

**Il posto dell'IA** (modulo `gameplay`):

- Un giocatore di una partita può essere l'IA: in `game_players` ha `user_id` vuoto e un `ai_profile` (personaggio, livello, stile, *salt*). Al tavolo si chiama `ai_<id>` (per esempio `ai_kael`): il trattino basso non esiste nei nomi STEEM, quindi non può essere un account vero.
- `GameActor` dà l'entropia del posto dell'IA (quella del server) appena la partita è creata; poi, ogni volta che il motore aspetta l'IA, le chiede la mossa nella sua coda di messaggi, come ogni altro input, e la registra come una mossa. Se l'IA non avesse mosse valide (un bug), fa la mossa minima come una mossa forzata.
- La SearchAi la costruisce `GameService` con una *factory* (`createAi`), sui contenuti con cui la partita è stata creata.
- Queste partite sono in **protocollo v1**: l'IA non può firmare, quindi nessuno firma. Il giocatore non deve approvare niente con Keychain per giocare una sfida.
- Modalità di gioco nuova: **`daily`**. Non cambia il rating, non conta come casual, e il risultato **non va sulla catena** (è una partita contro la casa). I tempi sono quelli delle sfide (`DAILY_TIME_POLICY`).

**Il modulo `daily`:**

| Parte | Cosa fa |
|---|---|
| `DailyRoster` | Personaggi e boss da `data/daily/characters.json`, controllati all'avvio: ogni mazzo dev'essere legale. Un mazzo è l'id di un precostruito, oppure `{ base, add }` (un precostruito con carte in più) o `{ cards }`. |
| `DailyTracks` | I due percorsi da `data/daily/tracks.json`: livelli dell'IA e tabella del pacchetto, controllati contro la scala dei livelli e le tabelle dello shop. |
| `DailySchedule` | Gli avversari di un giorno, funzione pura della data: ogni processo del server è d'accordo senza salvare niente. |
| `DailyChallengeService` | Le sfide del giorno: vedere, scegliere il percorso, giocare. Quando una partita finisce (o viene annullata prima di iniziare) la chiude una volta sola e fa avanzare la giornata. |
| `DailyRewarder` | Il pacchetto: estratto dalla tabella dello shop con un seme casuale salvato nella giornata, coniato come `reward`, con la notifica `daily.reward`. |

**API:**

| Chiamata | Cosa fa |
|---|---|
| `GET /api/daily` | Il giorno: data e fine, i due percorsi, i tre avversari (nome, titolo, fazione, stile, mazzo, battute, stato *beaten* / *next* / *locked*) e la giornata del giocatore (percorso, sfide vinte, partita in corso, tentativi, premio ricevuto). |
| `POST /api/daily/track` `{ track }` | Sceglie il percorso del giorno (`normal` o `hard`). Sceglierne un altro lo stesso giorno è un errore. |
| `POST /api/daily/play` `{ deckId }` | Crea la partita contro il prossimo avversario con quel mazzo e risponde `{ gameId }`; se la partita c'è già, la ridà. Poi si gioca con il protocollo delle partite (`match.found`, entropia, mosse), come una partita online. |

## Nel client

- **Menu principale**: da connessi c'è *Challenges* sotto *Play online*, con l'avanzamento del giorno: *(1/3)*, *(done)*. Su telefono, quando i pulsanti non ci stanno, gli ultimi secondari si affiancano due per riga.
- **Schermata *Challenges*** (`DailyScene`): i tre avversari affiancati (`daily/OpponentCard`), ciascuno con ritratto, nome, titolo, banda della fazione, la battuta d'apertura e, per il boss, le sue condizioni. Mazzo, stile e livello dell'IA **non** si mostrano: la schermata parla al giocatore (chi affronta, cosa vince), non di come è fatto il gioco. Al posto dei dettagli arriveranno le illustrazioni animate dei personaggi (fase 4). Il prossimo da battere è illuminato, gli altri sono *Beaten* o *Locked*. Sotto:
  - senza percorso, i due percorsi con il pacchetto in palio, con una conferma (vale fino a domani);
  - con il percorso, il mazzo (scorre solo fra quelli giocabili) e *Fight Kael*, oppure *Back to your game* se la partita è in corso;
  - vinte tutte e tre, *See the cards you won* e *Collection*. Il pacchetto si apre da solo la prima volta, carta per carta con i numeri di serie.
  - La riga di stato dice le ultime parole dell'avversario appena affrontato (*Kael won this time. "…" Fight again whenever you like.*) e l'entrata del boss quando tocca a lui.
- **La partita** è una partita online come le altre (`OnlineService`, `match.found` con `mode: "daily"`). La schermata passa al tavolo appena inizia e il tavolo torna lì alla fine. La lobby non si apre da sola per una sfida, e il promemoria "Resume your game" riporta alla sfida.
- **Al tavolo**: il personaggio è chiamato col suo nome (mai `@ai_kael`), col ritratto della sua iniziale. Se la partita ha condizioni, un pulsante *Rules* nel registro (nella finestra del registro, su telefono) le spiega a parole (`describeCondition`), per esempio *Your spells cost 1 more*.
- **Il personaggio parla** (`DailyCompanion`, come notifiche a comparsa): all'inizio, quando scende a 5 vita o meno, e alla fine. Ogni battuta una volta per partita, scelta dall'id della partita.
- La notifica `daily.reward` dice il pacchetto vinto e porta alla schermata.

## Il premio

- Il pacchetto viene coniato quando il boss è battuto, una sola volta per giocatore e per giorno, nella stessa transazione che registra la vittoria.
- Le carte hanno origine `reward` e sono **scambiabili e vendibili**: `reward` è in `TRADEABLE_ORIGINS` (`InventoryService`), e 13 è aggiornato.
- Il pacchetto si estrae con la stessa funzione dello shop (`drawPack`, stesse probabilità) da un seme casuale di 32 byte salvato in `daily_runs.reward_seed`: con il seme chiunque ritrova le stesse carte. Non è legato alle epoche come gli acquisti: un premio non si paga, quindi non c'è un pagamento da cui proteggere il seme.
- Il pacchetto va **sulla catena**: un record `m8tcg_grant` (03 §12b) con il giocatore, il giorno, il percorso, la tabella, il seme e le copie coniate (id, carta, numero di serie), nella stessa transazione che le conia. Lo stesso record c'è per il mazzo iniziale gratuito.
- Una notifica (`daily.reward`) avvisa del premio. Il client la mostrerà, e aprirà il pacchetto con l'animazione dello shop, in fase 3.

## Piano di lavoro

| Fase | Contenuto | Si prova |
|---|---|---|
| 1 | **SearchAi** nel motore, livello a scala e carattere, confronto con `simulate` — **fatta** | nell'allenamento, pulsante *Opponent* |
| 2 | **Server**: modulo `daily` (calendario del giorno, percorso, progressi, premio), posto dell'IA in `GameActor` — **fatta** | `test/daily/daily.test.js`, anche una partita vera contro l'IA del server |
| 2b | **Condizioni dei boss** nel motore, nel protocollo e nei dati — **fatta** | `test/domain/conditions.test.js` (motore), e la partita del boss in `test/daily/daily.test.js` |
| 3 | **Client**: schermata Sfide (scelta del percorso, i tre avversari, dialoghi, condizioni, apertura del pacchetto) — **fatta** | `test/rendering/dailyScene.test.js`, i telefoni in `compactLayouts.test.js`, e `test/e2e/dailyChallenge.test.js` (client vero contro server vero) |
| 4 | **Contenuti**: testi definitivi dei personaggi, ritratti (16), mazzi dei boss | — |
| 5 | **Bilanciamento** e lancio | partite vere |

## Fuori da questo documento

- Le carte singole restano nello shop per ora; il resto dell'economia non cambia.
- Lo starter gratuito resta com'è.
- Missioni, serie di giorni e campagna con storia sono passi successivi.
- I bot per la classificata hanno un documento loro: usano la stessa IA ma pongono problemi diversi (rating, jackpot, trasparenza).
