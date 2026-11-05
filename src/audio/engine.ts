// Audio for the whole app, built on Tone.js.
//   stream songs: the real track plays from its URL, lined up so the map's beat 0 lands on time.
//   youtube songs: YouTube's embedded player plays the song (src/audio/youtube.ts). The page
//                 never gets that audio, so the game clock follows the player instead of the
//                 AudioContext, and the visuals read the song's saved loudness curve.
//   synth songs:  the melody synth (one patch per song) plays every note of the map by itself,
//                 over a quiet backing groove of kick, clap, hats and bass. Used for the
//                 hand-made test map and for stand-ins.
// Hitting a tile makes no sound: the song is the sound, and every tile is one of its notes.
//
// Timing: the game clock is the AudioContext clock. `start()` returns the context time at which
// beat 0 of the song lands; `songTime()` turns "now" into seconds from that point, corrected for
// output latency and the player's offset setting.

import * as Tone from 'tone';
import type { Song, SynthPatch } from '../api/types';
import { bus } from '../lib/bus';
import { cuesFor } from '../music/cues';
import { getSettings } from '../lib/settings';
import { perf } from '../lib/perf';
import { ORDER, cancelFrame, nextFrame } from '../lib/ticker';
import { decodeLevels, levelAt, levelsFromNotes, type DecodedLevels } from '../music/levels';
import { setAmbientVolume } from './ambient';
import { YT_STATE, ytCue, ytNudge, ytPause, ytPlayFrom, ytResume, ytSetVolume, ytState, ytTime, ytWarm } from './youtube';

let unlocked = false;
let melody: Tone.PolySynth | null = null;
let melodyPatch = '';
let melodyFilter: Tone.Filter;
let melodyBus: Tone.Gain;
let spaceSend: Tone.Gain;
let backingBus: Tone.Gain;
let kick: Tone.MembraneSynth;
let clap: Tone.NoiseSynth;
let hat: Tone.NoiseSynth;
let bass: Tone.MonoSynth;
let click: Tone.Synth;
let trackBus: Tone.Gain;
let analyser: Tone.Analyser | null = null;
// Every player ever started and not yet stopped. Stopping stops all of them, so nothing can be
// left playing after the player has moved on to another song.
const players = new Set<Tone.Player>();
// Each start takes a ticket. Stopping, or starting something newer, makes older tickets stale; a
// start that was still loading its track when that happened gives up instead of playing.
let generation = 0;
const buffers = new Map<string, Promise<Tone.ToneAudioBuffer>>();
let built = false;
let scheduled: number[] = [];

function build() {
  if (built) return;
  built = true;
  const ctx = Tone.getContext();
  ctx.lookAhead = 0.03;
  const master = new Tone.Compressor({ threshold: -14, ratio: 3 }).toDestination();
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.28, wet: 1 });
  const reverb = new Tone.Reverb({ decay: 2.8, wet: 1 });
  spaceSend = new Tone.Gain(0.35);
  spaceSend.chain(delay, reverb, master);
  melodyFilter = new Tone.Filter(3200, 'lowpass');
  melodyBus = new Tone.Gain(0.55);
  melodyFilter.connect(melodyBus);
  melodyBus.connect(master);
  melodyBus.connect(spaceSend);

  backingBus = new Tone.Gain(0.5).connect(master);
  trackBus = new Tone.Gain(0.9).toDestination();
  // Everything audible also feeds an analyser, so the visuals can react to any song.
  analyser = new Tone.Analyser({ type: 'fft', size: 256, smoothing: 0.65 });
  master.connect(analyser);
  trackBus.connect(analyser);
  kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 }, volume: -4 }).connect(backingBus);
  const clapFilter = new Tone.Filter(1800, 'bandpass').connect(backingBus);
  clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -10 }).connect(clapFilter);
  const hatFilter = new Tone.Filter(8000, 'highpass').connect(backingBus);
  hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -20 }).connect(hatFilter);
  bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' }, filter: { Q: 2, type: 'lowpass' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.2 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.2, baseFrequency: 120, octaves: 2.6 }, volume: -12,
  }).connect(backingBus);
  click = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 }, volume: -10 }).connect(master);
  applyVolumes();
}

