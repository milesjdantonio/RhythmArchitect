package com.rhythmarchitect.backend.songs;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import main.GameScore;
import main.HitResult;
import main.Note;
import main.Queue;

/**
 * A finished run counted again on the server, through the game's model classes ({@link GameScore},
 * which is {@code main.Score} with the game's multiplier and holds on top), before its best score
 * is kept. The run is the results in order, as the game recorded them (frontend/src/game/score.ts):
 * P, G, E, L for a PERFECT, GOOD, EARLY or LATE hit, M for a miss, H&lt;ms&gt;; for a held note held
 * its length in milliseconds, B for one let go early, X for a stray press (no tile), O where the
 * player set off Overdrive (the run is refused if the charge wasn't full there, or it was at its
 * top level: GameScore.startOverdrive), U where its grace ended (refused outside one; a grace
 * longer than the chart allows is refused by {@link #fits}: {@link #graceTiles}).
 *
 * <p>First the run is checked against the chart it was played on (the difficulty's
 * {@code Queue} of {@code Note}s, from {@link SongModel}): every tile is judged once, so a run
 * can't judge more tiles than the chart has, end more holds than it has, or hold a note longer
 * than the chart's holds last. A run ended early (a fail) judges fewer.</p>
 */
public final class RunReplay {
    private static final Pattern VALID = Pattern.compile("(?:[PGELMBOXU]|H\\d{1,7};)*");
    private static final Pattern TOKEN = Pattern.compile("[PGELMBOXU]|H(\\d+);");
    /** How far a hold's recorded time may be off its length, in milliseconds (rounding). */
    static final long HOLD_SLACK_MS = 2;

    /** The score (with the multiplier and the holds), Score's accuracy as a share (0..1) and max combo. */
    public record Result(long score, double accuracy, int maxCombo) {
    }

    private RunReplay() {
    }

    /** The run counted through GameScore, or null when it isn't one. Not checked against a chart. */
    public static Result of(String run) {
        return of(run, null);
    }

    /**
     * The run counted through GameScore, or null when it isn't one or couldn't have been played
     * on the chart. A null chart counts it unchecked; the chart is left as it was.
     */
    public static Result of(String run, Queue<Note> chart) {
        if (run == null || run.length() > 400_000 || !VALID.matcher(run).matches()) return null;
        if (chart != null && !fits(run, chart)) return null;
        GameScore s = new GameScore();
        // The song's clock, as the game keeps it for Overdrive's drain: the k-th tile judged is at
        // the k-th tile's time of the chart (GameScore.passTime between them).
        double[] times = chart == null ? null : timesOf(chart);
        int judged = 0;
        Matcher m = TOKEN.matcher(run);
        while (m.find()) {
            char c = m.group().charAt(0);
            if (times != null && m.group(1) == null && "PGELM".indexOf(c) >= 0) {
                if (judged > 0 && judged < times.length) s.passTime(times[judged] - times[judged - 1]);
                judged++;
            }
            if (m.group(1) != null) {
                s.addHoldDone(Integer.parseInt(m.group(1)) / 1000.0);
                continue;
            }
            switch (m.group().charAt(0)) {
                case 'U' -> {
                    if (!s.isGrace()) return null;
                    s.endGrace();
                }
                case 'P' -> s.addHit(HitResult.PERFECT);
                case 'G' -> s.addHit(HitResult.GOOD);
                case 'E' -> s.addHit(HitResult.EARLY);
                case 'L' -> s.addHit(HitResult.LATE);
                case 'M' -> s.addMiss();
                case 'X' -> s.addStray();
                case 'O' -> {
                    if (!s.startOverdrive()) return null;
                }
                default -> s.addHoldBroken();
            }
        }
        return new Result(s.getScore(), s.getAccuracy() / 100, s.getMaxCombo());
    }

    /** The chart's tiles' times (seconds), in order; the chart is left as it was. */
    static double[] timesOf(Queue<Note> chart) {
        int n = chart.getSize();
        double[] t = new double[n];
        for (int i = 0; i < n; i++) {
            Note x = chart.dequeue();
            t[i] = x.getTimeStamp();
            chart.enqueue(x);
        }
        java.util.Arrays.sort(t);
        return t;
    }

    /**
     * The most tiles one grace can judge on a chart: the most the chart has in any
     * {@link GameScore#OVERDRIVE_GRACE} seconds (and a little: a tile judged late, one early),
     * plus two. `times`: the tiles' times in seconds.
     */
    static int graceTiles(List<Double> times) {
        List<Double> t = new ArrayList<>(times);
        t.sort(Comparator.naturalOrder());
        double span = GameScore.OVERDRIVE_GRACE + 0.6;
        int most = 0;
        for (int i = 0, j = 0; i < t.size(); i++) {
            while (t.get(i) - t.get(j) > span) j++;
            most = Math.max(most, i - j + 1);
        }
        return most + 2;
    }

    /**
     * Whether the run could have been played on the chart: no more tiles judged than it has, no
     * more holds ended than it has, the holds held to their end, longest first, each no longer
     * than the chart's holds, longest first, and no grace (O to U) longer than the chart allows
     * ({@link #graceTiles}).
     */
    static boolean fits(String run, Queue<Note> chart) {
        // Each note goes round the queue once (off the front, onto the back): the chart is left as it was.
        List<Long> holds = new ArrayList<>();
        List<Double> times = new ArrayList<>();
        int tiles = chart.getSize();
        for (int i = 0; i < tiles; i++) {
            Note n = chart.dequeue();
            if (n.isHold()) holds.add(Math.round(n.getNoteLength() * 1000));
            times.add(n.getTimeStamp());
            chart.enqueue(n);
        }
        int graceMax = graceTiles(times);
        boolean inGrace = false;
        int graceJudged = 0;
        int judged = 0, ended = 0;
        List<Long> held = new ArrayList<>();
        Matcher m = TOKEN.matcher(run);
        while (m.find()) {
            String g = m.group();
            if (g.equals("O")) { inGrace = true; graceJudged = 0; continue; }
            if (g.equals("U")) { inGrace = false; continue; }
            if (g.equals("X")) continue;
            if (m.group(1) == null && !g.equals("B") && inGrace && ++graceJudged > graceMax) return false;
            if (m.group(1) != null) held.add(Long.parseLong(m.group(1)));
            if (m.group(1) != null || m.group().equals("B")) ended++;
            else judged++;
        }
        if (judged > tiles || ended > holds.size()) return false;
        holds.sort(Comparator.reverseOrder());
        held.sort(Comparator.reverseOrder());
        for (int i = 0; i < held.size(); i++) {
            if (held.get(i) > holds.get(i) + HOLD_SLACK_MS) return false;
        }
        return true;
    }
}
