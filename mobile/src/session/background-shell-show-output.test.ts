import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { GATE_SHELL, TWO_FILE_FINISHED_SHELL, TWO_FILE_RUNNING_SHELL, leadRows } from './fixtures/claude-lead-shell-output-read'
import { REAL_READS } from './fixtures/claude-read-results-2.1.283'
import { READ_SHELL, TASK_OUTPUT_SHELL, readShellRows, taskOutputShellRows } from './fixtures/claude-shell-output-reads'
import { capturedShellOutput } from './mobile-background-shell-output'

// Parity gap G27: the Claude app's finished shell row opens "Show output",
// which asks Claude Code for the task's output (`get_task_output`). Orca has no
// such call, and its file grants never reach the output file (it sits in /tmp,
// named only in user-role rows and tool results, never in assistant text or on
// the terminal, which is what the two grant paths vouch with). What the phone
// does have is every time the agent itself read that file. Real sessions only.

describe("a background shell's output, from the agent's own reads of it", () => {
  it("shows the lines a Read of the shell's own output file returned, and says the shell was still running", () => {
    const found = capturedShellOutput(readShellRows(), READ_SHELL)
    expect(found).toMatchObject({ kind: 'captured', via: 'Read', truncated: false, whileRunning: true })
    const text = found.kind === 'captured' ? found.text : ''
    expect(text.split('\n')[0]).toBe('lint=1')
    expect(text.split('\n')).toHaveLength(REAL_READS.shellOutputFile.file.totalLines)
    // The numbers the Read put in front are not the file's.
    expect(/^\d+\t/m.test(text)).toBe(false)
  })

  it("takes TaskOutput's output block, the agent's last look at a running shell", () => {
    const found = capturedShellOutput(taskOutputShellRows(), TASK_OUTPUT_SHELL)
    expect(found).toMatchObject({ kind: 'captured', via: 'TaskOutput', whileRunning: true, truncated: false })
    expect(found.kind === 'captured' ? found.text : '').toBe(
      'exit=0\nadb: no devices/emulators found\nadb: no devices/emulators found\nadb: no devices/emulators found'
    )
  })

  it('finds nothing in a read that runs other commands beside the file: their output is in the same result', () => {
    // Every read of the 7h gate's file came inside a longer command.
    expect(capturedShellOutput(leadRows('gate'), GATE_SHELL)).toEqual({ kind: 'none' })
  })

  it('finds nothing for either shell when one command reads two output files', () => {
    const rows = leadRows('two-file')
    expect(capturedShellOutput(rows, TWO_FILE_FINISHED_SHELL)).toEqual({ kind: 'none' })
    expect(capturedShellOutput(rows, TWO_FILE_RUNNING_SHELL)).toEqual({ kind: 'none' })
  })

  it('says a read Orca cut on the wire is truncated, and drops the cut line', () => {
    const long = Array.from({ length: 300 }, (_, index) => `${index + 1}\tline ${index + 1} of the build log`).join('\n')
    const cut = `${long.slice(0, 4000)}\n… (truncated)`
    const rows: NativeChatMessage[] = [
      {
        id: 'a',
        role: 'assistant',
        timestamp: null,
        source: 'transcript',
        blocks: [{ type: 'tool-call', name: 'Read', input: { file_path: `/private/tmp/claude-501/x/s/tasks/${READ_SHELL}.output` } }]
      },
      { id: 'b', role: 'tool', timestamp: null, source: 'transcript', blocks: [{ type: 'tool-result', output: cut }] }
    ]
    const found = capturedShellOutput(rows, READ_SHELL)
    expect(found).toMatchObject({ kind: 'captured', truncated: true })
    const lines = found.kind === 'captured' ? found.text.split('\n') : []
    expect(lines.at(-1)).toMatch(/^line \d+ of the build log$/)
  })

  it('finds nothing in an empty transcript, or for a shell nothing read', () => {
    expect(capturedShellOutput([], READ_SHELL)).toEqual({ kind: 'none' })
    expect(capturedShellOutput(readShellRows(), 'bnotreadx')).toEqual({ kind: 'none' })
  })
})
