package main;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * Main: the spec's test plan for controller construction, input judging,
 * missed-note handling, upcoming notes, and invalid input.
 */
class MainTest
{
    private Song song()
    {
        Song song = new Song("Test Song", "Test Artist", 10, 120);
        Queue<Note> chart = new Queue<>();
        chart.enqueue(new Note(NoteType.C, null, 0.5, 1.0, 0));
        chart.enqueue(new Note(NoteType.D, null, 0.5, 2.0, 1));
        chart.enqueue(new Note(NoteType.E, null, 0.5, 3.0, 2));
        song.setChart(Difficulty.EASY, chart);
        return song;
    }

    @Test
    void constructorRejectsANullSong()
    {
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> new Main(null, Difficulty.EASY));
        assertEquals("Song cannot be null.", error.getMessage());
    }

    @Test
    void constructorRejectsAMissingChart()
    {
        Song song = new Song("Test Song", "Test Artist", 10, 120);
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> new Main(song, Difficulty.EASY));
        assertEquals("No chart available for this difficulty.",
            error.getMessage());
    }

    @Test
    void nullDifficultyUsesTheEasyChart()
    {
        Song song = song();
        Main main = new Main(song, null);
        assertSame(SongWriter.DEFAULT_DIFFICULTY, Difficulty.EASY);
        assertSame(song, main.getSong());
        assertEquals(0, main.getCurrentTime());
    }

    @Test
    void constructorKeepsTheSongAndStartsWithAZeroScoreAndTime()
    {
        Song song = song();
        Main main = new Main(song, Difficulty.EASY);
        assertSame(song, main.getSong());
        assertEquals(0, main.getScore().getScore());
        assertEquals(0, main.getScore().getHits());
        assertEquals(0, main.getCurrentTime());
    }

    @Test
    void perfectHitIsWithinThePerfectWindow()
    {
        Main main = new Main(song(), Difficulty.EASY);
        assertEquals(HitResult.PERFECT, main.processInput(0, 1.05));
        assertEquals(100, main.getScore().getScore());
        assertEquals(1, main.getScore().getHits());
        assertEquals(1.05, main.getCurrentTime());
    }

    @Test
    void goodHitIsInsideTheGoodWindow()
    {
        Main main = new Main(song(), Difficulty.EASY);
        assertEquals(HitResult.GOOD, main.processInput(0, 1.15));
        assertEquals(75, main.getScore().getScore());
        assertEquals(1, main.getScore().getHits());
    }

    @Test
    void earlyAndLateHitsAreInsideTheEarlyLateWindow()
    {
        Main early = new Main(song(), Difficulty.EASY);
        assertEquals(HitResult.EARLY, early.processInput(0, 0.75));
        assertEquals(50, early.getScore().getScore());

        Main late = new Main(song(), Difficulty.EASY);
        assertEquals(HitResult.LATE, late.processInput(0, 1.25));
        assertEquals(50, late.getScore().getScore());
    }

    @Test
    void wrongLaneAndAnOutsideWindowAreMisses()
    {
        Main wrongLane = new Main(song(), Difficulty.EASY);
        assertEquals(HitResult.MISS, wrongLane.processInput(1, 1.0));
        assertEquals(1, wrongLane.getScore().getMisses());
        assertEquals(0, wrongLane.getScore().getCombo());

        Main outsideWindow = new Main(song(), Difficulty.EASY);
        assertEquals(HitResult.MISS, outsideWindow.processInput(0, 1.31));
        assertEquals(2, outsideWindow.getScore().getMisses());
    }

    @Test
    void invalidInputIsRejectedWithoutChangingTheRun()
    {
        Main main = new Main(song(), Difficulty.EASY);
        assertNull(main.processInput(-1, 1.0));
        assertNull(main.processInput(4, 1.0));
        assertNull(main.processInput(0, -1.0));
        assertNull(main.processInput(0, Double.NaN));
        assertNull(main.processInput(0, Double.POSITIVE_INFINITY));
        assertEquals(0, main.getScore().getHits());
        assertEquals(0, main.getScore().getMisses());
        assertEquals(0, main.getCurrentTime());
    }

    @Test
    void missedNotesAreRemovedPastTheEarlyLateWindow()
    {
        Main beforeEnd = new Main(song(), Difficulty.EASY);
        beforeEnd.checkMissedNotes(1.30);
        assertEquals(0, beforeEnd.getScore().getMisses());

        Main main = new Main(song(), Difficulty.EASY);
        main.checkMissedNotes(1.31);
        assertEquals(1, main.getScore().getMisses());
        assertEquals(1.31, main.getCurrentTime());
        assertEquals(HitResult.MISS, main.processInput(1, 1.31));
    }

    @Test
    void missedNoteChecksIgnoreInvalidTime()
    {
        Main main = new Main(song(), Difficulty.EASY);
        main.checkMissedNotes(-1);
        main.checkMissedNotes(Double.NaN);
        main.checkMissedNotes(Double.POSITIVE_INFINITY);
        assertEquals(0, main.getScore().getMisses());
        assertEquals(0, main.getCurrentTime());
    }

    @Test
    void upcomingNotesDoNotRemoveThemFromTheChart()
    {
        Main main = new Main(song(), Difficulty.EASY);
        List<Note> upcoming = main.getUpcomingNotes(2);

        assertEquals(2, upcoming.size());
        assertEquals(1.0, upcoming.get(0).getTimeStamp());
        assertEquals(0, upcoming.get(0).getLane());
        assertEquals(2.0, upcoming.get(1).getTimeStamp());
        assertEquals(1, upcoming.get(1).getLane());
        assertEquals(HitResult.PERFECT, main.processInput(0, 1.0));
        assertEquals(HitResult.PERFECT, main.processInput(1, 2.0));
    }

    @Test
    void upcomingNotesRejectsNonPositiveCountsAndLimitsLargeCounts()
    {
        Main main = new Main(song(), Difficulty.EASY);
        assertTrue(main.getUpcomingNotes(0).isEmpty());
        assertTrue(main.getUpcomingNotes(-3).isEmpty());

        List<Note> all = main.getUpcomingNotes(100);
        assertEquals(3, all.size());
        assertEquals(HitResult.PERFECT, main.processInput(0, 1.0));
    }
}
