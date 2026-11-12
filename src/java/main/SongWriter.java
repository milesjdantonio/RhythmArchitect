package main;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Writes a Song from a chart: one Queue of Notes per difficulty, each in the order the notes are
 * played (by time, then lane). The charts themselves are made by the app (the trained mapper
 * listening to the song in the browser, or an osu! fan chart); this is how the model takes one in.
 *
 * A chart is plain text, one "key: value" per line ('#' starts a comment):
 *
 * <pre>
 * title: One Dance (feat. WizKid &amp; Kyla)
 * artist: Drake
 * bpm: 104
 * duration: 174.5            (optional: seconds; else up to the last note)
 * easy: 0:1 2:2 4:0:2 ...    (notes: beat:lane, beat:lane:holdBeats, or beat:lane:holdBeats:letter)
 * medium: ...
 * hard: ...
 * </pre>
 *
 * Beats count from beat 0; lanes are 0-3 (keys D F J K); a hold length of 0 is a tap; the letter
 * (A-G) is the note's pitch, A when left out. Each Note gets its time and length in seconds.
 * Bad charts are rejected with an IllegalArgumentException that says what is wrong.
 *
 * A chart that is already in pieces (the game server's songs, kept as the app sends them) comes in
 * the same way as {@link Tile}s: {@link #writeSong(String, String, double, double, Map)}.
 */
public class SongWriter
{
    /** Lanes in every chart (keys D F J K). */
    public static final int LANES = 4;
    /** The difficulty played when none is chosen. */
    public static final Difficulty DEFAULT_DIFFICULTY = Difficulty.EASY;

    /** How long a tap lasts, in beats (a sixteenth note). */
    private static final double TAP_BEATS = 0.25;

    /**
     * One note of a chart, before it becomes a Note.
     *
     * @param beat      when it reaches the hit line, in beats from beat 0 (0 or more)
     * @param lane      its lane, 0-3
     * @param holdBeats how long it is held, in beats (0 for a tap)
     * @param letter    its pitch, A-G (null: A)
     */
    public record Tile(double beat, int lane, double holdBeats, NoteType letter) { }

    /**
     * Initializes the SongWriter.
     */
    public SongWriter()
    {
        // Nothing to set up: each chart is read on its own.
    }

    /**
     * Reads a chart file and writes its Song.
     *
     * @param file the chart file
     * @return the song, with a note queue for each difficulty in the file
     * @throws IOException              if the file can't be read
     * @throws IllegalArgumentException if the chart is not valid (see {@link #writeSong(String)})
     */
    public Song readSong(Path file) throws IOException
    {
        if(file == null)
        {
            throw new IllegalArgumentException("No chart file given.");
        }
        return writeSong(Files.readString(file));
    }

    /**
     * Writes the Song of a chart.
     *
     * @param chart the chart's text (see the class comment)
     * @return the song, with a note queue for each difficulty in the chart
     * @throws IllegalArgumentException for an empty chart, a missing or blank title or artist, a
     *                                  BPM or duration that isn't a number above 0, an unknown
     *                                  line, a note that isn't beat:lane[:hold[:letter]] with a
     *                                  lane of 0-3, or no notes at all
     */
    public Song writeSong(String chart)
    {
        if(chart == null || chart.isBlank())
        {
            throw new IllegalArgumentException("The chart is empty.");
        }
        String title = null;
        String artist = null;
        double bpm = 0;
        double duration = 0;
        Map<Difficulty, String> lines = new EnumMap<Difficulty, String>(Difficulty.class);
        for(String raw: chart.split("\\R"))
        {
            String line = raw.strip();
            if(line.isEmpty() || line.startsWith("#"))
            {
                continue;
            }
            int colon = line.indexOf(':');
            if(colon < 0)
            {
                throw new IllegalArgumentException("Not a \"key: value\" line: " + line);
            }
            String key = line.substring(0, colon).strip().toLowerCase();
            String value = line.substring(colon + 1).strip();
            switch(key)
            {
                case "title" -> title = value;
                case "artist" -> artist = value;
                case "bpm" -> bpm = number("bpm", value);
                case "duration" -> duration = number("duration", value);
                case "easy" -> lines.put(Difficulty.EASY, value);
                case "medium" -> lines.put(Difficulty.MEDIUM, value);
                case "hard" -> lines.put(Difficulty.HARD, value);
                default -> throw new IllegalArgumentException("Unknown line: " + key);
            }
        }
        Map<Difficulty, List<Tile>> charts = new EnumMap<Difficulty, List<Tile>>(Difficulty.class);
        for(Map.Entry<Difficulty, String> e: lines.entrySet())
        {
            charts.put(e.getKey(), tiles(e.getKey(), e.getValue()));
        }
        return writeSong(title, artist, bpm, duration, charts);
    }

    /**
     * Writes the Song of a chart that is already in pieces.
     *
     * @param title    the song's title
     * @param artist   who it's by
     * @param bpm      its tempo in beats per minute (more than 0)
     * @param duration its length in seconds (0: up to the last note)
     * @param charts   each difficulty's notes, in any order (an empty or missing one has no chart)
     * @return the song, with a note queue for each difficulty that has notes
     * @throws IllegalArgumentException for a missing or blank title or artist, a BPM that isn't a
     *                                  number above 0, a duration below 0, a note before beat 0,
     *                                  outside lanes 0-3 or with a negative hold, or no notes at
     *                                  all
     */
    public Song writeSong(String title, String artist, double bpm, double duration,
        Map<Difficulty, List<Tile>> charts)
    {
        if(title == null || title.isBlank())
        {
            throw new IllegalArgumentException("The chart needs a title.");
        }
        if(artist == null || artist.isBlank())
        {
            throw new IllegalArgumentException("The chart needs an artist.");
        }
        if(!(bpm > 0) || Double.isInfinite(bpm))
        {
            throw new IllegalArgumentException("The chart's BPM must be more than 0.");
        }
        if(!(duration >= 0) || Double.isInfinite(duration))
        {
            throw new IllegalArgumentException("The chart's duration can't be below 0.");
        }
        if(charts == null)
        {
            throw new IllegalArgumentException("The chart has no notes.");
        }
        Map<Difficulty, List<Tile>> tiles = new EnumMap<Difficulty, List<Tile>>(Difficulty.class);
        double lastBeat = 0;
        for(Map.Entry<Difficulty, List<Tile>> e: charts.entrySet())
        {
            if(e.getKey() == null || e.getValue() == null || e.getValue().isEmpty())
            {
                continue;
            }
            List<Tile> list = new ArrayList<Tile>();
            for(Tile t: e.getValue())
            {
                check(e.getKey(), t);
                list.add(t);
            }
            list.sort(Comparator.comparingDouble(Tile::beat).thenComparingInt(Tile::lane));
            tiles.put(e.getKey(), list);
            for(Tile t: list)
            {
                lastBeat = Math.max(lastBeat, t.beat() + Math.max(t.holdBeats(), TAP_BEATS));
            }
        }
        if(tiles.isEmpty())
        {
            throw new IllegalArgumentException("The chart has no notes.");
        }
        double spb = 60 / bpm;
        // Without a duration, the song lasts until its last note ends.
        Song song = new Song(title, artist, duration > 0 ? duration : lastBeat * spb, bpm);
        for(Map.Entry<Difficulty, List<Tile>> e: tiles.entrySet())
        {
            song.setChart(e.getKey(), notes(e.getValue(), spb));
        }
        return song;
    }

    /**
     * The chart a player gets for a difficulty: no difficulty chosen means Easy.
     *
     * @param song       the song
     * @param difficulty the difficulty chosen (null: Easy)
     * @return its notes, or null when the song has no chart for it
     * @throws IllegalArgumentException for a null song
     */
    public static Queue<Note> chartFor(Song song, Difficulty difficulty)
    {
        if(song == null)
        {
            throw new IllegalArgumentException("No song given.");
        }
        return song.getChart(difficulty == null ? DEFAULT_DIFFICULTY : difficulty);
    }

    /** A number above zero from a chart line. */
    private static double number(String what, String value)
    {
        try
        {
            return Double.parseDouble(value);
        }
        catch(NumberFormatException e)
        {
            throw new IllegalArgumentException("The chart's " + what + " is not a number: " + value);
        }
    }

    /** The notes of one difficulty's line, in play order. */
    private static List<Tile> tiles(Difficulty difficulty, String line)
    {
        List<Tile> out = new ArrayList<Tile>();
        for(String token: line.split("[\\s,]+"))
        {
            if(token.isEmpty())
            {
                continue;
            }
            String[] parts = token.split(":");
            if(parts.length < 2 || parts.length > 4)
            {
                throw bad(difficulty, token);
            }
            double beat;
            int lane;
            double hold = 0;
            try
            {
                beat = Double.parseDouble(parts[0]);
                lane = Integer.parseInt(parts[1]);
                if(parts.length > 2)
                {
                    hold = Double.parseDouble(parts[2]);
                }
            }
            catch(NumberFormatException e)
            {
                throw bad(difficulty, token);
            }
            if(!(beat >= 0) || lane < 0 || lane >= LANES || !(hold >= 0))
            {
                throw bad(difficulty, token);
            }
            NoteType letter = null;
            if(parts.length == 4)
            {
                try
                {
                    letter = NoteType.valueOf(parts[3].strip().toUpperCase());
                }
                catch(IllegalArgumentException e)
                {
                    throw bad(difficulty, token);
                }
            }
            out.add(new Tile(beat, lane, hold, letter));
        }
        return out;
    }

    /** Turns down a note before beat 0, outside lanes 0-3 or with a negative hold. */
    private static void check(Difficulty difficulty, Tile t)
    {
        if(t == null || !(t.beat() >= 0) || Double.isInfinite(t.beat()) || t.lane() < 0
            || t.lane() >= LANES || !(t.holdBeats() >= 0) || Double.isInfinite(t.holdBeats()))
        {
            throw new IllegalArgumentException("Bad note in " + difficulty + ": " + t
                + " (a note needs a beat of 0 or more, a lane of 0-3 and a hold of 0 or more)");
        }
    }

    private static IllegalArgumentException bad(Difficulty difficulty, String token)
    {
        return new IllegalArgumentException("Bad note in " + difficulty + ": \"" + token
            + "\" (write beat:lane, beat:lane:holdBeats or beat:lane:holdBeats:letter, lanes 0-3)");
    }

    /**
     * The notes as a queue: times and lengths in seconds, a hold where the tile is held, the first
     * START, the last END, notes played together (a chord) ACCENT, the rest NORMAL.
     */
    private static Queue<Note> notes(List<Tile> tiles, double spb)
    {
        Queue<Note> queue = new Queue<Note>();
        for(int i = 0; i < tiles.size(); i++)
        {
            Tile t = tiles.get(i);
            boolean chord = (i > 0 && tiles.get(i - 1).beat() == t.beat())
                || (i + 1 < tiles.size() && tiles.get(i + 1).beat() == t.beat());
            MusicNoteType role = i == 0 ? MusicNoteType.START
                : i == tiles.size() - 1 ? MusicNoteType.END
                : chord ? MusicNoteType.ACCENT
                : MusicNoteType.NORMAL;
            double length = (t.holdBeats() > 0 ? t.holdBeats() : TAP_BEATS) * spb;
            queue.enqueue(new Note(t.letter(), role, length, t.beat() * spb, t.lane(),
                t.holdBeats() > 0));
        }
        return queue;
    }
}
