/**
 * A line of light that traces a panel's frame when the menu comes in: it springs from the top
 * left corner and runs both ways round, meeting at the bottom right, then fades as the panel's
 * own hairline border appears (CSS in workspace.css, under "Entrance"). Invisible the rest of the time.
 */
export function FrameTrace({ r }: { r: number }) {
  return (
    <svg className="frame-trace" aria-hidden focusable="false">
      <rect width="100%" height="100%" rx={r} ry={r} pathLength={1} />
    </svg>
  );
}
