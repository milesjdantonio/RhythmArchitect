// A tiny event bus so the game and audio can make the background react without prop drilling.

export interface BusEvents {
  /** A beat of the song. `downbeat` is the first beat of a bar. */
  beat: { downbeat: boolean };
  /** A tile was hit. `lane` 0..1 position across the playfield. */
  hit: { judgement: 'perfect' | 'great' | 'good'; x: number };
  miss: { x: number };
  /** 0 calm .. 1 everything goes (combo level, song playing). */
  intensity: number;
  /** Tint the scene to a song's hues; null returns to the house colours. */
  hues: [number, number] | null;
  /** A new section of the song started (from the map). */
  section: { label: string; index: number };
  /** Fever (x4) started or ended. */
  fever: { on: boolean };
  /** A combo milestone (every 25 in a row). */
  milestone: { combo: number };
  /** The player typed in the song search (`length` = characters in both fields). */
  typing: { length: number };
  /** The sky behind the track reacted (a burst, a ring, a storm) at this point of the page (0..1). */
  sky: { x: number; y: number; strength: number };
  /** A moment the visuals should react to (from the map's cues). */
  cue: { kind: 'build' | 'drop' | 'break' | 'flash'; strength: number };
}

type Handler<T> = (payload: T) => void;
const handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

export const bus = {
  on<K extends keyof BusEvents>(type: K, fn: Handler<BusEvents[K]>) {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => { set.delete(fn as Handler<never>); };
  },
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]) {
    handlers.get(type)?.forEach((fn) => (fn as Handler<BusEvents[K]>)(payload));
  },
};
