# 03 — Game Blockchain Protocol (M8GBP) v1

**Stato:** specifica proposta, 2026-09-24. Implementazione di riferimento: `packages/protocol`.

Le parole DEVE / NON DEVE / DOVREBBE hanno il significato di RFC 2119.

## 1. Obiettivo e modello

Il protocollo rende la storia di ogni partita **pubblica, ordinata, concatenata crittograficamente e verificabile da chiunque**, senza mettere la blockchain sul percorso critico del gioco.

- Il **game server** è autoritativo: valida i comandi con il motore deterministico e mantiene lo stato operativo nel DB.
- Ogni evento significativo riceve un numero di sequenza e un hash concatenato al precedente, nella stessa transazione DB che lo registra.
- Gli eventi vengono raggruppati in **record** e pubblicati in `custom_json` STEEM da un account *broadcaster* del gioco.
- On-chain si registrano gli **input** (comandi dei giocatori e mosse forzate dal server), gli eventi di ciclo di vita e dei **checkpoint di stato salati**. Gli effetti (danni, pescate, morti, trigger) **non** si registrano: si ottengono rigiocando gli input con la stessa versione del motore e dei contenuti.
- A fine partita il server rivela il segreto da cui derivano seed, sali e impegni sui mazzi: da quel momento chiunque può rigiocare la partita e verificare che ogni checkpoint e il risultato finale derivino esattamente dalla sequenza on-chain.

### 1.1 Corrispondenza con gli eventi richiesti

| Evento richiesto | In M8GBP v1 | Perché |
|---|---|---|
| `GAME_CREATED`, `PLAYER_JOINED`, `GAME_STARTED`, `GAME_FINISHED`, `GAME_ABORTED`, `STATE_CHECKPOINT` | Eventi on-chain con lo stesso nome | Ciclo di vita e attestazioni |
| `MOVE`, `CARD_PLAYED`, `CARD_ATTACK`, `TURN_ENDED` | Un unico tipo `MOVE` il cui payload è il comando del motore (`PLAY_CARD`, `DECLARE_ATTACKERS`, `DECLARE_BLOCKERS`, `END_PHASE`, `END_TURN`, `CONCEDE`). Più `FORCED_MOVE` per le mosse fatte dal server per timeout/disconnessione. | Un tipo generico non richiede di cambiare il protocollo quando il motore aggiunge comandi (OCP). Il nome "umano" è il `type` del comando. |
| `TURN_STARTED`, `CARD_EFFECT` | **Derivati** dal replay, non pubblicati | Sono conseguenze deterministiche degli input: pubblicarli costa byte e RC senza aggiungere verificabilità (il verificatore deve rigiocare comunque). Il verificatore li produce nel log derivato. |

## 2. Operazioni on-chain

| `custom_json.id` | Firmatario | Autorità | Contenuto |
|---|---|---|---|
| `m8tcg_game` | un account del pool broadcaster | `required_posting_auths = [broadcaster]`, `required_auths = []` | Envelope di record di partita (§6) |
| `m8tcg_receipt` | un account del pool broadcaster | posting | Ricevute di fulfilment degli ordini (§12) |
| `m8tcg_manifest` | account **root** del progetto | `required_auths = [root]` (active, firmato a mano con Keychain) | Ancora di fiducia: pool broadcaster autorizzati, hash dei contenuti, impegni delle epoche dei pacchetti (§11) |

Chiunque può pubblicare un `custom_json` con id `m8tcg_game`. Un verificatore **DEVE** ignorare ogni operazione il cui firmatario non sia, al blocco dell'operazione, un broadcaster autorizzato dal manifest.

## 3. JSON canonico (M8CJ)

Ogni oggetto che viene hashato o pubblicato è serializzato in forma canonica. Regole (sottoinsieme di RFC 8785 JCS, più restrittivo):

