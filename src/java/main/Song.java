package main;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * A song and its charts: one Queue of Notes per difficulty, in the order they are played.
 */
public class Song
{
    private Map<Difficulty, Queue<Note>> charts;
    private String title;
    private String artist;
    private double duration;
    private double bpm;

    /**
     * Initializes song information.
     *
     * @param title    the song's title (not null or blank)
     * @param artist   who it's by (not null or blank)
     * @param duration its length in seconds (more than 0)
     * @param bpm      its tempo in beats per minute (more than 0)
     * @throws IllegalArgumentException for a null or blank title or artist, or a duration or BPM
     *                                  of zero or less
     */
    public Song(String title, String artist, double duration, double bpm)
    {
        if(title == null || title.isBlank())
        {
            throw new IllegalArgumentException("A song needs a title.");
        }
        if(artist == null || artist.isBlank())
        {
            throw new IllegalArgumentException("A song needs an artist.");
        }
        if(!(duration > 0))
        {
            throw new IllegalArgumentException("A song's duration must be more than 0 seconds.");
        }
        if(!(bpm > 0))
        {
            throw new IllegalArgumentException("A song's BPM must be more than 0.");
        }
        this.title = title;
        this.artist = artist;
        this.duration = duration;
        this.bpm = bpm;
        charts = new EnumMap<Difficulty, Queue<Note>>(Difficulty.class);
    }

    /**
     * Return the note queue for the difficulty.
     *
     * @param difficulty which chart
     * @return its notes, or null when the difficulty is null or has no chart
     */
    public Queue<Note> getChart(Difficulty difficulty)
    {
        if(difficulty == null)
        {
            return null;
        }
        return charts.get(difficulty);
    }

    /**
     * Assigns a note queue to the difficulty.
     *
     * @param difficulty which chart
     * @param chart      its notes, in the order they are played
     * @throws IllegalArgumentException for a null difficulty or chart
     */
    public void setChart(Difficulty difficulty, Queue<Note> chart)
    {
        if(difficulty == null || chart == null)
        {
            throw new IllegalArgumentException("A chart needs a difficulty and its notes.");
        }
        charts.put(difficulty, chart);
    }

    /**
     * @return the song's title
     */
    public String getTitle()
    {
        return title;
    }

    /**
     * @return who it's by
     */
    public String getArtist()
    {
        return artist;
    }

    /**
     * @return its length in seconds
     */
    public double getDuration()
    {
        return duration;
    }

    /**
     * @return its tempo in beats per minute
     */
    public double getBpm()
    {
        return bpm;
    }

    /**
     * Returns the difficulties that have generated charts.
     *
     * @return them, easiest first (empty when there are none)
     */
    public List<Difficulty> getAvailableDifficulties()
    {
        List<Difficulty> difficulties = new ArrayList<Difficulty>();
        for(Difficulty option: Difficulty.values())
        {
            if(charts.containsKey(option))
            {
                difficulties.add(option);
            }
        }
        return difficulties;
    }

}
