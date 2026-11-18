// How each Overdrive level looks: its name and its colours. The rules (charge, length, the
// multiplier, the grace) are in score.ts with main.GameScore. Free of DOM and three.js: the 3D
// stage (in its worker), the sky, the 2D fallback and the HUD all read the same table.
//
// Each level takes the whole field to a new palette: the tiles, the pads, the beams, the walls,
// the track and the sky.
//   I   Neon     purple and pink neon.
//   II  Eclipse  white and black: white light, the sky drained of colour.
//   III Prism    every colour at once, turning across the lanes.

export interface OverdriveLook {
  /** Shown in the callout and the HUD. */
  name: string;
  /** The four lanes' hues (degrees), left to right. */
  lanes: [number, number, number, number];
  /** Saturation and lightness of the lanes (0..1). */
  sat: number;
  light: number;
  /** How hard the stage's effects hit (1..5: streaks, sparks, storms). */
  power: number;
  /** White and black: the sky loses its colour too. */
  mono?: boolean;
  /** The colours turn (PRISM_SPIN). */
  prism?: boolean;
}

/** Index = level (0 is unused: no Overdrive). */
export const OVERDRIVE_LOOKS: OverdriveLook[] = [
  { name: '', lanes: [0, 0, 0, 0], sat: 0, light: 0, power: 0 },
  { name: 'Neon', lanes: [276, 296, 314, 330], sat: 1, light: 0.64, power: 2 },
  { name: 'Eclipse', lanes: [0, 0, 0, 0], sat: 0, light: 0.93, power: 3.5, mono: true },
  { name: 'Prism', lanes: [0, 90, 180, 270], sat: 1, light: 0.66, power: 5, prism: true },
];

/** The levels as the callouts and the HUD write them (index = level). */
export const OVERDRIVE_ROMAN = ['', 'I', 'II', 'III'];

/** How fast Prism's colours turn (degrees a second). */
export const PRISM_SPIN = 120;

const lookAt = (level: number) => OVERDRIVE_LOOKS[Math.max(1, Math.min(OVERDRIVE_LOOKS.length - 1, level))];

/** A lane's hue at a level, `t` seconds in (Prism turns). */
export function overdriveHue(level: number, lane: number, t: number): number {
  const look = lookAt(level);
  const h = look.lanes[Math.max(0, Math.min(3, lane))];
  return look.prism ? (h + t * PRISM_SPIN) % 360 : h;
}

/** A level's saturation (%): 0 for Eclipse, whose light is white. */
export const overdriveSat = (level: number) => Math.round(lookAt(level).sat * 100);

/**
 * The two hues (outer lanes) a level tints the scene to, as songs' `hues` are; null for Eclipse,
 * which keeps the song's hues and drains the colour instead (the sky's `overdrive` event).
 */
export function overdriveHues(level: number, t = 0): [number, number] | null {
  if (lookAt(level).mono) return null;
  return [overdriveHue(level, 0, t), overdriveHue(level, 3, t)];
}

/** CSS custom properties for a level's colour: --od (hue) and --ods (saturation). */
export function overdriveVars(level: number, lane = 1, t = 0, names: [string, string] = ['--od', '--ods']): Record<string, string | number> {
  return { [names[0]]: overdriveHue(level, lane, t), [names[1]]: `${overdriveSat(level)}%` };
}

/** A level's colour on a lane as CSS (`light`: lightness %). */
export const overdriveCss = (level: number, lane: number, t: number, light: number) =>
  `hsl(${overdriveHue(level, lane, t)} ${overdriveSat(level)}% ${light}%)`;
