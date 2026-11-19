// Playing through the controller: every key press and the song's clock go to main.Main on the
// server (POST /api/play: backend PlayController), and what comes back is the model's state (Main's
// Score and queue), which the run panel and the results show as the controller's count.
//
// The game still judges each press here at once (a hit can't wait on the network); the controller
// gets the same presses, in order, a quarter of a second at a time, and counts the run by its own
// rules. Nothing here keeps a copy of the model's state beyond the last answer it gave. If the
// server can't be reached, the run plays on and the panel says the controller isn't counting.

import { api } from '../api/client';
import type { Difficulty, PlayInput, PlayState } from '../api/types';

/** How often what was played goes to the controller (seconds of song). */
const EVERY = 0.25;

export type LinkStatus = 'starting' | 'on' | 'off';

export class ControllerLink {
  private run: string | null = null;
  private queue: PlayInput[] = [];
  private sending = false;
  private lastTick = -Infinity;
  private dead = false;
  private timer = 0;
  status: LinkStatus = 'starting';
  /** The model's state, as the controller last gave it. */
  state: PlayState | null = null;

  /** `part`: practice mode's stretch (seconds of song): the controller plays only that (Song.getChartBetween). */
  constructor(songId: string, difficulty: Difficulty, private onState: (s: PlayState | null, status: LinkStatus) => void, part?: { from: number; to: number }) {
    api.startPlay(songId, difficulty, part).then((r) => {
      if (this.dead) return;
      this.run = r.run;
      this.set(r.state, 'on');
      this.timer = window.setInterval(() => void this.flush(), EVERY * 1000);
    }, () => { if (!this.dead) this.set(null, 'off'); });
  }

  private set(s: PlayState | null, status: LinkStatus) {
    this.state = s;
    this.status = status;
    this.onState(s, status);
  }

  /** A key press in `lane` at `time` (seconds of song from beat 0). */
  press(lane: number, time: number) {
    if (this.status === 'off' || this.dead) return;
    this.queue.push({ lane, time: Math.max(0, time) });
  }

  /** The song's clock (each frame: sent at most every EVERY seconds). */
  tick(time: number) {
    if (this.status === 'off' || this.dead || time < 0 || time - this.lastTick < EVERY) return;
    this.lastTick = time;
    this.queue.push({ time });
  }

  private async flush() {
    if (!this.run || this.sending || !this.queue.length || this.dead) return;
    const batch = this.queue.splice(0, 500);
    this.sending = true;
    try {
      const r = await api.playInputs(this.run, batch);
      if (!this.dead) this.set(r.state, 'on');
    } catch {
      if (!this.dead) { this.set(this.state, 'off'); clearInterval(this.timer); }
    } finally {
      this.sending = false;
    }
  }

  /** The run is over: the last of it goes (with the clock at `time`), and the final state comes back. */
  async finish(time: number): Promise<PlayState | null> {
    clearInterval(this.timer);
    if (!this.run || this.status === 'off') return this.state;
    this.queue.push({ time: Math.max(0, time) });
    for (let i = 0; i < 40 && this.sending; i++) await new Promise((r) => setTimeout(r, 50));
    await this.flush();
    this.dead = true;
    return this.state;
  }

  /** Stops (a restart or leaving): nothing more is sent. */
  stop() {
    this.dead = true;
    clearInterval(this.timer);
  }
}
