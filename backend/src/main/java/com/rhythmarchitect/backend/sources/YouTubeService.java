package com.rhythmarchitect.backend.sources;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.rhythmarchitect.backend.match.Matching;
import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.web.ApiException;

import tools.jackson.databind.JsonNode;

/**
 * Finds the YouTube videos that play a song (their audio is never fetched): the best few, for the
 * player to preview and choose from, or the best one. A search by name costs YouTube quota (about
 * 1% of a day's), so its results are kept for a while: the same search again is free.
 */
@Service
public class YouTubeService {

    /** VideoMatch (frontend/src/api/types.ts). songTitle/songArtist are what the song is filed under. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VideoMatch(String videoId, String title, String channel, String songTitle, String songArtist, Integer seconds,
        String thumbnail) {
    }

    /** How many videos a search offers. */
    static final int OFFERED = 5;
    /** How long a search's results are kept, and how many searches. */
    private static final long KEEP_MS = 6 * 60 * 60 * 1000L;
    private static final int KEEP_MAX = 300;

    private record Kept(long at, List<VideoMatch> videos) {
    }

    private final Map<String, Kept> kept = new ConcurrentHashMap<>();
    private final Http http;
    private final String apiKey;

    public YouTubeService(Http http, @Value("${rythm.youtube.api-key:}") String apiKey) {
        this.http = http;
        this.apiKey = apiKey;
    }

    /** The video that plays the song: the best of {@link #findAll}. */
    public VideoMatch find(String title, String artist) {
        return findAll(title, artist).get(0);
    }

    /**
     * The videos that play the song, best first (at most {@link #OFFERED}; never empty): every one
     * a song that can be played outside YouTube. A pasted link is just that video.
     */
    public List<VideoMatch> findAll(String title, String artist) {
        String pasted = Text.videoIdIn(title);
        if (pasted == null) pasted = Text.videoIdIn(artist);
        if (pasted != null) return List.of(pasted(pasted, title, artist));
        if (apiKey == null || apiKey.isBlank()) {
            throw new ApiException(503, "Finding songs on YouTube by name needs a YouTube Data API key (YOUTUBE_API_KEY on the "
                + "song server, then restart it). Or paste the song's YouTube link into Title.");
        }
        String key = (Text.norm(title) + "\n" + Text.norm(artist)).trim();
        long now = System.currentTimeMillis();
        Kept k = kept.get(key);
        if (k != null && now - k.at() < KEEP_MS) return k.videos();
        List<VideoMatch> found = search(title, artist);
        if (kept.size() >= KEEP_MAX) {
            kept.entrySet().removeIf(e -> now - e.getValue().at() >= KEEP_MS);
            if (kept.size() >= KEEP_MAX) kept.clear();
        }
        kept.put(key, new Kept(now, found));
        return found;
    }

    /** A pasted link: oEmbed needs no key and says whether the video can be embedded (401/403 when it can't). */
    private VideoMatch pasted(String id, String title, String artist) {
        JsonNode info;
        try {
            info = http.getJson("https://www.youtube.com/oembed?format=json&url=" + Http.enc("https://www.youtube.com/watch?v=" + id));
        } catch (Http.StatusException e) {
            if (e.status == 401 || e.status == 403) {
                throw new ApiException(422, "That video can't be played outside YouTube (its owner turned embedding off). Try another upload of the song.");
            }
            if (e.status == 404 || e.status == 400) throw new ApiException(404, "YouTube doesn't know that video. Check the link.");
            throw unreachable();
        } catch (IOException e) {
            throw unreachable();
        }
        String videoTitle = info.path("title").asString(""), channel = info.path("author_name").asString("");
        String typedTitle = Text.videoIdIn(title) != null ? "" : title;
        // Only songs: the title and channel, and with an API key the length and category too.
        Integer seconds = null;
        String categoryId = null;
        if (apiKey != null && !apiKey.isBlank()) {
            try {
                Map<String, String> dp = new LinkedHashMap<>();
                dp.put("part", "snippet,contentDetails");
                dp.put("id", id);
                dp.put("key", apiKey);
                JsonNode d = http.getJson("https://www.googleapis.com/youtube/v3/videos?" + Http.query(dp)).path("items").path(0);
                if (!d.isMissingNode()) {
                    seconds = isoSeconds(d.path("contentDetails").path("duration").asString(""));
                    categoryId = d.path("snippet").path("categoryId").asString(null);
                }
            } catch (IOException e) {
                // The title check still applies.
            }
        }
        String typedArtist = Text.videoIdIn(artist) != null ? "" : artist;
        String why = Matching.notSongReason(videoTitle, channel, seconds, categoryId, typedTitle + " " + typedArtist);
        if (why != null) {
            throw new ApiException(422, "That video isn't a song: " + why + ". Paste the link to the song itself (its official audio or video).");
        }
        Matching.SongName guess = Matching.songFromVideo(videoTitle, channel, typedTitle);
        String songArtist = !artist.isEmpty() && Text.videoIdIn(artist) == null ? artist : guess.artist();
        return new VideoMatch(id, videoTitle, channel, typedTitle.isEmpty() ? guess.title() : typedTitle, songArtist, seconds,
            "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg");
    }

