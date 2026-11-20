// Shared contract between the frontend and the backend (mocked for now in mock-server/).
// Keep this file free of browser and Node APIs: both sides import it.
//
// The product: a player asks for a real song; the backend finds the track and an AI maps it into
// a beatmap with one chart per difficulty. The AI does not make music.

/** Each a step harder than the last; Ultra is the whole chart (see mapping/thin.ts KEEP). */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'ultra';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'ultra'];

/** One tile. Times and lengths are in beats from the start of the song. */
export interface ChartNote {
  /** Beat the tile reaches the hit line. */
  t: number;
  lane: number;
  /** Scientific pitch, e.g. "C5". The note synth-played songs play for this tile. */
  pitch: string;
  /** Length in beats. Notes with hold = true must be held this long. */
  len: number;
  hold?: boolean;
}

export interface Chart {
  difficulty: Difficulty;
  lanes: number;
  notes: ChartNote[];
  /** Its osu!mania star rating (how hard it plays), when the trained mapper made it. */
  stars?: number;
}

/** Where a song's audio comes from. */
export interface TrackSource {
  /**
   * stream  — real audio at `url` (the backend's licensed stream, or a bundled test track).
   * youtube — the song plays in YouTube's embedded player (`videoId`); the app never gets the
   *           audio itself, its clock follows the player.
   * synth   — no audio file: the app's synth plays the map's melody and a backing groove.
   */
  kind: 'stream' | 'youtube' | 'synth';
  url?: string;
  /** YouTube video id, for `youtube`. */
  videoId?: string;
  /**
   * How a YouTube song's tiles were found:
   *   listened — the browser listened to the video once and the mapper placed every tile.
   *   fan      — a fan-made chart (osu!), lined up with the video by `offset`.
   */
  chart?: 'listened' | 'fan';
  /** Seconds into the audio (or video) where beat 0 of the map lands. */
  offset?: number;
  /** True when `synth` stands in for a real track the backend couldn't supply (the mock). */
  standIn?: boolean;
  /** Licence and author line for bundled audio. */
  credit?: string;
}

/**
 * A moment in the song the visuals should react to (optional; the app derives cues from the
 * sections when the mapper sends none).
 *   build — energy rising toward a drop (the backdrop starts to shake harder)
 *   drop  — the big moment (shockwaves, fountains, a new cymatic figure)
 *   break — the music thins out (everything calms down)
 *   flash — a single accent worth a flash of light
 */
export interface Cue {
  beat: number;
  kind: 'build' | 'drop' | 'break' | 'flash';
  /** 0..1, default 1. */
  strength?: number;
}

/** What the AI mapper reports about a song (drives the visuals; shown in the dev tools). */
export interface MapReport {
  mapper: string;
  /** How sure the mapper is of the tempo and beat grid, 0..1. */
  confidence: number;
  /** Labelled sections in beats, e.g. intro, verse, drop. */
  sections: { label: string; beat: number }[];
  /** Loudness/energy across the song, 0..1, about 48 points. */
  energy: number[];
  /** Moments for the visuals to react to. */
  cues?: Cue[];
  /** What each difficulty follows, as the AI charter of earlier versions put it (older songs only). */
  summary?: string;
  /**
   * What the trained beat tracker found (dev tools): its tempo, meter and how sure it was, and
   * whether its grid set the map's tempo, e.g. "Beat This!: 104 BPM, 4/4, 92% on its grid (used)".
   */
  beat?: string;
  /**
   * How the listening pass lined the recording up with the video (dev tools), e.g. "seamless,
   * 1 stretch, first sound at 0.4 s" or why it fell back to placing it as it was heard.
   */
  listen?: string;
  /**
   * Which difficulty ladder the charts were made on (thin.ts LADDER). The trained mapper's songs
   * from before it (none: the first) are made again from their Ultra when opened (upgrade.ts
   * rethinSong, PUT /api/songs/:id/charts).
   */
  ladder?: number;
}

/** Synth patch for synth-played songs. Names map to Tone.js oscillator types. */
export interface SynthPatch {
  name: string;
  oscillator: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'fatsawtooth' | 'fatsquare' | 'fattriangle' | 'pulse';
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Low-pass cutoff in Hz. */
  cutoff: number;
  /** 0..1 send to the delay/reverb. */
  space: number;
}

