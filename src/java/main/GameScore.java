package main;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

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
 * Overdrive level (0 to 3), so at most x8. Overdrive: accurate hits fill a charge (a PERFECT 3,
 * a GOOD 2, an EARLY or a LATE 1, a hold held to its end 3; a miss takes 20 away; when Overdrive
 * ends, run out or broken, it empties). With a full
 * charge (100) the player sets it off ({@link #startOverdrive()}): the charge empties and the
 * level goes up one, for the next {@link #OVERDRIVE_LENGTH} tiles judged. Setting it off again
 * while it runs (the charge fills again meanwhile) raises the level once more and starts the
 * length again, up to {@link #MAX_OVERDRIVE}; at the top level it can't be set off. A single miss
 * ends it (every level), except in its grace: from each press until the game ends the grace
 * ({@link #endGrace()}, {@link #OVERDRIVE_GRACE} seconds later) a miss doesn't. Otherwise it ends
 * when the length runs out: each tile judged uses one, and it drops on its own as the song plays,
 * {@link #OVERDRIVE_DRAIN} tiles' worth a second ({@link #passTime(double)}), so a sparse stretch
 * doesn't keep it going.</p>
 *
 * <p>A run's grade is its score against the best its chart allows ({@link #parScore(Queue)},
 * {@link #gradeFor(long, long, boolean)}), not its accuracy.</p>
 *
 * <p>The browser game counts the same way (frontend/src/game/score.ts, overdrive.ts); the server
 * replays each run through this class before it keeps a best score.</p>
 */
public class GameScore extends Score
{
    /** The charge Overdrive needs. */
    public static final int CHARGE_FULL = 100;
    /** The highest Overdrive level. */
    public static final int MAX_OVERDRIVE = 3;
    /** Tiles judged before Overdrive ends (48 before Nov 22: a second level was out of reach below Ultra). */
    public static final int OVERDRIVE_LENGTH = 60;
    /** Tiles' worth of Overdrive's length used up each second of the song, besides the tiles. */
    public static final double OVERDRIVE_DRAIN = 1.5;
    /** Seconds after each press when a miss doesn't end Overdrive (the game times it; 5 before Nov 22). */
    public static final double OVERDRIVE_GRACE = 3;
    /** The least share of the chart's best score ({@link #parScore(Queue)}) for an S, an A, a B and a C. */
    public static final double[] GRADE_SHARES = {0.85, 0.65, 0.45, 0.25};
    private static final String[] GRADES = {"S", "A", "B", "C"};
    /** The highest combo multiplier. */
    public static final int MAX_COMBO_MULTIPLIER = 5;
    /** Score's points are worth this many in the game's score (a PERFECT is 1,000). */
    public static final int POINT_SCALE = 10;
    /** What a stray press takes off the charge. */
    public static final int STRAY_CHARGE = 10;
    /** What a hold held to its end adds to the charge. */
    public static final int HOLD_CHARGE = 3;

    private long total;
    private int charge;
    private int overdrive;
    private double overdriveLeft;
    private boolean grace;

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
     * @return 3 for a PERFECT, 2 for a GOOD, 1 for an EARLY or a LATE, 0 for a miss
     */
    public static int chargeFor(HitResult result)
    {
        if(result == HitResult.PERFECT)
        {
            return 3;
        }
        if(result == HitResult.GOOD)
        {
            return 2;
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
     * Records a miss as Score does: the combo ends, the charge drops and Overdrive ends (every
     * level), unless it is in its grace.
     */
    @Override
    public void addMiss()
    {
        super.addMiss();
        fill(-20);
        if(overdrive > 0 && !grace)
        {
            endOverdrive();
        }
    }

    /**
     * Overdrive's grace is over: a miss ends it again.
     */
    public void endGrace()
    {
        grace = false;
    }

    /**
     * @return whether Overdrive is in its grace (set off a moment ago: a miss doesn't end it)
     */
    public boolean isGrace()
    {
        return grace;
    }

    /**
     * A held note held to its end: its bonus times the multiplier.
     *
     * @param seconds how long the note was held
     */
    public void addHoldDone(double seconds)
    {
        total += holdBonus(seconds) * POINT_SCALE * getMultiplier();
        fill(HOLD_CHARGE);
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
     * Sets off Overdrive with a full charge: the level goes up one and it lasts
     * {@link #OVERDRIVE_LENGTH} tiles from now.
     *
     * @return whether it started (false without a full charge, or at {@link #MAX_OVERDRIVE})
     */
    public boolean startOverdrive()
    {
        if(charge < CHARGE_FULL || overdrive >= MAX_OVERDRIVE)
        {
            return false;
        }
        charge = 0;
        overdrive++;
        overdriveLeft = OVERDRIVE_LENGTH;
        grace = true;
        return true;
    }

    private void fill(int amount)
    {
        charge = Math.max(0, Math.min(CHARGE_FULL, charge + amount));
    }

    /**
     * The song plays on: Overdrive's length drops by {@link #OVERDRIVE_DRAIN} a second, and it
     * ends when that runs it out. (The game and the server pass the time between tiles judged,
     * by the chart's times: RunReplay.)
     *
     * @param seconds how much of the song passed (to the millisecond; nothing when not positive)
     */
    public void passTime(double seconds)
    {
        // Whole milliseconds: the browser counts the same, to the last bit (frontend score.ts).
        long ms = Math.round(seconds * 1000);
        if(ms > 0)
        {
            spendOverdrive(ms * OVERDRIVE_DRAIN / 1000.0);
        }
    }

    private void spendOverdrive(double tiles)
    {
        if(overdrive == 0)
        {
            return;
        }
        overdriveLeft -= tiles;
        if(overdriveLeft <= 0)
        {
            endOverdrive();
        }
    }

    /**
     * Overdrive ends (run out, or a miss): every level, and the charge empties with it, so it
     * can't be set off again at once.
     */
    private void endOverdrive()
    {
        overdrive = 0;
        overdriveLeft = 0;
        grace = false;
        charge = 0;
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
        return (int) Math.ceil(overdriveLeft);
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
     * The highest score a chart allows: every tile PERFECT, every hold held to its end, Overdrive
     * set off the moment it's charged (its grace ending {@link #OVERDRIVE_GRACE} seconds later), on
     * the chart's clock (the k-th tile judged at the k-th tile's time). The chart is left as it was.
     * (frontend/src/game/score.ts parScore: the same.)
     *
     * @param chart the difficulty's notes
     * @return the best score
     */
    public static long parScore(Queue<Note> chart)
    {
        int n = chart.getSize();
        double[] times = new double[n];
        // A tile: {its time, -1}; a hold's end: {its time, its length in ms}.
        List<double[]> events = new ArrayList<double[]>();
        for (int i = 0; i < n; i++)
        {
            Note note = chart.dequeue();
            times[i] = note.getTimeStamp();
            events.add(new double[] {note.getTimeStamp(), -1});
            if (note.isHold() && note.getNoteLength() > 0)
            {
                events.add(new double[] {note.getTimeStamp() + note.getNoteLength(),
                    Math.round(note.getNoteLength() * 1000)});
            }
            chart.enqueue(note);
        }
        Arrays.sort(times);
        // In time; a hold ending with a tile ends first.
        events.sort((a, b) -> Math.abs(a[0] - b[0]) > 1e-6 ? Double.compare(a[0], b[0])
            : Boolean.compare(b[1] >= 0, a[1] >= 0));
        GameScore s = new GameScore();
        double graceUntil = Double.NEGATIVE_INFINITY;
        int judged = 0;
        for (double[] e : events)
        {
            if (s.isGrace() && e[0] >= graceUntil - 1e-6)
            {
                s.endGrace();
            }
            if (e[1] >= 0)
            {
                s.addHoldDone(e[1] / 1000.0);
            }
            else
            {
                if (judged > 0 && judged < n)
                {
                    s.passTime(times[judged] - times[judged - 1]);
                }
                judged++;
                s.addHit(HitResult.PERFECT);
            }
            if (s.startOverdrive())
            {
                graceUntil = e[0] + OVERDRIVE_GRACE;
            }
        }
        return s.getScore();
    }

    /**
     * A run's grade by its score against the chart's best (Nov 22: the number score, not the
     * accuracy): at least {@link #GRADE_SHARES} of it for S, A, B, C; less is D; a failed run F.
     * Simulated players on the bank's charts: a miss in 300 made 80-93% of the best, 1 in 100
     * 60-83%, 2 in 100 49-63%, 4 in 100 32-45%; every tile PERFECT without Overdrive 75-80%.
     *
     * @param score the run's score
     * @param par the chart's best ({@link #parScore(Queue)})
     * @param failed whether the run failed
     * @return S, A, B, C, D or F
     */
    public static String gradeFor(long score, long par, boolean failed)
    {
        if (failed)
        {
            return "F";
        }
        double share = par > 0 ? (double) score / par : 0;
        for (int i = 0; i < GRADES.length; i++)
        {
            if (share >= GRADE_SHARES[i])
            {
                return GRADES[i];
            }
        }
        return "D";
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
        grace = false;
    }
}
