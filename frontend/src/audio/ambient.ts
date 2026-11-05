// The menu's music: "Drift", a calm piece composed for Rythm Architect, played live (no file).
//
// In the spirit of Tetris Effect's quiet menus: slow chords on a soft pad, a warm sub under them,
// glassy bells picking out the chords in a gentle 3-3-2 rhythm with an echo across the stereo
// field, and a slow sung line that comes in on alternate passes. 64 BPM, D major with a Lydian
// colour (the C# over G). 16 bars (8 chords, 2 bars each), about a minute, then round again,
// a little different each time:
//   pass 1   the pad and the sub alone for two chords, then the bells
//   pass 2   a soft, sung line joins, high and quiet, under the bells
//   pass 3   the bells bloom a little (a few more notes, the odd one an octave up), no melody
//   then 2 and 3 alternate.
// It runs on its own clock (not Tone's Transport, which the songs use) and schedules a second
// ahead, so a busy frame on the menu can't make a note late; if the page falls behind (a hidden
// tab), it skips ahead instead of firing a pile of late notes. Plenty of voices, so no note is cut
// off mid-ring. It sends the beat to the visuals so the backdrop breathes with it.

import * as Tone from 'tone';
import { bus } from '../lib/bus';
import { getSettings } from '../lib/settings';

const BPM = 64;
const STEP = 60 / BPM / 2; // an eighth note
const CHORD_STEPS = 16; // two bars
const LOOP_STEPS = CHORD_STEPS * 8;

interface Chord { pad: string[]; sub: string; bells: string[] }
const CHORDS: Chord[] = [
  { pad: ['D3', 'A3', 'C#4', 'E4', 'F#4'], sub: 'D2', bells: ['D5', 'E5', 'F#5', 'A5', 'C#6'] }, // Dmaj9
  { pad: ['B2', 'F#3', 'A3', 'D4', 'E4'], sub: 'B1', bells: ['B4', 'D5', 'E5', 'F#5', 'A5'] }, // Bm11
  { pad: ['G2', 'F#3', 'A3', 'C#4', 'D4'], sub: 'G1', bells: ['D5', 'F#5', 'A5', 'B5', 'C#6'] }, // Gmaj9(#11)
  { pad: ['A2', 'E3', 'B3', 'C#4', 'E4'], sub: 'A1', bells: ['C#5', 'E5', 'A5', 'B5', 'E6'] }, // Aadd9
  { pad: ['E3', 'A3', 'C#4', 'F#4'], sub: 'F#1', bells: ['C#5', 'E5', 'F#5', 'A5', 'C#6'] }, // F#m7
  { pad: ['D3', 'F#3', 'B3', 'D4'], sub: 'G1', bells: ['B4', 'D5', 'F#5', 'G5', 'B5'] }, // Gmaj7
  { pad: ['G3', 'B3', 'D4', 'F#4'], sub: 'E2', bells: ['B4', 'D5', 'E5', 'G5', 'B5'] }, // Em9
  { pad: ['E3', 'A3', 'C#4', 'E4'], sub: 'A1', bells: ['C#5', 'E5', 'A5', 'C#6', 'E6'] }, // A
];

/** The sung line: [step in the pass, note, length in eighths]. A question over the first four chords, an answer over the last four. */
const MELODY: [number, string, number][] = [
  [0, 'F#5', 6], [6, 'E5', 2], [8, 'A5', 8],
  [16, 'F#5', 4], [20, 'E5', 4], [24, 'D5', 8],
  [32, 'B4', 4], [36, 'C#5', 4], [40, 'D5', 4], [44, 'E5', 4],
  [48, 'E5', 12],
  [64, 'A5', 6], [70, 'F#5', 2], [72, 'E5', 8],
  [80, 'D5', 4], [84, 'E5', 4], [88, 'F#5', 8],
  [96, 'G5', 6], [102, 'F#5', 2], [104, 'E5', 4], [108, 'B4', 4],
  [112, 'C#5', 8], [120, 'E5', 8],
];

