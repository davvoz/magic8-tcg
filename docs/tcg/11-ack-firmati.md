# 11 — Ack firmati

**Stato:** M7.3, 2026-09-24. Formato e controllo in `@magic8/protocol` (`acks.js`, manifest `ack_keys`), firma nel modulo gameplay del server, verifica e conservazione nel client, controllo contro la catena in `tools/verify-game.js` e in `/verify.html`.

## A cosa servono

- **Prima:** il giocatore doveva fidarsi del server anche per la storia pubblicata. Il server avrebbe potuto:
  - accettare una mossa e poi pubblicare una partita diversa;
  - oppure pubblicare la partita senza quella mossa.
  Il giocatore non aveva modo di dimostrarlo.
- **Adesso:** per ogni comando accettato il server firma che cosa è diventata la partita. Il giocatore conserva queste firme; la pagina di verifica le confronta con la catena. Se la catena le contraddice, la firma è una **prova**: solo la chiave del server può averla prodotta.

## Cosa firma il server

Il testo firmato è JSON canonico:

```json
{"at":1790294286880,"cmd":"<commandId>","g":"<gameId>","head":"<hex64>","key":"STM…","kind":"m8tcg_ack","seq":4,"v":1,"ver":2}
```

- `seq` e `head`: numero e hash di catena dell'ultimo evento prodotto dal comando. L'hash impegna tutta la catena fino a quell'evento (03 §6.4), quindi anche il comando stesso e tutto ciò che è venuto prima.
- `ver`: la versione del motore raggiunta; `at`: l'ora del server; `key`: la chiave pubblica che firma.
- **Firma:** secp256k1 come `signBuffer` di Keychain (sha256 del testo, firma compatta con recupero). Si verifica con gli stessi strumenti del login.
- **Ack sul canale:** `game.ack` diventa `{ "commandId", "ok": true, "version", "head", "seq", "at", "key", "sig" }`.
  - Un comando rimandato riceve lo stesso ack firmato (è salvato nel database).
  - I comandi rifiutati e le mosse forzate non hanno ack firmato.
- **Costo:** circa 0,8 ms per ack su un core. A 170 comandi al secondo (08) sono circa il 14% di un core.

## La chiave degli ack

- **È una chiave dedicata** (`M8_ACK_KEY`, WIF). Non controlla nessun account e nessun fondo, e non deve essere la chiave di un broadcaster (il server rifiuta di partire).
- In https è obbligatoria. In sviluppo, se manca, il server ne crea una a ogni avvio e lo scrive nel log; gli ack firmati così risultano `UNTRUSTED_KEY`.
- **La fiducia viene dalla catena.** Il root pubblica con la chiave active un manifest `ack_keys`, per esempio da `/manifest.html` scegliendo "Ack keys":

  ```json
  {"from_block":0,"keys":["STM…"],"kind":"ack_keys","v":1}
  ```

  Le regole sono quelle dei broadcaster (03 §11): vale dal blocco del manifest in poi, mai prima; un manifest nuovo sostituisce il precedente; la lista vuota revoca tutto.
- **Quale manifest conta:** un ack è valido se la sua chiave era autorizzata al blocco in cui la partita è stata creata sulla catena (`GAME_CREATED`). Per una partita mai pubblicata conta l'ultimo blocco irreversibile.
- Il server avvisa nel log finché la sua chiave non è nominata da un manifest irreversibile.
- Il messaggio `welcome` comunica al client la chiave in uso (`ackKey`).

## Cosa fa il client

- Controlla ogni ack appena arriva. Deve essere ben formato, firmato dalla chiave che nomina, e quella chiave deve essere quella annunciata nel `welcome`. Se non lo è:
  - la mossa resta valida (decide il server);
  - il giocatore vede l'errore `BAD_ACK`: quel server non gli dà prove.
- Conserva gli ack nel browser, per partita, per le ultime 20 partite (`m8.acks.<gameId>`).
- `/verify.html?game=<id>` li legge da solo e aggiunge il controllo "Your signed acks". Se la catena contraddice un ack, il riquadro in alto dice **CONTRADICTED**.

## Esiti del confronto con la catena

| Esito | Significato |
|---|---|
| `CONSISTENT` | La catena ha quell'evento con lo stesso hash |
| `DIVERGENT` | **Prova:** la catena ha quell'evento con un altro hash, quindi il server ha pubblicato una partita diversa da quella che ha confermato |
| `OMITTED` | **Prova:** la partita pubblicata è finita senza quell'evento |
| `NOT_PUBLISHED` | Non ancora sulla catena (partita in corso, o record in attesa) |
| `BAD_SIGNATURE` | La firma non corrisponde: l'ack non prova niente |
| `UNTRUSTED_KEY` | Chiave non nominata dal root quando la partita è stata creata: non prova niente |
| `INVALID` | Malformato, o di un'altra partita |

Riga di comando: `node tools/verify-game.js <id> --acks acks.json`. Il codice d'uscita è 1 se un ack è contraddetto, anche quando la partita sulla catena è `VALID`.

## Limiti

- **Una chiave degli ack rubata permette di fabbricare "prove" contro il server** per le partite create mentre era autorizzata. Dopo un furto:
  - si revoca subito con un manifest `ack_keys` nuovo (07 §4.3);
  - le contestazioni su partite create tra il furto e la revoca vanno giudicate con cautela.
- **Gli ack non dicono chi ha deciso la mossa.** Provano cosa il server ha accettato, non che l'abbia voluto il giocatore. Per questo serve la firma delle mosse con chiave di sessione (protocollo v2, 03 §18).
- **Un server può rifiutarsi di rispondere.** Un comando senza ack non prova niente in nessuna direzione. Il client lo vede come un comando non confermato.
