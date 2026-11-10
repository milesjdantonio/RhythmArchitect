package com.rhythmarchitect.backend.chart;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.rhythmarchitect.backend.web.ApiException;

import main.SongMapper;

import jakarta.servlet.http.HttpServletRequest;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * POST /api/chart: ChartRequest (what the browser measured) in, ChartPlan out, from SongMapper
 * (src/java/main/SongMapper.java, which asks Claude). Any error makes the
 * app use its own charts, so an error never stops a song being made. Plans are cached by video and
 * request, and the endpoint is rate-limited per player: it spends money.
 */
@RestController
@RequestMapping("/api")
public class ChartController {

    private static final int MAX_BYTES = 4_000_000;
    private static final long HOUR_MS = 3_600_000;

    private final SongMapper mapper;
    private final ObjectMapper json;
    private final int perHour;
    private final Map<String, Deque<Long>> recent = new ConcurrentHashMap<>();
    private final Map<String, ObjectNode> plans = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, ObjectNode> eldest) {
            return size() > 64;
        }
    };

    public ChartController(SongMapper mapper, ObjectMapper json, @Value("${rythm.charter.per-hour}") int perHour) {
        this.mapper = mapper;
        this.json = json;
        this.perHour = perHour;
    }

    @PostMapping("/chart")
    public ObjectNode chart(@RequestBody byte[] raw, HttpServletRequest http) {
        if (!mapper.isEnabled()) throw new ApiException(501, "This server has no AI charter.");
        if (raw.length > MAX_BYTES) throw new ApiException(413, "That chart request is too large.");
        JsonNode req;
        try {
            req = json.readTree(raw);
        } catch (RuntimeException e) {
            throw ApiException.badRequest("Not a chart request.");
        }
        String problem = SongMapper.requestProblem(req);
        if (problem != null) throw ApiException.badRequest(problem);

        String key = req.path("song").path("videoId").asString("") + ":" + sha256(raw);
        synchronized (plans) {
            ObjectNode cached = plans.get(key);
            if (cached != null) return cached.deepCopy();
        }
        allow(http.getRemoteAddr());
        ObjectNode plan;
        try {
            plan = mapper.plan(req);
        } catch (SongMapper.MapperException e) {
            throw new ApiException(e.getStatus(), e.getMessage());
        }
        synchronized (plans) {
            plans.put(key, plan.deepCopy());
        }
        return plan;
    }

    private void allow(String who) {
        long now = System.currentTimeMillis();
        Deque<Long> times = recent.computeIfAbsent(who, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && now - times.peekFirst() > HOUR_MS) times.pollFirst();
            if (times.size() >= perHour) throw new ApiException(429, "You've mapped a lot of songs this hour. Try again later.");
            times.addLast(now);
        }
    }

    private static String sha256(byte[] raw) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw)).substring(0, 32);
        } catch (NoSuchAlgorithmException e) {
            return Integer.toHexString(new String(raw, StandardCharsets.UTF_8).hashCode());
        }
    }
}