// Which eighths of a chord's two bars the bells play: 3-3-2, then a lighter answer.
const BELLS = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0];
const BLOOM = [1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1];

/**
 * A fixed set of single voices, each note on whichever is free soonest. Tone's PolySynth would hold
 * a note in a JavaScript timer until a few ms before it plays (the engine's lookAhead), so a busy
 * moment on the page made the chords and bells late: the old "glitch". A single voice's note goes
 * straight onto the audio thread's timeline when it's scheduled, a second ahead, so nothing on the
 * page can make it late.
 */
interface Voice {
  triggerAttackRelease(note: Tone.Unit.Frequency, duration: number, time: number, velocity?: number): unknown;
  triggerRelease(time: number): unknown;
}
class Voices<V extends Voice> {
  private pool: { v: V; free: number }[] = [];
  constructor(make: () => V, size: number, private release: number) {
    for (let i = 0; i < size; i++) this.pool.push({ v: make(), free: 0 });
  }
  play(notes: Tone.Unit.Frequency | Tone.Unit.Frequency[], dur: number, time: number, vel = 1) {
    for (const note of Array.isArray(notes) ? notes : [notes]) {
      let best = this.pool[0];
      for (const p of this.pool) if (p.free < best.free) best = p;
      best.v.triggerAttackRelease(note, dur, time, vel);
      best.free = time + dur + this.release + 0.05;
    }
  }
  releaseAll(time: number) {
    for (const p of this.pool) if (p.free > time) { p.v.triggerRelease(time); p.free = time + this.release; }
  }
}

interface Kit {
  out: Tone.Gain;
  pad: Voices<Tone.Synth>;
  sub: Voices<Tone.Synth>;
  bell: Voices<Tone.FMSynth>;
  lead: Tone.Synth;
  air: Tone.NoiseSynth;
}
let kit: Kit | null = null;

/**
 * The menu music's own audio context, made for playback: a 120 ms device buffer (the game's is
 * 10 ms; "playback" alone only doubled it on Windows), so a busy computer (the 3D stage, other
 * tabs) can't starve it into crackles and dropouts. The game's context stays low-latency (its timing is calibrated to it); this music
 * runs on its own clock and keeps in step with nothing but the backdrop's pulse, so it doesn't
 * need low latency. Its reverb, echo and chorus also stay off the game's audio thread.
 */
let ctx: Tone.Context | null = null;
let volume = getSettings().volume;
function context(): Tone.Context {
  if (!ctx) {
    ctx = new Tone.Context(new AudioContext({ latencyHint: 0.12 }));
    ctx.lookAhead = 0.1;
    applyVolume();
  }
  return ctx;
}
function applyVolume() {
  if (!ctx) return;
  const p = ctx.destination.volume;
  if (volume <= 0.001) p.value = -Infinity;
  else p.rampTo(Tone.gainToDb(volume), 0.05);
}
/** The master volume (Settings), as the game's own sound has it (playback.ts applyVolumes). */
export function setAmbientVolume(v: number) {
  volume = v;
  applyVolume();
}
let timer = 0;
let step = 0;
let nextTime = 0;
let wanted = false;
let playing = false;
let stopTimer = 0;
const holds = new Set<string>();

