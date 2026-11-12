import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { menuGate } from '../../lib/perf';
import { isCalm } from '../../lib/settings';
import type { ScopePhase } from './ListenScope';

export interface AuraHandle {
  /** The song's lows, mids and highs right now (relative to their peaks, ~0..1). */
  level: (low: number, mid: number, high: number) => void;
  /** A note heard in a band (0 low, 1 mid, 2 high), with its strength 0..1. */
  pulse: (band: number, strength: number) => void;
  /** The map is done: everything flies outward. */
  burst: () => void;
}

const MOTES = 150;
const RINGS = 14;

/**
 * The full-screen light behind the Generate dialog while it listens and maps, so the whole screen
 * hears the song (ListenScope drives it). It never draws over the dialog or the video.
 *
 *   listen  motes of light stream out from behind the dialog, faster with the mids and highs; the
 *           bass breathes a glow round it; every strong note sends a ring of its colour outward.
 *   map /   the motes turn and spiral back in toward the dialog, as if drawn into the work.
 *   chart
 *   done    one burst: every mote flies outward, a ring of light, a flash of the song's colour.
 *
 * Drawn at half resolution with trails (the last frame fades rather than clears). Pooled.
 */
export const ListenAura = forwardRef<AuraHandle, { phase: ScopePhase; hues?: [number, number] }>(
  function ListenAura({ phase, hues = [196, 272] }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const phaseRef = useRef(phase);
    phaseRef.current = phase;
    const S = useRef({
      a: new Float32Array(MOTES), r: new Float32Array(MOTES), v: new Float32Array(MOTES), k: new Uint8Array(MOTES), z: new Float32Array(MOTES),
      ring: new Float32Array(RINGS).fill(9), ringK: new Uint8Array(RINGS), ringS: new Float32Array(RINGS), rNext: 0, lastRing: 0,
      low: 0, mid: 0, high: 0, burst: -1, seeded: false, turn: 0,
    });

    useImperativeHandle(ref, () => ({
      level(low, mid, high) {
        const s = S.current;
        s.low = Math.max(s.low, Math.min(1.3, low));
        s.mid = Math.max(s.mid, Math.min(1.3, mid));
        s.high = Math.max(s.high, Math.min(1.3, high));
      },
      pulse(band, strength) {
        const s = S.current;
        const now = performance.now();
        if (strength < 0.7 || now - s.lastRing < 380) return;
        s.lastRing = now;
        const i = s.rNext;
        s.rNext = (s.rNext + 1) % RINGS;
        s.ring[i] = 0; s.ringK[i] = band; s.ringS[i] = strength;
      },
      burst() {
        const s = S.current;
        s.burst = 0;
        const i = s.rNext;
        s.rNext = (s.rNext + 1) % RINGS;
        s.ring[i] = 0; s.ringK[i] = 1; s.ringS[i] = 1.1;
      },
    }), []);

    useEffect(() => {
      if (isCalm()) return;
      let raf = 0;
      let last = performance.now();
      const hueBand = [hues[0], (hues[0] + hues[1]) / 2, hues[1]];
      const core = hueBand.map((hh) => `hsl(${hh} 100% 78%)`);
      const draw = (ts: number) => {
        raf = requestAnimationFrame(draw);
        const c = canvas.current;
        if (!c || !menuGate(ts)) return;
        const s = S.current;
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // Half resolution: soft light doesn't need more, and it's a full-screen canvas.
        const W = Math.max(1, Math.round(c.clientWidth / 2)), H = Math.max(1, Math.round(c.clientHeight / 2));
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; s.seeded = false; }
        const g = c.getContext('2d')!;
        const cx = W / 2, cy = H / 2;
        const R = Math.hypot(cx, cy);
        const inner = Math.min(W, H) * 0.28; // roughly behind the dialog
        if (!s.seeded) {
          s.seeded = true;
          for (let i = 0; i < MOTES; i++) { s.a[i] = Math.random() * 6.283; s.r[i] = inner + Math.random() * (R - inner); s.v[i] = 0.4 + Math.random(); s.k[i] = i % 3; s.z[i] = Math.random(); }
        }
        // Trails: fade what's there instead of clearing.
        g.globalCompositeOperation = 'destination-out';
        g.globalAlpha = 1;
        g.fillStyle = 'rgb(0 0 0 / 0.24)';
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';

        const ph = phaseRef.current;
        // Turning inward (mapping, charting) eases in, so the motes curve round rather than snap.
        const inwardTarget = (ph === 'map' || ph === 'chart') && s.burst < 0 ? 1 : 0;
        s.turn += (inwardTarget - s.turn) * Math.min(1, dt * 1.5);
        const turn = s.turn;
        // The bass glow, breathing behind the dialog.
        const glowR = inner * (1.25 + s.low * 0.6);
        const grd = g.createRadialGradient(cx, cy, inner * 0.4, cx, cy, glowR * 1.6);
        grd.addColorStop(0, `hsl(${hues[0]} 100% 60% / ${0.03 + s.low * 0.05})`);
        grd.addColorStop(1, `hsl(${hues[1]} 100% 60% / 0)`);
        g.globalAlpha = 1;
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);

        // Motes.
        const speed = 18 + (s.mid * 50 + s.high * 70);
        for (let i = 0; i < MOTES; i++) {
          const k = s.k[i];
          let dr: number, da: number;
          if (s.burst >= 0) { dr = (220 + s.z[i] * 260) * dt; da = 0; }
          else {
            const outR = speed * s.v[i], inR = -(26 + s.z[i] * 34);
            dr = (outR + (inR - outR) * turn) * dt;
            da = (0.08 * (k - 1) * (1 - turn) + (0.45 + s.z[i] * 0.35) * turn) * dt;
          }
          const r0 = s.r[i];
          s.r[i] += dr;
          s.a[i] += da;
          if (s.r[i] > R + 20) { s.r[i] = inner * (0.9 + Math.random() * 0.3); s.a[i] = Math.random() * 6.283; }
          if (s.r[i] < inner * 0.8) { s.r[i] = R * (0.7 + Math.random() * 0.3); s.a[i] = Math.random() * 6.283; continue; }
          const ca = Math.cos(s.a[i]), sa = Math.sin(s.a[i]);
          const x = cx + ca * s.r[i], y = cy + sa * s.r[i] * 0.8;
          const x0 = cx + Math.cos(s.a[i] - da) * r0, y0 = cy + Math.sin(s.a[i] - da) * r0 * 0.8;
          const bright = k === 0 ? s.low : k === 1 ? s.mid : s.high;
          g.globalAlpha = 0.08 + 0.22 * s.z[i] + bright * 0.18;
          g.strokeStyle = core[k];
          g.lineWidth = 0.5 + s.z[i] * 0.8;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke();
        }

        // Rings from strong notes (and the final burst).
        for (let i = 0; i < RINGS; i++) {
          if (s.ring[i] >= 1.6) continue;
          s.ring[i] += dt;
          const t = s.ring[i] / 1.6;
          const rr = inner + (R - inner) * (1 - Math.pow(1 - t, 2));
          g.globalAlpha = (1 - t) * 0.2 * s.ringS[i];
          g.strokeStyle = core[s.ringK[i]];
          g.lineWidth = 0.8 + s.ringS[i];
          g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.8, 0, 0, 6.283); g.stroke();
        }
        if (s.burst >= 0) {
          s.burst += dt;
          if (s.burst < 0.4) {
            g.globalAlpha = (1 - s.burst / 0.4) * 0.06;
            g.fillStyle = `hsl(${hues[0]} 100% 75%)`;
            g.fillRect(0, 0, W, H);
          }
        }
        s.low *= 0.92; s.mid *= 0.9; s.high *= 0.88;
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
      };
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }, [hues[0], hues[1]]);

    return <canvas ref={canvas} className="listen-aura" aria-hidden />;
  },
);