/** Turns everything down (the end screen replays the song quietly); 1 is normal. */
let duck = 1;
export function setDuck(k: number) {
  duck = Math.max(0, Math.min(1, k));
  applyVolumes(0.6);
}

export function applyVolumes(ramp = 0.05) {
  const s = getSettings();
  const v = s.volume * duck;
  Tone.getDestination().volume.rampTo(v <= 0.001 ? -Infinity : Tone.gainToDb(v), ramp);
  if (built) {
    backingBus.gain.rampTo(0.55 * s.backing, 0.05);
    trackBus.gain.rampTo(0.95 * s.backing, 0.05);
  }
  // YouTube's player has its own volume (0-100); "music" at its default plays it at the volume.
  ytSetVolume(100 * v * Math.min(1, s.backing / 0.6));
  // The menu music has its own audio context (ambient.ts): the same master volume.
  setAmbientVolume(v);
}

export interface Levels { bass: number; mid: number; high: number; level: number }
const SILENT: Levels = { bass: 0, mid: 0, high: 0, level: 0 };
let lastLevels = SILENT;
let lastRead = 0;

/** How loud the music is right now in three bands, each 0..1. Cheap to call every frame. */
export function audioLevels(): Levels {
  if (!analyser || Tone.getContext().state !== 'running') return SILENT;
  if (follow) {
    // A YouTube song: its loudness curve, read at the moment being heard.
    const v = levelAt(follow.levels, followTime(follow) + follow.offset);
    return { ...v, level: v.bass * 0.45 + v.mid * 0.35 + v.high * 0.2 };
  }
  const now = performance.now();
  if (now - lastRead < 12) return lastLevels; // two callers per frame share one read
  lastRead = now;
  const db = analyser.getValue() as Float32Array;
  const n = db.length; // 128 bins of ~190 Hz at 48 kHz
  const lin = (d: number) => Math.max(0, Math.min(1, (d + 85) / 60));
  const band = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += lin(db[i]);
    return s / (b - a);
  };
  const bass = band(0, 2), mid = band(2, 16), high = band(16, Math.min(n, 64));
  lastLevels = { bass, mid, high, level: bass * 0.45 + mid * 0.35 + high * 0.2 };
  return lastLevels;
}

/** Dev/test hook: how many tracks are playing right now. */
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __audio: unknown }).__audio = { players: () => players.size, generation: () => generation };
}

/** True once the browser has let audio start (after the first click or key press) and the synths are built. */
export const audioRunning = () => unlocked && built && Tone.getContext().state === 'running';

/**
 * The part of unlocking that has to happen in the click itself, and is cheap: the browser lets
 * sound start. The synths are built by unlockAudio, later (a few hundred ms of work), so the
 * intro's launch keeps a steady frame rate.
 */
export async function wakeAudio() {
  if (!unlocked) {
    await Tone.start();
    unlocked = true;
  }
  if (Tone.getContext().state !== 'running') await Tone.getContext().resume();
}

/** Must be called from a click or key press the first time (browser autoplay rules). */
export async function unlockAudio() {
  if (!unlocked) {
    await Tone.start();
    unlocked = true;
  }
  build();
  if (Tone.getContext().state !== 'running') await Tone.getContext().resume();
}

function usePatch(patch: SynthPatch) {
  const key = JSON.stringify(patch);
  if (melody && melodyPatch === key) return;
  melody?.dispose();
  melody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: patch.oscillator } as Tone.OmniOscillatorOptions,
    envelope: { attack: patch.attack, decay: patch.decay, sustain: patch.sustain, release: patch.release },
    volume: -6,
  });
  melody.maxPolyphony = 16;
  melody.connect(melodyFilter);
  melodyFilter.frequency.value = patch.cutoff;
  spaceSend.gain.value = patch.space;
  melodyPatch = key;
}

