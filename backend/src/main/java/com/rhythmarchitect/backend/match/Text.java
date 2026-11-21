package com.rhythmarchitect.backend.match;

import java.text.Collator;
import java.text.Normalizer;
import java.util.Comparator;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** How titles and artists are compared (the same rules as frontend/mock-server). */
public final class Text {

    private Text() {
    }

    private static final Pattern MARKS = Pattern.compile("\\p{M}+");

    /** Lowercase, no punctuation or accents, single spaces. */
    public static String norm(String s) {
        if (s == null) return "";
        String plain = MARKS.matcher(Normalizer.normalize(s, Normalizer.Form.NFKD)).replaceAll("");
        return plain.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    private static final Pattern BRACKETS = Pattern.compile("[(\\[][^)\\]]*[)\\]]");
    private static final Pattern FEAT = Pattern.compile("(?i)\\b(feat|ft)\\.?\\s.*$");

    /** A title without "(feat. ...)", "[Official Audio]" and the like. */
    public static String bare(String s) {
        return norm(FEAT.matcher(BRACKETS.matcher(s == null ? "" : s).replaceAll(" ")).replaceAll(" "));
    }

    /**
     * How well {@code have} matches what was typed for a search (the music's search, favourites):
     * {@link #match}, or 1 when it's a near miss ({@link #near}: "once dance" finds One Dance).
     */
    public static int searchMatch(String have, String typed) {
        int m = match(have, typed);
        return m > 0 ? m : near(have, typed) ? 1 : 0;
    }

    /**
     * What was typed is a slip away from {@code have}: every typed word of 3 letters or more is
     * within one edit (two from 7 letters; an edit is a letter added, dropped, changed, or two
     * swapped) of one of its words, or of the start of one for the last word (still being typed);
     * shorter words must be exact or start one. Or the two read the same with the spaces taken out
     * (one edit, two from 7 letters): "onedance". Nothing under 3 letters typed is near anything.
     */
    public static boolean near(String have, String typed) {
        String h = norm(have), q = norm(typed);
        String hs = h.replace(" ", ""), qs = q.replace(" ", "");
        if (qs.length() < 3 || hs.isEmpty()) return false;
        if (edits(hs, qs) <= slack(qs.length())) return true;
        String[] hw = h.split(" "), qw = q.split(" ");
        for (int i = 0; i < qw.length; i++) {
            String w = qw[i];
            boolean last = i == qw.length - 1, found = false;
            for (String x : hw) {
                if (x.equals(w) || (last && x.startsWith(w))) { found = true; break; }
                int tol = w.length() < 3 ? 0 : slack(w.length());
                if (tol > 0 && (edits(x, w) <= tol || (last && x.length() > w.length() && edits(x.substring(0, w.length()), w) <= tol))) { found = true; break; }
            }
            if (!found) return false;
        }
        return true;
    }

    private static int slack(int letters) {
        return letters >= 7 ? 2 : 1;
    }

    /** Edits between two words: letters added, dropped, changed, or two side by side swapped. */
    static int edits(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] d = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) d[i][0] = i;
        for (int j = 0; j <= m; j++) d[0][j] = j;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                d[i][j] = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a.charAt(i - 1) == b.charAt(j - 2) && a.charAt(i - 2) == b.charAt(j - 1)) {
                    d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
                }
            }
        }
        return d[n][m];
    }

    /** How well {@code have} matches what was typed: exact 4, starts with it 3, a whole word 2, inside 1. */
    public static int match(String have, String typed) {
        String h = norm(have), q = norm(typed);
        if (q.isEmpty()) return 0;
        if (h.equals(q)) return 4;
        if (h.startsWith(q)) return 3;
        String[] hw = h.split(" ");
        for (String w : hw) if (w.startsWith(q)) return 2;
        boolean every = true;
        for (String w : q.split(" ")) {
            boolean found = false;
            for (String x : hw) if (x.startsWith(w)) { found = true; break; }
            if (!found) { every = false; break; }
        }
        if (every) return 2;
        return h.contains(q) ? 1 : 0;
    }

    private static final Pattern VIDEO_ID = Pattern.compile(
        "(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\\.be/|music\\.youtube\\.com/watch\\?(?:.*&)?v=)([\\w-]{11})",
        Pattern.CASE_INSENSITIVE);

    /** A YouTube video id in a link someone pasted (watch, youtu.be, embed, shorts, music), or null. */
    public static String videoIdIn(String text) {
        if (text == null) return null;
        Matcher m = VIDEO_ID.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    public static boolean isVideoId(String s) {
        return s != null && s.matches("[\\w-]{11}");
    }

    // ------------------------------------------------------------ A to Z

    private static final Collator COLLATOR = Collator.getInstance(Locale.ENGLISH);
    static {
        COLLATOR.setStrength(Collator.PRIMARY); // case and accents ignored
    }
    private static final Pattern CHUNK = Pattern.compile("\\d+|\\D+");

    /** Compares like Intl.Collator('en', { sensitivity: 'base', numeric: true }): "Track 2" before "Track 10". */
    public static final Comparator<String> NATURAL = (a, b) -> {
        Matcher ma = CHUNK.matcher(a), mb = CHUNK.matcher(b);
        while (true) {
            boolean ha = ma.find(), hb = mb.find();
            if (!ha || !hb) return Boolean.compare(ha, hb);
            String x = ma.group(), y = mb.group();
            int c;
            if (Character.isDigit(x.charAt(0)) && Character.isDigit(y.charAt(0))) {
                c = new java.math.BigInteger(x).compareTo(new java.math.BigInteger(y));
            } else {
                c = COLLATOR.compare(x, y);
            }
            if (c != 0) return c;
        }
    };
}
