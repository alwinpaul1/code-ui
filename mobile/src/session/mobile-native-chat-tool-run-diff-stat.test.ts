import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatEditPatchHunk } from '../../../src/shared/native-chat-types'
import { toolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'
import { CREATED_A_FILE_RUN, EDITED_A_FILE_RUN } from './fixtures/claude-edit-runs-2.1.282'

/** What Orca's mobile payload diet leaves at the end of a string it cut
 *  (native-chat-rpc-block-sanitize.ts, `sanitizeToolInput`). */
const CUT = '… (truncated)'

/** The edit run's landed Edit and its result, alone. */
const LANDED_EDIT = EDITED_A_FILE_RUN.slice(0, 2)

function hunk(context: number, removed: number, added: number): NativeChatEditPatchHunk {
  return {
    oldStart: 1,
    oldLines: context + removed,
    newStart: 1,
    newLines: context + added,
    lines: [
      ...Array.from({ length: context }, (_, i) => ` same ${i}`),
      ...Array.from({ length: removed }, (_, i) => `-gone ${i}`),
      ...Array.from({ length: added }, (_, i) => `+new ${i}`)
    ]
  }
}

function editWithPatch(hunks: NativeChatEditPatchHunk[]): NativeChatBlock[] {
  return [
    {
      type: 'tool-call',
      name: 'Edit',
      input: { replace_all: true, file_path: '/repo/a.ts', old_string: 'same', new_string: 'new' }
    },
    {
      type: 'tool-result',
      output: 'The file /repo/a.ts has been updated. All occurrences were successfully replaced.',
      editPatch: { filePath: '/repo/a.ts', hunks }
    }
  ]
}

// The two runs of the 2026-09-26 report, as Orca 1.4.211 delivers them to the
// phone (fixtures/claude-edit-runs-2.1.282.ts). The Claude app draws +93 −0
// and +14 −2.
describe('the runs the Claude app counts, as the phone receives them', () => {
  it("counts the edit run's +14 −2 from the hunk Claude resolved, as the Claude app does", () => {
    expect(toolRunDiffStat(EDITED_A_FILE_RUN)).toEqual({ added: 14, removed: 2 })
  })

  // The Write's 93 lines exist only in its input, and the wire kept the first
  // 3896 characters of it: counting those drew "+61 −0" on the real record
  // (and "+65 −0" on this one). A create's result carries no hunks
  // (`structuredPatch: []`) and no count, so nothing that reaches the phone
  // says 93.
  it('draws no count for a created file whose content the wire cut, not the lines that survived the cut', () => {
    expect(toolRunDiffStat(CREATED_A_FILE_RUN)).toBeNull()
  })

  it('draws no count for the cut create even beside an edit it can count', () => {
    expect(toolRunDiffStat([...CREATED_A_FILE_RUN, ...EDITED_A_FILE_RUN])).toBeNull()
  })
})

// Every other place a count reaches the phone already cut, which is the same
// defect: rows that survived a cut, counted as if they were the whole edit.
describe('a count the wire cut is no count', () => {
  it('draws no count for an Edit whose own strings the wire cut, when no hunks came back', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'Edit',
          input: { file_path: '/repo/a.ts', old_string: 'one\ntwo', new_string: `one\nthree\nfo${CUT}` }
        },
        { type: 'tool-result', output: 'The file /repo/a.ts has been updated successfully.' }
      ])
    ).toBeNull()
  })

  it('draws no count for a MultiEdit whose list of edits the wire cut short', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'MultiEdit',
          input: {
            file_path: '/repo/a.ts',
            edits: [{ old_string: 'a', new_string: 'b' }, CUT]
          }
        },
        { type: 'tool-result', output: 'Applied 21 edits to /repo/a.ts' }
      ])
    ).toBeNull()
  })

  it('draws no count when the wire dropped the keys that held an edit, rather than the other edit alone', () => {
    expect(
      toolRunDiffStat([
        ...LANDED_EDIT,
        {
          type: 'tool-call',
          name: 'Write',
          input: { file_path: '/repo/a.ts', '…': 'truncated' }
        },
        { type: 'tool-result', output: 'File created successfully at: /repo/a.ts' }
      ])
    ).toBeNull()
  })

  // The degenerate edge of the budget: `old_string` used exactly what was
  // left, so it arrives whole, and `new_string` is dropped for a `…` key. No
  // string carries a cut, and every old line would count as removed.
  it('draws no count for an Edit whose new string the wire dropped at the edge of its budget', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'Edit',
          input: { file_path: '/repo/a.ts', old_string: 'one\ntwo', '…': 'truncated' }
        },
        { type: 'tool-result', output: 'The file /repo/a.ts has been updated successfully.' }
      ])
    ).toBeNull()
  })

  // Orca keeps 400 rows of each resolved hunk (MAX_EDIT_PATCH_HUNK_LINES in
  // transcript-line-decoders-claude.ts). 14 of 12,265 real hunks in this
  // machine's Claude transcripts were longer; every other hunk's rows add up
  // to its own header.
  it('draws no count for an edit whose resolved hunk Orca cut at 400 rows', () => {
    const cut = hunk(0, 0, 500)
    expect(toolRunDiffStat(editWithPatch([{ ...cut, lines: cut.lines.slice(0, 400) }]))).toBeNull()
  })

  it("counts a resolved hunk that ends in git's no-newline marker", () => {
    const whole = hunk(1, 1, 1)
    expect(
      toolRunDiffStat(editWithPatch([{ ...whole, lines: [...whole.lines, '\\ No newline at end of file'] }]))
    ).toEqual({ added: 1, removed: 1 })
  })

  // …and at most 40 hunks (MAX_EDIT_PATCH_HUNKS), with nothing to say more
  // were dropped. A `replace_all` over a long file reaches it.
  it('draws no count for an edit with as many hunks as Orca keeps, since more may have been dropped', () => {
    expect(toolRunDiffStat(editWithPatch(Array.from({ length: 40 }, () => hunk(1, 1, 1))))).toBeNull()
  })

  it('counts an edit with one hunk fewer than Orca keeps', () => {
    expect(toolRunDiffStat(editWithPatch(Array.from({ length: 39 }, () => hunk(1, 1, 1))))).toEqual({
      added: 39,
      removed: 39
    })
  })

  // The structured lane bounds a tool input over 16 KB into this shape
  // (journal-payload-bounds.ts `boundToolInput`): the Write landed, and there
  // is no content left to count.
  it("draws no count for a run whose landed Write lost its content, rather than the other edit's alone", () => {
    expect(
      toolRunDiffStat([
        ...LANDED_EDIT,
        {
          type: 'tool-call',
          name: 'Write',
          input: { truncated: true, byteLength: 48210, digest: 'a1b2c3', head: '{"file_path":"/repo/big.md"' },
          state: 'completed'
        },
        { type: 'tool-result', output: 'File created successfully at: /repo/big.md' }
      ])
    ).toBeNull()
  })

  it('still counts the landed edit beside a Write that failed, which changed nothing', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'Write',
          input: { file_path: '/repo/NEW.md', content: 'a\nb\n' }
        },
        {
          type: 'tool-result',
          output: '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>',
          isError: true
        },
        ...LANDED_EDIT
      ])
    ).toEqual({ added: 14, removed: 2 })
  })

  // Codex: a structured-lane diff whose patch the journal bounded carries its
  // own marker (structured-agent-session-projection.ts `boundedText`).
  it('draws no count for a Codex diff whose patch the journal bounded', () => {
    expect(
      toolRunDiffStat([
        { type: 'tool-call', name: 'Diff', input: { path: 'src/a.ts' } },
        { type: 'tool-result', output: '@@ -1,3 +1,3 @@\n ctx\n-was\n+now\n… (48210 bytes)' }
      ])
    ).toBeNull()
  })

  it('counts a whole Codex apply_patch envelope', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n ctx\n-was\n+now\n+more\n*** End Patch\n'
        },
        { type: 'tool-result', output: 'Success. Updated the following files:\nM src/a.ts\n' }
      ])
    ).toEqual({ added: 2, removed: 1 })
  })

  // The freeform apply_patch input reaches the phone as one string, so the
  // diet cuts the envelope itself and its closing marker goes with it.
  it('draws no count for a Codex run whose apply_patch the wire cut, rather than the other patch alone', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-was\n+now\n*** End Patch\n'
        },
        { type: 'tool-result', output: 'Success. Updated the following files:\nM src/a.ts\n' },
        {
          type: 'tool-call',
          name: 'apply_patch',
          input: `*** Begin Patch\n*** Add File: src/b.ts\n+one\n+tw${CUT}`
        },
        { type: 'tool-result', output: 'Success. Updated the following files:\nA src/b.ts\n' }
      ])
    ).toBeNull()
  })

  // Codex 0.153.4 applies patches from inside its `exec` script, the envelope
  // a JavaScript string with escaped newlines (every apply_patch in this
  // machine's rollouts, 2026-09-06 to 09-11). Nothing splits that into files,
  // so no count is drawn — never an invented one.
  it('draws no count for a Codex exec script that applies a patch', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'exec',
          input:
            'const patch = "*** Begin Patch\\n*** Update File: src/a.ts\\n@@\\n-was\\n+now\\n*** End Patch";\nconst out = await tools.apply_patch(patch);\ntext(out);\n'
        },
        { type: 'tool-result', output: 'Script completed\nWall time: 0.4 seconds\n{}' }
      ])
    ).toBeNull()
  })

  // Review of f042077a. A diff item that only moved a file, or whose patch is
  // empty, changed no lines: it adds nothing to the run, and must not void it.
  it('keeps the run count beside a Codex diff that only moved a file or carries an empty patch', () => {
    for (const output of ['Moved to: src/b.ts', '']) {
      expect(
        toolRunDiffStat([
          { type: 'tool-call', name: 'Diff', input: { path: 'src/a.ts' } },
          { type: 'tool-result', output },
          ...LANDED_EDIT
        ])
      ).toEqual({ added: 14, removed: 2 })
    }
  })

  it('draws no count beside a Codex diff the journal bounded before its first hunk', () => {
    // With a file header left the reader names a cut file; with none, no file.
    for (const output of ['diff --git a/src/a.ts b/src/a.ts\n… (48210 bytes)', 'index 1a2b3c..4d5e6f 100644\n… (48210 bytes)']) {
      expect(
        toolRunDiffStat([
          { type: 'tool-call', name: 'Diff', input: { path: 'src/a.ts' } },
          { type: 'tool-result', output },
          ...LANDED_EDIT
        ])
      ).toBeNull()
    }
  })

  // An older Codex runs apply_patch through its shell tool, the envelope one
  // word of the argument vector. Cut, it has no closing marker and no files,
  // and the other patch's count is not the run's.
  it('draws no count for a Codex run whose shell apply_patch the wire cut, rather than the other patch alone', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-was\n+now\n*** End Patch\n'
        },
        { type: 'tool-result', output: 'Success. Updated the following files:\nM src/a.ts\n' },
        {
          type: 'tool-call',
          name: 'shell',
          input: { command: ['apply_patch', `*** Begin Patch\n*** Add File: src/b.ts\n+one\n+tw${CUT}`] }
        },
        { type: 'tool-result', output: 'Success. Updated the following files:\nA src/b.ts\n' }
      ])
    ).toBeNull()
  })

  it('draws no count for a run holding a Codex exec script that applied a patch it cannot split', () => {
    expect(
      toolRunDiffStat([
        {
          type: 'tool-call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-was\n+now\n*** End Patch\n'
        },
        { type: 'tool-result', output: 'Success. Updated the following files:\nM src/a.ts\n' },
        {
          type: 'tool-call',
          name: 'exec',
          input:
            'const patch = "*** Begin Patch\\n*** Update File: src/b.ts\\n@@\\n-was\\n+now\\n*** End Patch";\nconst out = await tools.apply_patch(patch);\ntext(out);\n'
        },
        { type: 'tool-result', output: 'Script completed\nWall time: 0.4 seconds\n{}' }
      ])
    ).toBeNull()
  })

  it('keeps the run count beside commands that ran no patch, even one that names apply_patch', () => {
    expect(
      toolRunDiffStat([
        { type: 'tool-call', name: 'shell', input: { command: ['bash', '-lc', 'ls'] } },
        { type: 'tool-result', output: 'a.ts' },
        { type: 'tool-call', name: 'exec', input: { command: ['rg', '-n', 'apply_patch', 'src'] } },
        { type: 'tool-result', output: 'src/a.ts:1:apply_patch' },
        ...LANDED_EDIT
      ])
    ).toEqual({ added: 14, removed: 2 })
  })

  // No provider Orca decodes names a tool `str_replace`; the text-editor
  // shape that does uses `old_str`/`new_str` and a `view` command, which the
  // vendored reader cannot turn into files. Its landing proves no edit.
  it('keeps the run count beside a str_replace call it cannot read', () => {
    expect(
      toolRunDiffStat([
        { type: 'tool-call', name: 'str_replace', input: { command: 'view', path: '/repo/a.ts' } },
        { type: 'tool-result', output: '1\tconst a = 1' },
        ...LANDED_EDIT
      ])
    ).toEqual({ added: 14, removed: 2 })
  })

  it('draws no count for an empty run, or a lone result with no call', () => {
    expect(toolRunDiffStat([])).toBeNull()
    expect(toolRunDiffStat([{ type: 'tool-result', output: 'ok' }])).toBeNull()
  })
})

