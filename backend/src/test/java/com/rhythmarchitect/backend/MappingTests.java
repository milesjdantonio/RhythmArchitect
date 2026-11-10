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
        assertEquals(SongMapper.schema().toString(), SongMapper.schema().toString(), "the schema is stable");
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

    /** Three answers as Claude would give them, merged into a plan, then turned into a Song. */
    @Test
    void planMergesAndBecomesASong() throws Exception {
        JsonNode req = sample();
        java.util.Map<String, JsonNode> answers = new java.util.LinkedHashMap<>();
        for (String d : SongMapper.DIFFICULTIES) {
            ObjectNode a = JSON.createObjectNode().put("follows", "the organ line");
            ArrayNode notes = a.putArray("notes");
            int step = d.equals("easy") ? 8 : d.equals("medium") ? 4 : 1;
            for (int i = 0; i < 200; i += step) notes.addObject().put("id", i).put("lane", i % 4).put("hold", false);
            a.putArray("sections").addObject().put("label", d.equals("hard") ? "Intro" : "Nonsense").put("beat", 0);
            a.putArray("cues").addObject().put("beat", 16).put("kind", "drop").put("strength", 3);
            answers.put(d, a);
        }
        try (SongMapper mapper = new SongMapper("", "claude-opus-5-5", "high", 64000, 170)) {
            assertTrue(!mapper.isEnabled());
            ObjectNode plan = mapper.merge(req, answers);
            assertEquals(25, plan.path("charts").path("easy").size());
            assertEquals(200, plan.path("charts").path("hard").size());
            assertEquals("Intro", plan.path("sections").get(0).path("label").asString());
            assertEquals(1.0, plan.path("cues").get(0).path("strength").asDouble());
            assertTrue(plan.path("summary").asString().startsWith("Easy: the organ line"));

            Song song = SongMapper.toSong(req, plan);
            assertEquals("Ink and Fury", song.getTitle());
            assertEquals(List.of(Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD), song.getAvailableDifficulties());
            Queue<Note> hard = song.getChart(Difficulty.HARD);
            assertEquals(200, hard.getSize());
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

    @Test
    void mapperOffAnswers501() {
        try (SongMapper mapper = new SongMapper(null, "claude-opus-5-5", "high", 64000, 170)) {
            SongMapper.MapperException e = assertThrows(SongMapper.MapperException.class, () -> mapper.plan(JSON.createObjectNode()));
            assertEquals(501, e.getStatus());
        }
    }
}
