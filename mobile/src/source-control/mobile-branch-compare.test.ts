import { describe, expect, it } from 'vitest'
import type { GitBranchCompareResult } from '../../../src/shared/git-diff-compare-types'
import { gitBranchCompareResultSchema } from './git-compare-reply-schema'
import {
  buildMobileBranchCompareSection,
  canOpenMobileBranchCompareDiff,
  formatMobileBranchCompareSummary
} from './mobile-branch-compare'

describe('mobile branch compare helpers', () => {
  it('reads the barest compare reply the runtime contract allows', () => {
    // Since the #20950 port the mobile type is the reply schema's output, cut to what mobile
    // reads, so it no longer equals the host type and an equality pin cannot compile. What still
    // has to hold in lockstep: a reply with only the members the host contract requires is one
    // mobile reads, entry and all.
    const barest: GitBranchCompareResult = {
      summary: {
        baseRef: 'origin/main',
        baseOid: null,
        compareRef: 'HEAD',
        headOid: null,
        mergeBase: null,
        changedFiles: 1,
        status: 'ready'
      },
      entries: [{ path: 'a.ts', status: 'modified' }]
    }
    const parsed = gitBranchCompareResultSchema.safeParse(barest)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(barest)
  })

  it('sorts committed branch entries by path', () => {
    const section = buildMobileBranchCompareSection([
      { path: 'zeta.ts', status: 'modified' },
      { path: 'alpha.ts', status: 'added' }
    ])

    expect(section?.title).toBe('Committed on Branch')
    expect(section?.data.map((entry) => entry.path)).toEqual(['alpha.ts', 'zeta.ts'])
  })

  it('summarizes ready branch compares', () => {
    expect(
      formatMobileBranchCompareSummary({
        baseRef: 'origin/main',
        baseOid: 'a'.repeat(40),
        compareRef: 'HEAD',
        headOid: 'b'.repeat(40),
        mergeBase: 'c'.repeat(40),
        changedFiles: 2,
        commitsAhead: 1,
        errorMessage: undefined,
        status: 'ready'
      })
    ).toBe('2 files - 1 commit - vs origin/main')
  })

  it('only opens branch diffs when compare object ids are available', () => {
    expect(
      canOpenMobileBranchCompareDiff({
        baseRef: 'origin/main',
        baseOid: 'a'.repeat(40),
        compareRef: 'HEAD',
        headOid: 'b'.repeat(40),
        mergeBase: 'c'.repeat(40),
        changedFiles: 1,
        commitsAhead: undefined,
        errorMessage: undefined,
        status: 'ready'
      })
    ).toBe(true)

    expect(
      canOpenMobileBranchCompareDiff({
        baseRef: 'origin/main',
        baseOid: null,
        compareRef: 'HEAD',
        headOid: null,
        mergeBase: null,
        changedFiles: 0,
        commitsAhead: undefined,
        errorMessage: undefined,
        status: 'unborn-head'
      })
    ).toBe(false)
  })
})
