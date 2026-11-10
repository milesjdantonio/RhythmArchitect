package com.rhythmarchitect.backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;

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

/** The routes of docs/api.md against a fresh song bank (the three built-in songs). */
@SpringBootTest
@AutoConfigureMockMvc
class ApiTests {

    static Path dir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        dir = Files.createTempDirectory("rythm-test");
        r.add("rythm.songs-file", () -> dir.resolve("songs.json").toString());
        r.add("rythm.anthropic.api-key", () -> "");
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

    @Test
    void libraryIsAtoZ() throws Exception {
        mvc.perform(get("/api/library"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[*].title").value(contains("Ink and Fury", "Neon Blueprint", "One Dance (feat. WizKid & Kyla)", "The Restless Stacks")))
            .andExpect(jsonPath("$.results[0].charts").doesNotExist())
            .andExpect(jsonPath("$.results[0].tiles.hard").isNumber());
    }

    @Test
    void searchMatchesEveryFilledField() throws Exception {
        mvc.perform(get("/api/search").param("title", "ink").param("artist", ""))
            .andExpect(jsonPath("$.results", hasSize(1)))
            .andExpect(jsonPath("$.results[0].title").value("Ink and Fury"));
        mvc.perform(get("/api/search").param("title", "ink").param("artist", "nobody"))
            .andExpect(jsonPath("$.results", hasSize(0)));
        mvc.perform(get("/api/search").param("title", "RESTLÉSS"))
            .andExpect(jsonPath("$.results[0].title").value("The Restless Stacks"));
    }

    @Test
    void favouritesAndScores() throws Exception {
        String id = "builtin-ink-and-fury";
        mvc.perform(patch("/api/songs/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"favorite\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.favorite").value(true));
        mvc.perform(get("/api/favorites").param("q", "fury"))
            .andExpect(jsonPath("$.results[0].id").value(id));

        String run = "{\"difficulty\":\"hard\",\"score\":%d,\"accuracy\":0.9,\"maxCombo\":40,\"grade\":\"A\"}";
        mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON).content(run.formatted(5000)))
            .andExpect(jsonPath("$.best.hard.score").value(5000));
        mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON).content(run.formatted(100)))
            .andExpect(jsonPath("$.best.hard.score").value(5000))
            .andExpect(jsonPath("$.plays").value(2));
        mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON).content("{\"difficulty\":\"expert\",\"score\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Bad score"));
    }

    @Test
    void songLifecycle() throws Exception {
        mvc.perform(post("/api/songs").contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());

        String notes = "[{\"t\":0,\"lane\":1,\"pitch\":\"C4\",\"len\":0.25},{\"t\":1,\"lane\":2,\"pitch\":\"E4\",\"len\":2,\"hold\":true}]";
        String chart = "{\"difficulty\":\"%s\",\"lanes\":4,\"notes\":" + notes + "}";
        String song = """
            {"title":"Test Song","artist":"Tester","prompt":"Test Song","bpm":120,"meter":4,"key":"C","scale":"Minor","mood":"x",
             "lengthBeats":16,"hues":[10,90],
             "source":{"kind":"youtube","videoId":"dQw4w9WgXcQ","offset":0.5,"chart":"listened"},
             "report":{"mapper":"test","confidence":0.9,"sections":[{"label":"Intro","beat":0}],"energy":[0.5]},
             "charts":{"easy":%s,"medium":%s,"hard":%s}}""".formatted(chart.formatted("easy"), chart.formatted("medium"), chart.formatted("hard"));
        String body = mvc.perform(post("/api/songs").contentType(MediaType.APPLICATION_JSON).content(song))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(startsWith("yt-dqw4w9wgxcq-")))
            .andExpect(jsonPath("$.plays").value(0))
            .andReturn().getResponse().getContentAsString();
        String id = body.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        mvc.perform(patch("/api/songs/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"offset\":0.6255}"))
            .andExpect(jsonPath("$.source.offset").value(0.626));
        mvc.perform(get("/api/songs/" + id)).andExpect(jsonPath("$.charts.hard.notes", hasSize(2)));
        mvc.perform(delete("/api/songs/" + id)).andExpect(status().isNoContent());
        mvc.perform(get("/api/songs/" + id)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("Song not found"));
    }

    @Test
    void chartWithoutAKeyIs501() throws Exception {
        mvc.perform(post("/api/chart").contentType(MediaType.APPLICATION_JSON).content("{\"version\":1}"))
            .andExpect(status().isNotImplemented())
            .andExpect(jsonPath("$.error").value("This server has no AI charter."));
    }

    @Test
    void youtubeNeedsATitleAndAKeyToSearch() throws Exception {
        mvc.perform(get("/api/youtube").param("title", " ")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/youtube").param("title", "Mr. Brightside").param("artist", "The Killers"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value(startsWith("Finding songs on YouTube by name needs")));
    }

    @Test
    void unknownRoutes() throws Exception {
        mvc.perform(get("/api/nothing")).andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("No such route"));
    }
}