1. Tipi ammessi: `null`, `true`/`false`, stringhe, **interi** in `[-(2⁵³-1), 2⁵³-1]`, array, oggetti. Nessun numero decimale, nessun `-0`, nessun `NaN`/`Infinity`.
2. Chiavi degli oggetti ordinate per unità di codice UTF-16 (l'ordinamento predefinito di JavaScript), nessuna chiave duplicata, nessun valore `undefined`.
3. Nessuno spazio bianco. Stringhe serializzate come `JSON.stringify` (ES2019+).
4. Profondità massima 16; per le operazioni on-chain dimensione massima 8192 byte UTF-8.
5. **Canonico sul filo:** il JSON pubblicato on-chain DEVE essere byte-per-byte uguale a `canonical(parse(json))`. Un payload non canonico è invalido. Questo elimina ambiguità tra parser diversi (chiavi duplicate, spazi, forme numeriche) e rende l'hash del record ricalcolabile da qualsiasi linguaggio.

## 4. Hashing

- Funzione: SHA-256. Rappresentazione: esadecimale minuscolo, 64 caratteri.
- **Separazione di dominio:** `H(tag, bytes) = SHA-256( utf8("m8tcg/v1/" + tag) ‖ 0x00 ‖ bytes )`. Un hash calcolato per un uso non può essere riutilizzato come hash di un altro uso.
- `hex(x)` = esadecimale minuscolo; `raw(h)` = i 32 byte rappresentati da `h`; `‖` = concatenazione.

Tag usati in v1: `genesis`, `event`, `seed-commit`, `seed`, `state-salt`, `state`, `deck-salt`, `deck`.

## 5. Casualità, impegni e segreto di partita

Alla creazione il server genera con un CSPRNG un **segreto di partita** `S` (32 byte), conservato cifrato nel DB e rivelato on-chain solo in `GAME_FINISHED`/`GAME_ABORTED`.

| Valore | Definizione | Pubblicato |
|---|---|---|
| impegno sul seed | `seed_c = H("seed-commit", S)` | in `GAME_CREATED` |
| entropia del giocatore | `E_k`: 16 byte casuali generati dal client del posto `k` **dopo** aver visto `seed_c` | in `PLAYER_JOINED` |
| seed del motore | `K = H("seed", S ‖ E_0 ‖ E_1 ‖ utf8(gameId))` (32 byte, chiave ChaCha20 del motore) | mai; ricalcolabile dopo la rivelazione di `S` |
| primo giocatore | `s0` se il bit meno significativo di `raw(K)[0]` è 0, altrimenti `s1` | in `GAME_STARTED` |
| sale dello stato | `salt = H("state-salt", S)` | mai; ricalcolabile |
| impegno sul mazzo del posto `k` | `deck_c_k = H("deck", raw(H("deck-salt", S ‖ byte(k))) ‖ utf8(canonical(deck_k)))` | in `GAME_CREATED` |

Proprietà:
- il server si impegna su `S` prima di conoscere `E_0`, `E_1`: non può scegliere un seed favorevole;
- i giocatori non conoscono `S`: la loro entropia non può orientare il seed;
- l'avversario non conosce il mazzo dell'altro fino alla fine, ma il server non può cambiarlo a partita iniziata (impegno);
- se un client non fornisce entropia entro il timeout, il server la genera e il payload lo dichiara (`src: "server"`).

**Ipotesi di fiducia dichiarata:** durante la partita il server conosce `K` e quindi le carte nascoste. Il protocollo rende verificabile a posteriori che le regole e la casualità non sono state manipolate, non impedisce a un operatore disonesto di rivelare informazioni in tempo reale. Eliminarla richiederebbe protocolli di "mental poker" con costi di latenza e complessità non giustificati nella v1.

## 6. Formato on-chain

### 6.1 Envelope (`custom_json` `m8tcg_game`)

```json
{"r":[<record>, <record>, …],"v":1}
```

- `v`: versione del protocollo (intero, `1`).
- `r`: da 1 a 16 record, eventualmente di partite diverse. L'envelope non ha un proprio hash: ogni record è autoverificabile.
- La serializzazione canonica dell'envelope DEVE essere ≤ 8192 byte.

### 6.2 Record

```json
{"e":[<event>, …],"g":"01j8x3r6h2qkq4w0v7m5a9c1dz","h":"<hex64>","p":"<hex64>","s":0,"ts":1790000000000,"v":1}
```

| Campo | Tipo | Regola |
|---|---|---|
| `v` | int | `1` |
| `g` | string | id partita: ULID in base32 Crockford minuscolo, 26 caratteri, `^[0-9a-hjkmnp-tv-z]{26}$` |
| `s` | int ≥ 0 | sequenza del record nella partita; contigua dal valore 0 |
| `p` | hex64 | testa della catena **prima** del primo evento del record (per `s = 0`: `genesis`) |
| `h` | hex64 | testa della catena **dopo** l'ultimo evento del record |
| `ts` | int | ora del server in millisecondi Unix alla chiusura del record (informativa; l'ordine lo danno `s` e `i`) |
| `e` | array | da 1 a 256 eventi, con `i` contigui |

### 6.3 Evento

```json
{"a":"s0","d":{"cardId":"c17","targets":["c3"],"type":"PLAY_CARD"},"i":42,"k":"MOVE","ms":183250,"t":7}
```

| Campo | Tipo | Significato |
|---|---|---|
| `i` | int ≥ 0 | **sequenza** dell'evento nella partita, contigua da 0. `event_id` = `g + ":" + i` (derivato, non pubblicato) |
| `k` | string | tipo di evento (§7) |
| `a` | string \| null | **attore**: posto (`"s0"`, `"s1"`) a cui l'evento si riferisce, `null` per gli eventi di sistema |
| `t` | int ≥ 0 | **tempo logico**: numero di turno del motore al momento dell'evento (0 prima dell'inizio) |
| `ms` | int ≥ 0 | millisecondi trascorsi dalla creazione della partita secondo l'orologio del server (serve ad auditare i timeout) |
| `d` | object | payload minimo del tipo di evento |

`g` e `v` non sono ripetuti in ogni evento (risparmio di byte): entrano nell'hash dell'evento prendendoli dal record.

### 6.4 Catena degli hash

```
genesis   = H("genesis", utf8(g))
body_i    = { a, d, g, i, k, ms, t, v }                       (oggetto canonico)
head_i    = H("event", raw(head_{i-1}) ‖ utf8(canonical(body_i)))     con head_{-1} = genesis
record.p  = head_{e[0].i - 1}
record.h  = head_{e[last].i}
```

`head_i` è l'`event_hash` dell'evento `i`. Gli hash dei singoli eventi non sono pubblicati (costerebbero 64 byte ciascuno senza aggiungere sicurezza, dato che il verificatore li ricalcola); `p` e `h` ancorano la catena a ogni record e permettono di rilevare record mancanti o alterati senza rigiocare la partita.

## 7. Tipi di evento v1

| `k` | `a` | `d` | Vincoli |
|---|---|---|---|
| `GAME_CREATED` | `null` | `{ "mode": "casual"\|"ranked", "net": "steem", "eng": "<versione motore>", "content": "<hex64>", "seats": [{"seat":"s0","acct":"alice"},{"seat":"s1","acct":"bob"}], "seed_c": "<hex64>", "deck_c": ["<hex64>","<hex64>"] }` | Deve essere l'evento `i = 0`. `content` è l'hash dei contenuti (regole + catalogo) usati. |
| `PLAYER_JOINED` | posto | `{ "ent": "<hex32>", "src": "client"\|"server" }` | Uno per posto, prima di `GAME_STARTED`. |
| `GAME_STARTED` | `null` | `{ "first": "s0"\|"s1" }` | Dopo entrambi i `PLAYER_JOINED`; `first` deve coincidere con il valore derivato da `K`. |
| `MOVE` | posto | comando del motore senza `playerId` (es. `{"type":"END_TURN"}`) | Il `playerId` del motore è `a`. |
| `FORCED_MOVE` | posto | `{ "cmd": <comando senza playerId>, "why": "timeout"\|"disconnect"\|"abandon" }` | Mossa eseguita dal server per conto del posto. `cmd.type` ammesso solo tra `END_PHASE`, `END_TURN`, `CONCEDE`, `DECLARE_ATTACKERS` con lista vuota, `DECLARE_BLOCKERS` con lista vuota. |
| `STATE_CHECKPOINT` | `null` | `{ "ver": <versione motore>, "sc": "<hex64>" }` | `sc = H("state", raw(salt) ‖ utf8(canonical(digest(stato))))`. Emesso a fine di ogni turno. |
| `GAME_FINISHED` | `null` | `{ "win": "s0"\|"s1"\|null, "why": "<motivo>", "ver": <int>, "sc": "<hex64>", "secret": "<hex64>", "decks": [[["card_id", n], …], [ … ]] }` | Ultimo evento. `decks` in forma compatta ordinata per id carta. |
| `GAME_ABORTED` | `null` | `{ "why": "<motivo>", "secret": "<hex64>", "decks": … }` | Ultimo evento; `decks` presente se la partita era iniziata. |

`digest(stato)` è una proiezione **completa** e deterministica dello stato del motore (ordine dei mazzi, stato del RNG, zone, contatori, combattimento, versione) definita nel motore (`getStateDigest()`), diversa dallo snapshot per prospettiva.

## 8. Regole di serializzazione deterministica lato server

1. Un evento riceve `i` e `head_i` **nella stessa transazione DB** in cui viene salvato il comando che lo genera; la riga di `games` è bloccata (`SELECT … FOR UPDATE`) o aggiornata con compare-and-set sulla versione.
2. Un record, una volta costruito, è **immutabile**: i suoi byte canonici sono salvati in `blockchain_events.payload` con chiave `(game_id, record_seq)`. Un ribroadcast pubblica esattamente gli stessi byte.
3. Il motore non usa orologi: `ms` e `ts` vengono dall'orologio del server, fuori dal motore, e non influenzano il replay.

## 9. Strategia di batching e checkpoint

**Chiusura di un record** per una partita, alla prima condizione vera:
- evento di ciclo di vita (`GAME_CREATED`+`PLAYER_JOINED`+`GAME_STARTED` insieme, `GAME_FINISHED`, `GAME_ABORTED`): subito;
- `STATE_CHECKPOINT` appena aggiunto (fine turno);
- 64 eventi in attesa;
- l'evento più vecchio in attesa ha più di 20 s;
- l'aggiunta del prossimo evento farebbe superare il budget di byte.

**Impacchettamento** (worker di broadcast, un giro per blocco, cioè ogni 3 s): prende i record pronti ordinati per priorità (ciclo di vita prima) ed età, li raggruppa in envelope ≤ 8192 byte, mette fino a `maxOpsPerTransaction` operazioni in una transazione e rispetta `maxCustomJsonPerAccountPerBlock` ruotando sul pool di broadcaster (partizionato per `gameId`, così i record di una partita escono in ordine dallo stesso account).

Tutti i parametri sono configurazione. Valori iniziali: 64 eventi, 20 s, 8192 byte, 1 operazione per account per blocco (prudente finché il limite reale non è misurato), 4 account nel pool.

## 10. Capacità, latenza e costi

**Dimensioni misurate sulla forma canonica** (partite complete giocate con il motore e registrate con `GameRecorder`, fixture `packages/protocol/test/fixtures/referenceGame.js`):

| Evento | Byte (medio / massimo) |
|---|---|
| `MOVE` `END_PHASE` | 71 / 73 |
| `MOVE` `PLAY_CARD` | 101 / 106 |
| `MOVE` `DECLARE_ATTACKERS` | 101 / 121 |
| `MOVE` `DECLARE_BLOCKERS` | 124 / 168 |
| `STATE_CHECKPOINT` | 145 / 148 |
| `PLAYER_JOINED` | 114 |
| `GAME_CREATED` | 468 |
| `GAME_FINISHED` (due mazzi da 12 voci) | 711 |

Su 30 partite simulate: in media **20 turni, 99 comandi, 17,8 KB** di record, cioè **3 operazioni `custom_json`** (massimo 4). Circa un quarto dei byte è intestazione dei record (`p`, `h`, `g`: un record per turno); record che coprono più turni la ridurrebbero a scapito della latenza di ancoraggio. Le partite simulate usano mosse casuali: partite reali con più giocate per turno saranno un po' più grandi.

Con 1 operazione per blocco per account (valore prudente) un broadcaster pubblica 28.800 operazioni al giorno, cioè **≈ 9.600 partite al giorno per account**; il pool scala linearmente. Il limite pratico non è lo spazio ma i **Resource Credits**: il consumo per byte dipende dallo stato della rete e va misurato (`rc_api.find_rc_accounts` prima/dopo) su mainnet prima del lancio. Il `RcMonitor` rallenta il flush (record più grandi, meno frequenti) sotto una soglia di RC e allarma sotto una soglia critica; il gioco non si ferma mai perché il DB resta la fonte operativa.

**Latenza:** nessun impatto sulla giocabilità. Un record è on-chain 3–6 s dopo la fine del turno e irreversibile dopo altri ~45–60 s. Il risultato di una partita è definitivo on-chain circa un minuto dopo la fine.

**Costo:** nessuna fee in STEEM; serve Steem Power sugli account broadcaster, idealmente **delegato** da un account freddo.

## 11. Manifest (ancora di fiducia)

Pubblicato dall'account root con la chiave active (Keychain, manualmente). Payload:

```json
{"kind":"broadcasters","accounts":["m8tcg.b1","m8tcg.b2"],"from_block":95000000,"v":1}
{"kind":"content","hash":"<hex64>","eng":"0.1.0","uri":"https://…/content/<hash>.json","v":1}
{"kind":"pack_epoch","epoch":3,"commit":"<hex64>","v":1}
{"kind":"pack_epoch_reveal","epoch":3,"secret":"<hex64>","v":1}
```

Un verificatore conosce solo il nome dell'account root (configurazione). Da lì ricava quali broadcaster erano validi a ogni blocco: una chiave compromessa si revoca pubblicando un nuovo manifest.

I contenuti sono pubblicati anche come post STEEM (fino a 64 KB) o scaricabili per hash: il verificatore DEVE controllare che l'hash dei contenuti ottenuti coincida con `content` di `GAME_CREATED`.

**Identità dei contenuti.** Il payload è il JSON canonico di `{"cardSets":[…],"deckRules":{…},"gameRules":{…},"preconDecks":[…]}` (set di carte e mazzi nell'ordine dei file, per nome). L'hash è `content = H("content", utf8(payload))`. Il server serve il payload identico byte per byte in `GET /api/content/<hash>`; chi lo scarica ricalcola l'hash e lo accetta solo se è JSON canonico (`openContent` in `@magic8/protocol`). Il bundle attuale pesa circa 28 KB e sta in un post STEEM.

## 12. Ricevute di fulfilment (`m8tcg_receipt`)

```json
{"cards":[["<uuid>","ember_imp",1042,"s"],["<uuid>","pyre_drake",77,"f"]],"items":[{"p":"booster_core","q":1}],"o":"<orderId>","packs":[{"epoch":3,"idx":0}],"part":[1,1],"pay":{"net":"steem","tx":"<txId>"},"u":"alice","v":1}
```

Collega pubblicamente pagamento, ordine e copie coniate (id, definizione, numero di serie, finitura). Oltre 8 KB la ricevuta si divide in parti (`part: [n, totale]`). Nota di privacy: rende pubblici gli acquisti, che però sono già pubblici perché il pagamento è on-chain.

## 13. Validazione server-side

Prima che un evento venga creato:
1. il comando arriva su una connessione autenticata; l'utente deve occupare il posto indicato (il `playerId` del client viene **sovrascritto** con il posto dell'utente, mai creduto);
2. `expectedVersion` uguale alla versione corrente della partita, altrimenti `STALE_VERSION`;
3. `commandId` (UUID del client) non già visto per quella partita, altrimenti si restituisce l'ack salvato (idempotenza);
4. il motore valida forma e regole; un comando rifiutato non produce eventi;
5. l'evento viene costruito, hashato e salvato atomicamente.

## 14. Verifica di una partita dalla catena

Algoritmo del verificatore (implementato in `packages/protocol`, usabile da CLI, dal server e nel browser):

1. **Raccolta.** Leggi le operazioni `m8tcg_manifest` dell'account root e costruisci la mappa `blocco → broadcaster autorizzati`. Leggi le operazioni `m8tcg_game` dei broadcaster (dallo storico degli account, oppure dagli id di transazione forniti dal server come indice: in entrambi i casi la catena degli hash rileva omissioni). Considera solo blocchi **irreversibili**.
2. **Filtro.** Scarta operazioni con firmatario non autorizzato a quel blocco, con `required_auths` non vuoto o con JSON non canonico. Scarta envelope con `v` non supportato.
3. **Validazione di schema** di ogni record ed evento (§6–7), con limiti di dimensione e profondità.
4. **Raggruppamento** per `g`; ordinamento per `s` (non per blocco: l'ordine di inclusione può differire).
5. **Duplicati:** due record con stessi `(g, s)` e byte identici → duplicato benigno (ribroadcast), se ne tiene uno. Stessi `(g, s)` con contenuto diverso → **FORK**: partita invalida, allarme.
6. **Continuità:** `s` contigui da 0; `record.p` uguale a `record.h` del record precedente; `i` contigui tra un record e il successivo. Buchi → **INCOMPLETE** (con l'indice mancante).
7. **Catena:** ricalcola `head_i` per ogni evento; deve coincidere con `h` di ogni record. Discrepanza → **TAMPERED**.
8. **Ciclo di vita:** `i = 0` è `GAME_CREATED`; `PLAYER_JOINED` per ogni posto; `GAME_STARTED`; l'ultimo evento è `GAME_FINISHED` o `GAME_ABORTED`; nessun evento dopo la fine. Altrimenti **IN_PROGRESS** o **MALFORMED**.
9. **Rivelazioni:** `H("seed-commit", secret) = seed_c`; impegni sui mazzi ricalcolati uguali a `deck_c`; hash dei contenuti uguale a `content`; `first` uguale al valore derivato.
10. **Replay:** crea il motore con contenuti e versione dichiarati, seed `K`, mazzi rivelati; applica in ordine ogni `MOVE`/`FORCED_MOVE` (policy `FORCED_MOVE` verificata). Ogni comando DEVE essere accettato. A ogni `STATE_CHECKPOINT` il digest salato DEVE coincidere con `sc`. **REPLAY_MISMATCH** altrimenti.
11. **Esito:** alla fine lo stato del motore DEVE essere concluso con vincitore e motivo uguali a `GAME_FINISHED` e digest uguale a `sc` finale.

Esito complessivo: `VALID` oppure uno dei codici sopra, con l'indice del primo evento problematico. Il verificatore produce anche il log derivato completo (turni, effetti, danni) per replay visivo e spettatori.

## 15. Anomalie e come vengono gestite

| Anomalia | Dove si rileva | Gestione |
|---|---|---|
| Evento **duplicato** (stesso comando reinviato) | Server, `commandId` univoco per partita | Si restituisce l'ack originale; nessun nuovo evento |
| Record **duplicato** on-chain (ribroadcast) | Verificatore, riconciliatore | Byte identici: ignorato |
| Record **mancante** on-chain | Riconciliatore (DB ha `(g,s)` non visto on-chain dopo la scadenza della tx) | Ribroadcast degli stessi byte; allarme dopo N tentativi |
| Record **fuori ordine** (incluso in un blocco precedente al record `s-1`) | Verificatore | Legittimo: l'ordine è `s`, non il blocco |
| **Replay** di un record in un'altra partita o versione | Hash | `g` e `v` sono nell'hash di ogni evento, `g` nel genesis: il record non si concatena |
| Operazione **falsificata** da un altro account | Verificatore | Firmatario non autorizzato dal manifest: ignorata |
| Operazione valida ma **sconosciuta al DB** | Riconciliatore | **Allarme di sicurezza** (chiave del broadcaster compromessa o bug): revoca via manifest |
| **Fork**: stessi `(g, s)`, contenuti diversi | Verificatore, riconciliatore | Partita marcata contestata; i risultati collegati (classifica, ricompense) vengono congelati |
| Transazione **inclusa e poi persa** (micro-fork prima dell'irreversibilità) | Riconciliatore | Lo stato diventa `IRREVERSIBLE` solo sotto il blocco irreversibile; se la tx sparisce, ribroadcast |

## 16. Divergenza tra DB e blockchain

Ogni record ha nel DB uno stato di ancoraggio:

```
BUILT ──► BROADCAST (txId, expiration) ──► INCLUDED (block) ──► IRREVERSIBLE
   ▲              │ scaduta / rifiutata              │ sparita prima di LIB
   └──────────────┴──────────────────────────────────┘ (ribroadcast, stessi byte)
```

Il `ChainReconciler` confronta periodicamente i record del DB con le operazioni dei broadcaster lette dalla catena (cursore persistente):

| Stato | Significato | Azione |
|---|---|---|
| `MATCH` | stessi `(g, s)` e stessi byte | nessuna |
| `MISSING_ON_CHAIN` | nel DB, non on-chain dopo la scadenza | ribroadcast |
| `UNKNOWN_ON_CHAIN` | on-chain dal nostro broadcaster, assente nel DB | allarme di sicurezza |
| `CONFLICT` | stessi `(g, s)`, byte diversi | allarme, partita contestata |

Regola fondamentale: **gli eventi nel DB sono append-only** (nessun `UPDATE`/`DELETE` concesso all'utente applicativo sulla tabella, vedi 04). Una volta ancorato, un evento non può più cambiare nemmeno nel DB; la catena è la versione "notarile" di ciò che il DB ha registrato.

## 17. Versionamento

- `v` (protocollo) cambia solo con modifiche incompatibili di formato o hashing; i verificatori supportano tutte le versioni pubblicate.
- `eng` e `content` fissano il comportamento del replay: il server mantiene disponibili tutte le versioni del motore e dei contenuti mai usate in partite pubblicate.

## 18. Evoluzioni previste (v2)

- **Firma delle mosse dei giocatori** con chiave di sessione effimera: al join il client genera una coppia di chiavi secp256k1 non esportabile, la autorizza con un `requestSignBuffer` Keychain (`"m8tcg session <gameId> <pubkey>"`), e firma ogni comando; il campo `sig` del `MOVE` porta la firma. Il server non può più attribuire a un giocatore una mossa che non ha fatto.
- **Ack firmati dal server**: ogni ack include `head_i` firmato; il giocatore conserva una prova crittografica di ciò che il server ha accettato e può dimostrare una divergenza con la catena.
