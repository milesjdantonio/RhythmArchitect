package com.rhythmarchitect.backend.songs;

import java.time.Instant;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.rhythmarchitect.backend.web.ApiException;

import main.Difficulty;
import main.Note;
import main.Queue;
import main.SongWriter;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Songs, search, favourites and the music bank (docs/api.md). */
@RestController
@RequestMapping("/api")
public class SongController {

    private static final Logger log = LoggerFactory.getLogger(SongController.class);

    private final SongStore store;

    public SongController(SongStore store) {
        this.store = store;
    }

    @GetMapping("/songs")
    public Map<String, Object> list() {
        return Map.of("songs", store.read(all -> all.stream().map(ObjectNode::deepCopy).toList()));
    }

    /** A song the browser mapped by listening (source.kind must be youtube). */
    @PostMapping("/songs")
    public ResponseEntity<ObjectNode> create(@RequestBody JsonNode body) {
        String problem = NewSongCheck.problem(body);
        if (problem != null) throw ApiException.badRequest(problem);
        return ResponseEntity.status(HttpStatus.CREATED).body(store.add((ObjectNode) body));
    }

    @GetMapping("/songs/{id}")
    public ObjectNode get(@PathVariable String id) {
        return store.read(all -> store.find(all, id).map(ObjectNode::deepCopy).orElseThrow(SongController::missing));
    }

    /** { title?, favorite?, offset? }: rename, mark favourite, or move the map (the dev tools' Song sync). */
    @PatchMapping("/songs/{id}")
    public ObjectNode patch(@PathVariable String id, @RequestBody JsonNode body) {
        return store.write(all -> {
            ObjectNode song = store.find(all, id).orElseThrow(SongController::missing);
            if (body.has("title")) {
                String t = body.get("title").asString("").trim();
                if (t.length() > 60) t = t.substring(0, 60);
                if (t.isEmpty()) throw ApiException.badRequest("Title cannot be empty");
                song.put("title", t);
            }
            if (body.has("favorite")) song.put("favorite", body.get("favorite").asBoolean(false));
            if (body.has("offset")) {
                JsonNode o = body.get("offset");
                if (!NewSongCheck.finite(o) || Math.abs(o.asDouble()) > 600) throw ApiException.badRequest("Bad offset");
                ObjectNode source = song.path("source") instanceof ObjectNode s ? s : song.putObject("source");
                source.put("offset", Math.round(o.asDouble() * 1000) / 1000.0);
            }
            return song.deepCopy();
        });
    }

    @DeleteMapping("/songs/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        store.write(all -> {
            ObjectNode song = store.find(all, id).orElseThrow(SongController::missing);
            return all.remove(song);
        });
        return ResponseEntity.noContent().build();
    }

    /**
     * Counts a play and keeps the best score for the difficulty. Autoplay runs are never sent. A run
     * the game recorded (`run`) is checked against the song's chart and counted again through the
     * game's model classes (RunReplay: the difficulty's Queue of Notes from SongModel, then
     * main.GameScore, Score with the multiplier and holds on top), and that is what's kept, marked
     * "rules": "score"; a best from before (the game's old points) gives way to any such run.
     */
    @PostMapping("/songs/{id}/scores")
    public ObjectNode score(@PathVariable String id, @RequestBody JsonNode body) {
        String difficulty = body.path("difficulty").asString("");
        Difficulty level = SongModel.difficulty(difficulty);
        if (level == null || !NewSongCheck.finite(body.path("score"))) {
            throw ApiException.badRequest("Bad score");
        }
        boolean recorded = body.has("run");
        String runText = recorded ? body.path("run").asString(null) : null;
        return store.write(all -> {
            ObjectNode song = store.find(all, id).orElseThrow(SongController::missing);
            RunReplay.Result replayed = null;
            if (recorded) {
                replayed = RunReplay.of(runText, chartOf(song, level));
                if (replayed == null) throw ApiException.badRequest("Bad run");
            }
            song.put("plays", song.path("plays").asInt(0) + 1);
            ObjectNode best = song.path("best") instanceof ObjectNode b ? b : song.putObject("best");
            JsonNode prev = best.path(difficulty);
            long score = replayed != null ? replayed.score() : Math.round(body.path("score").asDouble());
            boolean old = !prev.isMissingNode() && !prev.isNull() && !"score".equals(prev.path("rules").asString(""));
            if (prev.isMissingNode() || prev.isNull() || (replayed != null && old) || score > prev.path("score").asDouble()) {
                ObjectNode run = best.putObject(difficulty);
                run.put("score", score);
                if (replayed != null) {
                    run.put("accuracy", replayed.accuracy());
                    run.put("maxCombo", replayed.maxCombo());
                    run.put("grade", RunReplay.gradeFor(replayed.accuracy(), "F".equals(body.path("grade").asString(""))));
                    run.put("rules", "score");
                } else {
                    run.set("accuracy", body.path("accuracy"));
                    run.set("maxCombo", body.path("maxCombo"));
                    run.set("grade", body.path("grade"));
                }
                run.put("at", Instant.now().toString());
            }
            return song.deepCopy();
        });
    }

    /**
     * The chart the run was played on: the song as the model has it, its Queue of Notes for the
     * difficulty (empty when it has none). Null when the model can't take a stored song (one from
     * an older format): its runs are counted unchecked, as before.
     */
    private static Queue<Note> chartOf(ObjectNode song, Difficulty level) {
        try {
            Queue<Note> chart = SongWriter.chartFor(SongModel.of(song), level);
            return chart != null ? chart : new Queue<>();
        } catch (IllegalArgumentException e) {
            log.warn("Song {} doesn't fit the model ({}); its run is counted unchecked", song.path("id").asString(""), e.getMessage());
            return null;
        }
    }

    @GetMapping("/search")
    public Map<String, Object> search(@RequestParam(defaultValue = "") String title, @RequestParam(defaultValue = "") String artist) {
        String t = clip(title), a = clip(artist);
        return Map.of("results", store.read(all -> SongLists.search(all, t, a)));
    }

    @GetMapping("/favorites")
    public Map<String, Object> favorites(@RequestParam(defaultValue = "") String q) {
        String query = clip(q);
        return Map.of("results", store.read(all -> SongLists.favorites(all, query)));
    }

    @GetMapping("/library")
    public Map<String, Object> library() {
        return Map.of("results", store.read(SongLists::library));
    }

    private static String clip(String s) {
        return s.length() > NewSongCheck.MAX_FIELD ? s.substring(0, NewSongCheck.MAX_FIELD) : s;
    }

    private static ApiException missing() {
        return ApiException.notFound("Song not found");
    }
}
