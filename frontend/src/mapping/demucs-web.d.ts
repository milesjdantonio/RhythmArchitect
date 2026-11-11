// Types for demucs-web (MIT; it ships none): the part stems.ts uses.
declare module 'demucs-web' {
  export interface Stereo { left: Float32Array; right: Float32Array }
  export class DemucsProcessor {
    constructor(options: {
      ort: unknown;
      modelPath?: string;
      sessionOptions?: object;
      onProgress?: (p: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onLog?: (phase: string, message: string) => void;
      onDownloadProgress?: (loaded: number, total: number) => void;
    });
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
    separate(left: Float32Array, right: Float32Array): Promise<{ drums: Stereo; bass: Stereo; other: Stereo; vocals: Stereo }>;
  }
  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string; TRACKS: string[] };
}
