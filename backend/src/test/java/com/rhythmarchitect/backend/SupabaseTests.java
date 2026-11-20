package com.rhythmarchitect.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.rhythmarchitect.backend.songs.SongStore;
import com.rhythmarchitect.backend.songs.SupabaseSongs;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The song bank in Supabase, against a small stand-in for its REST API (PostgREST): the first run
 * fills the table, later changes send only what changed, deletions delete, the bank reads back in
 * its order, and an unreachable Supabase leaves the JSON file in charge until it comes back. As
 * strict as the real one where it matters: every row in a batch must have the same columns.
 */
class SupabaseTests {

    private final JsonMapper json = JsonMapper.builder().build();
    private HttpServer server;
    /** The table: id → row (id, title, artist, created_at, song_data, sort_key). */
    private final Map<String, ObjectNode> table = new LinkedHashMap<>();
    private final List<String> calls = new ArrayList<>();
    private String url;
    /** Supabase is out (every request: 503). */
    private volatile boolean down;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/rest/v1/songs", this::handle);
        server.start();
        url = "http://localhost:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private void handle(HttpExchange ex) throws IOException {
        String method = ex.getRequestMethod();
        String query = URLDecoder.decode(ex.getRequestURI().getRawQuery() == null ? "" : ex.getRequestURI().getRawQuery(), StandardCharsets.UTF_8);
        calls.add(method + " " + query);
        if (down) {
            reply(ex, 503, "{\"message\":\"unavailable\"}");
            return;
        }
        if (!"secret".equals(ex.getRequestHeaders().getFirst("apikey"))) {
            reply(ex, 401, "{\"message\":\"no key\"}");
            return;
        }
        switch (method) {
            case "GET" -> {
                ArrayNode out = json.createArrayNode();
                table.values().stream()
                    .sorted(Comparator.comparingLong((ObjectNode r) -> r.path("sort_key").asLong()).reversed())
                    .forEach(r -> out.add(json.createObjectNode().put("id", r.path("id").asString()).set("song_data", r.get("song_data"))));
                reply(ex, 200, out.toString());
            }
            case "POST" -> {
                JsonNode rows = json.readTree(ex.getRequestBody().readAllBytes());
                // As PostgREST: a batch's rows must all have the same columns.
                java.util.Set<String> cols = null;
                for (JsonNode r : rows) {
                    java.util.Set<String> c = new java.util.TreeSet<>(r.propertyNames());
                    if (cols != null && !cols.equals(c)) {
                        reply(ex, 400, "{\"code\":\"PGRST102\",\"message\":\"All object keys must match\"}");
                        return;
                    }
                    cols = c;
                }
                for (JsonNode r : rows) table.put(r.path("id").asString(), (ObjectNode) r);
                reply(ex, 201, "");
            }
            case "DELETE" -> {
                Matcher m = Pattern.compile("\"([^\"]+)\"").matcher(query);
                while (m.find()) table.remove(m.group(1));
                reply(ex, 204, "");
            }
            default -> reply(ex, 405, "");
        }
    }

    private static void reply(HttpExchange ex, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, b.length == 0 ? -1 : b.length);
        if (b.length > 0) ex.getResponseBody().write(b);
        ex.close();
    }

    private SongStore store(Path file, String key) {
        return new SongStore(json, file.toString(), new SupabaseSongs(json, url, key, "songs"));
    }

    private static List<String> ids(List<ObjectNode> songs) {
        return songs.stream().map(s -> s.path("id").asString()).toList();
    }

    @Test
    void fillsTheTableThenSavesOnlyWhatChanges() throws IOException {
        Path dir = Files.createTempDirectory("rythm-supabase");
        SongStore a = store(dir.resolve("songs.json"), "secret");
        List<String> builtIns = a.read(SupabaseTests::ids);
        assertEquals("supabase", a.storage());
        assertEquals(builtIns.size(), table.size(), "the built-in songs went in the first time");
        assertFalse(Files.exists(dir.resolve("songs.json")), "no file while Supabase holds the bank");

        calls.clear();
        ObjectNode added = a.add((ObjectNode) json.readTree("{\"title\":\"New\",\"artist\":\"A\",\"source\":{\"kind\":\"youtube\",\"videoId\":\"abc\"}}"));
        assertEquals(1, calls.size(), "one upsert");
        assertTrue(calls.getFirst().startsWith("POST"));
        assertEquals(1 + builtIns.size(), table.size());

        // A favourite changed on one song: only that song goes.
        calls.clear();
        boolean fav = a.read(all -> a.find(all, builtIns.getFirst()).orElseThrow().path("favorite").asBoolean(false));
        a.write(all -> a.find(all, builtIns.getFirst()).orElseThrow().put("favorite", !fav));
        assertEquals(List.of("POST on_conflict=id"), calls);

        // Deleted: deleted there too.
        calls.clear();
        a.write(all -> all.removeIf(s -> s.path("id").asString().equals(builtIns.getLast())));
        assertEquals(1, calls.size());
        assertTrue(calls.getFirst().startsWith("DELETE"));
        assertFalse(table.containsKey(builtIns.getLast()));

        // A fresh server reads the same bank, newest first, the favourite kept.
        SongStore b = store(dir.resolve("songs.json"), "secret");
        List<ObjectNode> back = b.read(all -> all);
        assertEquals(added.path("id").asString(), back.getFirst().path("id").asString());
        assertEquals(builtIns.subList(0, builtIns.size() - 1), ids(back).subList(1, back.size()));
        assertEquals(!fav, b.find(back, builtIns.getFirst()).orElseThrow().path("favorite").asBoolean(false));
    }

    @Test
    void takesInTheJsonFileTheFirstTime() throws IOException {
        Path file = Files.createTempDirectory("rythm-supabase").resolve("songs.json");
        Files.writeString(file, "{\"songs\":[{\"id\":\"mine\",\"title\":\"Mine\",\"artist\":\"Me\",\"createdAt\":\"2026-01-01T00:00:00Z\"}]}");
        SongStore s = store(file, "secret");
        assertEquals(List.of("mine"), s.read(SupabaseTests::ids));
        assertTrue(table.containsKey("mine"));
    }

    @Test
    void unreachableOrRefusedLeavesTheFileInChargeAndSaysWhy() throws IOException {
        Path file = Files.createTempDirectory("rythm-supabase").resolve("songs.json");
        SongStore s = store(file, "wrong key");
        assertEquals("file", s.storage());
        assertTrue(Files.exists(file), "the file bank started");
        assertTrue(table.isEmpty());
        Map<String, Object> st = s.status();
        assertEquals("failing", st.get("database"));
        assertTrue(String.valueOf(st.get("problem")).contains("refused the key"), String.valueOf(st.get("problem")));
    }

    @Test
    void songsWithAndWithoutADateGoInTogether() throws IOException {
        // (A batch mixing rows with and without created_at was refused, and the file took over.)
        Path file = Files.createTempDirectory("rythm-supabase").resolve("songs.json");
        Files.writeString(file, "{\"songs\":[{\"id\":\"dated\",\"title\":\"A\",\"artist\":\"B\",\"createdAt\":\"2026-01-01T00:00:00Z\"},"
            + "{\"id\":\"undated\",\"title\":\"C\",\"artist\":\"D\"}]}");
        SongStore s = store(file, "secret");
        assertEquals("supabase", s.storage());
        assertTrue(table.containsKey("dated") && table.containsKey("undated"));
        assertEquals("connected", s.status().get("database"));
    }

    @Test
    void comesBackToSupabaseAndBringsWhatTheFileKept() throws IOException {
        Path file = Files.createTempDirectory("rythm-supabase").resolve("songs.json");
        down = true;
        SongStore s = store(file, "secret");
        s.retryAfter(0);
        assertEquals("file", s.storage());
        ObjectNode added = s.add((ObjectNode) json.readTree("{\"title\":\"Meanwhile\",\"artist\":\"A\",\"source\":{\"kind\":\"youtube\",\"videoId\":\"mmm\"}}"));
        assertTrue(table.isEmpty());
        down = false;
        assertEquals("supabase", s.storage(), "tried again, and it answered");
        assertTrue(table.containsKey(added.path("id").asString()), "the song added meanwhile went up");
        assertEquals("connected", s.status().get("database"));
    }

    @Test
    void aBuiltInDeletedThereStaysDeletedWhenItComesBack() throws IOException {
        // The bank in Supabase holds one song (the built-ins were deleted). A server that boots while
        // it's out starts its file from the seed; when Supabase answers, only the songs added
        // meanwhile go up, not the seed's built-ins.
        table.put("kept", (ObjectNode) json.readTree("{\"id\":\"kept\",\"sort_key\":1,\"song_data\":{\"id\":\"kept\",\"title\":\"Kept\",\"artist\":\"A\"}}"));
        Path file = Files.createTempDirectory("rythm-supabase").resolve("songs.json");
        down = true;
        SongStore s = store(file, "secret");
        s.retryAfter(0);
        assertEquals("file", s.storage());
        boolean seeded = s.read(all -> all.stream().anyMatch(x -> x.path("builtIn").asBoolean(false)));
        assertTrue(seeded, "the file started from the seed");
        ObjectNode added = s.add((ObjectNode) json.readTree("{\"title\":\"Meanwhile\",\"artist\":\"A\",\"source\":{\"kind\":\"youtube\",\"videoId\":\"mmm\"}}"));
        down = false;
        assertEquals("supabase", s.storage());
        assertEquals(java.util.Set.of("kept", added.path("id").asString()), table.keySet(), "no built-in came back");
        assertEquals(List.of(added.path("id").asString(), "kept"), s.read(SupabaseTests::ids));
    }

    @Test
    void saysWhenTheKeyOrUrlIsTheWrongOne() {
        SupabaseSongs publishable = new SupabaseSongs(json, url, "sb_publishable_abc", "songs");
        assertTrue(publishable.settingsProblem().contains("publishable"));
        SupabaseSongs dashboard = new SupabaseSongs(json, "https://supabase.com/dashboard/project/abc", "secret", "songs");
        assertTrue(dashboard.settingsProblem().contains("project URL"));
        // The API URL pasted with /rest/v1 on the end works as it is.
        assertEquals(null, new SupabaseSongs(json, url + "/rest/v1/", "secret", "songs").settingsProblem());
        calls.clear();
        SongStore s = new SongStore(json, "unused-songs.json", publishable);
        assertTrue(String.valueOf(s.status().get("problem")).contains("publishable"));
    }
}
