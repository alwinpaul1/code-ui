import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import { readTaskEvidence } from './mobile-background-task-evidence'
import { outputReadEnding } from './mobile-background-task-transcript'
import {
  GATE_LAUNCHED_AT,
  GATE_RUNNING_READ_UUID,
  GATE_SHELL,
  GATE_TRAILER_READ_UUID,
  TWO_FILE_FINISHED_SHELL,
  TWO_FILE_RUNNING_SHELL,
  gateQueueRecords,
  leadRows
} from './fixtures/claude-lead-shell-output-read'

// The user's real session 0954729d, 2026-10-11 (fixtures/claude-lead-shell-output-read.ts):
// a hand-started `claude -r`, so no beacon. The full gate (b1ycnvrjn) ended at
// 00:34:45 while the lead worked, so its notification is a queue-operation that
// Orca's reader drops. Everything else that could have retired it was held up
// for hours by four shells finished subagents had left running: the footer
// read "· 4 shells", so it never counted fewer than the phone named and never
// showed its zero; and the lead's Stop listed them, so Orca never set the pane
// `done`. The sheet showed the gate running for 7h 18m, beside a nameless
// "Background shell" and "+2 shells in subagents".
//
// What does reach the phone: two seconds after the end, the lead read the
// output file, and Claude Code ends that file with "[exited with code 0]".

const NOW = GATE_LAUNCHED_AT + (7 * 60 + 18) * 60_000
const AGENT_STARTED = GATE_LAUNCHED_AT - 15 * 60_000

/** The desk as it stood: the lead's long agent running, so the pane is
 *  `working` and never `done`; the footer counting the four left-behind shells. */
const PINNED_PANE: BackgroundTaskHostStatus = {
  state: 'working',
  stateStartedAt: AGENT_STARTED,
  subagents: [{ id: 'a24c6c88bc5b75ed9', agentType: 'general-purpose', state: 'working', startedAt: AGENT_STARTED }]
}
const PINNED = { onScreenShellCount: 4, leadOnlyShellCount: { count: 2, at: GATE_LAUNCHED_AT + 60_000 } }

describe("a lead shell whose end only Claude Code's output file records", () => {
  it('never reached the phone as a notification: only queue-operation records and an attachment carry it', () => {
    const rows = leadRows('gate')
    expect(rows.some((row) => row.blocks.some((block) => block.type === 'text' && block.text.includes('<task-notification')))).toBe(false)
    expect(gateQueueRecords().map((record) => record.type)).toEqual(['queue-operation', 'queue-operation', 'attachment'])
  })

  it('moves the 7h gate to Finished once the lead reads its output and the file ends "[exited with code 0]"', () => {
    const tasks = deriveBackgroundTasks(leadRows('gate'), NOW, PINNED_PANE, PINNED)

    expect(tasks.running.some((task) => task.id === GATE_SHELL)).toBe(false)
    expect(tasks.finished.find((task) => task.id === GATE_SHELL)).toMatchObject({ kind: 'shell', status: 'completed' })
  })

  it('keeps the gate running while the only read of its output shows no end trailer', () => {
    const tasks = deriveBackgroundTasks(leadRows('gate', GATE_RUNNING_READ_UUID), GATE_LAUNCHED_AT + 5 * 60_000, PINNED_PANE, {
      onScreenShellCount: 5
    })

    expect(tasks.running.filter((task) => task.kind === 'shell').map((task) => task.id)).toEqual([GATE_SHELL])
  })

  it('remembers the gate as ended once the window slides past the read', () => {
    expect(readTaskEvidence(leadRows('gate')).retiredTaskIds).toContain(GATE_SHELL)
    expect(readTaskEvidence(leadRows('gate', GATE_RUNNING_READ_UUID)).retiredTaskIds).not.toContain(GATE_SHELL)
  })

  it("does not retire a shell whose output is read beside another task's: the trailer may be the other's", () => {
    const tasks = deriveBackgroundTasks(leadRows('two-file'), Date.parse('2026-10-09T23:27:00.000Z'), null)

    expect(tasks.running.map((task) => task.id)).toEqual([TWO_FILE_RUNNING_SHELL])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([[TWO_FILE_FINISHED_SHELL, 'completed']])
    expect(readTaskEvidence(leadRows('two-file')).retiredTaskIds).toEqual([TWO_FILE_FINISHED_SHELL])
  })

  it('shows no nameless "Background shell" row and no subagent shell count for shells nothing names', () => {
    const tasks = deriveBackgroundTasks(leadRows('gate', GATE_TRAILER_READ_UUID), NOW, PINNED_PANE, PINNED)

    expect(tasks.running.filter((task) => task.kind === 'shell')).toEqual([])
    expect(tasks).not.toHaveProperty('shellsInSubagents')
  })

  it('shows no nameless shell for a pane Orca holds in `monitoring`: shells a finished subagent left behind hold it there too', () => {
    const monitoring: BackgroundTaskHostStatus = { state: 'working', workingMode: 'monitoring', stateStartedAt: NOW - 60_000, subagents: [] }
    const tasks = deriveBackgroundTasks([], NOW, monitoring, { onScreenShellCount: 4 })

    expect(tasks.running).toEqual([])
  })

  it('shows nothing running for an empty window, whatever the footer counts', () => {
    const tasks = deriveBackgroundTasks([], NOW, PINNED_PANE, { onScreenShellCount: 4 })

    expect(tasks.running.filter((task) => task.kind === 'shell')).toEqual([])
    expect(tasks).not.toHaveProperty('shellsInSubagents')
  })
})

