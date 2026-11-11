package main;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * Song: the spec's test plan (constructor, getChart, setChart, the getters,
 * getAvailableDifficulties; good and bad cases).
 */
class SongTest
{
    private static Song song()
    {
        return new Song("Ink and Fury", "SchmollCrossword OST", 104.7, 176);
    }

    private static Queue<Note> chart(int notes)
    {
        Queue<Note> q = new Queue<>();
        for(int i = 0; i < notes; i++)
        {
            q.enqueue(new Note(NoteType.C, MusicNoteType.NORMAL, 0.25, i * 0.5, i % 4));
        }
        return q;
    }

    @Test
    void keepsItsInformation()
    {
        Song s = song();
        assertEquals("Ink and Fury", s.getTitle());
        assertEquals("SchmollCrossword OST", s.getArtist());
        assertEquals(104.7, s.getDuration());
        assertEquals(176, s.getBpm());
    }

    @Test
    void rejectsBadInformation()
    {
        assertThrows(IllegalArgumentException.class, () -> new Song(null, "a", 1, 120));
        assertThrows(IllegalArgumentException.class, () -> new Song("  ", "a", 1, 120));
        assertThrows(IllegalArgumentException.class, () -> new Song("t", null, 1, 120));
        assertThrows(IllegalArgumentException.class, () -> new Song("t", "", 1, 120));
        assertThrows(IllegalArgumentException.class, () -> new Song("t", "a", 0, 120));
        assertThrows(IllegalArgumentException.class, () -> new Song("t", "a", 1, -5));
        assertThrows(IllegalArgumentException.class, () -> new Song("t", "a", Double.NaN, 120));
    }

    @Test
    void setChartThenGetChartGivesTheSameQueue()
    {
        Song s = song();
        Queue<Note> hard = chart(3);
        s.setChart(Difficulty.HARD, hard);
        assertSame(hard, s.getChart(Difficulty.HARD));
        assertEquals(3, s.getChart(Difficulty.HARD).getSize());
    }

    @Test
    void getChartIsNullWhenUnavailableOrNoDifficulty()
    {
        Song s = song();
        assertNull(s.getChart(Difficulty.EASY));
        s.setChart(Difficulty.EASY, chart(1));
        assertNull(s.getChart(Difficulty.MEDIUM));
        assertNull(s.getChart(null));
    }

    @Test
    void setChartRejectsANullDifficultyOrChart()
    {
        Song s = song();
        assertThrows(IllegalArgumentException.class, () -> s.setChart(null, chart(1)));
        assertThrows(IllegalArgumentException.class, () -> s.setChart(Difficulty.EASY, null));
        assertTrue(s.getAvailableDifficulties().isEmpty());
    }

    @Test
    void availableDifficultiesAreTheChartedOnesEasiestFirst()
    {
        Song s = song();
        assertTrue(s.getAvailableDifficulties().isEmpty());
        s.setChart(Difficulty.HARD, chart(2));
        s.setChart(Difficulty.EASY, chart(1));
        assertEquals(List.of(Difficulty.EASY, Difficulty.HARD), s.getAvailableDifficulties());
    }

    @Test
    void aChartPlaysInTheOrderItWasWritten()
    {
        Song s = song();
        s.setChart(Difficulty.MEDIUM, chart(5));
        Queue<Note> q = s.getChart(Difficulty.MEDIUM);
        double last = -1;
        while(!q.isEmpty())
        {
            Note n = q.dequeue();
            assertTrue(n.getTimeStamp() > last);
            last = n.getTimeStamp();
        }
    }
}
