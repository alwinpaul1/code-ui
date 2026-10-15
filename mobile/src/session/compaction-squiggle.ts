// The wavy rule either side of the Claude app's compaction caption (com.anthropic.claude
// 1.261009.20). `n030.f` (n030.java:459-482) is a spacer of weight 1 and height 4 dp, drawn by `cg0`
// case 23 (cg0.java:158-175): start at (0, height / 2); for each segment of 8 dp (`density * 8`)
// from x = 0 while x < width, a quadratic curve to (x + 8, height / 2) whose control point is at
// x + 4 and alternates between the top edge (y 0) for the even segments and the bottom edge
// (y height) for the odd ones. Stroke 1 dp (`density * 1`), round cap (`e2x` cap 1, miter 0).
// The curve reaches halfway to its control point, so the wave swings 1 dp either side of the centre
// line and repeats every 16 dp.

export const COMPACTION_SQUIGGLE = { height: 4, segment: 8, strokeWidth: 1 } as const

/** The SVG path of a rule `width` dp wide; the last segment runs past the end and the view clips it. */
export function compactionSquigglePath(width: number): string {
  if (!Number.isFinite(width) || width <= 0) {
    return ''
  }
  const { height, segment } = COMPACTION_SQUIGGLE
  const middle = height / 2
  const parts = [`M0 ${middle}`]
  for (let x = 0, index = 0; x < width; x += segment, index += 1) {
    const control = index % 2 === 0 ? 0 : height
    parts.push(`Q${x + segment / 2} ${control} ${x + segment} ${middle}`)
  }
  return parts.join(' ')
}
