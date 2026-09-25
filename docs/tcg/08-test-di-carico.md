# 08 — Test di carico

**Stato:** prima misura, 2026-09-24 (M6). Strumento: `node packages/server/tools/load-test.js [giocatori] [comandi massimi per partita]`.

## Come è fatto il test

- **Server vero, in un solo processo:** app completa, WebSocket, PGlite in memoria. Una catena STEEM finta produce un blocco ogni 3 s, un broadcaster pubblica ogni record, il tracker li segue fino all'irreversibilità.
- **Giocatori simulati:** ognuno parla da un proprio indirizzo (`X-Forwarded-For` dietro un "proxy", così valgono i limiti per indirizzo). Ognuno fa il login con challenge e firma, prende uno starter, apre il WebSocket, entra in coda e gioca partite intere con mosse legali casuali, **senza tempi di riflessione**. Oltre 400 comandi la partita finisce con una resa.
- **Un attaccante** manda messaggi il più velocemente possibile mentre le partite sono in corso.
- **Il report misura:**
  - la latenza di ogni comando, dall'invio all'ack del server;
  - il ritardo dell'event loop e la memoria;
  - quanti blocchi servono a un solo account broadcaster per pubblicare tutto.

Macchina: 4 vCPU Intel Xeon 2,1 GHz, Node 22.

## Risultati

| | 40 giocatori (20 partite) | 200 giocatori (100 partite) |
|---|---|---|
| Comandi giocati | 1632 | 8299 |
| Throughput | 170 comandi/s | 177 comandi/s |
| Latenza ack p50 / p95 / p99 | 93 / 131 / 205 ms | 338 / 462 / 487 ms |
| Ritardo event loop p99 | 149 ms | 439 ms |
| Memoria (RSS di picco) | 556 MB | 769 MB |
| Comandi rifiutati, errori del server | 0, 0 | 0, 0 |
| Record pubblicati (tutti irreversibili) | 359 | 1824 |
| Blocchi per pubblicarli con 1 account | 36 | 183 |
| Attaccante | chiuso con 4008 dopo 200 messaggi | chiuso con 4008 dopo 200 messaggi |

## Lettura

- **Il collo di bottiglia è il database nello stesso processo.** PGlite è PostgreSQL compilato in WebAssembly e gira nel thread di Node: ogni comando è una transazione di qualche istruzione, eseguita sullo stesso thread che serve i WebSocket. Oltre i ~170 comandi al secondo la latenza cresce per coda, non per errori. In produzione il database è un PostgreSQL separato (`pg`, pool di connessioni) e il thread di Node resta libero: il numero va rimisurato lì con `M8_LOAD_DATABASE_URL=postgres://…` su un database usa e getta.
- **Traduzione in partite reali.**
  - I bot giocano senza pensare: circa 1,8 comandi al secondo per partita.
  - Una partita umana ne fa circa 100 in 15–20 minuti, cioè circa 0,1 al secondo.
  - 170 comandi al secondo corrispondono quindi a circa **1700 partite umane contemporanee** per processo, al limite della saturazione.
  - Con un margine del 50% (latenza sotto i 100 ms) sono **circa 800**.
- **Catena.**
  - Una partita produce circa 18 record, circa 10 record per operazione.
  - Con una operazione per blocco per account, un account broadcaster pubblica circa 28.800 operazioni al giorno, cioè **circa 16.000 partite al giorno**. Il pool scala in modo lineare (4 account: circa 64.000).
  - Il limite vero saranno i Resource Credits, da misurare su mainnet (M5, "Da fare a mano").
  - Nella prova da 100 partite, un solo account ha avuto bisogno di 9 minuti di blocchi per smaltire 47 secondi di gioco accelerato. Con tempi umani le stesse partite durano 15–20 minuti e l'account resta in pari.
- **Abusi.** L'attaccante viene chiuso dopo il burst consentito (40 messaggi) più 10 violazioni. Le partite in corso non hanno visto né errori né comandi rifiutati.
- **Ack firmati (M7.3, dopo la misura):** ogni comando accettato costa in più una firma secp256k1, circa 0,8 ms. A 170 comandi al secondo sono circa il 14% di un core: da rimisurare, non cambia l'ordine di grandezza.
- **Ottimizzazione fatta durante la misura:** il conteggio degli eventi in attesa di sigillatura è tenuto in memoria per partita (prima costava una query per comando): +8% di throughput.

## Limiti di questa misura

- Tutto su una macchina, WebSocket su localhost: la rete reale aggiunge latenza, non carico sul server.
- PGlite al posto di PostgreSQL (vedi sopra).
- Un solo processo server. Lo scaling orizzontale richiede il lease per partita (01 §9), non ancora implementato.
- Bot con mosse casuali: le partite reali hanno più giocate per turno e quindi record un po' più grandi (03 §10).
