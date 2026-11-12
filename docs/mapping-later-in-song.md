# Why maps got worse after the first minute, and the fix

Play-testing *Through the Fire and Flames* (DragonForce, about 200 BPM) on Nov 11, 2026: the first
minute of the map was dense and on the music, and the rest felt thinner and less accurate. Two
causes, each making the opening look better than the rest. Fixed in commit `ba9b923` on main.

## 1. Fewer tiles later: a star rating is a difficulty, not an amount of notes

The trained mapper (Ensomi R2, `frontend/src/mapping/ensomi.ts`) is asked for a 2★ chart. That
sets how *hard* the chart is, not how many notes it has. To keep a fast, intense song at 2★, the
model eases its hardest parts. This song opens with a part it could chart densely, then held back
once the song got relentless.

| First 40 s | 60 s on |
|---|---|
| about 7 tiles a second | 2 to 4 tiles a second |

The recording was complete and as loud later as at the start, so the mapper did hear those parts.

**Fix:** the full chart is judged 10 seconds at a time against about two tiles a beat, more or
fewer as that stretch has more or fewer sounds (`ultraTargets`; `hardTargets` before the Ultra
difficulty, when Hard was the full chart). While under 85% of that is met,
the song is charted again a star busier (up to 4★, at most three charts, reusing the analysis
already done) and each stretch takes its tiles from the chart nearest its target (`splice`).
Every tile is still one the model placed on a sound it heard.

On 5-minute, 200 BPM test tracks the full chart went from 1,491-2,357 tiles to 2,131-2,781,
spread evenly through the song. Songs at normal tempos already meet the target and are charted
once, as before.

## 2. Less accurate later: tiles were nudged onto a grid the song doesn't follow

The game turns the song's tempo into a straight grid of beats, and moved sounds up to 20 ms onto
it (and tiles up to 15 ms onto those sounds) to make patterns tidy. That's right when the song's
beat stays on one straight grid. This song's beat fit one straight grid only 59% of the time: a
real band speeds up and slows down slightly. Where the beat ran off the grid, the nudge moved
tiles away from the sound, up to 35 ms in all, against a ±45 ms Perfect window.

In the opening the grid was clearly off, so tiles weren't nudged and stayed on the sound (28-31%
on a 16th). Later the grid was nearly right, so most were nudged (84-96%), slightly wrong.

**Fix:** sounds go onto the grid only where the song's sounds line up with it right there: they
peak sharply on its 16ths, not off to one side (`gridHolds` in `frontend/src/mapping/automap.ts`).
Everywhere else tiles keep the moment they were heard. "On the beat" checks allow 20 ms, so
accent chords and the easier difficulties' preference for on-beat tiles don't depend on the nudge.

| Test track | Beat fits one straight grid | Grid holds (sounds nudged) |
|---|---|---|
| Funkorama, Trips It | 95-100% | 96-97% of the song, as before |
| Slow Burn (drifting tempo) | 39% | 11% |

## Ruled out

- **The recording drifting against the video:** 30 ms over the whole 5-minute song, nearly all in
  the first 40 s.
- **Sound missing from the recording:** none in that listen. A listen that misses more than 5% of
  the song (at least 8 s) is now an error with a retry instead of a thin map (`holesIn`,
  `missLimit` in `frontend/src/mapping/capture.ts`).

## Checking a song

After generating, the dev tools (` key) show both:

- **Beat:** how much of the song the grid held over.
- **Mapper:** whether the song was charted again and how much of its target each chart met.
