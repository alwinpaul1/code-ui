import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { resetTaskEvidenceForTests, useActiveTabTaskReport } from './use-active-tab-task-report'

// The hook the controller uses, driven poll by poll: the screen shows the
// first run's completion row once, it scrolls away, and Claude launches the
// same command again under the same description.

const SESSION = '7449d614-3e02-439b-8e71-5bed99eaf4f0'
const T = Date.parse('2026-09-20T18:09:00.000Z')
const EMPTY_REPORT: ActiveTabBackgroundTaskReport = {
  finishedTaskIds: [],
  runningTaskIds: null,
  runningTaskIdsAt: null,
  launchedTaskIds: []
}
const GATE_ROW: ScreenTaskCompletion = { label: 'Run the gate', status: 'completed' }

let nextId = 0
function message(role: 'assistant' | 'user', timestamp: number, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `${role}-${nextId}`, role, timestamp, source: 'transcript', blocks: [block] }
}

// Launch result and notification verbatim in shape from Claude Code 2.1.277
// (2026-09-20), as in mobile-background-tasks-screen-completions.test.ts.
function gateLaunch(id: string, at: number): NativeChatMessage[] {
  return [
    message('assistant', at, {
      type: 'tool-call',
      name: 'Bash',
      input: { command: 'npx vitest run', description: 'Run the gate', run_in_background: true }
    }),
    message('user', at + 500, {
      type: 'tool-result',
      output: `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/${SESSION}/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`
    })
  ]
}

function gateNotification(id: string, at: number): NativeChatMessage {
  return message('user', at, {
    type: 'text',
    text: `<task-notification>
<task-id>${id}</task-id>
<tool-use-id>toolu_01MYrD6JLqm1Z39124tyRFCy</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/${SESSION}/tasks/${id}.output</output-file>
<status>completed</status>
<summary>Background command "Run the gate" completed (exit code 0)</summary>
</task-notification>`
  })
}

function monitoring(): AgentStatusEntry {
  return {
    state: 'working',
    workingMode: 'monitoring',
    prompt: '',
    updatedAt: Date.now(),
    stateStartedAt: T - 60_000,
    paneKey: 'facefdf7-1930-4cee-a501-5e56fbf26317:8d01a29d-f9c9-48d8-91a2-0f96f9f7bcb9',
    stateHistory: []
  }
}

type Frame = { messages: readonly NativeChatMessage[]; screen: readonly ScreenTaskCompletion[] }

let latest: string[] = []
function Probe({ frame }: { frame: Frame & { now: number } }) {
  const status = monitoring()
  const report = useActiveTabTaskReport({
    report: EMPTY_REPORT,
    handle: 'pty-1',
    sessionId: SESSION,
    agent: 'claude',
    messages: frame.messages,
    transcriptSettled: true,
    agentStatus: status,
    onScreenShellCount: null,
    screenTaskCompletions: frame.screen
  })
  latest = deriveReportedBackgroundTasks(frame.messages, frame.now, status, report).running.map((task) => task.id)
  return null
}

describe('a completion row the screen showed once, and a relaunch under its description', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    resetTaskEvidenceForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function show(at: number, shown: Frame): string[] {
    vi.setSystemTime(at)
    const frame = { ...shown, now: at }
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { frame }))
      } else {
        renderer = create(createElement(Probe, { frame }))
      }
    })
    return latest
  }

  it('keeps counting the relaunch as running after the first run’s row scrolled away', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    expect(show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })).toEqual(['host-monitoring'])
    expect(show(T + 62_000, { messages: firstRun, screen: [] })).toEqual(['host-monitoring'])

    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [] })).toEqual(['bgate0002'])
    expect(show(T + 180_000, { messages: relaunched, screen: [] })).toEqual(['bgate0002'])
  })

  it('keeps the relaunch running while the first run’s row stays on screen, and retires it by its own row', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })
    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])

    // Its completion lands mid-turn: no transcript notification, only a
    // second row painted under the first.
    expect(show(T + 200_000, { messages: relaunched, screen: [GATE_ROW, GATE_ROW] })).toEqual(['host-monitoring'])
  })
})
