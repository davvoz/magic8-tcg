# 00 — Analisi del punto di partenza

**Stato:** proposta, 2026-09-24. Documenti collegati: [01 Architettura](01-architettura.md) · [02 Protocollo multiplayer e API](02-protocollo-multiplayer.md) · [03 Game Blockchain Protocol](03-game-blockchain-protocol.md) · [04 Modello dati](04-modello-dati.md) · [05 Threat model](05-threat-model.md) · [06 Roadmap](06-roadmap.md)

Questo documento risponde ai punti 1–3 del workflow: cosa c'è nel motore esistente, cosa riusare e cosa isolare, cosa si impara dai due progetti STEEM già in produzione. La sezione 4 elenca le richieste che vanno cambiate, e perché.

---

## 1. Il motore di magic8

magic8 (fork in questo repository, storia git preservata) è un motore di TCG in JavaScript vanilla (ES2022), zero dipendenze runtime, 431 test verdi al momento del fork. Le proprietà che contano per un gioco multiplayer autoritativo ci sono già quasi tutte:

| Proprietà | Dove | Perché è importante qui |
|---|---|---|
| **Dominio puro**: nessun `window`, `fetch`, `Date`, `Math.random`, timer o console in `domain/` | `test/architecture/dependencyRules.test.js` lo verifica | Lo stesso codice gira sul server autoritativo, nel client e nel verificatore dei replay |
| **Unico punto di mutazione**: `GameEngine.execute(command)`, transazionale (clone → esegui → commit) | `domain/game/GameEngine.js` | Un comando invalido non lascia mai lo stato a metà; base naturale per un attore per partita |
| **Comandi = dati semplici**, ri-validati strutturalmente (`validateCommandShape`) e semanticamente (handler) | `domain/commands/` | Il client può mandare qualunque cosa: il motore la rifiuta prima di toccare lo stato |
| **Determinismo**: stesso seed + stessi comandi ⇒ stesso stato | `SeededRandom`, contatore id in `GameState`, test `snapshotAndDeterminism` | Replay e verifica di una partita a partire dalla storia on-chain |
| **Snapshot per prospettiva** (mano avversaria e mazzi solo come conteggi) + redazione degli eventi privati | `GameSnapshot.createSnapshot`, `redactEventsFor` | Il server manda a ciascun giocatore solo ciò che può vedere; l'AI già oggi non può barare |
| **Contenuti data-driven e validati** (carte, mazzi, regole) | `data/`, `validate*.js` | Carte, prodotti e drop table diventano configurazione, non codice |
| **Limiti espliciti** (effetti per risoluzione, eventi per comando, dimensioni id) | `shared/limits.js`, `game-rules.json` | Difesa contro input ostili e cicli di trigger |

### 1.1 Cosa riusare così com'è

