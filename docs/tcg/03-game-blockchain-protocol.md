# 03 — Protocollo: eventi di partita e record on-chain (M8GBP)

**Stato:** aggiornato il 2026-09-27.
- **Partite:** la storia di una partita resta nel database del server: eventi concatenati con hash e append-only (§6–8, §14). Sulla catena va solo il **risultato** a fine partita, un record di circa 200 byte che si impegna su tutta la storia (§9).
- **Sulla catena vanno anche:**
  - il manifest (§11);
  - le epoche dei pacchetti (§11.1);
  - le ricevute degli acquisti (§12);
  - gli scambi (13) e le vendite (14).
- **Implementazione di riferimento:**
  - `packages/protocol`: formato, hashing, record, verifica dei pacchetti;
  - `packages/steem`: transazioni;
  - `packages/server`: moduli gameplay (eventi) e chain (outbox, pubblicazione, riconciliazione).

*Prima* (M5–M7, fino al 2026-09-26) anche le partite erano sigillate in record e pubblicate come `custom_json` `m8tcg_game`, verificabili da chiunque rigiocandole dalla catena. È stato tolto perché ogni partita produce decine di record e fino a ~18 KB on-chain:
- i Resource Credits necessari crescono con le partite giocate;
- la catena si riempie di dati che servono a pochi;
- il database del server è comunque la fonte operativa.

I record `m8tcg_game` già pubblicati restano sulla catena, ma il codice che li verificava è stato rimosso. Al loro posto, dal 2026-09-27, ogni partita finita pubblica un solo `m8tcg_result` (§9).

Le parole DEVE / NON DEVE / DOVREBBE hanno il significato di RFC 2119.

## 1. Obiettivo e modello

- Il **game server** è autoritativo: valida i comandi con il motore deterministico e mantiene lo stato nel DB.
- Ogni evento significativo di una partita riceve un numero di sequenza e un hash concatenato al precedente, nella stessa transazione DB che lo registra (§6.4). La catena degli hash rende rilevabile ogni modifica successiva di un evento.
- Si registrano gli **input** (comandi dei giocatori e mosse forzate dal server), gli eventi di ciclo di vita e dei **checkpoint di stato salati**. Gli effetti (danni, pescate, morti, trigger) **non** si registrano: si ottengono rigiocando gli input con la stessa versione del motore e dei contenuti.
- A fine partita il server salva nell'ultimo evento il segreto da cui derivano seed, sali e impegni sui mazzi (§5).
- Sulla **catena** va ciò che cambia di mano o che serve a verificare un acquisto (pagamenti, ricevute, epoche dei pacchetti, scambi, vendite) e, per ogni partita finita, il suo risultato con l'hash finale della storia (§9).

### 1.1 Corrispondenza con gli eventi richiesti

| Evento richiesto | In M8GBP | Perché |
|---|---|---|
| `GAME_CREATED`, `PLAYER_JOINED`, `GAME_STARTED`, `GAME_FINISHED`, `GAME_ABORTED`, `STATE_CHECKPOINT` | Eventi con lo stesso nome | Ciclo di vita e attestazioni |
| `MOVE`, `CARD_PLAYED`, `CARD_ATTACK`, `TURN_ENDED` | Un unico tipo `MOVE`, il cui payload è il comando del motore (`PLAY_CARD`, `DECLARE_ATTACKERS`, `DECLARE_BLOCKERS`, `END_PHASE`, `END_TURN`, `CONCEDE`). Più `FORCED_MOVE` per le mosse fatte dal server per timeout o disconnessione. | Un tipo generico non richiede di cambiare il protocollo quando il motore aggiunge comandi (OCP). Il nome "umano" è il `type` del comando. |
| `TURN_STARTED`, `CARD_EFFECT` | **Derivati** dal replay, non registrati | Sono conseguenze deterministiche degli input. |

## 2. Operazioni on-chain

