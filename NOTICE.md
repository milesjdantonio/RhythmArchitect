# Notices and credits

## Bundled music (public/audio/)

| File | Piece | Credit | Licence |
|---|---|---|---|
| `ink-and-fury.mp3` | *Ink and Fury*, an organ toccata in C minor | Composed by Claude for [SchmollCrossword](https://github.com/milesjdantonio/SchmollCrossword) (its `library-p2.mp3`) | MIT, with the SchmollCrossword code |
| `the-restless-stacks.mp3` | *The Restless Stacks*, a danse macabre waltz in D minor | Composed by Claude for SchmollCrossword (its `library.mp3`) | MIT, with the SchmollCrossword code |

Both were rendered with the [GeneralUser GS](https://schristiancollins.com/generaluser.php) SoundFont
by S. Christian Collins, whose licence allows any use of music made with it. The files are unchanged
copies. Their beatmaps were made by this project's onset mapper (`npm run map`).

## Built-in fan chart

*One Dance* (Drake feat. WizKid & Kyla) is built in as a chart only: it plays from its YouTube video
(no audio is in this repository). Its tiles are the osu!mania 4K chart "Normal" by **Alkin098**
([beatmap set 1547743](https://osu.ppy.sh/beatmapsets/1547743)), re-timed from its 141 BPM timing
line to the song's 104 BPM (each tile keeps its exact time) and lined up with the video
(`frontend/mock-server/songs/tracks/one-dance.json`). Easy and Medium are thinned from it.

## Models the mapper runs in the browser

- **Beat This!** beat and downbeat tracker (Foscarin, Schlüter & Widmer, ISMIR 2024,
  [CPJKU/beat_this](https://github.com/CPJKU/beat_this)), MIT. `frontend/public/models/beat-this-small0.onnx`
  is the "small0" checkpoint as converted to ONNX by
  [ashudesai/songbird-models](https://huggingface.co/ashudesai/songbird-models) (`small0-v2.onnx`, MIT);
  `beat-this-mel.bin` is its mel filterbank, from [musetric/beat-this-onnx](https://huggingface.co/musetric/beat-this-onnx) (MIT).
- **Demucs v4** (htdemucs) source separation by Meta AI ([facebookresearch/demucs](https://github.com/facebookresearch/demucs)),
  MIT. Not in this repository: the browser downloads timcsy's ONNX export
  ([timcsy/demucs-web-onnx](https://huggingface.co/timcsy/demucs-web-onnx), MIT) once and caches it.
- **Ensomi R2** trained osu!mania 4K mapper ([sed-i/ensomi-r2](https://huggingface.co/sed-i/ensomi-r2)), MIT.
  Not in this repository: the browser downloads its files (pinned to commit
  `2bb35c61b1a4d725e9c4c1b40c0bc85f6be2651e`) once and caches it. Its `beatthis.onnx`,
  `beatthis-mel-filter.bin` and `beatthis-hann-window.bin` are from Beat This! (CPJKU, MIT; the notice
  ships with the model as `BeatThis-LICENSE.txt`). Run with [@ensomi/runtime](https://github.com/ensomi-labs/runtime)
  (Apache-2.0); its WebAssembly core and resampler tables are bundled into the site.
- Runtime libraries: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT),
  [demucs-web](https://github.com/timcsy/demucs-web) (MIT) and [fflate](https://github.com/101arrowz/fflate) (MIT).

## Fonts

Unbounded, Space Grotesk and JetBrains Mono come from [Fontsource](https://fontsource.org/) under the
SIL Open Font License 1.1.

## Code

- The Rive file writer (`tools/rive/riv.mjs`, `defs.json`) is ported from TerraSim; `defs.json` was
  extracted from [rive-runtime](https://github.com/rive-app/rive-runtime) (MIT).
- Runtime libraries: React, three.js, Tone.js, Rive web runtime, Motion. See package.json.
