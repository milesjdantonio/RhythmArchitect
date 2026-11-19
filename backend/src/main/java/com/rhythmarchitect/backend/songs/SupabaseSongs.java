package com.rhythmarchitect.backend.songs;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The song bank in a Supabase (Postgres) table, so songs and scores outlive the server's disk.
 * Used by {@link SongStore} when {@code SUPABASE_URL} and {@code SUPABASE_SERVICE_KEY} are set
 * (see docs/supabase.md); otherwise the bank stays a JSON file.
 *
 * <p>One row per song (the layout in DATABASE.md): its id, title, artist and when it was added,
 * the song as the app sent it ({@code song_data}, jsonb, every field kept) and a sort key (newest
 * first). It goes through Supabase's REST API (PostgREST) with the
 * service key, which stays on the server: the browser never talks to Supabase. No libraries:
 * Java's own HTTP client.</p>
 *
 * <p>Saving sends only what changed since the bank was loaded or last saved: songs whose JSON
 * differs are upserted, songs no longer in the bank are deleted. A save that fails is tried again
 * with the next one (what was sent is only marked saved once Supabase took it).</p>
 */
@Component
public class SupabaseSongs {

    /**
     * Rows per request when loading; songs per upsert, and the most bytes one upsert carries (a
     * song is up to a few hundred KB: charts, the loudness curve).
     */
    static final int PAGE = 500;
    static final int BATCH = 25;
    static final int BATCH_BYTES = 900_000;

    private final ObjectMapper json;
    private final String base;
    private final String key;
    private final String table;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    /** What Supabase holds, as far as this server knows: id → the song's JSON text. */
    private final Map<String, String> saved = new HashMap<>();

    public SupabaseSongs(ObjectMapper json,
                         @Value("${rythm.supabase.url:}") String url,
                         @Value("${rythm.supabase.key:}") String key,
                         @Value("${rythm.supabase.table:songs}") String table) {
        this.json = json;
        // The project URL (https://<ref>.supabase.co), also when pasted with /rest/v1 on the end.
        this.base = url == null ? "" : url.trim().replaceAll("/+$", "").replaceAll("(?i)/rest/v1$", "");
        this.key = key == null ? "" : key.trim();
        this.table = table == null || table.isBlank() ? "songs" : table.trim();
    }

    /** Whether Supabase is set up (a URL and a key). */
    public boolean enabled() {
        return !base.isEmpty() && !key.isEmpty();
    }

    /** Where the bank is, for the log (no key). */
    public String describe() {
        return base + " (table " + table + ")";
    }

    /**
     * What is wrong with the settings, before trying them (null if nothing that can be seen):
     * the publishable or anon key can't read or write the table (Row Level Security lets only
     * the secret key through), and the URL must be the project's API URL.
     */
    public String settingsProblem() {
        if (!enabled()) return null;
        if (!base.matches("(?i)https?://[^/]+")) {
            return "SUPABASE_URL should be the project URL, like https://abcdefgh.supabase.co (Project Settings → Data API), not " + base;
        }
        if (key.startsWith("sb_publishable_") || "anon".equals(jwtRole(key))) {
            return "SUPABASE_SERVICE_KEY is the publishable (anon) key; the server needs the secret key "
                + "(sb_secret_..., or the legacy service_role key) from Project Settings → API Keys";
        }
        return null;
    }

