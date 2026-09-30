import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

// One Codex apply_patch that updated two files and added a third read "Edited
// a file" while the run's own chip beside it counted +3 −2 across three
// files: the sentence counted edit CALLS, the chip the FILES they changed
// (review, 2026-09-30). The edit kind now counts the files the call is known
// to have changed, through the same editFilesForToolCall the chip reads.

// Codex's freeform apply_patch reaches the phone as one string, the envelope
// itself, answered with the tool's own "Success. Updated the following files"
// wording (the shape mobile-native-chat-tool-run-diff-stat.test.ts pins).
const THREE_FILE_PATCH =
  '*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** Update File: b.ts\n@@\n-p\n+q\n*** Add File: c.ts\n+hello\n*** End Patch'
const PATCH_OK = 'Success. Updated the following files:\nM a.ts\nM b.ts\nA c.ts\n'

function applyPatch(input: unknown, output = PATCH_OK, isError = false): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'apply_patch', input },
    { type: 'tool-result', output, ...(isError ? { isError: true } : {}) }
  ]
}

// Claude Code's Edit: a snippet pair on one path, answered with its own
// "has been updated" line.
function edit(path: string, isError = false): NativeChatBlock[] {
  return [
    {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: path, old_string: 'was', new_string: 'now' }
    },
    {
      type: 'tool-result',
      output: isError ? 'String to replace not found in file.' : `The file ${path} has been updated successfully.`,
      ...(isError ? { isError: true } : {})
    }
  ]
}

describe('the run sentence counts the files an edit changed, as the chip beside it does', () => {
  it('says "Edited 3 files" for one apply_patch that updates two files and adds a third', () => {
    const run = applyPatch({ input: THREE_FILE_PATCH })
    expect(toolRunDiffStat(run)).toEqual({ added: 3, removed: 2 })
    expect(toolRunSentence(run)).toBe('Edited 3 files')
    // The freeform string shape Codex sends reads the same.
    expect(toolRunSentence(applyPatch(THREE_FILE_PATCH))).toBe('Edited 3 files')
  })

  it('reads two Edits of one file as "Edited a file", the one file its chip counts', () => {
    expect(toolRunSentence([...edit('/repo/a.ts'), ...edit('/repo/a.ts')])).toBe('Edited a file')
    expect(toolRunSentence([...edit('/repo/a.ts'), ...edit('/repo/b.ts')])).toBe('Edited 2 files')
  })

  it('counts a file once across calls of both shapes', () => {
    expect(
      toolRunSentence([...applyPatch(THREE_FILE_PATCH), ...edit('a.ts'), ...edit('d.ts')])
    ).toBe('Edited 4 files')
  })

  it("counts a failed edit by the path it names, and still says it failed", () => {
    expect(toolRunSentence([...edit('/repo/a.ts', true), ...edit('/repo/b.ts')])).toBe(
      'Edited 2 files (1 failed)'
    )
    expect(toolRunSentence([...edit('/repo/a.ts', true), ...edit('/repo/a.ts')])).toBe(
      'Edited a file (1 failed)'
    )
    // A patch that failed counts the files it set out to change.
    expect(toolRunSentence(applyPatch(THREE_FILE_PATCH, 'Failed to apply patch', true))).toBe(
      'Edited 3 files (1 failed)'
    )
  })

  it('never merges edits whose files it cannot tell apart', () => {
    const blind: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Edit', input: {} },
      { type: 'tool-result', output: '' },
      { type: 'tool-call', name: 'Edit', input: { old_string: 'a', new_string: 'b' } },
      { type: 'tool-result', output: 'ok' },
      { type: 'tool-call', name: 'Edit', input: { old_string: 'c', new_string: 'd' } },
      { type: 'tool-result', output: 'ok' }
    ]
    expect(toolRunSentence(blind)).toBe('Edited 3 files')
  })

  it('keeps the one-file and empty runs as they were', () => {
    expect(toolRunSentence(edit('/repo/a.ts'))).toBe('Edited a file')
    expect(toolRunSentence([])).toBe('')
    // A patch that only adds one file still reads as the creation it is.
    expect(toolRunSentence(applyPatch('*** Begin Patch\n*** Add File: c.ts\n+hello\n*** End Patch'))).toBe(
      'Created a file'
    )
  })
})