export const now = () => Tone.getContext().rawContext.currentTime;
const outputLatency = () => {
  const raw = Tone.getContext().rawContext as AudioContext;
  return (raw.outputLatency || 0) + (raw.baseLatency || 0);
};

/** Seconds since beat 0, as heard. */
export function songTime(startAt: number) {
  if (follow && follow.beat0 === startAt) return followTime(follow);
  return now() - startAt - outputLatency() + getSettings().offsetMs / 1000;
}

// ---------------------------------------------------------------- YouTube songs
//
// The video can't be started at an exact moment (playVideo() takes a few hundred ms, more while
// it buffers), so the song clock waits for it: during the count-in it runs on the AudioContext;
// it holds at the point where the video should start until the video reports it's playing, then
// it is the video's own position (smoothed). If the video stalls, the clock stalls with it, so
// tiles always stay on the sound. Beats, sections and cues are fired from that clock.

interface Follow {
  beat0: number;
  offset: number;
  spb: number;
  meter: number;
  from: number;
  totalBeats: number;
  /** Video position to start from, and the context time to ask for it. */
  startPos: number;
  playAt: number;
  asked: boolean;
  askedAt: number;
  /** When the start was last asked again (see followTick). */
  nudgedAt?: number;
  started: boolean;
  /** After the end (or if the video ends first): the clock coasts on from here. */
  coast: { t: number; at: number } | null;
  /** The song's end has been reached (onEnd called), whether or not the video ended first. */
  done: boolean;
  /** Whole beats from the count-in's Go to beat 0 (the video starts before beat 0). */
  early: number;
  nextBeat: number;
  marks: { beat: number; fire: () => void }[];
  mark: number;
  opts: StartOptions;
  levels: DecodedLevels;
  raf: number;
  /**
   * Smooth hand-off (perf profiles with `clock: 'slew'`): when the video starts, how far the
   * count-in clock was from the video's (seconds), and when (context time). The gap closes at
   * HANDOFF_RATE instead of in one jump.
   */
  handoff: { gap: number; at: number } | null;
}
let follow: Follow | null = null;
/** How long YouTube takes to start once asked (learned), so it's asked that much early. */
let startLag = 0.25;
const levelCache = new Map<string, DecodedLevels>();

function songLevels(song: Song): DecodedLevels {
  const key = `${song.id}:${song.source.offset ?? 0}`;
  let l = levelCache.get(key);
  if (!l) {
    const spb = 60 / song.bpm, off = song.source.offset ?? 0;
    l = song.levels
      ? decodeLevels(song.levels)
      : levelsFromNotes(song.charts.hard.notes.map((n) => ({ s: n.t * spb + off, lane: n.lane, len: n.hold ? n.len * spb : 0 })), song.lengthBeats * spb + off + 2);
    levelCache.set(key, l);
  }
  return l;
}

/** Seconds of clock difference closed per second after the hand-off (the tiles run up to 25% fast or slow). */
const HANDOFF_RATE = 0.25;
/** How far past the video's start point the count-in clock may coast while the video is late (seconds). */
const HANDOFF_COAST = 0.25;

function followTime(f: Follow): number {
  const adjust = -outputLatency() + getSettings().offsetMs / 1000;
  if (f.coast) return f.coast.t + (now() - f.coast.at);
  if (f.started) {
    const v = ytTime() - f.offset + adjust;
    const h = f.handoff;
    if (!h) return v;
    const left = Math.abs(h.gap) - (now() - h.at) * HANDOFF_RATE;
    if (left <= 0) { f.handoff = null; return v; }
    return v + Math.sign(h.gap) * left;
  }
  return countInTime(f, adjust);
}

/** The clock before the video plays: the AudioContext's, held (or eased) at the video's start point. */
function countInTime(f: Follow, adjust: number): number {
  const est = now() - f.beat0 + adjust;
  if (!f.asked) return est;
  const hold = f.startPos - f.offset + adjust;
  if (est <= hold) return est;
  // The video is late. The old way stops the clock dead here (the tiles freeze, then jump when
  // the video comes in); the smooth way slows it to a stop over HANDOFF_COAST, and the hand-off
  // then closes whatever gap is left without a jump.
  if (perf().clock !== 'slew') return hold;
  return hold + HANDOFF_COAST * (1 - Math.exp(-(est - hold) / HANDOFF_COAST));
}