| `custom_json.id` | Firmatario | Autorità | Contenuto |
|---|---|---|---|
| `m8tcg_receipt` | un account del pool broadcaster | `required_posting_auths = [broadcaster]`, `required_auths = []` | Ricevute di fulfilment degli ordini (§12) |
| `m8tcg_epoch` | un account del pool broadcaster | posting | Impegno e rivelazione delle epoche dei pacchetti (§11.1) |
| `m8tcg_trade` | un account del pool broadcaster | posting | Scambi carta contro carta tra giocatori (13) |
| `m8tcg_sale` | un account del pool broadcaster | posting | Vendite di copie tra giocatori (14) |
| `m8tcg_result` | un account del pool broadcaster | posting | Risultato di una partita finita, con l'hash finale della sua storia (§9) |
| `m8tcg_manifest` | account **root** del progetto | `required_auths = [root]` (active, firmato a mano con Keychain) | Ancora di fiducia: pool broadcaster autorizzati e chiavi degli ack (§11) |

Chiunque può pubblicare un `custom_json` con uno di questi id. Un verificatore **DEVE** ignorare ogni operazione il cui firmatario non sia, al blocco dell'operazione, un broadcaster autorizzato dal manifest.

Ogni record è un'operazione a sé: il suo JSON canonico è esattamente il `json` dell'operazione (≤ 8192 byte; una ricevuta più grande si divide in parti, §12).

## 3. JSON canonico (M8CJ)

Ogni oggetto che viene hashato o pubblicato è serializzato in forma canonica. Regole (sottoinsieme di RFC 8785 JCS, più restrittivo):

1. Tipi ammessi: `null`, `true`/`false`, stringhe, **interi** in `[-(2⁵³-1), 2⁵³-1]`, array, oggetti. Nessun numero decimale, nessun `-0`, nessun `NaN`/`Infinity`.
2. Chiavi degli oggetti ordinate per unità di codice UTF-16 (l'ordinamento predefinito di JavaScript), nessuna chiave duplicata, nessun valore `undefined`.
3. Nessuno spazio bianco. Stringhe serializzate come `JSON.stringify` (ES2019+).
4. Profondità massima 16; per le operazioni on-chain dimensione massima 8192 byte UTF-8.
5. **Canonico sul filo:** il JSON pubblicato on-chain DEVE essere byte per byte uguale a `canonical(parse(json))`. Un payload non canonico è invalido. Questo elimina ambiguità tra parser diversi (chiavi duplicate, spazi, forme numeriche) e rende gli hash ricalcolabili da qualsiasi linguaggio.

## 4. Hashing

- Funzione: SHA-256. Rappresentazione: esadecimale minuscolo, 64 caratteri.
- **Separazione di dominio:** `H(tag, bytes) = SHA-256( utf8("m8tcg/v1/" + tag) ‖ 0x00 ‖ bytes )`. Un hash calcolato per un uso non può essere riutilizzato come hash di un altro uso.
- `hex(x)` = esadecimale minuscolo; `raw(h)` = i 32 byte rappresentati da `h`; `‖` = concatenazione.

Tag usati: `genesis`, `event`, `seed-commit`, `seed`, `state-salt`, `state`, `content`, `deck-salt`, `deck`, `drop-table`, `pack-epoch`. Il seed di un pacchetto è un HMAC, non un hash con tag: `HMAC-SHA256(segreto_epoca, utf8("m8tcg/v1/pack") ‖ 0x00 ‖ utf8(canonical([orderId, txId, indice])))` (`packSeed` in `@magic8/protocol`).

## 5. Casualità, impegni e segreto di partita

Alla creazione il server genera con un CSPRNG un **segreto di partita** `S` (32 byte). Lo conserva cifrato nel DB e lo scrive in chiaro solo in `GAME_FINISHED`/`GAME_ABORTED`.

| Valore | Definizione | Registrato |
|---|---|---|
| impegno sul seed | `seed_c = H("seed-commit", S)` | in `GAME_CREATED` |
| entropia del giocatore | `E_k`: 16 byte casuali generati dal client del posto `k` **dopo** aver visto `seed_c` | in `PLAYER_JOINED` |
| seed del motore | `K = H("seed", S ‖ E_0 ‖ E_1 ‖ utf8(gameId))` (32 byte, chiave ChaCha20 del motore) | mai; ricalcolabile dopo la rivelazione di `S` |
| primo giocatore | `s0` se il bit meno significativo di `raw(K)[0]` è 0, altrimenti `s1` | in `GAME_STARTED` |
| sale dello stato | `salt = H("state-salt", S)` | mai; ricalcolabile |
| impegno sul mazzo del posto `k` | `deck_c_k = H("deck", raw(H("deck-salt", S ‖ byte(k))) ‖ utf8(canonical(deck_k)))` | in `GAME_CREATED` |

Proprietà:
- il server si impegna su `S` prima di conoscere `E_0`, `E_1`, e i giocatori vedono `seed_c` prima di mandare la loro entropia;
- i giocatori non conoscono `S`: la loro entropia non può orientare il seed;
- l'avversario non conosce il mazzo dell'altro fino alla fine;
- se un client non fornisce entropia entro il timeout, il server la genera e il payload lo dichiara (`src: "server"`).

**Ipotesi di fiducia dichiarata:** durante la partita il server conosce `K` e quindi le carte nascoste. La storia completa è solo nel DB: nessuno può rigiocare una partita dalla catena. Il risultato pubblicato (§9) però fissa la testa della catena degli hash appena la partita finisce, quindi da quel momento il server non può cambiare nessun evento senza che la storia smetta di dare quell'hash. Gli ack firmati (11) fissano le teste intermedie.

## 6. Formato degli eventi

### 6.1 Evento

```json
{"a":"s0","d":{"cardId":"c17","targets":["c3"],"type":"PLAY_CARD"},"i":42,"k":"MOVE","ms":183250,"t":7}
```

| Campo | Tipo | Significato |
|---|---|---|
| `i` | int ≥ 0 | **sequenza** dell'evento nella partita, contigua da 0. `event_id` = `gameId + ":" + i` |
| `k` | string | tipo di evento (§7) |
| `a` | string \| null | **attore**: posto (`"s0"`, `"s1"`) a cui l'evento si riferisce, `null` per gli eventi di sistema |
| `t` | int ≥ 0 | **tempo logico**: numero di turno del motore al momento dell'evento (0 prima dell'inizio) |
| `ms` | int ≥ 0 | millisecondi trascorsi dalla creazione della partita secondo l'orologio del server (serve ad auditare i timeout) |
| `d` | object | payload minimo del tipo di evento |

