# 12 — Mosse firmate (protocollo di gioco v2)

**Stato:** M7.4, 2026-09-25; dal 2026-09-27 le partite non si pubblicano più sulla catena (03) e la verifica pubblica delle firme è stata tolta. Il server continua a pretendere e registrare le firme.
- **Formato:** `@magic8/protocol` (`sessions.js`, schema v2).
- **Verifica P-256:** `@magic8/steem` (`verifySessionSignature`).
- **Server:** modulo gameplay.
- **Client:** `WebCryptoSessionKeys`, `OnlineService`.
- **Configurazione:** attivo per le partite nuove; `M8_SIGNED_MOVES=false` torna a v1.

## Cosa cambia

- **In v1** il giocatore doveva fidarsi del server per una cosa: che le mosse registrate a suo nome fossero davvero sue.
  - Gli ack firmati (11) provano cosa il server ha **accettato**, non chi l'ha **deciso**.
- **In v2** ogni mossa di un giocatore porta la firma di una chiave che solo il suo browser possiede, autorizzata dal suo account STEEM.
  - Il server può ancora rifiutare una mossa, o fare le mosse forzate previste dal protocollo (tempo scaduto, abbandono), e le segna come sue (`FORCED_MOVE`).
  - Non può accettare una mossa a nome del giocatore che il giocatore non ha firmato: la firma è registrata con la mossa, nel DB.

## Come funziona

1. **La chiave di sessione.** Appena abbinato, il browser crea una coppia di chiavi P-256 con WebCrypto, **non esportabile**:
   - uno script iniettato nella pagina potrebbe usarla finché la pagina è aperta, ma non portarla via;
   - la chiave vive solo in memoria, per quella partita.
2. **L'autorizzazione.** Keychain chiede al giocatore di firmare con la chiave **posting** il testo:

   ```
   m8tcg session <gameId> <chiave pubblica>
   ```

   Il browser manda chiave e firma con `game.session`. Il server:
   - controlla che la firma sia di una chiave posting dell'account del posto (come per il login);
   - registra l'evento `SESSION`.

   Questa firma è anche il modo in cui il giocatore **accetta la partita** (vedi "Avvio" sotto).
3. **Le mosse.** Ogni comando parte con la firma della chiave di sessione sul JSON canonico:

   ```json
   {"c":<comando senza playerId>,"cid":"<commandId>","ev":<versione attesa>,"g":"<gameId>","kind":"m8tcg_move","v":2}
   ```

   Il server:
   - rifiuta un comando non firmato, firmato da un'altra chiave o per un altro comando (`INVALID_SIGNATURE`);
   - rifiuta un comando se il posto non ha ancora una chiave (`SESSION_REQUIRED`);
   - altrimenti registra `MOVE { cid, cmd, ev, sig }`.
4. **La resa** è una mossa come le altre: firmata, alla versione vista dal giocatore.
5. **Pagina ricaricata, o un altro dispositivo:** la chiave è persa. Il client ne crea una nuova e la fa autorizzare (una nuova richiesta di Keychain). Il nuovo `SESSION` sostituisce il precedente da quel punto: le mosse successive devono essere firmate con la chiave nuova.

## Avvio: la partita parte solo quando entrambi hanno firmato

- **Quando parte.** In v2 il server registra `GAME_STARTED` (mani iniziali, sorteggio di chi inizia, orologio) solo quando ha:
  - l'entropia di entrambi i posti;
  - un `SESSION` di entrambi i posti.

  L'ultimo dei due che arriva avvia la partita, nella stessa unità di lavoro. Il lancio della moneta che il client mostra all'inizio arriva quindi solo dopo le due firme.
- **Mentre aspetta.** La vista della partita porta:
  - `authorized: { "s0": bool, "s1": bool }`, cioè chi ha già firmato;
  - `authorizeDeadline`, cioè entro quando.

  Dopo ogni firma il server manda `game.state` a entrambi, così ognuno vede se l'altro ha accettato. Anche `match.found` porta `authorizeDeadline`.
