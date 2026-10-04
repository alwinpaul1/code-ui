import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { projectStructuredItemsToNativeChat } from '../../../src/shared/structured-agent-session-projection'
import { readTaskEvidence } from './mobile-background-task-evidence'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

// A structured chat's tool row carries its call and its output in one journal row, and its result
// names the call (`callId`, #22619). A call still running has no result yet, so a later call that
// fails fast puts its result in the run BEFORE the running call's: Bash a (still running), Edit b,
// b's failed result. `pairToolBlocks` (src/shared/native-chat-tool-fold.ts) gives that result to
// b, the call it names. Two phone readers paired first-in-first-out instead, and gave it to a.
function payload(text: string) {
  return { head: text, byteLength: text.length, digest: 'd', truncated: false }
}

function toolRow(
  sequence: number,
  name: string,
  callId: string,
  input: unknown,
  state: 'running' | 'completed' | 'failed',
  output?: string
): AgentJournalRenderItem {
  return {
    itemId: `tool-${callId}`,
    revision: 1,
    sequence,
    observedAt: 1_000 + sequence,
    body: {
      kind: 'tool-call',
      name,
      input,
      callId,
      state,
      ...(output !== undefined ? { output: payload(output) } : {})
    }
  }
}

const RUNNING_BASH = toolRow(1, 'Bash', 'call_a', { command: 'npm test', description: 'Run the tests' }, 'running')
const FAILED_EDIT = toolRow(
  2,
  'Edit',
  'call_b',
  { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' },
  'failed',
  '<tool_use_error>String to replace not found in file.</tool_use_error>'
)

describe("a failed result that arrives before an earlier call's", () => {
  it('pairs with the call it names, as the fold does', () => {
    const blocks = projectStructuredItemsToNativeChat([RUNNING_BASH, FAILED_EDIT]).flatMap(
      (message) => message.blocks
    )
    const pairs = pairToolBlocks(blocks)
    expect(pairs.map((pair) => [pair.call?.name, pair.result?.isError ?? null])).toEqual([
      ['Bash', null],
      ['Edit', true]
    ])
  })

  it("counts the failure against the edit in the run's sentence, not the command", () => {
    const blocks = projectStructuredItemsToNativeChat([RUNNING_BASH, FAILED_EDIT]).flatMap(
      (message) => message.blocks
    )
    expect(toolRunSentence(blocks)).toBe('Ran a command, edited a file (1 failed)')
  })

  it('still lists a background shell started after it, while the earlier command runs', () => {
    const backgroundShell = toolRow(
      3,
      'Bash',
      'call_c',
      { command: 'npm run dev', description: 'Start the dev server', run_in_background: true },
      'completed',
      'Command running in background with ID: bg1dev'
    )
    const messages = projectStructuredItemsToNativeChat([RUNNING_BASH, FAILED_EDIT, backgroundShell])
    const tasks = deriveBackgroundTasks(messages, 10_000)
    expect(tasks.running.map((task) => [task.id, task.title])).toEqual([
      ['bg1dev', 'Start the dev server']
    ])
  })

  // The same pairing feeds the window's task evidence (found by sweeping for every
  // first-in-first-out reader): the shell's label is what a completion row on screen names.
  it("still labels that background shell in the window's task evidence", () => {
    const backgroundShell = toolRow(
      3,
      'Bash',
      'call_c',
      { command: 'npm run dev', description: 'Start the dev server', run_in_background: true },
      'completed',
      'Command running in background with ID: bg1dev'
    )
    const evidence = readTaskEvidence(
      projectStructuredItemsToNativeChat([RUNNING_BASH, FAILED_EDIT, backgroundShell])
    )
    expect(evidence.shellLaunches).toEqual([{ id: 'bg1dev', label: 'Start the dev server' }])
  })

  it('keeps pairing by position for results that name no call (the transcript lane)', () => {
    const blocks = projectStructuredItemsToNativeChat([
      toolRow(1, 'Bash', 'call_a', { command: 'ls' }, 'completed', 'a.txt'),
      toolRow(2, 'Edit', 'call_b', { file_path: '/repo/a.txt' }, 'failed', 'denied')
    ]).flatMap((message) => message.blocks)
    const unnamed = blocks.map((block) =>
      block.type === 'tool-result' ? { type: block.type, output: block.output, isError: block.isError } : block
    )
    expect(toolRunSentence(unnamed)).toBe(toolRunSentence(blocks))
    expect(toolRunSentence([])).toBe('')
  })
})
