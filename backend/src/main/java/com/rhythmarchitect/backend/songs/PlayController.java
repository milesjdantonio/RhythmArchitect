package com.rhythmarchitect.backend.songs;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.rhythmarchitect.backend.web.ApiException;

import jakarta.servlet.http.HttpServletRequest;
import main.Difficulty;
import main.HitResult;
import main.Main;
import main.Note;
import main.Queue;
import main.Score;
import main.Song;
import main.SongWriter;

import tools.jackson.databind.JsonNode;

/**
 * Playing through the controller (docs/api.md, "Play"). The controller reviews the player's input
 * and the model keeps the score. A run starts a {@link Main} on the song's {@link Song} (the model,
 * as SongModel builds it) at a difficulty; the game then sends what the player does, in order:
 * each key press (a lane and the song time) goes to {@link Main#processInput}, which checks it
 * against the song's queue of notes, and the song's clock (a time alone) to
 * {@link Main#checkMissedNotes}. Every input is reviewed first ({@link InputReview}: malformed,
 * out of order, past the end, a double press are turned down and never reach Main; a run faster
 * than real time, with more presses than hands make, or claiming hits nobody pressed for is
 * flagged). With the inputs comes the run as the game judged it (its tokens since the last call),
 * and the run so far is confirmed through the model: checked against the chart's queue and counted
 * through GameScore ({@link RunReplay}, as a saved best is). Every answer is that confirmed score,
 * how many presses Main reviewed, the review, and Main's own state (its Score, the next notes in
 * its queue). Main is Darsh's and unchanged; this routes to it and decides what reaches it.
 *
 * <p>A best score is kept only from a run reviewed here that passed, once
 * ({@link #keep}, from SongController's scores route).</p>
 *
 * <p>Runs live in memory (a few hundred at most, the oldest dropped first, and none older than an
 * hour): one is a player's song, and a restart starts another. A client can start only so many
 * ({@link #STARTS_PER_MINUTE}, {@link #LIVE_PER_CLIENT}: one can't push everyone else's runs out),
 * and a run takes inputs only so often ({@link #CALLS_PER_SECOND}; the game sends four a second).</p>
 */
@RestController
@RequestMapping("/api/play")
public class PlayController {

    /** At most this many runs at once (the oldest goes first). */
    static final int MAX_RUNS = 300;
    /** A run not used for this long is dropped. */
    static final long IDLE_MS = 60 * 60 * 1000;
    /** At most this many inputs in one request (a quarter of a second of play is a handful). */
    static final int MAX_INPUTS = 500;
    /** How many of the next notes each answer shows. */
    static final int UPCOMING = 4;
    /** The longest run kept (RunReplay turns down longer ones). */
    static final int MAX_RUN = 400_000;
    /** Runs one client may start in a minute, and have going at once. */
    static final int STARTS_PER_MINUTE = 30;
    static final int LIVE_PER_CLIENT = 12;
    /** Calls a run takes in a second (the game makes four). */
    static final int CALLS_PER_SECOND = 20;
    /** A song id as the bank makes them. */
    private static final Pattern SONG_ID = Pattern.compile("[A-Za-z0-9_-]{1,120}");

    private static final class Run {
        final Main main;
        final int total;
        final String songId;
        final Difficulty level;
        final boolean practice;
        final String client;
        /** The chart the run is confirmed against (its own copy: Main uses up its queue). */
        final Queue<Note> chart;
        final InputReview review;
        final StringBuilder run = new StringBuilder();
        final ArrayDeque<Long> calls = new ArrayDeque<>();
        int reviewed;
        boolean refused;
        /** Its score was kept (a run's score is kept once). */
        boolean kept;
        /** The player said how it felt (once a run: SongController's feel route). */
        boolean rated;
        RunReplay.Result confirmed = new RunReplay.Result(0, 1, 0);
        long used;

        Run(Main main, int total, String songId, Difficulty level, boolean practice, String client, Queue<Note> chart, InputReview review, long now) {
            this.main = main;
            this.total = total;
            this.songId = songId;
            this.level = level;
            this.practice = practice;
            this.client = client;
            this.chart = chart;
            this.review = review;
            this.used = now;
        }
    }

    private final SongStore store;
    private final Map<String, Run> runs = new LinkedHashMap<>();
    /** Each client's recent starts (milliseconds). */
    private final Map<String, ArrayDeque<Long>> starts = new HashMap<>();
    private LongSupplier clock = System::currentTimeMillis;

    public PlayController(SongStore store) {
        this.store = store;
    }

    /** The clock the runs are timed by (milliseconds; tests drive it). */
    public void clock(LongSupplier clock) {
        this.clock = clock;
    }

