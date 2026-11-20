package com.rhythmarchitect.backend.songs;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Where players miss: for each difficulty of a song, how many runs were counted, and for each of
 * its tiles (in chart order) how often a run reached it and how often it was missed. Kept in the
 * song as "heat" ({ difficulty: { runs, seen: [..], miss: [..] } }), from the runs the server has
 * checked (POST /api/songs/:id/scores with `run` and `tiles`); cleared when the charts change. A
 * tile missed far more than the tiles around it is a spot the chart asks too much (tools/heat-report.mjs
 * sums them over the bank by pattern, to tune the mapper; the dev tools show a song's).
 */
public final class TileHeat {
    /** One letter per tile: how it was judged (P G E L M), or "-" when the run never reached it. */
    private static final Pattern TILES = Pattern.compile("[PGELM-]*");
    private static final Pattern TOKEN = Pattern.compile("[PGELMBOXU]|H\\d+;");

    private TileHeat() {
    }

    /**
     * Adds one run's tiles to the song's heat for `difficulty`. False (nothing added) when they
     * don't fit: not one letter per tile of the chart, or not the same judgements as the run's
     * (`run`: the tokens RunReplay checked).
     */
    public static boolean add(ObjectNode song, String difficulty, String tiles, String run) {
        int n = song.path("charts").path(difficulty).path("notes").size();
        if (tiles == null || n == 0 || tiles.length() != n || !TILES.matcher(tiles).matches()) return false;
        if (run == null || !sameJudgements(tiles, run)) return false;
        ObjectNode heat = song.path("heat") instanceof ObjectNode h ? h : song.putObject("heat");
        ObjectNode d = heat.path(difficulty) instanceof ObjectNode o ? o : heat.putObject(difficulty);
        ArrayNode seen = counts(d, "seen", n), miss = counts(d, "miss", n);
        for (int i = 0; i < n; i++) {
            char c = tiles.charAt(i);
            if (c == '-') continue;
            seen.set(i, seen.get(i).asInt(0) + 1);
            if (c == 'M') miss.set(i, miss.get(i).asInt(0) + 1);
        }
        d.put("runs", d.path("runs").asInt(0) + 1);
        return true;
    }

    /** Forgets every difficulty's heat (the charts changed: their tiles are other tiles now). */
    public static void clear(ObjectNode song) {
        song.remove("heat");
    }

    /** The array `name` of `n` counts (a new one of zeros when it's missing or another length). */
    private static ArrayNode counts(ObjectNode d, String name, int n) {
        if (d.path(name) instanceof ArrayNode a && a.size() == n) return a;
        ArrayNode a = d.putArray(name);
        for (int i = 0; i < n; i++) a.add(0);
        return a;
    }

    /** The tiles' P G E L M are the run's, as many of each (the run has its holds and Overdrive besides). */
    static boolean sameJudgements(String tiles, String run) {
        int[] a = new int[5], b = new int[5];
        for (int i = 0; i < tiles.length(); i++) {
            int k = "PGELM".indexOf(tiles.charAt(i));
            if (k >= 0) a[k]++;
        }
        Matcher m = TOKEN.matcher(run);
        while (m.find()) {
            String t = m.group();
            if (t.length() != 1) continue;
            int k = "PGELM".indexOf(t.charAt(0));
            if (k >= 0) b[k]++;
        }
        return java.util.Arrays.equals(a, b);
    }

    /** The song's heat for a difficulty, or a missing node. */
    static JsonNode of(ObjectNode song, String difficulty) {
        return song.path("heat").path(difficulty);
    }
}
