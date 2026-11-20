package com.rhythmarchitect.backend.songs;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The song bank: a JSON file ({@code { "songs": [...] }}, the same shape as the mock's
 * .data/songs.json), seeded with the built-in songs the first time. Songs are kept as JSON trees,
 * so every field of the Song type (frontend/src/api/types.ts) survives as the app sent it.
 *
 * With Supabase set up ({@link SupabaseSongs}: SUPABASE_URL and SUPABASE_SERVICE_KEY, see
 * docs/supabase.md) the bank lives in its table instead, so it outlives the server's disk. The
 * first time (an empty table) it takes in what the JSON file has, or the built-in songs. If
 * Supabase can't be reached (or refuses), the JSON file is used meanwhile and Supabase is tried
 * again every {@link #RETRY_MS}; once it answers, the songs kept in the file meanwhile are added to
 * it. What went wrong is kept for {@code /api/health} ({@link #status}) and the log.
 *
 * All access goes through {@link #read} and {@link #write}, one at a time.
 */
@Component
public class SongStore {

    private static final Logger log = LoggerFactory.getLogger(SongStore.class);
    /** How often Supabase is tried again while the file stands in for it. */
    static final long RETRY_MS = 60_000;
    private long retryMs = RETRY_MS;

    private final ObjectMapper json;
    private final Path file;
    private final SupabaseSongs supabase;
    /** The bank is in Supabase right now (set up, and it answered). */
    private volatile boolean remote;
    private List<ObjectNode> songs;
    /** What last went wrong with Supabase (null when nothing), and when to try it again. */
    private volatile String problem;
    private long retryAt;
    private volatile boolean loaded;

    public SongStore(ObjectMapper json, @Value("${rythm.songs-file}") String file, SupabaseSongs supabase) {
        this.json = json;
        this.file = Path.of(file).toAbsolutePath();
        this.supabase = supabase;
    }

    /** Tests: how soon Supabase is tried again while the file stands in (RETRY_MS normally). */
    public synchronized void retryAfter(long ms) {
        retryMs = ms;
        retryAt = Math.min(retryAt, System.currentTimeMillis() + ms);
    }

    /** Where the bank is kept: "supabase" or "file". */
    public synchronized String storage() {
        load();
        return remote ? "supabase" : "file";
    }

    /**
     * Where the bank is and what went wrong, without waiting for anything (for /api/health):
     * storage is "supabase", "file" or "starting" (not read yet); database is "not set up",
     * "connected" or "failing" (with the problem, in words; never the key).
     */
    public Map<String, Object> status() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("storage", !loaded ? "starting" : remote ? "supabase" : "file");
        String wrong = supabase.settingsProblem();
        String p = problem != null ? problem : wrong;
        out.put("database", !supabase.enabled() ? "not set up" : p != null ? "failing" : remote ? "connected" : "starting");
        if (supabase.enabled() && p != null) out.put("problem", p);
        return out;
    }

    /**
     * Once the server is up, the bank is read in the background (the file, or Supabase over the
     * network), so the first visitor doesn't wait for it. The server is ready before this ends.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void warm() {
        Thread.ofVirtual().name("song-bank-warm").start(() -> {
            try {
                read(List::size);
            } catch (RuntimeException e) {
                log.warn("Couldn't read the song bank ahead of time; the first request will try again", e);
            }
        });
    }

    /** Reads the bank (a copy-free view: don't change what you get, use {@link #write}). */
    public synchronized <T> T read(Function<List<ObjectNode>, T> fn) {
        return fn.apply(load());
    }

    /** Changes the bank and saves it. */
    public synchronized <T> T write(Function<List<ObjectNode>, T> fn) {
        T out = fn.apply(load());
        save();
        return out;
    }

    public Optional<ObjectNode> find(List<ObjectNode> all, String id) {
        return all.stream().filter(s -> id.equals(s.path("id").asString(""))).findFirst();
    }

    /** Files a new song: an id, a date, no scores yet. Newest first. */
    public ObjectNode add(ObjectNode body) {
        return write(all -> {
            ObjectNode song = body.deepCopy();
            String videoId = body.path("source").path("videoId").asString("");
            String base = (videoId.isEmpty() ? body.path("title").asString("song") : videoId)
                .toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-");
            if (base.length() > 24) base = base.substring(0, 24);
            song.put("id", "yt-" + base + "-" + Long.toString(System.currentTimeMillis(), 36));
            song.put("createdAt", Instant.now().toString());
            song.set("best", json.createObjectNode());
            song.put("plays", 0);
            song.put("favorite", false);
            all.addFirst(song);
            return song;
        });
    }

    private List<ObjectNode> load() {
        if (songs != null) {
            // Standing in for Supabase: try it again now and then, bringing what the file has.
            if (!remote && supabase.enabled() && System.currentTimeMillis() >= retryAt) loadRemote(songs);
            return songs;
        }
        loaded = true;
        if (supabase.enabled() && loadRemote(null)) return songs;
        try {
            if (Files.exists(file)) {
                songs = parse(Files.readString(file));
                if (refreshBuiltIns()) save();
            } else {
                try (InputStream in = new ClassPathResource("seed/songs.json").getInputStream()) {
                    songs = parse(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
                }
                save();
                log.info("Started the song bank at {} with {} built-in songs", file, songs.size());
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (RuntimeException e) {
            log.warn("Couldn't read the song bank at {}; starting empty", file, e);
            songs = new ArrayList<>();
        }
        return songs;
    }

    /**
     * The bank from Supabase (filled from the JSON file or the seed the first time). `carry`: the
     * songs the file kept while Supabase was out, added to it (the ones it doesn't have). False if
     * it can't be reached or refuses: the file carries on, and it's tried again after RETRY_MS.
     */
    private boolean loadRemote(List<ObjectNode> carry) {
        try {
            List<ObjectNode> rows = supabase.load();
            List<ObjectNode> next;
            if (rows.isEmpty()) {
                next = carry != null ? carry : Files.exists(file) ? parse(Files.readString(file)) : seed();
                supabase.save(next);
                log.info("Started the song bank in Supabase at {} with {} songs", supabase.describe(), next.size());
            } else {
                next = rows;
                boolean added = false;
                if (carry != null) {
                    Set<String> have = new HashSet<>();
                    rows.forEach(r -> have.add(r.path("id").asString("")));
                    for (int i = carry.size() - 1; i >= 0; i--) {
                        ObjectNode s = carry.get(i);
                        // Not the built-ins: the file got those from the seed while Supabase was
                        // out, and one missing from Supabase was deleted there (it stays deleted).
                        if (s.path("builtIn").asBoolean(false)) continue;
                        if (!have.contains(s.path("id").asString(""))) { next.addFirst(s); added = true; }
                    }
                }
                List<ObjectNode> before = songs;
                songs = next;
                boolean refreshed = refreshBuiltIns();
                songs = before;
                if (added || refreshed) supabase.save(next);
                log.info("Read {} songs from Supabase at {}", next.size(), supabase.describe());
            }
            songs = next;
            remote = true;
            problem = null;
            return true;
        } catch (IOException | RuntimeException e) {
            remote = false;
            if (carry == null) songs = null;
            problem = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            retryAt = System.currentTimeMillis() + retryMs;
            log.warn("The song bank in Supabase at {} isn't working ({}); using the JSON file {} meanwhile", supabase.describe(), problem, file);
            return false;
        }
    }

    private List<ObjectNode> seed() throws IOException {
        try (InputStream in = new ClassPathResource("seed/songs.json").getInputStream()) {
            return parse(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
        }
    }

    /**
     * Built-in songs saved before Ultra (three charts) get the seed's four; their best scores move
     * with their charts (the old Medium is Easy, the old Hard is Ultra). True when any changed.
     */
    private boolean refreshBuiltIns() throws IOException {
        if (songs.stream().noneMatch(s -> s.path("builtIn").asBoolean(false) && !s.path("charts").has("ultra"))) return false;
        List<ObjectNode> seed;
        try (InputStream in = new ClassPathResource("seed/songs.json").getInputStream()) {
            seed = parse(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
        }
        boolean changed = false;
        for (ObjectNode s : songs) {
            if (!s.path("builtIn").asBoolean(false) || s.path("charts").has("ultra")) continue;
            for (ObjectNode fresh : seed) {
                if (!fresh.path("id").asString("").equals(s.path("id").asString())) continue;
                s.set("charts", fresh.get("charts"));
                TileHeat.clear(s);
                ObjectNode best = json.createObjectNode();
                if (s.path("best").has("medium")) best.set("easy", s.path("best").get("medium"));
                if (s.path("best").has("hard")) best.set("ultra", s.path("best").get("hard"));
                s.set("best", best);
                changed = true;
            }
        }
        return changed;
    }

    private List<ObjectNode> parse(String text) {
        List<ObjectNode> out = new ArrayList<>();
        JsonNode list = json.readTree(text).path("songs");
        for (JsonNode s : list) if (s instanceof ObjectNode o) out.add(o);
        return out;
    }

    private void save() {
        if (remote) {
            try {
                supabase.save(songs);
                problem = null;
            } catch (IOException e) {
                problem = e.getMessage();
                log.warn("Couldn't save to the song bank in Supabase: {}", problem);
                throw new UncheckedIOException(e);
            }
            return;
        }
        try {
            Files.createDirectories(file.getParent());
            ObjectNode root = json.createObjectNode();
            ArrayNode list = root.putArray("songs");
            songs.forEach(list::add);
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, json.writerWithDefaultPrettyPrinter().writeValueAsString(root));
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
