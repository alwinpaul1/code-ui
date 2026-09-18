import { describe, expect, it } from 'vitest'
import { foldProposedFiles, proposedEditPreview } from './mobile-permission-proposed-edit'

/**
 * What the SDK lane hands the phone for a file-changing approval, and what the
 * card may make of it. The shapes here are the host's, read from Orca 1.4.205
 * (`out/main/index.js`): a Claude `canUseTool` prompt becomes
 * `{ title: "Allow <tool>?", detail: JSON.stringify(input) }`, and a Codex
 * `item/fileChange/requestApproval` becomes
 * `{ title: "Apply file changes?", detail: JSON.stringify(changes) }` — both
 * through the same 16 KiB head bound with a `[Orca: output truncated — …]`
 * marker appended when clipped.
 */

const ORCA_INLINE_HEAD_BYTES = 16 * 1024

function clippedLikeOrca(json: string): string {
  const bytes = Buffer.from(json, 'utf8')
  const head = bytes.subarray(0, ORCA_INLINE_HEAD_BYTES).toString('utf8')
  return `${head}\n[Orca: output truncated — ${bytes.byteLength} bytes total, digest 0123456789ab]`
}

function rows(preview: ReturnType<typeof proposedEditPreview>): string[] {
  if (preview.kind !== 'diff') {
    return []
  }
  return preview.files.flatMap((entry) =>
    entry.file.lines.map(
      (line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'gap' ? '⋯' : ' '}${line.text}`
    )
  )
}

describe('reading the proposed change out of a Claude approval', () => {
  it('turns an Edit into the interleaved rows the post-apply card would show', () => {
    const preview = proposedEditPreview(
      'Allow Edit?',
      JSON.stringify({
        file_path: '/w/src/app.ts',
        old_string: 'const a = 1\nconst b = 2\nconst c = 3',
        new_string: 'const a = 1\nconst b = 9\nconst c = 3',
        replace_all: false
      })
    )
    expect(preview.kind).toBe('diff')
    expect(rows(preview)).toEqual([' const a = 1', '-const b = 2', '+const b = 9', ' const c = 3'])
    if (preview.kind === 'diff') {
      expect(preview.files[0]?.verb).toBe('Proposed edit')
      expect(preview.files[0]?.file.path).toBe('/w/src/app.ts')
      // A snippet pair cannot say where in the file it sits.
      expect(preview.files[0]?.file.lineNumbersKnown).toBe(false)
    }
  })

  it('shows a Write as its whole new content, labelled as replacing the file', () => {
    // The old contents are not on the wire and cannot be read before approval
    // without an RPC, so this is never dressed up as a full diff.
    const preview = proposedEditPreview(
      'Allow Write?',
      JSON.stringify({ file_path: '/w/notes.md', content: '# Notes\nfirst\n' })
    )
    expect(rows(preview)).toEqual(['+# Notes', '+first'])
    if (preview.kind === 'diff') {
      expect(preview.files[0]?.verb).toBe('Replaces file')
    }
  })

  it('separates the snippets of a MultiEdit with a gap, in order', () => {
    const preview = proposedEditPreview(
      'Allow MultiEdit?',
      JSON.stringify({
        file_path: '/w/src/app.ts',
        edits: [
          { old_string: 'one', new_string: 'uno' },
          { old_string: 'two', new_string: 'dos' }
        ]
      })
    )
    expect(rows(preview)).toEqual(['-one', '+uno', '⋯', '-two', '+dos'])
  })

  it('handles the one-line and the empty edit without inventing rows', () => {
    const one = proposedEditPreview(
      'Allow Edit?',
      JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' })
    )
    expect(rows(one)).toEqual(['-x', '+y'])
    const nothing = proposedEditPreview(
      'Allow Edit?',
      JSON.stringify({ file_path: 'a.ts', old_string: '', new_string: '' })
    )
    expect(nothing).toEqual({ kind: 'none' })
    expect(proposedEditPreview('Allow Edit?', '{}')).toEqual({ kind: 'none' })
  })

  it('refuses a clipped payload and says what it knows, never a partial diff', () => {
    const detail = clippedLikeOrca(
      JSON.stringify({
        file_path: '/w/src/generated.ts',
        old_string: 'x'.repeat(10_000),
        new_string: 'y'.repeat(10_000)
      })
    )
    const preview = proposedEditPreview('Allow Edit?', detail)
    expect(preview).toEqual({
      kind: 'truncated',
      path: '/w/src/generated.ts',
      totalBytes: 20_000 + '{"file_path":"/w/src/generated.ts","old_string":"","new_string":""}'.length
    })
  })

  it('refuses a clipped payload whose head cut inside the path', () => {
    // 16 KiB of path is absurd but the guard is cheap: the marker alone must
    // never be mistaken for a parseable request.
    const detail = clippedLikeOrca(JSON.stringify({ file_path: 'p'.repeat(20_000) }))
    expect(proposedEditPreview('Allow Edit?', detail)).toEqual({
      kind: 'truncated',
      path: null,
      totalBytes: 20_000 + '{"file_path":""}'.length
    })
  })

  it('gives nothing for a NotebookEdit, whose input carries only the new cell', () => {
    // Rendering it would paint an unchanged cell as wholly added.
    expect(
      proposedEditPreview(
        'Allow NotebookEdit?',
        JSON.stringify({ notebook_path: 'a.ipynb', new_source: 'print(1)' })
      )
    ).toEqual({ kind: 'none' })
  })

  it('gives nothing for a Bash ask, whose detail is JSON with a command', () => {
    expect(
      proposedEditPreview('Allow Bash?', JSON.stringify({ command: 'rm -rf x', description: 'd' }))
    ).toEqual({ kind: 'none' })
  })

  it('gives nothing when the detail is prose rather than the tool input', () => {
    // The TUI lane's body, and any older host: neither is a diff.
    const body = [
      'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
      '   │ /w/src/app.ts',
      ' Do you want to proceed?'
    ].join('\n')
    expect(proposedEditPreview('Allow Edit?', body)).toEqual({ kind: 'none' })
    expect(proposedEditPreview('Allow Edit?', undefined)).toEqual({ kind: 'none' })
    expect(proposedEditPreview('Allow Edit?', '')).toEqual({ kind: 'none' })
    // Valid JSON that is not an object is not a tool input either.
    expect(proposedEditPreview('Allow Edit?', '"/w/src/app.ts"')).toEqual({ kind: 'none' })
    expect(proposedEditPreview('Allow Edit?', 'null')).toEqual({ kind: 'none' })
  })
})

describe('reading the proposed change out of a Codex approval', () => {
  it('turns a file-change approval into one card per changed file', () => {
    const preview = proposedEditPreview(
      'Apply file changes?',
      JSON.stringify([
        { path: 'src/greet.ts', kind: { type: 'update' }, diff: '@@ -1,2 +1,2 @@\n-a\n+b\n c' },
        { path: 'src/new.ts', kind: { type: 'add' }, diff: 'one\ntwo' }
      ])
    )
    expect(preview.kind).toBe('diff')
    if (preview.kind === 'diff') {
      expect(preview.files.map((entry) => [entry.file.path, entry.verb])).toEqual([
        ['src/greet.ts', 'Proposed edit'],
        ['src/new.ts', 'New file']
      ])
      // Codex resolved these against the real file, so the rows are numbered.
      expect(preview.files[0]?.file.lineNumbersKnown).toBe(true)
    }
    expect(rows(preview)).toEqual(['-a', '+b', ' c', '+one', '+two'])
  })

  it('gives nothing for a command approval on either Codex lane', () => {
    // TUI lane: the parsed dialog body.
    expect(
      proposedEditPreview(
        'Run this command?',
        'Environment: local\nReason: run the tests\n$ pnpm exec vitest run'
      )
    ).toEqual({ kind: 'none' })
    // SDK lane: the host passes the command through as the detail.
    expect(proposedEditPreview('Run a command?', 'pnpm exec vitest run')).toEqual({ kind: 'none' })
  })

  it('gives nothing when a file-change approval carries a reason instead of changes', () => {
    // The host prefers the reason when Codex sends one; prose is not a diff.
    expect(
      proposedEditPreview('Apply file changes?', 'Needs to write outside the workspace')
    ).toEqual({ kind: 'none' })
    expect(proposedEditPreview('Apply file changes?', '[]')).toEqual({ kind: 'none' })
  })
})

describe('folding a long proposed change', () => {
  function preview(lineCounts: number[]) {
    const detail = JSON.stringify(
      lineCounts.map((count, index) => ({
        path: `f${index}.txt`,
        kind: { type: 'add' },
        diff: Array.from({ length: count }, (_, line) => `l${line}`).join('\n')
      }))
    )
    const result = proposedEditPreview('Apply file changes?', detail)
    if (result.kind !== 'diff') {
      throw new Error(`expected a diff, got ${result.kind}`)
    }
    return result.files
  }

  it('spends the row budget across files in order and reports what it hid', () => {
    const folded = foldProposedFiles(preview([10, 10, 10]), 15)
    expect(folded.files.map((entry) => entry.file.lines.length)).toEqual([10, 5])
    expect(folded.totalRows).toBe(30)
    expect(folded.hiddenRows).toBe(15)
    // The counts in the header still describe the whole change.
    expect(folded.files[1]?.file.added).toBe(10)
  })

  it('leaves a change that fits alone', () => {
    const files = preview([3, 4])
    const folded = foldProposedFiles(files, 7)
    expect(folded.files).toBe(files)
    expect(folded.hiddenRows).toBe(0)
  })

  it('handles the one-row and the empty case', () => {
    expect(foldProposedFiles(preview([1]), 1)).toMatchObject({ hiddenRows: 0, totalRows: 1 })
    expect(foldProposedFiles([], 24)).toEqual({ files: [], hiddenRows: 0, totalRows: 0 })
  })
})
