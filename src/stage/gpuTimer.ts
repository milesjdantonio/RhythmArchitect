// How long the graphics chip takes per frame (the /demo meter's "GPU" line).
//   WebGL: the EXT_disjoint_timer_query_webgl2 extension around the frame (when the browser
//          exposes it; Chrome may not, and then the meter says so).
//   WebGPU: three.js's timestamp queries (renderer created with trackTimestamp).
// Results arrive a few frames late; `ms` is smoothed.

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class GpuTimer {
  ms = 0;
  available = false;
  private gl: WebGL2RenderingContext | null = null;
  private ext: TimerExt | null = null;
  private queries: WebGLQuery[] = [];
  private open: WebGLQuery | null = null;
  private resolving = false;
  /** WebGPU: frames drawn since the last resolve (a resolve covers all of them). */
  private frames = 0;

  /** `renderer`: a WebGLRenderer, or a WebGPURenderer created with trackTimestamp. */
  constructor(private renderer: unknown, private webgpu: boolean) {
    if (webgpu) { this.available = true; return; }
    const gl = (renderer as { getContext(): WebGL2RenderingContext }).getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    if (ext) { this.gl = gl; this.ext = ext; this.available = true; }
  }

  begin() {
    const { gl, ext } = this;
    if (!gl || !ext || this.open) return;
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.open = q;
  }

  end() {
    if (this.webgpu) { this.resolveWebGPU(); return; }
    const { gl, ext } = this;
    if (!gl || !ext || !this.open) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.queries.push(this.open);
    this.open = null;
    // Read the oldest finished ones.
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.queries.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) this.note(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    if (this.queries.length > 8) { for (const q of this.queries.splice(0, this.queries.length - 8)) gl.deleteQuery(q); }
  }

  private resolveWebGPU() {
    this.frames++;
    if (this.resolving) return;
    const n = this.frames;
    this.frames = 0;
    const r = this.renderer as { resolveTimestampsAsync(t: string): Promise<number | undefined> };
    this.resolving = true;
    r.resolveTimestampsAsync('render').then((ms) => { if (typeof ms === 'number' && ms > 0) this.note(ms / n); }).catch(() => {}).finally(() => { this.resolving = false; });
  }

  /** The longest frame since `takePeak()` was last called (ms). */
  private peak = 0;
  takePeak() { const p = this.peak; this.peak = 0; return p; }

  private note(ms: number) { this.ms = this.ms ? this.ms + (ms - this.ms) * 0.1 : ms; this.peak = Math.max(this.peak, ms); }
}
