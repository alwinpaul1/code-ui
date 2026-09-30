import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import {
  WORKFLOW_ENDED_AT,
  WORKFLOW_LAUNCHED_AT,
  WORKFLOW_NOTIFICATION,
  WORKFLOW_TASK_ID,
  workflowLaunchMessages
} from './fixtures/claude-workflow-2.1.284'

// A finished Workflow card lost its "N agents · X tokens · N failed" line when the model-written
// <result> quoted a closing </task-notification> tag, as a workflow that reviews notification parsers
// can: the notification was cut at the first closing tag, the <usage> block after </result> fell
// outside it, and the card had no totals (review, 2026-09-30). The notification is the Claude Code
// 2.1.284 record in fixtures/claude-workflow-2.1.284.ts, its <result> rewritten.

const NOW = WORKFLOW_ENDED_AT + 60_000
const quoting = (result: string) => WORKFLOW_NOTIFICATION.replace(/<result>[\s\S]*?<\/result>/, `<result>${result}</result>`)
const said = (text: string, at = WORKFLOW_ENDED_AT): NativeChatMessage => ({
  id: `said-${at}`,
  role: 'user',
  timestamp: at,
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})
const finishedWorkflow = (messages: NativeChatMessage[]) =>
  deriveBackgroundTasks(messages, NOW).finished.find((task) => task.id === WORKFLOW_TASK_ID)

describe("a finished Workflow whose result quotes a closing </task-notification> tag", () => {
  it('keeps the totals its notification states', () => {
    const text = quoting('see </task-notification> in the parser')
    expect(text.indexOf('</task-notification>')).toBeLessThan(text.indexOf('<usage>'))
    const task = finishedWorkflow([...workflowLaunchMessages(), said(text)])
    expect(task?.status).toBe('completed')
    expect(task?.workflow?.usage).toEqual({ agents: 37, tokens: 4_853_603, durationMs: 5_057_662, failed: 0, skipped: 0 })
  })

  it('keeps them without the quote too, as before', () => {
    expect(finishedWorkflow([...workflowLaunchMessages(), said(WORKFLOW_NOTIFICATION)])?.workflow?.usage?.agents).toBe(37)
  })

  it('still reads a second notification batched after it in the same turn as its own task', () => {
    // A shell's notification in the 2.x shape mobile-background-tasks.test.ts pins.
    const shellLaunch: NativeChatMessage[] = [
      {
        id: 'bash-call',
        role: 'assistant',
        timestamp: WORKFLOW_LAUNCHED_AT + 10_000,
        source: 'transcript',
        blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'pnpm test', description: 'Run the tests', run_in_background: true } }]
      },
      {
        id: 'bash-result',
        role: 'user',
        timestamp: WORKFLOW_LAUNCHED_AT + 10_500,
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: 'Command running in background with ID: bshell123. Output is being written to: /tmp/bshell123.output.' }]
      }
    ]
    const shellDone =
      '<task-notification>\n<task-id>bshell123</task-id>\n<status>failed</status>\n<summary>Background command "Run the tests" failed with exit code 1</summary>\n</task-notification>'
    const batched = `${quoting('see </task-notification> in the parser')}\n${shellDone}`
    const { finished } = deriveBackgroundTasks([...workflowLaunchMessages(), ...shellLaunch, said(batched)], NOW)
    expect(finished.map((task) => [task.id, task.status])).toEqual(
      expect.arrayContaining([
        [WORKFLOW_TASK_ID, 'completed'],
        ['bshell123', 'failed']
      ])
    )
    expect(finished.find((task) => task.id === WORKFLOW_TASK_ID)?.workflow?.usage?.agents).toBe(37)
  })

  it('still reads no usage block the result only quotes, before or after a quoted closing tag', () => {
    const text = quoting('</task-notification> then <usage><agent_count>99</agent_count></usage>')
    const usage = finishedWorkflow([...workflowLaunchMessages(), said(text)])?.workflow?.usage
    expect(usage?.agents).toBe(37)
  })
})
