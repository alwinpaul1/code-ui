// "Revert this hunk" on a landed edit (extension 2.1.275 per-hunk reject, the
// post-apply half — the pre-acceptance half cannot exist on the phone, since
// `respondToApproval` takes an option id and nothing else).
//
// The planner is the whole safety story: it never writes, it only says what
// the file would become, and it refuses whenever the file no longer carries the
// change the card shows. Every fixture is built through the same normaliser the
// transcript uses, so the rows are the rows a real card gets.

import { describe, expect, it } from 'vitest'
import { finalizeEditFile, type NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import { editFilesFromToolPair } from '../../../src/shared/native-chat-edit-normalize'
import { editCardHunks, planHunkRevert } from './mobile-diff-hunk-revert'

/** A Claude `Edit` as the structured lane reports it: the snippet pair plus the
 *  hunks the provider resolved against the real file, so rows are numbered. */
function claudeEditWithPatch(): NativeChatEditFile {
  const files = editFilesFromToolPair({
    name: 'Edit',
    input: {
      file_path: '/w/src/app.ts',
      old_string: 'const b = 2',
      new_string: 'const b = 9'
    },
    state: 'completed',
    result: {
      output: 'The file /w/src/app.ts has been updated.',
      editPatch: {
        filePath: '/w/src/app.ts',
        hunks: [
          {
            oldStart: 40,
            oldLines: 3,
            newStart: 40,
            newLines: 3,
            lines: [' const a = 1', '-const b = 2', '+const b = 9', ' const c = 3']
          }
        ]
      }
    }
  })
  return files![0]!
}

/** The same edit on the bridge lane: a snippet pair and nothing else, so the
 *  rows carry no file position. */
function claudeEditSnippet(): NativeChatEditFile {
  const files = editFilesFromToolPair({
    name: 'Edit',
    input: {
      file_path: '/w/src/app.ts',
      old_string: 'const a = 1\nconst b = 2\nconst c = 3',
      new_string: 'const a = 1\nconst b = 9\nconst c = 3'
    },
    state: 'completed',
    result: { output: 'The file /w/src/app.ts has been updated.' }
  })
  return files![0]!
}

/** Codex through its command tool: a Begin Patch envelope, whose `@@` markers
 *  carry context but no numbers (Codex 0.153). */
function codexExecPatch(): NativeChatEditFile {
  const files = editFilesFromToolPair({
    name: 'exec',
    input: {
      command: [
        'bash',
        '-lc',
        [
          "apply_patch <<'EOF'",
          '*** Begin Patch',
          '*** Update File: src/greet.ts',
          '@@ export function greet() {',
          "-  return 'hi'",
          "+  return 'hello'",
          ' }',
          '*** End Patch',
          'EOF'
        ].join('\n')
      ]
    },
    state: 'completed',
    result: { output: 'Success. Updated the following files:\nM src/greet.ts' }
  })
  return files![0]!
}

/** Codex's structured `changes[]`: a unified diff with real ranges. */
function codexChangesPatch(): NativeChatEditFile {
  const files = editFilesFromToolPair({
    name: 'apply_patch',
    input: {
      changes: [
        {
          path: 'src/greet.ts',
          kind: { type: 'update' },
          diff: [
            '@@ -1,3 +1,3 @@',
            ' export function greet() {',
            "-  return 'hi'",
            "+  return 'hello'",
            ' }'
          ].join('\n')
        }
      ]
    },
    state: 'completed',
    result: { output: 'ok' }
  })
  return files![0]!
}

function file(
  lines: NativeChatEditFile['lines'],
  overrides: Partial<Pick<NativeChatEditFile, 'changeKind' | 'lineNumbersKnown' | 'truncated'>> = {}
): NativeChatEditFile {
  return finalizeEditFile({
    path: '/w/f.txt',
    oldPath: null,
    changeKind: overrides.changeKind ?? 'edited',
    lines,
    lineNumbersKnown: overrides.lineNumbersKnown ?? true,
    ...(overrides.truncated ? { truncated: true } : {})
  })
}

const ctx = (text: string, oldNo: number, newNo: number) =>
  ({ kind: 'context', text, oldLineNumber: oldNo, newLineNumber: newNo }) as const
const add = (text: string, newNo: number | null) =>
  ({ kind: 'add', text, oldLineNumber: null, newLineNumber: newNo }) as const
const del = (text: string, oldNo: number | null) =>
  ({ kind: 'del', text, oldLineNumber: oldNo, newLineNumber: null }) as const
const gap = () => ({ kind: 'gap', text: '', oldLineNumber: null, newLineNumber: null }) as const

describe('hunks on a landed-edit card', () => {
  it('finds each contiguous change block, split by context and by gaps', () => {
    const hunks = editCardHunks(
      file([ctx('a', 1, 1), del('b', 2), add('B', 2), ctx('c', 3, 3), gap(), add('z', 90)])
    )
    expect(hunks.map((hunk) => [hunk.startIndex, hunk.endIndex])).toEqual([
      [1, 2],
      [5, 5]
    ])
  })

  it('finds nothing on a card with no rows and nothing on pure context', () => {
    expect(editCardHunks(file([]))).toEqual([])
    expect(editCardHunks(file([ctx('a', 1, 1)]))).toEqual([])
  })
})

describe('reverting one hunk of a landed edit', () => {
  it('puts the old lines back at the numbered position when the file still carries the change', () => {
    const current = [
      ...Array.from({ length: 39 }, (_, i) => `line ${i + 1}`),
      'const a = 1',
      'const b = 9',
      'const c = 3',
      'tail'
    ].join('\n')
    const plan = planHunkRevert(claudeEditWithPatch(), 0, `${current}\n`)
    expect(plan).toMatchObject({ ok: true, removed: 1, restored: 1 })
    if (!plan.ok) {
      return
    }
    expect(plan.content.split('\n').slice(39, 43)).toEqual([
      'const a = 1',
      'const b = 2',
      'const c = 3',
      'tail'
    ])
    expect(plan.content.endsWith('\n')).toBe(true)
  })

  it('refuses when the lines at the hunk position no longer match the new side (real drift)', () => {
    // The agent — or the user at the desk — edited line 41 again after the card
    // was drawn. Reverting by position would overwrite THEIR change with ours.
    const drifted = [
      ...Array.from({ length: 39 }, (_, i) => `line ${i + 1}`),
      'const a = 1',
      'const b = 10',
      'const c = 3'
    ].join('\n')
    const plan = planHunkRevert(claudeEditWithPatch(), 0, drifted)
    expect(plan).toEqual({
      ok: false,
      refusal: 'drifted',
      message: 'This part of the file changed since; open the diff to revert by hand.'
    })
  })

  it('refuses when lines were inserted above and the numbered position slid, instead of hunting for it', () => {
    // The change is still in the file, two lines lower. A search would find it;
    // the card said line 41, and 41 is not it any more. Refusing is the rule.
    const shifted = [
      'new line',
      'new line',
      ...Array.from({ length: 39 }, (_, i) => `line ${i + 1}`),
      'const a = 1',
      'const b = 9',
      'const c = 3'
    ].join('\n')
    expect(planHunkRevert(claudeEditWithPatch(), 0, shifted)).toMatchObject({
      ok: false,
      refusal: 'drifted'
    })
  })

  it('anchors an unnumbered snippet by its one occurrence in the file', () => {
    const current = ['x', 'const a = 1', 'const b = 9', 'const c = 3', 'y'].join('\n')
    const plan = planHunkRevert(claudeEditSnippet(), 0, current)
    expect(plan).toMatchObject({ ok: true })
    if (!plan.ok) {
      return
    }
    expect(plan.content).toBe(['x', 'const a = 1', 'const b = 2', 'const c = 3', 'y'].join('\n'))
  })

  it('refuses an unnumbered snippet that now appears twice, rather than picking one', () => {
    const twice = ['const a = 1', 'const b = 9', 'const c = 3', '', 'const a = 1', 'const b = 9', 'const c = 3'].join(
      '\n'
    )
    expect(planHunkRevert(claudeEditSnippet(), 0, twice)).toEqual({
      ok: false,
      refusal: 'ambiguous',
      message: 'This change appears more than once in the file; open the diff to revert by hand.'
    })
  })

  it('refuses an unnumbered snippet the file no longer contains', () => {
    expect(planHunkRevert(claudeEditSnippet(), 0, 'const b = 10\n')).toMatchObject({
      ok: false,
      refusal: 'drifted'
    })
  })

  describe('a Codex-shaped card', () => {
    it('reverts a Begin Patch hunk (no numbers) by its unique context', () => {
      const current = ['export function greet() {', "  return 'hello'", '}', ''].join('\n')
      const plan = planHunkRevert(codexExecPatch(), 0, current)
      expect(plan).toMatchObject({ ok: true })
      if (!plan.ok) {
        return
      }
      expect(plan.content).toBe(['export function greet() {', "  return 'hi'", '}', ''].join('\n'))
    })

    it('reverts a unified-diff hunk (numbered) at its stated position', () => {
      const card = codexChangesPatch()
      expect(card.lineNumbersKnown).toBe(true)
      const plan = planHunkRevert(card, 0, "export function greet() {\n  return 'hello'\n}\n")
      expect(plan).toMatchObject({ ok: true })
      if (!plan.ok) {
        return
      }
      expect(plan.content).toBe("export function greet() {\n  return 'hi'\n}\n")
    })

    it('refuses the numbered Codex hunk once the file drifted under it', () => {
      expect(
        planHunkRevert(codexChangesPatch(), 0, "export function greet() {\n  return 'hey'\n}\n")
      ).toMatchObject({ ok: false, refusal: 'drifted' })
    })
  })

  describe('degenerate hunks', () => {
    it('reverts a one-line hunk', () => {
      const card = file([del('old', 1), add('new', 1)])
      const plan = planHunkRevert(card, 0, 'new\n')
      expect(plan).toMatchObject({ ok: true, content: 'old\n' })
    })

    it('reverts a pure addition by deleting the added lines', () => {
      const card = file([ctx('a', 1, 1), add('b', 2), add('c', 3), ctx('d', 2, 4)])
      const plan = planHunkRevert(card, 0, 'a\nb\nc\nd\n')
      expect(plan).toMatchObject({ ok: true, content: 'a\nd\n', removed: 2, restored: 0 })
    })

    it('reverts a pure deletion by re-inserting the removed lines after the preceding context', () => {
      const card = file([ctx('a', 1, 1), del('b', 2), del('c', 3), ctx('d', 4, 2)])
      const plan = planHunkRevert(card, 0, 'a\nd\n')
      expect(plan).toMatchObject({ ok: true, content: 'a\nb\nc\nd\n', removed: 0, restored: 2 })
    })

    it('anchors a pure deletion at the top of the file on the context after it', () => {
      const card = file([del('gone', 1), ctx('a', 2, 1)])
      expect(planHunkRevert(card, 0, 'a\n')).toMatchObject({ ok: true, content: 'gone\na\n' })
    })

    it('refuses a pure deletion whose removed lines are already back beside its one anchor', () => {
      // The card: `a` kept, `b` and `c` deleted at the end of the file. Someone
      // has since put `b` and `c` back. The only anchor is `a`, which still
      // matches — reverting here would insert `b` and `c` a second time. This
      // is patch(1)'s "already applied" check, on the side the card cannot pin.
      const card = file([ctx('a', 1, 1), del('b', 2), del('c', 3)])
      expect(planHunkRevert(card, 0, 'a\nb\nc\n')).toEqual({
        ok: false,
        refusal: 'already-back',
        message: 'The removed lines are already back in the file; there is nothing to revert.'
      })
      const snippet = file([ctx('a', 1, 1), del('b', 2), del('c', 3)], { lineNumbersKnown: false })
      expect(planHunkRevert(snippet, 0, 'a\nb\nc\n')).toMatchObject({ ok: false, refusal: 'already-back' })
      // Something else after `a` is not the deleted lines: the deletion stands.
      expect(planHunkRevert(card, 0, 'a\nq\n')).toMatchObject({ ok: true, content: 'a\nb\nc\nq\n' })
      expect(planHunkRevert(card, 0, 'a\n')).toMatchObject({ ok: true, content: 'a\nb\nc\n' })
    })

    it('reverts the commonest Claude deletion snippet — old "X Y", new "Y" — anywhere in the file', () => {
      const snippet = file([del('X', 1), ctx('Y', 2, 1)], { lineNumbersKnown: false })
      expect(planHunkRevert(snippet, 0, 'p\nq\nY\nr\n')).toMatchObject({ ok: true, content: 'p\nq\nX\nY\nr\n' })
      // ...unless X is already back above Y.
      expect(planHunkRevert(snippet, 0, 'p\nX\nY\nr\n')).toMatchObject({ ok: false, refusal: 'already-back' })
    })

    it('refuses a pure deletion with no context at all: nothing to anchor on', () => {
      const card = file([del('gone', 1)], { lineNumbersKnown: false })
      expect(planHunkRevert(card, 0, 'a\n')).toEqual({
        ok: false,
        refusal: 'no-anchor',
        message: 'This hunk has no surrounding lines to anchor on; open the diff to revert by hand.'
      })
    })

    it('keeps a file with no trailing newline without one after reverting its last line', () => {
      const card = file([ctx('a', 1, 1), del('b', 2), add('c', 2)])
      expect(planHunkRevert(card, 0, 'a\nc')).toMatchObject({ ok: true, content: 'a\nb' })
    })

    it('keeps CRLF line endings on a CRLF file', () => {
      const card = file([ctx('a', 1, 1), del('b', 2), add('c', 2)])
      expect(planHunkRevert(card, 0, 'a\r\nc\r\n')).toMatchObject({ ok: true, content: 'a\r\nb\r\n' })
    })

    it('refuses a card that is one pure-addition hunk and nothing else: the old content is unknown', () => {
      // A Claude `Write` over an EXISTING file normalises to changeKind
      // 'edited' with every row added. The card never saw what was there
      // before, so "reverting" would zero the file.
      const overwrite = editFilesFromToolPair({
        name: 'Write',
        input: { file_path: '/w/src/a.ts', content: 'line1\nline2\n' },
        state: 'completed',
        result: { output: 'The file /w/src/a.ts has been updated successfully.' }
      })![0]!
      expect(overwrite.changeKind).toBe('edited')
      expect(planHunkRevert(overwrite, 0, 'line1\nline2\n')).toMatchObject({
        ok: false,
        refusal: 'whole-file-change'
      })
      expect(planHunkRevert(file([add('only', 1)]), 0, 'only\n')).toMatchObject({
        ok: false,
        refusal: 'whole-file-change'
      })
    })
  })

  describe('what it will not touch', () => {
    it('refuses a hunk index the card does not have', () => {
      expect(planHunkRevert(file([add('x', 1)]), 3, 'x\n')).toMatchObject({
        ok: false,
        refusal: 'no-such-hunk'
      })
    })

    it('refuses on a created or deleted file: the hunk is the whole file', () => {
      expect(planHunkRevert(file([add('x', 1)], { changeKind: 'added' }), 0, 'x\n')).toMatchObject({
        ok: false,
        refusal: 'whole-file-change'
      })
      expect(planHunkRevert(file([del('x', 1)], { changeKind: 'deleted' }), 0, '')).toMatchObject({
        ok: false,
        refusal: 'whole-file-change'
      })
    })

    it('refuses the last hunk of a truncated card, which may be cut mid-hunk', () => {
      const card = file([ctx('a', 1, 1), del('b', 2), add('c', 2), ctx('d', 3, 3), add('e', 4)], {
        truncated: true
      })
      // The first hunk is complete and still revertable; the trailing one is not.
      expect(planHunkRevert(card, 0, 'a\nc\nd\ne\n')).toMatchObject({ ok: true })
      expect(planHunkRevert(card, 1, 'a\nc\nd\ne\n')).toMatchObject({
        ok: false,
        refusal: 'hunk-cut-by-truncation'
      })
    })

    it('refuses a file with mixed line endings rather than normalising it on the way back', () => {
      const card = file([ctx('a', 1, 1), del('b', 2), add('c', 2)])
      expect(planHunkRevert(card, 0, 'a\r\nc\nx\n')).toMatchObject({
        ok: false,
        refusal: 'mixed-line-endings'
      })
    })
  })
})
