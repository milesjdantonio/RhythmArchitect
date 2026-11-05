// How loud a song is over time, in three bands (bass, mids, highs), for songs the app can't
// analyse while they play: YouTube's player never hands the page its audio. The listening pass
// keeps this curve (30 numbers a second, one byte each), never the audio; songs from fan charts
// get one made from their tiles. The visuals read it in place of the live analyser.
//
// Pure functions, so they run in the mapping worker, the app and tests.

import type { SongLevels } from '../api/types';

export const LEVEL_RATE = 30;

const toB64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Each band scaled so its loud moments sit near the top (98th percentile = 1), then to bytes. */
function toBytes(x: Float32Array): Uint8Array {
  const sorted = Float32Array.from(x).sort();
  const top = sorted[Math.floor(sorted.length * 0.98)] || 1e-9;
  const out = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.round(Math.min(1, Math.sqrt(x[i] / top)) * 255);
  return out;
}

/** The loudness curve of mono audio. */
export function computeLevels(pcm: Float32Array, sr: number): SongLevels {
  const hop = Math.max(1, Math.round(sr / LEVEL_RATE));
  const n = Math.floor(pcm.length / hop);
  const bass = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
  const aL = Math.exp((-2 * Math.PI * 180) / sr), aH = Math.exp((-2 * Math.PI * 2500) / sr);
  let lp = 0, lp2 = 0;
  for (let f = 0; f < n; f++) {
    let eL = 0, eM = 0, eH = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) {
      const s = pcm[i];
      lp = (1 - aL) * s + aL * lp;
      lp2 = (1 - aH) * s + aH * lp2;
      const h = s - lp2, m = lp2 - lp;
      eL += lp * lp; eM += m * m; eH += h * h;
    }
    bass[f] = eL / hop; mid[f] = eM / hop; high[f] = eH / hop;
  }
  return { rate: LEVEL_RATE, bass: toB64(toBytes(bass)), mid: toB64(toBytes(mid)), high: toB64(toBytes(high)) };
}

export interface DecodedLevels { rate: number; bass: Uint8Array; mid: Uint8Array; high: Uint8Array }

export function decodeLevels(l: SongLevels): DecodedLevels {
  return { rate: l.rate, bass: fromB64(l.bass), mid: fromB64(l.mid), high: fromB64(l.high) };
}

/**
 * A stand-in curve from the tiles alone (fan charts): each tile is a hit in a band (the left lane
 * bass, the middle ones mids, the right one highs) that fades over a fifth of a second; holds ring.
 * `notes` are in seconds from the start of the audio.
 */
export function levelsFromNotes(notes: { s: number; lane: number; len: number }[], seconds: number): DecodedLevels {
  const n = Math.max(1, Math.ceil(seconds * LEVEL_RATE) + 1);
  const bands = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (const note of notes) {
    const band = note.lane === 0 ? 0 : note.lane === 3 ? 2 : 1;
    const a = Math.max(0, Math.round(note.s * LEVEL_RATE));
    const ring = Math.max(0.2, note.len) * LEVEL_RATE;
    for (let i = 0; i < ring + LEVEL_RATE * 0.6 && a + i < n; i++) {
      const v = i < ring ? 1 - (i / ring) * 0.3 : 0.7 * Math.exp(-(i - ring) / (LEVEL_RATE * 0.18));
      bands[band][a + i] = Math.max(bands[band][a + i], v);
      // Every hit also lifts the other bands a little, the way a real mix does.
      for (const o of [0, 1, 2]) if (o !== band) bands[o][a + i] = Math.max(bands[o][a + i], v * 0.35);
    }
  }
  const bytes = (x: Float32Array) => Uint8Array.from(x, (v) => Math.round(Math.min(1, v) * 255));
  return { rate: LEVEL_RATE, bass: bytes(bands[0]), mid: bytes(bands[1]), high: bytes(bands[2]) };
}

/** Bass, mids and highs (0..1) at `sec` seconds into the audio. */
export function levelAt(l: DecodedLevels, sec: number): { bass: number; mid: number; high: number } {
  const x = sec * l.rate;
  const i = Math.floor(x), f = x - i;
  const at = (b: Uint8Array) => {
    if (i < 0 || i >= b.length) return 0;
    const a = b[i], c = b[Math.min(b.length - 1, i + 1)];
    return (a + (c - a) * f) / 255;
  };
  return { bass: at(l.bass), mid: at(l.mid), high: at(l.high) };
}
