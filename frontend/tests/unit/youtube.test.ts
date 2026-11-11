import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/api/types';
import { FollowClock } from '../../src/audio/clock';
import { Placer, chooseRecording, findTick, placeChunks, type Mark } from '../../src/mapping/capture';
import { computeLevels, decodeLevels, levelAt, levelsFromNotes } from '../../src/mapping/levels';
import { beatGrid, fanNotes, fanSong, parseOsu } from '../../src/mapping/osu';
import { setScore, songFromVideo, videoIdIn, videoScore, type OsuSearchSet } from '../../mock-server/match';
import easyOsu from '../fixtures/osu/9000011.osu?raw';
import hardOsu from '../fixtures/osu/9000012.osu?raw';

describe('fan charts (osu!)', () => {
  const hard = parseOsu(hardOsu);
  const easy = parseOsu(easyOsu);

  it('reads a 4K mania file: tempo, kiai, breaks, taps and holds', () => {
    expect(hard.mode).toBe(3);
    expect(hard.keys).toBe(4);
    expect(hard.creator).toBe('fixturemapper');
    expect(hard.timing[0]).toMatchObject({ ms: 1000, beatLength: 500, uninherited: true });
    expect(hard.timing.some((t) => t.kiai)).toBe(true);
    expect(hard.breaks).toEqual([[21000, 23000]]);
    const holds = hard.objects.filter((o) => o.type & 128);
    expect(holds.length).toBeGreaterThan(3);
    expect(holds[0].endMs! - holds[0].ms).toBe(1000);
  });

  it('keeps the lanes, holds and chords, one tile per lane at a time', () => {
    const notes = fanNotes(hard);
    expect(new Set(notes.map((n) => n.lane))).toEqual(new Set([0, 1, 2, 3]));
    expect(notes.some((n) => n.endMs)).toBe(true);
    const at = new Map<number, number>();
    for (const n of notes) at.set(n.ms, (at.get(n.ms) ?? 0) + 1);
    expect([...at.values()].some((c) => c === 2)).toBe(true);
    for (let l = 0; l < 4; l++) {
      const lane = notes.filter((n) => n.lane === l);
      for (let i = 1; i < lane.length; i++) expect(lane[i].ms).toBeGreaterThan(lane[i - 1].endMs ?? lane[i - 1].ms);
    }
    expect(beatGrid(hard, notes)).toMatchObject({ bpm: 120, beat0Ms: 1000, meter: 4 });
  });

  it('builds a YouTube song: Easy and Medium spaced out from the fan tiles, nothing moved or added', () => {
    const song = fanSong([easy, hard], { title: 'Fixture Song', artist: 'Test Artist', videoId: 'abcdefghijk', seconds: 45 });
    expect(song.source).toMatchObject({ kind: 'youtube', videoId: 'abcdefghijk', chart: 'fan', offset: 1 });
    expect(song.source.credit).toContain('fixturemapper');
    expect(song.bpm).toBe(120);
    const hardTimes = new Set(fanNotes(hard).map((n) => (n.ms - 1000) / 500));
    const easyTimes = new Set(fanNotes(easy).map((n) => (n.ms - 1000) / 500));
    for (const n of song.charts.hard.notes) expect(hardTimes.has(n.t)).toBe(true);
    for (const n of song.charts.easy.notes) expect(easyTimes.has(n.t)).toBe(true);
    for (const d of DIFFICULTIES) {
      const c = song.charts[d];
      expect(c.lanes).toBe(4);
      expect(c.notes.length).toBeGreaterThan(10);
    }
    expect(song.charts.easy.notes.length).toBeLessThan(song.charts.medium.notes.length);
    expect(song.charts.medium.notes.length).toBeLessThanOrEqual(song.charts.hard.notes.length);
    // Easy: a beat apart, no chords.
    const e = song.charts.easy.notes;
    for (let i = 1; i < e.length; i++) expect(e[i].t - e[i - 1].t).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(song.report.sections.map((s) => s.label)).toEqual(expect.arrayContaining(['Intro', 'Chorus', 'Break']));
    expect(song.report.sections.find((s) => s.label === 'Chorus')!.beat).toBe(32);
  });

  it('with one difficulty, shapes Easy and Medium out of it', () => {
    const song = fanSong([hard], { title: 'x', artist: 'y', videoId: 'abcdefghijk' });
    expect(song.charts.easy.notes.length).toBeLessThan(song.charts.medium.notes.length);
    expect(song.charts.medium.notes.length).toBeLessThan(song.charts.hard.notes.length);
    // Medium never puts a tile under a hold.
    const m = song.charts.medium.notes;
    for (const h of m.filter((n) => n.hold)) {
      expect(m.some((n) => n !== h && n.t > h.t && n.t < h.t + h.len)).toBe(false);
    }
  });

  it('folds 7K mania onto four lanes and converts osu! standard (sliders become holds)', () => {
    const seven = parseOsu(['[General]', 'Mode: 3', '[Difficulty]', 'CircleSize:7', '[TimingPoints]', '0,500,4,1,0,60,1,0', '[HitObjects]',
      ...[0, 1, 2, 3, 4, 5, 6].map((c, i) => `${Math.floor(((c + 0.5) * 512) / 7)},192,${i * 250},1,0,0:0:0:0:`)].join('\n'));
    expect(fanNotes(seven).map((n) => n.lane)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    const std = parseOsu(['[General]', 'Mode: 0', '[Difficulty]', 'SliderMultiplier:1.4', '[TimingPoints]', '0,500,4,1,0,60,1,0', '1000,-50,4,1,0,60,0,0', '[HitObjects]',
      '10,100,0,1,0,0:0:0:0:', '500,100,500,1,0,0:0:0:0:', '256,100,1000,2,0,B|300:100,2,140', '256,192,3000,12,0,4000,0:0:0:0:'].join('\n'));
    const notes = fanNotes(std);
    expect(notes.map((n) => n.lane)).toEqual([0, 3, 2, 2]);
    // 140 px at 1.4x and 2x speed = half a beat per slide, twice: 500 ms.
    expect(notes[2]).toMatchObject({ ms: 1000, endMs: 1500 });
    expect(notes[3]).toMatchObject({ ms: 3000, endMs: 4000 });
  });
});

describe('finding the song', () => {
  it('reads video ids from pasted links', () => {
    expect(videoIdIn('https://www.youtube.com/watch?v=FOqKN-ouAUE')).toBe('FOqKN-ouAUE');
    expect(videoIdIn('youtu.be/FOqKN-ouAUE?t=4')).toBe('FOqKN-ouAUE');
    expect(videoIdIn('https://music.youtube.com/watch?v=FOqKN-ouAUE&list=x')).toBe('FOqKN-ouAUE');
    expect(videoIdIn('https://www.youtube.com/watch?list=x&v=FOqKN-ouAUE')).toBe('FOqKN-ouAUE');
    expect(videoIdIn('One Dance')).toBeNull();
  });

  it("files a video under the song's title and artist", () => {
    expect(songFromVideo('One Dance (feat. WizKid & Kyla) - Drake (Official Audio)', 'Drake Media')).toEqual({ title: 'One Dance (feat. WizKid & Kyla)', artist: 'Drake' });
    expect(songFromVideo('Kendrick Lamar - Sing About Me, I\'m Dying Of Thirst', 'KendrickLamarVEVO')).toEqual({ title: "Sing About Me, I'm Dying Of Thirst", artist: 'Kendrick Lamar' });
    expect(songFromVideo('One Dance', 'Drake - Topic')).toEqual({ title: 'One Dance', artist: 'Drake' });
  });

  it('prefers the released song over live takes, covers and sped-up edits', () => {
    const pick = (vs: { title: string; channel: string; seconds?: number }[]) => vs.sort((a, b) => videoScore(b, 'One Dance', 'Drake') - videoScore(a, 'One Dance', 'Drake'))[0].title;
    expect(pick([
      { title: 'One Dance (Live at the O2)', channel: 'Drake', seconds: 200 },
      { title: 'One Dance - sped up', channel: 'edits', seconds: 140 },
      { title: 'One Dance', channel: 'Drake - Topic', seconds: 174 },
      { title: 'Drake - One Dance (Official Music Video)', channel: 'DrakeVEVO', seconds: 250 },
    ])).toBe('One Dance');
  });

  it("picks a fan chart of the song, not a short cut or another song", () => {
    const set = (title: string, length: number, status = 'ranked'): OsuSearchSet => ({ id: 1, title, artist: 'Drake', creator: 'm', status, play_count: 500, beatmaps: [{ id: 2, mode_int: 3, cs: 4, version: 'Hard', difficulty_rating: 3, total_length: length }] });
    const score = (s: OsuSearchSet) => setScore(s, s.beatmaps, 'One Dance', 'Drake', 174);
    expect(score(set('One Dance (Feat. Wizkid & Kyla)', 169))).toBeGreaterThan(0);
    expect(score(set('Hotline Bling', 169))).toBeLessThan(0);
    expect(score(set('One Dance', 200))).toBeLessThan(0); // longer than the video: a different cut
    expect(score(set('One Dance (TV Size)', 90))).toBeLessThan(score(set('One Dance', 169)));
  });
});

describe('following the video', () => {
  it('runs smoothly between coarse reports and stays within a few ms of the true position', () => {
    let now = 0;
    const clock = new FollowClock(() => now);
    let worst = 0;
    for (let ms = 0; ms <= 20_000; ms += 16) {
      now = ms;
      const truth = ms / 1000;
      const raw = Math.floor(ms / 250) * 0.25; // reported every 250 ms
      const t = clock.read(raw, true);
      if (ms > 4000) worst = Math.max(worst, Math.abs(t - (truth - 0.125)));
    }
    // The steady lag (half the report interval here) is the same for mapping and play, so it cancels.
    expect(worst).toBeLessThan(0.13);
  });

  it('never steps backwards while playing, stands still when paused, and jumps on a seek', () => {
    let now = 0;
    const clock = new FollowClock(() => now);
    let last = -1;
    for (let ms = 0; ms < 3000; ms += 16) {
      now = ms;
      const t = clock.read(Math.floor(ms / 250) * 0.25 + (ms % 500 === 0 ? 0.02 : 0), true);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    now = 3100;
    expect(clock.read(2.9, false)).toBe(2.9);
    now = 3500;
    expect(clock.read(2.9, false)).toBe(2.9);
    now = 3600;
    expect(clock.read(60, true)).toBe(60);
  });
});

describe('the listening pass', () => {
  it('files captured audio by video position: continuous through jitter, moved by a seek', () => {
    const sr = 1000;
    const p = new Placer(sr, 10);
    const chunk = (v: number) => new Float32Array(100).fill(v);
    p.write(0, chunk(1));
    p.write(0.1 + 0.012, chunk(2)); // a report 12 ms off: still continuous
    p.write(5, chunk(3)); // a seek
    const pcm = p.result();
    expect(pcm[99]).toBe(1);
    expect(pcm[100]).toBe(2);
    expect(pcm[199]).toBe(2);
    expect(pcm[4999]).toBe(0);
    expect(pcm[5000]).toBe(3);
    expect(pcm.length).toBe(5100);
  });

  describe('placing the whole capture at the end (placeChunks)', () => {
    const sr = 1000;
    // The capture: 100-sample chunks from context time 10 s on, each sample's value its index.
    const capture = (seconds: number) => Array.from({ length: seconds * 10 }, (_, i) => ({ c: 10 + i * 0.1, d: Float32Array.from({ length: 100 }, (_, j) => i * 100 + j + 1) }));
    let seed = 5;
    const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };

    it('is seamless though the player\'s position wobbles by tens of milliseconds', () => {
      // The video starts at context time 10 s; reads every 16 ms, each off by up to ±40 ms.
      const marks: Mark[] = [];
      for (let c = 10; c < 40; c += 0.016) marks.push({ c, v: c - 10 + noise() * 0.08, playing: true });
      const pcm = placeChunks(capture(30), marks, sr, 30);
      // Every sample once, in order, where it was heard (within the median's few ms).
      let jumps = 0;
      for (let i = 1; i < pcm.length; i++) if (pcm[i] !== 0 && pcm[i - 1] !== 0 && pcm[i] - pcm[i - 1] !== 1) jumps++;
      expect(jumps).toBe(0);
      const at = pcm.indexOf(10001); // heard at context 20 s: video 10 s
      expect(Math.abs(at - 10000)).toBeLessThan(15);
    });

    it('keeps what was heard while the page stalled (no position reads for a second)', () => {
      const marks: Mark[] = [];
      for (let c = 10; c < 40; c += 0.016) if (c < 18 || c > 19.2) marks.push({ c, v: c - 10, playing: true });
      const pcm = placeChunks(capture(30), marks, sr, 30);
      expect(pcm[8500]).toBe(8501); // video 8.5 s, in the stall
      expect(pcm.slice(7900, 9300).every((x, i) => x === 7901 + i)).toBe(true);
    });

    it('drops the sound of a pause and goes on where the video goes on; a seek starts a new stretch', () => {
      const marks: Mark[] = [];
      // Plays 0-5 s, buffers 2 s (the video stands at 5 s), plays on from 5 s, then seeks to 20 s at video 10 s.
      for (let c = 10; c < 40; c += 0.016) {
        if (c < 15) marks.push({ c, v: c - 10, playing: true });
        else if (c < 17) marks.push({ c, v: 5, playing: false });
        else if (c < 22) marks.push({ c, v: c - 12, playing: true });
        else marks.push({ c, v: c - 2, playing: true });
      }
      const pcm = placeChunks(capture(30), marks, sr, 40);
      expect(pcm[4000]).toBe(4001); // before the pause
      expect(pcm[6000]).toBe(8001); // video 6 s was heard at context 18 s (after 2 s of buffering)
      expect(pcm[21000]).toBe(13001); // after the seek: video 21 s heard at context 23 s
      expect(pcm[15000]).toBe(0); // skipped by the seek: nothing heard there
    });

    it('keeps the seamless placement, unless it loses the start the as-heard placement has', () => {
      const marks: Mark[] = [];
      for (let c = 10; c < 40; c += 0.016) marks.push({ c, v: c - 10, playing: true });
      const chunks = capture(30);
      // As heard: the same sound in the same places.
      const asHeard = placeChunks(chunks, marks, sr, 30);
      const ok = chooseRecording(chunks, marks, sr, 30, asHeard);
      expect(ok.note).toMatch(/^seamless, 1 stretch/);
      // The position reads only begin 15 s in (as if the start went unseen): the seamless placement
      // has nothing for the first 15 s, the as-heard one does.
      const late = marks.filter((m) => m.c >= 25);
      const chosen = chooseRecording(chunks, late, sr, 30, asHeard);
      expect(chosen.note).toMatch(/^as heard/);
      expect(chosen.pcm).toBe(asHeard);
    });

    it('leaves out what was heard before the video started', () => {
      const marks: Mark[] = [];
      for (let c = 10; c < 13; c += 0.016) marks.push({ c, v: 0, playing: false });
      for (let c = 13; c < 40; c += 0.016) marks.push({ c, v: c - 13, playing: true });
      const pcm = placeChunks(capture(30), marks, sr, 30);
      expect(pcm[0]).toBeGreaterThan(2800); // the first sound placed is from about context 12.9 s on
      expect(pcm[1000]).toBe(4001);
    });
  });

  it('finds the calibration tick in the captured sound', () => {
    const sr = 48000;
    const chunks: { t: number; d: Float32Array }[] = [];
    const t0 = 10;
    for (let k = 0; k < 40; k++) {
      const t = 9.6 + k * (4096 / sr);
      const d = new Float32Array(4096).map(() => (Math.random() - 0.5) * 0.002);
      for (let i = 0; i < d.length; i++) {
        const at = t + i / sr;
        if (at >= t0 + 0.037 && at < t0 + 0.045) d[i] = 0.3 * Math.sin(i);
      }
      chunks.push({ t, d });
    }
    expect(findTick(chunks, sr, t0)).toBeCloseTo(0.037, 2);
    expect(findTick(chunks.map((c) => ({ ...c, d: new Float32Array(c.d.length) })), sr, t0)).toBeNull();
  });

  it('keeps a loudness curve, not the audio: kicks show in the bass, hats in the highs', () => {
    const sr = 22050;
    const pcm = new Float32Array(sr * 4);
    for (let beat = 0; beat < 8; beat++) {
      const at = Math.round(beat * 0.5 * sr);
      for (let i = 0; i < 2000; i++) pcm[at + i] += Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp(-i / 600);
      const hat = at + Math.round(0.25 * sr);
      for (let i = 0; i < 300; i++) pcm[hat + i] += (Math.random() - 0.5) * Math.exp(-i / 60);
    }
    const lv = decodeLevels(computeLevels(pcm, sr));
    expect(lv.rate).toBe(30);
    expect(lv.bass.length).toBeGreaterThan(110);
    const onKick = levelAt(lv, 1.02), onHat = levelAt(lv, 1.26), between = levelAt(lv, 1.4);
    expect(onKick.bass).toBeGreaterThan(between.bass + 0.3);
    expect(onHat.high).toBeGreaterThan(onKick.high);
    // From tiles alone (fan charts): a hit lights its band and fades.
    const fake = levelsFromNotes([{ s: 1, lane: 0, len: 0 }, { s: 2, lane: 3, len: 0 }], 3);
    expect(levelAt(fake, 1.02).bass).toBeGreaterThan(0.8);
    expect(levelAt(fake, 1.6).bass).toBeLessThan(0.2);
    expect(levelAt(fake, 2.02).high).toBeGreaterThan(0.8);
  });
});
