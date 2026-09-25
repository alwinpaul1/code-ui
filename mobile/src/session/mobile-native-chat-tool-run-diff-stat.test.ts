import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'

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
