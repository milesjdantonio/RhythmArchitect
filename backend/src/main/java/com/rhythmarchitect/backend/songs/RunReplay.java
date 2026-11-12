package com.rhythmarchitect.backend.songs;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import main.GameScore;
import main.HitResult;

/**
 * A finished run counted again on the server, through the game's model classes ({@link GameScore},
 * which is {@code main.Score} with the game's multiplier and holds on top), before its best score
 * is kept. The run is the results in order, as the game recorded them (frontend/src/game/score.ts):
 * P, G, E, L for a PERFECT, GOOD, EARLY or LATE hit, M for a miss, H&lt;ms&gt;; for a held note held
 * its length in milliseconds, B for one let go early.
 */
public final class RunReplay {
    private static final Pattern VALID = Pattern.compile("(?:[PGELMB]|H\\d{1,7};)*");
    private static final Pattern TOKEN = Pattern.compile("[PGELMB]|H(\\d+);");

    /** The score (with the multiplier and the holds), Score's accuracy as a share (0..1) and max combo. */
    public record Result(long score, double accuracy, int maxCombo) {
    }

    private RunReplay() {
    }

    /** The run counted through GameScore, or null when it isn't one. */
    public static Result of(String run) {
        if (run == null || run.length() > 400_000 || !VALID.matcher(run).matches()) return null;
        GameScore s = new GameScore();
        Matcher m = TOKEN.matcher(run);
        while (m.find()) {
            if (m.group(1) != null) {
                s.addHoldDone(Integer.parseInt(m.group(1)) / 1000.0);
                continue;
            }
            switch (m.group().charAt(0)) {
                case 'P' -> s.addHit(HitResult.PERFECT);
                case 'G' -> s.addHit(HitResult.GOOD);
                case 'E' -> s.addHit(HitResult.EARLY);
                case 'L' -> s.addHit(HitResult.LATE);
                case 'M' -> s.addMiss();
                default -> s.addHoldBroken();
            }
        }
        return new Result(s.getScore(), s.getAccuracy() / 100, s.getMaxCombo());
    }

    /** The grade for an accuracy (frontend/src/game/engine.ts gradeFor). */
    public static String gradeFor(double accuracy, boolean failed) {
        if (failed) return "F";
        if (accuracy >= 0.95) return "S";
        if (accuracy >= 0.9) return "A";
        if (accuracy >= 0.8) return "B";
        if (accuracy >= 0.7) return "C";
        return "D";
    }
}
