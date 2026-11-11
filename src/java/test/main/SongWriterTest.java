package main;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * SongWriter: a chart becomes a Song with one note queue per difficulty, in play order; bad charts
 * are turned down (the spec's bad-input cases: empty title, bad data, no difficulty chosen).
 */
class SongWriterTest
{
    private final SongWriter writer = new SongWriter();

    private static final String CHART = String.join("\n",
        "# a test chart",
        "title: Test Song",
        "artist: Test Artist",
        "bpm: 120",
        "easy: 0:1 2:2:1",
        "hard: 1:3 0:0:0:C 0:3:0:E 1.5:2:2:G");

    @Test
    void writesASongWithAQueuePerDifficulty()
    {
        Song song = writer.writeSong(CHART);
        assertEquals("Test Song", song.getTitle());
        assertEquals("Test Artist", song.getArtist());
        assertEquals(120, song.getBpm());
        assertEquals(List.of(Difficulty.EASY, Difficulty.HARD), song.getAvailableDifficulties());
        assertEquals(2, song.getChart(Difficulty.EASY).getSize());
        assertEquals(4, song.getChart(Difficulty.HARD).getSize());
        assertNull(song.getChart(Difficulty.MEDIUM));
    }

    @Test
    void notesComeOutInTimeOrderWithTimesAndLengthsInSeconds()
    {
        Queue<Note> hard = writer.writeSong(CHART).getChart(Difficulty.HARD);
        // 120 BPM: half a second a beat. Written out of order; played in order (by time, then lane).
        Note first = hard.dequeue();
        assertEquals(0, first.getTimeStamp());
        assertEquals(0, first.getLane());
        assertEquals(NoteType.C, first.getNoteType());
        assertEquals(MusicNoteType.START, first.getMusicNoteType());
        assertEquals(0.125, first.getNoteLength()); // a tap: a sixteenth
        Note second = hard.dequeue();
        assertEquals(3, second.getLane());
        assertEquals(MusicNoteType.ACCENT, second.getMusicNoteType()); // the other half of a chord
        assertEquals(0.5, hard.dequeue().getTimeStamp());
        Note last = hard.dequeue();
        assertEquals(0.75, last.getTimeStamp());
        assertEquals(1.0, last.getNoteLength()); // held 2 beats
        assertEquals(NoteType.G, last.getNoteType());
        assertEquals(MusicNoteType.END, last.getMusicNoteType());
        assertTrue(hard.isEmpty());
    }

    @Test
    void theDurationIsGivenOrRunsToTheLastNote()
    {
        // No duration line: up to the end of the last note (Hard's hold from beat 1.5 for 2 beats
        // ends at beat 3.5: 1.75 s at 120 BPM).
        assertEquals(1.75, writer.writeSong(CHART).getDuration());
        assertEquals(90.0, writer.writeSong(CHART + "\nduration: 90").getDuration());
    }

    @Test
    void noDifficultyChosenPlaysEasy()
    {
        Song song = writer.writeSong(CHART);
        assertSame(song.getChart(Difficulty.EASY), SongWriter.chartFor(song, null));
        assertSame(song.getChart(Difficulty.HARD), SongWriter.chartFor(song, Difficulty.HARD));
        assertNull(SongWriter.chartFor(song, Difficulty.MEDIUM));
        assertThrows(IllegalArgumentException.class, () -> SongWriter.chartFor(null, Difficulty.EASY));
    }

    @Test
    void turnsDownAnEmptyOrBlankTitleOrArtist()
    {
        assertThrows(IllegalArgumentException.class, () -> writer.writeSong(null));
        assertThrows(IllegalArgumentException.class, () -> writer.writeSong("  \n "));
        assertThrows(IllegalArgumentException.class, () -> writer.writeSong(CHART.replace("title: Test Song", "title:   ")));
        assertThrows(IllegalArgumentException.class, () -> writer.writeSong(CHART.replace("artist: Test Artist\n", "")));
    }

    @Test
    void turnsDownBadData()
    {
        String[] bad = {
            CHART.replace("bpm: 120", "bpm: fast"),
            CHART.replace("bpm: 120", "bpm: 0"),
            CHART.replace("easy: 0:1", "easy: 0:4"),     // lane 4: there are four lanes, 0-3
            CHART.replace("easy: 0:1", "easy: 0:-1"),
            CHART.replace("easy: 0:1", "easy: -2:1"),     // before beat 0
            CHART.replace("easy: 0:1", "easy: x:1"),
            CHART.replace("easy: 0:1", "easy: 0"),
            CHART.replace("easy: 0:1", "easy: 0:1:-1"),   // a negative hold
            CHART.replace("easy: 0:1", "easy: 0:1:0:H"),  // no note H
            CHART + "\nsurprise: yes",
            CHART + "\njust words",
            "title: T\nartist: A\nbpm: 120\neasy:\nhard: ",   // no notes at all
        };
        for(String chart: bad)
        {
            IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> writer.writeSong(chart), chart);
            assertTrue(e.getMessage() != null && !e.getMessage().isBlank());
        }
    }

    @Test
    void readsTheBuiltInChartFiles() throws Exception
    {
        // The real charts of the songs the game ships with (src/java/charts).
        // Run from backend/ (Maven) or the repo root.
        Path fromBackend = Path.of("..", "src", "java", "charts");
        Path dir = Files.isDirectory(fromBackend) ? fromBackend : Path.of("src", "java", "charts");
        Song oneDance = writer.readSong(dir.resolve("one-dance.chart"));
        assertEquals("Drake", oneDance.getArtist());
        assertEquals(List.of(Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD), oneDance.getAvailableDifficulties());
        Queue<Note> easy = oneDance.getChart(Difficulty.EASY);
        assertTrue(easy.getSize() > 100);
        double last = -1;
        while(!easy.isEmpty())
        {
            Note n = easy.dequeue();
            assertTrue(n.getTimeStamp() >= last, "in time order");
            assertTrue(n.getLane() >= 0 && n.getLane() < 4);
            last = n.getTimeStamp();
        }
        assertTrue(last <= oneDance.getDuration());
        assertThrows(java.io.IOException.class, () -> writer.readSong(dir.resolve("no-such-song.chart")));
    }
}
