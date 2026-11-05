// Turning what the listening pass heard into a song the backend can store.

import { api } from '../api/client';
import type { Chart, Cue, Difficulty, NewSong, VideoMatch } from '../api/types';
import type { Heard, ListenError, Mapped } from '../audio/listen';
import { chartRequest, chartsFromPlan } from '../music/charter';
import { huesFor } from '../music/osu';

/** How long the AI charter may take before the on-device charts are used instead. */
export const CHART_TIMEOUT_MS = 180_000;

/** The charts a song gets: from the AI charter on the backend, or (when it can't) the on-device mapper. */
export interface Charted {
  charts: Record<Difficulty, Chart>;
  mapper: string;
  sections?: { label: string; beat: number }[];
  cues?: Cue[];
  summary?: string;
  /** Why the on-device charts were used (the AI charter was unavailable, slow or wrong). */
  fallback?: string;
}

/**
 * Asks the backend's AI charter which of the sounds the browser found become tiles (POST
 * /api/chart: the measurements go, no audio). If it can't answer (no backend, an error, too slow,
 * an unusable plan), the on-device charts from the mapper are used, so a map is always made.
 * Cancelling (the player's signal) throws an AbortError as usual.
 */
export async function chartWithAI(m: Mapped, video: VideoMatch, signal?: AbortSignal): Promise<Charted> {
  const r = m.result;
  const seconds = video.seconds || r.offset + (r.lengthBeats * 60) / r.bpm;
  const req = chartRequest(r, { title: video.songTitle, artist: video.songArtist, videoId: video.videoId, seconds: Math.round(seconds * 10) / 10 });
  const own: Charted = { charts: r.charts, mapper: r.report.mapper };
  if (r.events.length === 0) return { ...own, fallback: 'no sounds found' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CHART_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const plan = await api.chartSong(req, ctl.signal);
    const { charts, fixes } = chartsFromPlan(req, plan);
    if (fixes && import.meta.env?.DEV) console.info(`[charter] ${fixes} notes in the plan were fixed or dropped`);
    return { charts, mapper: String(plan.mapper || 'AI charter'), sections: plan.sections, cues: plan.cues, summary: plan.summary };
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const why = (e as Error).name === 'AbortError' ? 'the AI charter took too long' : (e as Error).message || 'the AI charter failed';
    if (import.meta.env?.DEV) console.info(`[charter] using the on-device charts: ${why}`);
    return { ...own, fallback: why };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function songFromListening(m: Mapped, video: VideoMatch, heard: Pick<Heard, 'calibrated' | 'delay'>, charted?: Charted): NewSong {
  const r = m.result;
  const c: Charted = charted ?? { charts: r.charts, mapper: r.report.mapper };
  return {
    title: video.songTitle,
    artist: video.songArtist,
    prompt: `${video.songTitle}${video.songArtist ? ` by ${video.songArtist}` : ''}`,
    bpm: r.bpm,
    meter: 4,
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
      sections: c.sections?.length ? c.sections : r.report.sections,
      cues: c.cues ?? r.report.cues,
      ...(c.summary ? { summary: c.summary } : {}),
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
