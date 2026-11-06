// The Map Syncer: keeps every song's tiles on its music, so no one has to set an offset by hand.
//
//   track songs:   before a run (prepareSong), the decoded track is checked against the map
//                  (mapping/sync.ts, alignOffset); if beat 0 is clearly somewhere else, the song
//                  plays with the measured offset. Hits then say nothing about the map: the audio
//                  and the tiles run on the same clock.
//   YouTube songs: the page never hears the video, so the player's hits are the evidence. After
//                  a run the player played themselves, hits that were late or early by the same
//                  amount move the map (hitDrift) and the fix is saved with the song.
//   synth songs:   the game plays the map's own notes, so they can't be out of step.
//
// Resync (settings and dev tools) forgets every check, so each song is measured again, and lines
// up whatever is playing right now (resyncPlaying in playback.ts).

import type { Song } from '../api/types';
import { updateSong } from '../library/songs';
import { alignOffset, hitDrift, onsetEnvelope, tileTimes, type Alignment } from '../mapping/sync';

interface Check { key: string; offset: number; alignment: Alignment }
const checks = new Map<string, Check>();
const learned = new Map<string, number>();
let version = 0;

const keyFor = (song: Song) => `${song.source.url ?? ''}:${song.source.offset ?? 0}:${song.charts.hard.notes.length}`;

/** What the syncer needs from a decoded track (an AudioBuffer or Tone's wrapper of one). */
export interface TrackAudio { sampleRate: number; numberOfChannels: number; getChannelData(c: number): Float32Array }

/** Checks a track song's map against its audio (once per song; later calls reuse the answer). */
export function checkTrack(song: Song, audio: TrackAudio): Check {
  const key = keyFor(song);
  const had = checks.get(song.id);
  if (had && had.key === key) return had;
  const saved = song.source.offset ?? 0;
  const t0 = performance.now();
  const chans = [audio.getChannelData(0)];
  if (audio.numberOfChannels > 1) chans.push(audio.getChannelData(1));
  const env = onsetEnvelope(chans, audio.sampleRate);
  const alignment = alignOffset(tileTimes(song.charts, song.bpm), env, saved);
  const check = { key, offset: alignment.trusted ? alignment.offset : saved, alignment };
  checks.set(song.id, check);
  version++;
  if (import.meta.env?.DEV) console.info(`[sync] ${song.title}: ${alignment.trusted ? `tiles moved ${Math.round(alignment.shift * 1000)} ms to sit on the track` : 'in sync'} (gain ${alignment.gain.toFixed(2)}, ${Math.round(performance.now() - t0)} ms)`);
  return check;
}

/** Seconds into the audio where beat 0 lands, as the syncer has it. */
export function syncedOffset(song: Song): number {
  const saved = song.source.offset ?? 0;
  if (song.source.kind !== 'stream') return saved;
  const c = checks.get(song.id);
  return c && c.key === keyFor(song) ? c.offset : saved;
}

/**
 * After a run the player played themselves: whether their hits say the map is off from the
 * video, and if so the map is moved and saved. Resolves to the song's new offset, or null.
 */
export async function learnFromRun(song: Song, deltas: number[]): Promise<number | null> {
  if (song.source.kind !== 'youtube') return null;
  const drift = hitDrift(deltas);
  if (drift === null) return null;
  const next = Math.round(((song.source.offset ?? 0) + drift) * 1000) / 1000;
  learned.set(song.id, (learned.get(song.id) ?? 0) + drift);
  version++;
  await updateSong(song.id, { offset: next });
  return next;
}

/** Forgets every check, so each song is measured again the next time it plays. */
export function forgetSync() {
  checks.clear();
  learned.clear();
  version++;
}

/** Changes whenever the syncer learns something (for screens that show its status). */
export const syncVersion = () => version;

/** One line on how this song is kept in sync (the dev tools show it). */
export function syncStatus(song: Song): string {
  const ms = (s: number) => `${s > 0 ? '+' : ''}${Math.round(s * 1000)} ms`;
  if (song.source.kind === 'synth') return 'The game plays the map’s own notes: always in sync.';
  if (song.source.kind === 'youtube') {
    const l = learned.get(song.id);
    return l ? `Moved ${ms(l)} from your hits (saved with the song).` : 'Learns from your hits: tiles that are steadily early or late get moved after the run.';
  }
  const c = checks.get(song.id);
  if (!c || c.key !== keyFor(song)) return 'Checks the tiles against the track when it loads.';
  return c.alignment.trusted ? `Checked against the track: tiles moved ${ms(c.alignment.shift)}.` : 'Checked against the track: in sync.';
}
