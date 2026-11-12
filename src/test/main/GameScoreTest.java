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
        assertEquals(900 + 200 + 150 + 100 + 360 + 50 + 100, s.getScore());
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
        assertEquals(100, s.getScore());
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
        assertEquals(4, GameScore.multiplierFor(500));
        assertEquals(120, GameScore.holdBonus(0.4));
        assertEquals(180, GameScore.holdBonus(1.5));
    }
}
