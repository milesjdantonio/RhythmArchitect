import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import type { ChartProgress, Difficulty } from '../../api/types';
import { isCalm } from '../../lib/settings';
import { Icon } from '../Icon';
import type { AuraHandle } from './ListenAura';

export interface ScopeHandle {
  /** What's heard, every ~12 ms: where in the song (s), its loudness, and its lows, mids and highs. */
  hear: (position: number, rms: number, low?: number, mid?: number, high?: number) => void;
  /** The measured song (once the mapper is done): every sound (seconds, band 0 low / 1 mid / 2 high, strength 0..1) and the bar lines (seconds). */
  sounds: (list: { sec: number; band: number; strength: number }[], bars: number[]) => void;
  /** The finished map: every tile (song seconds, lane 0-3), flown from its sound into its lane; and how many tiles each difficulty has. */
  tiles: (tiles: { time: number; lane: number }[], counts?: Record<Difficulty, number>) => void;
  /** How far the AI charter has got with one difficulty (each time it charts a chunk of the song). */
  progress: (p: ChartProgress) => void;
  /** What the mapper is doing ("splitting the song") and how far, 0..1, while it maps. */
  mapping: (what: string, p?: number) => void;
}

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const DIFF_NAMES = ['Easy', 'Medium', 'Hard'];

export type ScopePhase = 'listen' | 'map' | 'chart' | 'done';

const BINS = 240;
const FOUND = 1600; // notes heard live (pooled)
const SOUNDS = 8000; // measured sounds
const SPARKS = 360;
const RINGS = 16;
const LINKS = 26;
const TILES = 4000;
const FLY_MS = 1500; // the front of tiles flying into their lanes, left to right
const HOP_MS = 460; // one tile's flight
const LANES = 4;
const BAND_NAMES = ['LOW', 'MID', 'HIGH'];
const LANE_KEYS = ['D', 'F', 'J', 'K'];

/**
 * The listening and mapping animation, under the video: the song as a field of light, in four acts.
 *
 *   listen  The song fills in as it's heard: its lows, mids and highs as three rivers of light,
 *           left to right. Every note heard (a sharp rise in a band) pops up as a star over its
 *           river, throws sparks and a ring, and stays: the song's notes gather into a
 *           constellation. Three orbs ride the playhead, swelling with each band. A counter
 *           counts the sounds.
 *   map     A beam sweeps the song again and again while the mapper finds the beat and every
 *           note; the stars flare as it passes.
 *   chart   The measured sounds settle in exactly where they are (a wave, left to right), the bar
 *           lines draw down, and four lanes open below. While the AI charter decides, threads of
 *           light reach from sounds down to lanes, flickering, and a light drifts across. As the
 *           charter reports progress, Easy, Medium and Hard are built one at a time: the lanes
 *           fill with light left to right as that difficulty's chunks come back; when it's
 *           finished the lanes flash, it gets a check and its tile count, and the next one starts.
 *           (The chunks are charted in parallel; the reveal goes in order, catching up quickly on
 *           a difficulty that already finished.)
 *   done    Every tile leaps from its sound down into its lane, left to right, and lands with a
 *           flash; then the tile counts of Easy, Medium and Hard count up.
 *
 * It also drives the full-screen aura behind the dialog (ListenAura). Everything is pooled: no
 * allocation per frame.
 */
