// Turning what the listening pass heard into a song the backend can store.

import type { Chart, Difficulty, NewSong, VideoMatch } from '../api/types';
import type { Heard, ListenError, Mapped } from './listen';
import { huesFor } from './osu';

/** The charts a song gets: from the trained mapper (ensomi.ts), or (when it can't) the on-device mapper (automap.ts). */
export interface Charted {
  charts: Record<Difficulty, Chart>;
  mapper: string;
  /** Why the on-device charts were used (the trained mapper failed). */
  fallback?: string;
}

export function songFromListening(m: Mapped, video: VideoMatch, heard: Pick<Heard, 'calibrated' | 'delay' | 'placement'>, charted?: Charted): NewSong {
  const r = m.result;
  const c: Charted = charted ?? { charts: r.charts, mapper: r.report.mapper };
  return {
    title: video.songTitle,
    artist: video.songArtist,
    prompt: `${video.songTitle}${video.songArtist ? ` by ${video.songArtist}` : ''}`,
    bpm: r.bpm,
    meter: r.meter ?? 4,
    key: 'C',
    scale: 'Minor',
    mood: 'Mapped by listening',
    lengthBeats: r.lengthBeats,
    hues: huesFor(`${video.songTitle} ${video.songArtist}`.toLowerCase()),
    cover: video.thumbnail ?? `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
    source: {
      kind: 'youtube',
      videoId: video.videoId,
      chart: 'listened',
      offset: r.offset,
      credit: `Plays from YouTube: “${video.title}” (${video.channel}). Tiles mapped by listening to it once in this browser (capture delay ${Math.round(heard.delay * 1000)} ms${heard.calibrated ? ', measured' : ', assumed'}).`,
    },
    levels: m.levels,
    report: {
      ...r.report,
      mapper: `${c.mapper}, listening pass${c.fallback ? ` (on-device: ${c.fallback})` : ''}`,
      ...(heard.placement ? { listen: heard.placement } : {}),
    },
    patch: { name: 'Glass Bell', oscillator: 'triangle', attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.4, cutoff: 6000, space: 0.3 },
    backing: { bass: ['C2'], drums: '................' },
    charts: c.charts,
  };
}

/** Why the listening pass didn't happen, for the line shown with the fan chart. */
/** Listening didn't work: what to tell the player (the dialog then offers to try again). */
export function listenProblem(e: ListenError | null): string {
  switch (e?.reason) {
    case 'declined': return 'Sharing was turned down. Share this tab with its audio to map the song.';
    case 'stopped': return 'Sharing stopped before the song ended, so it couldn\u2019t be mapped. Keep sharing until it\u2019s done.';
    case 'no-audio': return 'No sound was shared. Share this tab with its audio turned on.';
    case 'silent': return 'No sound came through. Share this tab (not another one) with its audio.';
    case 'video': return e.message;
    case 'gaps': return e.message;
    default: return e?.message || 'Listening stopped part-way. Try again.';
  }
}

export function fallbackNote(e: ListenError | null): string {
  switch (e?.reason) {
    case 'unsupported': return "This browser can't share a tab's sound, so the tiles come from a fan-made chart.";
    case 'declined': return 'Tab sharing was turned down, so the tiles come from a fan-made chart.';
    case 'no-audio': return 'Chrome shared no sound, so the tiles come from a fan-made chart.';
    case 'silent': return 'No sound came through the shared tab, so the tiles come from a fan-made chart.';
    case 'stopped': return 'Tab sharing stopped part-way, so the tiles come from a fan-made chart.';
    case 'video': return `${e.message} Trying a fan-made chart.`;
    default: return 'The tiles come from a fan-made chart.';
  }
}
