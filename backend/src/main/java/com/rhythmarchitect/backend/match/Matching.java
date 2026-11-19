package com.rhythmarchitect.backend.match;

import java.util.List;
import java.util.regex.Matcher;
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

    private static final Pattern QUOTED = Pattern.compile("^(.+?)\\s+[\"“](.+?)[\"”]");

    /** Title and artist from a video's title and channel, the player's typed title unknown. */
    public static SongName songFromVideo(String videoTitle, String channel) {
        return songFromVideo(videoTitle, channel, "");
    }

    /**
     * Title and artist from a video's title and channel: "Artist - Title", "Title - Artist" (lyric
     * and fan channels post both), {@code Artist "Title"}, and "Artist - Topic" channels. Which side
     * of the dash is the title: the one that matches what the player typed as the title, else the
     * other side of the one that matches the channel, else the first is the artist (the usual way).
     * As match.ts songFromVideo, with the same test cases.
     */
    public static SongName songFromVideo(String videoTitle, String channel, String typedTitle) {
        String ch = channel.replaceAll("(?i)\\s*-\\s*Topic$", "").replaceAll("(?i)VEVO$", "").replaceAll("(?i)\\s*(Media|Official)$", "").trim();
        boolean topic = channel.matches("(?i).* - Topic$");
        String[] parts = videoTitle.split("\\s+[-–—|]\\s+");
        if (topic || parts.length < 2) {
            Matcher q = QUOTED.matcher(videoTitle);
            if (!topic && q.find()) return new SongName(tidy(q.group(2)), tidy(q.group(1)));
            return new SongName(tidy(videoTitle), ch);
        }
        String a = parts[0], b = String.join(" - ", List.of(parts).subList(1, parts.length));
        String want = Text.bare(typedTitle == null ? "" : typedTitle);
        if (!want.isEmpty()) {
            boolean ta = isTitle(a, want), tb = isTitle(b, want);
            if (ta && !tb) return new SongName(tidy(a), tidy(b));
            if (tb && !ta) return new SongName(tidy(b), tidy(a));
        }
        // The channel names the artist (spaces and case aside: TheWeekndVEVO is The Weeknd).
        String c = squash(ch);
        if (c.length() > 1) {
            if (squash(b).contains(c) && !squash(a).contains(c)) return new SongName(tidy(a), tidy(b));
            if (squash(a).contains(c)) return new SongName(tidy(b), tidy(a));
        }
        return new SongName(tidy(b), tidy(a));
    }

    private static final Pattern FEAT = Pattern.compile("(?i)\\s+[(\\[]?\\s*(?:ft\\.?|feat\\.?|featuring)\\s+([^()\\[\\]]+?)\\s*[)\\]]?$");
    private static final Pattern WORD_START = Pattern.compile("(^|[\\s(\\-/&])(\\p{Ll})");

    /** Typed all in lower case: each word capitalised ("blinding lights" is filed as Blinding Lights). */
    static String cased(String s) {
        String t = s.trim().replaceAll("\\s+", " ");
        if (!t.matches("(?s).*[a-z].*") || !t.equals(t.toLowerCase(java.util.Locale.ROOT))) return t;
        Matcher m = WORD_START.matcher(t);
        StringBuilder out = new StringBuilder();
        while (m.find()) m.appendReplacement(out, Matcher.quoteReplacement(m.group(1) + m.group(2).toUpperCase(java.util.Locale.ROOT)));
        m.appendTail(out);
        return out.toString();
    }

    /**
     * The name a song is filed under (VideoMatch songTitle/songArtist): the video's own wording
     * (songFromVideo: its capitals, its "(feat. …)") when it's the song the player typed, else what
     * they typed (each word capitalised when typed all in lower case). A featured artist goes with
     * the title, as "(feat. …)". As match.ts songName, with the same test cases.
     */
    public static SongName songName(String videoTitle, String channel, String typedTitle, String typedArtist) {
        String tt = typedTitle == null ? "" : typedTitle, ta = typedArtist == null ? "" : typedArtist;
        SongName guess = songFromVideo(videoTitle, channel, tt);
        String want = Text.bare(tt);
        String title = want.isEmpty() || isTitle(guess.title(), want) ? guess.title() : cased(tt);
        String wa = Text.norm(ta), ga = Text.norm(guess.artist());
        String artist = wa.isEmpty() ? guess.artist() : !ga.isEmpty() && (ga.contains(wa) || wa.contains(ga)) ? guess.artist() : cased(ta);
        String feat = "";
        Matcher inArtist = FEAT.matcher(artist);
        if (inArtist.find()) { feat = inArtist.group(1).trim(); artist = artist.substring(0, inArtist.start()).trim(); }
        Matcher inTitle = FEAT.matcher(title);
        if (inTitle.find()) { feat = inTitle.group(1).trim(); title = title.substring(0, inTitle.start()).trim(); }
        if (!feat.isEmpty()) title = title + " (feat. " + feat + ")";
        return new SongName(title, artist);
    }

    private static boolean isTitle(String side, String want) {
        String v = Text.bare(side);
        return !v.isEmpty() && (v.equals(want) || (v.length() > 2 && (v.contains(want) || want.contains(v))));
    }

    private static String squash(String s) {
        return Text.norm(s).replace(" ", "");
    }

    /** Words in a video's title that say it isn't a song, whatever else it says (unless typed). As match.ts. */
    public static final String[] NOT_A_SONG = { "reaction", "reacts", "tutorial", "how to", "lesson", "podcast", "gameplay", "walkthrough",
        "let s play", "unboxing", "full album", "compilation", "playlist", "hours", "1 hour", "livestream", "live stream", "asmr", "prank",
        "speedrun", "stream highlights" };
    /** Words that say it probably isn't, unless something marks it as music. */
    public static final String[] MAYBE_NOT_A_SONG = { "review", "interview", "vlog", "trailer", "teaser", "documentary", "explained",
        "breakdown", "behind the scenes", "highlights", "episode", "meme", "analysis", "news", "podcast clip" };
    private static final Pattern MUSIC_SIGNS = Pattern.compile(
        "\\b(official (music )?video|official audio|official lyric video|lyric video|lyrics|visuali[sz]er|audio|ft|feat|prod)\\b");
    /** YouTube's Music category. */
    public static final String MUSIC_CATEGORY = "10";
    public static final int SONG_MIN_SECONDS = 45;
    public static final int SONG_MAX_SECONDS = 900;

    private static boolean has(String t, String w) {
        return Pattern.compile("\\b" + w + "\\b").matcher(t).find();
    }

    private static String what(String w) {
        return w.equals("hours") || w.equals("1 hour") ? "long loop" : w.equals("let s play") ? "let's play" : w.replaceAll("s$", "");
    }

    /**
     * Why a video isn't a song, or null when it is one (match.ts notSongReason): a title that says
     * it's something else (unless typed), a length outside 45 s to 15 min, or nothing marking it as
     * music (the Music category, a Topic or VEVO channel, a song upload's title) with a title like
     * a review or the news, or the category known and not Music.
     *
     * @param seconds    its length, or null if unknown
     * @param categoryId YouTube's category, or null if unknown
     * @param typed      what the player typed (title and artist)
     */
    public static String notSongReason(String videoTitle, String channel, Integer seconds, String categoryId, String typed) {
        String t = Text.norm(videoTitle), ch = Text.norm(channel), asked = Text.norm(typed == null ? "" : typed);
        for (String w : NOT_A_SONG) {
            if (has(t, w) && !asked.contains(w)) return "it looks like a " + what(w) + " video, not a song";
        }
        if (seconds != null && seconds > 0) {
            if (seconds < SONG_MIN_SECONDS) return "it's only " + seconds + " seconds long";
            if (seconds > SONG_MAX_SECONDS) return "it's " + Math.round(seconds / 60.0) + " minutes long (a song is under " + SONG_MAX_SECONDS / 60 + ")";
        }
        boolean channelSays = ch.endsWith(" topic") || ch.endsWith("vevo");
        boolean titleSays = MUSIC_SIGNS.matcher(t).find() || Pattern.compile("\\s[-–|]\\s").matcher(videoTitle).find();
        boolean music = MUSIC_CATEGORY.equals(categoryId) || channelSays || titleSays;
        if (!music) {
            for (String w : MAYBE_NOT_A_SONG) {
                if (has(t, w) && !asked.contains(w)) return "it looks like a " + what(w) + " video, not a song";
            }
            if (categoryId != null) return "YouTube doesn't list it as music";
        }
        return null;
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
