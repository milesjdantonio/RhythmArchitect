// A stand-in for YouTube's IFrame Player API, served in place of https://www.youtube.com/iframe_api
// in end-to-end tests. "Videos" are the bundled test tracks, played by an <audio> element; like
// the real player, it reports its position as a snapshot every so often (here every 100 ms), and
// the fake video ends after window.__fakeYtSeconds (default 40 s) to keep tests short.
// Unknown video ids fail the way an embed-blocked video does (error 150).
(() => {
  const SRC = { e2eInkFury1: '/audio/ink-and-fury.mp3', e2eRestless: '/audio/the-restless-stacks.mp3' };
  const LIMIT = () => Number(window.__fakeYtSeconds || 40);
  class Player {
    constructor(el, opts) {
      this.opts = opts;
      this.state = -1;
      this.reported = 0;
      const box = document.createElement('div');
      box.className = 'fake-yt';
      box.style.cssText = 'width:100%;height:100%;background:linear-gradient(135deg,#123,#312)';
      el.replaceWith(box);
      this.audio = document.createElement('audio');
      this.audio.preload = 'auto';
      box.appendChild(this.audio);
      window.__fakeYt = this;
      this.audio.addEventListener('playing', () => this.set(1));
      this.audio.addEventListener('pause', () => { if (this.state !== 0) this.set(2); });
      this.audio.addEventListener('waiting', () => this.set(3));
      setInterval(() => {
        this.reported = Math.min(LIMIT(), this.audio.currentTime);
        if (this.state === 1 && this.audio.currentTime >= LIMIT()) { this.set(0); this.audio.pause(); }
      }, 100);
      setTimeout(() => opts.events?.onReady?.({ target: this }), 30);
    }
    set(s) { this.state = s; this.opts.events?.onStateChange?.({ data: s }); }
    cueVideoById({ videoId }) {
      const src = SRC[videoId];
      if (!src) { setTimeout(() => this.opts.events?.onError?.({ data: 150 }), 30); return; }
      this.audio.addEventListener('loadeddata', () => this.set(5), { once: true });
      this.audio.src = src;
    }
    playVideo() { this.audio.play().catch(() => {}); }
    pauseVideo() { this.audio.pause(); }
    seekTo(s) { this.audio.currentTime = s; this.reported = s; }
    getCurrentTime() { return this.reported; }
    getDuration() { return this.audio.duration ? Math.min(LIMIT(), this.audio.duration) : 0; }
    getPlayerState() { return this.state; }
    setVolume() {}
    mute() { this.audio.muted = true; }
    unMute() { this.audio.muted = false; }
  }
  window.YT = { Player };
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
})();