function followTick(f: Follow) {
  if (follow !== f) return;
  f.raf = nextFrame(() => followTick(f), ORDER.clock);
  const c = now();
  if (!f.asked && c >= f.playAt && Tone.getContext().state === 'running') {
    f.asked = true;
    f.askedAt = c;
    ytPlayFrom(f.startPos);
  }
  const st = ytState();
  // Asked, but YouTube is sitting paused (or cued): ask again now and then, rather than wait forever.
  if (f.asked && !f.started && (st === YT_STATE.PAUSED || st === YT_STATE.CUED) && c - (f.nudgedAt || f.askedAt) > 0.6) {
    f.nudgedAt = c;
    ytNudge();
  }
  if (f.asked && !f.started && st === YT_STATE.PLAYING) {
    const v = ytTime();
    if (v > f.startPos + 0.02) {
      // Smooth hand-off: remember how far the count-in clock is from the video's right now.
      if (perf().clock === 'slew') {
        const adjust = -outputLatency() + getSettings().offsetMs / 1000;
        const gap = countInTime(f, adjust) - (v - f.offset + adjust);
        // Over a second apart (an ad, a long stall): jump, as before.
        f.handoff = Math.abs(gap) > 0.005 && Math.abs(gap) < 1 ? { gap, at: c } : null;
      }
      f.started = true;
      startLag = Math.max(0.05, Math.min(1, startLag * 0.6 + (c - f.askedAt - (v - f.startPos)) * 0.4));
    }
  }
  const t = followTime(f);
  if (f.started && !f.coast && st === YT_STATE.ENDED) f.coast = { t, at: c };
  const { spb, from, opts } = f;
  while (t >= f.nextBeat * spb) {
    const b = f.nextBeat++;
    if (b < from) {
      const n = from - b - f.early;
      if (n >= 0) opts.onCount?.(n);
      bus.emit('beat', { downbeat: false });
      continue;
    }
    if (b === from && f.early === 0) opts.onCount?.(0);
    if (b < f.totalBeats) bus.emit('beat', { downbeat: b % f.meter === 0 });
  }
  while (f.mark < f.marks.length && f.marks[f.mark].beat * spb <= t) f.marks[f.mark++].fire();
  // The end of the song. A video often ends a moment before the map does (the clock then coasts
  // on from where the video stopped), so this doesn't wait for the video: it only runs once.
  if (t >= f.totalBeats * spb && !f.done) {
    f.done = true;
    if (!f.coast) f.coast = { t, at: c };
    ytPause();
    opts.onEnd?.();
  }
}

/** Re-syncs the playing YouTube song: seconds into the video where beat 0 lands. */
export function setFollowOffset(offset: number) {
  if (follow) follow.offset = offset;
}

/** Gets a song's audio ready so Start is instant: the track decoded, or the video buffered. */
export async function prepareSong(song: Song): Promise<void> {
  if (song.source.kind === 'stream' && song.source.url) await loadTrack(song.source.url).catch(() => {});
  else if (song.source.kind === 'youtube' && song.source.videoId) await ytWarm(song.source.videoId);
}

/**
 * Every note a synth song plays: all tiles of all three charts, once each. The game and the
 * preview both play this, so whatever difficulty you pick, each tile is a note you hear.
 */
export function songMelody(song: Song): { t: number; pitch: string; len: number }[] {
  const byKey = new Map<string, { t: number; pitch: string; len: number }>();
  for (const d of ['hard', 'medium', 'easy'] as const) {
    for (const n of song.charts[d].notes) {
      const key = `${n.t}:${n.pitch}`;
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { t: n.t, pitch: n.pitch, len: n.len });
      else prev.len = Math.max(prev.len, n.len);
    }
  }
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}

/** Fetches and decodes a track once; later calls share the same buffer. */
export function loadTrack(url: string): Promise<Tone.ToneAudioBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = Tone.ToneAudioBuffer.fromUrl(url);
    buffers.set(url, p);
    p.catch(() => buffers.delete(url));
  }
  return p;
}

