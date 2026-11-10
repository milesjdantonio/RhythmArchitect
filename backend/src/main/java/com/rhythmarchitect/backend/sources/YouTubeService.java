package com.rhythmarchitect.backend.sources;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.rhythmarchitect.backend.match.Matching;
import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.web.ApiException;

import tools.jackson.databind.JsonNode;

/** Finds the YouTube video that plays a song (its audio is never fetched). */
@Service
public class YouTubeService {

    /** VideoMatch (frontend/src/api/types.ts). songTitle/songArtist are what the song is filed under. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VideoMatch(String videoId, String title, String channel, String songTitle, String songArtist, Integer seconds,
        String thumbnail) {
    }

    private final Http http;
    private final String apiKey;

    public YouTubeService(Http http, @Value("${rythm.youtube.api-key:}") String apiKey) {
        this.http = http;
        this.apiKey = apiKey;
    }

    public VideoMatch find(String title, String artist) {
        String pasted = Text.videoIdIn(title);
        if (pasted == null) pasted = Text.videoIdIn(artist);
        if (pasted != null) return pasted(pasted, title, artist);
        if (apiKey == null || apiKey.isBlank()) {
            throw new ApiException(503, "Finding songs on YouTube by name needs a YouTube Data API key (YOUTUBE_API_KEY on the "
                + "song server, then restart it). Or paste the song's YouTube link into Title.");
        }
        return search(title, artist);
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
        Matching.SongName guess = Matching.songFromVideo(videoTitle, channel);
        String typedTitle = Text.videoIdIn(title) != null ? "" : title;
        String songArtist = !artist.isEmpty() && Text.videoIdIn(artist) == null ? artist : guess.artist();
        return new VideoMatch(id, videoTitle, channel, typedTitle.isEmpty() ? guess.title() : typedTitle, songArtist, null,
            "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg");
    }

    private VideoMatch search(String title, String artist) {
        String q = (artist + " " + title).trim();
        try {
            Map<String, String> sp = new LinkedHashMap<>();
            sp.put("part", "snippet");
            sp.put("type", "video");
            sp.put("videoEmbeddable", "true");
            sp.put("maxResults", "10");
            sp.put("q", q);
            sp.put("key", apiKey);
            JsonNode found = http.getJson("https://www.googleapis.com/youtube/v3/search?" + Http.query(sp));
            List<JsonNode> items = new ArrayList<>();
            for (JsonNode i : found.path("items")) if (!i.path("id").path("videoId").asString("").isEmpty()) items.add(i);
            if (items.isEmpty()) throw ApiException.notFound("YouTube has nothing for “" + q + "”.");

            Map<String, String> dp = new LinkedHashMap<>();
            dp.put("part", "contentDetails,status");
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
                ranked.add(new Ranked(i, vt, ch, secs, Matching.videoScore(vt, ch, secs, title, artist)));
            }
            Ranked best = ranked.stream().max(Comparator.comparingDouble(Ranked::score)).orElseThrow(
                () -> ApiException.notFound("None of YouTube's videos for “" + q + "” can be played outside YouTube."));
            String thumb = best.item.path("snippet").path("thumbnails").path("medium").path("url").asString(null);
            String songArtist = artist.isEmpty() ? Matching.songFromVideo(best.title, best.channel).artist() : artist;
            return new VideoMatch(best.item.path("id").path("videoId").asString(), best.title, best.channel, title, songArtist,
                best.seconds, thumb);
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
