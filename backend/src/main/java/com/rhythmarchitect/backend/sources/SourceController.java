package com.rhythmarchitect.backend.sources;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.osu.Osu;
import com.rhythmarchitect.backend.songs.NewSongCheck;
import com.rhythmarchitect.backend.songs.SongStore;
import com.rhythmarchitect.backend.web.ApiException;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Where songs the bank doesn't have yet come from: their YouTube video, or a fan chart. */
@RestController
@RequestMapping("/api")
public class SourceController {

    private static final int MAX_FIELD = 120;

    private final YouTubeService youtube;
    private final FanChartService fanCharts;
    private final SongStore store;

    public SourceController(YouTubeService youtube, FanChartService fanCharts, SongStore store) {
        this.youtube = youtube;
        this.fanCharts = fanCharts;
        this.store = store;
    }

    /** The video that plays the song. {@code title} may be a YouTube link. */
    @GetMapping("/youtube")
    public YouTubeService.VideoMatch video(@RequestParam(defaultValue = "") String title, @RequestParam(defaultValue = "") String artist) {
        String t = title.trim(), a = artist.trim();
        if (t.isEmpty()) throw ApiException.badRequest("Type the title of the song (or paste its YouTube link).");
        if (t.length() > 300 || a.length() > MAX_FIELD) {
            throw ApiException.badRequest("Keep the title and artist under " + MAX_FIELD + " characters each.");
        }
        return youtube.find(t, a);
    }

    /** A fan-made osu! chart of the song, lined up with the video, saved. */
    @PostMapping("/fan-chart")
    public ResponseEntity<ObjectNode> fanChart(@RequestBody JsonNode body) {
        String title = body.path("title").isString() ? body.path("title").asString().trim() : "";
        String artist = body.path("artist").isString() ? body.path("artist").asString().trim() : "";
        String videoId = body.path("videoId").asString(null);
        if (title.isEmpty() || !Text.isVideoId(videoId)) throw ApiException.badRequest("Need the song title and its YouTube video.");
        JsonNode s = body.path("seconds");
        Integer seconds = s.isNumber() && s.asDouble() > 0 ? (int) Math.round(s.asDouble()) : null;
        FanChartService.FanChart found = fanCharts.find(title, artist, seconds);
        ObjectNode song;
        try {
            song = Osu.fanSong(found.maps(), title, artist, videoId, seconds);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound(e.getMessage());
        }
        // Kept only if it passes what a mapped song must (the game's model can play it).
        String problem = NewSongCheck.problem(song);
        if (problem != null) throw ApiException.notFound("The fan chart found for this song can't be played: " + problem);
        return ResponseEntity.status(HttpStatus.CREATED).body(store.add(song));
    }
}
