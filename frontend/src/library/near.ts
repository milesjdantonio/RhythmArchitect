// How the song search matches what was typed (the backend's Text.match and Text.searchMatch, the
// same rules and the same cases: tests/unit/search.test.ts, MappingTests): exact, the start, a
// whole word, inside, and near misses ("once dance" finds One Dance; the user, Nov 20).

/** Lowercase, no punctuation or accents, single spaces: how titles and artists are compared. */
export const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How well `have` matches what was typed: exact 4, starts with it 3, a whole word 2, inside 1. */
export function match(have: string, typed: string) {
  const h = norm(have), q = norm(typed);
  if (!q) return 0;
  if (h === q) return 4;
  if (h.startsWith(q)) return 3;
  if (h.split(' ').some((w) => w.startsWith(q)) || q.split(' ').every((w) => h.split(' ').some((x) => x.startsWith(w)))) return 2;
  return h.includes(q) ? 1 : 0;
}

/** `match`, or 1 for a near miss (`near`). */
export const searchMatch = (have: string, typed: string) => match(have, typed) || (near(have, typed) ? 1 : 0);

const slack = (letters: number) => (letters >= 7 ? 2 : 1);

/**
 * What was typed is a slip away from `have`: every typed word of 3 letters or more within one edit
 * (two from 7 letters; an edit is a letter added, dropped, changed, or two side by side swapped)
 * of one of its words, or of the start of one for the last word (still being typed); shorter words
 * exact or the start of one. Or the two read the same with the spaces taken out ("onedance").
 * Nothing under 3 letters typed is near anything.
 */
export function near(have: string, typed: string): boolean {
  const h = norm(have), q = norm(typed);
  const hs = h.replace(/ /g, ''), qs = q.replace(/ /g, '');
  if (qs.length < 3 || !hs) return false;
  if (edits(hs, qs) <= slack(qs.length)) return true;
  const hw = h.split(' '), qw = q.split(' ');
  return qw.every((w, i) => {
    const last = i === qw.length - 1;
    const tol = w.length < 3 ? 0 : slack(w.length);
    return hw.some((x) => x === w || (last && x.startsWith(w))
      || (tol > 0 && (edits(x, w) <= tol || (last && x.length > w.length && edits(x.slice(0, w.length), w) <= tol))));
  });
}

/** Edits between two words: letters added, dropped, changed, or two side by side swapped. */
export function edits(a: string, b: string): number {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}
