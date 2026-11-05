import type { Song } from '../api/types';

export const songSeconds = (s: Song) => Math.round((s.lengthBeats * 60) / s.bpm);
export const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
