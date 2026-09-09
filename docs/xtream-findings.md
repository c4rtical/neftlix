# Spike provider Xtream — risultati (2026-09-09)

Ispezione delle risposte reali del pannello Xtream di test. Le credenziali sono in `.env` (ignorato da git) e non vanno mai committate.

## Autenticazione

`GET {host}/player_api.php?username=U&password=P` restituisce `user_info` e `server_info`.

Campi utili di `user_info`: `status` ("Active"), `exp_date` (unix), `max_connections` (1 su questo account), `active_cons`, `allowed_output_formats` (`["m3u8","ts"]`).

## Catalogo

| Endpoint | Righe | Dimensione | Tempo |
|---|---|---|---|
| `get_vod_categories` | 510 | 36 KB | 0.3 s |
| `get_series_categories` | 20 | 1 KB | 0.2 s |
| `get_vod_streams` | 97 842 | 38 MB | 6.6 s |
| `get_series` | 5 911 | 6.5 MB | 1.1 s |

Conseguenze: il catalogo va persistito in un DB locale e importato in streaming (parser JSON incrementale, non `readAll`). Un refresh completo costa circa 45 MB di download.

### Film (`get_vod_streams`)

Chiavi: `num, name, stream_type, stream_id, stream_icon, rating, rating_5based, tmdb, trailer, added, is_adult, category_id, category_ids, container_extension, custom_sid, direct_source`.

- Il campo TMDB si chiama `tmdb` (non `tmdb_id`). Presente su 65 634 righe su 97 842.
- `stream_icon` è quasi sempre un poster TMDB (`image.tmdb.org`). 423 righe senza icona.
- `container_extension`: mp4 63 396, mkv 33 641, avi 802.
- `category_ids` contiene sempre un solo elemento. Nessuna gerarchia di categorie (`parent_id` sempre 0).
- Il titolo contiene spesso l'anno tra parentesi e a volte suffissi come "4K".

**Duplicati.** Il provider replica lo stesso film in più categorie con `stream_id` diversi: 19 776 TMDB unici coprono 65 634 righe. Esempio: "Pinocchio: Unstrung (2026)" esiste come 683439 (Film più votati), 710749 (Recenti), 710753 (Horror).

**Righe morte.** Gli `stream_id` nelle categorie curate ("Film più votati", "Film più visti ultima settimana") rispondono 200 `text/html` vuoto e non riproducono. Gli stessi film nelle categorie per genere o "Recenti" rispondono 302 + 206 `video/*` e funzionano. Regola di dedup: raggruppare per `tmdb` (fallback: nome normalizzato) e scegliere come sorgente uno `stream_id` che NON appartenga a categorie curate; tenere l'elenco delle categorie come tag del film.

### Serie (`get_series`)

Chiavi: `num, name, series_id, cover, plot, cast, director, genre, releaseDate, release_date, last_modified, rating, rating_5based, backdrop_path, youtube_trailer, tmdb, episode_run_time, category_id, category_ids`.

Metadata completa già nella lista (trama, cast, genere, backdrop). `tmdb` presente su 5 635 righe su 5 911. 20 categorie, per lo più per piattaforma di origine.

### Dettaglio serie (`get_series_info&series_id=X`)

Risposta: `{ seasons: [...], info: {...}, episodes: { "1": [...], "2": [...] } }`.

- `episodes` è un dict con la stagione come chiave stringa. Attenzione: alcuni pannelli lo restituiscono come array; il parser deve gestire entrambi.
- Episodio: `id` (stringa, usato per lo stream), `episode_num`, `title`, `container_extension`, `season`, `added`, `info.duration_secs`, `info.movie_image`, `info.air_date`, `info.video` (codec, risoluzione).
- `seasons[]`: `name`, `season_number`, `episode_count`, `air_date`, `cover`, `cover_tmdb`.

Dimensione: 96 KB per una serie da 42 episodi. Va caricato on demand e cachato, non in fase di sync.

### Dettaglio film (`get_vod_info&vod_id=X`)

`info` con `tmdb_id`, `description`, `cast`, `director`, `releasedate`, `youtube_trailer`, `backdrop_path`, `duration_secs`; `movie_data` con `stream_id` e `container_extension`. Caricare on demand nella pagina di dettaglio.

## Stream

- Film: `{host}/movie/U/P/{stream_id}.{container_extension}`
- Episodio: `{host}/series/U/P/{episode.id}.{container_extension}`
- Il server risponde 302 verso un edge (`http://IP/live/play/{token}/{id}`), poi 206 con `Accept-Ranges`. Seek via range funziona, quindi ExoPlayer con sorgente progressiva va bene. Il client HTTP deve seguire i redirect.
- La variante `.m3u8` per i VOD risponde 551: su questo pannello HLS non è disponibile per i VOD, solo progressive.
- **User-Agent obbligatorio.** Con lo UA di curl il server risponde 461. Con UA da player (`VLC/3.0.20 LibVLC/3.0.20`, `okhttp/4.12.0`, `ExoPlayerLib`, `TiviMate`) risponde correttamente. Impostare uno UA esplicito sia sulle chiamate API sia sul player.
- `max_connections` = 1: se un altro dispositivo sta riproducendo, il nostro stream viene rifiutato. Da mostrare come errore chiaro in UI, e da tenere presente nello spike del player.

## Decisioni derivate per l'MVP

1. DB locale obbligatorio, sync in streaming, dedup per `tmdb`.
2. Sync incrementale possibile: `added` (film, episodi) e `last_modified` (serie) sono timestamp unix.
3. Ricerca e home lavorano sul DB locale, mai sulle API.
4. Player: sorgente progressiva mp4/mkv, HTTP con redirect e UA custom, seek via range.
5. Dettaglio serie/film: fetch on demand con cache e TTL.

## Canali live (aggiunto 2026-09-09)

- `get_live_categories`: 60 categorie. `get_live_streams`: 6 131 righe, 1.9 MB.
- Chiavi canale: `num, name, stream_type, stream_id, stream_icon, epg_channel_id, added, is_adult, category_id, category_ids, custom_sid, tv_archive, direct_source, tv_archive_duration`.
- 44 righe sono separatori visivi ("----Sport Skynet----") con `direct_source` che punta a un mp4 placeholder: vanno scartate (nome che inizia con `---`).
- Stream: `{host}/live/U/P/{id}.m3u8` (HLS, segmenti da 10 s con path relativi `/hls/{token}/{id}_{seq}.ts` sull'edge dopo il 302) oppure `{host}/live/U/P/{id}.ts` (MPEG-TS continuo). Entrambi richiedono lo User-Agent da player.
- Un canale può rispondere 407 `Proxy Authentication Required`: canale non disponibile in quel momento, non un problema di credenziali. Riprovare o cambiare canale.
- `get_short_epg&stream_id=X&limit=N`: titoli e descrizioni base64; `start_timestamp`/`stop_timestamp` unix; `now_playing` non sempre valorizzato. Solo 580 canali su 6 131 hanno `epg_channel_id`.
