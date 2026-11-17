package main;

/**
 * A run's score as the game counts it: {@link Score}'s rules wherever it has one, and what the
 * game adds where it has none.
 *
 * <p>From Score: a PERFECT is 100 points, a GOOD 75, an EARLY or a LATE 50; a miss scores nothing
 * and ends the combo; the accuracy, the hits, the misses and the max combo.</p>
 *
 * <p>Added: each hit's points times {@link #POINT_SCALE} (so a PERFECT is 1,000) and the
 * multiplier; a held note held to its end scores 120 a second (at least 120) times the scale and
 * the multiplier; one let go early ends the combo, which Score can only do by counting a miss, so
 * it counts as one. A stray press (a key that hit no tile) scores nothing and takes
 * {@link #STRAY_CHARGE} off the Overdrive charge, so mashing the keys doesn't fill it.</p>
 *
 * <p>The multiplier is the combo's (x1, then one more every 10 in a row, at most x5) plus the
 * Overdrive level (0 to 5), so at most x10. Overdrive: accurate hits fill a charge (a PERFECT 5,
 * a GOOD 3, an EARLY or a LATE 1, a hold held to its end 5; a miss takes 20 away). With a full
 * charge (100) the player sets it off ({@link #startOverdrive()}): the charge empties and the
 * level goes up one, for the next {@link #OVERDRIVE_LENGTH} tiles judged (a miss costs
 * {@link #OVERDRIVE_MISS_COST} of them). Setting it off again while it runs (the charge fills
 * again meanwhile) raises the level once more and starts the length again; at level 5 it only
 * starts the length again. When the length runs out the level drops back to 0.</p>
 *
 * <p>The browser game counts the same way (frontend/src/game/score.ts, overdrive.ts); the server
 * replays each run through this class before it keeps a best score.</p>
 */
public class GameScore extends Score
{
    /** The charge Overdrive needs. */
    public static final int CHARGE_FULL = 100;
    /** The highest Overdrive level. */
    public static final int MAX_OVERDRIVE = 5;
    /** Tiles judged before Overdrive ends. */
    public static final int OVERDRIVE_LENGTH = 48;
    /** What a miss takes off what is left of Overdrive. */
    public static final int OVERDRIVE_MISS_COST = 8;
    /** The highest combo multiplier. */
    public static final int MAX_COMBO_MULTIPLIER = 5;
    /** Score's points are worth this many in the game's score (a PERFECT is 1,000). */
    public static final int POINT_SCALE = 10;
    /** What a stray press takes off the charge. */
    public static final int STRAY_CHARGE = 10;

    private long total;
    private int charge;
    private int overdrive;
    private int overdriveLeft;

    /**
     * Creates a GameScore with all statistics set to zero.
     */
    public GameScore()
    {
        super();
        total = 0;
    }

    /**
     * The combo multiplier: 1, then one more every 10 in a row, at most 5.
     *
     * @param combo the current combo
     * @return the multiplier
     */
    public static int multiplierFor(int combo)
    {
        return 1 + Math.min(MAX_COMBO_MULTIPLIER - 1, Math.max(0, combo) / 10);
    }

    /**
     * The charge a hit adds.
     *
     * @param result the type of hit
     * @return 5 for a PERFECT, 3 for a GOOD, 1 for an EARLY or a LATE, 0 for a miss
     */
    public static int chargeFor(HitResult result)
    {
        if(result == HitResult.PERFECT)
        {
            return 5;
        }
        if(result == HitResult.GOOD)
        {
            return 3;
        }
        if(result == HitResult.EARLY || result == HitResult.LATE)
        {
            return 1;
        }
        return 0;
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
     * @return the multiplier now: the combo's plus the Overdrive level
     */
    public int getMultiplier()
    {
        return multiplierFor(getCombo()) + overdrive;
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
        if(result == HitResult.MISS)
        {
            // Score counts it through addMiss(), below.
            super.addHit(result);
            return;
        }
        int before = super.getScore();
        super.addHit(result);
        int gained = super.getScore() - before;
        total += (long) gained * POINT_SCALE * getMultiplier();
        fill(chargeFor(result));
        spendOverdrive(1);
    }

    /**
     * Records a miss as Score does: the combo ends, the charge drops and Overdrive runs down faster.
     */
    @Override
    public void addMiss()
    {
        super.addMiss();
        fill(-20);
        spendOverdrive(OVERDRIVE_MISS_COST);
    }

    /**
     * A held note held to its end: its bonus times the multiplier.
     *
     * @param seconds how long the note was held
     */
    public void addHoldDone(double seconds)
    {
        total += holdBonus(seconds) * POINT_SCALE * getMultiplier();
        fill(5);
    }

    /**
     * A stray press: a key that hit no tile. It scores nothing and drains the charge.
     */
    public void addStray()
    {
        fill(-STRAY_CHARGE);
    }

    /**
     * A held note let go early: the combo ends (a miss to Score).
     */
    public void addHoldBroken()
    {
        addMiss();
    }

    /**
     * Sets off Overdrive with a full charge: the level goes up one (at most 5) and it lasts
     * {@link #OVERDRIVE_LENGTH} tiles from now.
     *
     * @return whether it started (false without a full charge)
     */
    public boolean startOverdrive()
    {
        if(charge < CHARGE_FULL)
        {
            return false;
        }
        charge = 0;
        overdrive = Math.min(MAX_OVERDRIVE, overdrive + 1);
        overdriveLeft = OVERDRIVE_LENGTH;
        return true;
    }

    private void fill(int amount)
    {
        charge = Math.max(0, Math.min(CHARGE_FULL, charge + amount));
    }

    private void spendOverdrive(int tiles)
    {
        if(overdrive == 0)
        {
            return;
        }
        overdriveLeft -= tiles;
        if(overdriveLeft <= 0)
        {
            overdrive = 0;
            overdriveLeft = 0;
        }
    }

    /**
     * @return the charge, 0 to {@link #CHARGE_FULL}
     */
    public int getCharge()
    {
        return charge;
    }

    /**
     * @return whether Overdrive can be set off
     */
    public boolean isCharged()
    {
        return charge >= CHARGE_FULL;
    }

    /**
     * @return the Overdrive level, 0 (off) to {@link #MAX_OVERDRIVE}
     */
    public int getOverdrive()
    {
        return overdrive;
    }

    /**
     * @return the tiles left before Overdrive ends (0 when it is off)
     */
    public int getOverdriveLeft()
    {
        return overdriveLeft;
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
        charge = 0;
        overdrive = 0;
        overdriveLeft = 0;
    }
}