    private List<VideoMatch> search(String title, String artist) {
        String q = (artist + " " + title).trim();
        try {
            Map<String, String> sp = new LinkedHashMap<>();
            sp.put("part", "snippet");
            sp.put("type", "video");
            sp.put("videoEmbeddable", "true");
            sp.put("videoCategoryId", Matching.MUSIC_CATEGORY); // music only
            sp.put("maxResults", "10");
            sp.put("q", q);
            sp.put("key", apiKey);
            JsonNode found = http.getJson("https://www.googleapis.com/youtube/v3/search?" + Http.query(sp));
            List<JsonNode> items = new ArrayList<>();
            for (JsonNode i : found.path("items")) if (!i.path("id").path("videoId").asString("").isEmpty()) items.add(i);
            if (items.isEmpty()) throw ApiException.notFound("YouTube has nothing for “" + q + "”.");

            Map<String, String> dp = new LinkedHashMap<>();
            dp.put("part", "snippet,contentDetails,status");
            dp.put("id", String.join(",", items.stream().map(i -> i.path("id").path("videoId").asString()).toList()));
            dp.put("key", apiKey);
            Map<String, JsonNode> details = new HashMap<>();
            for (JsonNode d : http.getJson("https://www.googleapis.com/youtube/v3/videos?" + Http.query(dp)).path("items")) {
                details.put(d.path("id").asString(""), d);
            }

            record Ranked(JsonNode item, String title, String channel, Integer seconds, double score) {
            }
            List<Ranked> ranked = new ArrayList<>();
            for (JsonNode i : items) {
                JsonNode d = details.get(i.path("id").path("videoId").asString());
                if (d != null && !d.path("status").path("embeddable").asBoolean(true)) continue;
                String vt = decode(i.path("snippet").path("title").asString(""));
                String ch = decode(i.path("snippet").path("channelTitle").asString(""));
                Integer secs = d == null ? null : isoSeconds(d.path("contentDetails").path("duration").asString(""));
                String category = d == null ? null : d.path("snippet").path("categoryId").asString(null);
                if (Matching.notSongReason(vt, ch, secs, category, title + " " + artist) != null) continue;
                ranked.add(new Ranked(i, vt, ch, secs, Matching.videoScore(vt, ch, secs, title, artist)));
            }
            if (ranked.isEmpty()) {
                throw ApiException.notFound("None of YouTube's videos for “" + q + "” is a song that can be played outside YouTube. "
                    + "Check the name, or paste the song's link.");
            }
            ranked.sort(Comparator.comparingDouble(Ranked::score).reversed());
            List<VideoMatch> out = new ArrayList<>();
            for (Ranked r : ranked.subList(0, Math.min(OFFERED, ranked.size()))) {
                String thumb = r.item.path("snippet").path("thumbnails").path("medium").path("url").asString(null);
                String songArtist = artist.isEmpty() ? Matching.songFromVideo(r.title, r.channel, title).artist() : artist;
                out.add(new VideoMatch(r.item.path("id").path("videoId").asString(), r.title, r.channel, title, songArtist, r.seconds, thumb));
            }
            return List.copyOf(out);
        } catch (Http.StatusException e) {
            throw new ApiException(502, "YouTube answered " + e.status + ". Try again.");
        } catch (IOException e) {
            throw unreachable();
        }
    }

    private static ApiException unreachable() {
        return new ApiException(502, "Couldn't reach YouTube. Try again.");
    }

    private static final Pattern ISO = Pattern.compile("P(?:(\\d+)D)?T?(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?");

    static int isoSeconds(String d) {
        Matcher m = ISO.matcher(d);
        if (!m.find()) return 0;
        int[] mul = { 86400, 3600, 60, 1 };
        int s = 0;
        for (int i = 0; i < 4; i++) if (m.group(i + 1) != null) s += Integer.parseInt(m.group(i + 1)) * mul[i];
        return s;
    }

    static String decode(String s) {
        return s.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">");
    }
}