/** Quiet backing groove scheduled under the tiles. */
export interface Backing {
  /** Chord roots per bar, e.g. ["A2", "F2", "C3", "G2"], looped. */
  bass: string[];
  /** Drum steps per bar (16 steps). k = kick, s = snare/clap, h = hat, . = rest. */
  drums: string;
}

export interface BestScore {
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: Grade;
  at: string;
  /**
   * 'score': the run was counted again through the game's model classes (main.Score with the
   * multiplier and holds on top: frontend/src/game/score.ts, backend RunReplay). Missing on a best
   * from before, on the game's old points, which any such run replaces.
   */
  /** 'overdrive': counted by the current rules (×10 points, combo to ×5, Overdrive to ×8); anything else is from before and gives way to any new run. */
  rules?: 'overdrive' | 'score';
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface Song {
  id: string;
  title: string;
  artist: string;
  /** What the player asked for, as typed. */
  prompt: string;
  createdAt: string;
  bpm: number;
  /** Beats per bar (4 for most songs, 3 for a waltz). */
  meter?: number;
  key: string;
  scale: string;
  mood: string;
  /** Total length in beats, including the last note's tail. */
  lengthBeats: number;
  /** Two hues (0-360) used to tint the card, tiles and background for this song. */
  hues: [number, number];
  /** Album art (a square image URL that allows cross-origin use). Without it the app shows a living cover. */
  cover?: string;
  source: TrackSource;
  /**
   * How loud the song is over time in three bands, for songs whose audio the app can't analyse
   * while they play (YouTube). Kept from the listening pass; never the audio itself.
   */
  levels?: SongLevels;
  report: MapReport;
  patch: SynthPatch;
  backing: Backing;
  charts: Record<Difficulty, Chart>;
  best: Partial<Record<Difficulty, BestScore>>;
  plays: number;
  favorite: boolean;
  /** Where players miss, per difficulty (the server keeps it from checked runs: game/heat.ts). */
  heat?: Partial<Record<Difficulty, TileHeat>>;
  /** Seeded test content; it can't be deleted from the dev tools. */
  builtIn?: boolean;
}

/** A mapped song as search results show it: enough to list it, without its charts. */
export interface SongSummary {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  lengthBeats: number;
  hues: [number, number];
  source: Pick<TrackSource, 'kind' | 'standIn'>;
  /** Tiles per difficulty. */
  tiles: Record<Difficulty, number>;
  best: Partial<Record<Difficulty, BestScore>>;
  plays: number;
  favorite: boolean;
  cover?: string;
}

export interface SearchResults {
  /** Best matches first, at most 8. */
  results: SongSummary[];
}

/** Loudness in three bands, `rate` frames a second from the start of the audio, one byte (0-255) each, base64. */
export interface SongLevels {
  rate: number;
  bass: string;
  mid: string;
  high: string;
}

export interface SongPatch {
  title?: string;
  favorite?: boolean;
  /** Re-sync: seconds into the audio where beat 0 lands (`source.offset`). */
  offset?: number;
}

/** A YouTube video found for a song (GET /api/youtube). */
export interface VideoMatch {
  videoId: string;
  /** The video's title and channel, as YouTube shows them. */
  title: string;
  channel: string;
  /** Title and artist to file the song under (from what the player typed, or the video). */
  songTitle: string;
  songArtist: string;
  /** Length in seconds, when the search knows it. */
  seconds?: number;
  thumbnail?: string;
}

/** GET /api/youtube/search: the videos that play the song, best first, for the player to choose from. */
export interface VideoResults {
  results: VideoMatch[];
}

/** Ask for a fan-made chart of a song, played from a YouTube video (POST /api/fan-chart). */
export interface FanChartRequest {
  title: string;
  artist: string;
  videoId: string;
  /** The video's length, so a chart of a different cut of the song isn't picked. */
  seconds?: number;
}

/**
 * One sound the browser heard in the song (an onset): the only places a tile may go.
 * Times are exact; `t` is in beats from beat 0 of the grid, `sec` in seconds into the video.
 */
export interface SoundEvent {
  /** Stable id within the song (in time order). */
  id: number;
  /** Beat it sounds on (snapped to a 16th when within 20 ms of one, else exact to 1/1000). */
  t: number;
  /** Seconds into the video (or audio) the attack is heard. */
  sec: number;
  /** The frequency band whose energy jumped: low (< ~180 Hz: kick, bass), mid, high (> ~2.5 kHz: hats, cymbals). */
  band: 'low' | 'mid' | 'high';
  /** Whether it has a clear pitch (a sung or played note) rather than noise (a drum hit). */
  pitched: boolean;
  /** Its pitch as MIDI (60 = C4) and note name, when pitched. */
  midi: number | null;
  note: string | null;
  /** Brightness as a MIDI-like number (the spectrum's centre): tells hats from kicks among unpitched sounds. */
  bright: number;
  /** 0..1: how much it stands out from the music around it. */
  strength: number;
  /** How long it rings, in beats (a hold may last at most this long). */
  len: number;
  /** On a beat (not between beats). */
  onBeat: boolean;
  /** One of the biggest hits of the song, on a bar's downbeat. */
  accent: boolean;
  /**
   * The part it was heard in, when the browser split the song (vocals, drums, bass, other);
   * missing when it was found in the whole mix.
   */
  part?: 'drums' | 'bass' | 'vocals' | 'other';
}

/** One difficulty made by the trained mapper (src/mapping/ensomi.ts), for the charting screen. */
export interface ChartProgress {
  difficulty: Difficulty;
  /** Made: done = total. */
  done: number;
  total: number;
  /** Its tiles. */
  tiles: number;
}

/** A song mapped by listening in the browser, to be saved (POST /api/songs). */
export type NewSong = Omit<Song, 'id' | 'createdAt' | 'best' | 'plays' | 'favorite' | 'builtIn'>;

/**
 * Playing through the controller (POST /api/play, backend PlayController running main.Main): the
 * controller reviews the input and the model keeps the score. `confirmed`: the run so far as the
 * game judged it, checked against the chart and counted through GameScore (the score at the top of
 * the screen; accuracy 0..1), null when it was refused. `reviewed`: the presses Main checked
 * against its queue of notes. Then Main's own state: its Score (`accuracy` 0..100), its clock, the
 * notes left in its queue and the next few (lane, seconds from beat 0).
 */
export interface PlayState {
  confirmed: { score: number; accuracy: number; maxCombo: number } | null;
  reviewed: number;
  /**
   * The controller's review of the inputs (backend InputReview): passed, what it flagged (each
   * check, its first detail, how often), and how many inputs it turned down before Main saw them.
   * A best is kept only from a run that passed.
   */
  review?: PlayReview;
  score: number; combo: number; maxCombo: number; hits: number; misses: number; accuracy: number;
  time: number; left: number; upcoming: { lane: number; time: number }[];
}
export interface PlayReview {
  passed: boolean;
  flags: { check: string; detail: string; count: number }[];
  refused: number;
}
/** A run started: its id, how many notes Main's queue holds, the state. */
export interface PlayStart { run: string; notes: number; state: PlayState }
/** A key press (a lane, 0-3, and the song time) or the clock passing (a time alone). */
export type PlayInput = { lane: number; time: number } | { time: number };
/** Each press's result (Main's HitResult, null when Main turned the input down), then the state. */
export interface PlayReply { results: (string | null)[]; state: PlayState }

/** A song's charts made again on today's ladder (PUT /api/songs/:id/charts): every tile one of its Ultra's. */
export interface ChartsUpdate { charts: Record<Difficulty, Chart>; ladder: number }

/** A difficulty's heat: how many runs were counted, and per tile (in the chart's order) how often one reached it and missed it. */
export interface TileHeat {
  runs: number;
  seen: number[];
  miss: number[];
}

export interface ScoreSubmit {
  difficulty: Difficulty;
  /** The controller's run id (POST /api/play): the score is kept only if it reviewed that run and it passed. */
  play?: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: Grade;
  /**
   * The run in order (game/score.ts): P G E L for a hit, M a miss, H<ms>; a hold held its length,
   * B one let go. The server counts it again and keeps that score, accuracy and max combo.
   */
  run?: string;
  /**
   * Each tile's letter in the chart's own order (P G E L M; "-" not reached: engine.ts tiles()),
   * with `run`: the server keeps where players miss (Song.heat); ignored when it doesn't fit.
   */
  tiles?: string;
}

export interface SongList {
  songs: Song[];
}
