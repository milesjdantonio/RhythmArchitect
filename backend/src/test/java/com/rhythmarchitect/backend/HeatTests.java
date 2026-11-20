package com.rhythmarchitect.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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

import com.rhythmarchitect.backend.songs.TileHeat;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Where players miss (TileHeat): each checked run's tiles, one letter per tile in chart order,
 * counted into the song's "heat" per difficulty; tiles that don't fit the chart or the run are
 * ignored (the score still counts); new charts forget it.
 */
@SpringBootTest
@AutoConfigureMockMvc
class HeatTests {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @DynamicPropertySource
    static void store(DynamicPropertyRegistry r) throws Exception {
        Path dir = Files.createTempDirectory("rythm-heat");
        r.add("rythm.songs-file", () -> dir.resolve("songs.json").toString());
        r.add("rythm.youtube.api-key", () -> "");
    }

    @Autowired
    MockMvc mvc;

    private static ObjectNode song(int tiles) {
        ObjectNode s = JSON.createObjectNode();
        var notes = s.putObject("charts").putObject("hard").putArray("notes");
        for (int i = 0; i < tiles; i++) notes.addObject().put("t", i).put("lane", i % 4);
        return s;
    }

    @Test
    void countsWhereEachRunReachedAndMissed() {
        ObjectNode s = song(4);
        assertTrue(TileHeat.add(s, "hard", "PMG-", "PMG"));
        assertTrue(TileHeat.add(s, "hard", "MMPP", "PPMH500;M"));
        JsonNode h = s.path("heat").path("hard");
        assertEquals(2, h.path("runs").asInt());
        assertEquals("[2,2,2,1]", h.path("seen").toString());
        assertEquals("[1,2,0,0]", h.path("miss").toString());
    }

    @Test
    void tilesThatDoNotFitAreIgnored() {
        ObjectNode s = song(4);
        assertFalse(TileHeat.add(s, "hard", "PMG", "PMG"), "one letter per tile");
        assertFalse(TileHeat.add(s, "hard", "PPPP", "PPPM"), "the run's judgements");
        assertFalse(TileHeat.add(s, "hard", "PZPP", "PPP"), "letters it knows");
        assertFalse(TileHeat.add(s, "easy", "P", "P"), "a chart it has");
        assertTrue(s.path("heat").isMissingNode());
        TileHeat.add(s, "hard", "PPPP", "PPPP");
        TileHeat.clear(s);
        assertTrue(s.path("heat").isMissingNode());
    }

    @Test
    void aCheckedRunWithItsTilesHeatsTheSong() throws Exception {
        String id = "demo-neon-blueprint";
        JsonNode song = JSON.readTree(mvc.perform(get("/api/songs/" + id)).andReturn().getResponse().getContentAsString());
        int n = song.path("charts").path("hard").path("notes").size();
        // The run of ApiTests: 15 tiles judged (one missed), the rest never reached.
        String run = "PPPPPPPPPPGEH1500;MLBP";
        String tiles = "PPPPPPPPPPGEMLP" + "-".repeat(n - 15);
        String body = "{\"difficulty\":\"hard\",\"score\":1,\"accuracy\":1,\"maxCombo\":1,\"grade\":\"S\",\"run\":\"%s\",\"tiles\":\"%s\"}";
        mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON).content(body.formatted(run, tiles)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.heat.hard.runs").value(1))
            .andExpect(jsonPath("$.heat.hard.miss[12]").value(1))
            .andExpect(jsonPath("$.heat.hard.seen[15]").value(0));
        // Tiles that don't fit: the score still counts, the heat doesn't move.
        mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON).content(body.formatted(run, "PPP")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.heat.hard.runs").value(1));
    }
}
