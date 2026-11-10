package com.rhythmarchitect.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.rhythmarchitect.backend.match.Matching;
import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.osu.Osu;

import main.Difficulty;
import main.Note;
import main.Queue;
import main.Song;
import main.SongMapper;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** The pure parts: text matching, the osu! port, the charter's prompt and plan repair. */
class MappingTests {

    static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void textMatching() {
        assertEquals("beyonce halo", Text.norm("Beyoncé — Halo!"));
        assertEquals("song", Text.bare("Song (feat. Someone) [Official Audio]"));
        assertEquals(4, Text.match("Halo", "halo"));
        assertEquals(3, Text.match("Halo Theme", "hal"));
        assertEquals("dQw4w9WgXcQ", Text.videoIdIn("https://youtu.be/dQw4w9WgXcQ?t=3"));
        List<String> titles = new ArrayList<>(List.of("Track 10", "track 2", "Éclair", "apple"));
        titles.sort(Text.NATURAL);
        assertEquals(List.of("apple", "Éclair", "track 2", "Track 10"), titles);
    }

    @Test
    void songFromVideoTitles() {
        assertEquals(new Matching.SongName("Mr. Brightside", "The Killers"),
            Matching.songFromVideo("The Killers - Mr. Brightside (Official Music Video)", "The Killers"));
        assertEquals(new Matching.SongName("Halo", "Beyoncé"), Matching.songFromVideo("Halo", "Beyoncé - Topic"));
    }

    /** A small osu!mania 4K file: 64 taps on the beat at 120 BPM, with two holds and a kiai. */
    static String maniaMap() {
        StringBuilder b = new StringBuilder("osu file format v14\n\n[General]\nMode: 3\n\n[Metadata]\nTitle:Test\nArtist:Band\n"
            + "Creator:fan\nVersion:4K Hard\nBeatmapSetID:42\n\n[Difficulty]\nCircleSize:4\n\n[TimingPoints]\n1000,500,4,2,0,50,1,0\n"
            + "17000,-100,4,2,0,50,0,1\n\n[HitObjects]\n");
        int[] xs = { 64, 192, 320, 448 };
        for (int i = 0; i < 64; i++) {
            int ms = 1000 + i * 500;
            if (i == 8 || i == 40) b.append(xs[i % 4]).append(",192,").append(ms).append(",128,0,").append(ms + 1000).append(":0:0:0:0:\n");
            else if (i != 9 && i != 41) b.append(xs[i % 4]).append(",192,").append(ms).append(",1,0,0:0:0:0:\n");
        }
        return b.toString();
    }

    @Test
    void osuFanSong() {
        Osu.OsuMap map = Osu.parse(maniaMap());
        assertEquals(3, map.mode);
        assertEquals(4, map.keys);
        List<Osu.FanNote> notes = Osu.fanNotes(map);
        assertEquals(62, notes.size());
        assertEquals(2, notes.stream().filter(n -> n.endMs() != null).count());

        ObjectNode song = Osu.fanSong(List.of(map), "Test", "Band", "dQw4w9WgXcQ", 40);
        assertEquals(120.0, song.path("bpm").asDouble());
        assertEquals(1.0, song.path("source").path("offset").asDouble());
        assertEquals("fan", song.path("source").path("chart").asString());
        JsonNode hard = song.path("charts").path("hard").path("notes");
        assertEquals(62, hard.size());
        assertEquals(0.0, hard.get(0).path("t").asDouble());
        assertEquals(2.0, hard.get(8).path("len").asDouble());
        int easy = song.path("charts").path("easy").path("notes").size();
        assertTrue(easy > 10 && easy < 62, "Easy keeps fewer tiles: " + easy);
        assertEquals(48, song.path("report").path("energy").size());
        assertEquals("Chorus", song.path("report").path("sections").get(1).path("label").asString());
        assertTrue(com.rhythmarchitect.backend.songs.NewSongCheck.problem(song) == null, "a fan song passes the new-song checks");
    }

    static JsonNode sample() throws Exception {
        return JSON.readTree(Files.readString(Path.of("../docs/samples/ink-and-fury.chart-request.json")));
    }

