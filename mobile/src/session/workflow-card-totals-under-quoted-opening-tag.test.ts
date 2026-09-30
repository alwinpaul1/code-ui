import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { readNotifications } from './mobile-background-task-transcript'
import {
  WORKFLOW_ENDED_AT,
  WORKFLOW_LAUNCHED_AT,
  WORKFLOW_NOTIFICATION,
  WORKFLOW_TASK_ID,
  workflowLaunchMessages
} from './fixtures/claude-workflow-2.1.284'

// A finished Workflow card lost its "N agents · X tokens · N failed" line when the model-written
// <result> quoted an OPENING <task-notification> tag, as a workflow that reviews these very parsers
// can: each body was cut at the next opening tag, so the body ended inside the result, the <usage>
// block after </result> fell outside it, and the quoted tag began a phantom second body with no
// task-id (review, 2026-09-30). The earlier fix covered only a quoted CLOSING tag
// (workflow-card-totals-under-quoted-closing-tag.test.ts). The notification is the Claude Code
// 2.1.284 record in fixtures/claude-workflow-2.1.284.ts, its <result> rewritten.

const NOW = WORKFLOW_ENDED_AT + 60_000
const TOTALS = { agents: 37, tokens: 4_853_603, durationMs: 5_057_662, failed: 0, skipped: 0 }
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

// A shell's launch and notification in the 2.x shape mobile-background-tasks.test.ts pins.
const shellLaunch = (id: string, command: string, description?: string): NativeChatMessage[] => [
  {
    id: `bash-call-${id}`,
    role: 'assistant',
    timestamp: WORKFLOW_LAUNCHED_AT + 10_000,
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Bash', input: { command, ...(description ? { description } : {}), run_in_background: true } }]
  },
  {
    id: `bash-result-${id}`,
    role: 'user',
    timestamp: WORKFLOW_LAUNCHED_AT + 10_500,
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: `Command running in background with ID: ${id}. Output is being written to: /tmp/${id}.output.` }]
  }
]
const shellDone = (id: string, summary: string, status = 'completed') =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

describe('a finished Workflow whose result quotes an opening <task-notification> tag', () => {
  it('keeps the totals its notification states', () => {
    const text = quoting('the <task-notification> tag opens a record')
    expect(text.indexOf('<task-notification>', 1)).toBeLessThan(text.indexOf('<usage>'))
    const task = finishedWorkflow([...workflowLaunchMessages(), said(text)])
    expect(task?.status).toBe('completed')
    expect(task?.workflow?.usage).toEqual(TOTALS)
  })

  it('reads one notification, not a phantom second one that starts at the quote', () => {
    const found = readNotifications(quoting('the <task-notification> tag opens a record'), 0)
    expect(found.map((notification) => notification.id)).toEqual([WORKFLOW_TASK_ID])
    expect(found[0]?.value.usage?.agents).toBe(37)
  })

  it('keeps them when the result quotes an opening and a closing tag, in either order', () => {
    for (const result of [
      'a record opens with <task-notification> and ends with </task-notification>',
      'a record ends with </task-notification> and opens with <task-notification>',
      '<task-notification><task-id>bquoted</task-id><status>failed</status></task-notification>'
    ]) {
      const found = readNotifications(quoting(result), 0)
      expect(found.map((notification) => [notification.id, notification.value.status])).toEqual([[WORKFLOW_TASK_ID, 'completed']])
      expect(found[0]?.value.usage).toEqual(TOTALS)
    }
  })

  it('still splits two genuine notifications batched in one turn, both after and before the workflow', () => {
    const launches = [...workflowLaunchMessages(), ...shellLaunch('bshell123', 'pnpm test', 'Run the tests')]
    const quoted = quoting('the <task-notification> tag opens a record')
    const failed = shellDone('bshell123', 'Background command "Run the tests" failed with exit code 1', 'failed')
    for (const batched of [`${quoted}\n${failed}`, `${failed}\n${quoted}`]) {
      const { finished } = deriveBackgroundTasks([...launches, said(batched)], NOW)
      expect(finished.map((task) => [task.id, task.status])).toEqual(
        expect.arrayContaining([
          [WORKFLOW_TASK_ID, 'completed'],
          ['bshell123', 'failed']
        ])
      )
      expect(finished.find((task) => task.id === WORKFLOW_TASK_ID)?.workflow?.usage).toEqual(TOTALS)
    }
  })

  it('still splits two genuine notifications written on one line with nothing between them', () => {
    const one = '<task-notification><task-id>b1</task-id><status>completed</status><summary>one</summary></task-notification>'
    const two = '<task-notification><task-id>b2</task-id><status>failed</status><summary>two</summary></task-notification>'
    expect(readNotifications(one + two, 0).map((found) => [found.id, found.value.status, found.value.summary])).toEqual([
      ['b1', 'completed', 'one'],
      ['b2', 'failed', 'two']
    ])
  })

  it('does not swallow the next notification when an earlier result quotes a lone <result> tag', () => {
    const quotesOpening = quoting('the <result> tag holds the return value')
    const next = shellDone('bshell123', 'Background command "Run the tests" completed (exit code 0)')
    const found = readNotifications(`${quotesOpening}\n${next}`, 0)
    expect(found.map((notification) => notification.id)).toEqual([WORKFLOW_TASK_ID, 'bshell123'])
    expect(found[0]?.value.usage).toEqual(TOTALS)
  })

  it('keeps an escaped summary that names the tag whole, as Claude writes it', () => {
    // Claude escapes the summary (`&amp;&amp;` in a command's), so a background `rg` for the tag
    // quotes it as `&lt;task-notification&gt;`, which is no tag at all.
    const summary = 'Background command "rg &lt;task-notification&gt; src" completed (exit code 0)'
    const found = readNotifications(`${shellDone('bgrep1', summary)}\n${shellDone('bgrep2', 'ok')}`, 0)
    expect(found.map((notification) => [notification.id, notification.value.summary])).toEqual([
      ['bgrep1', summary],
      ['bgrep2', 'ok']
    ])
  })

  it('still reads a record the transcript cut inside its result, with no usage', () => {
    const cut = WORKFLOW_NOTIFICATION.slice(0, WORKFLOW_NOTIFICATION.indexOf('</result>'))
    const found = readNotifications(cut.replace('<result>', '<result>the <task-notification> tag '), 0)
    expect(found.map((notification) => [notification.id, notification.value.status])).toEqual([[WORKFLOW_TASK_ID, 'completed']])
    expect(found[0]?.value.usage).toBeUndefined()
  })

  it('reads nothing from an empty text or a lone opening tag', () => {
    expect(readNotifications('', 0)).toEqual([])
    expect(readNotifications('<task-notification>', 0)).toEqual([])
  })

  it('still loses the totals when the result quotes its own closing </result> before the opening tag (limit)', () => {
    // Nothing tells a quoted </result> from the real one without guessing at what follows it, and
    // a count of <result> against </result> swallows the next record instead ("does not swallow the
    // next notification when an earlier result quotes a lone <result> tag"). So this deeper quote
    // still ends the body at the tag, as every quoted opening did before 2026-09-30.
    const found = readNotifications(quoting('a <result>x</result> field, then <task-notification> again'), 0)
    expect(found.map((notification) => notification.id)).toEqual([WORKFLOW_TASK_ID])
    expect(found[0]?.value.usage).toBeUndefined()
  })
})
