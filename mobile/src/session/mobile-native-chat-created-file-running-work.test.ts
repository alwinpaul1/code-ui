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

// TaskStop's answers, in the shapes Claude Code 2.1.283's TaskStop builds
// them (read from its source in the binary): its data as JSON when it stopped
// the task, with a note instead when a loop outlived it; its input check's
// message when the task is not running; the sentence a cancel answers with;
// and a denial.
const stoppedOutput = (id: string) =>
  `{"message":"Successfully stopped task: ${id} (npm run watch)","task_id":"${id}","task_type":"local_bash","command":"npm run watch"}`
const loopOutlivedOutput = (id: string) =>
  `{"message":"Task ${id} had already ended (completed) but its loop had not exited; re-signalled it and killed 1 process group(s). The record remains listed while the loop is still live.","task_id":"${id}","task_type":"local_bash","command":"npm run watch"}`
const notRunningOutput = (id: string, status: string) =>
  `<tool_use_error>Task ${id} is not running (status: ${status})</tool_use_error>`
const CANCELLED =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
const DENIED =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: Stopping a task the user started.'
const MISSING_FILE = '<tool_use_error>File does not exist.</tool_use_error>'

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

  // Review of 3598d39b: a TaskStop the user turned down ended the task all
  // the same, so the command still running kept the count of a create after.
  it('draws no count for a create made after a stop of the background task the user turned down', () => {
    const history = [
      ...launched(
        'Bash',
        { command: 'npm run watch', run_in_background: true },
        backgroundStartOutput(SHELL_ID)
      ),
      ...launched('TaskStop', { task_id: SHELL_ID }, USER_TURNED_DOWN)
    ]
    expect(touched([...history, ...CREATE])).toBe(true)
  })

  // Review of 311f41ad: the pairing hands a failure to the first call
  // waiting and anything else to the first that is no Agent call, so a stop
  // answered beside another call can be handed that call's answer.
  const SHELL = launched(
    'Bash',
    { command: 'npm run watch', run_in_background: true },
    backgroundStartOutput(SHELL_ID)
  )
  const STOP_BESIDE = (path: string) =>
    message('assistant', [
      { type: 'tool-call', name: 'TaskStop', input: { task_id: SHELL_ID } },
      { type: 'tool-call', name: 'Read', input: { file_path: path } }
    ])

  it('draws no count for a create made after a stop the user turned down, answered after the read beside it', () => {
    const turn = [STOP_BESIDE('/tmp/a.txt'), answered('     1\tjobs'), answered(USER_TURNED_DOWN)]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(true)
  })

  it('still counts a create made after a stop answered after the read beside it failed', () => {
    const turn = [
      STOP_BESIDE('/tmp/missing.txt'),
      answered(MISSING_FILE),
      answered(stoppedOutput(SHELL_ID))
    ]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(false)
  })

  it('still counts a create made after a stop that found the task outlived by its loop, answered after the read beside it failed', () => {
    const turn = [
      STOP_BESIDE('/tmp/missing.txt'),
      answered(MISSING_FILE),
      answered(loopOutlivedOutput(SHELL_ID))
    ]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(false)
  })

  it.each(['completed', 'failed', 'killed'])(
    'still counts a create made after a stop that found the task already %s',
    (status) => {
      const stop = launched('TaskStop', { task_id: SHELL_ID }, notRunningOutput(SHELL_ID, status))
      expect(touched([...SHELL, ...stop, ...CREATE])).toBe(false)
    }
  )

  it.each([
    ['found the task not running yet', notRunningOutput(SHELL_ID, 'pending')],
    ['found another task not running', notRunningOutput('b0therid1', 'completed')],
    ['the user cancelled', CANCELLED],
    ['was denied', DENIED]
  ])('draws no count for a create made after a stop that %s', (_, output) => {
    const stop = launched('TaskStop', { task_id: SHELL_ID }, output)
    expect(touched([...SHELL, ...stop, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made after a stop answered as an error in words the phone does not know', () => {
    const stop = [
      called('TaskStop', { task_id: SHELL_ID }),
      message('user', [{ type: 'tool-result', output: 'Stopping was blocked.', isError: true }])
    ]
    expect(touched([...SHELL, ...stop, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made after a stop the user turned down beside a read whose answer the transcript does not hold', () => {
    const turn = [STOP_BESIDE('/tmp/a.txt'), answered(USER_TURNED_DOWN)]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made after a stop the user interrupted before it answered', () => {
    const stop = [
      called('TaskStop', { task_id: SHELL_ID }),
      said('[Request interrupted by user for tool use]')
    ]
    expect(touched([...SHELL, ...stop, ...CREATE])).toBe(true)
  })

  // Review of 5b257b16: TaskStop's word was taken from any answer in the
  // batch, so a command printing the same line, or a later stop sharing the
  // batch through a call never answered, vouched for a stop turned down.
  it('draws no count for a create made after a stop the user turned down beside a command whose output quotes TaskStop', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'TaskStop', input: { task_id: SHELL_ID } },
        {
          type: 'tool-call',
          name: 'Bash',
          input: { command: 'grep -h "is not running" /tmp/notes.txt' }
        }
      ]),
      answered(notRunningOutput(SHELL_ID, 'completed')),
      answered(USER_TURNED_DOWN)
    ]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made after a stop the user turned down behind a read never answered, when a later stop worked', () => {
    const history = [
      ...SHELL,
      called('Read', { file_path: '/tmp/never-answered.txt' }),
      ...launched('TaskStop', { task_id: SHELL_ID }, USER_TURNED_DOWN)
    ]
    const later = launched('TaskStop', { task_id: SHELL_ID }, stoppedOutput(SHELL_ID))
    expect(touched([...history, ...CREATE, ...later])).toBe(true)
  })

  // Review of 39937aee: TaskStop answers a task already done with a
  // `<tool_use_error>`, which read as the batch failing, and any call beside
  // it that could print that line then took the stop back. Claude Code marks
  // the answer `is_error` and Orca carries that (transcript-record-blocks.ts,
  // Orca ac675ded6e).
  const alreadyDone = (id: string) =>
    message('user', [
      { type: 'tool-result', output: notRunningOutput(id, 'completed'), isError: true }
    ])
  it.each([
    ['a command', 'Bash', { command: 'npm test' }, 'Tests  12 passed (12)'],
    ['a search that found nothing', 'Grep', { pattern: 'queue' }, 'No files found'],
    [
      'a to-do update',
      'TodoWrite',
      { todos: [] },
      'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable'
    ]
  ])(
    'still counts a create made after a stop that found the task already completed, beside %s',
    (_, name, input, output) => {
      const turn = [
        message('assistant', [
          { type: 'tool-call', name: 'TaskStop', input: { task_id: SHELL_ID } },
          { type: 'tool-call', name, input }
        ]),
        alreadyDone(SHELL_ID),
        answered(output)
      ]
      expect(touched([...SHELL, ...turn, ...CREATE])).toBe(false)
    }
  )

  it('draws no count for a create made after a stop that found another task already completed, beside a command', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'TaskStop', input: { task_id: SHELL_ID } },
        { type: 'tool-call', name: 'Bash', input: { command: 'npm test' } }
      ]),
      alreadyDone('b0therid1'),
      answered('Tests  12 passed (12)')
    ]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(true)
  })

  // Review of d3bb3304: two stops of one task shared the one answer saying
  // it stopped, so the first, turned down, still ended the task before the
  // create between them.
  const STOP = { type: 'tool-call', name: 'TaskStop', input: { task_id: SHELL_ID } } as const

  it('draws no count for a create made between a stop the user turned down and a second stop of the same task that worked', () => {
    const turn = [
      message('assistant', [STOP, WRITE, STOP]),
      answered(USER_TURNED_DOWN),
      message('user', [WRITE_RESULT]),
      answered(stoppedOutput(SHELL_ID))
    ]
    expect(touched([...SHELL, ...turn])).toBe(true)
  })

  it('still counts a create made between two stops of the same task, both answered as ended, beside a failed read', () => {
    const turn = [
      message('assistant', [
        STOP,
        WRITE,
        STOP,
        { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/missing.txt' } }
      ]),
      answered(stoppedOutput(SHELL_ID)),
      message('user', [WRITE_RESULT]),
      alreadyDone(SHELL_ID),
      answered(MISSING_FILE)
    ]
    expect(touched([...SHELL, ...turn])).toBe(false)
  })

  it('still counts a create made after a stop answered after the search beside it failed', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'TaskStop', input: { task_id: SHELL_ID } },
        { type: 'tool-call', name: 'Glob', input: { pattern: '**/*.lock' } }
      ]),
      answered('<tool_use_error>Directory does not exist.</tool_use_error>'),
      answered(stoppedOutput(SHELL_ID))
    ]
    expect(touched([...SHELL, ...turn, ...CREATE])).toBe(false)
  })

  // Review of 5b257b16: a failure goes to the first call waiting, so a quick
  // call beside a launch that fails first takes the launch's place, and the
  // launch's own answer falls to that call, where it reads as nothing.
  const TEAMMATE = {
    description: 'Review',
    prompt: 'Review',
    name: 'reviewer',
    team_name: 'review'
  }
  const besideAFailedRead = (name: string, input: unknown, output: string) => [
    message('assistant', [
      { type: 'tool-call', name, input },
      { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/missing.txt' } }
    ]),
    answered(MISSING_FILE),
    answered(output)
  ]

  it.each([
    ['a background agent', 'Agent', BACKGROUND_AGENT, asyncAgentLaunchResult(AGENT_ID)],
    ['a teammate', 'Agent', TEAMMATE, TEAMMATE_SPAWN_OUTPUT],
    ['a monitor', 'Monitor', { command: 'tail -f sweep.log' }, monitorStartOutput(SHELL_ID)],
    [
      'a background agent in the JSON shape a server flag serves',
      'Agent',
      BACKGROUND_AGENT,
      `{"resultType":"task","taskId":"${AGENT_ID}","status":"working","statusMessage":${JSON.stringify(asyncAgentLaunchResult(AGENT_ID))}}`
    ]
  ])(
    'draws no count for a create made after %s whose launch answered after the failed read beside it',
    (_, name, input, output) => {
      expect(touched([...besideAFailedRead(name, input, output), ...CREATE])).toBe(true)
    }
  )

  it('draws no count for a create made after a monitor whose launch the read before it took, answered last and alone', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/sweep.log' } },
        { type: 'tool-call', name: 'Monitor', input: { command: 'tail -f sweep.log' } }
      ]),
      answered(monitorStartOutput(SHELL_ID)),
      answered('1\tsweep started')
    ]
    expect(touched([...turn, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made after a monitor whose launch the read before it took, when the user interrupted before the read answered', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/sweep.log' } },
        { type: 'tool-call', name: 'Monitor', input: { command: 'tail -f sweep.log' } }
      ]),
      answered(monitorStartOutput(SHELL_ID)),
      said('[Request interrupted by user for tool use]')
    ]
    expect(touched([...turn, ...CREATE])).toBe(true)
  })

  it('draws no count for a create made after a background agent whose launch answered after a stop the user turned down beside it', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'Agent', input: BACKGROUND_AGENT },
        { type: 'tool-call', name: 'TaskStop', input: { task_id: 'b0therid1' } }
      ]),
      answered(USER_TURNED_DOWN),
      answered(asyncAgentLaunchResult(AGENT_ID))
    ]
    expect(touched([...turn, ...CREATE])).toBe(true)
  })

  // Review of e53a4074: any answer in the batch that opened with `{` read as
  // the turned-down agent's launch, with no id, so it ran for good.
  const PACKAGE_JSON = '{\n  "name": "mobile",\n  "version": "1.0.0"\n}'
  it.each([
    ['a command printing a JSON file', 'Bash', { command: 'cat package.json' }, PACKAGE_JSON],
    ['a tool answering in JSON', 'mcp__github__get_issue', { n: 1 }, '{"number":1,"title":"x"}']
  ])(
    'still counts a create made after a background agent the user turned down beside %s',
    (_, name, input, output) => {
      const turn = [
        message('assistant', [
          { type: 'tool-call', name: 'Agent', input: BACKGROUND_AGENT },
          { type: 'tool-call', name, input }
        ]),
        answered(USER_TURNED_DOWN),
        answered(output)
      ]
      expect(touched([...turn, ...CREATE])).toBe(false)
    }
  )

  it('still counts a create made after a background agent that reported, launched beside a failed read and a command printing a JSON file', () => {
    const turn = [
      message('assistant', [
        { type: 'tool-call', name: 'Agent', input: BACKGROUND_AGENT },
        { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/missing.txt' } },
        { type: 'tool-call', name: 'Bash', input: { command: 'cat package.json' } }
      ]),
      answered(MISSING_FILE),
      answered(asyncAgentLaunchResult(AGENT_ID)),
      answered(PACKAGE_JSON),
      said(agentFinishedNotification(AGENT_ID, BACKGROUND_AGENT.description))
    ]
    expect(touched([...turn, ...CREATE])).toBe(false)
  })

  // Review of e53a4074: the diet can drop `run_in_background` from a long
  // prompt, and the JSON launch then read as no launch of the agent.
  it.each([
    ['', (output: string) => output],
    [', cut by the wire', cutByTheWire]
  ])(
    'draws no count for a create made after a background agent with a long prompt launched in the JSON shape after the failed read beside it%s',
    (_, onTheWireOutput) => {
      const onTheWire = {
        description: BACKGROUND_AGENT.description,
        prompt: `${'Keep the phone’s own copy of a message. '.repeat(100).slice(0, 3960)}… (truncated)`,
        '…': 'truncated'
      }
      const output = `{"resultType":"task","taskId":"${AGENT_ID}","status":"working","statusMessage":${JSON.stringify(asyncAgentLaunchResult(AGENT_ID).repeat(4))}}`
      const turn = besideAFailedRead('Agent', onTheWire, onTheWireOutput(output))
      expect(touched([...turn, ...CREATE])).toBe(true)
    }
  )

  it('still counts a create made after a foreground agent reported after the failed read beside it', () => {
    const turn = besideAFailedRead(
      'Agent',
      { description: 'Find the flag', prompt: 'Find it' },
      FOREGROUND_AGENT_OUTPUT
    )
    expect(touched([...turn, ...CREATE])).toBe(false)
  })

  it('still counts a create made after a background agent beside a read that failed first reported it finished', () => {
    const turn = [
      ...besideAFailedRead('Agent', BACKGROUND_AGENT, asyncAgentLaunchResult(AGENT_ID)),
      said(agentFinishedNotification(AGENT_ID, BACKGROUND_AGENT.description))
    ]
    expect(touched([...turn, ...CREATE])).toBe(false)
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

  // Review of de0eef80: the command's long output quotes an agent's report,
  // id line and all, so it is paired to the Agent call beside it and read as
  // a finished report, and the teammate's spawn falls to the command.
  it('draws no count for a create made after a teammate spawned beside a command whose long output quotes an agent report', () => {
    const turn = [
      called('Bash', { command: 'cat /tmp/agent-report.txt' }),
      called('Agent', {
        description: 'Review',
        prompt: 'Review',
        name: 'reviewer',
        team_name: 'review'
      }),
      answered(cutByTheWire(reportWithUsageAt(4000))),
      answered(TEAMMATE_SPAWN_OUTPUT)
    ]
    expect(touched([...turn, ...CREATE])).toBe(true)
  })

  // Orca's diet spends one 4000-character budget across a call's input and
  // drops every key past it for a `'…'` key (sanitizeToolInput, Orca
  // ac675ded6e), so a long prompt takes `run_in_background` with it.
  it('draws no count for a create made after a background agent with a long prompt launched in the JSON shape the wire cut', () => {
    const onTheWire = {
      description: BACKGROUND_AGENT.description,
      prompt: `${'Keep the phone’s own copy of a message. '.repeat(100).slice(0, 3960)}… (truncated)`,
      '…': 'truncated'
    }
    const output = `{"resultType":"task","taskId":"${AGENT_ID}","status":"working","statusMessage":${JSON.stringify(asyncAgentLaunchResult(AGENT_ID).repeat(4))}}`
    const agent = launched('Agent', onTheWire, cutByTheWire(output))
    expect(touched([...agent, ...CREATE])).toBe(true)
  })

  it('still counts a create made after two foreground agents whose long reports the wire cut', () => {
    const report = cutByTheWire(reportWithUsageAt(4000))
    const turn = [
      called('Agent', { description: 'Find the flag', prompt: 'Find it' }),
      called('Agent', { description: 'Find the site', prompt: 'Find it' }),
      answered(report),
      answered(report)
    ]
    expect(touched([...turn, ...CREATE])).toBe(false)
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
