// Orca #19229 (e80fae0c4) moved the whole patch-text branch of
// `editFilesFromToolPair` into `native-chat-edit-patch-files.ts` and rewrote
// `editLinesFromUnifiedPatch` as a visitor so a summary can count the same rows
// without building them. Every one of those paths feeds the phone's diff cards,
// and upstream's own tests for them are vendored but never run here (vitest is
// rooted at `mobile/`). So they get a running guard, on this side of the fence.
//
// A guard, not a fail-first test: the extraction is meant to change nothing the
// phone draws, and this is what says so.

import { describe, expect, it } from 'vitest'
import { editFilesFromToolPair } from '../../../src/shared/native-chat-edit-normalize'
import {
  editLinesFromUnifiedPatch,
  summarizeUnifiedPatch
} from '../../../src/shared/native-chat-unified-patch'

function diffCall(path: string, output: string) {
  return editFilesFromToolPair({
    name: 'Diff',
    input: { path },
    state: 'completed',
    result: { output }
  })
}

describe('the patch text behind a diff card, after the extraction', () => {
  it('reads a move appended to the body as a rename instead of a numbered line', () => {
    const files = diffCall('src/old.ts', '@@ -1,1 +1,1 @@\n-a\n+b\n\nMoved to: src/new.ts')
    expect(files?.[0]?.changeKind).toBe('renamed')
    expect(files?.[0]?.path).toBe('src/new.ts')
    expect(files?.[0]?.oldPath).toBe('src/old.ts')
    expect(files?.[0]?.lines.some((line) => line.text.includes('Moved to'))).toBe(false)
  })

  it('does not read a row that merely mentions a move as one', () => {
    const files = diffCall(
      'docs/index.md',
      '@@ -1,2 +1,2 @@\n ctx\n+See Moved to: docs/archive/index.md'
    )
    expect(files?.[0]?.changeKind).not.toBe('renamed')
    expect(files?.[0]?.path).toBe('docs/index.md')
  })

  it('refuses a card when the call names a file count instead of a file', () => {
    expect(diffCall('2 files', '@@\n-a\n+b\n@@\n-c\n+d')).toBeNull()
  })

  it('splits a multi-file patch into one card per file, each under its own name', () => {
    const files = diffCall(
      'src/a.ts',
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,1 +1,1 @@',
        '-one',
        '+ONE',
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -1,1 +1,1 @@',
        '-two',
        '+TWO'
      ].join('\n')
    )
    expect(files?.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files?.map((file) => file.added)).toEqual([1, 1])
  })

  it('reports a clipped patch as truncated instead of rendering its marker', () => {
    const files = diffCall('src/a.ts', '@@ -1,3 +1,3 @@\n ctx\n-was\n+now\n… (48210 bytes)')
    expect(files?.[0]?.truncated).toBe(true)
    expect(files?.[0]?.lines.map((line) => line.text)).toEqual(['ctx', 'was', 'now'])
  })

  it('still breaks two hunks apart with one gap, and never opens or ends on one', () => {
    const parsed = editLinesFromUnifiedPatch('@@ -1,1 +1,1 @@\n-a\n+b\n@@ -40,1 +40,1 @@\n-c\n+d')
    expect(parsed?.lines.map((line) => line.kind)).toEqual(['del', 'add', 'gap', 'del', 'add'])
    expect(parsed?.lineNumbersKnown).toBe(true)
  })

  it('refuses a body with no hunk header, as it always did', () => {
    expect(editLinesFromUnifiedPatch('-a\n+b')).toBeNull()
  })

  it('counts the same rows the card would draw, without building them', () => {
    const patch = '@@ -1,3 +1,3 @@\n ctx\n-was\n+now\n@@ -40,1 +40,2 @@\n+extra'
    const parsed = editLinesFromUnifiedPatch(patch)
    const summary = summarizeUnifiedPatch(patch)
    expect(summary).toEqual({
      added: parsed?.lines.filter((line) => line.kind === 'add').length,
      removed: parsed?.lines.filter((line) => line.kind === 'del').length,
      truncated: false
    })
  })
})
