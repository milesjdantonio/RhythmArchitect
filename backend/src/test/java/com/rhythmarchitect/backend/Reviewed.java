package com.rhythmarchitect.backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.rhythmarchitect.backend.songs.PlayController;
import com.rhythmarchitect.backend.songs.SongModel;

import main.Difficulty;
import main.Note;
import main.Queue;
import main.SongWriter;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * A score as the game sends it after a real run: the run played through the controller first
 * (POST /api/play, then its inputs: a press on each note the run hit, in its lane at its time,
 * and the run itself), so the scores route finds it reviewed (PlayController.keep). The
 * controller's clock runs a minute on at every read, so the run is never ahead of real time.
 */
final class Reviewed {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final AtomicLong NOW = new AtomicLong(1_000_000_000L);

    private Reviewed() {
    }

    /** The score body with `play` added: the id of the run the controller reviewed. */
    static String play(MockMvc mvc, PlayController play, String songId, String body) throws Exception {
        play.clock(() -> NOW.addAndGet(60_000));
        ObjectNode b = (ObjectNode) JSON.readTree(body);
        String difficulty = b.path("difficulty").asString("");
        String run = b.path("run").isString() ? b.path("run").asString() : "";
        Difficulty level = SongModel.difficulty(difficulty);
        if (level == null) return body;
        var started = mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON)
            .content("{\"songId\":\"" + songId + "\",\"difficulty\":\"" + difficulty + "\"}")).andReturn().getResponse();
        if (started.getStatus() != 201) return body;
        String runId = JsonPath.read(started.getContentAsString(), "$.run");
        String song = mvc.perform(get("/api/songs/" + songId)).andReturn().getResponse().getContentAsString();
        Queue<Note> chart = SongWriter.chartFor(SongModel.of(JSON.readTree(song)), level);

        int hits = 0, strays = 0;
        for (int i = 0; i < run.length(); i++) {
            char c = run.charAt(i);
            if (c == 'H') while (i < run.length() && run.charAt(i) != ';') i++;
            else if ("PGEL".indexOf(c) >= 0) hits++;
            else if (c == 'X') strays++;
        }
        List<ObjectNode> inputs = new ArrayList<>();
        double last = 0;
        for (int i = 0; i < hits && !chart.isEmpty(); i++) {
            Note n = chart.dequeue();
            last = n.getTimeStamp();
            inputs.add(JSON.createObjectNode().put("lane", n.getLane()).put("time", last));
        }
        for (int i = 0; i < strays; i++) inputs.add(JSON.createObjectNode().put("lane", 0).put("time", last + 1 + i * 0.1));
        for (int from = 0; from == 0 || from < inputs.size(); from += 400) {
            ObjectNode call = JSON.createObjectNode();
            ArrayNode list = call.putArray("inputs");
            inputs.subList(from, Math.min(inputs.size(), from + 400)).forEach(list::add);
            if (from == 0) call.put("run", run);
            mvc.perform(post("/api/play/" + runId + "/inputs").contentType(MediaType.APPLICATION_JSON).content(call.toString()));
        }
        b.put("play", runId);
        return b.toString();
    }
}
