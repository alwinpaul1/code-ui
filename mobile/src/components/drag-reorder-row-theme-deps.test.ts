import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `DragReorderRow`'s row style reads `colors.bgRaised` / `colors.bgPanel` inside a
 * `useAnimatedStyle` worklet. The palette used to be a static import that never changed, so the
 * dependency array needed no entry for it; now it comes from `useTheme()` and can change on a
 * live appearance switch. `useAnimatedStyle`'s second argument is its own "recompute when this
 * changes" list (like `useMemo`'s), not only the web mapper's SharedValue inputs
 * (reanimated-web-mapper-deps.test.ts only checks `.value` reads, so it would not catch this).
 * Leaving `colors` out freezes a dragged row's background at whichever theme was active when it
 * last dragged.
 *
 * No behavioural test can see this: `src/test/react-native-reanimated-mock.ts` calls the
 * worklet factory directly on every render (`useAnimatedStyle = (factory) => factory()`), which
 * has no notion of a dependency array at all, so a render-level test would pass whether or not
 * `colors` is listed. This reads the source instead — the only instrument that can see a defect
 * of this shape (CLAUDE.md: "pin the actual defect, not a proxy near it").
 */
describe('the drag-reorder row style keeps up with a live theme switch', () => {
  it('lists `colors` in the rowStyle useAnimatedStyle dependency array', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'DragReorderList.tsx'),
      'utf8'
    )
    const match = source.match(
      /const rowStyle = useAnimatedStyle\(\(\) => \{[\s\S]*?\n {2}\}, \[([^\]]*)\]\)/
    )
    if (!match) {
      throw new Error('could not find the rowStyle useAnimatedStyle call to check')
    }
    const deps = match[1]!.split(',').map((dep) => dep.trim())
    expect(deps).toContain('colors')
  })
})
