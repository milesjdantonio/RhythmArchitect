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
 * All access goes through {@link #read} and {@link #write}, one at a time.
 */
@Component
public class SongStore {

    private static final Logger log = LoggerFactory.getLogger(SongStore.class);

    private final ObjectMapper json;
    private final Path file;
    private List<ObjectNode> songs;

    public SongStore(ObjectMapper json, @Value("${rythm.songs-file}") String file) {
        this.json = json;
        this.file = Path.of(file).toAbsolutePath();
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
        try {
            if (Files.exists(file)) {
                songs = parse(Files.readString(file));
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

    private List<ObjectNode> parse(String text) {
        List<ObjectNode> out = new ArrayList<>();
        JsonNode list = json.readTree(text).path("songs");
        for (JsonNode s : list) if (s instanceof ObjectNode o) out.add(o);
        return out;
    }

    private void save() {
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
