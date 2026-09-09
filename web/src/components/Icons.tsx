import type { SVGProps } from 'react';

/** Consistent 24px line icons (2px stroke, round caps) used across the app. */
const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 11 12 3l9 8" />
    <path d="M5 10v10h5v-6h4v6h5V10" />
  </svg>
);

export const IconFilm = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
);

export const IconSeries = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M8 3l4 3 4-3M9 22h6" />
  </svg>
);

export const IconSport = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v3.5M12 17.5V21M3.5 9.5 7 11M17 11l3.5-1.5M5.5 18l3-2.5M15.5 15.5l3 2.5" />
    <path d="M12 6.5 15.8 9.3 14.4 13.8H9.6L8.2 9.3z" />
  </svg>
);

export const IconTv = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 4l16 3M4 20l16-3" />
    <path d="M6 6.5v11" />
    <path d="M16 8.7v6.6" />
    <path d="M10 7.5v9M13 8v8" />
  </svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconHeart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

/* ---- Player controls ---- */

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7.5 4.8v14.4L19 12 7.5 4.8z" fill="currentColor" />
  </svg>
);

export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="6.5" y="4.5" width="3.6" height="15" rx="1.2" fill="currentColor" />
    <rect x="13.9" y="4.5" width="3.6" height="15" rx="1.2" fill="currentColor" />
  </svg>
);

export const IconRewind10 = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M1 4v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    <text x="12" y="12.6" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill="currentColor" stroke="none">
      10
    </text>
  </svg>
);

export const IconForward10 = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M23 4v6h-6" />
    <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
    <text x="12" y="12.6" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill="currentColor" stroke="none">
      10
    </text>
  </svg>
);

export const IconVolume = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    <path d="M15.8 9.4a3.8 3.8 0 0 1 0 5.2" />
    <path d="M18.4 7a7.4 7.4 0 0 1 0 10" />
  </svg>
);

export const IconVolumeMute = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    <path d="m16.5 9.8 5 4.4M21.5 9.8l-5 4.4" />
  </svg>
);

export const IconNext = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5.5 5.2v13.6L15 12 5.5 5.2z" fill="currentColor" />
    <path d="M18.5 5v14" />
  </svg>
);

export const IconFullscreen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </svg>
);

export const IconExitFullscreen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
  </svg>
);

export const IconTracks = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10.2 10.6a2.6 2.6 0 1 0 0 2.8M17.2 10.6a2.6 2.6 0 1 0 0 2.8" />
  </svg>
);

export const IconChannelUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
);

export const IconChannelDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />
  </svg>
);