export const ListenScope = forwardRef<ScopeHandle, { seconds: number; hues?: [number, number]; phase: ScopePhase; aura?: RefObject<AuraHandle | null> }>(
  function ListenScope({ seconds, hues = [196, 272], phase, aura }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const status = useRef<HTMLSpanElement>(null);
    const countsEl = useRef<HTMLDivElement>(null);
    const len = useRef(240);
    len.current = seconds || 240;
    const phaseRef = useRef(phase);
    const phaseAt = useRef(performance.now());
    if (phaseRef.current !== phase) { phaseRef.current = phase; phaseAt.current = performance.now(); }

    // Everything the animation keeps, pooled.
    const S = useRef({
      band: [new Float32Array(BINS), new Float32Array(BINS), new Float32Array(BINS)],
      born: new Float32Array(BINS).fill(-1),
      head: -1,
      peak: [1e-4, 1e-4, 1e-4], avg: [0, 0, 0], cur: [0, 0, 0], lastNote: [0, 0, 0],
      // live notes
      fx: new Float32Array(FOUND), fb: new Uint8Array(FOUND), fs: new Float32Array(FOUND), ft: new Float32Array(FOUND), fn: 0, heard: 0,
      // measured sounds and bars
      sx: new Float32Array(SOUNDS), sb: new Uint8Array(SOUNDS), ss: new Float32Array(SOUNDS), sn: 0, soundsAt: 0,
      bars: new Float32Array(1024), barN: 0,
      // threads while charting
      lFrom: new Int32Array(LINKS), lLane: new Uint8Array(LINKS), lAge: new Float32Array(LINKS).fill(9), lNext: 0, lClock: 0,
      // tiles
      tx: new Float32Array(TILES), tl: new Uint8Array(TILES), ty: new Float32Array(TILES), tn: 0, tilesAt: 0, landed: new Uint8Array(TILES),
      laneFlash: new Float32Array(LANES), counts: null as Record<Difficulty, number> | null, burstDone: false,
      // the charter's progress, per difficulty: chunks done / total, tiles so far; and the reveal,
      // which goes one difficulty at a time (pNow), its fill easing to that difficulty's progress
      pDone: new Float32Array(3), pTotal: new Float32Array(3), pTiles: new Float32Array(3), pOn: false, pReading: false,
      pNow: 0, pFill: 0, pShown: new Uint8Array(3), pShownAt: 0, pTileShown: new Float32Array(3),
      // what the mapper is doing, for the line under the field
      mapWhat: 'finding the beat', mapP: -1,
      // sparks and rings
      px: new Float32Array(SPARKS), py: new Float32Array(SPARKS), pvx: new Float32Array(SPARKS), pvy: new Float32Array(SPARKS), pl: new Float32Array(SPARKS), pk: new Uint8Array(SPARKS), pNext: 0,
      rx: new Float32Array(RINGS), ry: new Float32Array(RINGS), ra: new Float32Array(RINGS).fill(9), rk: new Uint8Array(RINGS), rNext: 0,
      w: 1, h: 1,
    });

    // Geometry: three band rows above, four lanes below.
    const rowY = (b: number, h: number) => h * [0.53, 0.35, 0.17][b];
    const rowAmp = (h: number) => h * 0.085;
    const laneY = (l: number, h: number) => h * 0.72 + (l + 0.5) * ((h * 0.25) / LANES);
    const starY = (b: number, s: number, h: number) => rowY(b, h) - (s - 0.45) * rowAmp(h) * 1.4;

    const spark = (x: number, y: number, n: number, power: number, k: number) => {
      const st = S.current;
      if (isCalm()) return;
      for (let j = 0; j < n; j++) {
        const i = st.pNext;
        st.pNext = (st.pNext + 1) % SPARKS;
        const a = Math.random() * Math.PI * 2;
        const v = (30 + Math.random() * 80) * power;
        st.px[i] = x; st.py[i] = y; st.pvx[i] = Math.cos(a) * v; st.pvy[i] = Math.sin(a) * v - 20;
        st.pl[i] = 0.4 + Math.random() * 0.5; st.pk[i] = k;
      }
    };
    const ring = (x: number, y: number, k: number) => {
      const st = S.current;
      st.rx[st.rNext] = x; st.ry[st.rNext] = y; st.ra[st.rNext] = 0; st.rk[st.rNext] = k;
      st.rNext = (st.rNext + 1) % RINGS;
    };

    useImperativeHandle(ref, () => ({
      hear(position, rms, low = rms, mid = 0, high = 0) {
        const st = S.current;
        const frac = position / len.current;
        const i = Math.floor(frac * BINS);
        if (i < 0 || i >= BINS) return;
        const now = performance.now();
        for (let k = 0; k < 3; k++) {
          const v = k === 0 ? low : k === 1 ? mid : high;
          if (v > st.band[k][i]) st.band[k][i] = v;
          st.peak[k] = Math.max(st.peak[k] * 0.9995, v);
          st.cur[k] = v / st.peak[k];
          // A note: a sharp rise in this band over what it has been doing.
          const a = st.avg[k];
          if (a > 0 && v > a * 1.75 && v > st.peak[k] * 0.2 && now - st.lastNote[k] > 75) {
            st.lastNote[k] = now;
            const s = Math.min(1, v / st.peak[k]);
            const n = st.fn % FOUND;
            st.fx[n] = frac; st.fb[n] = k; st.fs[n] = s; st.ft[n] = now;
            st.fn++; st.heard++;
            const x = frac * st.w, y = starY(k, s, st.h);
            spark(x, y, 3 + Math.round(s * 5), 0.6 + s * 0.7, k);
            if (s > 0.45) ring(x, y, k);
            aura?.current?.pulse(k, s);
          }
          st.avg[k] = a === 0 ? v : a * 0.88 + v * 0.12;
        }
        if (st.born[i] < 0) st.born[i] = now;
        st.head = Math.max(st.head, i);
        aura?.current?.level(st.cur[0], st.cur[1], st.cur[2]);
      },
      sounds(list, bars) {
        const st = S.current;
        st.sn = Math.min(SOUNDS, list.length);
        for (let j = 0; j < st.sn; j++) {
          st.sx[j] = list[j].sec / len.current;
          st.sb[j] = Math.max(0, Math.min(2, list[j].band));
          st.ss[j] = Math.max(0, Math.min(1, list[j].strength));
        }
        st.barN = Math.min(st.bars.length, bars.length);
        for (let j = 0; j < st.barN; j++) st.bars[j] = bars[j] / len.current;
        st.soundsAt = performance.now();
        st.head = BINS - 1;
      },
      tiles(list, counts) {
        const st = S.current;
        st.tn = Math.min(TILES, list.length);
        st.landed.fill(0);
        for (let j = 0; j < st.tn; j++) {
          const f = list[j].time / len.current;
          st.tx[j] = f; st.tl[j] = Math.max(0, Math.min(LANES - 1, list[j].lane));
          // Leap from the sound it came from (the nearest measured sound), else from the middle row.
          let best = -1, bd = 1e9;
          for (let q = 0; q < st.sn; q++) { const d = Math.abs(st.sx[q] - f); if (d < bd) { bd = d; best = q; } if (st.sx[q] > f + 0.01) break; }
          st.ty[j] = best >= 0 ? starY(st.sb[best], st.ss[best], st.h) : rowY(1, st.h);
        }
        st.counts = counts ?? null;
        st.tilesAt = performance.now();
        st.burstDone = false;
        // Whatever the reveal hadn't got to yet is done now.
        st.pShown.fill(1);
        st.pNow = 3;
      },
      mapping(what, p) {
        const st = S.current;
        st.mapWhat = what;
        st.mapP = p ?? -1;
      },
      progress(p) {
        const st = S.current;
        st.pOn = true;
        // The song plan: the AI reads the whole song before any difficulty is charted.
        if (p.difficulty === 'plan') { st.pReading = p.done < p.total; return; }
        st.pReading = false;
        const i = DIFFS.indexOf(p.difficulty);
        if (i < 0) return;
        st.pDone[i] = p.done;
        st.pTotal[i] = p.total;
        st.pTiles[i] = p.tiles;
        st.pOn = true;
      },
    }), [aura]);

    useEffect(() => {
      let raf = 0;
      let last = performance.now();
      let lastText = 0;
      const calm = isCalm();
      const hueBand = [hues[0], (hues[0] + hues[1]) / 2, hues[1]];
      const hueLane = (l: number) => hues[0] + ((hues[1] - hues[0]) * l) / (LANES - 1);
      const bandFill = hueBand.map((hh) => `hsl(${hh} 100% 66%)`);
      const bandCore = hueBand.map((hh) => `hsl(${hh} 100% 86%)`);
      const laneFill = [0, 1, 2, 3].map((l) => `hsl(${hueLane(l)} 100% 72%)`);
      const draw = () => {
        raf = requestAnimationFrame(draw);
        const c = canvas.current;
        if (!c) return;
        const st = S.current;
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const dpr = Math.min(2, devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return;
        st.w = w; st.h = h;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const g = c.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.clearRect(0, 0, w, h);
        const ph = phaseRef.current;
        const charting = st.soundsAt > 0;
        const done = st.tilesAt > 0;
        const settle = charting ? Math.min(1, (now - st.soundsAt) / 700) : 0;
        const amp = rowAmp(h);
        const bw = w / BINS;

        // Row guides and labels.
        g.font = '600 8px ui-monospace, monospace';
        g.textBaseline = 'middle';
        for (let k = 0; k < 3; k++) {
          const y = rowY(k, h);
          g.globalAlpha = 0.16;
          g.fillStyle = bandFill[k];
          for (let x = 30; x < w; x += 6) g.fillRect(x, y, 2, 1);
          g.globalAlpha = 0.45;
          g.fillStyle = bandCore[k];
          g.fillText(BAND_NAMES[k], 0, y);
        }

        // The rivers: each band's loudness, mirrored round its row, rising in as it's heard.
        g.globalCompositeOperation = 'lighter';
        const riverDim = charting ? 1 - settle * 0.62 : ph === 'map' ? 0.75 : 1;
        const beam = ph === 'map' && !charting ? (((now - phaseAt.current) / 1150) % 1) * (w + 120) - 60 : -999;
        for (let k = 0; k < 3; k++) {
          const arr = st.band[k], top = st.peak[k], y = rowY(k, h);
          g.fillStyle = bandFill[k];
          for (let i = 0; i <= st.head && i < BINS; i++) {
            if (arr[i] <= 0) continue;
            const grow = st.born[i] < 0 ? 1 : Math.min(1, (now - st.born[i]) / 260);
            const v = Math.min(1, arr[i] / top) * (1 - (1 - grow) * (1 - grow));
            const a = Math.max(1, v * amp);
            const x = i * bw;
            const lit = beam > -900 ? Math.max(0, 1 - Math.abs(x - beam) / 60) : 0;
            g.globalAlpha = (0.16 + 0.5 * v + lit * 0.35) * riverDim;
            g.fillRect(x, y - a, Math.max(1, bw - 0.7), a * 2);
          }
        }

        // The stars: notes heard live (fade out as the measured sounds take over).
        const liveA = charting ? 1 - settle : 1;
        if (liveA > 0.01) {
          const n = Math.min(st.fn, FOUND);
          for (let j = 0; j < n; j++) {
            const x = st.fx[j] * w, k = st.fb[j], s = st.fs[j];
            const y = starY(k, s, h);
            const age = (now - st.ft[j]) / 1000;
            const fresh = Math.max(0, 1 - age / 0.7);
            const lit = beam > -900 ? Math.max(0, 1 - Math.abs(x - beam) / 34) : 0;
            const r = 0.9 + s * 1.4 + fresh * 3 + lit * 1.6;
            g.globalAlpha = liveA * (0.12 + fresh * 0.25 + lit * 0.3);
            g.fillStyle = bandFill[k];
            g.beginPath(); g.arc(x, y, r * 2.4, 0, 6.283); g.fill();
            g.globalAlpha = liveA * (0.55 + 0.45 * Math.max(fresh, lit));
            g.fillStyle = fresh > 0.3 || lit > 0.3 ? '#fff' : bandCore[k];
            g.beginPath(); g.arc(x, y, r * 0.55, 0, 6.283); g.fill();
          }
        }

        // The lanes, waiting (faint) until the charter opens them.
        if (!charting) {
          g.globalAlpha = 0.07;
          for (let l = 0; l < LANES; l++) { g.fillStyle = laneFill[l]; g.fillRect(28, laneY(l, h) - 0.5, w - 28, 1); }
        }

        // The playhead, with three orbs swelling with the bands, while listening.
        if (ph === 'listen' && st.head >= 0 && !charting) {
          const x = (st.head + 1) * bw;
          const grd = g.createLinearGradient(x - 90, 0, x, 0);
          grd.addColorStop(0, `hsl(${hues[1]} 100% 70% / 0)`);
          grd.addColorStop(1, `hsl(${hues[1]} 100% 80% / 0.22)`);
          g.globalAlpha = 1;
          g.fillStyle = grd;
          g.fillRect(x - 90, rowY(2, h) - amp * 1.6, 90, rowY(0, h) - rowY(2, h) + amp * 3.2);
          g.fillStyle = '#fff';
          g.globalAlpha = 0.9;
          g.fillRect(x - 0.5, rowY(2, h) - amp * 1.7, 1.2, rowY(0, h) - rowY(2, h) + amp * 3.4);
          for (let k = 0; k < 3; k++) {
            const v = Math.min(1.2, st.cur[k]);
            const y = rowY(k, h);
            g.globalAlpha = 0.25 + v * 0.3;
            g.fillStyle = bandFill[k];
            g.beginPath(); g.arc(x, y, 4 + v * 9, 0, 6.283); g.fill();
            g.globalAlpha = 0.9;
            g.fillStyle = '#fff';
            g.beginPath(); g.arc(x, y, 1.5 + v * 2, 0, 6.283); g.fill();
            st.cur[k] *= 0.94;
          }
        }

        // The mapping beam.
        if (beam > -900) {
          const grd = g.createLinearGradient(beam - 70, 0, beam + 70, 0);
          grd.addColorStop(0, 'rgb(255 255 255 / 0)');
          grd.addColorStop(0.5, `hsl(${hues[0]} 100% 85% / 0.25)`);
          grd.addColorStop(1, 'rgb(255 255 255 / 0)');
          g.globalAlpha = 1;
          g.fillStyle = grd;
          g.fillRect(beam - 70, 0, 140, h * 0.66);
          g.fillStyle = '#fff';
          g.globalAlpha = 0.8;
          g.fillRect(beam - 0.5, 0, 1, h * 0.66);
        }

        // Charting: bar lines, the measured sounds settling in, the lanes, threads of light.
        if (charting) {
          // Bar lines, drawn down in a wave.
          const lanesTop = h * 0.72;
          g.fillStyle = '#fff';
          for (let j = 0; j < st.barN; j++) {
            const f = st.bars[j];
            if (f < 0 || f > 1) continue;
            const t = Math.max(0, Math.min(1, ((now - st.soundsAt) / 1000 - f * 0.6) / 0.35));
            if (t <= 0) continue;
            g.globalAlpha = (j % 4 === 0 ? 0.2 : 0.08) * (done ? 0.6 : 1);
            g.fillRect(f * w, rowY(2, h) - amp * 1.5, 1, (h - (rowY(2, h) - amp * 1.5)) * t);
          }
          // Lanes, opening from the middle.
          const open = Math.max(0, Math.min(1, ((now - st.soundsAt) / 1000 - 0.3) / 0.6));
          for (let l = 0; l < LANES; l++) {
            const y = laneY(l, h);
            const span = w * (1 - Math.pow(1 - open, 3));
            const fl = st.laneFlash[l];
            g.globalAlpha = 0.28 + fl * 0.6;
            g.fillStyle = laneFill[l];
            g.fillRect((w - span) / 2, y - 0.5, span, 1 + fl * 1.5);
            if (fl > 0) st.laneFlash[l] = Math.max(0, fl - dt * 2.5);
            g.globalAlpha = 0.6 * open;
            g.fillText(LANE_KEYS[l], 0, y);
          }
          g.globalAlpha = 0.25 * open;
          g.fillStyle = '#fff';
          g.fillRect(0, lanesTop - 4, w * open, 0.6);

          // The charter's progress, one difficulty at a time: its lanes fill with light left to
          // right as its chunks come back; finished, the lanes flash and the next one starts.
          if (st.pOn && !st.pReading && !done && st.pNow < 3) {
            const i = st.pNow;
            const finished = st.pTotal[i] > 0 && st.pDone[i] >= st.pTotal[i];
            const target = st.pTotal[i] > 0 ? st.pDone[i] / st.pTotal[i] : 0;
            // Eases toward the real progress; quicker when catching up on a difficulty already done.
            st.pFill += (target - st.pFill) * Math.min(1, dt * (finished ? 6 : 2.5));
            if (finished && st.pFill > 0.985 && now - st.pShownAt > 450) {
              st.pShown[i] = 1;
              st.pShownAt = now;
              st.pTileShown[i] = st.pTiles[i];
              st.pNow++;
              st.pFill = 0;
              for (let l = 0; l < LANES; l++) {
                st.laneFlash[l] = 1;
                spark(w * (0.2 + Math.random() * 0.6), laneY(l, h), 4, 0.8, l % 3);
              }
              ring(w * 0.5, laneY(1.5, h), i);
              aura?.current?.pulse(i, 1);
            } else {
              const fx = w * st.pFill;
              for (let l = 0; l < LANES; l++) {
                g.globalAlpha = 0.22;
                g.fillStyle = laneFill[l];
                g.fillRect(0, laneY(l, h) - 1.5, fx, 3);
              }
              if (fx > 1) {
                const top = laneY(0, h) - 8, bot = laneY(LANES - 1, h) + 8;
                const edge = g.createLinearGradient(fx - 40, 0, fx, 0);
                edge.addColorStop(0, `hsl(${hues[1]} 100% 80% / 0)`);
                edge.addColorStop(1, `hsl(${hues[1]} 100% 85% / 0.3)`);
                g.globalAlpha = 1;
                g.fillStyle = edge;
                g.fillRect(fx - 40, top, 40, bot - top);
                g.fillStyle = '#fff';
                g.globalAlpha = 0.85;
                g.fillRect(fx - 0.5, top, 1, bot - top);
              }
            }
          }

          // The measured sounds.
          const spot = done ? -999 : ((((now - st.soundsAt) / 2600) % 1) * (w + 200)) - 100;
          for (let j = 0; j < st.sn; j++) {
            const x = st.sx[j] * w;
            const t = Math.max(0, Math.min(1, ((now - st.soundsAt) / 1000 - st.sx[j] * 0.7) / 0.3));
            if (t <= 0) continue;
            const k = st.sb[j], s = st.ss[j];
            const y = starY(k, s, h);
            const pop = 1 + (1 - t) * 1.6;
            const near = spot > -900 ? Math.max(0, 1 - Math.abs(x - spot) / 60) : 0;
            const dim = done ? 0.35 : 1;
            g.globalAlpha = t * (0.1 + near * 0.25) * dim;
            g.fillStyle = bandFill[k];
            g.beginPath(); g.arc(x, y, (1.5 + s * 2) * 2.2 * pop, 0, 6.283); g.fill();
            g.globalAlpha = t * (0.5 + 0.3 * s + near * 0.2) * dim;
            g.fillStyle = near > 0.4 ? '#fff' : bandCore[k];
            g.fillRect(x - 0.8 - s * 0.6, y - 0.8 - s * 0.6, 1.6 + s * 1.2, 1.6 + s * 1.2);
          }

          // Threads: the charter considering sounds for lanes, until it answers.
          if (!done && st.sn > 0 && !calm && open > 0.5) {
            st.lClock -= dt;
            if (st.lClock <= 0) {
              st.lClock = 0.05 + Math.random() * 0.05;
              const i = st.lNext;
              st.lNext = (st.lNext + 1) % LINKS;
              st.lFrom[i] = Math.floor(Math.random() * st.sn);
              st.lLane[i] = Math.floor(Math.random() * LANES);
              st.lAge[i] = 0;
            }
          }
          for (let i = 0; i < LINKS; i++) {
            if (st.lAge[i] >= 0.7) continue;
            st.lAge[i] += dt;
            const q = st.lFrom[i];
            const x = st.sx[q] * w, y0 = starY(st.sb[q], st.ss[q], h), y1 = laneY(st.lLane[i], h);
            const a = Math.sin((st.lAge[i] / 0.7) * Math.PI);
            g.globalAlpha = a * 0.55;
            g.strokeStyle = laneFill[st.lLane[i]];
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x, y0);
            g.quadraticCurveTo(x + 14, (y0 + y1) / 2, x, y1);
            g.stroke();
            g.globalAlpha = a;
            g.fillStyle = '#fff';
            g.fillRect(x - 1.5, y0 - 1.5, 3, 3);
            g.fillRect(x - 2, y1 - 1, 4, 2);
          }
        }

        // Done: every tile leaps from its sound into its lane, left to right.
        if (done) {
          const el = now - st.tilesAt;
          let allIn = true;
          for (let j = 0; j < st.tn; j++) {
            const start = st.tx[j] * FLY_MS;
            const u = (el - start) / HOP_MS;
            if (u <= 0) { allIn = false; continue; }
            const l = st.tl[j];
            const x = st.tx[j] * w, y1 = laneY(l, h), y0 = st.ty[j];
            if (u < 1) {
              allIn = false;
              const e = 1 - Math.pow(1 - u, 3);
              const y = y0 + (y1 - y0) * e - Math.sin(u * Math.PI) * 10;
              g.globalAlpha = 0.35;
              g.strokeStyle = laneFill[l];
              g.lineWidth = 1;
              g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y); g.stroke();
              g.globalAlpha = 1;
              g.fillStyle = '#fff';
              g.fillRect(x - 1.5, y - 1.5, 3, 3);
            } else {
              if (!st.landed[j]) {
                st.landed[j] = 1;
                st.laneFlash[l] = Math.min(1, st.laneFlash[l] + 0.35);
                if (j % 3 === 0) spark(x, y1, 2, 0.5, l % 3);
              }
              const glow = Math.max(0, 1 - (u - 1) * 2);
              g.globalAlpha = 0.85;
              g.fillStyle = laneFill[l];
              g.fillRect(x - 2, y1 - 1.5, 4, 3);
              if (glow > 0) { g.globalAlpha = glow * 0.7; g.fillStyle = '#fff'; g.fillRect(x - 3, y1 - 2.5, 6, 5); }
            }
          }
          if (allIn && !st.burstDone) { st.burstDone = true; aura?.current?.burst(); }
          // The counts of each difficulty count up once the tiles are in.
          if (st.counts && countsEl.current) {
            const k = Math.max(0, Math.min(1, (el - FLY_MS - HOP_MS * 0.5) / 900));
            const e = 1 - Math.pow(1 - k, 3);
            const spans = countsEl.current.querySelectorAll<HTMLElement>('b');
            spans.forEach((b, i) => {
              // From where the charter's progress left it (its count before the browser's checks).
              const from = st.pOn ? st.pTileShown[i] : 0;
              const v = String(Math.round(from + (st.counts![DIFFS[i]] - from) * e));
              if (b.textContent !== v) b.textContent = v;
            });
            if (k > 0) countsEl.current.dataset.on = 'true';
            if (countsEl.current.dataset.mode === 'chart') {
              countsEl.current.dataset.mode = 'done';
              for (const item of Array.from(countsEl.current.children) as HTMLElement[]) item.dataset.state = 'done';
            }
          }
        }

        // Sparks and rings.
        for (let i = 0; i < RINGS; i++) {
          if (st.ra[i] >= 0.9) continue;
          st.ra[i] += dt;
          const t = st.ra[i] / 0.9;
          g.globalAlpha = (1 - t) * 0.6;
          g.strokeStyle = bandCore[st.rk[i]];
          g.lineWidth = 1;
          g.beginPath(); g.arc(st.rx[i], st.ry[i], 3 + t * 30, 0, 6.283); g.stroke();
        }
        for (let i = 0; i < SPARKS; i++) {
          if (st.pl[i] <= 0) continue;
          st.pl[i] -= dt;
          st.pvy[i] += 90 * dt;
          st.px[i] += st.pvx[i] * dt; st.py[i] += st.pvy[i] * dt;
          g.globalAlpha = Math.min(1, st.pl[i] * 2.2);
          g.fillStyle = bandCore[st.pk[i]];
          g.fillRect(st.px[i], st.py[i], 1.6, 1.6);
        }
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;

        // The line under the field: what it's doing.
        if (status.current && now - lastText > 120) {
          lastText = now;
          // (The finished ones have their checks beside it; kept short so the row doesn't wrap.)
          const building = !charting || !st.pOn ? '' : st.pReading ? 'the AI is reading the whole song'
            : st.pNow < 3 ? `the AI is charting ${DIFF_NAMES[st.pNow]}` : '';
          const text = done ? 'Every tile on a sound' : building ? building : charting ? `${st.sn} sounds · the AI is charting` : ph === 'map' ? `${st.heard} sounds heard · ${st.mapWhat}${st.mapP >= 0 ? ` ${Math.round(st.mapP * 100)}%` : ''}` : `${st.heard} sounds heard`;
          if (status.current.textContent !== text) status.current.textContent = text;
          // The difficulties under the field while the charter builds them.
          const el = countsEl.current;
          if (el && charting && st.pOn && !done) {
            if (el.dataset.mode !== 'chart') { el.dataset.mode = 'chart'; el.dataset.on = 'true'; }
            for (let i = 0; i < 3; i++) {
              const item = el.children[i] as HTMLElement | undefined;
              if (!item) continue;
              const state = st.pShown[i] ? 'done' : i === st.pNow && !st.pReading ? 'now' : 'wait';
              if (item.dataset.state !== state) item.dataset.state = state;
              const fill = st.pShown[i] ? 1 : i === st.pNow ? st.pFill : 0;
              const bar = item.querySelector<HTMLElement>('.scope-meter > i');
              if (bar) bar.style.transform = `scaleX(${fill.toFixed(3)})`;
              const b = item.querySelector('b');
              const v = String(Math.round(st.pShown[i] ? st.pTileShown[i] : i === st.pNow ? st.pTiles[i] : 0));
              if (b && b.textContent !== v) b.textContent = v;
            }
          }
        }
      };
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }, [hues[0], hues[1], aura]);

    return (
      <div className={`scope is-${phase}`} aria-hidden>
        <canvas ref={canvas} className="scope-canvas" />
        <div className="scope-foot">
          <span ref={status} className="scope-status mono" />
          <div ref={countsEl} className="scope-counts">
            {DIFF_NAMES.map((name) => (
              <span key={name} data-state="wait">
                <span className="scope-check"><Icon name="check" size={10} /></span>{name} <b>0</b>
                <i className="scope-meter"><i /></i>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  },
);
