import { describe, expect, it } from 'vitest'
import { COMPACTION_SQUIGGLE, compactionSquigglePath } from './compaction-squiggle'

// The Claude app's compaction divider rule: `n030.f` (n030.java:459-482) draws `cg0` case 23
// (cg0.java:158-175) into a spacer 4 dp tall: a path from (0, 2) of quadratic segments 8 dp wide,
// whose control point alternates between the top edge (y 0) and the bottom edge (y 4) while the
// end point stays on the centre line (y 2); stroked 1 dp, round cap.
describe('the compaction divider wavy line', () => {
  it("has the app's measures", () => {
    expect(COMPACTION_SQUIGGLE).toEqual({ height: 4, segment: 8, strokeWidth: 1 })
  })

  it('starts on the centre line and alternates its control points top then bottom', () => {
    expect(compactionSquigglePath(32)).toBe('M0 2 Q4 0 8 2 Q12 4 16 2 Q20 0 24 2 Q28 4 32 2')
  })

  it('runs past the end by the part of a segment that is left, and is clipped there', () => {
    // cg0.java:164: the loop runs while x < width, so a 20 dp rule has three segments.
    expect(compactionSquigglePath(20)).toBe('M0 2 Q4 0 8 2 Q12 4 16 2 Q20 0 24 2')
  })

  it('draws one segment for a rule narrower than a segment, and nothing for none', () => {
    expect(compactionSquigglePath(3)).toBe('M0 2 Q4 0 8 2')
    expect(compactionSquigglePath(0)).toBe('')
    expect(compactionSquigglePath(-5)).toBe('')
    expect(compactionSquigglePath(Number.NaN)).toBe('')
  })
})
