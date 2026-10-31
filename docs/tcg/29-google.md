# 29 — Entrare con Google (wallet custodito)

**Stato:** 2026-10-31. Fase 1 (API partner di join.cur8) pubblicata. Fase 2 (server: login Google, creazione dell'account, chiavi custodite) nel repository. Fase 3 (le firme del server) nel repository. Fase 4 (client) nel repository. Fase 5 (Export wallet, documenti di sicurezza) scritta e provata, non ancora pubblicata. Manca solo la frase nei termini d'uso: il gioco non ha ancora una pagina dei termini.

Chi non conosce le crypto entra con **Continue with Google**, sceglie un nome e gioca: niente chiavi, niente PIN, niente estensioni. Le chiavi del suo account STEEM le crea e le custodisce il server di gioco, che firma al suo posto. Quando vuole, il giocatore le **esporta** dal Profilo e da lì può usarle dove vuole.

Chi vuole tenere le chiavi per sé ha già tutto: un account creato su join.cur8.fun (chiavi mostrate una volta e mai salvate) e il login con la posting key o Keychain (20). Quei percorsi non cambiano.

## Decisioni

| Decisione | Perché |
|---|---|
| **Wallet custodito**: le chiavi degli account Google stanno sul server di gioco, cifrate, e il server firma per il giocatore. | Chi entra con Google non vuole sapere cosa sia una chiave. Si fida di noi: il modello lo dice chiaramente invece di fingere una sicurezza che con un PIN corto non ci sarebbe. |
| Google, custodia e firme stanno **tutti in KIJAM**. join.cur8 fa una cosa sola: crea l'account. | Un solo sistema da costruire e da far funzionare; nessuna API tra servizi per login e pagamenti. |
| L'account lo crea **join.cur8 da server a server** (chiave partner), con un ticket di cur8. | Creare un account richiede la active key del creatore: resta solo su join. cur8 paga la creazione ed è il recovery account, come per gli account fatti su join. |
| Le chiavi le genera join (master password → chiavi, come oggi) e le restituisce **solo al server di KIJAM**, che le cifra subito. | È il codice che join usa già; il giocatore non le vede passare. |
| **Un account per ogni identità Google**, la stessa regola di join: join riconosce il `sub` di Google anche se l'account l'ha fatto sul suo sito. | Niente account gratuiti in serie. Chi ha già un account join fatto con Google lo ritrova invece di averne un secondo. |
| **Nessun limite di spesa.** | Scelta del 2026-10-31: i giocatori Google si fidano al 100%, un limite sarebbe solo un attrito. |
| Il server firma **solo** i trasferimenti che pagano un pagamento aperto dal server stesso per quel giocatore (ordine dello shop, ticket compresi, o prenotazione del mercato). | Non è un limite di spesa: è che il wallet custodito non è un wallet generico. Uno script iniettato nella pagina può al massimo comprare qualcosa, non mandare i fondi altrove. Per spostare STEEM liberamente il giocatore esporta le chiavi. |
| Si paga **con il metodo del login** (20): entrato con Google → wallet custodito; entrato con la posting key o Keychain → quelli, anche per un account custodito. | Nessun ripiego silenzioso da un metodo all'altro. |
| **Export wallet** chiede un accesso con Google recente (10 minuti). | Una sessione dimenticata aperta su un computer altrui non regala le chiavi. |
| Il login con Google lo fa **il server** (redirect OAuth, authorization code + PKCE). | Nessuno script di Google nella pagina: la CSP resta `connect-src 'self'`. |

## Cosa vede il giocatore

**Primo accesso.** Login → *Continue with Google* → la pagina di Google → di ritorno nel gioco, *Choose your name* (le regole dei nomi STEEM, controllo di disponibilità mentre scrive) → *Create account* → si è dentro. Un breve messaggio dice che il wallet è tenuto da KIJAM e si può esportare dal Profilo.

**Accessi successivi.** *Continue with Google* e si è dentro, da qualsiasi dispositivo. Nel browser non resta nessun segreto: solo il cookie di sessione e il metodo del login (`magic8.signin`, `method: "google"`).

**Pagare.** Il bottone d'acquisto basta, come oggi: nessun dialogo in più. Il tracker dell'acquisto (shop, ticket, mercato) è lo stesso.

**Export wallet** (il riquadro dell'account, dalla foto in alto a destra, solo per chi è entrato con Google). Google chiede di nuovo la password, poi il gioco torna alla Home e mostra *Your wallet*: un avviso (*Anyone with these keys controls your account and its STEEM. Keep them private: KIJAM will never ask you for them.*), l'account, la master password e le quattro chiavi, ognuna con *Copy* (sul telefono non c'è posto per scriverle tutte con bottoni abbastanza grandi: lì ogni chiave è un bottone *Copy …*, due per riga), e *Download file* (`kijam-wallet-<account>.txt`, fatto nel browser). Chiudendo il riquadro, o cambiando schermata, le chiavi spariscono dalla pagina.

**Chi ha già un account join fatto con Google.** Il gioco lo riconosce e mostra il login con la posting key con il suo nome già scritto: *You already have the account @name. Sign in with its posting key or Keychain.* Le sue chiavi non le abbiamo e non le chiediamo.

## Il flusso sul server

0. `GET /api/auth/options` → `{ google: true | false }`: il client mostra il bottone solo se il server ha la configurazione.
1. `GET /api/auth/google/start` → il cookie `m8_google_flow` (10 minuti, `SameSite=Lax`, perché uno `Strict` non tornerebbe col redirect di Google) con `state`, `nonce` e il verificatore PKCE **cifrati con SecretBox** (sul server non si salva niente), poi il redirect a Google (`openid email`, `prompt=select_account`). Per Export wallet (fase 5) servirà anche `prompt=login`.
2. `GET /api/auth/google/callback?code&state`: `state` uguale al cookie; il codice si scambia con Google da server a server (segreto del client + verificatore). L'`id_token` arriva direttamente da Google su TLS: si controllano `iss`, `aud`, `exp`, `nonce` ed `email_verified`. Poi:
   - identità Google già legata a un utente → prima si controlla sulla catena che la posting key custodita sia ancora dell'account; se sì, sessione aperta e redirect a `/`;
   - legata, ma il giocatore ha cambiato le chiavi dell'account (dopo averle esportate) → le chiavi custodite non servono più e si cancellano (audit `auth.google_keys_released`), redirect a `/?google=existing&account=<nome>&keys=own`: da qui in poi entra con le sue chiavi. Se la catena non risponde la sessione si apre lo stesso: il job di T18 la chiude dopo, se serve;
   - identità nuova, ma join ha già un account per questo `sub` → redirect a `/?google=existing&account=<nome>`; non si salva niente;
   - identità nuova → il cookie di registrazione `m8_google_signup` (30 minuti, cifrato: `sub` ed email, l'email solo se lunga al massimo 100 caratteri perché un cookie ne tiene 512), redirect a `/?google=new`;
   - qualsiasi altro esito → redirect a `/?google=error&reason=<motivo>`: `cancelled` (il giocatore ha annullato su Google), `expired` (cookie scaduto o `state` diverso), `unavailable` (Google o join non rispondono), `failed` (ID token sbagliato, account sospeso, errore imprevisto). Il callback non risponde mai JSON: il browser torna sempre nel gioco.
3. `GET /api/auth/google/names?name=<nome>` (cookie di registrazione) → `{ name, available, reason }`, con `reason` `"invalid"`, `"taken"` o `null`. Il nome va nella query perché i nomi STEEM possono contenere il punto.
4. `POST /api/auth/google/accounts { account }` (cookie di registrazione) → join crea l'account e risponde con le chiavi; il server controlla che siano WIF valide, ne ricava le chiavi pubbliche, le cifra, lega l'identità al nuovo utente e apre la sessione. Errori per il giocatore: `SIGNUP_EXPIRED` (401, rifare il login con Google), `NAME_TAKEN` (409), `INVALID_ACCOUNT` (400), `CONFLICT` (409, questo Google ha già creato un account altrove: `details.account`), `ACCOUNTS_UNAVAILABLE` (503: join non risponde o cur8 non ha ticket). Se la richiesta arriva due volte, la seconda trova l'identità già legata e apre solo la sessione.
   Dopo la risposta di join l'account esiste sulla catena e le sue chiavi sono solo qui: utente, chiavi custodite, legame con Google e sessione si scrivono in una sola transazione. Se quella fallisce le chiavi vanno perse; il server lo scrive nel log (con il nome, mai le chiavi) e l'account si recupera solo a mano tramite cur8, il recovery account.
5. La sessione ricorda come è nata: `sessions.method` `"signature"` (challenge firmata, 02 §2) o `"google"`. `login_public_key` è la posting key custodita, così il job di T18 vale anche qui: se il giocatore cambia le chiavi dopo averle esportate, le sessioni Google si chiudono e il wallet custodito smette di funzionare (lo si dice, vedi limiti).

## Le firme del server

Modulo nuovo `custody`. Le rotte richiedono una sessione `"google"` di un utente con chiavi custodite; ogni firma finisce nell'audit (`custody.*`). Le chiavi si aprono in memoria per la sola firma, non si scrivono mai nei log.

| Rotta | Firma | Quando |
|---|---|---|
| `POST /api/custody/transfers { from, to, amount, asset, memo }` | active | solo se corrisponde esattamente (rete, mittente, destinatario, importo, asset, memo) a un pagamento aperto **del giocatore** e non scaduto: un ordine dello shop ancora da pagare (`marketplace`) o una prenotazione del mercato (`sales`). Ognuno dei due moduli risponde `openPayment(userId, memo)`. Risponde `{ txId }`, come l'inoltro di oggi. Altrimenti `PAYMENT_NOT_OPEN` (409). |
| `POST /api/custody/messages { message }` | posting | solo il testo d'autorizzazione di una chiave di partita (12), `m8tcg session <partita> <chiave>`; ogni altro testo è `FORBIDDEN`. Il login non serve: la sessione c'è già. Risponde `{ signature }`. |
| `POST /api/custody/pings { parentAuthor, parentPermlink, permlink, title, body, jsonMetadata }` | posting | l'autore è l'account custodito; il commento si costruisce e si firma sul server, poi passa da `PingService.relay`, gli stessi controlli dei ping firmati nel browser (26): sotto il muro, lunghezza. Risponde `{ txId }`. |
| `POST /api/custody/export` | — | sessione Google **e** un nuovo accesso a Google negli ultimi 10 minuti, altrimenti `REAUTH_REQUIRED` (403). Risponde `{ wallet: { account, masterPassword, owner, active, posting, memo } }` con `Cache-Control: no-store`, segna `exported_at`, audit `custody.exported`, e cancella il cookie della prova. |

**Rientrare con Google prima dell'export.** `GET /api/auth/google/start?purpose=export` manda a Google con `prompt=login` e `max_age=0`: Google chiede la password anche se il browser è già collegato. Non sempre però mette nell'ID token `auth_time` (provato in produzione il 2026-10-31: senza, l'export non partiva). Al ritorno non si apre una sessione: se l'identità è legata a un utente e, quando c'è, `auth_time` è degli ultimi 10 minuti, il server mette il cookie `m8_google_reauth` (cifrato: l'utente e la scadenza, 10 minuti, `Strict`) e manda a `/?google=export`, dove il client chiede le chiavi (`WalletExport.resume`, una volta sola: niente giri infiniti verso Google). Il cookie non è registrato sul server: una sua copia rubata vale fino alla scadenza, non oltre. Senza `auth_time` la prova vale quanto la sessione Google del browser: chi la controlla entra comunque in KIJAM con Google. Se il nuovo accesso non va a buon fine (annullato, rifiutato) per un giocatore già dentro, il gioco lo dice invece di restare in silenzio sulla Home.

**Un pagamento si firma una volta sola.** Prima della trasmissione il server scrive il memo in `custody_transfers` (chiave primaria): una seconda richiesta per lo stesso pagamento riceve `ALREADY_PAID` (409, `details.txId`). La riga si cancella solo se la catena ha rifiutato il trasferimento (`TRANSFER_REJECTED`) o se non si è trasmesso niente (catena irraggiungibile prima della firma): allora si può ripagare. Se invece la trasmissione fallisce senza sapere se il trasferimento è passato, la riga resta e la risposta è `CHAIN_UNAVAILABLE` con `details.txId`: niente doppio pagamento; se il trasferimento non arriva davvero, l'ordine scade e il giocatore ne fa un altro.

Le firme valgono solo per una sessione `"google"`: chi è entrato con le sue chiavi riceve `FORBIDDEN` anche se il server custodisce quell'account (si paga con il metodo del login). Le chiavi si aprono per la sola firma; l'audit registra `custody.transfer_signed` (txId, destinatario, importo, memo), `custody.session_authorized` (partita), `custody.ping_signed`.

## Il client

- **Quale sessione è di Google** lo dice il server: `GET /api/me` risponde anche `method` (`"signature"` o `"google"`). `IdentityService` ha il terzo metodo `SignInMethod.GOOGLE`: una sessione Google ripresa dopo un ricaricamento resta di Google qualunque chiave tenga il browser (le chiavi di un giocatore precedente si dimenticano), e `adoptGoogleSession` adotta quella aperta dal server alla creazione dell'account. `magic8.signin` ricorda `"google"`.
- **`GoogleSignInService`** (application): chiede a `/api/auth/options` se offrire Google, `start()` fa la visita a pagina intera a `/api/auth/google/start`, `nameStatus` e `createAccount` per la scelta del nome. `readGoogleReturn` legge `?google=…` all'avvio; `main.js` lo toglie subito dall'indirizzo (`history.replaceState`), così un ricaricamento non lo ripete. Il ritorno si consegna una volta sola (`take`) alla schermata che lo mostra.
- **Dove si apre il gioco**: `?google=new` → `GoogleNameScene` (*Choose your name*: controllo del nome quando il giocatore smette di scrivere, *Create account*, poi Home); `existing` ed `error` → il login, con il messaggio e il nome già scritto; altrimenti Home.
- **Il login** ha la scheda *Google* accanto a *Posting key* e *Keychain*, solo se il server la offre. Si apre su Keychain se l'estensione c'è, altrimenti su Google, altrimenti sulla posting key.
- **`CustodialWallet`** (`infrastructure/wallet`, sopra `HttpCustodyApi`) implementa `WalletConnector` con le rotte qui sopra; `WalletSwitch` lo usa per il metodo `"google"`. `ALREADY_PAID` con un `txId` vale come pagato (un secondo tocco, un ricaricamento); un esito incerto è `WALLET_TIMEOUT`, mai un secondo invio. Nel tracker dell'acquisto il passo del pagamento dice *Paying from your KIJAM wallet…*; il dialogo dell'account *Signed in … with Google*.
- Test: `test/application/googleSignIn.test.js`, `test/rendering/googleName.test.js`, i casi Google in `test/rendering/login.test.js`.

## join.cur8: l'API partner

Due rotte nuove, protette da `X-Partner-Key` (variabile `PARTNER_KEYS`, `nome:segreto,…`), senza cookie e senza CORS: le chiama solo il server di KIJAM.

- `GET /api/partner/google/{sub}` → `{ steem_username }` se questa identità Google ha già un account fatto su join, altrimenti `null`.
- `POST /api/partner/accounts { google_sub, email, username, app }` → crea l'account con un ticket di cur8 (stesse regole di nome, disponibilità e ticket del sito) e registra l'utente su join (`auth_provider "google"`, `account_created`), così il sito e il pannello admin lo vedono come gli altri. Risponde le chiavi (master password + quattro chiavi private), nella stessa forma del sito. `409` con `code` `ALREADY_CREATED` (e il nome) o `USERNAME_TAKEN`, `400` per un nome non valido, `503` senza ticket o senza catena. Le creazioni passano una alla volta, così due richieste per la stessa identità non creano due account. `app` finisce nel `json_metadata` dell'account (`"kijam"`).

Join non conserva le chiavi, come oggi.

## Formato salvato

Migrazione `025_google_sign_in.sql`:

| Tabella | Contenuto |
|---|---|
| `google_identities` | `sub` (chiave), `user_id` (unico: un account per identità e viceversa), `email`, `created_at`, `last_login_at`. Una riga nasce solo con l'account: le registrazioni a metà stanno nel cookie. |
| `custody_keys` | `user_id` (chiave), `network`, `account`, `posting_public`, `keys_encrypted` (SecretBox, contesto `custody_keys:<user_id>`: JSON con master password e chiavi private), `created_at`, `exported_at`. |
| `sessions` | colonna nuova `method`, `'signature'` per tutte le sessioni di prima. |

Migrazione `026_custody_transfers.sql`: `custody_transfers` (`memo` chiave, `user_id`, `tx_id`, `created_at`), un trasferimento firmato per riferimento di pagamento.

La rotazione della chiave dei dati (`rotateDataKey.js`, runbook 07) cifra di nuovo anche `custody_keys`.

Configurazione: `M8_GOOGLE_CLIENT_ID`, `M8_GOOGLE_CLIENT_SECRET`, `M8_JOIN_URL`, `M8_JOIN_PARTNER_KEY`. Nessuna delle quattro: la funzione è spenta e il bottone non c'è. Solo alcune: il server non parte e dice quali mancano. L'indirizzo di ritorno registrato su Google è `<M8_PUBLIC_ORIGIN>/api/auth/google/callback`.

**Dove sta il codice (fase 2).** `@magic8/steem`: `SteemKeyring` (chiave pubblica di una WIF), `SteemWalletProvider.accountExists`. Server, modulo `identity`: `GoogleSignIn` (application), `verifiedGoogleIdentity` (domain), `GoogleOAuthClient` e `JoinAccountFactory` (infrastructure), `PgGoogleIdentityRepository`, `googleRoutes.js`, `AuthService.openVouchedSession`. Modulo nuovo `custody`: `KeyCustody` (conserva le chiavi e dice l'account custodito di un utente), `PgCustodyRepository`. Test: `test/identity/googleSignIn.test.js` (il flusso su HTTP vero), `googleAdapters.test.js`.

**Dove sta il codice (fase 3).** `SteemKeyring` firma un messaggio, un trasferimento e un commento. Modulo `custody`: `CustodialSigner` (application), `signable.js` (domain: cosa si può firmare), `custodyRoutes.js`, `KeyCustody.keysOf` e `forget`. `MarketplaceService.openPayment`, `SalesService.openPayment`. `GoogleSignIn` controlla la chiave custodita a ogni accesso. Test: `test/custody/custodialSigner.test.js`.

**Dove sta il codice (fase 5).** Server: `GoogleSignIn` (`GooglePurpose.EXPORT`, `reauthenticatedUser`), `googleReauthentication` in `googleRoutes.js`, `WalletExport` (custody). Client: `WalletExport` (application/wallet), `ExportWalletDialog` e il bottone *Export wallet* in `AccountDialog` (shell), `BrowserClipboard` e `BrowserFileSaver` (infrastructure/browser). Test: il caso export in `googleSignIn.test.js` (server), `test/application/googleSignIn.test.js` e `test/rendering/exportWallet.test.js` (client).

## Cosa cambia nel modello di sicurezza

Finora il server non teneva **mai** chiavi capaci di spostare fondi (05 T23, panoramica §11). Per gli account Google questo non vale più, per scelta:

- **T23 (furto del DB).** Un dump del DB da solo non apre niente: le chiavi sono cifrate con `M8_DATA_KEY`, che sta nell'ambiente. Chi ha DB **e** ambiente ha tutte le chiavi custodite.
- **T33 (il server gioca al posto di un giocatore).** Per un account custodito il server può autorizzare da solo una chiave di partita: la garanzia delle mosse firmate vale solo per chi firma con le proprie chiavi.
- Le chiavi dello shop e della root restano fuori dal server, e i broadcaster restano solo posting: il controllo all'avvio non cambia.
- I termini d'uso devono dirlo: *the wallet of a Google account is held by KIJAM; you can export it at any time.*

## Limiti da conoscere

- Chi perde l'accesso al suo account Google perde il wallet custodito, a meno di averlo esportato. Il recupero passa da un intervento a mano (cur8 è il recovery account per la owner key).
- Se il giocatore cambia le chiavi dopo averle esportate, quelle custodite non valgono più: il job di T18 chiude le sessioni Google, il login con Google successivo cancella le chiavi custodite e gli dice di entrare con le sue. L'account resta lo stesso utente (mazzi, carte, classifica): un utente è il suo account STEEM, non il modo di entrare.
- Un trasferimento finito nel dubbio (la catena non ha risposto alla trasmissione) blocca quel pagamento finché l'ordine scade.
- Solo Google per ora; il login con email di join non è previsto qui.

## Fasi

1. **join.cur8** (pubblicata): API partner (lookup per `sub`, creazione con chiave partner).
2. **Server** (nel repository): OAuth Google, `google_identities`, creazione dell'account tramite join, `custody_keys` in SecretBox, `sessions.method`.
3. **Firme** (nel repository): modulo `custody` (trasferimenti dei pagamenti aperti, autorizzazioni di partita, ping), audit; controllo della chiave custodita al login.
4. **Client** (scritta): scheda Google nel login e scelta del nome, `CustodialWallet`, metodo `"google"` in `IdentityService` e `WalletSwitch`, `method` in `/api/me`.
5. **Export wallet** (scritta) nel riquadro dell'account, con il nuovo accesso a Google; aggiornati 05 (asset, T23, T33, T36, rischio residuo 5), 20 e la panoramica. Da fare fuori dal codice: la frase dei termini d'uso, quando il gioco ne avrà una pagina.
