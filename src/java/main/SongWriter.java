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
 */
public class SongWriter
{
    /** Lanes in every chart (keys D F J K). */
    public static final int LANES = 4;
    /** The difficulty played when none is chosen. */
    public static final Difficulty DEFAULT_DIFFICULTY = Difficulty.EASY;

    /** How long a tap lasts, in beats (a sixteenth note). */
    private static final double TAP_BEATS = 0.25;

    /** One note of a chart line, before it becomes a Note. */
    private record Tile(double beat, int lane, double holdBeats, NoteType letter) { }

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
        if(title == null || title.isBlank())
        {
            throw new IllegalArgumentException("The chart needs a title.");
        }
        if(artist == null || artist.isBlank())
        {
            throw new IllegalArgumentException("The chart needs an artist.");
        }
        if(!(bpm > 0))
        {
            throw new IllegalArgumentException("The chart's BPM must be more than 0.");
        }
        Map<Difficulty, List<Tile>> tiles = new EnumMap<Difficulty, List<Tile>>(Difficulty.class);
        double lastBeat = 0;
        for(Map.Entry<Difficulty, String> e: lines.entrySet())
        {
            List<Tile> list = tiles(e.getKey(), e.getValue());
            if(list.isEmpty())
            {
                continue;
            }
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
        out.sort(Comparator.comparingDouble(Tile::beat).thenComparingInt(Tile::lane));
        return out;
    }

    private static IllegalArgumentException bad(Difficulty difficulty, String token)
    {
        return new IllegalArgumentException("Bad note in " + difficulty + ": \"" + token
            + "\" (write beat:lane, beat:lane:holdBeats or beat:lane:holdBeats:letter, lanes 0-3)");
    }

    /**
     * The notes as a queue: times and lengths in seconds, the first START, the last END, notes
     * played together (a chord) ACCENT, the rest NORMAL.
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
            queue.enqueue(new Note(t.letter(), role, length, t.beat() * spb, t.lane()));
        }
        return queue;
    }
}