    /**
     * Starts a run: {songId, difficulty, from?, to?} → {run, notes, state}. With from and to
     * (seconds), practice mode: Main plays only that stretch, the Song's chart for the difficulty
     * replaced by {@link Song#getChartBetween} (Main itself is unchanged).
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> start(@RequestBody JsonNode body, HttpServletRequest request) {
        String id = body.path("songId").isString() ? body.path("songId").asString() : "";
        Difficulty level = SongModel.difficulty(body.path("difficulty").asString(""));
        if (id.isEmpty() || level == null) throw ApiException.badRequest("Say which song and difficulty");
        if (!SONG_ID.matcher(id).matches()) throw ApiException.badRequest("That isn't a song id");
        boolean part = body.has("from") || body.has("to");
        double from = body.path("from").isNumber() ? body.path("from").asDouble() : Double.NaN;
        double to = body.path("to").isNumber() ? body.path("to").asDouble() : Double.NaN;
        if (part && !(Double.isFinite(from) && Double.isFinite(to) && from >= 0 && to > from)) {
            throw ApiException.badRequest("A practice stretch needs a start before its end, in seconds from 0");
        }
        String client = clientOf(request);
        long now = clock.getAsLong();
        synchronized (runs) {
            ArrayDeque<Long> mine = starts.computeIfAbsent(client, k -> new ArrayDeque<>());
            while (!mine.isEmpty() && now - mine.peekFirst() > 60_000) mine.removeFirst();
            if (mine.size() >= STARTS_PER_MINUTE) throw ApiException.tooMany("Too many runs started at once: wait a moment");
            mine.addLast(now);
        }
        JsonNode stored = store.read(all -> store.find(all, id).map(JsonNode::deepCopy).orElse(null));
        if (stored == null) throw ApiException.notFound("No song with that id");
        Main main;
        Queue<Note> chart;
        try {
            // The song as the model has it (SongModel: SongWriter's Song), then the controller on it.
            Song song = forRun(stored, level, part, from, to);
            main = new Main(song, level);
            chart = SongWriter.chartFor(forRun(stored, level, part, from, to), level);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest(e.getMessage());
        }
        Run run = new Run(main, main.getUpcomingNotes(Integer.MAX_VALUE).size(), id, level, part, client, chart,
            new InputReview(chart, songSeconds(stored), () -> clock.getAsLong()), now);
        String key = UUID.randomUUID().toString();
        synchronized (runs) {
            prune(now);
            // A client's oldest run gives way to its new one (never someone else's).
            long live = runs.values().stream().filter(r -> r.client.equals(client)).count();
            for (Iterator<Run> it = runs.values().iterator(); live >= LIVE_PER_CLIENT && it.hasNext();) {
                if (it.next().client.equals(client)) {
                    it.remove();
                    live--;
                }
            }
            runs.put(key, run);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", key);
        out.put("notes", run.total);
        out.put("state", state(run));
        return ResponseEntity.status(HttpStatus.CREATED).body(out);
    }

    /**
     * The song as the model has it for a run: practising, its chart for the difficulty is only the
     * stretch (Song.getChartBetween, which turns down a stretch that doesn't start before it ends).
     */
    private static Song forRun(JsonNode stored, Difficulty level, boolean part, double from, double to) {
        Song song = SongModel.of(stored);
        if (part) {
            Queue<Note> stretch = song.getChartBetween(level, from, to);
            if (stretch == null) throw new IllegalArgumentException("No chart available for this difficulty.");
            song.setChart(level, stretch);
        }
        return song;
    }

    /**
     * What the player did, in order: {inputs: [{lane, time} | {time}], run?}. A lane is a key
     * press (Main.processInput: its result, or null when the review or Main turns the input down);
     * a time alone is the clock passing (Main.checkMissedNotes). `run` is the run as the game
     * judged it since the last call (the tokens of POST /api/songs/:id/scores): the run so far is
     * confirmed through the model (RunReplay: the chart's queue, then GameScore), or marked refused
     * if it couldn't have been played on the chart, and reviewed against the presses sent.
     * → {results, state}.
     */
    @PostMapping("/{run}/inputs")
    public Map<String, Object> inputs(@PathVariable String run, @RequestBody JsonNode body) {
        Run r;
        long now = clock.getAsLong();
        synchronized (runs) {
            r = runs.get(run);
            if (r == null) throw ApiException.notFound("That run is over (or never started)");
            r.used = now;
        }
        JsonNode list = body.path("inputs");
        if (!list.isArray()) throw ApiException.badRequest("Send the inputs as a list");
        if (list.size() > MAX_INPUTS) throw ApiException.badRequest("Too many inputs at once");
        List<String> results = new ArrayList<>();
        synchronized (r) {
            while (!r.calls.isEmpty() && now - r.calls.peekFirst() > 1000) r.calls.removeFirst();
            if (r.calls.size() >= CALLS_PER_SECOND) throw ApiException.tooMany("Inputs are coming too fast");
            r.calls.addLast(now);
            if (r.kept) throw ApiException.badRequest("That run is over: its score was kept");
            for (JsonNode in : list) {
                // The review first: what it turns down never reaches Main.
                if (r.review.review(in) != null) {
                    if (in.has("lane")) results.add(null);
                    continue;
                }
                double time = in.path("time").asDouble();
                if (in.has("lane")) {
                    HitResult result = r.main.processInput(in.path("lane").asInt(), time);
                    if (result != null) r.reviewed++;
                    results.add(result == null ? null : result.name());
                } else {
                    r.main.checkMissedNotes(time);
                }
            }
            if (body.has("run") && !r.refused) {
                String more = body.path("run").isString() ? body.path("run").asString() : null;
                if (more == null || r.run.length() + more.length() > MAX_RUN) {
                    r.refused = true;
                } else if (!more.isEmpty()) {
                    r.run.append(more);
                    RunReplay.Result c = RunReplay.of(r.run.toString(), r.chart);
                    if (c == null) r.refused = true; else r.confirmed = c;
                }
            }
            if (!r.refused) r.review.reviewRun(r.run.toString());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("results", results);
            out.put("state", state(r));
            return out;
        }
    }

