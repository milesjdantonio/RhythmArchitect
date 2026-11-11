// Shared contract between the frontend and the backend (mocked for now in mock-server/).
// Keep this file free of browser and Node APIs: both sides import it.
//
// The product: a player asks for a real song; the backend finds the track and an AI maps it into
// a beatmap with one chart per difficulty. The AI does not make music.

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

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
  /** What the charter says each difficulty follows (from the AI charter, when it gives one). */
  summary?: string;
  /**
   * What the trained beat tracker found (dev tools): its tempo, meter and how sure it was, and
   * whether its grid set the map's tempo, e.g. "Beat This!: 104 BPM, 4/4, 92% on its grid (used)".
   */
  beat?: string;
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
  /** Stable id within this request; the chart plan refers to sounds by it. */
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

/**
 * What the browser measured in a song, sent to the AI charter (POST /api/chart). No audio: the
 * timing grid, the song's shape and every sound found in it. The backend decides which sounds
 * become tiles on each difficulty, and in which lanes (see ChartPlan and docs/claude-backend.txt).
 */
export interface ChartRequest {
  version: 1;
  song: { title: string; artist: string; videoId?: string; seconds: number };
  timing: {
    bpm: number;
    /** Seconds into the video where beat 0 lands. */
    offset: number;
    /** Beats per bar. */
    meter: number;
    lengthBeats: number;
    /** How sure the measurement is of the tempo and grid, 0..1. */
    confidence: number;
  };
  /** Loudness of every bar, 0..1 (bar k starts at beat k × meter). */
  barEnergy: number[];
  /** Rough sections from loudness (8-bar blocks) and the loudness moments found (drops, breaks). */
  sections: { label: string; beat: number }[];
  cues: Cue[];
  events: SoundEvent[];
  /** What the app enforces on the answer (for the backend's prompt). */
  rules: { lanes: number; difficulties: Difficulty[]; maxNotesPerSound: number; minHoldBeats: number };
}

/** A tile in a chart plan: which sound it is, its lane, and whether it's held. */
export interface PlanNote {
  /** A SoundEvent id from the request. Two notes with the same id (different lanes) make a chord. */
  id: number;
  /** 0..lanes-1, left to right (keys D F J K). */
  lane: number;
  /** Held for the sound's ring (at least rules.minHoldBeats; never longer than the sound rings). */
  hold?: boolean;
  /** Hold length in beats (optional; defaults to how long the sound rings, up to 8). */
  len?: number;
}

/** The AI charter's answer (POST /api/chart): the tiles of each difficulty, by sound id. */
export interface ChartPlan {
  /** Who charted it, shown in the dev tools, e.g. "Claude charter v1 (claude-opus-5-5)". */
  mapper: string;
  charts: Record<Difficulty, PlanNote[]>;
  /** Better section labels than the loudness guess (optional), e.g. Verse, Chorus, Bridge. */
  sections?: { label: string; beat: number }[];
  /** Moments for the visuals (optional; replaces the measured cues when given). */
  cues?: Cue[];
  /** One or two sentences on what each difficulty follows (dev tools). */
  summary?: string;
}

/**
 * How far the AI charter has got (POST /api/chart with Accept: application/x-ndjson). First the
 * song plan ("plan": 0 of 1 while the AI reads the whole song, then 1 of 1); then it splits each
 * difficulty into chunks of the song, and says so each time one is charted.
 */
export interface ChartProgress {
  difficulty: Difficulty | 'plan';
  /** Chunks charted so far, out of `total`. */
  done: number;
  total: number;
  /** Tiles picked so far (before the browser's checks). */
  tiles: number;
}

/** One line of the streamed chart answer: progress while it works, then the plan or an error. */
export type ChartStreamLine = { progress: ChartProgress } | { plan: ChartPlan } | { error: string; status?: number };

/** A song mapped by listening in the browser, to be saved (POST /api/songs). */
export type NewSong = Omit<Song, 'id' | 'createdAt' | 'best' | 'plays' | 'favorite' | 'builtIn'>;

export interface ScoreSubmit {
  difficulty: Difficulty;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: Grade;
}

export interface SongList {
  songs: Song[];
}
