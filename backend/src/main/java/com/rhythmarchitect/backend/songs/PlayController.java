package com.rhythmarchitect.backend.songs;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.rhythmarchitect.backend.web.ApiException;

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
 * {@link Main#checkMissedNotes}. With them comes the run as the game judged it (its tokens since
 * the last call), and the run so far is confirmed through the model: checked against the chart's
 * queue and counted through GameScore ({@link RunReplay}, as a saved best is), the same rules as
 * the score at the top of the game's screen. Every answer is that confirmed score, how many presses
 * Main reviewed, and Main's own state (its Score, the next notes in its queue). Main is Darsh's and
 * unchanged; this only routes to it.
 *
 * Runs live in memory (a few hundred at most, the oldest dropped first, and none older than an
 * hour): one is a player's song, and a restart starts another.
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

    private static final class Run {
        final Main main;
        final int total;
        /** The chart the run is confirmed against (its own copy: Main uses up its queue). */
        final Queue<Note> chart;
        final StringBuilder run = new StringBuilder();
        int reviewed;
        boolean refused;
        RunReplay.Result confirmed = new RunReplay.Result(0, 1, 0);
        long used = System.currentTimeMillis();

        Run(Main main, int total, Queue<Note> chart) {
            this.main = main;
            this.total = total;
            this.chart = chart;
        }
    }

    private final SongStore store;
    private final Map<String, Run> runs = new LinkedHashMap<>();

    public PlayController(SongStore store) {
        this.store = store;
    }

    /**
     * Starts a run: {songId, difficulty, from?, to?} → {run, notes, state}. With from and to
     * (seconds), practice mode: Main plays only that stretch, the Song's chart for the difficulty
     * replaced by {@link Song#getChartBetween} (Main itself is unchanged).
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> start(@RequestBody JsonNode body) {
        String id = body.path("songId").asString("");
        Difficulty level = SongModel.difficulty(body.path("difficulty").asString(""));
        if (id.isEmpty() || level == null) throw ApiException.badRequest("Say which song and difficulty");
        boolean part = body.has("from") || body.has("to");
        double from = body.path("from").isNumber() ? body.path("from").asDouble() : Double.NaN;
        double to = body.path("to").isNumber() ? body.path("to").asDouble() : Double.NaN;
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
        Run run = new Run(main, main.getUpcomingNotes(Integer.MAX_VALUE).size(), chart);
        String key = UUID.randomUUID().toString();
        synchronized (runs) {
            prune();
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
     * press (Main.processInput: its result, or null when Main turns the input down); a time alone
     * is the clock passing (Main.checkMissedNotes). `run` is the run as the game judged it since the
     * last call (the tokens of POST /api/songs/:id/scores): the run so far is confirmed through the
     * model (RunReplay: the chart's queue, then GameScore), or marked refused if it couldn't have
     * been played on the chart. → {results, state}.
     */
    @PostMapping("/{run}/inputs")
    public Map<String, Object> inputs(@PathVariable String run, @RequestBody JsonNode body) {
        Run r;
        synchronized (runs) {
            r = runs.get(run);
            if (r == null) throw ApiException.notFound("That run is over (or never started)");
            r.used = System.currentTimeMillis();
        }
        JsonNode list = body.path("inputs");
        if (!list.isArray()) throw ApiException.badRequest("Send the inputs as a list");
        if (list.size() > MAX_INPUTS) throw ApiException.badRequest("Too many inputs at once");
        List<String> results = new ArrayList<>();
        synchronized (r) {
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
            for (JsonNode in : list) {
                // Anything that isn't a number becomes NaN, which Main turns down without a crash.
                double time = in.path("time").isNumber() ? in.path("time").asDouble() : Double.NaN;
                if (in.has("lane")) {
                    int lane = in.path("lane").isIntegralNumber() ? in.path("lane").asInt() : -1;
                    HitResult result = r.main.processInput(lane, time);
                    if (result != null) r.reviewed++;
                    results.add(result == null ? null : result.name());
                } else {
                    r.main.checkMissedNotes(time);
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("results", results);
            out.put("state", state(r));
            return out;
        }
    }

    /**
     * The model's state: the run confirmed (GameScore's score, accuracy and max combo; null when
     * it was refused), how many presses Main reviewed, then Main's own: its Score, its clock and the
     * next notes in its queue.
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

    /** Drops idle runs, and the oldest while there are too many. */
    private void prune() {
        long now = System.currentTimeMillis();
        runs.values().removeIf(x -> now - x.used > IDLE_MS);
        Iterator<String> it = runs.keySet().iterator();
        while (runs.size() >= MAX_RUNS && it.hasNext()) {
            it.next();
            it.remove();
        }
    }
}