    /**
     * A run's score is to be kept (SongController's scores route): it must be a run reviewed here,
     * of this song and difficulty, not practice, its run the one the controller confirmed, the
     * review passed, and not kept before. Throws why not.
     */
    public void keep(String runId, String songId, String difficulty, String runText) {
        Run r;
        synchronized (runs) {
            r = runId == null ? null : runs.get(runId);
        }
        if (r == null) throw new ApiException(422, "The controller didn't review this run (the server may have restarted during it), so its score wasn't kept");
        synchronized (r) {
            if (!r.songId.equals(songId) || !r.level.name().equalsIgnoreCase(difficulty) || r.practice) {
                throw new ApiException(422, "That run was of another song or difficulty");
            }
            if (r.kept) throw new ApiException(409, "That run's score was already kept");
            if (r.refused || runText == null || !runText.contentEquals(r.run)) {
                throw new ApiException(422, "The run doesn't match the one the controller reviewed, so its score wasn't kept");
            }
            r.review.reviewRun(runText);
            if (!r.review.passed()) throw new ApiException(422, "The controller flagged this run (" + r.review.why() + "), so its score wasn't kept");
            r.kept = true;
        }
    }

    /**
     * The player says how a run felt (SongController's feel route): it must be a run of this song
     * and difficulty whose score was kept here, and not rated before. Throws why not.
     */
    public void rate(String runId, String songId, String difficulty) {
        Run r;
        synchronized (runs) {
            r = runId == null ? null : runs.get(runId);
        }
        if (r == null) throw new ApiException(422, "The controller didn't review this run, so how it felt wasn't counted");
        synchronized (r) {
            if (!r.songId.equals(songId) || !r.level.name().equalsIgnoreCase(difficulty)) {
                throw new ApiException(422, "That run was of another song or difficulty");
            }
            if (!r.kept) throw new ApiException(422, "Only a run whose score was kept can say how it felt");
            if (r.rated) throw new ApiException(409, "That run already said how it felt");
            r.rated = true;
        }
    }

    /**
     * The model's state: the run confirmed (GameScore's score, accuracy and max combo; null when
     * it was refused), how many presses Main reviewed, the review, then Main's own: its Score, its
     * clock and the next notes in its queue.
     */
    private static Map<String, Object> state(Run r) {
        Score s = r.main.getScore();
        List<Map<String, Object>> next = new ArrayList<>();
        for (Note n : r.main.getUpcomingNotes(UPCOMING)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("lane", n.getLane());
            m.put("time", n.getTimeStamp());
            next.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        if (r.refused) {
            out.put("confirmed", null);
        } else {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("score", r.confirmed.score());
            c.put("accuracy", r.confirmed.accuracy());
            c.put("maxCombo", r.confirmed.maxCombo());
            out.put("confirmed", c);
        }
        out.put("reviewed", r.reviewed);
        out.put("review", r.review.toMap());
        out.put("score", s.getScore());
        out.put("combo", s.getCombo());
        out.put("maxCombo", s.getMaxCombo());
        out.put("hits", s.getHits());
        out.put("misses", s.getMisses());
        out.put("accuracy", s.getAccuracy());
        out.put("time", r.main.getCurrentTime());
        out.put("left", r.main.getUpcomingNotes(Integer.MAX_VALUE).size());
        out.put("upcoming", next);
        return out;
    }

    /** How long the song runs from beat 0 (seconds: its length in beats at its tempo). */
    private static double songSeconds(JsonNode stored) {
        double bpm = stored.path("bpm").asDouble(0);
        return bpm > 0 ? stored.path("lengthBeats").asDouble(0) * 60 / bpm : 0;
    }

    /**
     * Who's asking: the address the request came from (behind the host's proxy, the last address
     * it added to X-Forwarded-For; earlier ones are whatever the client wrote there).
     */
    static String clientOf(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            String[] parts = forwarded.split(",");
            String last = parts[parts.length - 1].trim();
            if (!last.isEmpty() && last.length() <= 64) return last;
        }
        return String.valueOf(request.getRemoteAddr());
    }

    /** Drops idle runs, and the oldest while there are too many; forgets old starts. */
    private void prune(long now) {
        runs.values().removeIf(x -> now - x.used > IDLE_MS);
        Iterator<String> it = runs.keySet().iterator();
        while (runs.size() >= MAX_RUNS && it.hasNext()) {
            it.next();
            it.remove();
        }
        starts.values().removeIf(q -> q.isEmpty() || now - q.peekLast() > 60_000);
    }
}
