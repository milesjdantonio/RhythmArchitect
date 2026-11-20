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
 * model's Score and queue come back; bad input is turned down without a crash. The review
 * (InputReview) decides what reaches Main and whether a run's score may be kept.
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

    @Autowired
    com.rhythmarchitect.backend.songs.PlayController play;

    @org.junit.jupiter.api.BeforeEach
    void realClock() {
        play.clock(System::currentTimeMillis);
    }

    private org.springframework.test.web.servlet.ResultActions score(String body) throws Exception {
        return mvc.perform(post("/api/songs/demo-neon-blueprint/scores").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    @Test
    void aScoreIsKeptOnlyFromARunTheControllerReviewedAndPassedOnce() throws Exception {
        String body = "{\"difficulty\":\"easy\",\"score\":1,\"accuracy\":1,\"maxCombo\":1,\"grade\":\"S\",\"run\":\"PP\"}";
        // Never played through the controller (or a made-up run id): turned down.
        score(body).andExpect(status().is(422));
        score(body.replace("}", ",\"play\":\"made-up\"}")).andExpect(status().is(422));
        // Played through it: kept, once.
        String reviewed = Reviewed.play(mvc, play, "demo-neon-blueprint", body);
        score(reviewed).andExpect(status().isOk()).andExpect(jsonPath("$.best.easy.score").value(2000));
        score(reviewed).andExpect(status().is(409));
        // A different run than the one the controller confirmed: turned down.
        String other = Reviewed.play(mvc, play, "demo-neon-blueprint", body);
        score(other.replace("\"PP\"", "\"PPP\"")).andExpect(status().is(422));
        play.clock(System::currentTimeMillis);
        // Twelve Perfects claimed with no press sent: flagged, and not kept.
        String run = JsonPath.read(start("demo-neon-blueprint", "easy"), "$.run");
        send(run, "[{\"time\":0}], \"run\": \"PPPPPPPPPPPP\"")
            .andExpect(jsonPath("$.state.review.passed").value(false))
            .andExpect(jsonPath("$.state.review.flags[0].check").value("unpressed hits"));
        score(body.replace("\"PP\"", "\"PPPPPPPPPPPP\"").replace("}", ",\"play\":\"" + run + "\"}"))
            .andExpect(status().is(422))
            .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("unpressed hits")));
    }

    @Test
    void oneClientCanStartOnlySoManyRuns() throws Exception {
        play.clock(() -> 5_000_000L);
        String start = "{\"songId\":\"demo-neon-blueprint\",\"difficulty\":\"easy\"}";
        for (int i = 0; i < 30; i++) {
            mvc.perform(post("/api/play").header("X-Forwarded-For", "203.0.113.9").contentType(MediaType.APPLICATION_JSON).content(start))
                .andExpect(status().isCreated());
        }
        mvc.perform(post("/api/play").header("X-Forwarded-For", "203.0.113.9").contentType(MediaType.APPLICATION_JSON).content(start))
            .andExpect(status().is(429));
        // What a client writes in front of the address doesn't make it someone else...
        mvc.perform(post("/api/play").header("X-Forwarded-For", "198.51.100.1, 203.0.113.9").contentType(MediaType.APPLICATION_JSON).content(start))
            .andExpect(status().is(429));
        // ...and another client isn't held up by it.
        mvc.perform(post("/api/play").header("X-Forwarded-For", "203.0.113.10").contentType(MediaType.APPLICATION_JSON).content(start))
            .andExpect(status().isCreated());
        // A song id that isn't one: turned down before the bank is read.
        mvc.perform(post("/api/play").contentType(MediaType.APPLICATION_JSON).content("{\"songId\":\"../../etc\",\"difficulty\":\"easy\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void aRunSendingInputsFasterThanTheGameIsHeldUp() throws Exception {
        play.clock(() -> 7_000_000L);
        String run = JsonPath.read(start("demo-neon-blueprint", "easy"), "$.run");
        for (int i = 0; i < 20; i++) send(run, "[]").andExpect(status().isOk());
        send(run, "[]").andExpect(status().is(429));
    }

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
        // Long after the song: the review turns it down (nothing that late is a song's clock).
        send(run, "[{\"time\":100000}]")
            .andExpect(jsonPath("$.state.misses").value(0))
            .andExpect(jsonPath("$.state.review.passed").value(false))
            .andExpect(jsonPath("$.state.review.flags[0].check").value("past the end"));
        // Just after the last note: every note went by unplayed.
        String song = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/songs/demo-neon-blueprint")).andReturn().getResponse().getContentAsString();
        main.Queue<main.Note> chart = main.SongWriter.chartFor(com.rhythmarchitect.backend.songs.SongModel.of(tools.jackson.databind.json.JsonMapper.builder().build().readTree(song)), main.Difficulty.EASY);
        double last = 0;
        while (!chart.isEmpty()) last = Math.max(last, chart.dequeue().getTimeStamp());
        send(run, "[{\"time\":" + (last + 1) + "}]")
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
