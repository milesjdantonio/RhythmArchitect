package main;

/**
 * A run's score as the game counts it: {@link Score}'s rules wherever it has one, and what the
 * game adds where it has none.
 *
 * <p>From Score: a PERFECT is 100 points, a GOOD 75, an EARLY or a LATE 50; a miss scores nothing
 * and ends the combo; the accuracy, the hits, the misses and the max combo.</p>
 *
 * <p>Added: each hit's points times the combo multiplier (x1, then x2, x3, x4 every 10 in a row);
 * a held note held to its end scores 120 a second (at least 120) times the multiplier; one let go
 * early ends the combo, which Score can only do by counting a miss, so it counts as one.</p>
 *
 * <p>The browser game counts the same way (frontend/src/game/score.ts); the server replays each
 * run through this class before it keeps a best score.</p>
 */
public class GameScore extends Score
{
    private long total;

    /**
     * Creates a GameScore with all statistics set to zero.
     */
    public GameScore()
    {
        super();
        total = 0;
    }

    /**
     * The combo multiplier: 1, then one more every 10 in a row, at most 4.
     *
     * @param combo the current combo
     * @return the multiplier
     */
    public static int multiplierFor(int combo)
    {
        return 1 + Math.min(3, Math.max(0, combo) / 10);
    }

    /**
     * The points for a held note held to its end, before the multiplier.
     *
     * @param seconds how long the note is held
     * @return 120 a second, at least 120
     */
    public static long holdBonus(double seconds)
    {
        return Math.round(60 * Math.max(1, seconds) * 2);
    }

    /**
     * Records a hit as Score does, and adds its points times the multiplier.
     *
     * @param result the type of hit
     */
    @Override
    public void addHit(HitResult result)
    {
        if(result == null)
        {
            return;
        }
        int before = super.getScore();
        super.addHit(result);
        int gained = super.getScore() - before;
        total += (long) gained * multiplierFor(getCombo());
    }

    /**
     * A held note held to its end: its bonus times the multiplier.
     *
     * @param seconds how long the note was held
     */
    public void addHoldDone(double seconds)
    {
        total += holdBonus(seconds) * multiplierFor(getCombo());
    }

    /**
     * A held note let go early: the combo ends (a miss to Score).
     */
    public void addHoldBroken()
    {
        addMiss();
    }

    /**
     * @return the score with the multiplier and the holds
     */
    @Override
    public int getScore()
    {
        return (int) Math.min(Integer.MAX_VALUE, total);
    }

    /**
     * @return Score's own points: the hits without the multiplier or the holds
     */
    public int getPoints()
    {
        return super.getScore();
    }

    /**
     * Resets the run's statistics.
     */
    @Override
    public void reset()
    {
        super.reset();
        total = 0;
    }
}
