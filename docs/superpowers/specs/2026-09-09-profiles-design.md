# Profili stile Netflix — design

Data: 2026-09-09. Stato: approvato in chat, in attesa di piano di implementazione.

## Obiettivo

Più persone sulla stessa installazione di Neftlix, ognuna con i propri progressi, preferiti e watchlist. Schermata "Chi sta guardando?" all'avvio, cambio profilo dalla Nav. Il provider Xtream resta unico e lo imposta chi installa.

Fuori scope: PIN, profili bambini, provider multipli, avatar con immagini personalizzate, autenticazione dell'app (resta `NEFTLIX_PASSWORD` con Basic Auth).

## Decisioni

- **Il profilo attivo è identificato da un cookie** (`neftlix_profile`) impostato dal server. Ogni dispositivo ricorda il proprio ultimo profilo. Alternative scartate: header custom (rompe `sendBeacon`), id nel path delle API (cambia tutte le URL).
- **Massimo 5 profili.**
- **Avatar**: uno di 8 colori preimpostati; la tile mostra l'iniziale del nome. Nessun upload.
- **Nessuna dipendenza nuova**: il cookie si legge e si scrive a mano (una riga di parsing, una di `Set-Cookie`).
- **Installazioni esistenti** non perdono nulla: la migrazione crea il profilo "Principale" e gli assegna tutti i dati.

## Dati (`server/src/db.ts`)

Nuova tabella:

```sql
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,          -- chiave di un colore preimpostato, es. 'red'
  created_at INTEGER NOT NULL
);
```

`progress`, `watchlist` e `favorite` ricevono `profile_id INTEGER NOT NULL` e la chiave primaria diventa `(profile_id, item_type, item_id)`. Gli indici esistenti su `progress` restano e ne viene aggiunto uno su `(profile_id, updated_at DESC)`.

**Migrazione** (in `migrate()`, idempotente): se `progress` non ha la colonna `profile_id`:

1. Crea le tre tabelle nella forma nuova con suffisso `_new`.
2. Se le vecchie tabelle contengono almeno una riga, oppure esiste una riga in `account`, inserisce il profilo `(1, 'Principale', 'red', now)`.
3. Copia le righe vecchie nelle nuove con `profile_id = 1`.
4. Elimina le vecchie e rinomina le nuove. Tutto in una transazione.

Un DB nuovo non ha profili: il primo lo crea l'utente dalla UI.

Eliminare un profilo cancella le sue righe nelle tre tabelle (nella stessa transazione, nessun `ON DELETE CASCADE` per non dipendere da `foreign_keys`).

## Server

### Nuovo file `server/src/profiles.ts`

Esporta `registerProfileRoutes(app, ctx)` e `AVATARS` (le 8 chiavi). Rotte:

| Metodo | Path | Corpo / effetto |
|---|---|---|
| GET | `/api/profiles` | `{ items: Profile[], current: number \| null }` |
| POST | `/api/profiles` | `{ name, avatar }` → crea, 400 se nome vuoto o avatar sconosciuto, 409 se già 5 profili. Restituisce il profilo. |
| PATCH | `/api/profiles/:id` | `{ name?, avatar? }` → aggiorna, 404 se non esiste |
| DELETE | `/api/profiles/:id` | elimina profilo e dati; se era quello del cookie, il cookie viene cancellato |
| POST | `/api/profiles/:id/select` | 404 se non esiste; imposta il cookie; restituisce il profilo |
| POST | `/api/profiles/deselect` | cancella il cookie |

`Profile = { id: number; name: string; avatar: string }`. Il nome è trimmato e limitato a 20 caratteri.

Cookie: `neftlix_profile=<id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`. Cancellazione con `Max-Age=0`.

### Hook di richiesta

In `profiles.ts`, un `onRequest` hook registrato su `app`:

- Legge il cookie, verifica che l'id esista in `profile`, e mette `req.profileId: number | null` (dichiarazione di modulo su `FastifyRequest`).
- Se l'URL inizia con `/api/` e non è nell'allowlist e `profileId` è `null`, risponde `401 { error: 'Profilo non selezionato', code: 'NO_PROFILE' }`.
- Allowlist: `/api/status`, `/api/setup`, `/api/sync`, `/api/profiles` (e sotto-path), `/api/settings` (e sotto-path). Gli `/stream/*` non sono toccati.

### Rotte esistenti (`routes.ts`)

Tutte le query che toccano `progress`, `favorite` o `watchlist` filtrano per `req.profileId`. In pratica:

- `MOVIE_CARD_JOIN` diventa una funzione `movieCardJoin(profileId)` che interpola l'intero (già validato dall'hook) nella condizione del join, così l'ordine dei parametri delle query esistenti non cambia.
- `continueWatching`, `seriesWithNewEpisodes`, `listCards`, `seriesNextUp` ricevono `profileId` come argomento.
- Le rotte `/api/movies/:key`, `/api/series/:id`, `/api/episodes/:id`, `/api/progress*`, `/api/watchlist*`, `/api/favorites*` aggiungono `profile_id` a `SELECT`, `INSERT` e `DELETE`.

`/api/status` aggiunge `profile: Profile | null` e `profiles: number` (conteggio), così il client sa se mostrare il picker senza una chiamata in più.

## Web

### Nuova pagina `web/src/pages/Profiles.tsx`

Schermo intero, senza Nav, stesso trattamento visivo della pagina Setup (sfondo scuro, logo in alto). Titolo "Chi sta guardando?".

- Griglia di tile: avatar quadrato colorato con iniziale, nome sotto. Ogni tile ha `data-focus` per la navigazione spaziale; la prima ha `autoFocus`.
- Tile "Aggiungi profilo" se i profili sono meno di 5. Apre un form inline (nome + scelta colore tra 8 pallini) con Salva/Annulla.
- Pulsante "Gestisci profili": in modalità gestione le tile mostrano una matita; cliccando si apre lo stesso form con in più "Elimina profilo" (con `confirm`). Il pulsante diventa "Fine".
- Selezionare una tile chiama `select`, poi `onDone()` (refresh dello status) e naviga a `/`.
- Con zero profili la pagina mostra solo il form di creazione, e il profilo appena creato viene selezionato automaticamente.

### `App.tsx`

Dopo il check `configured`, se `status.profile` è `null` renderizza `<Profiles onDone={refresh} />` al posto dell'app. La stessa pagina è montata sulla rotta `/profiles` (con la Nav nascosta, come per `/play/`), per cambiare profilo.

Ascolta l'evento `neftlix:no-profile` sulla `window` e richiama `refresh()`: `api.ts` lo emette quando una risposta ha `code === 'NO_PROFILE'`.

### `Nav.tsx`

Ultima voce: avatar del profilo attivo (cerchio colorato con iniziale) con label del nome, link a `/profiles`. Riceve `profile` come prop da `App`.

### `Settings.tsx`

Sezione "Profili" con il nome del profilo attivo e un pulsante "Gestisci profili" che porta a `/profiles?manage=1`.

### `api.ts` e `types.ts`

Nuovi metodi `profiles`, `createProfile`, `updateProfile`, `deleteProfile`, `selectProfile`, `deselectProfile`. `Status` guadagna `profile` e `profiles`. Tipo `Profile` e costante `AVATARS` (chiave → colore CSS) condivisi in `types.ts`.

### `Search.tsx`

La chiave localStorage della cronologia diventa `search.history.<profileId>`. L'id arriva via prop da `App`.

### CSS

Nuove classi `.profiles`, `.profile-tile`, `.profile-avatar`, `.profile-form`, `.avatar-picker`, `.nav-avatar`. Colori avatar definiti come custom property `--avatar-<key>` in `:root`.

## Gestione errori

- Cookie con id inesistente (profilo cancellato da un altro dispositivo): l'hook tratta la richiesta come senza profilo, il client riceve `NO_PROFILE`, torna al picker.
- Creazione oltre il limite: 409 con messaggio, il form lo mostra.
- Eliminazione dell'ultimo profilo: consentita; il picker mostra solo il form di creazione.

## Test

Nuova cartella `server/test/` con `node:test`, eseguita da `npm test` alla radice (`node --test server/test/`), aggiunta anche al job CI prima di `build`.

- `db.test.ts`: migrazione da uno schema vecchio con righe in `progress`/`favorite`/`watchlist` → nasce il profilo 1 e le righe hanno `profile_id = 1`; DB nuovo → nessun profilo; la migrazione è idempotente.
- `profiles.test.ts` (Fastify `inject`, DB `:memory:`): CRUD e limite 5; `select` imposta il cookie; senza cookie `/api/favorites` risponde 401 `NO_PROFILE` mentre `/api/status` risponde 200; i preferiti aggiunti con il profilo A non compaiono con il profilo B; eliminare A rimuove i suoi dati e non quelli di B.

Il frontend si verifica a mano nel browser (creazione, selezione, cambio, gestione, navigazione con tastiera) prima del commit finale.

## File toccati

Server: `db.ts`, `profiles.ts` (nuovo), `routes.ts`, `index.ts`, `test/*` (nuovi), `package.json`.
Web: `Profiles.tsx` (nuovo), `App.tsx`, `Nav.tsx`, `Settings.tsx`, `Search.tsx`, `api.ts`, `types.ts`, `styles.css`.
Repo: `package.json` (script `test`), `.github/workflows/ci.yml`, `README.md` / `README.it.md` (riga sui profili, checkbox roadmap), `CHANGELOG.md`.
