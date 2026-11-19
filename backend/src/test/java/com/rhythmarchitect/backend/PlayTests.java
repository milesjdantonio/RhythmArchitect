package com.rhythmarchitect.backend;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;

/**
 * Playing through the controller (main.Main) over the API: key presses and the clock go in, the
 * model's Score and queue come back; bad input is turned down without a crash.
 */
@SpringBootTest
@AutoConfigureMockMvc
class PlayTests {

    static Path dir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        dir = Files.createTempDirectory("rythm-play-test");
        r.add("rythm.songs-file", () -> dir.resolve("songs.json").toString());
        r.add("rythm.youtube.api-key", () -> "");
    }

    @AfterAll
    static void clean() throws Exception {
        try (var files = Files.walk(dir)) {
            files.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        }
    }

    @Autowired
    MockMvc mvc;

    private String start(String song, String difficulty) throws Exception {
        String body = mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON)
                .content("{\"songId\":\"" + song + "\",\"difficulty\":\"" + difficulty + "\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.state.score").value(0))
            .andExpect(jsonPath("$.state.upcoming", hasSize(4)))
            .andReturn().getResponse().getContentAsString();
        return body;
    }

    /** `inputs`: the list, and anything after it in the body (e.g. `, "run": "PP"`). */
    private org.springframework.test.web.servlet.ResultActions send(String run, String inputs) throws Exception {
        return mvc.perform(post("/api/play/" + run + "/inputs").contentType(MediaType.APPLICATION_JSON).content("{\"inputs\":" + inputs + "}"));
    }

    @Test
    void aPressOnTheNextNoteIsAPerfectInMainsScore() throws Exception {
        String started = start("demo-neon-blueprint", "easy");
        String run = JsonPath.read(started, "$.run");
        int notes = JsonPath.read(started, "$.notes");
        int lane = JsonPath.read(started, "$.state.upcoming[0].lane");
        double time = ((Number) JsonPath.read(started, "$.state.upcoming[0].time")).doubleValue();
        send(run, "[{\"lane\":" + lane + ",\"time\":" + (time + 0.02) + "}]")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0]").value("PERFECT"))
            .andExpect(jsonPath("$.state.score").value(100))
            .andExpect(jsonPath("$.state.combo").value(1))
            .andExpect(jsonPath("$.state.hits").value(1))
            .andExpect(jsonPath("$.state.left").value(notes - 1));
    }

    @Test
    void theRunIsConfirmedThroughGameScoreAsTheGameCountsIt() throws Exception {
        String run = JsonPath.read(start("demo-neon-blueprint", "easy"), "$.run");
        // Before any of it: nothing confirmed yet, nothing reviewed.
        send(run, "[]").andExpect(jsonPath("$.state.confirmed.score").value(0)).andExpect(jsonPath("$.state.reviewed").value(0));
        // Three Perfects and a Good, sent in two parts: 1000 + 1000 + 1000 + 750 (Score's points x10, x1).
        send(run, "[{\"lane\":0,\"time\":0}], \"run\": \"PP\"").andExpect(jsonPath("$.state.confirmed.score").value(2000)).andExpect(jsonPath("$.state.reviewed").value(1));
        send(run, "[], \"run\": \"PG\"").andExpect(jsonPath("$.state.confirmed.score").value(3750)).andExpect(jsonPath("$.state.confirmed.maxCombo").value(4));
        // A run the chart couldn't have given (more tiles than Easy has) is refused, for good.
        send(run, "[], \"run\": \"" + "P".repeat(500) + "\"").andExpect(jsonPath("$.state.confirmed").value(org.hamcrest.Matchers.nullValue()));
        send(run, "[], \"run\": \"P\"").andExpect(jsonPath("$.state.confirmed").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void theClockPassingMissesWhatWasNotPlayed() throws Exception {
        String started = start("demo-neon-blueprint", "easy");
        String run = JsonPath.read(started, "$.run");
        int notes = JsonPath.read(started, "$.notes");
        // Long after the song: every note went by unplayed.
        send(run, "[{\"time\":100000}]")
            .andExpect(jsonPath("$.results", hasSize(0)))
            .andExpect(jsonPath("$.state.misses").value(notes))
            .andExpect(jsonPath("$.state.left").value(0))
            .andExpect(jsonPath("$.state.accuracy").value(closeTo(0.0, 1e-9)));
    }

    @Test
    void practiceRunsOnlyTheStretchThroughSongGetChartBetween() throws Exception {
        int whole = JsonPath.read(start("demo-neon-blueprint", "easy"), "$.notes");
        String part = mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON)
                .content("{\"songId\":\"demo-neon-blueprint\",\"difficulty\":\"easy\",\"from\":4,\"to\":12}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        int notes = JsonPath.read(part, "$.notes");
        double first = ((Number) JsonPath.read(part, "$.state.upcoming[0].time")).doubleValue();
        org.junit.jupiter.api.Assertions.assertTrue(notes > 0 && notes < whole, notes + " of " + whole);
        org.junit.jupiter.api.Assertions.assertTrue(first >= 4 && first < 12, "first note at " + first);
        // A stretch that ends before it starts, or with no numbers: turned down, no crash.
        for (String bad : new String[] { "\"from\":12,\"to\":4", "\"from\":\"x\",\"to\":4" }) {
            mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"songId\":\"demo-neon-blueprint\",\"difficulty\":\"easy\"," + bad + "}"))
                .andExpect(status().isBadRequest());
        }
    }

    @Test
    void badInputIsTurnedDownWithoutACrash() throws Exception {
        String run = JsonPath.read(start("demo-neon-blueprint", "easy"), "$.run");
        // A lane out of range, a negative time, a lane that isn't a number, a time that isn't one:
        // Main answers null for each, and nothing is counted.
        send(run, "[{\"lane\":7,\"time\":1},{\"lane\":0,\"time\":-3},{\"lane\":\"x\",\"time\":1},{\"lane\":1,\"time\":\"soon\"},{\"time\":null}]")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results", hasSize(4)))
            .andExpect(jsonPath("$.results[0]").doesNotExist())
            .andExpect(jsonPath("$.state.score").value(0))
            .andExpect(jsonPath("$.state.misses").value(0));
        send(run, "{\"not\":\"a list\"}").andExpect(status().isBadRequest());
        send("no-such-run", "[]").andExpect(status().isNotFound());
        mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON).content("{\"songId\":\"nope\",\"difficulty\":\"easy\"}"))
            .andExpect(status().isNotFound());
        mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON).content("{\"songId\":\"demo-neon-blueprint\",\"difficulty\":\"banana\"}"))
            .andExpect(status().isBadRequest());
    }
}
