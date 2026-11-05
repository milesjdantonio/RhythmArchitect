# Notices and credits

## Bundled music (public/audio/)

| File | Piece | Credit | Licence |
|---|---|---|---|
| `ink-and-fury.mp3` | *Ink and Fury*, an organ toccata in C minor | Composed by Claude for [SchmollCrossword](https://github.com/milesjdantonio/SchmollCrossword) (its `library-p2.mp3`) | MIT, with the SchmollCrossword code |
| `the-restless-stacks.mp3` | *The Restless Stacks*, a danse macabre waltz in D minor | Composed by Claude for SchmollCrossword (its `library.mp3`) | MIT, with the SchmollCrossword code |

Both were rendered with the [GeneralUser GS](https://schristiancollins.com/generaluser.php) SoundFont
by S. Christian Collins, whose licence allows any use of music made with it. The files are unchanged
copies. Their beatmaps were made by this project's onset mapper (`npm run map`).

## Fonts

Unbounded, Space Grotesk and JetBrains Mono come from [Fontsource](https://fontsource.org/) under the
SIL Open Font License 1.1.

## Code

- The Rive file writer (`tools/rive/riv.mjs`, `defs.json`) is ported from TerraSim; `defs.json` was
  extracted from [rive-runtime](https://github.com/rive-app/rive-runtime) (MIT).
- Runtime libraries: React, three.js, Tone.js, Rive web runtime, Motion. See package.json.