    /** The role in a legacy JWT key (anon, service_role), or null. */
    private static String jwtRole(String k) {
        String[] parts = k.split("\\.");
        if (!k.startsWith("eyJ") || parts.length < 2) return null;
        try {
            String payload = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"role\"\\s*:\\s*\"([^\"]+)\"").matcher(payload);
            return m.find() ? m.group(1) : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Every song, newest first. */
    public synchronized List<ObjectNode> load() throws IOException {
        String wrong = settingsProblem();
        if (wrong != null) throw new IOException(wrong);
        List<ObjectNode> out = new ArrayList<>();
        saved.clear();
        for (int offset = 0; ; offset += PAGE) {
            JsonNode rows = json.readTree(send(request("?select=id,song_data&order=sort_key.desc,id.asc&limit=" + PAGE + "&offset=" + offset).GET()));
            for (JsonNode row : rows) {
                if (row.path("song_data") instanceof ObjectNode song) {
                    out.add(song);
                    saved.put(row.path("id").asString(""), song.toString());
                }
            }
            if (rows.size() < PAGE) break;
        }
        return out;
    }

    /** Saves the bank: what changed is upserted, what is gone is deleted. */
    public synchronized void save(List<ObjectNode> songs) throws IOException {
        Map<String, String> now = new HashMap<>();
        List<ObjectNode> changed = new ArrayList<>();
        for (int i = 0; i < songs.size(); i++) {
            ObjectNode s = songs.get(i);
            String id = s.path("id").asString("");
            if (id.isEmpty()) continue;
            String text = s.toString();
            now.put(id, text);
            if (!text.equals(saved.get(id))) changed.add(row(s, i, songs.size()));
        }
        // In batches of at most BATCH songs and about BATCH_BYTES (one large song goes alone).
        int i = 0;
        while (i < changed.size()) {
            ArrayNode batch = json.createArrayNode();
            int bytes = 0;
            while (i < changed.size() && batch.size() < BATCH) {
                int size = changed.get(i).toString().length();
                if (batch.size() > 0 && bytes + size > BATCH_BYTES) break;
                batch.add(changed.get(i++));
                bytes += size;
            }
            send(request("?on_conflict=id")
                .header("Prefer", "resolution=merge-duplicates,return=minimal")
                .POST(HttpRequest.BodyPublishers.ofString(batch.toString(), StandardCharsets.UTF_8)));
            for (JsonNode r : batch) saved.put(r.path("id").asString(), now.get(r.path("id").asString()));
        }
        Set<String> gone = new HashSet<>(saved.keySet());
        gone.removeAll(now.keySet());
        if (!gone.isEmpty()) {
            String ids = gone.stream().map(id -> "\"" + id.replace("\"", "") + "\"").collect(Collectors.joining(","));
            send(request("?id=in.(" + java.net.URLEncoder.encode(ids, StandardCharsets.UTF_8) + ")")
                .header("Prefer", "return=minimal")
                .DELETE());
            gone.forEach(saved::remove);
        }
    }

    /**
     * A song as a row. The sort key keeps the bank's order: songs added here are newest first by
     * when they were added; songs without a date (the built-ins) follow, in the order they're in.
     */
    private ObjectNode row(ObjectNode song, int index, int size) {
        ObjectNode r = json.createObjectNode();
        r.put("id", song.path("id").asString());
        r.put("title", song.path("title").asString(""));
        r.put("artist", song.path("artist").asString(""));
        r.set("song_data", song);
        long key = -(index + 1);
        String created = song.path("createdAt").asString("");
        if (!created.isEmpty() && !song.path("builtIn").asBoolean(false)) {
            try {
                key = Instant.parse(created).toEpochMilli();
            } catch (RuntimeException ignored) {
                // Not a date: keep its place in the list.
            }
        }
        r.put("sort_key", key);
        // Every row has the same columns: PostgREST refuses a batch whose rows don't (PGRST102).
        if (created.isEmpty()) r.putNull("created_at");
        else r.put("created_at", created);
        r.put("updated_at", Instant.now().toString());
        return r;
    }

    /**
     * A request to the table. Supabase's newer secret keys (sb_secret_...) go in the apikey header
     * only; the older service_role key is a JWT and goes in Authorization as well.
     */
    private HttpRequest.Builder request(String query) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + "/rest/v1/" + table + query))
            .timeout(Duration.ofSeconds(30))
            .header("apikey", key)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json");
        if (key.startsWith("eyJ")) b.header("Authorization", "Bearer " + key);
        return b;
    }

    /** Supabase's error, in words that say what to do (and its own message, cut short). */
    static String explain(int status, String body) {
        String b = body.length() > 300 ? body.substring(0, 300) : body;
        String why;
        if (b.contains("PGRST205") || b.contains("42P01") || (status == 404 && b.contains("relation"))) {
            why = "the songs table isn't there: run docs/supabase.sql in the project's SQL Editor";
        } else if (b.contains("42501") || b.contains("permission denied")) {
            why = "the key can't use the songs table: run the grant lines in docs/supabase.sql, and check the key is the secret one";
        } else if (b.contains("row-level security")) {
            why = "Row Level Security refused it: the key must be the secret (service) key, not the publishable one";
        } else if (status == 401 || status == 403) {
            why = "Supabase refused the key: SUPABASE_SERVICE_KEY must be the project's secret key";
        } else if (status == 413) {
            why = "a request was too large for Supabase";
        } else {
            why = "Supabase answered " + status;
        }
        return why + " (" + status + ": " + b + ")";
    }

    private String send(HttpRequest.Builder req) throws IOException {
        try {
            HttpResponse<String> res = client.send(req.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() / 100 != 2) {
                String body = res.body() == null ? "" : res.body();
                throw new IOException(explain(res.statusCode(), body));
            }
            return res.body() == null || res.body().isEmpty() ? "[]" : res.body();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted talking to Supabase", e);
        } catch (java.net.ConnectException | java.net.http.HttpConnectTimeoutException e) {
            throw new IOException("Couldn't connect to Supabase at " + base + ": check SUPABASE_URL (" + e.getClass().getSimpleName() + ")", e);
        }
    }
}