// docs/claude-app-parity.md item 3: the green/red "+A −R" chip the Claude app
// draws beside a run that created or edited a file.
describe('toolRunDiffStat', () => {
  it('sums editPatch hunks for a landed Edit, the strongest evidence available', () => {
    const call: NativeChatBlock = {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' },
      state: 'completed'
    }
    const result: NativeChatBlock = {
      type: 'tool-result',
      output: 'ok',
      editPatch: {
        filePath: '/repo/a.ts',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }]
      }
    }
    expect(toolRunDiffStat([call, result])).toEqual({ added: 2, removed: 1 })
  })

  it("counts a created file's whole content as added lines, none removed", () => {
    const call: NativeChatBlock = {
      type: 'tool-call',
      name: 'Write',
      input: { file_path: '/repo/NEW.md', content: 'one\ntwo\nthree\n' }
    }
    const result: NativeChatBlock = {
      type: 'tool-result',
      output: 'File created successfully at: /repo/NEW.md'
    }
    expect(toolRunDiffStat([call, result])).toEqual({ added: 3, removed: 0 })
  })

  it("falls back to an Edit's own old/new strings when there is no editPatch", () => {
    const call: NativeChatBlock = {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: '/repo/b.ts', old_string: 'x\ny\n', new_string: 'x\nz\n' }
    }
    const result: NativeChatBlock = { type: 'tool-result', output: 'ok' }
    expect(toolRunDiffStat([call, result])).toEqual({ added: 1, removed: 1 })
  })

  it('sums every edit-shaped call across the whole run, not just one', () => {
    const write: NativeChatBlock = {
      type: 'tool-call',
      name: 'Write',
      input: { file_path: '/repo/NEW.md', content: 'a\nb\n' }
    }
    const writeResult: NativeChatBlock = {
      type: 'tool-result',
      output: 'File created successfully at: /repo/NEW.md'
    }
    const edit: NativeChatBlock = {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: '/repo/c.ts', old_string: 'p', new_string: 'q\nr' }
    }
    const editResult: NativeChatBlock = { type: 'tool-result', output: 'ok' }
    expect(
      toolRunDiffStat([
        { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool-result', output: '' },
        write,
        writeResult,
        edit,
        editResult
      ])
    ).toEqual({ added: 4, removed: 1 })
  })

  it('draws nothing for a run that touched no file', () => {
    expect(
      toolRunDiffStat([
        { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool-result', output: '' }
      ])
    ).toBeNull()
  })

  it('draws nothing for an edit call that is still running, since nothing landed yet', () => {
    const call: NativeChatBlock = {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: '/repo/d.ts', old_string: 'a', new_string: 'b' },
      state: 'running'
    }
    expect(toolRunDiffStat([call])).toBeNull()
  })

  it('draws nothing for an edit call that failed', () => {
    const call: NativeChatBlock = {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: '/repo/e.ts', old_string: 'a', new_string: 'b' }
    }
    const result: NativeChatBlock = {
      type: 'tool-result',
      output: 'no such string',
      isError: true
    }
    expect(toolRunDiffStat([call, result])).toBeNull()
  })
})
