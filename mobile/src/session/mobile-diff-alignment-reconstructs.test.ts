// Whatever aligner ran (LCS, Myers past MAX_DIFF_CELLS, or the one replaced block past Myers'
// budget), the preview must draw each line of both files once, in order, on its own line number,
// and Myers must find as few changed rows as the LCS table would. Random edits over a small
// alphabet make long snakes and many equal-cost alignments, which is where a walk-back goes wrong.

import { describe, expect, it } from 'vitest'
import { buildMobileDiffLines, type MobileDiffLine } from './mobile-diff-lines'

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

function randomEdit(random: () => number, base: string[], edits: number): string[] {
  const next = [...base]
  for (let count = 0; count < edits; count += 1) {
    const at = Math.floor(random() * (next.length + 1))
    const roll = random()
    if (roll < 0.34 && next.length > 0) {
      next.splice(Math.min(at, next.length - 1), 1)
    } else if (roll < 0.67) {
      next.splice(at, 0, `x${Math.floor(random() * 5)}`)
    } else if (next.length > 0) {
      next[Math.min(at, next.length - 1)] = `y${Math.floor(random() * 5)}`
    }
  }
  return next
}

function lcsLength(a: string[], b: string[]): number {
  let previous = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Uint32Array(b.length + 1)
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0)
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

function sides(lines: MobileDiffLine[]): { old: string[]; new: string[] } {
  const old: string[] = []
  const next: string[] = []
  for (const line of lines) {
    if (line.kind !== 'add') {
      expect(line.oldLineNumber).toBe(old.length + 1)
      old.push(line.text)
    }
    if (line.kind !== 'delete') {
      expect(line.newLineNumber).toBe(next.length + 1)
      next.push(line.text)
    }
  }
  return { old, new: next }
}

describe('the mobile diff alignment', () => {
  it('draws every line of both files once, in order, with a minimal edit, past the LCS table', () => {
    const random = seeded(20_260_930)
    for (let round = 0; round < 12; round += 1) {
      // 700 x 700 is past MAX_DIFF_CELLS (200,000), and under the row cap once aligned.
      const base = Array.from({ length: 700 }, () => `l${Math.floor(random() * 7)}`)
      const a = randomEdit(random, base, 10)
      const b = randomEdit(random, base, 10)
      // What is left once the shared ends are trimmed is still past the table: Myers aligns it.
      let prefix = 0
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
        prefix += 1
      }
      let suffix = 0
      while (
        suffix + prefix < Math.min(a.length, b.length) &&
        a[a.length - suffix - 1] === b[b.length - suffix - 1]
      ) {
        suffix += 1
      }
      expect((a.length - prefix - suffix) * (b.length - prefix - suffix)).toBeGreaterThan(200_000)
      const result = buildMobileDiffLines(`${a.join('\n')}\n`, `${b.join('\n')}\n`)

      expect(result.truncated).toBe(false)
      expect(sides(result.lines)).toEqual({ old: a, new: b })
      const changedRows = result.lines.filter((line) => line.kind !== 'context').length
      expect(changedRows).toBe(a.length + b.length - 2 * lcsLength(a, b))
    }
  })

  it('draws both whole files, as one replaced block, when they share nothing', () => {
    const a = Array.from({ length: 1_000 }, (_, index) => `old-${index}`)
    const b = Array.from({ length: 1_000 }, (_, index) => `new-${index}`)
    const result = buildMobileDiffLines(`${a.join('\n')}\n`, `${b.join('\n')}\n`)

    expect(result.truncated).toBe(false)
    expect(sides(result.lines)).toEqual({ old: a, new: b })
    expect(result.lines.slice(0, 1_000).every((line) => line.kind === 'delete')).toBe(true)
  })

  it('draws nothing for two empty files, and one row for one line on either side', () => {
    expect(buildMobileDiffLines('', '')).toEqual({ lines: [], truncated: false })
    expect(buildMobileDiffLines('', 'a\n').lines).toEqual([
      { kind: 'add', text: 'a', newLineNumber: 1 }
    ])
    expect(buildMobileDiffLines('a\n', '').lines).toEqual([
      { kind: 'delete', text: 'a', oldLineNumber: 1 }
    ])
  })
})
