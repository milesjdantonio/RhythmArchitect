package main;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.Locale;

/**
 * A tiny driver for the model alone (no view, no controller): reads a chart, writes its Song with
 * SongWriter, then plays one difficulty's Queue of Notes front to back, the way the game takes
 * them, and checks they come out in time order. It also shows the model turning down bad input.
 *
 * From the repo root:
 *
 * <pre>
 * javac -d out src/java/main/*.java
 * java -cp out main.ModelDemo                                        (One Dance, Easy)
 * java -cp out main.ModelDemo src/java/charts/ink-and-fury.chart hard
 * </pre>
 *
 * Or VS Code's Run button above main (it starts in backend/; the chart is still found).
 */
public class ModelDemo
{
    /** The chart played when none is named. */
    public static final String DEFAULT_CHART = "src/java/charts/one-dance.chart";

    /**
     * Runs the demo.
     *
     * @param args the chart file (optional) and the difficulty, easy/medium/hard (optional)
     */
    public static void main(String[] args)
    {
        Path file = locate(Path.of(args.length > 0 ? args[0] : DEFAULT_CHART));
        Difficulty difficulty = null;
        if(args.length > 1)
        {
            try
            {
                difficulty = Difficulty.valueOf(args[1].toUpperCase(Locale.ROOT));
            }
            catch(IllegalArgumentException e)
            {
                System.out.println("No difficulty \"" + args[1] + "\": playing "
                    + SongWriter.DEFAULT_DIFFICULTY + ".");
            }
        }

        SongWriter writer = new SongWriter();
        Song song;
        try
        {
            song = writer.readSong(file);
        }
        catch(NoSuchFileException e)
        {
            System.out.println("There's no chart file at " + file + ".");
            return;
        }
        catch(IOException e)
        {
            System.out.println("Couldn't read " + file + ": " + e.getMessage());
            return;
        }
        catch(IllegalArgumentException e)
        {
            System.out.println("That chart isn't valid: " + e.getMessage());
            return;
        }

        System.out.printf(Locale.ROOT, "%s by %s: %.0f BPM, %.1f s%n", song.getTitle(), song.getArtist(), song.getBpm(), song.getDuration());
        for(Difficulty d: song.getAvailableDifficulties())
        {
            System.out.printf(Locale.ROOT, "  %-6s %4d notes%n", d, song.getChart(d).getSize());
        }

        Difficulty playing = difficulty == null ? SongWriter.DEFAULT_DIFFICULTY : difficulty;
        Queue<Note> chart = SongWriter.chartFor(song, difficulty);
        if(chart == null)
        {
            System.out.println("This song has no " + playing + " chart.");
            return;
        }
        System.out.println();
        System.out.println("Playing " + playing + " (each note leaves the queue as it reaches the hit line):");
        int count = 0;
        int holds = 0;
        double last = Double.NEGATIVE_INFINITY;
        boolean inOrder = true;
        int total = chart.getSize();
        while(!chart.isEmpty())
        {
            Note next = chart.peek();
            Note n = chart.dequeue();
            if(next != n || n.getTimeStamp() < last)
            {
                inOrder = false;
            }
            last = n.getTimeStamp();
            boolean hold = n.getNoteLength() > 60 / song.getBpm() * 0.3;
            if(hold)
            {
                holds++;
            }
            if(count < 12)
            {
                System.out.printf(Locale.ROOT, "  %6.2f s  lane %d (%s)  %-4s %-8s %s%n", n.getTimeStamp(), n.getLane(),
                    "DFJK".charAt(n.getLane()), hold ? "hold" : "tap", n.getMusicNoteType(), n);
            }
            else if(count == 12)
            {
                System.out.println("  ...");
            }
            count++;
        }
        System.out.printf(Locale.ROOT, "%d of %d notes played (%d holds), %s; the queue is now empty: %b%n",
            count, total, holds, inOrder ? "in time order" : "OUT OF ORDER", chart.isEmpty());

        System.out.println();
        System.out.println("Bad input the model turns down:");
        String[] bad = {
            "title: \nartist: Nobody\nbpm: 120\neasy: 0:1",
            "title: Song\nartist: Someone\nbpm: 0\neasy: 0:1",
            "title: Song\nartist: Someone\nbpm: 120\neasy: 0:7",
            "title: Song\nartist: Someone\nbpm: 120",
        };
        for(String chartText: bad)
        {
            try
            {
                writer.writeSong(chartText);
                System.out.println("  (accepted?)");
            }
            catch(IllegalArgumentException e)
            {
                System.out.println("  " + e.getMessage());
            }
        }
    }

    /**
     * Finds a chart named relative to the repo root wherever the demo was started: VS Code's Run
     * button starts it in backend/ (the Maven project it is built in), not the repo root. A relative
     * path that isn't there is looked for under each folder above the working directory.
     *
     * @param file the chart path as given
     * @return the first place it exists, or the path as given if it is nowhere
     */
    static Path locate(Path file)
    {
        if(file.isAbsolute() || Files.exists(file))
        {
            return file;
        }
        Path dir = Path.of("").toAbsolutePath().getParent();
        while(dir != null)
        {
            Path candidate = dir.resolve(file);
            if(Files.exists(candidate))
            {
                return candidate;
            }
            dir = dir.getParent();
        }
        return file;
    }
}
