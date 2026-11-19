package main;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Score: the spec's test plan for hit values, misses, combos, accuracy,
 * high scores, and reset behavior.
 */
class ScoreTest
{
    private Score score;

    @BeforeEach
    void setUp()
    {
        score = new Score();
    }

    @Test
    void startsAtZero()
    {
        assertEquals(0, score.getScore());
        assertEquals(0, score.getHighScore());
        assertEquals(0, score.getCombo());
        assertEquals(0, score.getMaxCombo());
        assertEquals(0, score.getHits());
        assertEquals(0, score.getMisses());
        assertEquals(0.0, score.getAccuracy());
    }

    @Test
    void recordsTheValueOfEverySuccessfulHit()
    {
        score.addHit(HitResult.PERFECT);
        score.addHit(HitResult.GOOD);
        score.addHit(HitResult.EARLY);
        score.addHit(HitResult.LATE);

        assertEquals(275, score.getScore());
        assertEquals(275, score.getHighScore());
        assertEquals(4, score.getHits());
        assertEquals(0, score.getMisses());
        assertEquals(4, score.getCombo());
        assertEquals(4, score.getMaxCombo());
    }

    @Test
    void missesResetTheComboAndIncreaseMisses()
    {
        score.addHit(HitResult.PERFECT);
        score.addHit(HitResult.PERFECT);
        score.addMiss();

        assertEquals(200, score.getScore());
        assertEquals(2, score.getMaxCombo());
        assertEquals(0, score.getCombo());
        assertEquals(2, score.getHits());
        assertEquals(1, score.getMisses());
    }

    @Test
    void aMissHitResultUsesTheSameMissRules()
    {
        score.addHit(HitResult.PERFECT);
        score.addHit(HitResult.MISS);

        assertEquals(100, score.getScore());
        assertEquals(0, score.getCombo());
        assertEquals(1, score.getHits());
        assertEquals(1, score.getMisses());
    }

    @Test
    void nullHitDoesNothing()
    {
        score.addHit(null);

        assertEquals(0, score.getScore());
        assertEquals(0, score.getHits());
        assertEquals(0, score.getMisses());
        assertEquals(0, score.getCombo());
        assertEquals(0.0, score.getAccuracy());
    }

    @Test
    void accuracyWeightsPerfectGoodAndEarlyLateHits()
    {
        score.addHit(HitResult.PERFECT);
        score.addHit(HitResult.GOOD);
        score.addHit(HitResult.EARLY);
        score.addHit(HitResult.LATE);
        score.addMiss();

        assertEquals(55.0, score.getAccuracy(), 1e-9);
    }

    @Test
    void highScoreKeepsTheBestScoreReached()
    {
        score.addHit(HitResult.PERFECT);
        score.addHit(HitResult.PERFECT);
        assertEquals(200, score.getHighScore());

        score.addMiss();
        score.reset();
        assertEquals(0, score.getScore());
        assertEquals(200, score.getHighScore());
    }

    @Test
    void resetClearsCurrentStatisticsButKeepsHighScore()
    {
        score.addHit(HitResult.PERFECT);
        score.addHit(HitResult.PERFECT);
        score.addMiss();
        score.reset();

        assertEquals(0, score.getScore());
        assertEquals(200, score.getHighScore());
        assertEquals(0, score.getCombo());
        assertEquals(0, score.getMaxCombo());
        assertEquals(0, score.getHits());
        assertEquals(0, score.getMisses());
        assertEquals(0.0, score.getAccuracy());
    }
}
