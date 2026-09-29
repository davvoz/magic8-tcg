# 11 — Ack firmati

**Stato:** M7.3, 2026-09-24; ridotto il 2026-09-27. Formato e controllo in `@magic8/protocol` (`acks.js`, manifest `ack_keys`), firma nel modulo gameplay del server, verifica e conservazione nel client.

**Dal 2026-09-27** la storia delle partite resta nel DB; sulla catena va solo il risultato, con l'hash finale della storia (03 §9). Il confronto automatico fra ack e storia pubblicata è stato tolto con `/verify.html` e `tools/verify-game.js`. Gli ack restano una prova firmata di ciò che il server ha accettato: la storia che il server mostra deve passare per la `head` di ogni ack e arrivare all'hash pubblicato nel risultato.

## A cosa servono

- **Prima:** il giocatore doveva fidarsi del server anche per la storia pubblicata. Il server avrebbe potuto:
  - accettare una mossa e poi pubblicare una partita diversa;
  - oppure pubblicare la partita senza quella mossa.
  Il giocatore non aveva modo di dimostrarlo.
- **Adesso:** per ogni comando accettato il server firma che cosa è diventata la partita. Il giocatore conserva queste firme. Se la storia che il server mostra le contraddice, la firma è una **prova**: solo la chiave del server può averla prodotta.

## Cosa firma il server

Il testo firmato è JSON canonico:

```json
{"at":1790294286880,"cmd":"<commandId>","g":"<gameId>","head":"<hex64>","key":"STM…","kind":"m8tcg_ack","seq":4,"v":1,"ver":2}
```

- `seq` e `head`: numero e hash di catena dell'ultimo evento prodotto dal comando. L'hash impegna tutta la catena fino a quell'evento (03 §6.2), quindi anche il comando stesso e tutto ciò che è venuto prima.
- `ver`: la versione del motore raggiunta; `at`: l'ora del server; `key`: la chiave pubblica che firma.
- **Firma:** secp256k1 come `signBuffer` di Keychain (sha256 del testo, firma compatta con recupero). Si verifica con gli stessi strumenti del login.
- **Ack sul canale:** `game.ack` diventa `{ "commandId", "ok": true, "version", "head", "seq", "at", "key", "sig" }`.
  - Un comando rimandato riceve lo stesso ack firmato (è salvato nel database).
  - I comandi rifiutati e le mosse forzate non hanno ack firmato.
- **Costo:** circa 0,8 ms per ack su un core. A 170 comandi al secondo (08) sono circa il 14% di un core.

## La chiave degli ack

- **È una chiave dedicata** (`M8_ACK_KEY`, WIF). Non controlla nessun account e nessun fondo, e non deve essere la chiave di un broadcaster (il server rifiuta di partire).
- In https è obbligatoria. In sviluppo, se manca, il server ne crea una a ogni avvio e lo scrive nel log (`M8_ACK_KEY is not set…`): nessun manifest la nomina, quindi quegli ack non provano niente.
- **La fiducia viene dalla catena.** Il root pubblica con la chiave active un manifest `ack_keys`, per esempio da `/manifest.html` scegliendo "Ack keys":

  ```json
  {"from_block":0,"keys":["STM…"],"kind":"ack_keys","v":1}
  ```

  Le regole sono quelle dei broadcaster (03 §11): vale dal blocco del manifest in poi, mai prima; un manifest nuovo sostituisce il precedente; la lista vuota revoca tutto.
- **Quale manifest conta:** un ack è valido se la sua chiave era autorizzata quando la partita è stata creata (`GAME_CREATED`).
- Il server avvisa nel log finché la sua chiave non è nominata da un manifest irreversibile.
- Il messaggio `welcome` comunica al client la chiave in uso (`ackKey`).

## Cosa fa il client

- Controlla ogni ack appena arriva. Deve essere ben formato, firmato dalla chiave che nomina, e quella chiave deve essere quella annunciata nel `welcome`. Se non lo è:
  - la mossa resta valida (decide il server);
  - il giocatore vede l'errore `BAD_ACK`: quel server non gli dà prove.
- Conserva gli ack nel browser, per partita, per le ultime 20 partite (`m8.acks.<gameId>`).

## Limiti

- **Una chiave degli ack rubata permette di fabbricare "prove" contro il server** per le partite create mentre era autorizzata. Dopo un furto:
  - si revoca subito con un manifest `ack_keys` nuovo (07 §4.3);
  - le contestazioni su partite create tra il furto e la revoca vanno giudicate con cautela.
- **Gli ack non dicono chi ha deciso la mossa.** Provano cosa il server ha accettato, non che l'abbia voluto il giocatore. Per questo c'è la firma delle mosse con chiave di sessione (protocollo v2, 12).
- **Un server può rifiutarsi di rispondere.** Un comando senza ack non prova niente in nessuna direzione. Il client lo vede come un comando non confermato.
