package com.rhythmarchitect.backend.songs;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
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
 * Supabase can't be reached when the bank is first read, the JSON file is used for this run (and
 * the log says so).
 *
 * All access goes through {@link #read} and {@link #write}, one at a time.
 */
@Component
public class SongStore {

    private static final Logger log = LoggerFactory.getLogger(SongStore.class);

    private final ObjectMapper json;
    private final Path file;
    private final SupabaseSongs supabase;
    /** The bank is in Supabase this run (set up, and reachable when first read). */
    private boolean remote;
    private List<ObjectNode> songs;

    public SongStore(ObjectMapper json, @Value("${rythm.songs-file}") String file, SupabaseSongs supabase) {
        this.json = json;
        this.file = Path.of(file).toAbsolutePath();
        this.supabase = supabase;
    }

    /** Where the bank is kept: "supabase" or "file". */
    public synchronized String storage() {
        load();
        return remote ? "supabase" : "file";
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
        if (songs != null) return songs;
        if (supabase.enabled() && loadRemote()) return songs;
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

    /** The bank from Supabase (filled from the JSON file or the seed the first time). False if it can't be reached. */
    private boolean loadRemote() {
        try {
            List<ObjectNode> rows = supabase.load();
            remote = true;
            if (rows.isEmpty()) {
                songs = Files.exists(file) ? parse(Files.readString(file)) : seed();
                supabase.save(songs);
                log.info("Started the song bank in Supabase at {} with {} songs (from {})", supabase.describe(), songs.size(),
                    Files.exists(file) ? file : "the built-in songs");
            } else {
                songs = rows;
                if (refreshBuiltIns()) supabase.save(songs);
                log.info("Read {} songs from Supabase at {}", songs.size(), supabase.describe());
            }
            return true;
        } catch (IOException | RuntimeException e) {
            remote = false;
            songs = null;
            log.warn("Couldn't reach the song bank in Supabase at {}; using the JSON file {} for now", supabase.describe(), file, e);
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
            } catch (IOException e) {
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
