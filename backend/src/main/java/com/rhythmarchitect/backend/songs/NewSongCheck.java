package com.rhythmarchitect.backend.songs;

import com.rhythmarchitect.backend.match.Text;

import tools.jackson.databind.JsonNode;

/** What's wrong with a song the browser mapped (POST /api/songs), or null if it can be saved. */
public final class NewSongCheck {

    private NewSongCheck() {
    }

    static final int MAX_FIELD = 120;

    public static String problem(JsonNode b) {
        if (b == null || !b.isObject()) return "Expected a song";
        JsonNode title = b.path("title");
        if (!title.isString() || title.asString().isBlank() || title.asString().length() > MAX_FIELD) return "The song needs a title";
        JsonNode artist = b.path("artist");
        if (!artist.isString() || artist.asString().length() > MAX_FIELD) return "Bad artist";
        if (!finite(b.path("bpm")) || b.path("bpm").asDouble() < 20 || b.path("bpm").asDouble() > 400) return "Bad tempo";
        if (!finite(b.path("lengthBeats")) || b.path("lengthBeats").asDouble() <= 0) return "Bad length";
        JsonNode src = b.path("source");
        if (!"youtube".equals(src.path("kind").asString("")) || !Text.isVideoId(src.path("videoId").asString(null))) {
            return "Only songs that play from YouTube can be added this way";
        }
        if (src.has("offset") && !finite(src.path("offset"))) return "Bad offset";
        for (String d : new String[] { "easy", "medium", "hard" }) {
            JsonNode c = b.path("charts").path(d);
            if (c.path("lanes").asInt(0) != 4 || !c.path("notes").isArray()) return "Missing the " + d + " chart";
            for (JsonNode n : c.path("notes")) {
                JsonNode lane = n.path("lane");
                if (!finite(n.path("t")) || !lane.isIntegralNumber() || lane.asInt() < 0 || lane.asInt() > 3 || !finite(n.path("len"))) {
                    return "A bad tile in the " + d + " chart";
                }
            }
        }
        if (b.path("charts").path("hard").path("notes").isEmpty()) return "The map has no tiles";
        JsonNode report = b.path("report");
        if (!report.path("sections").isArray() || !report.path("energy").isArray()) return "Missing the map report";
        return null;
    }

    static boolean finite(JsonNode n) {
        return n.isNumber() && Double.isFinite(n.asDouble());
    }
}
