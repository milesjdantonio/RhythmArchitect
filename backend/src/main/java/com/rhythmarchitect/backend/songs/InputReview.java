package com.rhythmarchitect.backend.songs;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

import main.Note;
import main.Queue;

import tools.jackson.databind.JsonNode;

/**
 * The controller's review of a run (PlayController): every input is looked at before it reaches
 * {@code main.Main}, and the run as a whole is checked for what a person at a keyboard couldn't
 * have done. Main judges the presses it's given; this decides which it's given, and whether the
 * run's score may be kept (SongController's scores route keeps a best only from a run this passed).
 *
 * <p>An input is turned down (it never reaches Main; its result is null) when it is:</p>
 * <ul>
 *   <li><b>malformed</b>: not an object, a lane that isn't a whole number 0-3, a time that isn't a
 *   finite number of seconds from 0, or anything else in it;</li>
 *   <li><b>out of order</b>: earlier than the latest time already reviewed, by more than
 *   {@link #ORDER_SLACK} (the game sends them in the order they happened);</li>
 *   <li><b>past the end</b>: later than the song's end (or its last note, if later) by more than
 *   {@link #END_SLACK};</li>
 *   <li><b>a double press</b>: the same lane again within {@link #DOUBLE_PRESS} (one press sent twice).</li>
 * </ul>
 *
 * <p>The run is flagged (its score not kept) when an input was malformed or past the end, when
 * inputs out of order or double presses keep coming ({@link #TOLERATED} of each are let go: a
 * YouTube song's clock can step back a little when the video stalls and it catches up), or when:</p>
 * <ul>
 *   <li><b>too fast</b>: the song's clock ran ahead of the real one by more than {@link #PACE_SLACK}
 *   (a run sent all at once, or a speeded-up clock; practice plays slower, never faster);</li>
 *   <li><b>too many presses</b>: more than {@link #MAX_PER_SECOND} in any second of song;</li>
 *   <li><b>unpressed hits</b>: the run as the game judged it claims more hits (and stray presses)
 *   than there were presses near a note in their lane ({@link #REACH}, Main's widest window),
 *   with {@link #HIT_SLACK} for presses still on their way.</li>
 * </ul>
 */
public final class InputReview {
    /** How far (s) an input may come before the latest time reviewed. */
    static final double ORDER_SLACK = 0.35;
    /** How long after the song's end (s) inputs still count. */
    static final double END_SLACK = 30;
    /** The same lane twice within this (s) is one press sent twice. */
    static final double DOUBLE_PRESS = 0.012;
    /** How far (s) the song's clock may run ahead of real time (batching, a late first input). */
    static final double PACE_SLACK = 3;
    /** The most presses in any one second of song (Ultra's densest stretches need about 25). */
    static final int MAX_PER_SECOND = 40;
    /** How near (s) a press must be to a note in its lane to explain a hit (Main's Early/Late window). */
    static final double REACH = 0.30;
    /** Hits the presses may fall short by (a press judged, its input not sent yet), plus a share. */
    static final int HIT_SLACK = 4;
    static final double HIT_SHARE = 0.02;
    /** Inputs out of order, and double presses, turned down before the run is flagged for them. */
    static final int TOLERATED = 20;

    /** A reason the run was flagged, how often it came up, and the first time it did. */
    public record Flag(String check, String detail, int count) {
    }

    private final LongSupplier clock;
    private final double end;
    /** Each lane's note times (sorted), and how many of them a press has already explained. */
    private final double[][] lanes = new double[4][];
    private final boolean[][] used = new boolean[4][];
    private final int[] from = new int[4];
    private final double[] lastPress = { Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY };
    private final ArrayDeque<Double> lastSecond = new ArrayDeque<>();
    private final Map<String, Flag> flags = new LinkedHashMap<>();
    private final Map<String, Integer> turnedDown = new LinkedHashMap<>();
    private double latest = Double.NEGATIVE_INFINITY;
    private double firstSong = Double.NaN;
    private long firstWall;
    private int presses;
    private int explained;
    private int refused;

    /** A review of a run on `chart` (left as it was), timed by `clock` (milliseconds). */
    public InputReview(Queue<Note> chart, LongSupplier clock) {
        this(chart, 0, clock);
    }

    /** The same, for a song `seconds` long (from beat 0: the clock runs on to its end). */
    public InputReview(Queue<Note> chart, double seconds, LongSupplier clock) {
        this.clock = clock;
        List<List<Double>> byLane = new ArrayList<>();
        for (int i = 0; i < 4; i++) byLane.add(new ArrayList<>());
        double last = 0;
        int n = chart.getSize();
        for (int i = 0; i < n; i++) {
            Note note = chart.dequeue();
            chart.enqueue(note);
            int lane = note.getLane();
            if (lane >= 0 && lane < 4) byLane.get(lane).add(note.getTimeStamp());
            last = Math.max(last, note.getTimeStamp());
        }
        for (int i = 0; i < 4; i++) {
            lanes[i] = byLane.get(i).stream().mapToDouble(Double::doubleValue).sorted().toArray();
            used[i] = new boolean[lanes[i].length];
        }
        end = Math.max(last, Double.isFinite(seconds) ? seconds : 0) + END_SLACK;
    }