- `domain/` e `shared/` → pacchetto **`@magic8/engine`**. È il kernel delle regole; nessuna dipendenza da rete, DB o blockchain.
- `rendering/`, `input/` e il resto del client → pacchetto **`@magic8/client`**. Resta funzionante in locale contro l'AI (modalità allenamento) e diventa il client online sostituendo `MatchSession` con una sessione remota che rispetta la stessa interfaccia (snapshot + eventi redatti).
- `BasicAiController` → servirà anche al server (bot per l'allenamento, riempimento code a bassa affluenza). Oggi vive nel client; verrà spostato nel motore quando il server lo userà.

### 1.2 Cosa va cambiato prima dei soldi veri

| # | Problema | Gravità | Intervento |
|---|---|---|---|
| E1 | **Il PRNG ha uno stato di 32 bit** (mulberry32, seed intero). Un giocatore che conosce il proprio mazzo vede la mano iniziale e può provare offline tutti i 2³² seed (minuti su una CPU moderna): trovato il seed conosce l'ordine del proprio mazzo, la mano e il mazzo dell'avversario e ogni pescata futura. Nascondere il seed non basta: è lo spazio a essere troppo piccolo. | **Critica** | Sostituire con un generatore crittografico deterministico (ChaCha20, chiave 256 bit) dietro l'interfaccia `RandomSource`. Resta riproducibile, quindi il replay funziona. Seed derivato con commit-reveal (vedi 03 §5). |
| E2 | Gli id dei giocatori nel motore seguono `^[a-z0-9_]+$`; gli account STEEM contengono `.` e `-`. | Media | Il motore usa id di **posto** (`s0`, `s1`); la mappatura posto ↔ account vive fuori dal dominio (e nel protocollo on-chain). |
| E3 | Lo stato non ha una **forma canonica** hashabile (lo snapshot omnisciente omette l'ordine del mazzo e lo stato del RNG). | Media | Aggiungere al motore una proiezione `digest` completa e deterministica, usata per i `state_hash` salati. |
| E4 | `CardInstance` nel motore significa "carta dentro una partita". Il TCG ha bisogno di `CardInstance` = "copia posseduta da un utente". | Bassa (naming) | Due bounded context, due significati: nel contesto *Collection* `CardInstance` è la copia posseduta; nel motore resta l'istanza in partita. Il glossario in 01 §2 lo rende esplicito. Rinominare il tipo del motore (es. `MatchCard`) è possibile più avanti, ma tocca molti file senza cambiare comportamento. |
| E5 | Le definizioni delle carte non sono versionate: cambiare una carta cambierebbe il risultato del replay di partite vecchie. | Alta per la verificabilità | Ogni partita registra l'hash dei contenuti usati (regole + catalogo) e la versione del motore; i contenuti pubblicati sono immutabili e conservati per hash. |
| E6 | Manca un "timeout di turno": il motore non ha tempo (giustamente). | Media | I timer vivono nel game server, che al timeout invia un comando di sistema (`END_PHASE`/`END_TURN`/`CONCEDE`) registrato on-chain come mossa di sistema. |

---

## 2. Cosa si impara da Ggameplatform e cur8fun

Ho clonato e letto entrambi i repository. Riutilizziamo le **idee** di integrazione (chiamate Keychain, gestione nodi RPC); il **codice** di autenticazione non va copiato, per i motivi qui sotto.

### 2.1 Pattern da riusare

- **Keychain lato client**: `steem_keychain.requestSignBuffer(user, message, "Posting", cb)` per il login, `requestTransfer(user, to, amount.toFixed(3), memo, "STEEM", cb)` per i pagamenti, `requestBroadcast`/`requestCustomJson` per operazioni custom (cur8fun `WalletService`, `AuthService`).
- **Nodi RPC multipli con failover**: cur8fun misura latenza e affidabilità di ~10 nodi (`test-nodes-results.txt`: `api.steemit.com`, `api.justyy.com`, `api.moecki.online`, `api.pennsif.net`, `api.steemitdev.com`, …); alcuni rifiutano metodi specifici. Il nostro client RPC avrà lista di nodi configurabile, timeout, failover e verifica incrociata per le letture che decidono pagamenti.
- **Sessione in cookie httpOnly** con `Secure` dedotto da `X-Forwarded-Proto` dietro reverse proxy (Ggameplatform `user_auth.py`).
- **`condenser_api.*` via JSON-RPC** su HTTPS, senza librerie pesanti (Ggameplatform `steem_checker.py` usa `requests` diretto).

### 2.2 Problemi da **non** replicare (e da correggere anche lì)

| # | Dove | Problema | Conseguenza |
|---|---|---|---|
| R1 | Ggameplatform `backend/app/routers/users.py`, `/steem-auth` | **La firma Keychain non viene verificata** (commento: *"Per ora accettiamo la firma (da implementare con steem-python)"*). | Chiunque può autenticarsi come qualsiasi utente STEEM inviando `username` + un timestamp. Da correggere subito in produzione. |
| R2 | Ggameplatform `/steem-posting-key-auth` | Il **client invia la posting key privata al backend**. | Il server (e chiunque ne legga log, memoria, traffico) può agire come l'utente. Viola anche il requisito "mai chiavi private sul backend". |
| R3 | Ggameplatform `/steem-auth` | Il messaggio firmato è `username|timestamp` generato **dal client**, valido 5 minuti. | Replay entro la finestra, firma pre-calcolabile, nessun legame con il dominio: un sito malevolo può farsi firmare il messaggio e riusarlo. |
| R4 | Ggameplatform `frontend/js/auth.js` | Il risultato della firma viene usato come **password** in `/register` + `/login`. | La firma diventa una credenziale riutilizzabile per sempre. |
| R5 | Ggameplatform `user_auth.py` | JWT a 30 giorni, non revocabile; segreto di default `"change-this-to-random-secret-in-production"`. | Sessione rubata = 30 giorni di accesso; con il default, token forgiabili. |
| R6 | cur8fun `AuthService` | Il login Keychain è solo lato client (l'utente "è loggato" perché lo dice il browser). | Accettabile per un front-end di sola lettura, non per un servizio con inventario e pagamenti. |

Nel TCG il login è un **challenge–response con nonce generato dal server, monouso, con scadenza e legato all'origine**, e la firma viene verificata server-side ricostruendo la chiave pubblica e confrontandola con l'autorità posting dell'account letta dalla catena (vedi 01 §6 e 05).

---

## 3. Vincoli reali di STEEM (verificati sul sorgente `steemit/steem`)

| Vincolo | Valore | Fonte | Impatto sul design |
|---|---|---|---|
| Dimensione payload `custom_json` | **8192 byte** | `STEEM_CUSTOM_OP_DATA_MAX_LENGTH` | Una partita intera (100–300 mosse) non sta in un'operazione: servono batch e concatenazione. |
| Lunghezza id `custom_json` | 32 caratteri | `STEEM_CUSTOM_OP_ID_MAX_LENGTH` | Id brevi e versionati: `m8tcg_game`, `m8tcg_receipt`, `m8tcg_manifest`. |
| Intervallo di blocco | 3 s | `STEEM_BLOCK_INTERVAL` | Una mossa on-chain non può essere sul percorso critico del gioco: la latenza minima sarebbe 3 s, l'irreversibilità ~45–60 s. |
| Dimensione transazione | 64 KiB | `STEEM_MAX_TRANSACTION_SIZE` | Più operazioni per transazione sono possibili. |
| Scadenza massima transazione | 1 h | `STEEM_MAX_TIME_UNTIL_EXPIRATION` | Le transazioni non incluse scadono: il ribroadcast deve essere idempotente. |
| Memo di un transfer | 2048 byte, **pubblico** | `STEEM_MAX_MEMO_SIZE` | Il memo porta solo un riferimento opaco all'ordine, mai dati personali. |
| Limite di `custom_json` per account per blocco | esiste (portato a 5 con HF21) | discussione HF21 su steemit.com | Il broadcaster aggrega più record in un'unica operazione e può usare un pool di account. Il valore esatto è configurabile e va misurato sul nodo prima del lancio. |
| Costo | nessuna fee in token, ma consumo di **Resource Credits** proporzionale a dimensione ed esecuzione | RC plugin | L'account broadcaster ha bisogno di Steem Power (meglio **delegato** da un account freddo). Monitor RC e backpressure. |
| Chain id mainnet | `0000…0000` (sha256 vuoto), prefisso chiavi `STM` | `config.hpp` | Serve per firmare transazioni lato server (solo per gli account del gioco) e per distinguere reti. |

---

## 4. Richieste da modificare (con motivazione)

Mi hai chiesto di segnalare le scelte tecnicamente sbagliate, insicure o non scalabili. Queste sono le deviazioni dal brief, tutte riflesse nei documenti successivi.

1. **"Registrare su blockchain anche le mosse" → sì, ma come *input* in batch, non come una transazione per mossa.**
   Una transazione per mossa significa 3 s minimi di latenza per azione, centinaia di operazioni per partita, RC consumati linearmente e il limite di `custom_json` per blocco raggiunto con poche partite concorrenti. Il protocollo (03) registra on-chain i **comandi** dei giocatori (gli input), gli eventi di ciclo di vita e dei **checkpoint di stato salati**, raggruppati per turno o per dimensione. Gli effetti (danni, pescate, morti) non si registrano: sono deterministicamente ricalcolabili dal replay, e registrarli non aggiungerebbe verificabilità perché un verificatore deve comunque rigiocare la partita per fidarsi.

2. **I checkpoint di stato non possono essere hash "nudi".** Lo spazio delle mani possibili è piccolo (C(30,5) ≈ 142.000): chi conosce tutto il resto potrebbe provare tutte le mani e confrontare l'hash pubblicato. Ogni hash di stato è quindi **salato** con un segreto rivelato solo a fine partita.

3. **Il seed non può essere pubblico all'inizio** e non può essere scelto solo dal server. Commit-reveal: il server pubblica `H(segreto)` alla creazione, ciascun giocatore aggiunge entropia propria, il seed finale è `H(segreto ‖ entropia₀ ‖ entropia₁)`, il segreto viene rivelato a fine partita. Nessuno dei due lati può orientare i mescolamenti. Resta un'ipotesi di fiducia inevitabile in un modello server-autoritativo: durante la partita il server conosce le carte nascoste (lo dichiariamo esplicitamente, vedi 05).

4. **Firma delle mosse da parte dei giocatori: non con Keychain a ogni mossa.** Un popup Keychain per mossa rende il gioco inutilizzabile. Il protocollo prevede (versione 2) una **chiave di sessione effimera** generata nel browser e autorizzata una volta con Keychain all'ingresso in partita; ogni comando viene firmato con quella chiave e la firma finisce on-chain nel batch. Così il server non può inventare mosse di un giocatore. In v1 l'account broadcaster del gioco è l'unico firmatario e i giocatori si fidano del server per l'attribuzione delle mosse; il formato è già predisposto.

5. **Niente saldo interno custodito ("wallet del gioco") nella v1.** Ogni acquisto è un transfer on-chain diretto verso l'account shop. Un saldo interno ricaricabile/prelevabile trasforma il servizio in custode di fondi (rischio furti, obblighi normativi, riconciliazione contabile) senza benefici per le vendite.

6. **Chiavi del server separate per ruolo.** L'account che riceve i pagamenti (`shop`) non ha chiavi sul server: il backend lo legge soltanto. I rimborsi si firmano a mano con Keychain da un pannello admin. L'account che scrive la storia delle partite (`broadcaster`) ha **solo la posting key** sul server, nessun fondo, e riceve Steem Power in **delega** (una delega non può essere rubata, solo revocata).

7. **Pacchetti casuali venduti per criptovaluta.** Tecnicamente li rendiamo *provably fair* (commit-reveal per epoca, seed legato alla transazione di pagamento, probabilità pubblicate). Ma una loot box pagata in una valuta con valore di mercato, soprattutto se in futuro le carte saranno rivendibili, in alcune giurisdizioni (es. Belgio, Paesi Bassi) può ricadere nella disciplina del gioco d'azzardo, e la vendita in cripto ha implicazioni fiscali. Non è un parere legale: va verificato con un professionista **prima** di aprire il market al pubblico.

8. **Ricompense in-game con valore monetario** (es. carte rivendibili vinte in partita) creano incentivi a bot e a partite truccate tra account dello stesso utente. Nella v1 le ricompense non hanno valore di mercato; si rivalutano insieme all'anti-collusione (vedi 06, milestone 7).

9. **"Tutto validato on-chain" non significa "stato su blockchain".** Lo stato operativo vive nel DB (latenza, consistenza transazionale, lock); la blockchain è il **notaio**: rende la storia pubblica, ordinata, non modificabile a posteriori e verificabile da chiunque rigiocando la partita. Il documento 03 §9 descrive come si gestiscono divergenze DB/catena. *Aggiornamento 2026-09-27:* le partite non si pubblicano più (troppi dati e Resource Credits per partita); la catena resta il notaio di acquisti, pacchetti, scambi e vendite (03).