interface StartOptions {
  leadInBeats: number;
  /** Start partway through the song. */
  fromBeat?: number;
  /** Click on the lead-in beats (the game's count-in). Off for previews. */
  countIn?: boolean;
  /** Called on the count-in beats with 3, 2, 1… and then 0 on Go: beat 0, or, for a track with an
   *  intro before beat 0, the moment its sound starts (so the count always comes first). */
  onCount?: (n: number) => void;
  /** Melody notes for synth songs (see songMelody). Ignored when a real track plays. */
  autoMelody?: { t: number; pitch: string; len: number }[];
  /** Stop after this many beats (defaults to the song length). */
  beats?: number;
  onEnd?: () => void;
}

/**
 * Starts a song: the real track for stream songs, the backing groove for synth songs, and beat
 * events for the visuals. Resolves to the context time of beat 0 (in the past when `fromBeat` > 0).
 */
export async function startSong(song: Song, opts: StartOptions): Promise<number> {
  halt();
  const ticket = ++generation;
  usePatch(song.patch);
  applyVolumes();
  const stream = song.source.kind === 'stream' && song.source.url;
  const video = song.source.kind === 'youtube' ? song.source.videoId : undefined;
  const buffer = stream ? await loadTrack(song.source.url!) : null;
  if (video) await ytCue(video);
  if (ticket !== generation) throw new DOMException('A newer song took over', 'AbortError');
  const transport = Tone.getTransport();
  transport.bpm.value = song.bpm;
  const spb = 60 / song.bpm;
  const from = opts.fromBeat ?? 0;
  const meter = song.meter ?? 4;
  // A track with sound before beat 0 (an intro): the count-in finishes before that sound starts,
  // so "3, 2, 1, Go" comes first and then the song. `early`: whole beats from Go to beat 0.
  const counting = opts.countIn !== false;
  const intro = song.source.kind !== 'synth' && from === 0 ? Math.max(0, song.source.offset ?? 0) : 0;
  const early = counting ? Math.ceil(intro / spb - 1e-6) : 0;
  const leadIn = Math.max(opts.leadInBeats, counting ? early + 4 : 0);
  const startAt = Tone.now() + 0.15;
  const beat0 = startAt + leadIn * spb - from * spb;
  const totalBeats = opts.beats !== undefined ? from + opts.beats : song.lengthBeats;
  const leadSteps = leadIn * 4;
  const draw = Tone.getDraw();
  let step = from * 4;

  if (video) {
    // The count-in clicks still come from here; everything else follows the video.
    if (counting) {
      for (let n = leadIn; n > early; n--) {
        scheduled.push(transport.schedule((time) => click.triggerAttackRelease(n - early === 1 ? 'C6' : 'G5', 0.05, time, 0.6), (leadIn - n) * spb));
      }
    }
    const offset = song.source.offset ?? 0;
    const audioZero = beat0 - offset;
    const startPos = Math.max(0, Tone.now() + 0.05 - audioZero);
    const marks: Follow['marks'] = [];
    (song.report?.sections ?? []).forEach((sec, index) => {
      if (sec.beat >= from && sec.beat < totalBeats) marks.push({ beat: sec.beat, fire: () => bus.emit('section', { label: sec.label, index }) });
    });
    for (const c of cuesFor(song.report)) {
      if (c.beat >= from && c.beat < totalBeats) marks.push({ beat: c.beat, fire: () => bus.emit('cue', { kind: c.kind, strength: c.strength ?? 1 }) });
    }
    marks.sort((a, b) => a.beat - b.beat);
    const f: Follow = {
      beat0, offset, spb, meter, from, totalBeats, startPos, playAt: audioZero + startPos - startLag,
      asked: false, askedAt: 0, started: false, coast: null, done: false, early, nextBeat: from - leadIn,
      marks, mark: 0, opts, levels: songLevels(song), raf: 0, handoff: null,
    };
    follow = f;
    f.raf = nextFrame(() => followTick(f), ORDER.clock);
    transport.start(startAt);
    return beat0;
  }

  if (buffer) {
    // Audio time 0 plays when beat 0 minus the track's offset comes round.
    const audioZero = beat0 - (song.source.offset ?? 0);
    const at = Math.max(Tone.now() + 0.05, audioZero);
    const player = new Tone.Player(buffer).connect(trackBus);
    player.fadeOut = 0.4;
    player.start(at, Math.max(0, at - audioZero));
    players.add(player);
  }

  scheduled.push(transport.scheduleRepeat((time) => {
    const s = step++ - leadSteps; // 16th steps from beat 0
    if (s < 0) {
      if (s % 4 === 0) {
        const n = -s / 4 - early; // beats left in the count (0: Go)
        if (counting && n >= 1) click.triggerAttackRelease(n === 1 ? 'C6' : 'G5', 0.05, time, 0.6);
        draw.schedule(() => { if (n >= 0) opts.onCount?.(n); bus.emit('beat', { downbeat: false }); }, time);
      }
      return;
    }
    if (s >= totalBeats * 4) {
      draw.schedule(() => opts.onEnd?.(), time);
      for (const p of players) p.stop(time + 0.4);
      transport.stop(time + 0.05);
      return;
    }
    if (s === from * 4 && early === 0) draw.schedule(() => opts.onCount?.(0), time);
    if (!buffer) {
      const inBar = s % 16;
      const hit = song.backing.drums[inBar];
      if (hit === 'k') kick.triggerAttackRelease('C1', '8n', time);
      else if (hit === 's') clap.triggerAttackRelease('16n', time);
      else if (hit === 'h') hat.triggerAttackRelease('32n', time, 0.7);
      if (inBar === 0 || inBar === 8) {
        const bar = Math.floor(s / 16);
        bass.triggerAttackRelease(song.backing.bass[bar % song.backing.bass.length], '4n.', time, 0.8);
      }
    }
    if (s % 4 === 0) draw.schedule(() => bus.emit('beat', { downbeat: (s / 4) % meter === 0 }), time);
  }, '16n', 0));

  // Sections and cues from the map, on the beat, so the visuals react to this song's shape.
  const at = (beat: number) => (leadIn + beat - from) * spb;
  (song.report?.sections ?? []).forEach((sec, index) => {
    if (sec.beat < from || sec.beat >= totalBeats) return;
    scheduled.push(transport.schedule((time) => draw.schedule(() => bus.emit('section', { label: sec.label, index }), time), at(sec.beat)));
  });
  for (const c of cuesFor(song.report)) {
    if (c.beat < from || c.beat >= totalBeats) continue;
    scheduled.push(transport.schedule((time) => draw.schedule(() => bus.emit('cue', { kind: c.kind, strength: c.strength ?? 1 }), time), at(c.beat)));
  }

  if (opts.autoMelody && !buffer) {
    for (const n of opts.autoMelody) {
      if (n.t >= totalBeats || n.t < from) continue;
      scheduled.push(transport.schedule((time) => {
        melody?.triggerAttackRelease(n.pitch, Math.max(0.1, n.len * spb), time, 0.75);
      }, (leadIn + n.t - from) * spb));
    }
  }
  transport.start(startAt);
  return beat0;
}

