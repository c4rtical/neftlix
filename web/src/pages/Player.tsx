import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Hls from 'hls.js';
import { api, beaconProgress, formatTime, streamUrl } from '../api';
import type { EpgItem } from '../types';

type PlayType = 'movie' | 'episode' | 'live';

/** Seconds before the end at which the "next episode" toast appears (outro/credits window). */
const NEXT_TOAST_SECS = 90;

type Meta = {
  type: PlayType;
  id: string | number;
  title: string;
  subtitle?: string;
  logo?: string | null;
  resumeAt: number;
  next?: { id: number; label: string } | null;
  prevChannel?: { id: number; name: string } | null;
  nextChannel?: { id: number; name: string } | null;
  backTo: string;
};

const SAVE_EVERY_MS = 5000;

export function Player() {
  const { type = 'movie', id = '' } = useParams<{ type: PlayType; id: string }>();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [epg, setEpg] = useState<EpgItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showUi, setShowUi] = useState(true);
  const [nearEnd, setNearEnd] = useState(false);
  const lastSave = useRef(0);
  const hideTimer = useRef<number | null>(null);

  const isLive = type === 'live';
  const itemId = type === 'movie' ? decodeURIComponent(id) : id;

  // ---- Load metadata ----
  useEffect(() => {
    setMeta(null);
    setError(null);
    setNearEnd(false);
    setEpg([]);
    const from = params.get('from');
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    if (type === 'movie') {
      api
        .movie(itemId)
        .then((m) =>
          setMeta({
            type: 'movie',
            id: m.id,
            title: m.title,
            subtitle: m.year ? String(m.year) : undefined,
            resumeAt: from !== null ? Number(from) : m.progress && !m.progress.watched ? m.progress.position : 0,
            next: null,
            backTo: `/movie/${encodeURIComponent(m.id)}`,
          }),
        )
        .catch(fail);
    } else if (type === 'episode') {
      api
        .episode(itemId)
        .then((e) =>
          setMeta({
            type: 'episode',
            id: e.id,
            title: e.series.title,
            subtitle: `S${e.season} E${e.num}${e.title ? ` · ${e.title}` : ''}`,
            resumeAt: from !== null ? Number(from) : e.progress && !e.progress.watched ? e.progress.position : 0,
            next: e.next ? { id: e.next.id, label: `S${e.next.season} E${e.next.num}${e.next.title ? ` · ${e.next.title}` : ''}` } : null,
            backTo: `/series/${e.series.id}`,
          }),
        )
        .catch(fail);
    } else {
      api
        .liveChannel(itemId)
        .then((c) =>
          setMeta({
            type: 'live',
            id: c.id,
            title: c.name,
            subtitle: c.category_name ?? undefined,
            logo: c.logo,
            resumeAt: 0,
            prevChannel: c.prev,
            nextChannel: c.next,
            backTo: `${c.sport === false ? '/tv' : '/live'}${c.category_id ? `?category=${c.category_id}` : ''}`,
          }),
        )
        .catch(fail);
    }
  }, [type, itemId, params]);

  // ---- EPG for live channels (refresh every minute) ----
  useEffect(() => {
    if (!isLive || !meta) return;
    let alive = true;
    const load = () => api.liveEpg(meta.id).then((r) => alive && setEpg(r.items)).catch(() => {});
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [isLive, meta]);

  // ---- Attach source (HLS for live, progressive otherwise) ----
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !meta) return;
    const url = streamUrl(meta.type, meta.id);
    if (meta.type !== 'live') {
      v.src = url;
      return () => {
        v.removeAttribute('src');
        v.load();
      };
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          const status = data.response?.code;
          if (status && status >= 400) {
            fetch(url)
              .then((r) => r.json().catch(() => ({})))
              .then((b: { error?: string }) => setError(b.error ?? `Canale non disponibile (HTTP ${status})`))
              .catch(() => setError('Canale non disponibile'));
          } else {
            hls.startLoad();
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setError('Errore di riproduzione del canale');
        }
      });
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void v.play().catch(() => {}));
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    // Safari: native HLS.
    v.src = url;
    return () => {
      v.removeAttribute('src');
      v.load();
    };
  }, [meta]);

  const save = (force = false) => {
    const v = videoRef.current;
    if (!v || !meta || meta.type === 'live' || !Number.isFinite(v.duration) || v.duration === 0) return;
    const nowMs = Date.now();
    if (!force && nowMs - lastSave.current < SAVE_EVERY_MS) return;
    lastSave.current = nowMs;
    void api.progress(meta.type, meta.id, Math.floor(v.currentTime), Math.floor(v.duration)).catch(() => {});
  };

  // Flush position when leaving the page or hiding the tab.
  useEffect(() => {
    if (!meta || meta.type === 'live') return;
    const flush = () => {
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration) && v.duration > 0) beaconProgress(meta.type as 'movie' | 'episode', meta.id, Math.floor(v.currentTime), Math.floor(v.duration));
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [meta]);

  // Auto-hide overlay.
  const poke = () => {
    setShowUi(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowUi(false), 3500);
  };
  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.focus();
  }, [meta]);

  const onLoaded = () => {
    const v = videoRef.current;
    if (!v || !meta || meta.type === 'live') return;
    if (meta.resumeAt > 0 && meta.resumeAt < v.duration - 10) v.currentTime = meta.resumeAt;
    void v.play().catch(() => {});
  };

  // Credits usually run through the last minute and a half: offer the next episode then (N or click).
  const updateNearEnd = (v: HTMLVideoElement) => {
    if (Number.isFinite(v.duration) && v.duration > 0) setNearEnd(v.duration - v.currentTime < NEXT_TOAST_SECS);
  };

  const onTime = () => {
    const v = videoRef.current;
    if (!v || isLive) return;
    save();
    updateNearEnd(v);
  };

  const onSeekedVideo = () => {
    const v = videoRef.current;
    if (!v) return;
    save(true);
    if (!isLive) updateNearEnd(v);
  };

  const goBack = () => {
    if (meta?.backTo) nav(meta.backTo);
    else nav(-1);
  };

  const goNext = () => {
    if (meta?.next) nav(`/play/episode/${meta.next.id}`, { replace: true });
  };

  const goChannel = (ch: { id: number } | null | undefined) => {
    if (ch) nav(`/play/live/${ch.id}`, { replace: true });
  };

  const onEnded = () => {
    if (isLive) return;
    save(true);
    if (meta?.next) goNext();
    else nav(meta?.backTo ?? '/', { replace: true });
  };

  const onError = async () => {
    if (isLive && hlsRef.current) return; // hls.js reports its own errors
    const v = videoRef.current;
    const code = v?.error?.code;
    try {
      const r = await fetch(streamUrl(meta?.type ?? (type as PlayType), meta?.id ?? itemId), { headers: { Range: 'bytes=0-0' } });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Stream non disponibile (HTTP ${r.status})`);
        return;
      }
    } catch {
      /* ignore */
    }
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
      setError('Formato non supportato dal browser (contenitore o codec audio/video). Prova con Chrome, oppure un altro file.');
    } else {
      setError(`Errore di riproduzione (codice ${code ?? '?'})`);
    }
  };

  // After clicking a native control (e.g. the pause button), keyboard focus sits on that button:
  // Space/Enter would then both run our toggle on keydown AND "click" the button on keyup, so the
  // video restarts and pauses again. Cancelling the keyup suppresses the native activation.
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'MediaPlayPause') e.preventDefault();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const v = videoRef.current;
    if (!v) return;
    poke();
    if (isLive) {
      switch (e.key) {
        case 'ArrowUp':
        case 'ChannelUp':
        case 'PageUp':
          e.preventDefault();
          goChannel(meta?.nextChannel);
          return;
        case 'ArrowDown':
        case 'ChannelDown':
        case 'PageDown':
          e.preventDefault();
          goChannel(meta?.prevChannel);
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          return;
      }
    }
    switch (e.key) {
      case ' ':
      case 'Enter':
      case 'MediaPlayPause':
        e.preventDefault();
        // Holding the key repeats keydown; toggling on every repeat flickers between play and pause.
        if (e.repeat) break;
        if (v.paused) void v.play();
        else v.pause();
        break;
      case 'ArrowRight':
      case 'MediaFastForward':
        e.preventDefault();
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
        break;
      case 'ArrowLeft':
      case 'MediaRewind':
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 60);
        break;
      case 'ArrowDown':
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 60);
        break;
      case 'n':
      case 'N':
        goNext();
        break;
      case 'f':
      case 'F':
        void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
        break;
    }
  };

  if (error) {
    return (
      <div className="player player-error">
        <h2>Impossibile riprodurre</h2>
        <p>{error}</p>
        <div className="hero-actions">
          <button className="btn btn-primary" data-focus autoFocus onClick={goBack}>
            Torna indietro
          </button>
          {meta?.next && (
            <button className="btn" data-focus onClick={goNext}>
              Prossimo episodio
            </button>
          )}
          {isLive && meta?.nextChannel && (
            <button className="btn" data-focus onClick={() => goChannel(meta.nextChannel)}>
              Canale successivo
            </button>
          )}
        </div>
      </div>
    );
  }

  const now = epg.find((e) => e.nowPlaying) ?? epg[0];
  const later = epg.filter((e) => e !== now).slice(0, 2);

  return (
    <div className={`player ${showUi ? 'ui-visible' : ''}`} onMouseMove={poke} onClick={poke}>
      {meta && (
        <video
          ref={videoRef}
          className="video"
          controls
          autoPlay
          playsInline
          tabIndex={0}
          onLoadedMetadata={onLoaded}
          onTimeUpdate={onTime}
          onPause={() => save(true)}
          onSeeked={onSeekedVideo}
          onEnded={onEnded}
          onError={onError}
          onKeyDown={onKey}
          onKeyUp={onKeyUp}
        />
      )}
      <div className="player-top">
        <button className="btn btn-ghost" onClick={goBack} title="Indietro (Esc)">
          ‹ Indietro
        </button>
        {meta?.logo && <img className="player-logo" src={meta.logo} alt="" />}
        <div className="player-title">
          <div>{meta?.title ?? 'Caricamento…'}</div>
          {meta?.subtitle && <div className="muted small">{meta.subtitle}</div>}
        </div>
        {meta?.next && (
          <button className="btn btn-ghost player-next-btn" onClick={goNext} title={`Prossimo episodio: ${meta.next.label} (N)`}>
            Prossimo episodio ›
          </button>
        )}
        {isLive && (
          <div className="player-channel-nav">
            <button className="btn btn-ghost" onClick={() => goChannel(meta?.prevChannel)} title="Canale precedente (↓)">
              ‹ {meta?.prevChannel?.name ?? ''}
            </button>
            <button className="btn btn-ghost" onClick={() => goChannel(meta?.nextChannel)} title="Canale successivo (↑)">
              {meta?.nextChannel?.name ?? ''} ›
            </button>
          </div>
        )}
      </div>
      {isLive && now && (
        <div className="player-epg">
          <div className="epg-now">
            <span className="epg-badge">In onda</span> {now.title}
            {now.start && now.end && (
              <span className="muted small">
                {' '}
                {formatTime(now.start)}–{formatTime(now.end)}
              </span>
            )}
          </div>
          {now.description && <div className="muted small epg-desc">{now.description}</div>}
          {later.map((e, i) => (
            <div key={i} className="muted small">
              {formatTime(e.start)} · {e.title}
            </div>
          ))}
        </div>
      )}
      {meta?.next && nearEnd && (
        <button className="btn btn-primary player-next" onClick={goNext} title="Prossimo episodio (N)">
          <span className="muted small">Prossimo episodio</span>
          <span>{meta.next.label} ▶</span>
        </button>
      )}
    </div>
  );
}