L'id della partita `g` e la versione del protocollo di gioco `v` non sono nell'evento: entrano nel suo hash prendendoli dalla partita. Lo schema è validato da `validateEvent` in `@magic8/protocol`.

### 6.2 Catena degli hash

```
genesis   = H("genesis", utf8(g))
body_i    = { a, d, g, i, k, ms, t, v }                       (oggetto canonico)
head_i    = H("event", raw(head_{i-1}) ‖ utf8(canonical(body_i)))     con head_{-1} = genesis
```

`head_i` è l'`event_hash` dell'evento `i`, salvato con l'evento in `game_events.head`. Gli ack firmati (11) citano `seq` e `head` dell'ultimo evento prodotto da un comando: l'hash impegna tutta la storia fino a quel punto.

## 7. Tipi di evento

| `k` | `a` | `d` | Vincoli |
|---|---|---|---|
| `GAME_CREATED` | `null` | `{ "mode": "casual"\|"ranked", "net": "steem", "eng": "<versione motore>", "content": "<hex64>", "seats": [{"seat":"s0","acct":"alice"},{"seat":"s1","acct":"bob"}], "seed_c": "<hex64>", "deck_c": ["<hex64>","<hex64>"] }` | Deve essere l'evento `i = 0`. `content` è l'hash dei contenuti (regole + catalogo) usati. |
| `PLAYER_JOINED` | posto | `{ "ent": "<hex32>", "src": "client"\|"server" }` | Uno per posto, prima di `GAME_STARTED`. |
| `GAME_STARTED` | `null` | `{ "first": "s0"\|"s1" }` | Dopo entrambi i `PLAYER_JOINED`; `first` deve coincidere con il valore derivato da `K`. |
| `MOVE` | posto | comando del motore senza `playerId` (es. `{"type":"END_TURN"}`) | Il `playerId` del motore è `a`. In v2: `{ "cid", "cmd", "ev", "sig" }`, firmato dal giocatore (12). |
| `SESSION` (solo v2) | posto | `{ "key": "<P-256 non compresso>", "auth": "<firma Keychain>" }` | La chiave con cui il posto firma le mosse da qui in poi, autorizzata dall'account (12). |
| `FORCED_MOVE` | posto | `{ "cmd": <comando senza playerId>, "why": "timeout"\|"disconnect"\|"abandon" }` | Mossa eseguita dal server per conto del posto. `cmd.type` ammesso solo tra `END_PHASE`, `END_TURN`, `CONCEDE`, `DECLARE_ATTACKERS` con lista vuota, `DECLARE_BLOCKERS` con lista vuota. |
| `STATE_CHECKPOINT` | `null` | `{ "ver": <versione motore>, "sc": "<hex64>" }` | `sc = H("state", raw(salt) ‖ utf8(canonical(digest(stato))))`. Emesso a fine di ogni turno. |
| `GAME_FINISHED` | `null` | `{ "win": "s0"\|"s1"\|null, "why": "<motivo>", "ver": <int>, "sc": "<hex64>", "secret": "<hex64>", "decks": [[["card_id", n], …], [ … ]] }` | Ultimo evento. `decks` in forma compatta ordinata per id carta. |
| `GAME_ABORTED` | `null` | `{ "why": "<motivo>", "secret": "<hex64>", "decks": … }` | Ultimo evento; `decks` presente se la partita era iniziata. |