    @Test
    void promptListsEverySound() throws Exception {
        JsonNode req = sample();
        String text = SongMapper.songText(req);
        long lines = text.lines().filter(l -> l.matches("\\d+,.*")).count();
        assertEquals(req.path("events").size(), lines);
        assertTrue(text.contains("0,4,mid,C3,68,0.51,0.25,1,0"));
        assertEquals(SongMapper.chunkSchema().toString(), SongMapper.chunkSchema().toString(), "the schema is stable");
        assertTrue(SongMapper.planSchema().toString().contains("sameAs"));
    }

    @Test
    void readsTheSongPlan() throws Exception {
        JsonNode req = sample();
        ObjectNode answer = JSON.createObjectNode().put("lanes", "melody by pitch").put("summary", "An organ toccata.");
        ArrayNode s = answer.putArray("sections");
        s.addObject().put("label", "Intro").put("beat", 2).put("sameAs", -1).put("easy", "the bass").put("medium", "").put("hard", "");
        s.addObject().put("label", "Verse").put("beat", 32).put("sameAs", 5).put("easy", "").put("medium", "").put("hard", ""); // repeats a later one: no
        s.addObject().put("label", "Nonsense").put("beat", 64).put("sameAs", -1).put("easy", "").put("medium", "").put("hard", ""); // not a label: dropped
        s.addObject().put("label", "Verse").put("beat", 128).put("sameAs", 1).put("easy", "").put("medium", "").put("hard", "");
        answer.putArray("cues").addObject().put("beat", 32).put("kind", "drop").put("strength", 4);
        SongMapper.SongPlan plan = SongMapper.readSongPlan(req, answer);
        assertTrue(plan.fromClaude());
        assertEquals(3, plan.sections().size());
        assertEquals(0.0, plan.sections().get(0).beat(), "the first section starts the song");
        assertEquals(32.0, plan.sections().get(0).end());
        assertEquals(-1, plan.sections().get(1).sameAs());
        assertEquals(1, plan.sections().get(2).sameAs());
        assertEquals(1.0, plan.cues().get(0).path("strength").asDouble());
        String text = SongMapper.planText(plan);
        assertTrue(text.contains("[2] Verse, beats 128-") && text.contains("(repeats [1]"), text);

        SongMapper.SongPlan none = SongMapper.readSongPlan(req, JSON.createObjectNode());
        assertTrue(!none.fromClaude(), "no sections: the measured ones");
        assertEquals(req.path("sections").size(), none.sections().size());
    }

    /** A tiny song: 32 mid sounds one beat apart (0-31) and one high sound at beat 20.5. */
    static JsonNode tinySong(double bpm) {
        ObjectNode req = JSON.createObjectNode().put("version", 1);
        req.putObject("timing").put("bpm", bpm).put("meter", 4).put("lengthBeats", 32);
        req.putObject("rules").put("lanes", 4).put("maxNotesPerSound", 2).put("minHoldBeats", 1);
        ArrayNode ev = req.putArray("events");
        for (int i = 0; i < 32; i++) ev.addObject().put("id", i).put("t", i).put("band", "mid").put("strength", 0.7).put("len", 0.5).put("onBeat", true);
        ev.addObject().put("id", 99).put("t", 20.5).put("band", "high").put("strength", 0.3).put("len", 0.25);
        return req;
    }

    @Test
    void repeatsGetTheSameTiles() {
        JsonNode req = tinySong(120);
        var byId = SongMapper.events(req);
        List<SongMapper.Section> sections = List.of(
            new SongMapper.Section("Verse", 0, 16, -1, "", "", ""),
            new SongMapper.Section("Verse", 16, 32, 0, "", "", ""));
        List<SongMapper.Pick> picks = new ArrayList<>();
        for (int i = 0; i < 16; i++) picks.add(SongMapper.Pick.on(byId.get((long) i), i % 4, false)); // the first verse
        for (int i = 16; i < 32; i += 3) picks.add(SongMapper.Pick.on(byId.get((long) i), 3, false)); // the second, charted differently
        picks.add(SongMapper.Pick.on(byId.get(99L), 2, false)); // a sound only the second verse has
        int[] copied = { 0 };
        List<SongMapper.Pick> out = SongMapper.matchRepeats(byId, sections, picks, copied);
        assertTrue(copied[0] > 0);
        for (int i = 16; i < 32; i++) {
            final long id = i;
            List<SongMapper.Pick> on = out.stream().filter(p -> p.id() == id).toList();
            assertEquals(1, on.size(), "beat " + i + " has the first verse's tile");
            assertEquals((i - 16) % 4, on.get(0).lane());
        }
        assertTrue(out.stream().anyMatch(p -> p.id() == 99 && p.lane() == 2), "a sound without a match keeps its own tile");

        // A "repeat" whose sounds don't line up is left alone.
        List<SongMapper.Section> off = List.of(
            new SongMapper.Section("Verse", 0, 16, -1, "", "", ""),
            new SongMapper.Section("Verse", 20.5, 32, 0, "", "", ""));
        int[] none = { 0 };
        SongMapper.matchRepeats(byId, off, picks, none);
        assertEquals(0, none[0]);
    }

