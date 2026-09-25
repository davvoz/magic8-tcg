# 12 — Mosse firmate (protocollo di gioco v2)

**Stato:** M7.4, 2026-09-25.
- **Formato e verifica:** `@magic8/protocol` (`sessions.js`, schema v2).
- **Verifica P-256:** `@magic8/steem` (`verifySessionSignature`) per browser e verificatori; il server usa quella nativa di Node, con lo stesso risultato.
- **Server:** modulo gameplay.
- **Client:** `WebCryptoSessionKeys`, `OnlineService`.
- **Configurazione:** attivo per le partite nuove; `M8_SIGNED_MOVES=false` torna a v1.

## Cosa cambia

- **In v1** il giocatore doveva fidarsi del server per una cosa: che le mosse pubblicate a suo nome fossero davvero sue.
  - Gli ack firmati (11) provano cosa il server ha **accettato**, non chi l'ha **deciso**.
- **In v2** ogni mossa di un giocatore porta la firma di una chiave che solo il suo browser possiede, autorizzata dal suo account STEEM.
  - Il server può ancora rifiutare una mossa, o fare le mosse forzate previste dal protocollo (tempo scaduto, abbandono), e le segna come sue (`FORCED_MOVE`).
  - Non può pubblicare una mossa a nome del giocatore che il giocatore non ha firmato: il verificatore la rifiuta (`BAD_MOVE_SIGNATURE` o `UNSIGNED_MOVE`), e la partita è `INVALID` anche se hash e replay tornano.

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

## Formato (differenze da v1)

- **Versioni:** `v` del record vale 2 per tutta la partita (il verificatore rifiuta record di versioni diverse nella stessa partita). L'envelope resta `v: 1` e può portare record di partite v1 e v2.
- **`SESSION`** (nuovo, attore = posto): `{ "key": "04…" (punto P-256 non compresso, 130 hex), "auth": "<firma Keychain, 130 hex>" }`. Ammesso in qualsiasi momento prima della fine.
- **`MOVE`** (v2): `{ "cid": "<uuid>", "cmd": <comando>, "ev": <int>, "sig": "<r‖s, 128 hex>" }`.
- `PLAYER_JOINED`, `FORCED_MOVE` e gli altri eventi non cambiano.

## Verifica

`verifyGame` e `verifyGameOnChain` controllano per le partite v2:

| Controllo | Esito |
|---|---|
| Ogni `MOVE` è firmata dalla chiave che il posto aveva in quel momento | `signatures.status`: `VALID`, `UNSIGNED_MOVE`, `BAD_MOVE_SIGNATURE` (gli ultimi due rendono la partita `INVALID`) |
| Chi ha autorizzato ogni chiave | `sessions[].status`: `AUTHORIZED` (una chiave posting dell'account, oggi), `KEY_NOT_CURRENT` (una chiave che l'account oggi non usa: cambiata dopo la partita, oppure mai sua), `FORGED` (non è una firma: partita `INVALID`), `UNCHECKED` (il lettore della catena non sa leggere gli account) |

- `KEY_NOT_CURRENT` non basta per dire che la partita è falsa: un giocatore può aver cambiato la chiave posting dopo. Per deciderlo va letta la storia delle autorità dell'account (`account_update`). **Da fare.**
- `/verify.html` mostra "Signed moves" e "Session keys"; `tools/verify-game.js` stampa una riga per le mosse e una per sessione.

## Costi

- **Keychain:** una richiesta in più per partita, all'inizio, e una per ogni ricarica della pagina. Keychain permette di non chiedere di nuovo per il sito.
- **Server:** una verifica P-256 per comando (0,09 ms con Node) più la firma dell'ack (0,8 ms). Nel test di carico si passa da circa 170 a circa 130 comandi al secondo per processo (08).
- **Catena:** una `MOVE` v2 pesa circa 200 byte in più (id, versione e firma), un `SESSION` circa 300: circa un terzo in più di byte per partita.
- **Browser:** WebCrypto esiste solo in un contesto sicuro, cioè https oppure `localhost`. Chi apre il gioco in http da un altro indirizzo della rete locale non può firmare: in sviluppo usare `localhost` o `M8_SIGNED_MOVES=false`.

## Scelte diverse dal progetto iniziale (03 §18)

- **P-256 invece di secp256k1.** I browser non offrono secp256k1 in WebCrypto. Una chiave secp256k1 in JavaScript sarebbe leggibile ed esportabile da qualunque script della pagina; P-256 in WebCrypto no.
- **Un evento `SESSION` separato invece dei campi dentro `PLAYER_JOINED`.** Permette di sostituire la chiave durante la partita. Altrimenti una pagina ricaricata non potrebbe più firmare e il giocatore perderebbe per abbandono.