`digest(stato)` è una proiezione **completa** e deterministica dello stato del motore (ordine dei mazzi, stato del RNG, zone, contatori, combattimento, versione) definita nel motore (`getStateDigest()`), diversa dallo snapshot per prospettiva.

## 8. Regole di serializzazione deterministica lato server

1. Un evento riceve `i` e `head_i` **nella stessa transazione DB** in cui viene salvato il comando che lo genera; la riga di `games` è aggiornata con compare-and-set sulla versione.
2. Gli eventi sono **append-only**: nessun `UPDATE`/`DELETE` concesso all'utente applicativo sulla tabella (04).
3. Il motore non usa orologi: `ms` viene dall'orologio del server, fuori dal motore, e non influenza il replay. Il server ricostruisce una partita dopo un riavvio rigiocando i suoi eventi.

## 9. Risultato di una partita (`m8tcg_result`)

```json
{"a":["alice","bob"],"g":"01j8x3r6h2qkq4w0v7m5a9c1dz","h":"<hex64>","m":"ranked","n":131,"r":"concede","v":1,"w":"s1"}
```

| Campo | Significato |
|---|---|
| `g` | id della partita |
| `a` | account dei due posti, in ordine (`s0`, `s1`) |
| `m` | modalità: `casual` o `ranked` |
| `w` | posto vincitore, `null` per un pareggio |
| `r` | motivo della fine (come in `GAME_FINISHED.why`) |
| `n` | sequenza dell'ultimo evento (`GAME_FINISHED`) |
| `h` | `head_n`: la testa della catena degli hash dopo l'ultimo evento (§6.2) |

- **Quando:** il record entra nell'outbox nella **stessa transazione DB** che salva `GAME_FINISHED`, quindi esiste esattamente per le partite finite. Un indice unico impedisce un secondo risultato per la stessa partita. Parte al giro successivo del broadcaster, come ricevute e scambi (§16).
- **Cosa prova:** `h` impegna ogni evento della partita, dal `GAME_CREATED` alla fine (mosse, firme v2, checkpoint, segreto rivelato, mazzi). Dopo la pubblicazione il server non può cambiare la storia nel suo DB senza che smetta di dare `h`. Un ack firmato (11) nomina la testa a un evento intermedio: la storia che il server mostra deve passare anche per quella.
- **Cosa non prova da solo:** chi non ha la storia non può rigiocare la partita. Il record rende pubblici e verificabili esito, partecipanti e modalità (la classifica si può ricalcolare dalla catena, 09), non le singole mosse.
- **Costo:** un'operazione di circa 200 byte per partita, contro i ~18 KB e le 3–4 operazioni della pubblicazione completa usata fino al 2026-09-26 (in media 20 turni e 99 comandi per partita).
- **Implementazione:** `gameResultRecord` / `parseGameResultRecord` in `@magic8/protocol`; `GameActor` lo accoda alla fine della partita.

