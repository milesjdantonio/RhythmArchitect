package com.rhythmarchitect.backend.match;

import java.util.List;
import java.util.regex.Pattern;

/**
 * How the backend decides which YouTube video and which osu! chart are the song asked for.
 * Pure functions, a port of frontend/mock-server/match.ts.
 */
public final class Matching {

    private Matching() {
    }

    public record SongName(String title, String artist) {
    }

    private static final Pattern JUNK = Pattern.compile(
        "(?i)\\b(official\\s+(music\\s+)?video|official\\s+audio|official\\s+lyric\\s+video|lyric(s)?\\s+video|lyrics?|audio|visuali[sz]er|hd|hq|4k|explicit|clean)\\b");
    private static final Pattern JUNK_BRACKETS = Pattern.compile(
        "(?i)[(\\[][^)\\]]*(official|audio|video|lyric|visuali|explicit|hd|hq)[^)\\]]*[)\\]]");

    static String tidy(String s) {
        String t = JUNK_BRACKETS.matcher(s).replaceAll("");
        t = JUNK.matcher(t).replaceAll("");
        return t.replaceAll("\\s{2,}", " ").replaceAll("[\\s\\-–|]+$", "").trim();
    }

    /** Title and artist from a video's title and channel ("Artist - Title", "Title - Artist", "Artist - Topic"). */
    public static SongName songFromVideo(String videoTitle, String channel) {
        String ch = channel.replaceAll("(?i)\\s*-\\s*Topic$", "").replaceAll("(?i)VEVO$", "").replaceAll("(?i)\\s*Media$", "").trim();
        String[] parts = videoTitle.split("\\s+[-–|]\\s+");
        if (channel.matches("(?i).* - Topic$") || parts.length < 2) return new SongName(tidy(videoTitle), ch);
        String a = parts[0], b = parts[1];
        if (!Text.norm(ch).isEmpty() && Text.norm(b).contains(Text.norm(ch))) return new SongName(tidy(a), tidy(b));
        return new SongName(tidy(String.join(" - ", List.of(parts).subList(1, parts.length))), tidy(a));
    }

    private static final String[] NOT_THE_SONG = { "live", "cover", "remix", "sped up", "slowed", "reverb", "nightcore", "8d",
        "karaoke", "instrumental", "hour", "loop", "reaction", "tutorial", "acoustic", "mashup" };

    /** How likely a search result is the song itself, as released (not a live take, cover or edit). */
    public static double videoScore(String videoTitle, String channel, Integer seconds, String title, String artist) {
        String t = Text.norm(videoTitle), ch = Text.norm(channel);
        String typed = Text.norm(title + " " + artist);
        double s = 0;
        String want = Text.bare(title);
        if (!want.isEmpty() && t.contains(want)) s += 3;
        if (!artist.isEmpty() && (ch.contains(Text.norm(artist)) || t.contains(Text.norm(artist)))) s += 2;
        if (ch.endsWith(" topic")) s += 3;
        if (t.contains("official audio")) s += 2.5;
        else if (Pattern.compile("\\baudio\\b").matcher(t).find()) s += 1;
        if (Pattern.compile("official (music )?video").matcher(t).find()) s -= 0.5; // music videos often add intros and skits
        for (String bad : NOT_THE_SONG) {
            if (Pattern.compile("\\b" + bad + "\\b").matcher(t).find() && !typed.contains(bad)) s -= 4;
        }
        if (seconds != null && (seconds < 60 || seconds > 600)) s -= 3;
        return s;
    }

    public record OsuBeatmap(int id, int mode, double cs, String version, double difficultyRating, int totalLength) {
    }

    public record OsuSet(int id, String title, String artist, String creator, String status, long playCount, List<OsuBeatmap> beatmaps) {
    }

    private static final String[] CUTS = { "tv size", "cut ver", "short ver", "sped up", "speed up", "nightcore", "remix", "edit",
        "extended", "bootleg", "cover" };

    /** How good a beatmap set is as this song's chart. Below 0: not this song. */
    public static double setScore(OsuSet set, List<OsuBeatmap> maps, String title, String artist, Integer seconds) {
        String t = Text.bare(set.title()), want = Text.bare(title);
        if (want.isEmpty() || !(t.equals(want) || t.startsWith(want) || want.startsWith(t) || t.contains(want))) return -1;
        String a = Text.norm(set.artist());
        if (!artist.isEmpty() && !(a.contains(Text.norm(artist)) || Text.norm(artist).contains(a) || Text.norm(set.title()).contains(Text.norm(artist)))) {
            return -1;
        }
        double s = t.equals(want) ? 3 : 1.5;
        if (List.of("ranked", "loved", "approved", "qualified").contains(set.status())) s += 2;
        s += Math.log10(1 + Math.max(0, set.playCount())) * 0.6;
        s += Math.min(2, maps.size() * 0.4);
        String typed = Text.norm(title + " " + artist);
        StringBuilder label = new StringBuilder(set.title());
        for (OsuBeatmap m : maps) label.append(' ').append(m.version());
        String lab = Text.norm(label.toString());
        for (String cut : CUTS) if (lab.contains(cut) && !typed.contains(cut)) s -= 3;
        int len = maps.stream().mapToInt(OsuBeatmap::totalLength).max().orElse(0);
        if (seconds != null && seconds > 0 && len > 0) {
            // A chart of a shorter cut won't line up with the full song.
            if (len > seconds + 5) return -1;
            if (seconds - len > 45) s -= 4;
            else if (seconds - len > 20) s -= 1.5;
        }
        return s;
    }
}