    @Test
    void easyIsSpacedWithoutChords() {
        JsonNode req = tinySong(120);
        var byId = SongMapper.events(req);
        List<SongMapper.Pick> picks = new ArrayList<>();
        for (int i = 0; i < 16; i++) picks.add(SongMapper.Pick.on(byId.get((long) i), i % 4, false));
        picks.add(SongMapper.Pick.on(byId.get(4L), 3, false)); // a chord on beat 4
        picks.add(SongMapper.Pick.on(byId.get(99L), 1, false)); // half a beat after beat 20... not here: 20.5 is outside
        int[] moved = { 0 };
        List<SongMapper.Pick> easy = SongMapper.playable(req, "easy", picks, moved);
        easy.sort(java.util.Comparator.comparingDouble(SongMapper.Pick::t));
        for (int i = 1; i < easy.size(); i++) {
            assertTrue(easy.get(i).t() - easy.get(i - 1).t() >= 1 - 1e-6, "Easy tiles at least a beat apart");
        }
        assertTrue(easy.size() >= 15, "a beat apart is fine at 120 BPM: " + easy.size());

        List<SongMapper.Pick> fast = SongMapper.playable(tinySong(170), "easy", picks, moved);
        fast.sort(java.util.Comparator.comparingDouble(SongMapper.Pick::t));
        for (int i = 1; i < fast.size(); i++) {
            assertTrue(fast.get(i).t() - fast.get(i - 1).t() >= 2 - 1e-6, "two beats apart above 150 BPM");
        }
    }

    @Test
    void hardBreaksUpLongRunsOnOneLane() {
        ObjectNode req = (ObjectNode) tinySong(120);
        ArrayNode ev = (ArrayNode) req.path("events");
        for (int i = 0; i < 8; i++) ev.addObject().put("id", 200 + i).put("t", 40 + i * 0.25).put("band", "low").put("strength", 0.8).put("len", 0.25);
        var byId = SongMapper.events(req);
        List<SongMapper.Pick> picks = new ArrayList<>();
        for (int i = 0; i < 8; i++) picks.add(SongMapper.Pick.on(byId.get(200L + i), 0, false)); // eight quick taps on lane 0
        int[] moved = { 0 };
        List<SongMapper.Pick> hard = SongMapper.playable(req, "hard", picks, moved);
        assertEquals(8, hard.size(), "Hard keeps every tile");
        assertTrue(moved[0] > 0);
        hard.sort(java.util.Comparator.comparingDouble(SongMapper.Pick::t));
        int run = 1;
        for (int i = 1; i < hard.size(); i++) {
            run = hard.get(i).lane() == hard.get(i - 1).lane() ? run + 1 : 1;
            assertTrue(run <= 3, "no more than three quick taps in a row on one lane");
        }
    }

    @Test
    void chunksStartWhereSectionsStart() throws Exception {
        JsonNode req = sample(); // 176 BPM: about 116 beats per Hard chunk
        List<SongMapper.Section> sections = List.of(
            new SongMapper.Section("Intro", 0, 64, -1, "", "", ""),
            new SongMapper.Section("Verse", 64, 128, -1, "", "", ""),
            new SongMapper.Section("Chorus", 128, 200, -1, "", "", ""),
            new SongMapper.Section("Outro", 200, 304, -1, "", "", ""));
        List<SongMapper.Chunk> chunks = SongMapper.chunks(req, sections);
        for (SongMapper.Chunk c : chunks) {
            assertTrue(c.from() == 0 || sections.stream().anyMatch(s -> s.beat() == c.from()) || c.from() % 4 == 0, "cut at " + c.from());
        }
        assertEquals(List.of(0.0, 128.0), chunks.stream().filter(c -> c.difficulty().equals("hard")).map(SongMapper.Chunk::from).toList());
        for (String d : SongMapper.DIFFICULTIES) {
            for (JsonNode e : req.path("events")) {
                double t = e.path("t").asDouble();
                assertEquals(1, chunks.stream().filter(c -> c.difficulty().equals(d) && c.from() <= t && (c.last() || t < c.to())).count());
            }
        }
    }

