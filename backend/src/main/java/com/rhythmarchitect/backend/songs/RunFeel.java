package com.rhythmarchitect.backend.songs;

import java.util.List;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * How a chart felt to the players who finished a run on it: after a run the results screen asks
 * once, "felt right" or "felt off", and when off why (the notes didn't match the song, the timing
 * was off, too hard, too easy). Kept in the song as "feel" ({ difficulty: { right, off, notes,
 * timing, hard, easy } }), counts only, from runs the controller reviewed and kept
 * (PlayController.rate: each run once); cleared when the charts change, as the heat is.
 * tools/heat-report.mjs sums them over the bank beside where players miss.
 */
public final class RunFeel {
    /** The reasons a run can be "off" for, as the game sends them. */
    public static final List<String> WHY = List.of("notes", "timing", "hard", "easy");

    private RunFeel() {
    }

    /**
     * Counts one answer for `difficulty`: `feel` "right" or "off", `why` (only with "off") a list of
     * WHY's names. False (nothing counted) when it isn't one of those, or the song has no such chart.
     */
    public static boolean add(ObjectNode song, String difficulty, String feel, JsonNode why) {
        if (song.path("charts").path(difficulty).path("notes").size() == 0) return false;
        boolean off = "off".equals(feel);
        if (!off && !"right".equals(feel)) return false;
        if (!why.isMissingNode() && !why.isNull() && !why.isArray()) return false;
        if (why.isArray()) {
            if (!off && why.size() > 0) return false;
            if (why.size() > WHY.size()) return false;
            for (JsonNode w : why) if (!w.isString() || !WHY.contains(w.asString())) return false;
        }
        ObjectNode all = song.path("feel") instanceof ObjectNode f ? f : song.putObject("feel");
        ObjectNode d = all.path(difficulty) instanceof ObjectNode o ? o : all.putObject(difficulty);
        bump(d, off ? "off" : "right");
        if (why.isArray()) {
            java.util.Set<String> seen = new java.util.HashSet<>();
            for (JsonNode w : why) if (seen.add(w.asString())) bump(d, w.asString());
        }
        return true;
    }

    /** Forgets every difficulty's answers (the charts changed: they were about other tiles). */
    public static void clear(ObjectNode song) {
        song.remove("feel");
    }

    private static void bump(ObjectNode d, String name) {
        d.put(name, d.path(name).asInt(0) + 1);
    }
}
