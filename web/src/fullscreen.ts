// Fullscreen that also works on iPad/iPhone. Safari before iPadOS 16.4 only has the webkit-prefixed
// element API, the iPhone (and a Home Screen web app) has none at all: there the only way is the
// video's own native player, so that is the last resort.

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & {
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

const doc = document as WebkitDocument;

export function isFullscreen(video?: HTMLVideoElement | null): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement) || !!(video as WebkitVideo | null)?.webkitDisplayingFullscreen;
}

function enterVideo(video?: HTMLVideoElement | null) {
  const v = video as WebkitVideo | null | undefined;
  if (!v?.webkitEnterFullscreen) return;
  try {
    v.webkitEnterFullscreen();
  } catch {
    // Not before the metadata is loaded: nothing else to try.
  }
}

export function toggleFullscreen(video?: HTMLVideoElement | null) {
  const v = video as WebkitVideo | null | undefined;
  if (doc.fullscreenElement) return void doc.exitFullscreen().catch(() => {});
  if (doc.webkitFullscreenElement) return doc.webkitExitFullscreen?.();
  if (v?.webkitDisplayingFullscreen) return v.webkitExitFullscreen?.();

  const root = document.documentElement as WebkitElement;
  if (doc.fullscreenEnabled && root.requestFullscreen) {
    root.requestFullscreen().catch(() => enterVideo(video));
  } else if (doc.webkitFullscreenEnabled && root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
  } else {
    enterVideo(video);
  }
}

/** Calls `cb` whenever any of the fullscreen modes above starts or ends. */
export function onFullscreenChange(cb: () => void, video?: HTMLVideoElement | null): () => void {
  const docEvents = ['fullscreenchange', 'webkitfullscreenchange'];
  const videoEvents = ['webkitbeginfullscreen', 'webkitendfullscreen'];
  docEvents.forEach((e) => document.addEventListener(e, cb));
  videoEvents.forEach((e) => video?.addEventListener(e, cb));
  return () => {
    docEvents.forEach((e) => document.removeEventListener(e, cb));
    videoEvents.forEach((e) => video?.removeEventListener(e, cb));
  };
}
