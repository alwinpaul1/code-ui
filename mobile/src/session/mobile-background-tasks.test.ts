import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countRunningBackgroundTasks,
  deriveBackgroundTasks,
  formatBackgroundTaskElapsed,
  formatRunningTaskCount
} from './mobile-background-tasks'

// ─── Real transcript bytes ──────────────────────────────────────────────────
// Every string below is copied verbatim out of Claude Code's own JSONL
// transcripts on this machine (`~/.claude/projects/*/*.jsonl`, read 2026-09-09,
// Claude Code 2.x). The parser keys off these exact sentences, so a paraphrased
// fixture would only agree with a wrong parser.

const backgroundStartOutput = (id: string) =>
  `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/98f20015-91ca-4aa2-a927-e971838f8a7f/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.
Session cwd remains /Users/alwinpaul/Desktop/Project/Walletify; directory changes made by the backgrounded command do not apply to subsequent commands.`

const movedToBackgroundOutput = (id: string) =>
  `Command did not complete within its 300s timeout and was moved to the background (ID: ${id}). Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/95d59b2b-5d7a-406c-a5f8-36a952ff76b5/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`

const agentLaunchOutput = (id: string) =>
  `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: ${id} (internal ID - do not mention to user. Use SendMessage with to: '${id}', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/66948aa6-67d9-41f9-bdad-d346b27f76b5/tasks/${id}.output
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`

const taskNotification = (args: { id: string; status: string; summary: string }) =>
  `<task-notification>
<task-id>${args.id}</task-id>
<tool-use-id>toolu_01MYrD6JLqm1Z39124tyRFCy</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/98f20015-91ca-4aa2-a927-e971838f8a7f/tasks/${args.id}.output</output-file>
<status>${args.status}</status>
<summary>${args.summary}</summary>
</task-notification>`

const agentNotification = (args: { id: string; status: string; summary: string }) =>
  `<task-notification>
<task-id>${args.id}</task-id>
<tool-use-id>toolu_01GZY3PkEMh7sypwhyz4nB76</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/32334df1-ff84-4258-9267-0842127a5dc7/tasks/${args.id}.output</output-file>
<status>${args.status}</status>
<summary>${args.summary}</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>
<result>Sent the full findings to testquality-hunter for consolidation.</result>
<usage><subagent_tokens>200738</subagent_tokens><tool_uses>1</tool_uses><duration_ms>30826</duration_ms></usage>
</task-notification>`

// ─── Message builders ───────────────────────────────────────────────────────

let nextId = 0

function call(name: string, input: unknown, timestamp: number | null): NativeChatMessage {
  nextId += 1
  return {
    id: `assistant-${nextId}`,
    role: 'assistant',
    timestamp,
    source: 'transcript',
    blocks: [{ type: 'tool-call', name, input }]
  }
}

function result(output: string, timestamp: number | null): NativeChatMessage {
  nextId += 1
  return {
    id: `result-${nextId}`,
    role: 'user',
    timestamp,
    source: 'transcript',
    blocks: [{ type: 'tool-result', output }]
  }
}

function userText(text: string, timestamp: number | null): NativeChatMessage {
  nextId += 1
  return {
    id: `user-${nextId}`,
    role: 'user',
    timestamp,
    source: 'transcript',
    blocks: [{ type: 'text', text }]
  }
}

const T0 = Date.UTC(2026, 8, 9, 12, 0, 0)
const NOW = T0 + 19 * 60_000 + 8_000

const WAIT_COMMAND =
  'cd ~/telegram-msg && source .venv/bin/activate && until python read_msg.py --contact @Laura_clawdbot --since 2026-09-01 2>/dev/null | grep -q "^\\[2026-09-01 23:1[3-9]\\] Laura"; do sleep 5; done; echo REPLIED'
const UNDESCRIBED_COMMAND =
  'pnpm --dir mobile exec vitest run src/session --reporter=dot --silent --no-color\necho done'

