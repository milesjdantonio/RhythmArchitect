package com.rhythmarchitect.backend.songs;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import main.Difficulty;
import main.NoteType;
import main.Song;
import main.SongWriter;

import tools.jackson.databind.JsonNode;

/**
 * A song of the bank (the app's JSON, frontend/src/api/types.ts) as the game's model has it: a
 * {@link Song} written by {@link SongWriter}, with a {@code Queue} of {@code Note}s for each
 * {@link Difficulty}. The bank keeps the JSON as the app sent it; the server checks new songs and
 * finished runs through this.
 */
public final class SongModel {

    /** The artist the model is given for a song without one (a Song needs one). */
    static final String UNKNOWN_ARTIST = "Unknown artist";

    private SongModel() {
    }

    /**
     * The song as a model Song: its title, artist, tempo, length (lengthBeats) and every
     * difficulty's tiles (t and len in beats, a hold held for its len, the pitch's letter).
     *
     * @throws IllegalArgumentException when the model can't take it (SongWriter says why)
     */
    public static Song of(JsonNode song) {
        if (song == null || !song.isObject()) throw new IllegalArgumentException("Expected a song");
        String artist = song.path("artist").asString("");
        double bpm = number(song.path("bpm"));
        double beats = number(song.path("lengthBeats"));
        Map<Difficulty, List<SongWriter.Tile>> charts = new EnumMap<>(Difficulty.class);
        for (Difficulty d : Difficulty.values()) {
            List<SongWriter.Tile> tiles = new ArrayList<>();
            for (JsonNode n : song.path("charts").path(name(d)).path("notes")) {
                boolean hold = n.path("hold").asBoolean(false);
                tiles.add(new SongWriter.Tile(number(n.path("t")), n.path("lane").asInt(-1),
                    hold ? number(n.path("len")) : 0, letter(n.path("pitch").asString(""))));
            }
            charts.put(d, tiles);
        }
        return new SongWriter().writeSong(song.path("title").asString(""),
            artist.isBlank() ? UNKNOWN_ARTIST : artist, bpm, beats > 0 ? beats * 60 / bpm : 0, charts);
    }

    /** The difficulty a name stands for ("easy", "medium", "hard"), or null. */
    public static Difficulty difficulty(String name) {
        for (Difficulty d : Difficulty.values()) if (name(d).equals(name)) return d;
        return null;
    }

    /** The difficulty's name in the app's JSON: "easy", "medium" or "hard". */
    public static String name(Difficulty d) {
        return d.name().toLowerCase(Locale.ROOT);
    }

    /** A number, or NaN when it isn't one (SongWriter turns that down). */
    private static double number(JsonNode n) {
        return n.isNumber() ? n.asDouble() : Double.NaN;
    }

    /** The letter (A-G) a pitch like "C#4" starts with, or null. */
    private static NoteType letter(String pitch) {
        if (pitch.isEmpty() || pitch.charAt(0) < 'A' || pitch.charAt(0) > 'G') return null;
        return NoteType.valueOf(pitch.substring(0, 1));
    }
}
