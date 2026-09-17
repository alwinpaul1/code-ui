import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MIN_TAP_TARGET } from './tap-target'

const MOBILE = join(import.meta.dirname, '..', '..')
const ROOTS = [join(MOBILE, 'src'), join(MOBILE, 'app')]

/** A control this small must carry a `hitSlop`. 40 leaves a 4 dp margin
 *  under MIN_TAP_TARGET, since a stated 42 with 1 dp of slop is not worth a
 *  line and a stated 40 is: the audit's own threshold. */
const SMALL = MIN_TAP_TARGET - 4

const PRESSABLE_TAGS = /<(Pressable|TasksButton|TasksRow|PressFeedback|PressScale)\b/g

type Dims = { width?: number; height?: number }

function sourceFiles(dir: string, into: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      sourceFiles(path, into)
    } else if (name.endsWith('.tsx') && !name.includes('.test.')) {
      into.push(path)
    }
  }
  return into
}

/** `key: { … }` blocks at two-space indent: the shape of a StyleSheet.create
 *  entry. Only stated, non-zero sizes count (see tapTargetHitSlop). The body
 *  ends at the brace that closes it, found by depth, not at the next line
 *  that happens to start with `}`: a one-line `pressed: { opacity: 0.7 },`
 *  would otherwise swallow the sized block after it and inherit its size
 *  (which is exactly how the first scan misread VoiceModelList's Use button). */
function styleDims(source: string): Record<string, Dims> {
  const dims: Record<string, Dims> = {}
  const opener = /^\s{2}([a-zA-Z0-9_]+):\s*\{/gm
  let match: RegExpExecArray | null
  while ((match = opener.exec(source))) {
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    for (; end < source.length && depth > 0; end += 1) {
      if (source[end] === '{') {
        depth += 1
      } else if (source[end] === '}') {
        depth -= 1
      }
    }
    dims[match[1]!] = inlineDims(source.slice(start, end))
  }
  return dims
}

function inlineDims(text: string): Dims {
  const read = (key: string) => {
    const found = text.match(new RegExp(`\\b${key}:\\s*([0-9.]+)`))
    const value = found ? Number(found[1]) : 0
    return value > 0 ? value : undefined
  }
  return { width: read('width') ?? read('minWidth'), height: read('height') ?? read('minHeight') }
}

function openTagEnd(source: string, start: number): number {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    } else if (char === '>' && depth === 0) {
      return i
    }
  }
  return source.length - 1
}

/** The tasks surface keeps its StyleSheets in sibling modules; a tag there
 *  can name a key from any of them. */
const TASKS_DIR = join(MOBILE, 'src', 'tasks')
const tasksStyleDims: Record<string, Dims> = Object.assign(
  {},
  ...readdirSync(TASKS_DIR)
    .filter((name) => /^mobile-tasks-.*-styles\.ts$/.test(name))
    .map((name) => styleDims(readFileSync(join(TASKS_DIR, name), 'utf8')))
)

function smallPressablesWithoutHitSlop(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const local = styleDims(source)
  const shared = file.startsWith(TASKS_DIR) ? tasksStyleDims : {}
  const hits: string[] = []
  let match: RegExpExecArray | null
  while ((match = PRESSABLE_TAGS.exec(source))) {
    const tag = source.slice(match.index, openTagEnd(source, match.index) + 1)
    if (/\bhitSlop\b/.test(tag)) {
      continue
    }
    const dims: Dims = inlineDims(tag)
    for (const key of tag.matchAll(/styles\.([a-zA-Z0-9_]+)/g)) {
      const found = local[key[1]!] ?? shared[key[1]!]
      dims.width ??= found?.width
      dims.height ??= found?.height
    }
    const short = [dims.width, dims.height].filter((n): n is number => n !== undefined && n <= SMALL)
    if (short.length > 0) {
      const line = source.slice(0, match.index).split('\n').length
      hits.push(`${file.slice(MOBILE.length + 1)}:${line} ${dims.width ?? '?'}×${dims.height ?? '?'}`)
    }
  }
  return hits
}

// 0.6.6 audit: 31 files paired a raw pressable of 40 dp or less with no
// hitSlop. The browser toolbar's 26 dp icons and the chat key strip's 30 dp
// keys were the worst; IconButton ships hitSlop 8 and these had re-drawn
// it without. This reads what it can from source: a size stated inline in
// the tag or in a StyleSheet entry of the same file (or, for the tasks
// surface, its shared style modules). A size computed in a helper function
// it cannot see, so the chat key strip is pinned in its own test instead.
describe('tap targets', () => {
  it('every pressable drawn at 40 dp or less carries a hitSlop', () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(root)).sort().flatMap(smallPressablesWithoutHitSlop)
    expect(offenders).toEqual([])
  })

  it('reads sizes the way the app states them, so an emptied scan cannot pass', () => {
    expect(styleDims('  backButton: {\n    width: 36,\n    height: 36\n  }\n')).toEqual({
      backButton: { width: 36, height: 36 }
    })
    expect(inlineDims('style={{ minHeight: 26, minWidth: 0 }}')).toEqual({ width: undefined, height: 26 })
    // A one-line entry ends at its own brace; it does not inherit the next block's size.
    expect(
      styleDims('  pressed: { opacity: 0.7 },\n  iconButton: {\n    width: 34,\n    height: 34\n  }\n')
    ).toEqual({ pressed: { width: undefined, height: undefined }, iconButton: { width: 34, height: 34 } })
    // The tasks modules really are read: the 32 dp icon button is in there.
    expect(tasksStyleDims.iconButton).toEqual({ width: 32, height: 32 })
  })
})
