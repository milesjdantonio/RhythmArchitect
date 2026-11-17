// How each Overdrive level looks: its name and its colours. The rules (charge, length, the
// multiplier) are in score.ts with main.GameScore. Free of DOM and three.js: the 3D stage (in its
// worker), the 2D fallback and the HUD all read the same table.
//
// Each level takes the whole field to a new palette: the tiles, the pads, the beams, the walls,
// the track and the sky. Level 5 is every colour at once, turning across the lanes.

export interface OverdriveLook {
  /** Shown in the callout and the HUD. */
  name: string;
  /** The four lanes' hues (degrees), left to right. */
  lanes: [number, number, number, number];
  /** Saturation and lightness of the lanes (0..1). */
  sat: number;
  light: number;
}

/** Index = level (0 is unused: no Overdrive). */
export const OVERDRIVE_LOOKS: OverdriveLook[] = [
  { name: '', lanes: [0, 0, 0, 0], sat: 0, light: 0 },
  { name: 'Surge', lanes: [188, 196, 204, 212], sat: 1, light: 0.62 },
  { name: 'Plasma', lanes: [318, 296, 276, 258], sat: 1, light: 0.64 },
  { name: 'Aurora', lanes: [118, 142, 162, 178], sat: 0.95, light: 0.6 },
  { name: 'Inferno', lanes: [356, 14, 30, 44], sat: 1, light: 0.6 },
  { name: 'Prism', lanes: [0, 90, 180, 270], sat: 1, light: 0.66 },
];

/** How fast level 5's colours turn (degrees a second). */
export const PRISM_SPIN = 120;

/** A lane's hue at a level, `t` seconds in (level 5 turns). */
export function overdriveHue(level: number, lane: number, t: number): number {
  const look = OVERDRIVE_LOOKS[Math.max(1, Math.min(5, level))];
  const h = look.lanes[Math.max(0, Math.min(3, lane))];
  return level >= 5 ? (h + t * PRISM_SPIN) % 360 : h;
}

/** The two hues (outer lanes) a level tints the scene to, as songs' `hues` are. */
export function overdriveHues(level: number, t = 0): [number, number] {
  return [overdriveHue(level, 0, t), overdriveHue(level, 3, t)];
}
