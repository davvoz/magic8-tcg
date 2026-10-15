# 25 — Giocatori della casa (bot)

**Stato:** 2026-10-16. Pacchetto `packages/bots` (`@magic8/bots`), servizio `bots` in `docker-compose.yml`, variabili `M8_BOT_*` (07 §1). Si tolgono quando i giocatori bastano da soli: si svuota `M8_BOT_KEYS`.

## L'idea

Il gioco è giovane: chi entra non trova quasi mai qualcuno con cui giocare. I **giocatori della casa** sono account STEEM veri, ognuno con il suo wallet, che restano online come una persona con il gioco aperto:

- compaiono nella lobby fra i giocatori online: `idle` quando sono liberi, `playing` quando giocano;
- **accettano ogni sfida**, casual o ranked, con uno dei loro mazzi, dopo qualche secondo;
- firmano la partita come farebbe Keychain e la giocano con l'AI del motore (`BasicAi`, la stessa della pratica e della classificata automatica);
- **entrano in coda** quando un giocatore la aspetta da solo da un po';
- a fine partita guardano il risultato qualche secondo e tornano in lobby.

Per il server sono giocatori come gli altri: nessuna regola, tabella o messaggio nuovo. Usano la stessa API del browser (HTTP e WebSocket) e lo stesso codice del client (`OnlineService`, `LobbyService`, chiavi di sessione WebCrypto).

## Come si comporta un bot

| Momento | Cosa fa | Perché |
|---|---|---|
| Avvio | Accede firmando la sfida di login con la chiave posting. Se l'account non ha un mazzo giocabile, prende il mazzo iniziale gratuito: un precostruito diverso per ogni bot. Poi apre il WebSocket. | Come un nuovo giocatore. |
| Sfida ricevuta | Dopo 2–5 s la accetta con uno dei suoi mazzi giocabili, scelto a caso. Se non può (ranked senza ingressi, non ancora idoneo, limite della coppia) la **rifiuta subito**, e il log dice perché. | Chi sfida non resta un minuto ad aspettare. |
| Partita trovata | Firma la chiave di sessione dopo 1–2,5 s (protocollo v2, 12). | È l'accettazione della partita, come con Keychain. |
| Durante la partita | Prima di ogni mossa pensa per `M8_BOT_THINK_MS` (default 1,2–3,2 s); prima della sua prima mossa aspetta 3 s in più, il tempo della moneta. Ogni bot ha uno **stile** fisso (`aggressive`, `balanced`, `defensive`, 23). | L'avversario vede le mosse una per volta. Il turno dura 90 s. |
| Mossa rifiutata | Se il server rifiuta la mossa dell'AI (non dovrebbe succedere), fa la mossa più piccola: nessun attacco, nessun blocco, fine della fase o del turno. Una mossa che non è arrivata (connessione persa) la riprova. | Una partita non resta mai ferma per colpa del bot. L'orologio del server resta l'ultima parola. |
| Fine partita | Dopo 4–8 s torna in lobby. | Come chi guarda la schermata di fine. |
| Connessione persa | Si ricollega da solo e riprende la partita in corso, con una nuova chiave di sessione firmata. Se la sessione è scaduta, rifà l'accesso. | Sempre online. |
| Account aperto altrove | Se qualcuno apre l'account del bot in un browser, il bot lascia il posto per **30 minuti**, poi torna (e chiude l'altra scheda). | Così l'operatore può usare l'account, per esempio per comprare ingressi ranked. |

## La coda

Ogni 5 s un bot legge la lista della lobby. Un giocatore (non un bot) che è `searching` da **10 s** riceve **un** bot in coda:

1. il bot entra in coda **casual** (gratis) e aspetta 15 s;
2. se non viene abbinato esce ed entra in coda **ranked** per altri 15 s, perché la lobby non dice in quale coda sta il giocatore;
3. se non viene abbinato nemmeno lì, esce.

