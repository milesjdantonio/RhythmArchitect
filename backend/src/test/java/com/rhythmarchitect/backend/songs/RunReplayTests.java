package com.rhythmarchitect.backend.songs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import main.GameScore;
import main.MusicNoteType;
import main.Note;
import main.NoteType;
import main.Queue;
import org.junit.jupiter.api.Test;

/**
 * Overdrive's grace in a replayed run (frontend/tests/unit/score.test.ts checks the same): a miss
 * in it doesn't end Overdrive, U ends it, and no grace may judge more tiles than the chart has in
 * GameScore.OVERDRIVE_GRACE seconds (and a little).
 */
class RunReplayTests {
    /** A tile every half second (one a beat at 120 BPM), `n` of them. */
    private static Queue<Note> everyHalfSecond(int n) {
        Queue<Note> chart = new Queue<>();
        for (int i = 0; i < n; i++) chart.enqueue(new Note(NoteType.C, MusicNoteType.NORMAL, 0.125, i * 0.5, 0));
        return chart;
    }

    @Test
    void aMissInTheGraceKeepsOverdriveAndOneAfterItEndsIt() {
        String charged = "P".repeat(34) + "O";
        assertNotNull(RunReplay.of(charged + "M"));
        assertNull(RunReplay.of("PU"), "no grace to end");
        assertNull(RunReplay.of(charged + "UU"), "it ended already");
        // In the grace the miss keeps Overdrive (+1): the Perfect after it scores x2, not x1.
        long held = RunReplay.of(charged + "MP").score(), ended = RunReplay.of(charged + "UMP").score();
        assertEquals(1000, held - ended);
    }

    @Test
    void aGraceLongerThanTheChartAllowsIsRefused() {
        Queue<Note> chart = everyHalfSecond(60);
        // 3 s of grace (and 0.6 s) holds 8 of these tiles: a grace may judge 10.
        assertEquals(10, RunReplay.graceTiles(java.util.stream.IntStream.range(0, 60).mapToObj(i -> i * 0.5).toList()));
        String charged = "P".repeat(34) + "O";
        assertNotNull(RunReplay.of(charged + "P".repeat(10) + "U", chart));
        assertNull(RunReplay.of(charged + "P".repeat(11) + "U", chart));
        assertNull(RunReplay.of(charged + "P".repeat(11), chart), "never ended");
        assertEquals(60, chart.getSize(), "the chart is left as it was");
    }

    @Test
    void theBestAChartAllowsGradesARun() {
        // 60 tiles a beat apart at 120 BPM; every fifth a hold of one beat, ending on the next tile
        // (frontend/tests/unit/score.test.ts: the same chart, the same number).
        Queue<Note> chart = new Queue<>();
        for (int i = 0; i < 60; i++) {
            boolean hold = i % 5 == 0;
            chart.enqueue(new Note(NoteType.C, MusicNoteType.NORMAL, hold ? 0.5 : 0.125, i * 0.5, 0, hold));
        }
        long par = GameScore.parScore(chart);
        assertEquals(295200, par);
        assertEquals(60, chart.getSize(), "the chart is left as it was");
        // Every tile Perfect but Overdrive never set off scores less.
        StringBuilder run = new StringBuilder();
        for (int i = 0; i < 60; i++) run.append(i % 5 == 0 ? "PH500;" : "P");
        long plain = RunReplay.of(run.toString(), chart).score();
        assertTrue(plain < par);
        assertEquals("S", GameScore.gradeFor(par, par, false));
        assertEquals("B", GameScore.gradeFor(par / 2, par, false));
        assertEquals("D", GameScore.gradeFor(par / 10, par, false));
        assertEquals("F", GameScore.gradeFor(par, par, true));
    }
}
