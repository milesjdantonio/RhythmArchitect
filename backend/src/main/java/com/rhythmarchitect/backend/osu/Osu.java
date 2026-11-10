package com.rhythmarchitect.backend.osu;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleUnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * Fan-made charts from osu! (the fallback when the browser can't listen to a song itself).
 * A port of frontend/src/mapping/osu.ts: osu!mania 4K is the same game as ours; other key counts
 * are folded onto four lanes; osu! standard maps are converted (circles become taps, sliders and
 * spinners holds). Nothing is moved or added: every tile is one a fan placed on a sound.
 */
public final class Osu {

    private Osu() {
    }

    public record Timing(double ms, double beatLength, int meter, boolean uninherited, boolean kiai) {
    }

    public record HitObject(double x, double ms, int type, Double endMs, Integer slides, Double length) {
    }

    public static final class OsuMap {
        public int mode = 0;
        public int keys = 4;
        public String title = "", artist = "", creator = "", version = "";
        public int beatmapId = 0, setId = 0;
        public double sliderMultiplier = 1.4;
        public final List<Timing> timing = new ArrayList<>();
        public final List<HitObject> objects = new ArrayList<>();
        public final List<double[]> breaks = new ArrayList<>();
    }

    private static final Pattern HEAD = Pattern.compile("^\\[(\\w+)]$");

    private static double num(String s, double fallback) {
        try {
            double v = Double.parseDouble(s.trim());
            return Double.isFinite(v) ? v : fallback;
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    private static String field(String[] f, int i) {
        return i < f.length ? f[i] : null;
    }

    /** Reads a .osu file (format v3-v14). */
    public static OsuMap parse(String text) {
        OsuMap map = new OsuMap();
        String section = "";
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("//")) continue;
            Matcher head = HEAD.matcher(line);
            if (head.matches()) { section = head.group(1); continue; }
            switch (section) {
                case "General", "Metadata", "Difficulty" -> {
                    int i = line.indexOf(':');
                    if (i < 0) continue;
                    String k = line.substring(0, i).trim(), v = line.substring(i + 1).trim();
                    switch (k) {
                        case "Mode" -> map.mode = (int) num(v, 0);
                        case "Title" -> map.title = v;
                        case "Artist" -> map.artist = v;
                        case "Creator" -> map.creator = v;
                        case "Version" -> map.version = v;
                        case "BeatmapID" -> map.beatmapId = (int) num(v, 0);
                        case "BeatmapSetID" -> map.setId = (int) num(v, 0);
                        case "CircleSize" -> { int keys = (int) Math.round(num(v, 4)); map.keys = keys == 0 ? 4 : keys; }
                        case "SliderMultiplier" -> { double m = num(v, 1.4); map.sliderMultiplier = m == 0 ? 1.4 : m; }
                        default -> { }
                    }
                }
                case "Events" -> {
                    String[] f = line.split(",");
                    if ((f[0].equals("2") || f[0].equals("Break")) && f.length >= 3) map.breaks.add(new double[] { num(f[1], 0), num(f[2], 0) });
                }
                case "TimingPoints" -> {
                    String[] f = line.split(",");
                    if (f.length < 2) continue;
                    double beatLength = num(f[1], 0);
                    int effects = (int) num(field(f, 7) == null ? "0" : f[7], 0);
                    int meter = (int) num(field(f, 2) == null ? "4" : f[2], 4);
                    // Old files have no "uninherited" column: a positive beat length means a red line.
                    boolean red = field(f, 6) != null ? f[6].trim().equals("1") : beatLength > 0;
                    map.timing.add(new Timing(num(f[0], 0), beatLength, meter == 0 ? 4 : meter, red, (effects & 1) == 1));
                }
                case "HitObjects" -> {
                    String[] f = line.split(",");
                    if (f.length < 4) continue;
                    int type = (int) num(f[3], 0);
                    double ms = num(f[2], Double.NaN);
                    if (Double.isNaN(ms)) continue;
                    Double endMs = null;
                    Integer slides = null;
                    Double length = null;
                    if ((type & 128) != 0) endMs = num(field(f, 5) == null ? "" : f[5].split(":")[0], Double.NaN); // mania hold
                    else if ((type & 8) != 0) endMs = num(field(f, 5) == null ? "" : f[5], Double.NaN); // spinner
                    else if ((type & 2) != 0) {
                        int sl = (int) num(field(f, 6) == null ? "" : f[6], 1);
                        slides = sl == 0 ? 1 : sl;
                        length = num(field(f, 7) == null ? "" : f[7], 0);
                    }
                    if (endMs != null && endMs.isNaN()) endMs = null;
                    map.objects.add(new HitObject(num(f[0], 0), ms, type, endMs, slides, length));
                }
                default -> { }
            }
        }
        map.timing.sort(Comparator.comparingDouble(Timing::ms));
        map.objects.sort(Comparator.comparingDouble(HitObject::ms));
        return map;
    }

    /** A tile in the fan chart's time: milliseconds into its audio, on one of four lanes. */
    public record FanNote(double ms, int lane, Double endMs) {
    }

    /** Holds shorter than this are just taps. */
    static final double MIN_HOLD_MS = 120;

    private static final Timing DEFAULT_RED = new Timing(0, 500, 4, true, false);

    /** The map's tiles on four lanes: mania columns folded onto 4, or a standard map converted. */
    public static List<FanNote> fanNotes(OsuMap map) {
        List<FanNote> out = new ArrayList<>();
        if (map.mode == 3) {
            int k = Math.max(1, map.keys);
            for (HitObject o : map.objects) {
                int col = (int) Math.min(k - 1, Math.max(0, Math.floor(o.x() * k / 512)));
                int lane = k == 4 ? col : Math.min(3, (int) Math.floor(col * 4.0 / k));
                boolean hold = (o.type() & 128) != 0 && o.endMs() != null && o.endMs() != 0 && o.endMs() - o.ms() >= MIN_HOLD_MS;
                out.add(new FanNote(o.ms(), lane, hold ? o.endMs() : null));
            }
        } else {
            for (HitObject o : map.objects) {
                int lane = (int) Math.min(3, Math.max(0, Math.floor(o.x() * 4 / 512)));
                Double endMs = null;
                if ((o.type() & 8) != 0) endMs = o.endMs();
                else if ((o.type() & 2) != 0) {
                    Timing red = DEFAULT_RED;
                    for (Timing t : map.timing) if (t.uninherited()) { red = t; break; }
                    double sv = 1;
                    for (Timing t : map.timing) {
                        if (t.ms() > o.ms() + 1) break;
                        if (t.uninherited()) { red = t; sv = 1; } else if (t.beatLength() < 0) sv = Math.min(10, Math.max(0.1, -100 / t.beatLength()));
                    }
                    double len = o.length() == null ? 0 : o.length();
                    double perSlide = len / (map.sliderMultiplier * 100 * sv) * red.beatLength();
                    endMs = o.ms() + perSlide * (o.slides() == null ? 1 : o.slides());
                }
                boolean hold = endMs != null && endMs != 0 && endMs - o.ms() >= MIN_HOLD_MS;
                out.add(new FanNote(o.ms(), lane, hold ? (double) Math.round(endMs) : null));
            }
        }
        return clean(out);
    }

    /** One tile per lane at a time: drops duplicates and tiles that start under a hold in their lane. */
    static List<FanNote> clean(List<FanNote> notes) {
        List<FanNote> sorted = new ArrayList<>(notes);
        sorted.sort(Comparator.comparingDouble(FanNote::ms).thenComparingInt(FanNote::lane));
        double[] busy = { Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY };
        double[] last = busy.clone();
        List<FanNote> out = new ArrayList<>();
        for (FanNote n : sorted) {
            if (n.ms() <= busy[n.lane()] + 30 || n.ms() - last[n.lane()] < 30) continue;
            out.add(n);
            last[n.lane()] = n.ms();
            busy[n.lane()] = n.endMs() != null ? n.endMs() : n.ms();
        }
        return out;
    }

    public record Grid(double bpm, double beat0Ms, int meter) {
    }

    /** The tempo that covers most of the song, and where its first beat falls. */
    public static Grid beatGrid(OsuMap map, List<FanNote> notes) {
        List<Timing> reds = map.timing.stream().filter(t -> t.uninherited() && t.beatLength() > 0).toList();
        double end = 0;
        if (!notes.isEmpty()) {
            FanNote l = notes.getLast();
            end = l.endMs() != null ? l.endMs() : l.ms();
        }
        Timing best = reds.isEmpty() ? DEFAULT_RED : reds.getFirst();
        double span = -1;
        for (int i = 0; i < reds.size(); i++) {
            double s = (i + 1 < reds.size() ? reds.get(i + 1).ms() : end) - reds.get(i).ms();
            if (s > span) { span = s; best = reds.get(i); }
        }
        int meter = best.meter() == 0 ? 4 : best.meter();
        // Beat 0 on a bar line of that tempo, at or before the first tile.
        double bar = best.beatLength() * meter;
        double first = notes.isEmpty() ? best.ms() : notes.getFirst().ms();
        double beat0Ms = best.ms();
        if (beat0Ms > first) beat0Ms -= Math.ceil((beat0Ms - first) / bar) * bar;
        return new Grid(60000 / best.beatLength(), beat0Ms, meter);
    }

    /** Tiles per second while the song is playing (breaks and silences of 4 s+ left out). */
    public static double density(List<FanNote> notes) {
        if (notes.size() < 2) return notes.size();
        double active = 0;
        for (int i = 1; i < notes.size(); i++) active += Math.min(4000, notes.get(i).ms() - notes.get(i - 1).ms());
        return notes.size() / Math.max(1, active / 1000);
    }

    // ------------------------------------------------------------ charts

    /** A tile in beats (ChartNote). */
    public record Note(double t, int lane, String pitch, double len, boolean hold) {
    }

    private static final String[] LANE_PITCH = { "C4", "E4", "G4", "C5" };

    /** Easy and Medium spacing (frontend/src/mapping/charts.ts RULES). */
    private static final Map<String, double[]> RULES = Map.of(
        "easy", new double[] { 1, 2 }, // minGap, holdMin
        "medium", new double[] { 0.5, 1.5 });

    private static double strength(double t, int meter, boolean hold, int chord) {
        java.util.function.DoublePredicate on = g -> Math.abs(t / g - Math.round(t / g)) < 0.04;
        double grid = on.test(meter) ? 1 : on.test(1) ? 0.8 : on.test(0.5) ? 0.6 : on.test(0.25) ? 0.4 : 0.25;
        return grid + (hold ? 0.15 : 0) + (chord > 1 ? 0.1 : 0);
    }

    /**
     * A fan chart shaped to one of our difficulties: Easy and Medium keep the tiles that sit most on
     * the beat, spaced as the rules say, one at a time, with holds only where they're long.
     */
    public static List<Note> shapeChart(List<Note> notes, String difficulty, double bpm, int meter) {
        if (difficulty.equals("hard")) return notes;
        double[] rule = RULES.get(difficulty);
        double f = bpm > 150 ? 2 : bpm > 125 ? 1.5 : 1;
        double minGap = rule[0] * f, holdMin = rule[1];
        Map<Double, Integer> chordSize = new HashMap<>();
        for (Note n : notes) chordSize.merge(n.t(), 1, Integer::sum);
        record Ranked(Note n, int i, double s) {
        }
        List<Ranked> ranked = new ArrayList<>();
        for (int i = 0; i < notes.size(); i++) {
            Note n = notes.get(i);
            ranked.add(new Ranked(n, i, strength(n.t(), meter, n.hold(), chordSize.getOrDefault(n.t(), 1))));
        }
        ranked.sort(Comparator.comparingDouble(Ranked::s).reversed().thenComparingInt(Ranked::i));
        List<Note> kept = new ArrayList<>();
        for (Ranked r : ranked) {
            Note n = r.n();
            Note shaped = n.hold() && n.len() < holdMin ? new Note(n.t(), n.lane(), n.pitch(), Math.min(n.len(), 0.5), false) : n;
            boolean fits = true;
            for (Note k : kept) {
                double kEnd = k.t() + (k.hold() ? k.len() : 0), nEnd = shaped.t() + (shaped.hold() ? shaped.len() : 0);
                // Nothing while a hold is down, and the minimum gap between tiles.
                if ((shaped.t() >= k.t() && shaped.t() < kEnd + minGap * 0.5) || (k.t() >= shaped.t() && k.t() < nEnd + minGap * 0.5)
                    || Math.abs(k.t() - shaped.t()) < minGap - 1e-6) {
                    fits = false;
                    break;
                }
            }
            if (fits) kept.add(shaped);
        }
        kept.sort(Comparator.comparingDouble(Note::t).thenComparingInt(Note::lane));
        return kept;
    }

    public record Section(String label, double beat) {
    }

    /** Rough sections from the fan chart: kiai (the chart's highlight) is a chorus, breaks are breaks. */
    static List<Section> sectionsFor(OsuMap map, DoubleUnaryOperator toBeat, double lastBeat, int meter) {
        List<Section> marks = new ArrayList<>();
        marks.add(new Section("Intro", 0));
        boolean inKiai = false;
        for (Timing t : map.timing) {
            if (t.kiai() != inKiai) {
                inKiai = t.kiai();
                marks.add(new Section(inKiai ? "Chorus" : "Verse", toBeat.applyAsDouble(t.ms())));
            }
        }
        for (double[] b : map.breaks) {
            marks.add(new Section("Break", toBeat.applyAsDouble(b[0])));
            marks.add(new Section("Verse", toBeat.applyAsDouble(b[1])));
        }
        marks.sort(Comparator.comparingDouble(Section::beat));
        List<Section> out = new ArrayList<>();
        for (Section m : marks) {
            double beat = Math.max(0, Math.round(m.beat() / meter) * (double) meter);
            if (beat >= lastBeat) continue;
            if (!out.isEmpty() && out.getLast().beat() == beat) out.set(out.size() - 1, new Section(m.label(), beat));
            else if (out.isEmpty() || !out.getLast().label().equals(m.label())) out.add(new Section(m.label(), beat));
        }
        if (out.size() == 1 && lastBeat > 64) {
            // No kiai or breaks: a verse after the intro, so the visuals still move on.
            out.add(new Section("Verse", Math.min(lastBeat - 1, 8.0 * meter)));
        }
        return out;
    }

    /** Two hues from a name, so every song has its own colours. */
    public static int[] huesFor(String name) {
        long h = 0;
        int i = 0;
        while (i < name.length()) {
            int cp = name.codePointAt(i);
            h = (h * 31 + name.charAt(i)) & 0xFFFFFFFFL; // charCodeAt(0) of each code point, as the app does
            i += Character.charCount(cp);
        }
        int a = (int) (h % 360);
        return new int[] { a, (a + 80) % 360 };
    }

    private static double r4(double x) {
        return Math.round(x * 10000) / 10000.0;
    }

    /**
     * A playable song (NewSong JSON) from one beatmap set's difficulties: the hardest one up to about
     * 7 tiles a second is Hard, the easiest is Easy, one between is Medium. With fewer than three,
     * the missing ones are shaped from the hardest.
     */
    public static ObjectNode fanSong(List<OsuMap> maps, String title, String artist, String videoId, Integer seconds) {
        record Usable(OsuMap m, List<FanNote> notes, double density) {
        }
        List<Usable> usable = new ArrayList<>();
        for (OsuMap m : maps) {
            List<FanNote> notes = fanNotes(m);
            if (notes.size() >= 16) usable.add(new Usable(m, notes, density(notes)));
        }
        if (usable.isEmpty()) throw new IllegalArgumentException("That fan chart has no playable tiles.");
        usable.sort(Comparator.comparingDouble(Usable::density));
        int hardIdx = 0;
        for (int i = 0; i < usable.size(); i++) if (usable.get(i).density() <= 7) hardIdx = i;
        Usable hard = usable.get(hardIdx);
        Usable easy = usable.getFirst();
        List<Usable> mids = usable.subList(Math.min(1, hardIdx), hardIdx);
        Usable medium = mids.isEmpty() ? hard : mids.get(mids.size() / 2);
        Grid grid = beatGrid(hard.m(), hard.notes());
        double spbMs = 60000 / grid.bpm();
        DoubleUnaryOperator toBeat = ms -> (ms - grid.beat0Ms()) / spbMs;
        java.util.function.Function<List<FanNote>, List<Note>> toChart = notes -> notes.stream().map(n -> new Note(
            r4(toBeat.applyAsDouble(n.ms())), n.lane(), LANE_PITCH[n.lane()],
            n.endMs() != null ? r4((n.endMs() - n.ms()) / spbMs) : 0.25, n.endMs() != null)).toList();

        Map<String, List<Note>> charts = new java.util.LinkedHashMap<>();
        charts.put("easy", shapeChart(toChart.apply(easy.notes()), "easy", grid.bpm(), grid.meter()));
        charts.put("medium", shapeChart(toChart.apply(medium.notes()), "medium", grid.bpm(), grid.meter()));
        charts.put("hard", shapeChart(toChart.apply(hard.notes()), "hard", grid.bpm(), grid.meter()));

        List<Note> all = charts.get("hard");
        double lastBeat = all.stream().mapToDouble(n -> n.t() + (n.hold() ? n.len() : 0)).max().orElse(0);
        double videoBeats = seconds != null ? (seconds - grid.beat0Ms() / 1000) / (spbMs / 1000) : 0;
        double lengthBeats = r4(Math.max(lastBeat + 2, Math.min(videoBeats, lastBeat + 32)));
        // Energy: how busy the chart is across the song (48 points), smoothed.
        double[] energy = new double[48];
        for (Note n : all) energy[(int) Math.min(47, Math.max(0, Math.floor(n.t() / lengthBeats * 48)))] += 1;
        double peak = 1;
        for (double e : energy) peak = Math.max(peak, e);

        JsonNodeFactory f = JsonNodeFactory.instance;
        ObjectNode song = f.objectNode();
        song.put("title", title);
        song.put("artist", artist);
        song.put("prompt", title + (artist.isEmpty() ? "" : " by " + artist));
        song.put("bpm", Math.round(grid.bpm() * 1000) / 1000.0);
        song.put("meter", grid.meter());
        song.put("key", "C");
        song.put("scale", "Minor");
        song.put("mood", "Fan chart");
        song.put("lengthBeats", lengthBeats);
        int[] hues = huesFor((title + " " + artist).toLowerCase(java.util.Locale.ROOT));
        song.putArray("hues").add(hues[0]).add(hues[1]);
        song.put("cover", "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg");

        OsuMap m = hard.m();
        String creator = m.creator.isEmpty() ? "an osu! mapper" : m.creator;
        String extra = usable.size() > 1 ? ", " + usable.size() + " difficulties" : !m.version.isEmpty() ? ", “" + m.version + "”" : "";
        ObjectNode source = song.putObject("source");
        source.put("kind", "youtube");
        source.put("videoId", videoId);
        source.put("chart", "fan");
        source.put("offset", Math.round(grid.beat0Ms()) / 1000.0);
        source.put("credit", "Chart by " + creator + " on osu! (beatmap set " + m.setId + extra + "). https://osu.ppy.sh/beatmapsets/" + m.setId);

        ObjectNode report = song.putObject("report");
        report.put("mapper", "Fan chart by " + creator + " (osu!" + (m.mode == 3 ? "mania " + m.keys + "K" : " standard, converted") + ")");
        report.put("confidence", 0.7);
        ArrayNode secs = report.putArray("sections");
        for (Section s : sectionsFor(m, toBeat, lastBeat, grid.meter())) secs.addObject().put("label", s.label()).put("beat", s.beat());
        ArrayNode en = report.putArray("energy");
        for (int i = 0; i < 48; i++) {
            double v = (energy[Math.max(0, i - 1)] + energy[i] * 2 + energy[Math.min(47, i + 1)]) / 4 / peak;
            en.add(Math.round(v * 100) / 100.0);
        }

        ObjectNode patch = song.putObject("patch");
        patch.put("name", "Glass Bell").put("oscillator", "triangle").put("attack", 0.002).put("decay", 0.3).put("sustain", 0.05)
            .put("release", 0.4).put("cutoff", 6000).put("space", 0.3);
        ObjectNode backing = song.putObject("backing");
        backing.putArray("bass").add("C2");
        backing.put("drums", "................");

        ObjectNode chartsNode = song.putObject("charts");
        charts.forEach((d, notes) -> {
            ObjectNode c = chartsNode.putObject(d);
            c.put("difficulty", d);
            c.put("lanes", 4);
            ArrayNode list = c.putArray("notes");
            for (Note n : notes) {
                ObjectNode o = list.addObject().put("t", n.t()).put("lane", n.lane()).put("pitch", n.pitch()).put("len", n.len());
                if (n.hold()) o.put("hold", true);
            }
        });
        return song;
    }
}
