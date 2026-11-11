package com.rhythmarchitect.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.rhythmarchitect.backend.match.Matching;
import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.osu.Osu;

import main.Difficulty;
import main.Song;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** The pure parts: text matching and the osu! port. (The model's own tests are in src/java/test.) */
class MappingTests {

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
}
