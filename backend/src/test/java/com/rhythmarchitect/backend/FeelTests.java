package com.rhythmarchitect.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.rhythmarchitect.backend.songs.PlayController;
import com.rhythmarchitect.backend.songs.RunFeel;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * How a run felt (RunFeel): counts per difficulty, only from a run whose score the controller
 * kept, once a run; answers it doesn't know are refused without using up the run's say.
 */
@SpringBootTest
@AutoConfigureMockMvc
class FeelTests {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @DynamicPropertySource
    static void store(DynamicPropertyRegistry r) throws Exception {
        Path dir = Files.createTempDirectory("rythm-feel");
        r.add("rythm.songs-file", () -> dir.resolve("songs.json").toString());
        r.add("rythm.youtube.api-key", () -> "");
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    PlayController play;

    private static ObjectNode song() {
        ObjectNode s = JSON.createObjectNode();
        s.putObject("charts").putObject("hard").putArray("notes").addObject().put("t", 0).put("lane", 0);
        return s;
    }

    private static JsonNode list(String json) {
        return JSON.readTree(json);
    }

    @Test
    void countsRightOffAndWhy() {
        ObjectNode s = song();
        assertTrue(RunFeel.add(s, "hard", "right", JSON.missingNode()));
        assertTrue(RunFeel.add(s, "hard", "off", list("[\"notes\",\"hard\",\"notes\"]")));
        JsonNode f = s.path("feel").path("hard");
        assertEquals(1, f.path("right").asInt());
        assertEquals(1, f.path("off").asInt());
        assertEquals(1, f.path("notes").asInt(), "a reason counts once a run");
        assertEquals(1, f.path("hard").asInt());
        assertFalse(f.has("timing"));
    }

    @Test
    void answersItDoesNotKnowAreRefused() {
        ObjectNode s = song();
        assertFalse(RunFeel.add(s, "hard", "great", JSON.missingNode()));
        assertFalse(RunFeel.add(s, "hard", "off", list("[\"boring\"]")));
        assertFalse(RunFeel.add(s, "hard", "right", list("[\"notes\"]")), "a reason only when off");
        assertFalse(RunFeel.add(s, "hard", "off", list("\"notes\"")));
        assertFalse(RunFeel.add(s, "easy", "right", JSON.missingNode()), "a chart it has");
        assertTrue(s.path("feel").isMissingNode());
        RunFeel.add(s, "hard", "right", JSON.missingNode());
        RunFeel.clear(s);
        assertTrue(s.path("feel").isMissingNode());
    }

    @Test
    void onlyAKeptRunSaysOnce() throws Exception {
        String id = "demo-neon-blueprint";
        String score = "{\"difficulty\":\"hard\",\"score\":1,\"accuracy\":1,\"maxCombo\":1,\"grade\":\"S\",\"run\":\"PPPPPPPPPPGEH1500;MLBP\"}";
        String body = Reviewed.play(mvc, play, id, score);
        String runId = JsonPath.read(body, "$.play");
        String feel = "{\"difficulty\":\"hard\",\"play\":\"%s\",\"feel\":\"%s\",\"why\":%s}";
        // Not kept yet: its score hasn't been sent.
        mvc.perform(post("/api/songs/" + id + "/feel").contentType(MediaType.APPLICATION_JSON).content(feel.formatted(runId, "off", "[\"timing\"]")))
            .andExpect(status().isUnprocessableEntity());
        mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk());
        // A bad answer is refused and leaves the run its say.
        mvc.perform(post("/api/songs/" + id + "/feel").contentType(MediaType.APPLICATION_JSON).content(feel.formatted(runId, "off", "[\"boring\"]")))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/songs/" + id + "/feel").contentType(MediaType.APPLICATION_JSON).content(feel.formatted(runId, "off", "[\"timing\"]")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.feel.hard.off").value(1))
            .andExpect(jsonPath("$.feel.hard.timing").value(1));
        mvc.perform(post("/api/songs/" + id + "/feel").contentType(MediaType.APPLICATION_JSON).content(feel.formatted(runId, "right", "[]")))
            .andExpect(status().isConflict());
        mvc.perform(post("/api/songs/" + id + "/feel").contentType(MediaType.APPLICATION_JSON).content(feel.formatted("nope", "right", "[]")))
            .andExpect(status().isUnprocessableEntity());
    }
}
