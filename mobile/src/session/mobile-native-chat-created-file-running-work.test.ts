// A cut create's count is read back from the file, so work that was still
// running when the create landed must void it: a background shell, a
// background agent, a teammate, or an agent a message woke can write the file
// later with no call of its own in this transcript. Review of 2026-09-26: a
// background agent kept writing to a 93-line create and the chip drew +125.
//
// The launch and finish sentences are the background-task reader's own
// fixtures, verbatim from Claude Code's transcripts on this machine (shells
// 2026-09-09, a user-backgrounded shell 2.1.270, agents 2.1.281, a teammate
// spawn 2.1.283, a foreground agent 2026-08-11), copied from
// mobile-background-tasks.test.ts and the tests beside it.

import { describe, expect, it } from 'vitest'
import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { cutCreateOf, cutCreateStandings } from './mobile-native-chat-created-file-count'
import { CREATED_A_FILE_RUN } from './fixtures/claude-edit-runs-2.1.282'
import {
  agentFinishedNotification,
  asyncAgentLaunchResult
} from './fixtures/claude-parallel-agents-2.1.281'

const WRITE = CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock
const WRITE_RESULT = CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
const KEY = cutCreateOf(WRITE, WRITE_RESULT)!.key
const SHELL_ID = 'bzp6f42la'
const AGENT_ID = 'ad17a815f19b6f5ae'

const backgroundStartOutput = (id: string) =>
  `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/98f20015-91ca-4aa2-a927-e971838f8a7f/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.
Session cwd remains /Users/alwinpaul/Desktop/Project/Walletify; directory changes made by the backgrounded command do not apply to subsequent commands.`

const movedToBackgroundOutput = (id: string) =>
  `Command did not complete within its 300s timeout and was moved to the background (ID: ${id}). Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/95d59b2b-5d7a-406c-a5f8-36a952ff76b5/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`

const manuallyBackgroundedOutput = (id: string) =>
  `Command was manually backgrounded by user with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/69c622ea-9120-4353-b0dc-6a198bcf5ceb/tasks/${id}.output.`

const monitorStartOutput = (id: string) =>
  `Monitor started (task ${id}, timeout 3000000ms). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.`

const TEAMMATE_SPAWN_OUTPUT =
  'Spawned successfully. (This tool result is internal metadata — never quote or paste any part of it into a user-facing reply.)\nagent_id: reviewer@review\nname: reviewer'

const FOREGROUND_AGENT_OUTPUT = `## Summary

**Verdict: NO** — no official IONITY truck-suitability flag for German sites exists.
agentId: a093e15feb44a7819 (use SendMessage with to: 'a093e15feb44a7819', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 92022
tool_uses: 28
duration_ms: 310179</usage>`

// Orca cuts every tool result it sends the phone at 4000 characters and marks
// the cut (`clip`, MOBILE_BLOCK_CHAR_CAP and TRUNCATION_MARKER in
// src/main/runtime/rpc/methods/native-chat.ts, Orca ac675ded6e). A long
// report loses its usage block to the cut, and its id line too once it runs
// past it. Review of 3598d39b: such a report read as an agent still running
// and held every later create's count off for the rest of the transcript.
const cutByTheWire = (output: string) => `${output.slice(0, 4000)}\n… (truncated)`

/** A foreground agent's report long enough that its usage block opens at
 *  `usageAt`. */
function reportWithUsageAt(usageAt: number): string {
  const findings = 'The job queue drains its entries in order. '
    .repeat(200)
    .slice(0, usageAt - FOREGROUND_AGENT_OUTPUT.indexOf('<usage>'))
  return `${findings}${FOREGROUND_AGENT_OUTPUT}`
}

// SendMessage's answers, verbatim in shape from this machine's transcripts
// (Claude Code 2.1.281): waking an agent that had finished, and a message to a
// teammate's inbox.
const resumedOutput = (id: string) =>
  `{"success":true,"message":"Resuming agent ${id.slice(0, 7)}","resumedAgentId":"${id}","pin":{"id":"${id}","name":"${id}","ref":"77ab6a"}}`

const INBOX_OUTPUT =
  '{"success":true,"message":"Message sent to reviewer\'s inbox","msg_id":"63c341df-d33b-41a3-8d78-c2e31a94d6ce","routing":{"sender":"team-lead","target":"@reviewer","targetColor":"green","summary":"Check the job","content":"Check it"}}'

const USER_TURNED_DOWN =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."

