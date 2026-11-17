package main;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/**
 * GameScore: Score's rules with the game's multiplier and holds on top. The run here is the one in
 * frontend/tests/unit/score.test.ts; the browser game must count it the same.
 */
class GameScoreTest
{
    /** "PPPPPPPPPPGEH1500;MLBP": the same run, call by call. */
    private static GameScore run()
    {
        GameScore s = new GameScore();
        for(int i = 0; i < 10; i++)
        {
            s.addHit(HitResult.PERFECT);
        }
        s.addHit(HitResult.GOOD);
        s.addHit(HitResult.EARLY);
        s.addHoldDone(1.5);
        s.addMiss();
        s.addHit(HitResult.LATE);
        s.addHoldBroken();
        s.addHit(HitResult.PERFECT);
        return s;
    }

    @Test
    void scoresWithTheMultiplierAndHoldsOnTopOfScore()
    {
        GameScore s = run();
        // x1 for the first 9, x2 from the 10th; the hold 180 x 2; after the miss x1 again.
        assertEquals((900 + 200 + 150 + 100 + 360 + 50 + 100) * GameScore.POINT_SCALE, s.getScore());
        assertEquals(11 * 100 + 75 + 50 + 50, s.getPoints());
        assertEquals(12, s.getMaxCombo());
        assertEquals(14, s.getHits());
        assertEquals(2, s.getMisses());
        assertEquals(1275.0 / 1600 * 100, s.getAccuracy(), 1e-9);
    }

    @Test
    void scoreRulesStillApply()
    {
        GameScore s = new GameScore();
        s.addHit(null);
        assertEquals(0, s.getScore());
        s.addHit(HitResult.MISS);
        assertEquals(1, s.getMisses());
        assertEquals(0, s.getCombo());
        s.addHit(HitResult.PERFECT);
        assertEquals(1000, s.getScore(), "a Perfect is 1,000");
        s.reset();
        assertEquals(0, s.getScore());
        assertEquals(0, s.getPoints());
        assertEquals(0, s.getMaxCombo());
    }

    @Test
    void multiplierAndHoldBonus()
    {
        assertEquals(1, GameScore.multiplierFor(0));
        assertEquals(1, GameScore.multiplierFor(9));
        assertEquals(2, GameScore.multiplierFor(10));
        assertEquals(4, GameScore.multiplierFor(30));
        assertEquals(5, GameScore.multiplierFor(40));
        assertEquals(5, GameScore.multiplierFor(500));
        assertEquals(120, GameScore.holdBonus(0.4));
        assertEquals(180, GameScore.holdBonus(1.5));
    }

    /** "PPPPPPPPPPPPPPPPPPPPOPPGMH1000;P": Overdrive set off once its charge is full. */
    @Test
    void overdriveAddsItsLevelToTheMultiplier()
    {
        GameScore s = new GameScore();
        assertEquals(false, s.startOverdrive(), "no charge yet");
        for(int i = 0; i < 20; i++)
        {
            s.addHit(HitResult.PERFECT);
        }
        assertEquals(GameScore.CHARGE_FULL, s.getCharge());
        assertEquals(true, s.isCharged());
        assertEquals(32000, s.getScore());
        assertEquals(true, s.startOverdrive());
        assertEquals(1, s.getOverdrive());
        assertEquals(0, s.getCharge());
        assertEquals(4, s.getMultiplier(), "x3 from the combo, +1");
        s.addHit(HitResult.PERFECT);
        s.addHit(HitResult.PERFECT);
        s.addHit(HitResult.GOOD);
        s.addMiss();
        assertEquals(GameScore.OVERDRIVE_LENGTH - 3 - GameScore.OVERDRIVE_MISS_COST, s.getOverdriveLeft());
        assertEquals(0, s.getCharge(), "the miss took the charge");
        s.addHoldDone(1.0);
        s.addHit(HitResult.PERFECT);
        // 3200, then 400 + 400 + 300 at x4, the hold 120 x 2, a Perfect x2; all times 10.
        assertEquals(47400, s.getScore());
        assertEquals(2375, s.getPoints());
        assertEquals(23, s.getMaxCombo());
        assertEquals(2375.0 / 2500 * 100, s.getAccuracy(), 1e-9);
    }

    @Test
    void overdriveStacksToFiveAndRunsOut()
    {
        GameScore s = new GameScore();
        for(int level = 1; level <= 6; level++)
        {
            for(int i = 0; i < 20; i++)
            {
                s.addHit(HitResult.PERFECT);
            }
            assertEquals(true, s.startOverdrive());
            assertEquals(Math.min(5, level), s.getOverdrive());
        }
        assertEquals(10, s.getMultiplier(), "x5 from the combo, +5");
        for(int i = 0; i < GameScore.OVERDRIVE_LENGTH; i++)
        {
            s.addHit(HitResult.PERFECT);
        }
        assertEquals(0, s.getOverdrive(), "it ran its length");
        assertEquals(5, s.getMultiplier());
        s.reset();
        assertEquals(0, s.getCharge());
        assertEquals(0, s.getOverdrive());
    }

    @Test
    void aStrayPressScoresNothingAndDrainsTheCharge()
    {
        GameScore s = new GameScore();
        for(int i = 0; i < 20; i++)
        {
            s.addHit(HitResult.PERFECT);
        }
        int score = s.getScore();
        s.addStray();
        assertEquals(score, s.getScore());
        assertEquals(GameScore.CHARGE_FULL - GameScore.STRAY_CHARGE, s.getCharge());
        assertEquals(false, s.startOverdrive());
    }
}