Lo stesso giocatore non viene aiutato di nuovo per 2 minuti. Un solo bot alla volta cerca in coda, e i bot non aiutano mai un altro bot: **i bot non giocano mai fra loro**.

## Ranked

I bot accettano anche le sfide ranked e possono entrare in coda ranked, con le regole di tutti (09, 22):

- servono **ingressi ranked**, comprati con il wallet del bot. Il bot ha solo la chiave posting e da solo non compra niente. L'operatore apre l'account del bot nel browser (il bot si sposta per 30 minuti), compra gli ingressi nello shop ed esce. Senza ingressi le sfide ranked vengono rifiutate subito (il log lo dice) e la coda ranked viene saltata;
- bisogna essere **idonei**, cioè avere le partite casual minime (09). I bot le accumulano giocando casual;
- le partite ranked dei bot muovono il rating, contano in classifica e **un bot può vincere il jackpot** della stagione: è un giocatore come gli altri.

## Configurazione

| Variabile | Valore |
|---|---|
| `M8_BOT_KEYS` | `account:WIF_posting[:stile],…`. **Solo chiavi posting**: firmano l'accesso e le partite, non muovono fondi. I bot senza stile ricevono a turno `balanced`, `aggressive`, `defensive`. Vuota: il processo parte e non fa niente. |
| `M8_BOT_THINK_MS` | `min-max` in ms; default `1200-3200`, al massimo 60000. |
| `M8_BOT_SERVER` | Dove risponde il server. In Docker è `http://app:8080` (lo imposta il compose). |
| `M8_BOT_ORIGIN` | L'origine pubblica del sito, mandata come `Origin`: il server accetta solo la sua. In Docker è `https://<M8_DOMAIN>` (lo imposta il compose). Senza, vale `M8_PUBLIC_ORIGIN`. |

Una configurazione sbagliata ferma il processo con un messaggio che nomina la variabile.

## Dove gira

- **Produzione:** servizio `bots` in `docker-compose.yml`: stessa immagine dell'app, comando `node packages/bots/src/main.js`. Parla con l'app sulla rete del compose, senza passare da nginx. `deploy.sh` lo riavvia sull'immagine nuova subito dopo l'app; durante il cambio i bot perdono la connessione e si ricollegano da soli. Log: `docker compose logs -f bots`, una riga JSON per evento (accesso, sfide accettate o rifiutate, partite e risultati).
- **Locale:** `M8_BOT_KEYS="account:WIF,…" npm run docker:up`, mai in `deploy/local.env`, che è nel repository. Senza la variabile i bot non partono. Fuori da Docker: `M8_BOT_KEYS=… M8_BOT_SERVER=http://127.0.0.1:8080 npm run bots`.
- **Togliere i bot:** `M8_BOT_KEYS=` nel `.env`, poi `docker compose up -d bots`.

## Prove

- `packages/bots/test/bots.e2e.test.js`: server vero, bot vero, e un giocatore con lo stack vero del client e un Keychain pilotato dal test.
  - Alice sfida il bot, che accetta, firma e gioca la partita fino alla fine (le mosse firmate dal bot sono registrate), poi torna in lobby.
  - Alice è in coda da sola: un bot entra in coda e viene abbinato con lei.
  - Il proprietario apre l'account del bot in un browser: il bot si sposta, poi torna.
- `packages/bots/test/fleet.test.js`: chi viene aiutato in coda, quando, e mai un bot.
- `packages/bots/test/config.test.js`: le variabili.

## Limiti

- **I bot non si dichiarano.** Nella lobby sono account come gli altri. Per dirlo basterebbe un'etichetta, lato client, sugli account di una lista.
- **La stessa AI della pratica.** Gioca in modo ragionevole ma prevedibile, con uno stile per bot.
- **Un processo per tutti i bot.** Se cade, Docker lo riavvia, e una partita in corso riprende come dopo una pagina ricaricata (12).