/** 2 running shells, 1 running agent, 1 completed, 1 failed, 1 moved-to-background. */
function conversation(): NativeChatMessage[] {
  return [
    call(
      'Bash',
      {
        command: WAIT_COMMAND,
        description: "Wait for the bot's reply to the test task",
        timeout: 300_000,
        run_in_background: true
      },
      T0
    ),
    result(backgroundStartOutput('bpz1skord'), T0 + 500),
    call('Bash', { command: UNDESCRIBED_COMMAND, run_in_background: true }, T0 + 60_000),
    result(backgroundStartOutput('bq2m0f5tt'), T0 + 60_500),
    call(
      'Agent',
      {
        description: 'Hunt bugs in ML stack',
        name: 'ml-hunter',
        model: 'sonnet',
        subagent_type: 'general-purpose',
        prompt: 'You are hunting REAL BUGS in the Walletify ML stack.'
      },
      T0 + 120_000
    ),
    result(agentLaunchOutput('a7f98acb78d53840e'), T0 + 120_500),
    call(
      'Bash',
      { command: './scripts/deploy.sh', description: 'Deploy to staging', run_in_background: true },
      T0 + 180_000
    ),
    result(backgroundStartOutput('bhlua4cdn'), T0 + 180_500),
    call(
      'Bash',
      {
        command: 'python3 wait_for_reply.py --contact @Laura_clawdbot',
        description: "Wait for the bot's reply to the second task",
        run_in_background: true
      },
      T0 + 240_000
    ),
    result(backgroundStartOutput('bzktm6jyv'), T0 + 240_500),
    // A foreground Bash that blew its timeout: no run_in_background on the call.
    call(
      'Bash',
      {
        command: 'pnpm --dir mobile run build:android',
        description: 'Build 0.2.60 locally for the phone',
        timeout: 300_000
      },
      T0 + 300_000
    ),
    result(movedToBackgroundOutput('b82ppxrqm'), T0 + 600_000),
    userText(
      taskNotification({
        id: 'bzktm6jyv',
        status: 'completed',
        summary: 'Background command "Wait for the bot\'s reply to the second task" completed (exit code 0)'
      }),
      T0 + 700_000
    ),
    userText(
      taskNotification({
        id: 'bhlua4cdn',
        status: 'failed',
        summary: 'Background command "./scripts/deploy.sh" failed with exit code 1'
      }),
      T0 + 800_000
    )
  ]
}

