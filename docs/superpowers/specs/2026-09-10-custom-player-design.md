# Player con controlli custom — design e piano

Data: 2026-09-10. Stato: approvato in chat.

## Obiettivo

Sostituire i controlli nativi di Chromium (`<video controls>`) con una barra nostra, coerente con l'app, navigabile da tastiera e telecomando (`data-focus`), uguale su macOS, Windows e browser TV. Il `<video>` resta il motore: decodifica, hls.js per il live, salvataggio posizione, "visto", prossimo episodio.

Fuori scope: cambi al server, alle API, al catalogo; picture-in-picture; velocità di riproduzione; sottotitoli esterni (solo le tracce già nel flusso, se esposte).

## Comportamento

**Struttura** (`web/src/pages/Player.tsx` → resta il contenitore; nuovo `web/src/components/PlayerControls.tsx` + stili in `styles.css`):

- `<video>` senza `controls`, `playsInline`, `autoPlay`; clic sul video = play/pausa; doppio clic = schermo intero; cursore nascosto con i controlli.
- Barra in basso, sfumatura scura, visibile con `showUi` (stessa logica `poke` di oggi: 3,5 s dopo l'ultimo movimento/tasto; sempre visibile in pausa).
- Riga 1 (solo VOD): **barra di avanzamento** con buffer, tempo al passaggio del mouse (tooltip "1:23:45"), trascinamento/clic per il seek, tastiera ←/→ ±10 s e ↑/↓ ±60 s (come oggi), indicatore della posizione.
- Riga 2, da sinistra: **Play/Pausa**, **−10 s**, **+10 s**, **tempo** `12:34 / 1:30:00` (live: badge rosso "LIVE" + titolo in onda), **volume** (icona muto + slider orizzontale, valore ricordato in `localStorage['player.volume']`, muto in `player.muted`), spazio flessibile, **tracce** (menu audio/sottotitoli solo se `video.audioTracks`/`textTracks` ne espongono più di una / almeno una), **Prossimo episodio** (icona ⏭ con tooltip del titolo; solo se `meta.next`), **Canale ↑/↓** (solo live), **Schermo intero**.
- Toast "Prossimo episodio" negli ultimi 90 s: resta, posizionato sopra la barra a destra; l'icona ⏭ nella barra resta visibile.
- Overlay centrale: icona grande play/pausa che lampeggia 400 ms al toggle (feedback), spinner durante `waiting`.
- Titolo/sottotitolo in alto come oggi (`player-top`), con "‹ Indietro".
- Tutti i pulsanti sono `<button data-focus>` con `aria-label` italiano; la barra di avanzamento è un `<input type="range">` stilizzato (accessibile e focusabile); lo slider volume idem.
- Navigazione da telecomando: al primo `poke` da tastiera il focus va su Play/Pausa; frecce ←/→ sulla barra di avanzamento fanno seek; Esc esce (già gestito dall'app).

**Tasti globali del player** (invariati, spostati nel componente): Spazio/Invio/MediaPlayPause toggle (intercettati in capture su window, come ora, ma la condizione diventa "il focus è dentro `.player`" invece di "è il video"); ←/→ ±10 s; ↑/↓ ±60 s (live: canale); N prossimo; F schermo intero; M muto.

**Stato del video → UI**: ascolta `play`, `pause`, `timeupdate`, `progress` (buffer), `durationchange`, `volumechange`, `waiting`, `playing`, `ended`. Nessun polling.

**Live**: niente barra di avanzamento; tempo sostituito da "LIVE" e dal programma in onda (EPG già caricato in `Player.tsx`); canale ↑/↓ nella barra; la sovrimpressione EPG attuale (`player-epg`) resta.

**Touch** (telefono/tablet): tap sul video mostra/nasconde i controlli; i pulsanti hanno area ≥ 44 px.

## Piano

### Task 1 — `PlayerControls` e integrazione (un solo task, un implementer)

Files: `web/src/components/PlayerControls.tsx` (nuovo), `web/src/pages/Player.tsx`, `web/src/styles.css`, `web/src/components/Icons.tsx` (aggiungere icone: play, pausa, rewind10, forward10, volume, muto, next, fullscreen, exit-fullscreen, tracce, canale su/giù), `README.md` (tabella tasti: M muto).

Passi:
1. Leggere `Player.tsx` per intero (stato `meta`, `epg`, `showUi`/`poke`, `nearEnd`, `save`, `goNext`, `goChannel`, `goBack`, gestione tasti in capture, `onKey`), `spatial.ts` (regola `data-focus`, Enter → click) e le classi `.player*` in `styles.css`.
2. Creare `PlayerControls` con props: `video: HTMLVideoElement | null`, `live: boolean`, `title/subtitle`, `nowPlaying?` (EPG), `hasNext`, `nextLabel?`, `onNext`, `onPrevChannel?`, `onNextChannel?`, `visible: boolean`, `onInteract` (= `poke`). Il componente si sottoscrive agli eventi del video con `useEffect` e tiene in stato `paused, currentTime, duration, buffered, volume, muted, waiting, fullscreen`.
3. Togliere `controls` dal `<video>`, montare `<PlayerControls>` dentro `.player`, spostare lì i tasti (Spazio/Invio in capture su window con condizione "focus dentro `.player`"; frecce/N/F/M gestiti dal componente via `onKeyDown` sul contenitore `.player` che diventa `tabIndex={-1}`).
4. Schermo intero: `document.documentElement.requestFullscreen()` come oggi (così la barra resta visibile); doppio clic sul video; icona che cambia.
5. Volume/muto persistenti; ripristinati in `onLoadedMetadata`.
6. CSS: barra con `linear-gradient(transparent, rgba(0,0,0,.8))`, range stilizzati (`-webkit-slider-thumb`), focus ring coerente (`[data-focus]:focus`), toast riposizionato sopra la barra (`bottom: 96px`).
7. Verifica: `npm run check`, `npm run build`; nel browser (Chrome DevTools MCP, http://localhost:5173, profilo "Principale") su un episodio: play/pausa con clic, Spazio, Invio (una sola volta), seek con clic sulla barra e con ←/→, volume e muto ricordati dopo ricarica, F e doppio clic per schermo intero, N e icona per il prossimo episodio, toast negli ultimi 90 s (seek a `duration-80`), tab TV: LIVE + canale ↑/↓. Chiudere il video subito dopo (il provider ammette una sola connessione e l'utente potrebbe star guardando).
8. Commit: `feat(player): custom controls bar (progress, volume, tracks, next, fullscreen), no native controls`.

### Revisione

Task review + revisione finale sul branch; poi merge in `main` (l'utente pusha).
