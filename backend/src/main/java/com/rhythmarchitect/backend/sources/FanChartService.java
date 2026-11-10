package com.rhythmarchitect.backend.sources;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import org.springframework.stereotype.Service;

import com.rhythmarchitect.backend.match.Matching;
import com.rhythmarchitect.backend.match.Matching.OsuBeatmap;
import com.rhythmarchitect.backend.match.Matching.OsuSet;
import com.rhythmarchitect.backend.match.Text;
import com.rhythmarchitect.backend.osu.Osu;
import com.rhythmarchitect.backend.web.ApiException;

import tools.jackson.databind.JsonNode;

/** Finds a fan-made osu! chart of a song: osu!mania 4K first, then other key counts, then osu! standard. */
@Service
public class FanChartService {

    public record FanChart(List<Osu.OsuMap> maps, int setId, String creator) {
    }

    private final Http http;

    public FanChartService(Http http) {
        this.http = http;
    }

    private record Tier(int mode, Predicate<OsuBeatmap> pick, double bonus) {
    }

    private static final List<Tier> TIERS = List.of(
        new Tier(3, b -> b.mode() == 3 && Math.round(b.cs()) == 4, 6),
        new Tier(3, b -> b.mode() == 3 && b.cs() >= 5 && b.cs() <= 10, 3),
        new Tier(0, b -> b.mode() == 0, 0));

    public FanChart find(String title, String artist, Integer seconds) {
        record Candidate(OsuSet set, List<OsuBeatmap> maps, double score) {
        }
        boolean reachable = false;
        List<Candidate> candidates = new ArrayList<>();
        for (int mode : new int[] { 3, 0 }) {
            List<OsuSet> sets;
            try {
                sets = search(title, artist, mode);
                reachable = true;
            } catch (IOException | RuntimeException e) {
                continue;
            }
            for (Tier tier : TIERS) {
                if (tier.mode() != mode) continue;
                for (OsuSet set : sets) {
                    List<OsuBeatmap> maps = set.beatmaps().stream().filter(tier.pick()).toList();
                    if (maps.isEmpty()) continue;
                    double s = Matching.setScore(set, maps, title, artist, seconds);
                    if (s >= 0) candidates.add(new Candidate(set, maps, s + tier.bonus()));
                }
            }
            if (candidates.stream().anyMatch(c -> c.score() >= 6)) break; // a 4K chart: no need to look at standard maps
        }
        if (!reachable) throw new ApiException(502, "Couldn't reach osu! to look for a fan-made chart. Try again.");
        Candidate best = candidates.stream().max(Comparator.comparingDouble(Candidate::score)).orElseThrow(
            () -> ApiException.notFound("No fan-made chart of “" + title + "”" + (artist.isEmpty() ? "" : " by " + artist) + " on osu! either."));

        // Up to six difficulties, spread from easiest to hardest.
        List<OsuBeatmap> sorted = new ArrayList<>(best.maps());
        sorted.sort(Comparator.comparingDouble(OsuBeatmap::difficultyRating));
        List<OsuBeatmap> take = new ArrayList<>();
        if (sorted.size() <= 6) take.addAll(sorted);
        else for (int i = 0; i < 6; i++) take.add(sorted.get((int) Math.round(i * (sorted.size() - 1) / 5.0)));
        List<Osu.OsuMap> maps = new ArrayList<>();
        for (OsuBeatmap b : take) {
            try {
                maps.add(Osu.parse(osuFile(b.id())));
            } catch (IOException | RuntimeException e) {
                // one missing difficulty is fine
            }
        }
        if (maps.isEmpty()) throw new ApiException(502, "Found a fan chart, but couldn't download it. Try again.");
        return new FanChart(maps, best.set().id(), best.set().creator());
    }

    private List<OsuSet> search(String title, String artist, int mode) throws IOException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("q", (Text.bare(title) + " " + artist).trim());
        q.put("mode", String.valueOf(mode));
        q.put("limit", "50");
        JsonNode sets = http.getJson("https://catboy.best/api/v2/search?" + Http.query(q));
        List<OsuSet> out = new ArrayList<>();
        if (!sets.isArray()) return out;
        for (JsonNode s : sets) {
            List<OsuBeatmap> maps = new ArrayList<>();
            for (JsonNode b : s.path("beatmaps")) {
                maps.add(new OsuBeatmap(b.path("id").asInt(), b.path("mode_int").asInt(), b.path("cs").asDouble(),
                    b.path("version").asString(""), b.path("difficulty_rating").asDouble(), b.path("total_length").asInt()));
            }
            out.add(new OsuSet(s.path("id").asInt(), s.path("title").asString(""), s.path("artist").asString(""),
                s.path("creator").asString(""), s.path("status").asString(""), s.path("play_count").asLong(0), maps));
        }
        return out;
    }

    private String osuFile(int id) throws IOException {
        try {
            return http.getText("https://osu.ppy.sh/osu/" + id);
        } catch (IOException e) {
            return http.getText("https://catboy.best/osu/" + id);
        }
    }
}
