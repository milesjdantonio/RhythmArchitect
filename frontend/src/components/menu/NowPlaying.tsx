import { DIFFICULTIES, type Difficulty, type Song } from '../../api/types';
import { useState } from 'react';
import { href, navigate } from '../../lib/router';
import { updateSong } from '../../library/songs';
import { Cover } from '../Cover';
import { DifficultyPicker } from './DifficultyPicker';
import { Icon } from '../Icon';
import { VideoSlot } from '../VideoSlot';

interface Props {
  song: Song;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  previewing: boolean;
  /** Whether previews play (sound on), toggled by the preview button. */
  sound: boolean;
  /** Previews are on but the browser is still waiting for a first click to allow sound. */
  waiting: boolean;
  onSound: () => void;
}

/**
 * The very bottom of the gameplay side: the song on stage, Preview and Play, and the difficulty.
 * A YouTube song's video has its own spot here, on the left, in place of the cover: it plays there
 * with the preview, so it never covers the stage. Until then the spot says how to start it.
 */
export function NowPlaying({ song, difficulty, onDifficulty, previewing, sound, waiting, onSound }: Props) {
  const counts = Object.fromEntries(DIFFICULTIES.map((d) => [d, song.charts[d].notes.length])) as Record<Difficulty, number>;
  const [error, setError] = useState('');
  const [starPop, setStarPop] = useState(false);
  // Also the button's name, so it says its state even when the bar is compact (icon only).
  const previewState = waiting ? 'Sound on' : sound ? (previewing ? 'Preview playing' : 'Preview on') : 'Preview off';
  const video = song.source.kind === 'youtube';
  // The close button sits in the bar's top-right corner.
  const close = <button type="button" className="btn btn-ghost btn-icon btn-sm now-close" onClick={() => navigate(href.home())} aria-label="Close song"><Icon name="close" size={16} /></button>;
  const rest = waiting ? 'Click anywhere for sound' : !sound ? 'Turn the preview on to watch' : 'The video starts with the preview';

  return (
    <section className={`now-playing ${video ? 'has-video' : ''}`} aria-labelledby="now-title">
      {video && (
        <VideoSlot key={song.id} className="now-video" rest={
          <>
            <span className="now-video-art" style={{ '--rA': song.hues[0], '--rB': song.hues[1] } as React.CSSProperties} aria-hidden />
            <span className="now-video-note"><span className="yt-mark" aria-hidden />{rest}</span>
          </>
        } />
      )}
      <div className="now-id">
        {!video && <Cover id={song.id} hues={song.hues} src={song.cover} size={76} playing={previewing} />}
        <div className="now-text">
          <div className="now-title-row">
            <h2 id="now-title">{song.title}</h2>
            <button type="button" className={`fav-btn ${song.favorite ? 'is-on' : ''} ${starPop ? 'is-fresh' : ''}`} aria-pressed={song.favorite}
              aria-label={song.favorite ? 'Remove from favourites' : 'Add to favourites'} onAnimationEnd={() => setStarPop(false)}
              onClick={() => { setError(''); setStarPop(!song.favorite); updateSong(song.id, { favorite: !song.favorite }).catch((e) => setError((e as Error).message)); }}>
              <Icon name="star" filled={song.favorite} size={17} />
            </button>
          </div>
          <p className="now-artist">{song.artist}</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="now-actions">
        <button type="button" className={`btn preview-btn ${previewing ? 'is-live' : ''}`} onClick={onSound} aria-pressed={sound}
          aria-label={previewState} title={sound ? 'Mute the preview' : 'Play the preview with sound'}>
          <Icon name={!sound ? 'muted' : previewing ? 'wave' : 'sound'} size={16} /> <span className="btn-text">{previewState}</span>
        </button>
        <a className="btn btn-primary play-btn" href={href.play(song.id, difficulty)} aria-label={`Play ${difficulty}`}><Icon name="play" /> Play<span className="btn-text"> {difficulty}</span></a>
      </div>
      <DifficultyPicker value={difficulty} onChange={onDifficulty} counts={counts} best={song.best} />
      {close}
    </section>
  );
}