    /**
     * Reviews one input (a press: lane and time; the clock: a time alone). Null when it may go to
     * Main, else the check that turned it down (the run is flagged for it).
     */
    public String review(JsonNode in) {
        if (in == null || !in.isObject()) return refuse("malformed", "an input that isn't an object");
        for (String field : in.propertyNames()) {
            if (!"lane".equals(field) && !"time".equals(field)) return refuse("malformed", "an input with \"" + clip(field) + "\" in it");
        }
        JsonNode t = in.path("time");
        if (!t.isNumber() || !Double.isFinite(t.asDouble()) || t.asDouble() < 0) return refuse("malformed", "a time that isn't seconds from 0");
        double time = t.asDouble();
        boolean press = in.has("lane");
        int lane = -1;
        if (press) {
            JsonNode l = in.path("lane");
            if (!l.isIntegralNumber() || l.asInt() < 0 || l.asInt() > 3) return refuse("malformed", "a lane that isn't 0-3");
            lane = l.asInt();
        }
        if (time > end) return refuse("past the end", "an input at " + secs(time) + ", after the song's last note");
        if (time < latest - ORDER_SLACK) return refuse("out of order", "an input at " + secs(time) + " after one at " + secs(latest), TOLERATED);
        if (press && time - lastPress[lane] < DOUBLE_PRESS && time >= lastPress[lane]) return refuse("double press", "lane " + lane + " twice at " + secs(time), TOLERATED);

        // The pace: the song's clock against the real one, from the first input.
        long now = clock.getAsLong();
        if (Double.isNaN(firstSong)) {
            firstSong = time;
            firstWall = now;
        } else if (time - firstSong > (now - firstWall) / 1000.0 + PACE_SLACK) {
            flag("too fast", "the song reached " + secs(time) + " " + secs((now - firstWall) / 1000.0) + " after it started");
        }
        latest = Math.max(latest, time);
        if (!press) return null;

        presses++;
        lastPress[lane] = time;
        lastSecond.addLast(time);
        while (!lastSecond.isEmpty() && lastSecond.peekFirst() < time - 1) lastSecond.removeFirst();
        if (lastSecond.size() > MAX_PER_SECOND) flag("too many presses", lastSecond.size() + " presses in the second before " + secs(time));
        explain(lane, time);
        return null;
    }

    /** A press explains a hit when an unused note in its lane is within REACH of it (the nearest). */
    private void explain(int lane, double time) {
        double[] at = lanes[lane];
        boolean[] u = used[lane];
        while (from[lane] < at.length && at[from[lane]] < time - REACH) from[lane]++;
        int best = -1;
        for (int i = from[lane]; i < at.length && at[i] <= time + REACH; i++) {
            if (!u[i] && (best < 0 || Math.abs(at[i] - time) < Math.abs(at[best] - time))) best = i;
        }
        if (best >= 0) {
            u[best] = true;
            explained++;
        }
    }

    /**
     * The run as the game judged it so far (RunReplay's tokens): its hits and stray presses can't
     * outnumber the presses that could have made them.
     */
    public void reviewRun(String run) {
        int hits = 0, strays = 0;
        for (int i = 0; i < run.length(); i++) {
            switch (run.charAt(i)) {
                case 'P', 'G', 'E', 'L' -> hits++;
                case 'X' -> strays++;
                case 'H' -> { while (i < run.length() && run.charAt(i) != ';') i++; }
                default -> { }
            }
        }
        int slack = HIT_SLACK + (int) Math.ceil(HIT_SHARE * hits);
        if (hits > explained + slack) flag("unpressed hits", hits + " hits claimed, " + explained + " presses near a note in their lane");
        if (hits + strays > presses + slack) flag("unpressed hits", (hits + strays) + " presses judged, " + presses + " sent");
    }

    /** Whether nothing was flagged. */
    public boolean passed() {
        return flags.isEmpty();
    }

    public List<Flag> flags() {
        return List.copyOf(flags.values());
    }

    /** Inputs turned down (never given to Main). */
    public int refused() {
        return refused;
    }

    /** The first flag, in words (for an answer that turns the run's score down). */
    public String why() {
        return flags.values().stream().findFirst().map(f -> f.check() + ": " + f.detail()).orElse("");
    }

    /** The review for an answer: passed, the flags, the inputs turned down. */
    public Map<String, Object> toMap() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("passed", passed());
        List<Map<String, Object>> list = new ArrayList<>();
        for (Flag f : flags.values()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("check", f.check());
            m.put("detail", f.detail());
            m.put("count", f.count());
            list.add(m);
        }
        out.put("flags", list);
        out.put("refused", refused);
        return out;
    }

    private String refuse(String check, String detail) {
        return refuse(check, detail, 0);
    }

    /** Turned down; the run is flagged for it once more than `tolerated` of these have come. */
    private String refuse(String check, String detail, int tolerated) {
        refused++;
        int seen = turnedDown.merge(check, 1, Integer::sum);
        if (seen > tolerated) flag(check, detail);
        return check;
    }

    private void flag(String check, String detail) {
        Flag f = flags.get(check);
        flags.put(check, f == null ? new Flag(check, detail, 1) : new Flag(check, f.detail(), f.count() + 1));
    }

    private static String secs(double s) {
        return String.format(java.util.Locale.ROOT, "%.2f s", s);
    }

    private static String clip(String s) {
        String t = s.length() > 24 ? s.substring(0, 24) + "…" : s;
        return t.replaceAll("[^\\x20-\\x7e…]", "?");
    }

    @Override
    public String toString() {
        return "InputReview" + Arrays.toString(flags.values().toArray());
    }
}