function build(): Kit {
  const out = new Tone.Gain(0).toDestination();
  const reverb = new Tone.Reverb({ decay: 4.5, preDelay: 0.04, wet: 0.6 }).connect(out);
  const echo = new Tone.PingPongDelay({ delayTime: STEP * 3, feedback: 0.38, wet: 0.32 }).connect(reverb);
  const chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 4, depth: 0.6, wet: 0.5 }).connect(reverb).start();
  // The pad breathes: its filter opens and closes over about twenty seconds.
  const padFilter = new Tone.Filter({ frequency: 900, type: 'lowpass', rolloff: -24, Q: 0.6 }).connect(chorus);
  new Tone.LFO({ frequency: 0.05, min: 520, max: 1500 }).connect(padFilter.frequency).start();
  // A chord rings about 13 s (its length and the release), so two or three overlap: 16 voices.
  const pad = new Voices(() => new Tone.Synth({
    oscillator: { type: 'fattriangle', count: 2, spread: 18 },
    envelope: { attack: 2.6, decay: 1, sustain: 0.8, release: 5 },
    volume: -21,
  }).connect(padFilter), 16, 5);
  // Two, so each chord's sub rings out under the next instead of sliding into it.
  const sub = new Voices(() => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 1.2, decay: 0.5, sustain: 0.9, release: 3 }, volume: -17 }).connect(out), 2, 3);
  const bellTone = new Tone.Filter(5200, 'lowpass').connect(echo);
  bellTone.connect(reverb);
  const bell = new Voices(() => new Tone.FMSynth({
    harmonicity: 3.01, modulationIndex: 5,
    oscillator: { type: 'sine' }, modulation: { type: 'sine' },
    envelope: { attack: 0.004, decay: 2.4, sustain: 0, release: 2.4 },
    modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.4 },
    volume: -24,
  }).connect(bellTone), 12, 2.4);
  // The sung line: a quiet sine, slow to swell, with only a touch of vibrato, mostly in the reverb.
  const vibrato = new Tone.Vibrato({ frequency: 4.2, depth: 0.035 }).connect(reverb);
  const lead = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.7, decay: 0.6, sustain: 0.6, release: 3 }, volume: -29 }).connect(vibrato);
  // Air: a soft swell of filtered noise into each new chord.
  const airFilter = new Tone.Filter(3600, 'bandpass').connect(reverb);
  const air = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 1.6, decay: 0.6, sustain: 0, release: 0.8 }, volume: -36 }).connect(airFilter);
  return { out, pad, sub, bell, lead, air };
}

/** Plays one eighth note of the piece at audio time `time`. */
function play(k: Kit, s: number, time: number, visuals = true) {
  const pass = Math.floor(s / LOOP_STEPS);
  const inPass = s % LOOP_STEPS;
  const ci = Math.floor(inPass / CHORD_STEPS);
  const cs = inPass % CHORD_STEPS;
  const chord = CHORDS[ci];
  const chordLen = CHORD_STEPS * STEP;
  // Later passes alternate: the sung line, then the bells in bloom.
  const sung = pass > 0 && pass % 2 === 1;
  const bloom = pass > 0 && pass % 2 === 0;

  if (cs === 0) {
    k.pad.play(chord.pad, chordLen + 0.4, time, 0.55);
    k.sub.play(chord.sub, chordLen - 0.3, time, 0.7);
  }
  if (cs === 12) k.air.triggerAttackRelease(STEP * 3, time);

  // The bells wait for the third chord the first time round.
  if (pass > 0 || ci >= 2) {
    const pattern = bloom ? BLOOM : BELLS;
    if (pattern[cs]) {
      const hits = pattern.slice(0, cs).reduce((a, b) => a + b, 0);
      const up = ci % 2 === 0;
      const i = hits % chord.bells.length;
      const note = chord.bells[up ? i : chord.bells.length - 1 - i];
      // Quieter under the sung line, so it leads.
      const vel = (0.3 + 0.16 * Math.abs(Math.sin(s * 1.7)) + (cs === 0 ? 0.06 : 0)) * (sung ? 0.75 : 1);
      k.bell.play(note, STEP * 4, time, vel);
      if (bloom && cs === 0 && ci % 2 === 1) k.bell.play(Tone.Frequency(note).transpose(12).toNote(), STEP * 3, time + STEP * 0.5, vel * 0.4);
    }
  }

  if (sung) {
    for (const [at, note, len] of MELODY) if (at === inPass) k.lead.triggerAttackRelease(note, len * STEP * 0.95, time, 0.5);
  }

  // The backdrop breathes with it (quarter notes; a downbeat each bar).
  if (visuals && s % 2 === 0) {
    const down = s % 8 === 0;
    // When it's heard: the context's clock runs ahead of the speakers by its latency.
    const c = ctx ?? Tone.getContext();
    const raw = c.rawContext as AudioContext;
    const heard = time + (raw.baseLatency || 0) + (raw.outputLatency || 0);
    c.draw.schedule(() => { if (playing) bus.emit('beat', { downbeat: down }); }, heard);
  }
}

