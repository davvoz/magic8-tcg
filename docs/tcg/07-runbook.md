# 07 — Runbook operativo

**Stato:** M6, aggiornato in M7.3 (2026-09-24). Per chi installa e gestisce il server. Ogni procedura dice cosa fare, cosa controllare e cosa **non** fare.

## 1. Installazione

**Servono:**
- Node 22;
- un PostgreSQL gestito o proprio (≥ 15), con backup;
- un reverse proxy con TLS davanti al server (nginx, Caddy, il bilanciatore del provider). Deve inoltrare i WebSocket su `/ws` e **aggiungere** l'indirizzo del client in fondo a `X-Forwarded-For`.

Avvio: `npm ci && npm start` (lo schema del database si migra da solo all'avvio). Con Docker (server, PostgreSQL e Caddy in un unico compose, deploy da GitHub Actions): [deploy/README.md](../../deploy/README.md).

| Variabile | Obbligatoria | Cosa |
|---|---|---|
| `M8_PUBLIC_ORIGIN` | sì | es. `https://play.example`. In https attiva cookie `__Host-`, HSTS e i controlli sotto |
| `M8_DATABASE_URL` | sì (https) | `postgres://…?sslmode=require` |
| `M8_DATA_KEY` | sì (https) | 64 caratteri esadecimali (`openssl rand -hex 32`): cifra i segreti di partita e delle epoche |
| `M8_DATA_KEY_ID`, `M8_DATA_KEYS_OLD` | per la rotazione | vedi §4.1 |
| `M8_TRUST_PROXY` | `true` dietro **un** proxy | usa l'ultimo indirizzo di `X-Forwarded-For` (quello scritto dal proxy); con `false` l'header è ignorato |
| `M8_SHOP_ACCOUNT` | default `verdu.green` | riceve i pagamenti |
| `M8_ROOT_ACCOUNT` | default `verdu.green` | pubblica i manifest (consigliato un account dedicato, vedi 06) |
| `M8_BROADCASTER_KEYS` | per pubblicare | `account:WIF_posting,…`, **solo chiavi posting** |
| `M8_SIGNED_MOVES` | no | `true` (default): partite nuove nel protocollo v2, mosse firmate dai giocatori (12). `false` solo per strumenti o client vecchi. Il browser firma solo in https o su `localhost` |
| `M8_ACK_KEY` | sì (https) | chiave WIF dedicata che firma gli ack ai giocatori (11); mai la chiave di un account o di un broadcaster |
| `M8_ADMIN_ACCOUNTS` | default = shop | account che vedono `/admin.html` |
| `M8_METRICS_TOKEN` | per il monitoraggio | 32–128 caratteri: `Authorization: Bearer …` su `/api/metrics` |
| `M8_STEEM_NODES` | default nell'ordine di 06 | nodi RPC, separati da virgola |
| `M8_HOST`, `M8_PORT`, `M8_LOG_LEVEL`, `M8_SERVE_CLIENT`, `M8_APP_NAME` | no | |
| `M8_LOG_FORMAT` | no | `pretty` (predefinito: righe brevi, senza hash, txId e chiavi) oppure `json` (tutti i campi, per un sistema di raccolta log) |

Il server rifiuta di partire con:
- una configurazione non valida (il messaggio dice quale variabile);
- una chiave broadcaster che controlla anche l'autorità active o owner;
- una `M8_ACK_KEY` uguale a una chiave broadcaster.

**Sonde per la piattaforma:**
- `GET /api/health`: il processo risponde (liveness);
- `GET /api/ready`: risponde anche il database (readiness).

**Metriche:** `GET /api/metrics` in formato Prometheus, da raccogliere ogni 30–60 s.

**Log:** su stdout, una riga per evento. In produzione impostare `M8_LOG_FORMAT=json` (una riga JSON con tutti i campi, compresi txId e hash utili alle indagini) e mandarla a un sistema che possa avvisare sulle righe `"level":"error"`, in particolare `alarm raised: …` e `chain alert: …`. Il formato predefinito (`pretty`) è per chi legge il terminale e tralascia hash, txId, chiavi e id.

## 2. Lancio (una volta)

1. Creare gli account: root (meglio dedicato), shop, 1–4 broadcaster (nomi validi: ogni parte tra i punti ha almeno 3 caratteri). Delegare Steem Power ai broadcaster da un account freddo.
2. Aprire `/manifest.html` e pubblicare con Keychain, chiave **active del root**, la lista dei broadcaster. Poi, scegliendo "Ack keys", la chiave pubblica di `M8_ACK_KEY` (all'avvio il log la mostra se non è ancora nominata: `the ack key is not named…`). Attendere circa un minuto (irreversibilità).
3. Avviare il server con `M8_BROADCASTER_KEYS`. Nel log: nessun `broadcaster not authorised`.
4. Comprare un pacchetto di prova. Dopo la rivelazione dell'epoca (circa 7 giorni) verificarlo con `node tools/verify-order.js <ordine> --server https://…`.

## 3. Backup e ripristino

- **PostgreSQL:** backup giornaliero più log delle transazioni (point-in-time recovery, di solito incluso nei servizi gestiti). Provare un ripristino almeno una volta prima del lancio.
- **Chiave dei dati (`M8_DATA_KEY` e le vecchie):** vanno salvate **separatamente** dal database, per esempio in un gestore di segreti. Senza la chiave:
  - i segreti delle epoche non rivelate sono persi, e quei pacchetti non si potranno più dimostrare;
  - i segreti delle partite in corso sono persi, e quelle partite non si possono riprendere.
  Un backup del database insieme alla sua chiave equivale a un furto dei segreti.
- **Cosa si ricostruisce dalla catena:** le ricevute, gli scambi, le vendite e i risultati delle partite (chi ha giocato, chi ha vinto, l'hash finale). **Non** si ricostruisce la storia delle partite (resta solo nel DB dal 2026-09-27), gli inventari, gli ordini non evasi e le sessioni: per quelli serve il backup.
- **Dopo un ripristino a un punto passato**, il tracker vedrà sulla catena operazioni che il database non conosce più: allarmi `UNKNOWN_ON_CHAIN` attesi. Si risolvono dal pannello annotando "ripristino del …".

## 4. Chiavi

### 4.1 Rotazione della chiave dei dati

1. Generare la nuova chiave.
2. Impostarla come `M8_DATA_KEY` con un nuovo `M8_DATA_KEY_ID`, e mettere la vecchia in `M8_DATA_KEYS_OLD` nella forma `idVecchio:hexVecchio`.
3. Riavviare il server.
4. `node packages/server/src/maintenance/rotateDataKey.js`, con lo stesso ambiente del server. Si può eseguire a server acceso ed è ripetibile.
5. Quando riporta `resealed: 0`, togliere la vecchia chiave da `M8_DATA_KEYS_OLD` e riavviare.

### 4.2 Chiave di un broadcaster compromessa (o sospetta)

1. **Subito:** da `/manifest.html` pubblicare un manifest **senza** quell'account (o con la lista vuota). Da quel blocco i verificatori ignorano ciò che firma.
2. Cambiare la chiave posting dell'account (serve la chiave owner o active, fuori dal server), oppure usare un account nuovo.
3. Pubblicare un manifest con gli account validi e attendere l'irreversibilità.
4. Aggiornare `M8_BROADCASTER_KEYS` e riavviare. I record in attesa ripartono da soli, con gli stessi byte.
5. Gli allarmi `UNKNOWN_ON_CHAIN` delle operazioni fatte dall'attaccante vanno risolti annotando l'incidente. Le operazioni firmate dopo la revoca non contano per i verificatori.

### 4.3 Chiave degli ack compromessa (o sospetta)

1. **Subito:** da `/manifest.html`, "Ack keys", pubblicare un manifest con la lista vuota (o con la sola chiave nuova).
2. Generare una chiave nuova, impostarla in `M8_ACK_KEY`, riavviare, e nominarla con un manifest (se non fatto al punto 1).
3. Annotare da quando la chiave può essere stata esposta: con quella chiave si possono fabbricare "prove" contro il server per le partite create mentre era valida (11, Limiti). Le contestazioni su quelle partite vanno giudicate con cautela.

### 4.4 Altri segreti

- **Token delle metriche:** si cambia la variabile e si riavvia.
- **Sessioni utente:** un utente che cambia la chiave posting perde le sessioni aperte entro 10 minuti (job di controllo delle chiavi).

## 4.5 Scambi

- Gli scambi aperti scadono da soli dopo 72 ore (job ogni minuto); le carte tornano al proponente.
- Un giocatore che dice di aver perso carte: la storia di ogni copia è in `card_instance_events` (`LOCKED`, `TRANSFERRED`, `UNLOCKED`, con `ref = trade:<id>`), e ogni scambio concluso è sulla catena (`m8tcg_trade`).
- **Non si spostano carte a mano nel database.** Uno scambio annullato per errore si rifà come nuovo scambio fra i due giocatori.

## 4.6 Vendite fra giocatori

- Il job `sale settlement` (ogni 5 secondi) legge lo storico dei venditori con acquisti in corso e consegna le carte pagate; `listing expiry` (ogni minuto) chiude gli annunci scaduti senza acquisti in corso.
- Un compratore dice di aver pagato senza ricevere la carta: cercare l'acquisto nell'audit (`sales.reserved`, `sales.payment_detected`, `sales.payment_mismatch`, `sales.completed`). Con `payment_mismatch` il trasferimento non corrispondeva alle istruzioni (il campo `problem` dice perché): i soldi sono al venditore e **il server non può restituirli**; si indica al compratore la transazione da mostrare al venditore.
- `DETECTED` da molto tempo: il trasferimento non è ancora irreversibile per 2 nodi, oppure un nodo non risponde. Si controllano i nodi (`M8_STEEM_NODES`), non l'acquisto.
- Ogni vendita conclusa è sulla catena (`m8tcg_sale`) e nella storia della copia (`ref = sale:<id annuncio>`). Come per gli scambi, niente carte spostate a mano.

## 5. Allarmi (`alarm raised: …`)

| Allarme | Significato | Cosa fare |
|---|---|---|
| `outbox_backlog` | un record attende da più di 10 minuti | Controllare nel pannello le Resource Credits dei broadcaster, i manifest (log `broadcaster not authorised`) e i nodi (`broadcast failed`). Le partite continuano; i record partono da soli quando la causa è risolta |
| `chain_alerts_open` | anomalia sulla catena | Vedi §6 |
| `payment_confirmation_slow` | un pagamento non viene confermato da 30 minuti | I due nodi di verifica non concordano o sono giù: controllare `M8_STEEM_NODES` e lo stato dei nodi. Non si conferma mai a mano |
| `refund_waiting` | un rimborso attende da più di 24 ore | Pannello, sezione rimborsi |
| `broadcaster_paused` | Resource Credits sotto il 5% | Delegare Steem Power all'account |

## 6. Anomalie della catena (`/admin.html`, "Chain alerts")

| Tipo | Significato | Cosa fare |
|---|---|---|
| `UNKNOWN_ON_CHAIN` | un'operazione `m8tcg_*` firmata dal nostro broadcaster che il database non conosce | **Trattarla come chiave rubata** (§4.2), a meno che non segua un ripristino da backup (§3) |
| `CONFLICT` | una nostra transazione nota è sulla catena, ma l'operazione non porta esattamente il record (ricevuta, epoca, scambio, vendita o risultato) che il database le associa | Stessa procedura di una chiave rubata. Il record coinvolto (ordine, scambio, vendita, partita) è contestato: non assegnare ricompense legate a quel risultato |
| `REPEATED_REBROADCAST` | un record è stato inviato 5 volte senza entrare in un blocco | Nodi che rifiutano la transazione: guardare `last_error` nel log `broadcast failed`. Di solito sono RC esaurite o nodi fuori servizio |
| `RC_CRITICAL` | broadcaster fermo per Resource Credits | Delegare Steem Power |

Un allarme si risolve dal pannello con una nota su cosa si è controllato o fatto. La nota finisce nell'audit log insieme a chi l'ha scritta.

## 7. Rimborsi

1. Dal pannello, "Refunds to send" → **Pay with Keychain**. Keychain chiede di firmare con lo shop un trasferimento di importo esatto, con memo `m8tcg refund <id>`.
2. Il server **non** si fida del pannello. Il rimborso diventa `SENT` quando il trasferimento compare nello storico dello shop, e `CONFIRMED` quando due nodi lo vedono sotto il blocco irreversibile.
3. Importo sbagliato, memo di un rimborso già pagato o sconosciuto: il server lo registra nell'audit (`payments.refund_mismatch`, `refund_paid_twice`, `refund_unknown`) e nel log come errore. Il denaro inviato per sbaglio si recupera a mano chiedendolo al destinatario.

## 8. Audit log

Dal pannello, "Check hash chain" ricalcola la catena di hash dell'audit. `BROKEN at entry N` significa che qualcuno ha modificato o cancellato righe dal database (i trigger lo impediscono all'utente applicativo). È un **incidente di sicurezza**: isolare il database, confrontare con i backup, cambiare le credenziali del database.

## 9. Server compromesso

1. Revocare i broadcaster (§4.2) e la chiave degli ack (§4.3).
2. Cambiare la chiave dei dati (§4.1), le credenziali del database e il token delle metriche.
3. Invalidare tutte le sessioni: `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`.

Lo shop e il root non hanno chiavi sul server: i fondi non sono esposti. I record pubblicati dopo la revoca con chiavi rubate non contano. La storia delle partite è nel DB: dopo una compromissione va considerata non affidabile dal momento dell'intrusione, e confrontata con gli ack che i giocatori hanno conservato (11).