    @Test
    void planRepair() throws Exception {
        JsonNode req = sample();
        ArrayNode notes = JSON.createArrayNode();
        for (int i = 0; i < 20; i++) notes.addObject().put("id", i).put("lane", i % 4);
        notes.addObject().put("id", 99999).put("lane", 1); // unknown sound
        notes.addObject().put("id", 1).put("lane", 7); // bad lane
        notes.addObject().put("id", 1).put("lane", 2); // a chord: fine
        notes.addObject().put("id", 1).put("lane", 3); // a third note on one sound
        notes.addObject().put("id", 2).put("lane", 0).put("hold", true); // rings 0.25 beats: a tap
        SongMapper.Checked c = SongMapper.check(req, "hard", notes);
        assertEquals(22, c.notes().size());
        assertEquals(4, c.fixes());
        assertTrue(c.notes().valueStream().noneMatch(n -> n.has("hold")));

        ArrayNode thin = JSON.createArrayNode();
        thin.addObject().put("id", 0).put("lane", 0);
        assertThrows(SongMapper.MapperException.class, () -> SongMapper.check(req, "easy", thin));
    }

    @Test
    void queueIsFirstInFirstOut() {
        Queue<String> q = new Queue<>();
        assertTrue(q.isEmpty());
        q.enqueue("a");
        q.enqueue("b");
        q.enqueue("c");
        assertEquals(3, q.getSize());
        assertEquals("a", q.dequeue());
        assertEquals("b", q.peek());
        assertEquals("b", q.dequeue());
        assertEquals("c", q.dequeue());
        assertThrows(main.EmptyQueueException.class, q::dequeue);
        q.enqueue("d");
        assertEquals("d", q.peek());
    }

    @Test
    void chunksCoverEachDifficultyOnce() throws Exception {
        JsonNode req = sample(); // 176 BPM, 105 s
        List<SongMapper.Chunk> chunks = SongMapper.chunks(req);
        assertEquals("hard", chunks.get(0).difficulty(), "Hard goes first: it primes the cache");
        assertEquals(3, chunks.stream().filter(c -> c.difficulty().equals("hard")).count());
        assertEquals(1, chunks.stream().filter(c -> c.difficulty().equals("easy")).count());
        for (String d : SongMapper.DIFFICULTIES) {
            for (JsonNode e : req.path("events")) {
                double t = e.path("t").asDouble();
                assertEquals(1, chunks.stream().filter(c -> c.difficulty().equals(d) && c.from() <= t && (c.last() || t < c.to())).count(),
                    d + " sound at beat " + t + " is in exactly one chunk");
            }
        }
        for (SongMapper.Chunk c : chunks) assertEquals(0, c.from() % 4, "chunks start on bar lines");
    }

    @Test
    void parsesTheNoteLine() {
        ArrayNode n = SongMapper.parseNotes("12:1 15:2h 15:3, junk 7: x");
        assertEquals(3, n.size());
        assertEquals(12, n.get(0).path("id").asInt());
        assertEquals(1, n.get(0).path("lane").asInt());
        assertTrue(n.get(1).path("hold").asBoolean());
        assertTrue(!n.get(2).has("hold"));
        assertEquals(0, SongMapper.parseNotes("").size());
    }