function tick() {
  if (!kit || !ctx) return;
  const now = ctx.now();
  // Fell behind (a hidden tab, a long frame): skip the notes that are already late.
  while (nextTime < now + 0.02) { step++; nextTime += STEP; }
  const horizon = now + 1;
  while (nextTime < horizon) {
    play(kit, step, nextTime);
    step++;
    nextTime += STEP;
  }
}

function update() {
  const on = wanted && holds.size === 0;
  if (on === playing) return;
  playing = on;
  if (on) {
    // Sound is allowed once the game's context runs (the first click); then this one may start too.
    if (Tone.getContext().state !== 'running') { playing = false; return; }
    const c = context();
    if (c.state !== 'running') c.resume().catch(() => {});
    if (!kit) {
      // Its nodes are made in its own context (the build is synchronous, then the game's is back).
      const game = Tone.getContext();
      Tone.setContext(c);
      try { kit = build(); } finally { Tone.setContext(game); }
    }
    if (stopTimer) {
      // Back while it was still fading out: it carries on where it was (notes already scheduled
      // are still to come; anything that fell behind is skipped by tick).
      clearTimeout(stopTimer);
      stopTimer = 0;
    } else {
      step = 0;
      // A beat after the menu has started up (its heaviest moment), so the first notes are never late.
      nextTime = c.now() + 0.6;
    }
    if (!timer) {
      timer = window.setInterval(tick, 200);
      tick();
    }
    kit.out.gain.cancelScheduledValues(c.now());
    kit.out.gain.rampTo(0.9, 3);
  } else if (kit && ctx) {
    kit.out.gain.cancelScheduledValues(ctx.now());
    kit.out.gain.rampTo(0, 1.4);
    // No new notes from now on. The ones already scheduled (up to a second ahead) play out under
    // the fade; once it's done, everything still ringing is let go, so no stale chord comes back
    // when the music starts again.
    clearInterval(timer);
    timer = 0;
    stopTimer = window.setTimeout(() => {
      stopTimer = 0;
      if (playing || !kit || !ctx) return;
      const t = ctx.now();
      kit.pad.releaseAll(t);
      kit.sub.releaseAll(t);
      kit.bell.releaseAll(t);
      kit.lead.triggerRelease(t);
    }, 1600);
  }
}

/** The menu wants its music (or not). Plays once audio is allowed and nothing holds it back. */
export function setAmbient(on: boolean) {
  wanted = on;
  update();
}

/** Silences the menu music while something needs quiet (a song's preview, the listening pass). */
export function holdAmbient(key: string, hold: boolean) {
  if (hold) holds.add(key); else holds.delete(key);
  update();
}

/**
 * Dev: renders the first `seconds` of the piece offline (silently) and reports how loud it gets
 * and the biggest jumps between samples, to catch clipping and clicks.
 */
async function audit(seconds = 125) {
  const buffer = await Tone.Offline(async () => {
    const k = build();
    k.out.gain.value = 0.9;
    await Tone.loaded();
    await new Promise((r) => setTimeout(r, 300)); // the reverb's impulse
    for (let i = 0; i * STEP < seconds - 1; i++) play(k, i, 0.05 + i * STEP, false);
  }, seconds);
  const ch = buffer.toArray() as Float32Array[];
  let peak = 0, sum = 0, n = 0;
  const jumps: { at: number; d: number }[] = [];
  for (const x of ch) {
    for (let i = 1; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      sum += x[i] * x[i]; n++;
      const d = Math.abs(x[i] - x[i - 1]);
      if (d > 0.02) jumps.push({ at: +(i / buffer.sampleRate).toFixed(3), d: +d.toFixed(3) });
    }
  }
  jumps.sort((a, b) => b.d - a.d);
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4), jumps: jumps.length, worst: jumps.slice(0, 8) };
}

/** Dev/test hook. */
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __ambient: unknown }).__ambient = { playing: () => playing, step: () => step, audit, set: setAmbient, hold: holdAmbient };
}
