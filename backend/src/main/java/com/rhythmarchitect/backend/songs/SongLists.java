package com.rhythmarchitect.backend.songs;

import java.util.Comparator;
import java.util.List;

import com.rhythmarchitect.backend.match.Text;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/** Search, favourites, the A to Z bank and song summaries (docs/api.md, "Search and favourites"). */
public final class SongLists {

    private SongLists() {
    }

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String[] DIFFICULTIES = { "easy", "medium", "hard" };

    static String title(JsonNode s) {
        return s.path("title").asString("");
    }

    static String artist(JsonNode s) {
        return s.path("artist").asString("");
    }

    static String createdAt(JsonNode s) {
        return s.path("createdAt").asString("");
    }

    /** A song without its charts. */
    public static ObjectNode summary(JsonNode s) {
        ObjectNode o = NODES.objectNode();
        o.put("id", s.path("id").asString(""));
        o.put("title", title(s));
        o.put("artist", artist(s));
        o.set("bpm", s.path("bpm"));
        o.set("lengthBeats", s.path("lengthBeats"));
        o.set("hues", s.path("hues"));
        ObjectNode source = o.putObject("source");
        source.put("kind", s.path("source").path("kind").asString("synth"));
        if (s.path("source").path("standIn").asBoolean(false)) source.put("standIn", true);
        ObjectNode tiles = o.putObject("tiles");
        for (String d : DIFFICULTIES) tiles.put(d, s.path("charts").path(d).path("notes").size());
        o.set("best", s.has("best") ? s.get("best") : NODES.objectNode());
        o.put("plays", s.path("plays").asInt(0));
        o.put("favorite", s.path("favorite").asBoolean(false));
        if (s.hasNonNull("cover")) o.set("cover", s.get("cover"));
        return o;
    }

    /** Mapped songs matching what the player typed, best first, at most 8. Every filled-in field must match. */
    public static List<ObjectNode> search(List<ObjectNode> songs, String title, String artist) {
        record Hit(ObjectNode song, int score) {
        }
        boolean wantTitle = !Text.norm(title).isEmpty(), wantArtist = !Text.norm(artist).isEmpty();
        return songs.stream()
            .map(s -> {
                int t = Text.match(title(s), title), a = Text.match(artist(s), artist);
                boolean ok = (!wantTitle || t > 0) && (!wantArtist || a > 0) && (t > 0 || a > 0);
                return new Hit(s, ok ? t * 2 + a : 0);
            })
            .filter(h -> h.score > 0)
            .sorted(Comparator.comparingInt(Hit::score).reversed()
                .thenComparing(h -> h.song.path("plays").asInt(0), Comparator.reverseOrder())
                .thenComparing(h -> createdAt(h.song), Comparator.reverseOrder()))
            .limit(8)
            .map(h -> summary(h.song))
            .toList();
    }

    /** The songs marked favourite, newest first; {@code q} filters by title or artist. */
    public static List<ObjectNode> favorites(List<ObjectNode> songs, String q) {
        boolean any = Text.norm(q).isEmpty();
        return songs.stream()
            .filter(s -> s.path("favorite").asBoolean(false))
            .filter(s -> any || Text.match(title(s), q) > 0 || Text.match(artist(s), q) > 0)
            .sorted(Comparator.comparing(SongLists::createdAt).reversed())
            .map(SongLists::summary)
            .toList();
    }

    /** Every mapped song, A to Z by title (then artist), case and accents ignored, numbers in order. */
    public static List<ObjectNode> library(List<ObjectNode> songs) {
        return songs.stream()
            .sorted(Comparator.comparing(SongLists::title, Text.NATURAL).thenComparing(SongLists::artist, Text.NATURAL))
            .map(SongLists::summary)
            .toList();
    }
}
