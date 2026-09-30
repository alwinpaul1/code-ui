/**
 * The line alignment behind the mobile diff preview, as runs ("segments") rather than rows, so a
 * long file never has to become one row object per unchanged line before it is collapsed.
 *
 * Three aligners, cheapest-to-trust first:
 * - LCS over the whole file while it fits MAX_DIFF_CELLS (quadratic table). Its output is what the
 *   preview always drew for these files, row for row.
 * - Myers' O(ND) over what is left after the common prefix and suffix, for larger files with few
 *   edits. The prefix/suffix fallback alone drew every line between two separate edits as deleted
 *   and re-added, so two edits 900 lines apart in a 1,000-line file became 1,782 changed rows.
 * - One replaced block (the old prefix/suffix fallback) when Myers would need more than
 *   MAX_MYERS_EDITS edits or MAX_MYERS_WORK steps: a rewritten generated file stays responsive.
 */

export type DiffSegment =
  | { kind: 'context'; oldStart: number; newStart: number; length: number }
  | { kind: 'delete'; oldStart: number; length: number }
  | { kind: 'add'; newStart: number; length: number }

const MAX_DIFF_CELLS = 200_000
const MAX_MYERS_EDITS = 1_000
const MAX_MYERS_WORK = 5_000_000

/** Appends one row's worth of alignment, extending the last run when it is the same kind. */
function pushRun(
  segments: DiffSegment[],
  kind: DiffSegment['kind'],
  oldIndex: number,
  newIndex: number,
  length = 1
): void {
  if (length <= 0) {
    return
  }
  const last = segments[segments.length - 1]
  if (last && last.kind === kind) {
    last.length += length
    return
  }
  if (kind === 'context') {
    segments.push({ kind, oldStart: oldIndex, newStart: newIndex, length })
  } else if (kind === 'delete') {
    segments.push({ kind, oldStart: oldIndex, length })
  } else {
    segments.push({ kind, newStart: newIndex, length })
  }
}

/** Aligns `a` (old) against `b` (new) by line key; keys compare with `===`. */
export function alignDiffSegments(a: readonly string[], b: readonly string[]): DiffSegment[] {
  if (a.length * b.length <= MAX_DIFF_CELLS) {
    return lcsSegments(a, b)
  }
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix + prefix < a.length &&
    suffix + prefix < b.length &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  ) {
    suffix += 1
  }
  const segments: DiffSegment[] = []
  pushRun(segments, 'context', 0, 0, prefix)
  const oldMiddle = a.slice(prefix, a.length - suffix)
  const newMiddle = b.slice(prefix, b.length - suffix)
  const middle =
    oldMiddle.length * newMiddle.length <= MAX_DIFF_CELLS
      ? lcsSegments(oldMiddle, newMiddle)
      : (myersSegments(oldMiddle, newMiddle) ?? replacedBlock(oldMiddle.length, newMiddle.length))
  // The middle was aligned from 0; shift it past the prefix. A delete run carries no new-side
  // position and an add run no old-side one (nothing reads them), hence the 0s.
  for (const segment of middle) {
    pushRun(
      segments,
      segment.kind,
      segment.kind === 'add' ? 0 : segment.oldStart + prefix,
      segment.kind === 'delete' ? 0 : segment.newStart + prefix,
      segment.length
    )
  }
  pushRun(segments, 'context', a.length - suffix, b.length - suffix, suffix)
  return segments
}

function replacedBlock(oldLength: number, newLength: number): DiffSegment[] {
  const segments: DiffSegment[] = []
  pushRun(segments, 'delete', 0, 0, oldLength)
  pushRun(segments, 'add', 0, 0, newLength)
  return segments
}

function lcsSegments(a: readonly string[], b: readonly string[]): DiffSegment[] {
  const rowWidth = b.length + 1
  const dp = new Uint32Array((a.length + 1) * rowWidth)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i * rowWidth + j] =
        a[i] === b[j]
          ? dp[(i + 1) * rowWidth + j + 1] + 1
          : Math.max(dp[(i + 1) * rowWidth + j], dp[i * rowWidth + j + 1])
    }
  }
  const segments: DiffSegment[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushRun(segments, 'context', i, j)
      i += 1
      j += 1
    } else if (dp[(i + 1) * rowWidth + j] >= dp[i * rowWidth + j + 1]) {
      pushRun(segments, 'delete', i, j)
      i += 1
    } else {
      pushRun(segments, 'add', i, j)
      j += 1
    }
  }
  pushRun(segments, 'delete', i, j, a.length - i)
  pushRun(segments, 'add', a.length, j, b.length - j)
  return segments
}

/**
 * Myers' greedy forward search, keeping only the diagonals each step can read for the walk back
 * (a slice of 2d+3 per step). Null past MAX_MYERS_EDITS or MAX_MYERS_WORK.
 */
function myersSegments(a: readonly string[], b: readonly string[]): DiffSegment[] | null {
  const n = a.length
  const m = b.length
  const maxEdits = Math.min(n + m, MAX_MYERS_EDITS)
  const offset = maxEdits + 1
  const v = new Int32Array(2 * maxEdits + 3)
  const trace: Int32Array[] = []
  let work = 0
  for (let d = 0; d <= maxEdits; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
        work += 1
      }
      work += 1
      if (work > MAX_MYERS_WORK) {
        return null
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        return myersWalkBack(trace, n, m)
      }
    }
  }
  return null
}

function myersWalkBack(trace: readonly Int32Array[], n: number, m: number): DiffSegment[] {
  // Collected end to start, then reversed into runs.
  const steps: Array<'context' | 'delete' | 'add'> = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const before = trace[d] as Int32Array
    const at = (k: number): number => before[k + d + 1] ?? 0
    const k = x - y
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const previousX = at(previousK)
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      steps.push('context')
      x -= 1
      y -= 1
    }
    if (d > 0) {
      steps.push(x === previousX ? 'add' : 'delete')
    }
    x = previousX
    y = previousY
  }
  const segments: DiffSegment[] = []
  let oldIndex = 0
  let newIndex = 0
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index] as 'context' | 'delete' | 'add'
    pushRun(segments, step, oldIndex, newIndex)
    if (step !== 'add') {
      oldIndex += 1
    }
    if (step !== 'delete') {
      newIndex += 1
    }
  }
  return segments
}