    /** Answers for every chunk as Claude would give them, merged into a plan, then turned into a Song. */
    @Test
    void planMergesAndBecomesASong() throws Exception {
        JsonNode req = sample(); // 176 BPM
        ObjectNode planAnswer = JSON.createObjectNode().put("lanes", "melody by pitch").put("summary", "An organ toccata.");
        ArrayNode s = planAnswer.putArray("sections");
        s.addObject().put("label", "Intro").put("beat", 0).put("sameAs", -1).put("easy", "").put("medium", "").put("hard", "");
        s.addObject().put("label", "Verse").put("beat", 32).put("sameAs", -1).put("easy", "").put("medium", "").put("hard", "");
        s.addObject().put("label", "Chorus").put("beat", 256).put("sameAs", -1).put("easy", "").put("medium", "").put("hard", "");
        planAnswer.putArray("cues").addObject().put("beat", 16).put("kind", "drop").put("strength", 1);
        SongMapper.SongPlan songPlan = SongMapper.readSongPlan(req, planAnswer);
        List<SongMapper.ChunkAnswer> answers = new ArrayList<>();
        for (SongMapper.Chunk c : SongMapper.chunks(req, songPlan.sections())) {
            int step = c.difficulty().equals("easy") ? 8 : c.difficulty().equals("medium") ? 4 : 1;
            StringBuilder line = new StringBuilder();
            for (JsonNode e : req.path("events")) {
                double t = e.path("t").asDouble();
                long id = e.path("id").asLong();
                if (id % step == 0 && t >= c.from() && (c.last() || t < c.to())) line.append(id).append(':').append(id % 4).append(' ');
            }
            if (c.from() > 0) line.append("0:1 "); // a sound from another chunk: dropped
            answers.add(new SongMapper.ChunkAnswer(c, JSON.createObjectNode().put("follows", "Follows the organ line.").put("notes", line.toString())));
        }
        try (SongMapper mapper = new SongMapper("", "claude-opus-5-5", "high", 64000, 170)) {
            assertTrue(!mapper.isEnabled());
            ObjectNode plan = mapper.merge(req, songPlan, answers);
            var byId = SongMapper.events(req);
            for (String d : SongMapper.DIFFICULTIES) {
                List<Double> times = new ArrayList<>();
                for (JsonNode n : plan.path("charts").path(d)) times.add(byId.get(n.path("id").asLong()).path("t").asDouble());
                times.sort(null);
                assertTrue(times.size() > 20, d + " has tiles: " + times.size());
                double gap = SongMapper.minGap(d, 176);
                for (int i = 1; i < times.size(); i++) {
                    double dt = times.get(i) - times.get(i - 1);
                    assertTrue(dt < 0.031 || dt >= gap - 1e-6, d + " tiles are " + gap + " beats apart or a chord");
                }
            }
            assertEquals(3, plan.path("sections").size());
            assertEquals("Verse", plan.path("sections").get(1).path("label").asString());
            assertEquals(1, plan.path("cues").size());
            String summary = plan.path("summary").asString();
            assertTrue(summary.startsWith("Easy: Follows the organ line."), summary);
            assertTrue(summary.contains("notes repaired") && summary.contains("adjusted for playability"), summary);

            Song song = SongMapper.toSong(req, plan);
            assertEquals("Ink and Fury", song.getTitle());
            assertEquals(List.of(Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD), song.getAvailableDifficulties());
            Queue<Note> hard = song.getChart(Difficulty.HARD);
            assertEquals(plan.path("charts").path("hard").size(), hard.getSize());
            Note first = hard.dequeue();
            assertEquals(4.0, first.getTimeStamp());
            assertEquals(main.NoteType.C, first.getNoteType());
            assertEquals(main.MusicNoteType.START, first.getMusicNoteType());
            double last = first.getTimeStamp();
            while (!hard.isEmpty()) {
                Note n = hard.dequeue();
                assertTrue(n.getTimeStamp() >= last, "in time order");
                last = n.getTimeStamp();
            }
        }
    }

    /** A failed parallel call arrives wrapped; the real reason must come through, not a generic 500. */
    @Test
    void failuresKeepTheirReason() {
        SongMapper.MapperException busy = new SongMapper.MapperException(503, "The AI charter is busy. Try again in a minute.");
        Throwable wrapped = new java.util.concurrent.ExecutionException(new java.util.concurrent.CompletionException(busy));
        assertEquals(busy, SongMapper.asMapperException(wrapped));
        SongMapper.MapperException other = SongMapper.asMapperException(new java.util.concurrent.CompletionException(new IllegalStateException("x")));
        assertEquals(502, other.getStatus());
        assertTrue(other.getMessage().contains("IllegalStateException"));
    }

    @Test
    void mapperOffAnswers501() {
        try (SongMapper mapper = new SongMapper(null, "claude-opus-5-5", "high", 64000, 170)) {
            SongMapper.MapperException e = assertThrows(SongMapper.MapperException.class, () -> mapper.plan(JSON.createObjectNode()));
            assertEquals(501, e.getStatus());
        }
    }
}