const shellNotification = (id: string) =>
  `<task-notification>
<task-id>${id}</task-id>
<tool-use-id>toolu_01MYrD6JLqm1Z39124tyRFCy</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/98f20015-91ca-4aa2-a927-e971838f8a7f/tasks/${id}.output</output-file>
<status>completed</status>
<summary>Background command "Watch the jobs" completed (exit code 0)</summary>
</task-notification>`

let nextId = 0

function message(role: 'assistant' | 'user', blocks: NativeChatBlock[]): NativeChatMessage {
  nextId += 1
  return { id: `m-${nextId}`, role, blocks, timestamp: null, source: 'transcript' }
}

function called(name: string, input: unknown): NativeChatMessage {
  return message('assistant', [{ type: 'tool-call', name, input }])
}

function answered(output: string): NativeChatMessage {
  return message('user', [{ type: 'tool-result', output }])
}

function launched(name: string, input: unknown, output: string): NativeChatMessage[] {
  return [called(name, input), answered(output)]
}

function said(text: string): NativeChatMessage {
  return message('user', [{ type: 'text', text }])
}

const CREATE = [message('assistant', [WRITE]), message('user', [WRITE_RESULT])]

function touched(messages: NativeChatMessage[]): boolean | undefined {
  return cutCreateStandings(messages).get(KEY)?.touched
}

const BACKGROUND_AGENT = {
  description: "Keep phone's own message copy",
  prompt: 'Keep the phone’s own copy of a message',
  subagent_type: 'general-purpose',
  run_in_background: true
}

const WAKE_AGENT = { to: AGENT_ID, summary: 'One more file', message: 'Also tidy the job' }

