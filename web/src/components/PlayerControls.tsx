import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconChannelDown,
  IconChannelUp,
  IconExitFullscreen,
  IconForward10,
  IconFullscreen,
  IconNext,
  IconPause,
  IconPlay,
  IconRewind10,
  IconTracks,
  IconVolume,
  IconVolumeMute,
} from './Icons';

const VOL_KEY = 'player.volume';
const MUTED_KEY = 'player.muted';

/** "1:23:45" over an hour, "12:34" below it. */
export function formatClock(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const s = Math.floor(secs % 60);
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Volume and mute survive reloads and episode changes. Called on `loadedmetadata` too. */
export function restoreVolume(v: HTMLVideoElement) {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    const vol = raw === null ? NaN : Number(raw);
    if (Number.isFinite(vol) && vol >= 0 && vol <= 1) v.volume = vol;
    v.muted = localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    /* private mode: keep the defaults */
  }
}

/** A text track we can toggle; `audioTracks` is not in lib.dom, so we shape it ourselves. */
type AudioTrackLike = { label?: string; language?: string; enabled: boolean };
type AudioTrackListLike = { length: number; [i: number]: AudioTrackLike };
const audioTracksOf = (v: HTMLVideoElement) => (v as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;

const trackLabel = (t: { label?: string; language?: string }, i: number, kind: string) =>
  t.label || (t.language ? t.language.toUpperCase() : `${kind} ${i + 1}`);

export type PlayerControlsProps = {
  video: HTMLVideoElement | null;
  live: boolean;
  visible: boolean;
  /** Programme on air, shown instead of the timeline on live channels. */
  nowPlaying?: string;
  hasNext: boolean;
  nextLabel?: string;
  onNext: () => void;
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
  /** Same `poke()` as the page: any interaction keeps the bar on screen. */
  onInteract: () => void;
  /** Filled with the play/pause toggle so the page can fire it from the video click and Space. */
  toggleRef?: React.MutableRefObject<(() => void) | null>;
};

export function PlayerControls({
  video,
  live,
  visible,
  nowPlaying,
  hasNext,
  nextLabel,
  onNext,
  onPrevChannel,
  onNextChannel,
  onInteract,
  toggleRef,
}: PlayerControlsProps) {
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [tracks, setTracks] = useState<{ audio: string[]; audioIndex: number; text: string[]; textIndex: number }>({
    audio: [],
    audioIndex: -1,
    text: [],
    textIndex: -1,
  });
  const barRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<number | null>(null);

  // ---- Video → UI (events only, no polling) ----
  const readTracks = useCallback((v: HTMLVideoElement) => {
    const at = audioTracksOf(v);
    const audio: string[] = [];
    let audioIndex = -1;
    for (let i = 0; at && i < at.length; i++) {
      audio.push(trackLabel(at[i], i, 'Audio'));
      if (at[i].enabled) audioIndex = i;
    }
    const text: string[] = [];
    let textIndex = -1;
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      if (t.mode === 'showing') textIndex = text.length;
      text.push(trackLabel(t, text.length, 'Sottotitoli'));
    }
    setTracks({ audio, audioIndex, text, textIndex });
  }, []);

  useEffect(() => {
    if (!video) return;
    const v = video;
    restoreVolume(v);
    const sync = () => {
      setPaused(v.paused);
      setCurrentTime(v.currentTime);
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      setVolume(v.volume);
      setMuted(v.muted);
      setBuffered(v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0);
    };
    const onPlay = () => {
      setPaused(false);
      setWaiting(false);
    };
    const onPause = () => setPaused(true);
    const onTime = () => setCurrentTime(v.currentTime);
    const onProgress = () => setBuffered(v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0);
    const onDuration = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
      try {
        localStorage.setItem(VOL_KEY, String(v.volume));
        localStorage.setItem(MUTED_KEY, v.muted ? '1' : '0');
      } catch {
        /* ignore */
      }
    };
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onLoaded = () => {
      sync();
      readTracks(v);
    };
    sync();
    readTracks(v);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('progress', onProgress);
    v.addEventListener('durationchange', onDuration);
    v.addEventListener('volumechange', onVolume);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('seeking', onWaiting);
    v.addEventListener('seeked', onPlaying);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('ended', onPause);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('progress', onProgress);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('seeking', onWaiting);
      v.removeEventListener('seeked', onPlaying);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('ended', onPause);
    };
  }, [video, readTracks]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    onFs();
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Hide the menu with the bar.
  useEffect(() => {
    if (!visible) setMenu(false);
  }, [visible]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const toggle = useCallback(() => {
    if (!video) return;
    onInteract();
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
    setFlash(video.paused ? 'play' : 'pause');
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 400);
  }, [video, onInteract]);

  useEffect(() => {
    if (!toggleRef) return;
    toggleRef.current = toggle;
    return () => {
      toggleRef.current = null;
    };
  }, [toggle, toggleRef]);

  const seekBy = useCallback(
    (delta: number) => {
      if (!video) return;
      onInteract();
      const max = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.max(0, Math.min(max, video.currentTime + delta));
    },
    [video, onInteract],
  );

  const seekTo = (t: number) => {
    if (!video) return;
    onInteract();
    video.currentTime = t;
    setCurrentTime(t);
  };

  const toggleFullscreen = () => {
    onInteract();
    void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  };

  const toggleMute = () => {
    if (!video) return;
    onInteract();
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  };

  const setVol = (val: number) => {
    if (!video) return;
    onInteract();
    video.volume = val;
    video.muted = val === 0;
  };

  const pickAudio = (i: number) => {
    if (!video) return;
    const at = audioTracksOf(video);
    if (!at) return;
    for (let k = 0; k < at.length; k++) at[k].enabled = k === i;
    setTracks((t) => ({ ...t, audioIndex: i }));
    onInteract();
  };

  const pickText = (i: number) => {
    if (!video) return;
    let n = -1;
    for (let k = 0; k < video.textTracks.length; k++) {
      const t = video.textTracks[k];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      n++;
      t.mode = n === i ? 'showing' : 'disabled';
    }
    setTracks((t) => ({ ...t, textIndex: i }));
    onInteract();
  };

  // Arrow keys on the timeline seek instead of nudging the range by one step.
  const onBarKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 60 : 10;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    seekBy(dir * step);
  };

  const onBarHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = barRef.current;
    if (!el || !duration) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHover({ x: p * r.width, t: p * duration });
  };

  const pct = (t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);
  const hasTracks = tracks.audio.length > 1 || tracks.text.length > 0;

  return (
    <>
      {(flash || waiting) && (
        <div className="player-center" aria-hidden="true">
          {waiting ? <span className="player-spinner" /> : <span className="player-flash">{flash === 'play' ? <IconPlay /> : <IconPause />}</span>}
        </div>
      )}
      <div className="player-controls" onMouseMove={onInteract}>
        {!live && (
          <div className="pc-bar" ref={barRef} onMouseMove={onBarHover} onMouseLeave={() => setHover(null)}>
            <div className="pc-track">
              <div className="pc-buffered" style={{ width: `${pct(buffered)}%` }} />
              <div className="pc-played" style={{ width: `${pct(currentTime)}%` }} />
              <div className="pc-knob" style={{ left: `${pct(currentTime)}%` }} />
            </div>
            <input
              className="pc-range"
              type="range"
              data-focus
              min={0}
              max={duration || 0}
              step={0.5}
              value={Math.min(currentTime, duration || 0)}
              aria-label="Avanzamento"
              aria-valuetext={`${formatClock(currentTime)} di ${formatClock(duration)}`}
              onChange={(e) => seekTo(Number(e.target.value))}
              onKeyDown={onBarKey}
            />
            {hover && (
              <div className="pc-tooltip" style={{ left: `${hover.x}px` }}>
                {formatClock(hover.t)}
              </div>
            )}
          </div>
        )}
        <div className="pc-row">
          <button className="pc-btn" data-focus data-pc="play" aria-label={paused ? 'Riproduci' : 'Pausa'} title={paused ? 'Riproduci (Spazio)' : 'Pausa (Spazio)'} onClick={toggle}>
            {paused ? <IconPlay /> : <IconPause />}
          </button>
          {!live && (
            <>
              <button className="pc-btn" data-focus aria-label="Indietro di 10 secondi" title="Indietro 10 s (←)" onClick={() => seekBy(-10)}>
                <IconRewind10 />
              </button>
              <button className="pc-btn" data-focus aria-label="Avanti di 10 secondi" title="Avanti 10 s (→)" onClick={() => seekBy(10)}>
                <IconForward10 />
              </button>
              <div className="pc-time">
                <span>{formatClock(currentTime)}</span>
                <span className="muted"> / {formatClock(duration)}</span>
              </div>
            </>
          )}
          {live && (
            <div className="pc-live">
              <span className="pc-live-badge">LIVE</span>
              {nowPlaying && <span className="pc-live-title">{nowPlaying}</span>}
            </div>
          )}
          <div className="pc-volume">
            <button className="pc-btn" data-focus aria-label={muted || volume === 0 ? 'Riattiva audio' : 'Disattiva audio'} title="Muto (M)" onClick={toggleMute}>
              {muted || volume === 0 ? <IconVolumeMute /> : <IconVolume />}
            </button>
            <input
              className="pc-vol-range"
              type="range"
              data-focus
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              aria-label="Volume"
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
              style={{ ['--pc-vol' as string]: `${(muted ? 0 : volume) * 100}%` }}
              onChange={(e) => setVol(Number(e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="pc-spacer" />
          {hasTracks && (
            <div className="pc-menu-wrap">
              <button
                className={`pc-btn ${menu ? 'is-on' : ''}`}
                data-focus
                aria-label="Audio e sottotitoli"
                aria-expanded={menu}
                title="Audio e sottotitoli"
                onClick={() => {
                  onInteract();
                  setMenu((m) => !m);
                }}
              >
                <IconTracks />
              </button>
              {menu && (
                <div className="pc-menu" role="menu">
                  {tracks.audio.length > 1 && (
                    <>
                      <div className="pc-menu-head">Audio</div>
                      {tracks.audio.map((label, i) => (
                        <button key={`a${i}`} className={`pc-menu-item ${tracks.audioIndex === i ? 'is-on' : ''}`} data-focus role="menuitemradio" aria-checked={tracks.audioIndex === i} onClick={() => pickAudio(i)}>
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                  {tracks.text.length > 0 && (
                    <>
                      <div className="pc-menu-head">Sottotitoli</div>
                      <button className={`pc-menu-item ${tracks.textIndex < 0 ? 'is-on' : ''}`} data-focus role="menuitemradio" aria-checked={tracks.textIndex < 0} onClick={() => pickText(-1)}>
                        Nessuno
                      </button>
                      {tracks.text.map((label, i) => (
                        <button key={`t${i}`} className={`pc-menu-item ${tracks.textIndex === i ? 'is-on' : ''}`} data-focus role="menuitemradio" aria-checked={tracks.textIndex === i} onClick={() => pickText(i)}>
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {hasNext && (
            <button className="pc-btn" data-focus aria-label="Prossimo episodio" title={nextLabel ? `Prossimo episodio: ${nextLabel} (N)` : 'Prossimo episodio (N)'} onClick={onNext}>
              <IconNext />
            </button>
          )}
          {live && (
            <>
              <button className="pc-btn" data-focus aria-label="Canale successivo" title="Canale successivo (↑)" onClick={onNextChannel}>
                <IconChannelUp />
              </button>
              <button className="pc-btn" data-focus aria-label="Canale precedente" title="Canale precedente (↓)" onClick={onPrevChannel}>
                <IconChannelDown />
              </button>
            </>
          )}
          <button className="pc-btn" data-focus aria-label={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'} title="Schermo intero (F)" onClick={toggleFullscreen}>
            {fullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
          </button>
        </div>
      </div>
    </>
  );
}
