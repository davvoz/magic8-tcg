# 29 — Entrare con Google (wallet custodito)

**Stato:** 2026-10-31. Fase 1 (API partner di join.cur8) pubblicata. Fase 2 (server: login Google, creazione dell'account, chiavi custodite) scritta e provata con Google e join finti, non ancora pubblicata. Fasi 3–5 da fare.

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

**Export wallet** (Profilo). Un avviso (*Anyone with these keys controls your account and its STEEM. Keep them private.*), poi l'account, la master password e le quattro chiavi, ognuna con *Copy*, e *Download file* (un `.txt` fatto nel browser). Se l'accesso con Google non è recente il gioco lo rifà e torna al Profilo.

**Chi ha già un account join fatto con Google.** Il gioco lo riconosce e mostra il login con la posting key con il suo nome già scritto: *You already have the account @name. Sign in with its posting key or Keychain.* Le sue chiavi non le abbiamo e non le chiediamo.

## Il flusso sul server

0. `GET /api/auth/options` → `{ google: true | false }`: il client mostra il bottone solo se il server ha la configurazione.
1. `GET /api/auth/google/start` → il cookie `m8_google_flow` (10 minuti, `SameSite=Lax`, perché uno `Strict` non tornerebbe col redirect di Google) con `state`, `nonce` e il verificatore PKCE **cifrati con SecretBox** (sul server non si salva niente), poi il redirect a Google (`openid email`, `prompt=select_account`). Per Export wallet (fase 5) servirà anche `prompt=login`.
2. `GET /api/auth/google/callback?code&state`: `state` uguale al cookie; il codice si scambia con Google da server a server (segreto del client + verificatore). L'`id_token` arriva direttamente da Google su TLS: si controllano `iss`, `aud`, `exp`, `nonce` ed `email_verified`. Poi:
   - identità Google già legata a un utente → sessione aperta, redirect a `/`;
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
| `POST /api/custody/transfers { from, to, amount, asset, memo }` | active | solo se corrisponde esattamente a un pagamento aperto del giocatore: un ordine non pagato (`marketplace`) o una prenotazione attiva (`sales`). I due moduli rispondono a una porta comune (`OpenPayments`). Risponde l'id della transazione, come l'inoltro di oggi. |
| `POST /api/custody/messages { message }` | posting | solo il testo d'autorizzazione di una chiave di partita (12) dell'account. Il login non serve: la sessione c'è già. |
| `POST /api/custody/pings { … }` | posting | il commento si costruisce e si firma sul server, poi passa dagli stessi controlli dell'inoltro dei ping (26): muro, lunghezza, limiti. |
| `POST /api/custody/export` | — | sessione aperta da Google da al massimo 10 minuti, altrimenti `REAUTH_REQUIRED`. Risponde le chiavi con `Cache-Control: no-store`; segna `exported_at`. |

**Nel client** un nuovo `CustodialWallet` (`infrastructure/wallet`, sopra un `HttpCustodyApi`) implementa `WalletConnector`: `requestTransfer`, `signMessage` e `postComment` chiamano le rotte qui sopra. `WalletSwitch` lo usa quando il metodo del login è `"google"`. `IdentityService` impara il terzo metodo: all'avvio una sessione Google viva resta di Google; scaduta, si mostra il login.

## join.cur8: l'API partner

Due rotte nuove, protette da `X-Partner-Key` (variabile `PARTNER_KEYS`, `nome:segreto,…`), senza cookie e senza CORS: le chiama solo il server di KIJAM.

- `GET /api/partner/google/{sub}` → `{ steem_username }` se questa identità Google ha già un account fatto su join, altrimenti `null`.
- `POST /api/partner/accounts { google_sub, email, username, app }` → crea l'account con un ticket di cur8 (stesse regole di nome, disponibilità e ticket del sito) e registra l'utente su join (`auth_provider "google"`, `account_created`), così il sito e il pannello admin lo vedono come gli altri. Risponde le chiavi (master password + quattro chiavi private), nella stessa forma del sito. `409` con `code` `ALREADY_CREATED` (e il nome) o `USERNAME_TAKEN`, `400` per un nome non valido, `503` senza ticket o senza catena. Le creazioni passano una alla volta, così due richieste per la stessa identità non creano due account. `app` finisce nel `json_metadata` dell'account (`"kijam"`).

Join non conserva le chiavi, come oggi.

## Formato salvato

| Tabella | Contenuto |
|---|---|
Migrazione `025_google_sign_in.sql`:

| Tabella | Contenuto |
|---|---|
| `google_identities` | `sub` (chiave), `user_id` (unico: un account per identità e viceversa), `email`, `created_at`, `last_login_at`. Una riga nasce solo con l'account: le registrazioni a metà stanno nel cookie. |
| `custody_keys` | `user_id` (chiave), `network`, `account`, `posting_public`, `keys_encrypted` (SecretBox, contesto `custody_keys:<user_id>`: JSON con master password e chiavi private), `created_at`, `exported_at`. |
| `sessions` | colonna nuova `method`, `'signature'` per tutte le sessioni di prima. |

La rotazione della chiave dei dati (`rotateDataKey.js`, runbook 07) cifra di nuovo anche `custody_keys`.

Configurazione: `M8_GOOGLE_CLIENT_ID`, `M8_GOOGLE_CLIENT_SECRET`, `M8_JOIN_URL`, `M8_JOIN_PARTNER_KEY`. Nessuna delle quattro: la funzione è spenta e il bottone non c'è. Solo alcune: il server non parte e dice quali mancano. L'indirizzo di ritorno registrato su Google è `<M8_PUBLIC_ORIGIN>/api/auth/google/callback`.

**Dove sta il codice (fase 2).** `@magic8/steem`: `SteemKeyring` (chiave pubblica di una WIF), `SteemWalletProvider.accountExists`. Server, modulo `identity`: `GoogleSignIn` (application), `verifiedGoogleIdentity` (domain), `GoogleOAuthClient` e `JoinAccountFactory` (infrastructure), `PgGoogleIdentityRepository`, `googleRoutes.js`, `AuthService.openVouchedSession`. Modulo nuovo `custody`: `KeyCustody` (conserva le chiavi e dice l'account custodito di un utente), `PgCustodyRepository`. Test: `test/identity/googleSignIn.test.js` (il flusso su HTTP vero), `googleAdapters.test.js`.

## Cosa cambia nel modello di sicurezza

Finora il server non teneva **mai** chiavi capaci di spostare fondi (05 T23, panoramica §11). Per gli account Google questo non vale più, per scelta:

- **T23 (furto del DB).** Un dump del DB da solo non apre niente: le chiavi sono cifrate con `M8_DATA_KEY`, che sta nell'ambiente. Chi ha DB **e** ambiente ha tutte le chiavi custodite.
- **T33 (il server gioca al posto di un giocatore).** Per un account custodito il server può autorizzare da solo una chiave di partita: la garanzia delle mosse firmate vale solo per chi firma con le proprie chiavi.
- Le chiavi dello shop e della root restano fuori dal server, e i broadcaster restano solo posting: il controllo all'avvio non cambia.
- I termini d'uso devono dirlo: *the wallet of a Google account is held by KIJAM; you can export it at any time.*

## Limiti da conoscere

- Chi perde l'accesso al suo account Google perde il wallet custodito, a meno di averlo esportato. Il recupero passa da un intervento a mano (cur8 è il recovery account per la owner key).
- Se il giocatore cambia le chiavi dopo averle esportate, quelle custodite non valgono più: il gioco lo rileva (T18) e gli dice di entrare con le chiavi nuove.
- Solo Google per ora; il login con email di join non è previsto qui.

## Fasi

1. **join.cur8** (pubblicata): API partner (lookup per `sub`, creazione con chiave partner).
2. **Server** (scritta): OAuth Google, `google_identities`, creazione dell'account tramite join, `custody_keys` in SecretBox, `sessions.method`.
3. **Firme**: modulo `custody` (trasferimenti con `OpenPayments`, autorizzazioni di partita, ping), audit.
4. **Client**: bottone e scelta del nome, `CustodialWallet`, metodo `"google"` in `IdentityService` e `WalletSwitch`.
5. **Export wallet** nel Profilo, aggiornamento di 05, 20 e della panoramica.