describe('a create made while earlier work was still running', () => {
  it.each([
    [
      'a background command',
      launched(
        'Bash',
        { command: 'npm run watch', description: 'Watch the jobs', run_in_background: true },
        backgroundStartOutput(SHELL_ID)
      )
    ],
    [
      'a command moved to the background at its timeout',
      launched('Bash', { command: 'make sweep' }, movedToBackgroundOutput(SHELL_ID))
    ],
    [
      'a command the user backgrounded',
      launched('Bash', { command: 'make sweep' }, manuallyBackgroundedOutput(SHELL_ID))
    ],
    [
      'a monitor',
      launched('Monitor', { command: 'tail -f sweep.log' }, monitorStartOutput(SHELL_ID))
    ],
    ['a background agent', launched('Agent', BACKGROUND_AGENT, asyncAgentLaunchResult(AGENT_ID))],
    [
      'a teammate',
      launched(
        'Agent',
        { description: 'Review the jobs', prompt: 'Review', name: 'reviewer', team_name: 'review' },
        TEAMMATE_SPAWN_OUTPUT
      )
    ]
  ])('draws no count for a create made while %s was still running', (_, before) => {
    expect(touched([...before, ...CREATE])).toBe(true)
  })

  it('draws no count for a create beside a background command launched just before it in the same turn', () => {
    const turn = [
      called('Bash', { command: 'npm run watch', run_in_background: true }),
      message('assistant', [WRITE]),
      answered(backgroundStartOutput(SHELL_ID)),
      message('user', [WRITE_RESULT])
    ]
    expect(touched(turn)).toBe(true)
  })

  it('draws no count for a create made after an agent call whose answer the transcript does not hold', () => {
    const unanswered = called('Agent', BACKGROUND_AGENT)
    expect(touched([unanswered, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made while an agent a message woke was still working', () => {
    const history = [
      ...launched('Agent', BACKGROUND_AGENT, asyncAgentLaunchResult(AGENT_ID)),
      said(agentFinishedNotification(AGENT_ID, BACKGROUND_AGENT.description)),
      ...launched('SendMessage', WAKE_AGENT, resumedOutput(AGENT_ID))
    ]
    expect(touched([...history, ...CREATE])).toBe(true)
  })

  it('counts again once the agent a message woke has reported', () => {
    const history = [
      ...launched('SendMessage', WAKE_AGENT, resumedOutput(AGENT_ID)),
      said(agentFinishedNotification(AGENT_ID, BACKGROUND_AGENT.description))
    ]
    expect(touched([...history, ...CREATE])).toBe(false)
  })

  it('counts again once an agent woken in the older message shape has reported', () => {
    const older = { type: 'message', recipient: AGENT_ID, content: 'Also tidy the job' }
    const history = [
      ...launched('SendMessage', older, resumedOutput(AGENT_ID)),
      said(agentFinishedNotification(AGENT_ID, BACKGROUND_AGENT.description))
    ]
    expect(touched([...history, ...CREATE])).toBe(false)
    expect(touched([...history.slice(0, 2), ...CREATE])).toBe(true)
  })

  it('still counts a create made after the turn that called an agent was interrupted', () => {
    const history = [
      called('Agent', BACKGROUND_AGENT),
      said('[Request interrupted by user for tool use]')
    ]
    expect(touched([...history, ...CREATE])).toBe(false)
  })

  it('draws no count once a message after the create reaches a teammate', () => {
    const later = launched(
      'SendMessage',
      { to: 'reviewer', summary: 'Check the job', message: 'Check it' },
      INBOX_OUTPUT
    )
    expect(touched([...CREATE, ...later])).toBe(true)
  })

  it('still counts a create made after the background command reported', () => {
    const history = [
      ...launched(
        'Bash',
        { command: 'npm run watch', run_in_background: true },
        backgroundStartOutput(SHELL_ID)
      ),
      said(shellNotification(SHELL_ID))
    ]
    expect(touched([...history, ...CREATE])).toBe(false)
  })

  it('still counts a create made after the background agent reported', () => {
    const history = [
      ...launched('Agent', BACKGROUND_AGENT, asyncAgentLaunchResult(AGENT_ID)),
      said(agentFinishedNotification(AGENT_ID, BACKGROUND_AGENT.description))
    ]
    expect(touched([...history, ...CREATE])).toBe(false)
  })

  it('still counts a create made after the background task was stopped', () => {
    const history = [
      ...launched(
        'Bash',
        { command: 'npm run watch', run_in_background: true },
        backgroundStartOutput(SHELL_ID)
      ),
      called('TaskStop', { task_id: SHELL_ID })
    ]
    expect(touched([...history, ...CREATE])).toBe(false)
  })

  it('draws no count when the only report came after the create', () => {
    const launch = launched(
      'Bash',
      { command: 'npm run watch', run_in_background: true },
      backgroundStartOutput(SHELL_ID)
    )
    expect(touched([...launch, ...CREATE, said(shellNotification(SHELL_ID))])).toBe(true)
  })

  it('still counts a create made after a foreground agent reported', () => {
    const agent = launched(
      'Agent',
      { description: 'Find the flag', prompt: 'Find it' },
      FOREGROUND_AGENT_OUTPUT
    )
    expect(touched([...agent, ...CREATE])).toBe(false)
  })

  it.each([
    ['past its id line', 5000, false],
    ['just before its usage block', 4000, true]
  ])(
    'still counts a create made after a foreground agent whose long report the wire cut %s',
    (_, usageAt, keepsIdLine) => {
      const report = cutByTheWire(reportWithUsageAt(usageAt))
      expect(report).not.toContain('<usage>')
      expect(report.includes('agentId: a093e15feb44a7819 (use SendMessage')).toBe(keepsIdLine)
      const agent = launched('Agent', { description: 'Find the flag', prompt: 'Find it' }, report)
      expect(touched([...agent, ...CREATE])).toBe(false)
    }
  )

  it.each([
    [
      "a teammate's spawn",
      { description: 'Review the jobs', prompt: 'Review', name: 'reviewer', team_name: 'review' },
      `${TEAMMATE_SPAWN_OUTPUT}\n${'note: '.repeat(800)}`
    ],
    [
      'a background launch in the JSON shape a server flag serves',
      BACKGROUND_AGENT,
      `{"resultType":"task","taskId":"${AGENT_ID}","status":"working","statusMessage":${JSON.stringify(asyncAgentLaunchResult(AGENT_ID).repeat(4))}}`
    ]
  ])('draws no count for a create made after %s the wire cut', (_, input, output) => {
    const agent = launched('Agent', input, cutByTheWire(output))
    expect(touched([...agent, ...CREATE])).toBe(true)
  })

  it('still counts a create made after an agent call the user turned down', () => {
    const agent = launched('Agent', BACKGROUND_AGENT, USER_TURNED_DOWN)
    expect(touched([...agent, ...CREATE])).toBe(false)
  })

  it('still counts a create whose background command came after it and names another file', () => {
    const later = launched(
      'Bash',
      { command: 'npm test', run_in_background: true },
      backgroundStartOutput(SHELL_ID)
    )
    expect(touched([...CREATE, ...later])).toBe(false)
  })

  it('holds nothing for work with no create, and counts a create with nothing before it', () => {
    const launch = launched('Agent', BACKGROUND_AGENT, asyncAgentLaunchResult(AGENT_ID))
    expect(cutCreateStandings(launch).size).toBe(0)
    expect(touched(CREATE)).toBe(false)
  })
})
