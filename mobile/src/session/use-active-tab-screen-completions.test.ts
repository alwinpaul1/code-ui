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
const OTHER_SESSION = 'b1d1c0de-0000-4000-8000-000000000000'
const T = Date.parse('2026-09-20T18:09:00.000Z')
const EMPTY_REPORT: ActiveTabBackgroundTaskReport = {
  finishedTaskIds: [],
  runningTaskIds: null,
  runningTaskIdsAt: null,
  launchedTaskIds: []
}
const GATE_ROW: ScreenTaskCompletion = { label: 'Run the gate', status: 'completed' }
const QUICK_ROW: ScreenTaskCompletion = { label: 'Quick check', status: 'completed' }
const UNREAD = null

let nextId = 0
function message(role: 'assistant' | 'user', timestamp: number, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `${role}-${nextId}`, role, timestamp, source: 'transcript', blocks: [block] }
}

// Launch result and notification verbatim in shape from Claude Code 2.1.277
// (2026-09-20), as in mobile-background-tasks-screen-completions.test.ts.
function gateLaunch(id: string, at: number): NativeChatMessage[] {
  return shellLaunch(id, { command: 'npx vitest run', description: 'Run the gate' }, at)
}

function shellLaunch(id: string, input: { command: string; description: string }, at: number): NativeChatMessage[] {
  return [
    message('assistant', at, {
      type: 'tool-call',
      name: 'Bash',
      input: { ...input, run_in_background: true }
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

type Frame = {
  messages: readonly NativeChatMessage[]
  /** Null while the screen is unread. */
  screen: readonly ScreenTaskCompletion[] | null
  /** Another tab: its terminal and session. */
  handle?: string
  sessionId?: string
}

let latest: string[] = []
function Probe({ frame }: { frame: Frame & { now: number } }) {
  const status = monitoring()
  const report = useActiveTabTaskReport({
    report: EMPTY_REPORT,
    handle: frame.handle ?? 'pty-1',
    sessionId: frame.sessionId ?? SESSION,
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

  // The chat unmounts for the Files tab and mounts again on the way back, and
  // a tab switch hands the hook another terminal and back. Run 1's row is
  // still on screen both times, and was seen before run 2 launched.
  it('keeps the relaunch running when the chat is reopened with the first run’s row still on screen', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })
    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])

    act(() => renderer?.unmount())
    renderer = null
    expect(show(T + 150_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])
  })

  it('keeps the relaunch running when the reopened chat reads its transcript before its screen', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })
    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])

    act(() => renderer?.unmount())
    renderer = null
    // The screen's first read after the remount has not landed yet: what the
    // HUD hands over for an unread screen (use-mobile-terminal-hud-observation.ts).
    expect(show(T + 150_000, { messages: relaunched, screen: UNREAD })).toEqual(['bgate0002'])
    expect(show(T + 151_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])
  })

  it('keeps the relaunch running after a switch to another tab and back', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })
    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])

    show(T + 130_000, { messages: [], screen: [], handle: 'pty-2', sessionId: OTHER_SESSION })
    expect(show(T + 150_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])
  })

  it('retires the relaunch by its own row once the first run’s row has left the screen', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })
    show(T + 62_000, { messages: firstRun, screen: [] })
    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [] })).toEqual(['bgate0002'])

    // Run 2 ends mid-turn: no notification, only its own row, word for word
    // the first run's.
    expect(show(T + 300_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['host-monitoring'])
  })

  it('retires the relaunch by its own row when the first run’s row was still up as it launched', () => {
    const firstRun = [...gateLaunch('bgate0001', T), gateNotification('bgate0001', T + 60_000)]
    show(T + 61_000, { messages: firstRun, screen: [GATE_ROW] })
    const relaunched = [...firstRun, ...gateLaunch('bgate0002', T + 120_000)]
    expect(show(T + 121_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['bgate0002'])
    expect(show(T + 150_000, { messages: relaunched, screen: [] })).toEqual(['bgate0002'])
    expect(show(T + 300_000, { messages: relaunched, screen: [GATE_ROW] })).toEqual(['host-monitoring'])
  })

  // A blank repaint, a dialog or a scroll can hide a row and show it again.
  // With no new launch behind it, the row back on screen is the same row, and
  // a second copy would retire a shell that still runs.
  it('keeps the second of two same-named shells running when a blank poll hides the first one’s row and it comes back', () => {
    const twins = [...gateLaunch('bgate0001', T), ...gateLaunch('bgate0002', T + 5_000)]
    expect(show(T + 61_000, { messages: twins, screen: [GATE_ROW] })).toEqual(['bgate0002'])
    expect(show(T + 62_000, { messages: twins, screen: [] })).toEqual(['bgate0002'])
    expect(show(T + 63_000, { messages: twins, screen: [GATE_ROW] })).toEqual(['bgate0002'])
  })
})

// A shell that ends within a poll or two. The transcript stamps its launch
// with the desk's clock (message.timestamp); the phone reads the screen on
// its own clock (Date.now()). The two need not agree, and the row can be on
// screen before the phone's transcript read holds the launch at all.
describe('a short shell’s completion row, on a phone whose clock is not the desk’s', () => {
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

  // Launched at desk time H, finished 1.5 s later.
  const H = T + 600_000
  const quick = shellLaunch('bquick001', { command: 'npm run lint', description: 'Quick check' }, H)

  it('shows the short shell finished when the phone clock is 5 s behind the desk', () => {
    expect(show(H + 1_500 - 5_000, { messages: quick, screen: [QUICK_ROW] })).toEqual(['host-monitoring'])
  })

  it('shows the short shell finished when the phone clock is 5 s ahead of the desk', () => {
    expect(show(H + 1_500 + 5_000, { messages: quick, screen: [QUICK_ROW] })).toEqual(['host-monitoring'])
  })

  it('shows the short shell finished when its row was on screen before the transcript read held its launch', () => {
    expect(show(H + 1_500 - 5_000, { messages: [], screen: [QUICK_ROW] })).toEqual(['host-monitoring'])
    expect(show(H + 2_500 - 5_000, { messages: quick, screen: [QUICK_ROW] })).toEqual(['host-monitoring'])
  })

  // The window a chat opens with is 40 records, so a long shell's launch can
  // sit above it when its row is painted. That row's launch never arrives;
  // the next launch under its description is a relaunch, not the row's own.
  it('keeps a relaunch running when the row it follows named a launch above the loaded window', () => {
    const LONG_ROW: ScreenTaskCompletion = { label: 'Run the gate', status: 'failed' }
    const tail = shellLaunch('bquick001', { command: 'npm run lint', description: 'Quick check' }, H - 30_000)
    expect(show(H, { messages: tail, screen: [LONG_ROW] })).toEqual(['bquick001'])
    expect(show(H + 1_000, { messages: tail, screen: [] })).toEqual(['bquick001'])
    const relaunched = [...tail, ...gateLaunch('bgate0002', H + 20_000)]
    expect(show(H + 21_000, { messages: relaunched, screen: [] })).toEqual(['bquick001', 'bgate0002'])
  })

  it('shows it finished when the row had already scrolled away by the time the launch arrived', () => {
    expect(show(H + 1_500 - 5_000, { messages: [], screen: [QUICK_ROW] })).toEqual(['host-monitoring'])
    expect(show(H + 2_500 - 5_000, { messages: [], screen: [] })).toEqual(['host-monitoring'])
    expect(show(H + 3_500 - 5_000, { messages: quick, screen: [] })).toEqual(['host-monitoring'])
  })
})