/** Stops whatever is playing and cancels any song still loading. */
export function stopSong() {
  generation++;
  halt();
}

let winding = 0;
let wound = false;
/**
 * A failed run: the music winds down over `seconds`, like a tape stopping. Real tracks and synth
 * songs slow to a stop as they fade; a YouTube song fades (its speed can't glide). The caller
 * stops the song afterwards; stopping puts the volume back.
 */
export function windDown(seconds: number) {
  const ticket = ++winding;
  wound = true;
  const start = performance.now();
  const transport = Tone.getTransport();
  const bpm = transport.bpm.value;
  const ps = [...players];
  const s = getSettings();
  const ytFrom = 100 * s.volume * Math.min(1, s.backing / 0.6);
  Tone.getDestination().volume.rampTo(-42, seconds * 1.05);
  const step = () => {
    if (ticket !== winding) return;
    const k = Math.min(1, (performance.now() - start) / 1000 / seconds);
    const rate = Math.max(0.06, Math.pow(1 - k, 1.5));
    for (const p of ps) { try { p.playbackRate = rate; } catch { /* stopped */ } }
    if (transport.state === 'started') transport.bpm.value = bpm * rate;
    if (follow) ytSetVolume(ytFrom * (1 - k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function halt() {
  if (wound) { wound = false; winding++; applyVolumes(); }
  if (follow) {
    cancelFrame(follow.raf);
    if (follow.asked) ytPause();
    follow = null;
  }
  for (const p of players) {
    try { p.stop(); } catch { /* not started */ }
    p.dispose();
  }
  players.clear();
  const transport = Tone.getTransport();
  transport.stop();
  for (const id of scheduled) transport.clear(id);
  scheduled = [];
  transport.cancel(0);
  transport.position = 0;
  melody?.releaseAll();
}

export async function pauseAudio() {
  // Whatever the video is doing, a pause stops it.
  if (follow || ytState() === YT_STATE.PLAYING) ytPause();
  await (Tone.getContext().rawContext as AudioContext).suspend();
}
export async function resumeAudio() {
  await (Tone.getContext().rawContext as AudioContext).resume();
  if (follow?.asked && !follow.coast) ytResume();
}

/**
 * The whole song from the beginning to the end: the real track (including any intro before
 * beat 0), or the melody with the backing. Resolves to when beat 0 lands (so visuals can follow)
 * and a stop.
 */
export async function previewSong(song: Song, onEnd: () => void): Promise<PreviewHandle> {
  const notes = songMelody(song);
  // Enough silent lead-in that a real track starts from its very first sample.
  const spb = 60 / song.bpm;
  const leadInBeats = song.source.kind !== 'synth' ? Math.ceil(((song.source.offset ?? 0) + 0.05) / spb) : 0;
  let end = onEnd;
  let ended = false;
  const beat0 = await startSong(song, { leadInBeats, countIn: false, autoMelody: notes, onEnd: () => { ended = true; end(); } });
  const ticket = generation;
  // Dev: the latest preview's start and position (seconds from beat 0), for checks.
  if (import.meta.env.DEV) (window as unknown as { __preview?: unknown }).__preview = { songId: song.id, beat0, time: () => songTime(beat0) };
  return {
    songId: song.id,
    beat0,
    // Only stops this preview: if something newer is already playing, it is left alone.
    stop: () => { if (generation === ticket) stopSong(); },
    setOnEnd: (f) => { end = f; },
    live: () => generation === ticket && !ended,
  };
}

/** A preview playing: when its beat 0 lands (for the visuals), how to stop it, who hears its end. */
export interface PreviewHandle {
  songId: string;
  beat0: number;
  stop(): void;
  setOnEnd(f: () => void): void;
  /** Still playing (not stopped, not replaced, not finished). */
  live(): boolean;
}

/**
 * A preview handed from one screen to the next: the end screen's quiet replay keeps playing on the
 * way back to the menu, and the menu takes it over (takePreview) rather than start the song again,
 * so the music carries on from where it was. Not taken within HAND_MS, it stops.
 */
const HAND_MS = 4000;
let handed: { p: PreviewHandle; timer: number } | null = null;
export function handOverPreview(p: PreviewHandle) {
  if (handed) { clearTimeout(handed.timer); if (handed.p !== p) handed.p.stop(); handed = null; }
  if (!p.live()) return;
  p.setOnEnd(() => {});
  const timer = window.setTimeout(() => { if (handed?.p === p) { handed = null; p.stop(); } }, HAND_MS);
  handed = { p, timer };
}
/** The handed-over preview, if it is this song's and still playing (then it's yours to stop). */
export function takePreview(songId: string): PreviewHandle | null {
  const h = handed;
  if (!h || h.p.songId !== songId || !h.p.live()) return null;
  clearTimeout(h.timer);
  handed = null;
  return h.p;
}