## 10. (rimosso)

La sigillatura della storia in record e la sua pubblicazione completa sono state tolte il 2026-09-27 (vedi lo stato in cima).

## 11. Manifest (ancora di fiducia)

Pubblicato dall'account root con la chiave active (Keychain, manualmente: pagina `/manifest.html`). Payload (canonico, `broadcastersManifest` in `@magic8/protocol`):

```json
{"accounts":["m8tcg-b1","m8tcg-b2"],"from_block":95000000,"kind":"broadcasters","v":1}
```

Un verificatore conosce solo il nome dell'account root (configurazione). Da lì ricava quali broadcaster erano validi a ogni blocco: una chiave compromessa si revoca pubblicando un nuovo manifest (una lista vuota revoca tutti).

**Nessuna autorizzazione retroattiva.** Un manifest vale dal blocco `max(from_block, blocco del manifest)`: un record incluso prima è invalido per sempre. Per questo il server (`ManifestWatcher`) legge i manifest del root come un verificatore, e un broadcaster pubblica solo quando il manifest lo autorizza **al blocco irreversibile**. Fino ad allora i suoi record aspettano nell'outbox. Il manifest va quindi pubblicato prima di dare le chiavi al server.

Un secondo tipo, `ack_keys`, nomina le chiavi pubbliche con cui il server firma gli ack (11).

*Nomi degli account:* su STEEM ogni parte di un nome separata da punti deve avere almeno 3 caratteri: `verdu.green.b1` non è valido, `verdu.green-b1` sì.

### 11.1 Epoche dei pacchetti (`m8tcg_epoch`)

```json
{"commit":"<hex64>","epoch":3,"kind":"pack_epoch","v":1}
{"epoch":3,"kind":"pack_epoch_reveal","secret":"<hex64>","v":1}
```

Pubblicati dal pool broadcaster, non dal root: la pubblicazione è automatica e la fiducia passa comunque dal root, che autorizza i broadcaster.
- L'impegno entra nell'outbox nella stessa transazione DB che apre l'epoca.
- La rivelazione entra nella stessa transazione che segna l'epoca come rivelata, una volta sola.
- Un verificatore dei pacchetti controlla che l'impegno sia on-chain in un blocco precedente al pagamento dell'ordine.

