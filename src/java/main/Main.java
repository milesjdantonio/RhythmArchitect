package main;

import java.util.ArrayList;
import java.util.List;

/**
 * Controller for Rhythm Architect.
 * Handles player input, note timing, and communication
 * between the song and score.
 */
public class Main
{
    private Song song;
    private Score score;
    private double currentTime;
    private Queue<Note> notes;

    /**
     * Creates the controller with a song and difficulty.
     *
     * @param song the song being played
     * @param difficulty the selected difficulty
     */
    public Main(Song song, Difficulty difficulty)
    {
        if(song == null)
        {
            throw new IllegalArgumentException("Song cannot be null.");
        }

        this.song = song;
        score = new Score();
        currentTime = 0;

        notes = SongWriter.chartFor(song, difficulty);

        if(notes == null)
        {
            throw new IllegalArgumentException(
                "No chart available for this difficulty.");
        }
    }

    /**
     * Processes a player's key press.
     *
     * @param lane the lane pressed (0-3)
     * @param currentTime the time of the key press
     * @return the result of the hit, or null for invalid input
     */
    public HitResult processInput(int lane, double currentTime)
    {
        if(lane < 0 || lane > 3 || !Double.isFinite(currentTime)
            || currentTime < 0)
        {
            return null;
        }

        this.currentTime = currentTime;

        checkMissedNotes(currentTime);

        if(notes.isEmpty())
        {
            return HitResult.MISS;
        }

        Note next = notes.peek();

        if(next.getLane() != lane)
        {
            score.addMiss();
            return HitResult.MISS;
        }

        double difference = currentTime - next.getTimeStamp();
        double absoluteDifference = Math.abs(difference);

        if(absoluteDifference <= 0.10)
        {
            notes.dequeue();
            score.addHit(HitResult.PERFECT);
            return HitResult.PERFECT;
        }
        else if(absoluteDifference <= 0.20)
        {
            notes.dequeue();
            score.addHit(HitResult.GOOD);
            return HitResult.GOOD;
        }
        else if(absoluteDifference <= 0.30)
        {
            notes.dequeue();

            if(difference < 0)
            {
                score.addHit(HitResult.EARLY);
                return HitResult.EARLY;
            }
            else
            {
                score.addHit(HitResult.LATE);
                return HitResult.LATE;
            }
        }

        score.addMiss();
        return HitResult.MISS;
    }

    /**
     * Checks for notes that have passed their hit window.
     *
     * @param currentTime the current song time
     */
    public void checkMissedNotes(double currentTime)
    {
        if(!Double.isFinite(currentTime) || currentTime < 0)
        {
            return;
        }

        this.currentTime = currentTime;

        while(!notes.isEmpty())
        {
            Note next = notes.peek();

            if(currentTime > next.getTimeStamp() + 0.30)
            {
                notes.dequeue();
                score.addMiss();
            }
            else
            {
                break;
            }
        }
    }

    /**
     * Returns upcoming notes without removing them
     * from the actual song queue.
     *
     * @param count number of upcoming notes requested
     * @return a list containing the upcoming notes
     */
    public List<Note> getUpcomingNotes(int count)
    {
        List<Note> upcoming = new ArrayList<>();

        if(count <= 0)
        {
            return upcoming;
        }

        Queue<Note> temporary = new Queue<>();
        int size = notes.getSize();

        for(int i = 0; i < size; i++)
        {
            Note note = notes.dequeue();

            if(i < count)
            {
                upcoming.add(note);
            }

            temporary.enqueue(note);
        }

        while(!temporary.isEmpty())
        {
            notes.enqueue(temporary.dequeue());
        }

        return upcoming;
    }

    /**
     * @return the current score object
     */
    public Score getScore()
    {
        return score;
    }

    /**
     * @return the song being played
     */
    public Song getSong()
    {
        return song;
    }

    /**
     * @return the current song time
     */
    public double getCurrentTime()
    {
        return currentTime;
    }
}
