package com.rhythmarchitect.backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
 * Charts made again on a newer difficulty ladder (PUT /api/songs/:id/charts): kept only when every
 * tile is one of the song's Ultra's; a changed difficulty loses its best score.
 */
@SpringBootTest
@AutoConfigureMockMvc
class RechartTests {

    static Path dir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        dir = Files.createTempDirectory("rythm-rechart-test");
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

    static final String ULTRA = "[{\"t\":0,\"lane\":1,\"pitch\":\"C4\",\"len\":0.25},{\"t\":1,\"lane\":2,\"pitch\":\"E4\",\"len\":2,\"hold\":true},"
        + "{\"t\":1,\"lane\":0,\"pitch\":\"C4\",\"len\":0.25},{\"t\":4,\"lane\":3,\"pitch\":\"G4\",\"len\":0.25}]";
    static final String TAP_AT_0 = "[{\"t\":0,\"lane\":1,\"pitch\":\"C4\",\"len\":0.25}]";

    private static String chart(String d, String notes) {
        return "{\"difficulty\":\"" + d + "\",\"lanes\":4,\"notes\":" + notes + "}";
    }

    private static String charts(String easy, String medium, String hard, String ultra) {
        return "{\"easy\":" + chart("easy", easy) + ",\"medium\":" + chart("medium", medium) + ",\"hard\":" + chart("hard", hard) + ",\"ultra\":" + chart("ultra", ultra) + "}";
    }

    private String oldSong() throws Exception {
        String song = """
            {"title":"Old Map","artist":"Tester","prompt":"Old Map","bpm":120,"meter":4,"key":"C","scale":"Minor","mood":"x",
             "lengthBeats":16,"hues":[10,90],
             "source":{"kind":"youtube","videoId":"dQw4w9WgXcQ","offset":0.5,"chart":"listened"},
             "report":{"mapper":"Ensomi R2 trained mapper (r2-1.0, 2★), listening pass","confidence":0.9,"sections":[{"label":"Intro","beat":0}],"energy":[0.5]},
             "charts":%s}""".formatted(charts(ULTRA, ULTRA, ULTRA, ULTRA));
        String body = mvc.perform(post("/api/songs").contentType(MediaType.APPLICATION_JSON).content(song))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");
        // A best score on Easy and on Ultra.
        for (String d : new String[] { "easy", "ultra" }) {
            mvc.perform(post("/api/songs/" + id + "/scores").contentType(MediaType.APPLICATION_JSON)
                .content("{\"difficulty\":\"" + d + "\",\"score\":1000,\"accuracy\":1,\"maxCombo\":1,\"grade\":\"S\",\"run\":\"P\"}"))
                .andExpect(status().isOk());
        }
        return id;
    }

    private org.springframework.test.web.servlet.ResultActions rechart(String id, String charts, int ladder) throws Exception {
        return mvc.perform(put("/api/songs/" + id + "/charts").contentType(MediaType.APPLICATION_JSON)
            .content("{\"ladder\":" + ladder + ",\"charts\":" + charts + "}"));
    }

    @Test
    void chartsMadeAgainFromUltraAreKeptAndAChangedDifficultyLosesItsBest() throws Exception {
        String id = oldSong();
        // Easy keeps one tap; Medium the hold as a tap; Hard and Ultra unchanged.
        String asTap = "[{\"t\":1,\"lane\":2,\"pitch\":\"E4\",\"len\":0.25}]";
        rechart(id, charts(TAP_AT_0, asTap, ULTRA, ULTRA), 2)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.report.ladder").value(2))
            .andExpect(jsonPath("$.charts.easy.notes.length()").value(1))
            .andExpect(jsonPath("$.charts.medium.notes[0].hold").doesNotExist())
            .andExpect(jsonPath("$.charts.ultra.notes.length()").value(4))
            .andExpect(jsonPath("$.best.easy").doesNotExist())
            .andExpect(jsonPath("$.best.ultra.score").value(1000));
        // Once is enough: the same ladder again is turned down.
        rechart(id, charts(TAP_AT_0, TAP_AT_0, TAP_AT_0, TAP_AT_0), 2).andExpect(status().isBadRequest());
    }

    @Test
    void chartsMadeAgainCanOnlyLeaveTilesOut() throws Exception {
        String id = oldSong();
        String added = "[{\"t\":2,\"lane\":1,\"pitch\":\"C4\",\"len\":0.25}]";
        String longer = "[{\"t\":1,\"lane\":2,\"pitch\":\"E4\",\"len\":3,\"hold\":true}]";
        String tapMadeHold = "[{\"t\":0,\"lane\":1,\"pitch\":\"C4\",\"len\":0.25,\"hold\":true}]";
        for (String bad : new String[] { added, longer, tapMadeHold }) {
            rechart(id, charts(bad, TAP_AT_0, TAP_AT_0, TAP_AT_0), 2)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
        }
        // A missing difficulty, no ladder, an old ladder, an unknown song.
        mvc.perform(put("/api/songs/" + id + "/charts").contentType(MediaType.APPLICATION_JSON)
            .content("{\"ladder\":2,\"charts\":{\"easy\":" + chart("easy", TAP_AT_0) + "}}")).andExpect(status().isBadRequest());
        mvc.perform(put("/api/songs/" + id + "/charts").contentType(MediaType.APPLICATION_JSON)
            .content("{\"charts\":" + charts(TAP_AT_0, TAP_AT_0, TAP_AT_0, TAP_AT_0) + "}")).andExpect(status().isBadRequest());
        rechart(id, charts(TAP_AT_0, TAP_AT_0, TAP_AT_0, TAP_AT_0), 1).andExpect(status().isBadRequest());
        rechart("no-such-song", charts(TAP_AT_0, TAP_AT_0, TAP_AT_0, TAP_AT_0), 2).andExpect(status().isNotFound());
    }
}