**Identità dei contenuti.** Il payload è il JSON canonico di `{"cardSets":[…],"deckRules":{…},"gameRules":{…},"preconDecks":[…]}` (set di carte e mazzi nell'ordine dei file, per nome). L'hash è `content = H("content", utf8(payload))` ed è quello citato in `GAME_CREATED`. Il server serve il payload identico byte per byte in `GET /api/content/<hash>`; chi lo scarica ricalcola l'hash e lo accetta solo se è JSON canonico (`openContent` in `@magic8/protocol`).

## 12. Ricevute di fulfilment (`m8tcg_receipt`)

```json
{"cards":[["<uuid>","ember_imp",1042],["<uuid>","pyre_drake",77]],"items":[{"p":"booster_core","q":1}],"o":"<orderId>","packs":[{"epoch":3,"idx":0,"t":"<hash della drop table>"}],"part":[1,1],"pay":{"net":"steem","tx":"<txId>"},"u":"alice","v":1}
```

Collega pubblicamente pagamento, ordine e copie coniate (id, definizione, numero di serie).
- `t` è `H("drop-table", canonical(tabella risolta))`: la tabella con i pool di carte per rarità, pubblicata da `GET /api/products`.
- Rivelato il segreto dell'epoca (`GET /api/pack-epochs`), chiunque ricalcola ogni pacchetto con `drawPack(tabella, packSeed(…))` e lo confronta con le carte della ricevuta (`buildReceipts`, `drawPack` e `packSeed` in `@magic8/protocol`).
- Oltre 8 KB la ricevuta si divide in parti (`part: [n, totale]`).
- Nota di privacy: rende pubblici gli acquisti, che però sono già pubblici perché il pagamento è on-chain.

**Verifica dalla catena (M6):** `verifyOrderOnChain` in `@magic8/protocol` e `node tools/verify-order.js <ordine> --server …`. Leggono la ricevuta (tutte le parti) e l'impegno e la rivelazione dell'epoca dagli storici dei broadcaster autorizzati. Poi controllano:
- che l'impegno sia in un blocco precedente alla ricevuta e al pagamento;
- che il segreto rivelato corrisponda all'impegno;
- che la drop table abbia l'hash `t`.

Infine ripescano ogni pacchetto: ogni carta estratta deve essere tra quelle coniate. Il server vende pacchetti solo dopo che l'impegno dell'epoca è sulla catena, quindi il segreto è fissato prima che esista il txId che genera i pacchetti.

## 13. Validazione server-side

Prima che un evento venga creato:
1. il comando arriva su una connessione autenticata; l'utente deve occupare il posto indicato (il `playerId` del client viene **sovrascritto** con il posto dell'utente, mai creduto);
2. `expectedVersion` uguale alla versione corrente della partita, altrimenti `STALE_VERSION`;
3. `commandId` (UUID del client) non già visto per quella partita, altrimenti si restituisce l'ack salvato (idempotenza);
4. in v2, la mossa porta la firma della chiave di sessione del posto (12);
5. il motore valida forma e regole; un comando rifiutato non produce eventi;
6. l'evento viene costruito, hashato e salvato atomicamente.

## 14. Storia di una partita

La storia completa di una partita è la sequenza dei suoi eventi in `game_events`, con `head` per ciascuno. L'ultima `head` è quella pubblicata nel risultato (§9). Dalla storia il server:
- ricostruisce lo stato dopo un riavvio (replay degli input con il motore e i contenuti della partita);
- risponde agli spettatori (10) e alla classifica (09).

Non c'è un verificatore pubblico delle partite. Chi ha la storia può controllare la catena degli hash ricalcolando `head_i` evento per evento (§6.2) e confrontando l'ultima con `h` del risultato on-chain. È ciò che fa il test `plays a whole game and keeps its whole history, hash-chained, in the database` del server.

## 15. Anomalie e come vengono gestite