// Found by the Opus review of 59494020b. No real record of either shape exists
// yet, so these are built in the shape of the real ones above (Claude Code
// 2.1.296 launch sentences, a transcript's results carrying no call id).
describe('a trailer that may belong to another task proves nothing (review of 59494020b)', () => {
  const dir = '/private/tmp/claude-501/x/sess/tasks'
  const launchOut = (id: string) =>
    `Command running in background with ID: ${id}. Output is being written to: ${dir}/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`
  let n = 0
  const msg = (role: 'assistant' | 'tool', blocks: NativeChatMessage['blocks'], timestamp: number): NativeChatMessage => ({
    id: `r${++n}`,
    role,
    timestamp,
    source: 'transcript',
    blocks
  })

  it('keeps a running shell running when two reads were in flight and the ended one answered first', () => {
    const t = 1_000_000
    const messages: NativeChatMessage[] = [
      msg('assistant', [{ type: 'tool-call', name: 'Bash', input: { command: 'npm test', run_in_background: true, description: 'gate A' } }], t),
      msg('tool', [{ type: 'tool-result', output: launchOut('aaaaaaaaa') }], t + 1),
      msg('assistant', [{ type: 'tool-call', name: 'Bash', input: { command: 'npm run lint', run_in_background: true, description: 'lint B' } }], t + 2),
      msg('tool', [{ type: 'tool-result', output: launchOut('bbbbbbbbb') }], t + 3),
      msg(
        'assistant',
        [
          { type: 'tool-call', name: 'Bash', input: { command: `sleep 20; tail -3 ${dir}/aaaaaaaaa.output` } },
          { type: 'tool-call', name: 'Bash', input: { command: `tail -3 ${dir}/bbbbbbbbb.output` } }
        ],
        t + 4
      ),
      msg('tool', [{ type: 'tool-result', output: 'lint ok\n[exited with code 0]' }], t + 5),
      msg('tool', [{ type: 'tool-result', output: 'test 41/97 ...' }], t + 25)
    ]
    expect(deriveBackgroundTasks(messages, t + 60_000, null).running.map((task) => task.id)).toContain('aaaaaaaaa')
    expect(readTaskEvidence(messages).retiredTaskIds).not.toContain('aaaaaaaaa')
  })

  it("keeps running a shell whose own command follows another task's output, though its output shows that task's trailer", () => {
    const t = 2_000_000
    const messages: NativeChatMessage[] = [
      msg('assistant', [{ type: 'tool-call', name: 'Bash', input: { command: `tail -f ${dir}/xxxxxxxxx.output`, run_in_background: true, description: 'follow' } }], t),
      msg('tool', [{ type: 'tool-result', output: launchOut('yyyyyyyyy') }], t + 1),
      msg('assistant', [{ type: 'tool-call', name: 'Read', input: { file_path: `${dir}/yyyyyyyyy.output` } }], t + 2),
      msg('tool', [{ type: 'tool-result', output: '     1\tbuilding\n     2\t[exited with code 0]' }], t + 3)
    ]
    expect(deriveBackgroundTasks(messages, t + 60_000, null).running.map((task) => task.id)).toEqual(['yyyyyyyyy'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })
})

describe('reading the end trailer off one read of one output file', () => {
  const call = (command: string) => ({ name: 'Bash', input: { command }, startedAt: 0 })
  const path = '/private/tmp/claude-501/x/tasks/b1ycnvrjn.output'

  it('reads how the task ended, by its own words', () => {
    expect(outputReadEnding(call(`cat ${path} | tail -2; node x`), { output: '[exited with code 0]\n Tests 97 passed' })).toEqual({
      id: 'b1ycnvrjn',
      status: 'completed'
    })
    expect(outputReadEnding(call(`tail -3 ${path}`), { output: 'FAIL x\n\n[exited with code 1]' })).toEqual({ id: 'b1ycnvrjn', status: 'failed' })
    expect(outputReadEnding(call(`tail -3 ${path}`), { output: 'TSC_OK\n[killed]' })).toEqual({ id: 'b1ycnvrjn', status: 'stopped' })
  })

  it('reads a Read tool result, whose lines carry their numbers', () => {
    expect(outputReadEnding({ name: 'Read', input: { file_path: path }, startedAt: 0 }, { output: '     1\tok\n     2\t\n     3\t[exited with code 0]' })).toEqual({
      id: 'b1ycnvrjn',
      status: 'completed'
    })
  })

  it('proves nothing from a trailer quoted inside a line, a failed read, or a call naming no output file', () => {
    expect(outputReadEnding(call(`cat ${path}`), { output: 'echo "[exited with code 0]"' })).toBeNull()
    expect(outputReadEnding(call(`cat ${path}`), { output: '[exited with code 0]', isError: true })).toBeNull()
    expect(outputReadEnding(call('cat notes.txt'), { output: '[exited with code 0]' })).toBeNull()
    expect(outputReadEnding(call(`cat ${path}`), { output: '' })).toBeNull()
  })
})