- **Rifiuto.** Chi dice no a Keychain manda `game.decline`, che è ammesso solo prima dell'avvio. Il server chiude subito la partita.
- **Tempo scaduto.** Se allo scadere di `authorizeMs` (60 s dalla creazione) manca una firma, la partita viene chiusa. L'entropia mancante, invece, continua a essere messa dal server dopo `entropyMs`, come in v1.
- **Partita chiusa.**
  - Il server registra `GAME_ABORTED` con `why`:
    - `"declined"` se qualcuno ha rifiutato;
    - `"not_authorized"` se è scaduto il tempo.
  - `GAME_ABORTED` rivela il segreto (03) ma non i mazzi, perché nessuna carta è stata distribuita.
  - La partita passa a `ABORTED`, con risultato `aborted` per entrambi i posti. Non conta per la classifica: nessun `onGameFinished`.
  - Entrambi i giocatori ricevono `game.aborted { gameId, reason, seats, you }`, dove `seats` sono i posti che non hanno firmato.
  - Il client mostra chi non ha accettato e permette di cercare subito un'altra partita.
- **Dopo l'avvio non cambia niente.** Una pagina ricaricata che non riesce a far firmare una nuova chiave non annulla la partita: il giocatore viene avvisato che le sue mosse non possono partire.
- **Quando il client apre Keychain** (`SessionAuthorizer`):
  - da solo, al massimo una volta per partita e per pagina: quando la partita viene trovata, oppure quando una pagina ricaricata la riprende;
  - dopo un rifiuto non lo riapre mai da solo, nemmeno sugli aggiornamenti della partita. Solo una mossa che il giocatore prova a fare chiede di nuovo;
  - un prompt rimasto aperto su una partita annullata o finita viene ignorato: non si manda niente al server.
- **Verifica end-to-end:** `packages/server/test/e2e/onlineStart.test.js` usa il server vero e due client veri (`OnlineService` su WebSocket, chiavi WebCrypto) con un Keychain pilotato dal test.

## Formato (differenze da v1)

- **Versioni:** il protocollo di gioco vale 2 per tutta la partita (`games.protocol_version`) ed entra nell'hash di ogni evento.
- **`SESSION`** (nuovo, attore = posto): `{ "key": "04…" (punto P-256 non compresso, 130 hex), "auth": "<firma Keychain, 130 hex>" }`. Ammesso in qualsiasi momento prima della fine.
- **`MOVE`** (v2): `{ "cid": "<uuid>", "cmd": <comando>, "ev": <int>, "sig": "<r‖s, 128 hex>" }`.
- `PLAYER_JOINED`, `FORCED_MOVE` e gli altri eventi non cambiano.
- **`GAME_ABORTED`**: finalmente usato, con `why` = `declined` | `not_authorized` e senza `decks` (vedi "Avvio").

## Costi

- **Keychain:** una richiesta in più per partita, all'inizio, e una per ogni ricarica della pagina. Keychain permette di non chiedere di nuovo per il sito.
- **Server:** una verifica P-256 per comando (0,09 ms con Node) più la firma dell'ack (0,8 ms). Nel test di carico si passa da circa 170 a circa 130 comandi al secondo per processo (08).
- **Database:** una `MOVE` v2 pesa circa 200 byte in più (id, versione e firma), un `SESSION` circa 300: circa un terzo in più di byte per partita.
- **Browser:** WebCrypto esiste solo in un contesto sicuro, cioè https oppure `localhost`. Chi apre il gioco in http da un altro indirizzo della rete locale non può firmare: in sviluppo usare `localhost` o `M8_SIGNED_MOVES=false`.

## Scelte diverse dal progetto iniziale (03 §18)

- **P-256 invece di secp256k1.** I browser non offrono secp256k1 in WebCrypto. Una chiave secp256k1 in JavaScript sarebbe leggibile ed esportabile da qualunque script della pagina; P-256 in WebCrypto no.
- **Un evento `SESSION` separato invece dei campi dentro `PLAYER_JOINED`.** Permette di sostituire la chiave durante la partita. Altrimenti una pagina ricaricata non potrebbe più firmare e il giocatore perderebbe per abbandono.
