package com.rhythmarchitect.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.rhythmarchitect.backend.match.Matching;
import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.osu.Osu;
import com.rhythmarchitect.backend.songs.RunReplay;
import com.rhythmarchitect.backend.songs.SongModel;

import main.Difficulty;
import main.MusicNoteType;
import main.Note;
import main.NoteType;
import main.Queue;
import main.Song;
import main.SongWriter;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The pure parts: text matching, the osu! port, and songs as the game's model has them (SongModel,
 * RunReplay). (The model's own tests are in src/test.)
 */
class MappingTests {

    @Test
    void textMatching() {
        assertEquals("beyonce halo", Text.norm("Beyoncé — Halo!"));
        assertEquals("song", Text.bare("Song (feat. Someone) [Official Audio]"));
        assertEquals(4, Text.match("Halo", "halo"));
        assertEquals(3, Text.match("Halo Theme", "hal"));
        // Near misses find the song (the cases in frontend tests/unit/search.test.ts).
        assertEquals(1, Text.searchMatch("One Dance", "once dance"));
        assertEquals(1, Text.searchMatch("One Dance", "onedance"));
        assertEquals(1, Text.searchMatch("Open Your Eyes", "opne your eys"));
        assertEquals(1, Text.searchMatch("Hotline Bling", "hotlien bl"));
        assertEquals(1, Text.searchMatch("Blinding Lights", "blindng"));
        assertEquals(0, Text.searchMatch("One Dance", "zq"));
        assertEquals(0, Text.searchMatch("One Dance", "two dance"));
        assertEquals(0, Text.searchMatch("Halo", "hello"));
        assertEquals(4, Text.searchMatch("Halo", "halo"));
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
        // The cases in frontend tests/unit/youtube.test.ts: "Title - Artist" too.
        assertEquals(new Matching.SongName("Blinding Lights", "The Weeknd"), Matching.songFromVideo("Blinding Lights - The Weeknd (Lyrics)", "7clouds", "Blinding Lights"));
        assertEquals(new Matching.SongName("Blinding Lights", "The Weeknd"), Matching.songFromVideo("The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO", ""));
        assertEquals(new Matching.SongName("Levitating", "Dua Lipa"), Matching.songFromVideo("Levitating - Dua Lipa (Lyrics)", "Pop Mage", "levitating"));
        assertEquals(new Matching.SongName("Mr. Brightside", "The Killers"), Matching.songFromVideo("Mr. Brightside - The Killers", "Rock Classics", "Mr Brightside"));
        assertEquals(new Matching.SongName("About Damn Time", "Lizzo"), Matching.songFromVideo("About Damn Time (Lyrics) - Lizzo", "The Vibe Guide", "About Damn Time"));
        assertEquals(new Matching.SongName("About Damn Time", "Lizzo"), Matching.songFromVideo("Lizzo - About Damn Time (Lyrics)", "The Vibe Guide", ""));
        assertEquals(new Matching.SongName("Lucid Dreams", "Juice WRLD"), Matching.songFromVideo("Juice WRLD \"Lucid Dreams\" (Official Music Video)", "Juice WRLD", ""));
        assertEquals(new Matching.SongName("Kill Bill", "SZA"), Matching.songFromVideo("Kill Bill", "SZA", ""));
    }

    /** The video's own wording when it's the song typed (capitals, features), else what was typed. The cases in youtube.test.ts. */
    @Test
    void songNames() {
        assertEquals(new Matching.SongName("Blinding Lights", "The Weeknd"), Matching.songName("The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO", "blinding lights", "the weeknd"));
        assertEquals(new Matching.SongName("One Dance (feat. WizKid & Kyla)", "Drake"), Matching.songName("One Dance (feat. WizKid & Kyla) - Drake (Official Audio)", "Drake Media", "one dance", "drake"));
        assertEquals(new Matching.SongName("One Dance (feat. WizKid & Kyla)", "Drake"), Matching.songName("Drake ft. WizKid & Kyla - One Dance", "Drake", "one dance", ""));
        assertEquals(new Matching.SongName("Sunflower (feat. Swae Lee)", "Post Malone"), Matching.songName("Post Malone - Sunflower ft. Swae Lee", "PostMaloneVEVO", "sunflower", "post malone"));
        assertEquals(new Matching.SongName("Levitating", "Dua Lipa"), Matching.songName("Levitating - Dua Lipa (Lyrics)", "Pop Mage", "levitating", "dua lipa"));
        assertEquals(new Matching.SongName("Mr. Brightside", "The Killers"), Matching.songName("Some Unrelated Upload", "Random Channel", "mr. brightside", "the killers"));
        assertEquals(new Matching.SongName("HUMBLE.", "Kendrick Lamar"), Matching.songName("HUMBLE.", "Kendrick Lamar - Topic", "humble", "kendrick lamar"));
        assertEquals(new Matching.SongName("Kill Bill", "SZA"), Matching.songName("Kill Bill", "SZA", "Kill Bill", ""));
        assertEquals(new Matching.SongName("Kill Bill", "SZA"), Matching.songName("Kill Bill", "SZA", "kill bill", "SZA"));
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
        JsonNode ultra = song.path("charts").path("ultra").path("notes");
        assertEquals(62, ultra.size());
        assertEquals(0.0, ultra.get(0).path("t").asDouble());
        assertEquals(2.0, ultra.get(8).path("len").asDouble());
        // Each difficulty keeps at least as many as the one before; Easy fewer than Ultra.
        int prev = 0;
        for (String d : new String[] { "easy", "medium", "hard", "ultra" }) {
            int n = song.path("charts").path(d).path("notes").size();
            assertTrue(n >= prev && n > 10, d + " keeps " + n + " tiles (the one before: " + prev + ")");
            prev = n;
        }
        int easy = song.path("charts").path("easy").path("notes").size();
        assertTrue(easy < 62, "Easy keeps fewer tiles: " + easy);
        assertEquals(48, song.path("report").path("energy").size());
        assertEquals("Chorus", song.path("report").path("sections").get(1).path("label").asString());
        assertTrue(com.rhythmarchitect.backend.songs.NewSongCheck.problem(song) == null, "a fan song passes the new-song checks");
    }

    @Test
    void theBuiltInSongsAreModelSongs() throws Exception {
        JsonNode seed = JsonMapper.builder().build().readTree(Files.readString(Path.of("src", "main", "resources", "seed", "songs.json")));
        SongWriter writer = new SongWriter();
        assertTrue(seed.path("songs").size() >= 4);
        for (JsonNode s : seed.path("songs")) {
            Song song = SongModel.of(s);
            assertEquals(s.path("title").asString(), song.getTitle());
            assertEquals(s.path("lengthBeats").asDouble() * 60 / s.path("bpm").asDouble(), song.getDuration(), 1e-9);
            // The chart files the model's own tests read (frontend/tools/export-charts.mjs) hold the same songs.
            String file = s.path("id").asString().replaceFirst("^(builtin|demo)-", "") + ".chart";
            Song exported = writer.readSong(Path.of("..", "src", "java", "charts", file));
            for (Difficulty d : Difficulty.values()) {
                JsonNode notes = s.path("charts").path(SongModel.name(d)).path("notes");
                Queue<Note> chart = song.getChart(d);
                assertNotNull(chart, s.path("id").asString() + " " + d);
                int holds = 0;
                for (JsonNode n : notes) if (n.path("hold").asBoolean(false)) holds++;
                int modelHolds = 0;
                double last = -1;
                for (int i = 0, size = chart.getSize(); i < size; i++) {
                    Note n = chart.dequeue();
                    if (n.isHold()) modelHolds++;
                    assertTrue(n.getTimeStamp() >= last, "in play order");
                    last = n.getTimeStamp();
                    chart.enqueue(n);
                }
                assertEquals(notes.size(), size(song, d), s.path("id").asString() + " " + d);
                assertEquals(holds, modelHolds, s.path("id").asString() + " " + d + " holds");
                assertEquals(notes.size(), size(exported, d), file + " " + d);
            }
        }
    }

    private static int size(Song song, Difficulty d) {
        Queue<Note> chart = song.getChart(d);
        return chart == null ? 0 : chart.getSize();
    }

    @Test
    void aRunIsCheckedAgainstItsChart() {
        // Two tiles: a tap, then a hold of one second.
        Queue<Note> chart = new Queue<>();
        chart.enqueue(new Note(NoteType.C, MusicNoteType.START, 0.25, 0, 0));
        chart.enqueue(new Note(NoteType.E, MusicNoteType.END, 1.0, 1, 2, true));
        assertNotNull(RunReplay.of("PPH1000;", chart));
        assertNotNull(RunReplay.of("PPH1002;", chart), "rounding");
        assertNotNull(RunReplay.of("PPB", chart));
        assertNotNull(RunReplay.of("PM", chart));
        assertNotNull(RunReplay.of("", chart), "a run that failed at once");
        assertNull(RunReplay.of("PPP", chart), "three tiles judged");
        assertNull(RunReplay.of("PPH1003;", chart), "held longer than the hold");
        assertNull(RunReplay.of("PPH500;B", chart), "two holds ended");
        assertNull(RunReplay.of("P", new Queue<>()), "no chart for the difficulty");
        assertEquals(2, chart.getSize(), "the chart is left as it was");
        assertEquals(MusicNoteType.START, chart.peek().getMusicNoteType());
        assertNotNull(RunReplay.of("PPPPPPPPPPPPPPPP", null), "no chart: counted unchecked");
    }

    /** Only songs: the cases in frontend tests/unit/youtube.test.ts. */
    @Test
    void onlySongsAreTaken() {
        assertNull(Matching.notSongReason("One Dance (feat. WizKid & Kyla) - Drake (Official Audio)", "Drake Media", 174, "10", ""));
        assertNull(Matching.notSongReason("One Dance", "Drake - Topic", 174, "10", ""));
        assertNull(Matching.notSongReason("Good News", "Mac Miller - Topic", 342, "10", ""));
        assertNull(Matching.notSongReason("Jack Johnson - Breakdown", "jackjohnsonmusic", null, null, ""));
        assertNull(Matching.notSongReason("Kendrick Lamar - HUMBLE.", "KendrickLamarVEVO", 177, "24", ""));
        assertTrue(Matching.notSongReason("Drake - One Dance REACTION", "Some Reactor", 600, "24", "").contains("reaction"));
        assertNotNull(Matching.notSongReason("How to play One Dance on piano (tutorial)", "Piano Guy", null, null, ""));
        assertTrue(Matching.notSongReason("Drake - Views (Full Album)", "Albums", 4900, "10", "").contains("full album"));
        assertTrue(Matching.notSongReason("One Dance 10 hours", "Loops", 36000, "10", "").contains("long loop"));
        assertTrue(Matching.notSongReason("Minecraft gameplay part 3", "Gamer", 1200, "20", "").contains("gameplay"));
        assertEquals("YouTube doesn't list it as music", Matching.notSongReason("My morning routine", "Vlogger", 480, "22", ""));
        assertTrue(Matching.notSongReason("Movie trailer 2026", "Studio", null, null, "").contains("trailer"));
        assertTrue(Matching.notSongReason("Ringtone", "Tones", 20, "10", "").contains("20 seconds"));
        assertTrue(Matching.notSongReason("Ambient set", "DJ", 3600, "10", "").contains("60 minutes"));
        assertNull(Matching.notSongReason("Tutorial (Official Audio)", "Some Band - Topic", 200, "10", "Tutorial Some Band"));
    }
}
