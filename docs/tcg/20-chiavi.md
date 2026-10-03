# 20 — Accesso con le proprie chiavi

**Stato:** 2026-10-03.
- **Client:** login con posting key (oltre a Keychain), posting key salvata cifrata nel browser e ricaricata all'avvio, active key chiesta solo quando serve un trasferimento e salvabile con un PIN.
- **Server:** verifica dei ruoli di una chiave sulla blockchain, riferimento al blocco per firmare, inoltro dei trasferimenti firmati nel browser.
- **Non ancora:** login con master password, scelta di un PIN senza salvare la chiave per altri dispositivi.

Modello preso da cur8.fun: la posting key è la chiave di tutti i giorni, la active key si chiede a parte e solo quando serve.

## Decisioni

| Decisione | Perché |
|---|---|
| Keychain resta: il login offre **Posting key** e **Keychain**; con l'estensione installata si parte da Keychain, altrimenti (telefono) dalla posting key. | Con Keychain le chiavi non entrano mai nella pagina: chi ce l'ha non perde niente. Sul telefono Keychain di solito non c'è. |
| La posting key si accetta solo se la blockchain dice che è una posting key dell'account **e niente di più**: una chiave che controlla anche active o owner è rifiutata. | La posting key si salva con una protezione debole (vedi sotto): una chiave che può spostare fondi non deve mai finire lì. |
| La posting key è salvata **cifrata AES-GCM** in localStorage; la chiave di cifratura del dispositivo è nello stesso localStorage. | Protegge da un'occhiata allo storage, non da chi può leggere tutti i dati del browser. È la stessa scelta di cur8.fun. |
| La active key si chiede **solo** quando un trasferimento la richiede, si verifica sulla blockchain e, se il giocatore vuole, si salva cifrata con un **PIN** che non viene mai memorizzato. | Il PIN serve a derivare la chiave di cifratura: senza PIN la chiave salvata non si apre. |
| La active key sbloccata resta **in memoria fino alla chiusura della pagina**; all'avvio non si sblocca mai da sola. | Un pagamento dopo l'altro non chiede il PIN ogni volta, ma ogni visita sì. |
| I trasferimenti firmati nel browser passano dal **server di gioco**, che li inoltra al nodo. | La pagina non parla con i nodi STEEM (la CSP resta `connect-src 'self'`), il failover dei nodi è uno solo. Il server non può cambiare quello che è firmato. |
| Il logout dimentica tutte le chiavi dell'account (posting e active salvata). Anche un login con Keychain dimentica le chiavi salvate. | Un browser, un giocatore: le chiavi di chi c'era prima non restano. |

## Il flusso

**Login con posting key.** Il giocatore scrive l'account e incolla la chiave (il campo è mascherato; Ctrl+V funziona anche sul canvas, sul telefono il campo è un `input type=password`). Il client:

1. ricava la chiave pubblica e chiede `POST /api/auth/key-roles { account, publicKey }`: i ruoli che la chiave soddisfa **da sola** (`owner`, `active`, `posting`). Deve essere `["posting"]`;
2. fa il solito login a challenge (doc 02 §2): firma il messaggio con la posting key come farebbe `requestSignBuffer` di Keychain;
3. solo dopo che il server ha aperto la sessione salva la chiave cifrata (`magic8.keys.posting`).

**All'avvio** la posting key salvata si decifra e si carica in memoria. Se il cookie di sessione è scaduto, il client rifà il login da solo con la chiave; se la blockchain non la accetta più (chiave cambiata) la dimentica, se non si è potuta controllare (rete) la tiene per la prossima volta.

**Partite online.** L'autorizzazione della chiave di partita (doc 12) si firma con la posting key, senza finestre da approvare.

**Pagamenti (shop e mercato).** Il `WalletSwitch` passa il trasferimento al wallet con cui il giocatore ha fatto login. Con le proprie chiavi:

1. se la active key non è in memoria, compare il dialogo **Active key needed** sopra la schermata (sopra anche al carrello: è un overlay della scena che le ricostruzioni della scena non toccano):
   - nessuna chiave salvata: active key + PIN facoltativo (almeno 4 caratteri) per salvarla;
   - chiave salvata: il PIN, oppure **Use another key** (dimentica quella salvata);
2. la chiave si verifica (`key-roles` deve contenere `active`); una risposta sbagliata riapre il dialogo con il motivo;
3. il client chiede `GET /api/wallet/reference` (blocco di riferimento, TaPoS), costruisce il `transfer` **dalle istruzioni di pagamento del server**, lo firma e lo manda a `POST /api/wallet/transfers`;
4. il server accetta solo **un singolo transfer dall'account della sessione**, lo ricodifica da quello che ha controllato e lo trasmette con `condenser_api.broadcast_transaction`; risponde con l'id della transazione.

Un rifiuto della blockchain (fondi insufficienti, autorità mancante) arriva al giocatore con il motivo del nodo. Un errore di rete dopo l'invio **non** prova che il trasferimento non sia partito: il messaggio dice di controllare il wallet prima di pagare di nuovo (come per un timeout di Keychain).

## Formato salvato

Tutto in localStorage, prefisso `magic8.keys.`:

| Chiave | Contenuto |
|---|---|
| `device` | 32 byte casuali (base64): la chiave AES-GCM del dispositivo. |
| `posting` | `{ v: 1, iv, data }`: `{ account, wif }` cifrato con la chiave del dispositivo. |
| `active.<account>` | `{ v: 1, salt, iterations, iv, data }`: la WIF cifrata con una chiave derivata dal PIN (PBKDF2-SHA-256, 600.000 iterazioni, salt di 16 byte). |

Ogni segreto è legato al suo nome (dati aggiuntivi di AES-GCM): un blob spostato sotto un altro nome non si apre. Un PIN sbagliato fa fallire l'autenticazione di AES-GCM.

## Limiti da conoscere

- Chi ha accesso a tutti i dati del browser (malware, profilo copiato) legge la posting key: può pubblicare a nome del giocatore, non spostare fondi.
- La active key salvata resiste quanto il PIN: con lo storage in mano, un PIN corto si prova per forza bruta offline (PBKDF2 la rallenta, non la impedisce). Il dialogo chiede almeno 4 caratteri: 4 cifre sono 10.000 combinazioni, che si provano in pochi secondi; un PIN più lungo (o con lettere) resiste di più.
- Uno script iniettato nella pagina (XSS) potrebbe usare le chiavi in memoria finché la pagina è aperta: la CSP rigida (doc 05) è la difesa.

## Dove sta il codice

- `packages/steem`: serializzazione del `transfer` (`transactions/transaction.js`), `SteemWalletProvider.keyRolesOf` / `reference` / `broadcastTransfer`.
- `packages/server`: `AuthService.keyRoles` / `chainReference` / `relayTransfer`, rotte in `identity/http/identityRoutes.js`.
- `packages/client`: `KeyVault` e `LocalKeyWallet` (`infrastructure/wallet`), `HttpWalletApi`, `ActiveKeyPrompt` e `WalletSwitch` (`application/wallet`), `IdentityService.signInWithKey`, `LoginScene`, `ActiveKeyDialog`, `Scene.showOverlay`, campi `TextField` con `keyboard: "secret"` e incolla.