| Anomalia | Dove si rileva | Gestione |
|---|---|---|
| Comando **duplicato** (stesso comando reinviato) | Server, `commandId` univoco per partita | Si restituisce l'ack originale; nessun nuovo evento |
| Record **mancante** on-chain | Tracker (transazione scaduta senza essere inclusa) | Ribroadcast degli stessi byte; allarme dopo 5 tentativi |
| Record **duplicato** on-chain (ribroadcast) | Verificatore | Byte identici: ignorato |
| Operazione **falsificata** da un altro account | Verificatore | Firmatario non autorizzato dal manifest: ignorata |
| Operazione valida ma **sconosciuta al DB** | Tracker | **Allarme di sicurezza** (chiave del broadcaster compromessa o bug): revoca via manifest |
| Transazione **inclusa e poi persa** (micro-fork prima dell'irreversibilità) | Tracker | Lo stato diventa `IRREVERSIBLE` solo sotto il blocco irreversibile; se la tx sparisce, ribroadcast |

## 16. Divergenza tra DB e blockchain

Ogni record dell'outbox (`blockchain_events`) ha uno stato di ancoraggio:

```
BUILT ──► BROADCAST (txId, expiration) ──► INCLUDED (block) ──► IRREVERSIBLE
   ▲              │ scaduta / rifiutata              │ sparita prima di LIB
   └──────────────┴──────────────────────────────────┘ (ribroadcast, stessi byte)
```

| Stato | Significato | Azione |
|---|---|---|
| `MATCH` | la nostra operazione porta esattamente il record della sua transazione | nessuna |
| `MISSING_ON_CHAIN` | nel DB, non on-chain dopo la scadenza | ribroadcast |
| `UNKNOWN_ON_CHAIN` | on-chain dal nostro broadcaster, assente nel DB | allarme di sicurezza |
| `CONFLICT` | transazione nota, ma l'operazione non porta il suo record | allarme |

**Pubblicazione: `ChainBroadcaster`.** Un giro ogni 3 s.
- Ogni account invia al più **una** operazione per giro: il suo record più vecchio, da solo.
- L'account di un record è scelto da `sha256(orderId)` (o `sha256(gameId)` per un risultato) modulo la dimensione del pool, così le parti di una ricevuta escono in ordine dallo stesso account.
- La transazione firmata e il record che porta sono salvati come `BROADCAST` **prima** di mandarla a un nodo. Un errore del nodo non dimostra niente (il nodo può averla già inoltrata), quindi decide il tracker.

**Riconciliazione: `ChainTracker`.** Per ogni broadcaster, a ogni giro:
1. legge testa e blocco irreversibile;
2. legge lo storico dell'account da un cursore persistente. Ogni nostra operazione deve corrispondere a una transazione nota, con esattamente il record che dice il DB (`MATCH` → `INCLUDED`). Un'operazione firmata dal nostro broadcaster che il DB non conosce è `UNKNOWN_ON_CHAIN` (allarme in `chain_alerts`, una volta per impronta). Le operazioni `m8tcg_game` pubblicate prima del 2026-09-27 non sono più "nostre" e vengono ignorate;
3. conferma contro il blocco le transazioni `INCLUDED` sotto l'irreversibile; se un micro-fork le ha tolte, tornano `BROADCAST`;
4. solo dopo aver letto lo storico fino in fondo, dichiara `EXPIRED` le transazioni la cui scadenza (60 s) è più vecchia del tempo del blocco irreversibile. Non possono più entrare in un blocco, quindi i loro record tornano `BUILT` (`MISSING_ON_CHAIN`) e ripartono con gli stessi byte. Oltre 5 tentativi: allarme `REPEATED_REBROADCAST`.

Le chiavi dei broadcaster (`M8_BROADCASTER_KEYS`) sono **solo posting**: all'avvio il server controlla le autorità dell'account e si rifiuta di partire se la chiave controlla anche active o owner. `RcMonitor` avverte nel log sotto il 20% di Resource Credits e ferma un broadcaster sotto il 5% con un allarme; le partite e i negozi continuano, e i record aspettano nell'outbox.

La migration `010_games_off_chain.sql` ha tolto dall'outbox i record di partita non ancora pubblicati, chiuso le loro transazioni e risolto i loro allarmi. I record già inclusi restano come storia.

## 17. Versionamento

- `v` (protocollo) cambia solo con modifiche incompatibili di formato o hashing.
- Versioni del protocollo di gioco: 1 (M5) e 2 (M7.4, mosse firmate). Una partita tiene la versione con cui è stata creata. Manifest, ricevute, epoche, scambi, vendite, risultati e ack sono `v: 1`.
- `eng` e `content` fissano il comportamento del replay: il server mantiene disponibili tutte le versioni del motore e dei contenuti usate da partite ancora da ricostruire.

## 18. Evoluzioni

- **Firma delle mosse dei giocatori:** fatto in M7.4 come protocollo di gioco v2, vedi 12.
- **Ack firmati dal server:** fatto in M7.3, vedi 11. Ogni ack di un comando accettato porta `seq` e `head` dell'ultimo evento, firmati con una chiave dedicata che il root nomina in un manifest `ack_keys`.
- **Partite on-chain:** la storia completa è stata tolta il 2026-09-27; al suo posto si pubblica il risultato con la `head` finale (§9).
- **Possibile seguito:** un endpoint che dia la storia di una partita finita, così chiunque possa ricalcolare `h` e confrontarlo con la catena.
