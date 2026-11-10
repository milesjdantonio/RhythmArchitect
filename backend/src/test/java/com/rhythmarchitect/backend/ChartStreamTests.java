package com.rhythmarchitect.backend;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Consumer;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import main.SongMapper;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * POST /api/chart through Spring, with a stand-in SongMapper (no Claude): the plain answer, the
 * streamed one (progress lines, then the plan), and a failure part-way through the stream.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ChartStreamTests {

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        Path dir = Files.createTempDirectory("rythm-chart-test");
        r.add("rythm.songs-file", () -> dir.resolve("songs.json").toString());
    }

    @Autowired
    MockMvc mvc;

    @MockitoBean
    SongMapper mapper;

    static final String REQUEST = """
        {"version":1,"song":{"title":"T","artist":"A","videoId":"%s","seconds":10},
         "timing":{"bpm":120,"offset":0,"meter":4,"lengthBeats":16,"confidence":1},
         "events":[{"id":0,"t":0,"len":1}],"rules":{"lanes":4,"maxNotesPerSound":2,"minHoldBeats":1}}""";

    static ObjectNode plan() {
        ObjectNode p = JsonMapper.builder().build().createObjectNode().put("mapper", "Stand-in");
        p.putObject("charts").putArray("easy").addObject().put("id", 0).put("lane", 1);
        return p;
    }

    @SuppressWarnings("unchecked")
    void charterAnswers() {
        when(mapper.isEnabled()).thenReturn(true);
        when(mapper.plan(any())).thenReturn(plan());
        when(mapper.plan(any(), any())).thenAnswer(inv -> {
            Consumer<SongMapper.Progress> on = inv.getArgument(1);
            on.accept(new SongMapper.Progress("easy", 0, 2, 0));
            on.accept(new SongMapper.Progress("easy", 2, 2, 14));
            return plan();
        });
    }

    @Test
    void plainAnswerIsThePlan() throws Exception {
        charterAnswers();
        MvcResult started = mvc.perform(post("/api/chart").contentType(MediaType.APPLICATION_JSON).content(REQUEST.formatted("plainvideo1")))
            .andExpect(request().asyncStarted()).andReturn();
        mvc.perform(asyncDispatch(started))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.mapper").value("Stand-in"));
    }

    @Test
    void streamedAnswerSendsProgressThenThePlan() throws Exception {
        charterAnswers();
        MvcResult started = mvc.perform(post("/api/chart").contentType(MediaType.APPLICATION_JSON)
                .header("Accept", "application/x-ndjson, application/json").content(REQUEST.formatted("streamvideo")))
            .andExpect(request().asyncStarted()).andReturn();
        MvcResult done = mvc.perform(asyncDispatch(started))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("application/x-ndjson"))
            .andReturn();
        String[] lines = done.getResponse().getContentAsString().trim().split("\n");
        org.junit.jupiter.api.Assertions.assertEquals(3, lines.length);
        org.junit.jupiter.api.Assertions.assertTrue(lines[0].contains("\"progress\"") && lines[0].contains("\"done\":0"));
        org.junit.jupiter.api.Assertions.assertTrue(lines[1].contains("\"tiles\":14"));
        org.junit.jupiter.api.Assertions.assertTrue(lines[2].startsWith("{\"plan\":") && lines[2].contains("Stand-in"));
    }

    @Test
    void aFailurePartWayIsAnErrorLine() throws Exception {
        when(mapper.isEnabled()).thenReturn(true);
        when(mapper.plan(any(), any())).thenThrow(new SongMapper.MapperException(503, "The AI charter is busy. Try again in a minute."));
        MvcResult started = mvc.perform(post("/api/chart").contentType(MediaType.APPLICATION_JSON)
                .header("Accept", "application/x-ndjson").content(REQUEST.formatted("failvideo01")))
            .andExpect(request().asyncStarted()).andReturn();
        mvc.perform(asyncDispatch(started))
            .andExpect(content().string(containsString("{\"error\":\"The AI charter is busy. Try again in a minute.\",\"status\":503}")));
    }
}
