package main;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

public class Song
{
    private Map<Difficulty, Queue<Note>> charts;
    private String title;
    private String artist;
    private double duration;
    private double bpm;

    public Song(String title, String artist, double duration, double bpm)
    {
        this.title = title;
        this.artist = artist;
        this.duration = duration;
        this.bpm = bpm;
        charts = new EnumMap<Difficulty, Queue<Note>>(Difficulty.class);
    }

    /**
     * Return the note queue for the difficulty (null when it has no chart yet).
     */
    public Queue<Note> getChart(Difficulty difficulty)
    {
        return charts.get(difficulty);
    }

    /*
     * Assigns a note queue to the difficulty.
     */
    public void setChart(Difficulty difficulty, Queue<Note> chart)
    {
        charts.put(difficulty, chart);
    }

    public String getTitle()
    {
        return title;
    }

    public String getArtist()
    {
        return artist;
    }

    public double getDuration()
    {
        return duration;
    }

    public double getBpm()
    {
        return bpm;
    }

    /**
     * Returns the difficulties that have generated charts.
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
