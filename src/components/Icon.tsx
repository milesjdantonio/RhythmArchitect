// A small set of line icons (1.75px strokes, round caps).

const PATHS = {
  play: 'M8 5.5v13l11-6.5z',
  stop: 'M7 7h10v10H7z',
  pause: 'M8 6v12M16 6v12',
  sound: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11',
  muted: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  edit: 'M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8.5l1.2 2.3 2.3 1.2-2.3 1.2L12 15.5l-1.2-2.3L8.5 12l2.3-1.2z',
  retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  bank: 'M4 7h16v12H4zM7 7V5h10v2M9 12h6',
  wave: 'M2 12h3l2-6 3 12 3-9 2 5 2-2h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M6 9l6 6 6-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, filled = false, title }: { name: IconName; size?: number; filled?: boolean; title?: string }) {
  const fillShape = filled || name === 'play' || name === 'stop';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      fill={fillShape ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
