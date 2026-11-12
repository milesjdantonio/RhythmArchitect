
package main;

/**
 * Keeps track of the player's score during a rhythm game.
 * Records hits, misses, combos, and accuracy.
 */
public class Score
{
    private int score;
    private int highScore;
    private int combo;
    private int maxCombo;
    private double accuracy;
    private int perfectHits;
    private int greatHits;
    private int goodHits;
    private int missedHits;

    /**
     * Creates a Score with all statistics set to zero.
     */
    public Score()
    {
        reset();
        highScore = 0;
    }

    /**
     * Records a successful hit and updates the score and combo.
     *
     * @param result the type of hit
     */
    public void addHit(HitResult result)
    {
        if(result == null)
        {
            return;
        }

        if(result == HitResult.MISS)
        {
            addMiss();
            return;
        }

        if(result == HitResult.PERFECT)
        {
            score += 100;
            perfectHits++;
        }
        else if(result == HitResult.GOOD)
        {
            score += 75;
            greatHits++;
        }
        else if(result == HitResult.EARLY
            || result == HitResult.LATE)
        {
            score += 50;
            goodHits++;
        }

        combo++;

        if(combo > maxCombo)
        {
            maxCombo = combo;
        }

        if(score > highScore)
        {
            highScore = score;
        }

        updateAccuracy();
    }

    /**
     * Records a missed note and resets the current combo.
     */
    public void addMiss()
    {
        missedHits++;
        combo = 0;
        updateAccuracy();
    }

    /**
     * Updates accuracy based on all attempted notes.
     */
    private void updateAccuracy()
    {
        int total = getHits() + missedHits;

        if(total == 0)
        {
            accuracy = 0;
        }
        else
        {
            double points = perfectHits * 100
                + greatHits * 75
                + goodHits * 50;

            accuracy = points / (total * 100.0) * 100;
        }
    }

    /**
     * @return the player's current score
     */
    public int getScore()
    {
        return score;
    }

    /**
     * @return the highest score reached
     */
    public int getHighScore()
    {
        return highScore;
    }

    /**
     * @return the current combo
     */
    public int getCombo()
    {
        return combo;
    }

    /**
     * @return the highest combo reached
     */
    public int getMaxCombo()
    {
        return maxCombo;
    }

    /**
     * @return the number of successful hits
     */
    public int getHits()
    {
        return perfectHits + greatHits + goodHits;
    }

    /**
     * @return the number of missed notes
     */
    public int getMisses()
    {
        return missedHits;
    }

    /**
     * @return the player's accuracy percentage
     */
    public double getAccuracy()
    {
        return accuracy;
    }

    /**
     * Resets the player's current game statistics.
     */
    public void reset()
    {
        score = 0;
        combo = 0;
        maxCombo = 0;
        accuracy = 0;
        perfectHits = 0;
        greatHits = 0;
        goodHits = 0;
        missedHits = 0;
    }
}