describe('background tasks derived from the chat transcript', () => {
  it('counts a background shell as running until its task-notification arrives', () => {
    const { running, finished } = deriveBackgroundTasks(conversation(), NOW)
    expect(running.map((task) => task.id)).toContain('bpz1skord')
    expect(finished.map((task) => task.id)).not.toContain('bpz1skord')
    // The one that did notify moved across.
    expect(running.map((task) => task.id)).not.toContain('bzktm6jyv')
    expect(finished.map((task) => task.id)).toContain('bzktm6jyv')
  })

  it('marks a task failed when the notification says failed', () => {
    const { finished } = deriveBackgroundTasks(conversation(), NOW)
    const deploy = finished.find((task) => task.id === 'bhlua4cdn')
    expect(deploy?.status).toBe('failed')
    expect(finished.find((task) => task.id === 'bzktm6jyv')?.status).toBe('completed')
  })

  it('titles a shell by its description, else its first command line', () => {
    const { running } = deriveBackgroundTasks(conversation(), NOW)
    expect(running.find((task) => task.id === 'bpz1skord')?.title).toBe(
      "Wait for the bot's reply to the test task"
    )
    const undescribed = running.find((task) => task.id === 'bq2m0f5tt')
    // First line only, and short enough to read on a phone row.
    expect(undescribed?.title).not.toContain('\n')
    expect(undescribed?.title.length).toBeLessThanOrEqual(60)
    expect(undescribed?.title.startsWith('pnpm --dir mobile exec vitest run')).toBe(true)
  })

  it('adopts a timed-out foreground command as a running task', () => {
    const { running } = deriveBackgroundTasks(conversation(), NOW)
    const adopted = running.find((task) => task.id === 'b82ppxrqm')
    expect(adopted).toBeDefined()
    expect(adopted?.kind).toBe('shell')
    expect(adopted?.title).toBe('Build 0.2.60 locally for the phone')
  })

  it('keeps a launched subagent running under its own agent id', () => {
    const { running } = deriveBackgroundTasks(conversation(), NOW)
    const agent = running.find((task) => task.id === 'a7f98acb78d53840e')
    expect(agent?.kind).toBe('agent')
    expect(agent?.title).toBe('Hunt bugs in ML stack')
    expect(running.filter((task) => task.kind === 'shell')).toHaveLength(3)
  })

  it('lists finished tasks newest first', () => {
    const { finished } = deriveBackgroundTasks(conversation(), NOW)
    expect(finished.map((task) => task.id)).toEqual(['bhlua4cdn', 'bzktm6jyv'])
  })

  it('counts elapsed time from the turn that launched the task', () => {
    const { running, finished } = deriveBackgroundTasks(conversation(), NOW)
    const first = running.find((task) => task.id === 'bpz1skord')
    expect(first?.startedAt).toBe(T0)
    expect(formatBackgroundTaskElapsed(first?.elapsedMs ?? null)).toBe('19m 8s')
    // A finished task shows its status, never a stopwatch.
    expect(finished.every((task) => task.elapsedMs === null)).toBe(true)
  })

  it('shows no elapsed time when the transcript recorded no timestamp', () => {
    const messages = [
      call('Bash', { command: 'sleep 600', run_in_background: true }, null),
      result(backgroundStartOutput('bnull00aa'), null)
    ]
    const { running } = deriveBackgroundTasks(messages, NOW)
    expect(running[0]?.startedAt).toBeNull()
    expect(running[0]?.elapsedMs).toBeNull()
    expect(formatBackgroundTaskElapsed(running[0]?.elapsedMs ?? null)).toBeNull()
  })

  it('keeps the notification summary available as a caption', () => {
    const { finished } = deriveBackgroundTasks(conversation(), NOW)
    expect(finished.find((task) => task.id === 'bhlua4cdn')?.summary).toBe(
      'Background command "./scripts/deploy.sh" failed with exit code 1'
    )
  })

  it('reads an agent notification carrying note, result and usage tags', () => {
    const messages = [
      call('Agent', { description: 'Audit sync/dedupe test quality' }, T0),
      result(agentLaunchOutput('a1a853cef0cfa7b50'), T0 + 100),
      userText(
        agentNotification({
          id: 'a1a853cef0cfa7b50',
          status: 'completed',
          summary: 'Agent "Audit sync/dedupe test quality" finished'
        }),
        T0 + 200
      )
    ]
    const { running, finished } = deriveBackgroundTasks(messages, NOW)
    expect(running).toHaveLength(0)
    expect(finished).toHaveLength(1)
    expect(finished[0]?.kind).toBe('agent')
    expect(finished[0]?.status).toBe('completed')
    expect(finished[0]?.title).toBe('Audit sync/dedupe test quality')
  })

  it('finds nothing in a transcript that never backgrounds anything', () => {
    // Codex records no background-task tool results at all, so its tabs simply
    // never show the row. Ordinary Claude tool traffic must not either.
    const messages = [
      userText('run the tests', T0),
      call('Read', { file_path: '/tmp/x.ts' }, T0 + 1),
      result('     1\tconst x = 1\n', T0 + 2),
      call('Bash', { command: 'pnpm test', description: 'Run the suite' }, T0 + 3),
      result('All tests passed.\n', T0 + 4)
    ]
    expect(deriveBackgroundTasks(messages, NOW)).toEqual({ running: [], finished: [] })
  })

  it('pairs each result with its own call when two tools run in one turn', () => {
    const twoCalls: NativeChatMessage = {
      id: 'assistant-parallel',
      role: 'assistant',
      timestamp: T0,
      source: 'transcript',
      blocks: [
        { type: 'tool-call', name: 'Bash', input: { command: 'first.sh', run_in_background: true } },
        {
          type: 'tool-call',
          name: 'Bash',
          input: { command: 'second.sh', description: 'Second one', run_in_background: true }
        }
      ]
    }
    const messages = [
      twoCalls,
      result(backgroundStartOutput('bfirst001'), T0 + 10),
      result(backgroundStartOutput('bsecond02'), T0 + 20)
    ]
    const { running } = deriveBackgroundTasks(messages, NOW)
    expect(running.map((task) => [task.id, task.title])).toEqual([
      ['bfirst001', 'first.sh'],
      ['bsecond02', 'Second one']
    ])
  })

  it('ignores a notification whose launch has scrolled out of the window', () => {
    // The phone only holds a tail of the transcript. A notification with no
    // launch behind it has no title and no kind, so it is not invented.
    const messages = [
      userText(
        taskNotification({
          id: 'bgonelong',
          status: 'completed',
          summary: 'Background command "something old" completed (exit code 0)'
        }),
        T0
      )
    ]
    expect(deriveBackgroundTasks(messages, NOW)).toEqual({ running: [], finished: [] })
  })

  it('drops tool calls left unanswered by an interrupted turn', () => {
    // The interrupted turn never delivers its result, so the next result in the
    // stream belongs to the turn after it — not to the abandoned call.
    const messages = [
      call('Bash', { command: 'abandoned.sh', description: 'Abandoned' }, T0),
      userText('[Request interrupted by user]', T0 + 1),
      call('Bash', { command: 'kept.sh', description: 'Kept', run_in_background: true }, T0 + 2),
      result(backgroundStartOutput('bkept0001'), T0 + 3)
    ]
    const { running } = deriveBackgroundTasks(messages, NOW)
    expect(running.map((task) => task.title)).toEqual(['Kept'])
  })

  it('retires a task from a notification written on one line', () => {
    // The whole record on a single line, as the hook listener sees it
    // (src/shared/claude-background-task-status.test.ts).
    const messages = [
      call('Bash', { command: 'sleep 15', description: 'Sleep for 15 seconds' }, T0),
      result(backgroundStartOutput('b8rs2wmxg'), T0 + 10),
      userText(
        '<task-notification><task-id>b8rs2wmxg</task-id><status>completed</status></task-notification>',
        T0 + 20
      )
    ]
    const { running, finished } = deriveBackgroundTasks(messages, NOW)
    expect(running).toHaveLength(0)
    expect(finished.map((task) => task.title)).toEqual(['Sleep for 15 seconds'])
  })

  it('counts the running tasks without being told the time', () => {
    expect(countRunningBackgroundTasks(conversation())).toBe(4)
    expect(countRunningBackgroundTasks([])).toBe(0)
  })

  it('keeps one row when the same task id is reported twice', () => {
    const base = conversation()
    const { running } = deriveBackgroundTasks([...base, ...base], NOW)
    expect(new Set(running.map((task) => task.id)).size).toBe(running.length)
  })
})

describe('background task labels', () => {
  it('reads 19m 8s off a task started nineteen minutes ago', () => {
    expect(formatBackgroundTaskElapsed(19 * 60_000 + 8_000)).toBe('19m 8s')
  })

  it('drops the minutes under a minute and the seconds over an hour', () => {
    expect(formatBackgroundTaskElapsed(8_000)).toBe('8s')
    expect(formatBackgroundTaskElapsed(2 * 3_600_000 + 19 * 60_000 + 8_000)).toBe('2h 19m')
  })

  it('never shows a negative stopwatch when the clocks disagree', () => {
    expect(formatBackgroundTaskElapsed(-5_000)).toBe('0s')
  })

  it('says "1 running task" for one and "3 running tasks" for three', () => {
    expect(formatRunningTaskCount(1)).toBe('1 running task')
    expect(formatRunningTaskCount(3)).toBe('3 running tasks')
  })
})
