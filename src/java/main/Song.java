public class Song
{
    private Queue<Note> chart;
    private String title;
    private String artist;
    private double duration;
    private double bpm;

    public void Song(String title, String artist, double duration, double bpm)
    {
        this.title = title;
        this.artist = artist;
        this.duration = duration;
        this.bpm = bpm;
    }

    /**
     * Return the note queue for the difficulty.
     */
    public Queue<Note> getChart(Difficulty difficulty)
    {
        //COMING BACK

    }

    /*
     * Assigns a note queue to the difficulty.
     */
    public void setChart(Difficulty difficulty, Queue<Note> chart)
    {
        //COMING BACK
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
        List<Difficulty> difficulties = new List<Difficulty>;
        for(Difficulty option: Difficulty.values())
        {
            difficulties.add(option);
        }
        return difficulties;
    }

}