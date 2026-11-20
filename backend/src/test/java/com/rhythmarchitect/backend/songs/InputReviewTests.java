package com.rhythmarchitect.backend.songs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

import main.MusicNoteType;
import main.Note;
import main.NoteType;
import main.Queue;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The controller's review of a run's inputs (InputReview): what's turned down, what's flagged. */
class InputReviewTests {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** A tile every half second, lanes 0 1 2 3 in turn, `n` of them. */
    private static Queue<Note> chart(int n) {
        Queue<Note> q = new Queue<>();
        for (int i = 0; i < n; i++) q.enqueue(new Note(NoteType.C, MusicNoteType.NORMAL, 0.125, i * 0.5, i % 4));
        return q;
    }

    private static JsonNode in(String json) {
        return JSON.readTree(json);
    }

    /** A review on the chart, its clock in real time from `wall` (ms). */
    private static InputReview review(int notes, AtomicLong wall) {
        return new InputReview(chart(notes), wall::get);
    }

    @Test
    void aRunPlayedInRealTimePasses() {
        AtomicLong wall = new AtomicLong();
        InputReview r = review(40, wall);
        StringBuilder run = new StringBuilder();
        for (int i = 0; i < 40; i++) {
            wall.set(i * 500L);
            assertNull(r.review(in("{\"lane\":" + (i % 4) + ",\"time\":" + (i * 0.5 + 0.01) + "}")));
            assertNull(r.review(in("{\"time\":" + (i * 0.5 + 0.2) + "}")));
            run.append('P');
        }
        r.reviewRun(run.toString());
        assertTrue(r.passed(), r.toString());
        assertEquals(0, r.refused());
    }

    @Test
    void malformedInputsAreTurnedDown() {
        InputReview r = review(8, new AtomicLong());
        for (String bad : new String[] { "[1,2]", "{\"lane\":4,\"time\":1}", "{\"lane\":1.5,\"time\":1}", "{\"lane\":\"0\",\"time\":1}",
                "{\"lane\":0,\"time\":-1}", "{\"lane\":0}", "{\"time\":\"1\"}", "{\"lane\":0,\"time\":1,\"cheat\":true}", "{\"time\":1e400}" }) {
            assertEquals("malformed", r.review(in(bad)), bad);
        }
        assertEquals(9, r.refused());
        assertFalse(r.passed());
        assertEquals("malformed", r.flags().get(0).check());
        assertEquals(9, r.flags().get(0).count());
    }

    @Test
    void inputsOutOfOrderPastTheEndOrSentTwiceAreTurnedDown() {
        InputReview r = review(8, new AtomicLong(100_000));
        assertNull(r.review(in("{\"time\":3}")));
        // A little before the latest time is fine (a press stamped just before a clock tick)...
        assertNull(r.review(in("{\"lane\":2,\"time\":2.8}")));
        // ...a second before isn't.
        assertEquals("out of order", r.review(in("{\"lane\":1,\"time\":2}")));
        // The same lane again within a few milliseconds: one press sent twice.
        assertEquals("double press", r.review(in("{\"lane\":2,\"time\":2.805}")));
        assertNull(r.review(in("{\"lane\":2,\"time\":2.9}")));
        // The last note is at 3.5 s: half a minute after it, nothing counts.
        assertEquals("past the end", r.review(in("{\"time\":40}")));
        assertEquals(3, r.refused());
        // Past the end flags the run; a step back or a double press now and then doesn't...
        assertEquals(List.of("past the end"), r.flags().stream().map(InputReview.Flag::check).toList());
        // ...only when they keep coming.
        for (int i = 0; i < InputReview.TOLERATED; i++) r.review(in("{\"lane\":1,\"time\":1}"));
        assertEquals(List.of("past the end", "out of order"), r.flags().stream().map(InputReview.Flag::check).toList());
    }

    @Test
    void aRunFasterThanRealTimeIsFlagged() {
        AtomicLong wall = new AtomicLong(0);
        InputReview r = review(400, wall);
        assertNull(r.review(in("{\"time\":0}")));
        // Two seconds of song in one second: within the slack...
        wall.set(1000);
        r.review(in("{\"time\":2}"));
        assertTrue(r.passed());
        // ...a whole song sent at once isn't.
        r.review(in("{\"time\":150}"));
        assertFalse(r.passed());
        assertEquals("too fast", r.flags().get(0).check());
    }

    @Test
    void morePressesThanHandsMakeAreFlagged() {
        InputReview r = review(8, new AtomicLong(1_000_000));
        for (int i = 0; i < 60; i++) r.review(in("{\"lane\":" + (i % 4) + ",\"time\":" + (1 + i * 0.015) + "}"));
        assertFalse(r.passed());
        assertEquals("too many presses", r.flags().get(0).check());
    }

    @Test
    void hitsNobodyPressedForAreFlagged() {
        InputReview r = review(40, new AtomicLong(1_000_000));
        // Presses on the first five notes, in their lanes: five hits are explained.
        for (int i = 0; i < 5; i++) r.review(in("{\"lane\":" + (i % 4) + ",\"time\":" + (i * 0.5) + "}"));
        r.reviewRun("PPPPP" + "M".repeat(3));
        assertTrue(r.passed(), r.toString());
        // Thirty Perfects claimed from five presses.
        r.reviewRun("P".repeat(30));
        assertFalse(r.passed());
        assertEquals("unpressed hits", r.flags().get(0).check());
    }

    @Test
    void aPressInTheWrongLaneExplainsNoHit() {
        InputReview r = review(40, new AtomicLong(1_000_000));
        // Every press in lane 0, where only every fourth note is.
        for (int i = 0; i < 20; i++) r.review(in("{\"lane\":0,\"time\":" + (i * 0.5) + "}"));
        r.reviewRun("P".repeat(20));
        assertFalse(r.passed());
    }
}
