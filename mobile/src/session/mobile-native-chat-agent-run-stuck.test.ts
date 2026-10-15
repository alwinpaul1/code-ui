import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { agentRunState } from './mobile-native-chat-agent-run'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import { BACKGROUND_AGENT, backgroundAgentLaunchMessages } from './fixtures/claude-background-agent-launch-2.1.296'

// "Running an Agent animation gets stuck" (2026-10-11). The records are the
// hand-started session's own (fixtures/claude-background-agent-launch-2.1.296.ts).

/** The run of work the chat draws for the launch, folded as the list folds it. */
function drawnRun(messages: NativeChatMessage[]): NativeChatBlock[] {
  const tools = foldMobileNativeChatMessages(messages)
    .flatMap((message) => splitTurnIntoSegments(message.blocks))
    .filter((segment) => segment.kind === 'tools')
  expect(tools).toHaveLength(1)
  return tools[0]!.blocks
}

/** What the chat hands the row on a hand-started tab: no host status, no
 *  beacon, an hour after the agent really finished. */
function handStartedInputs(messages: NativeChatMessage[], agentWorking: boolean) {
  const anHourLater = Date.parse(BACKGROUND_AGENT.finishedAt) + 60 * 60_000
  const { running } = deriveBackgroundTasks(messages, anHourLater, null)
  return {
    runningIds: new Set(running.filter((task) => task.kind === 'agent').map((task) => task.id)),
    confirmed: confirmedAgentDescriptions(messages, undefined),
    agentWorking
  }
}

describe('a background Agent call whose launch result is in', () => {
  const messages = backgroundAgentLaunchMessages()

  it('is still counted running by the transcript reader an hour after it finished (why the row stuck)', () => {
    // Pins the gap the row must not depend on: the completion was absorbed
    // mid-turn, so nothing the phone holds ever retires it.
    expect(handStartedInputs(messages, false).runningIds.has(BACKGROUND_AGENT.agentId)).toBe(true)
  })

  it('reads as finished once its launch result is in, whatever the reader counts', () => {
    expect(agentRunState(drawnRun(messages), handStartedInputs(messages, true)).running).toBe(false)
    expect(agentRunState(drawnRun(messages), handStartedInputs(messages, false)).running).toBe(false)
  })

  it('names no subject once finished, and still lists the agent with its own id', () => {
    const state = agentRunState(drawnRun(messages), handStartedInputs(messages, false))
    expect(state.subject).toBeNull()
    expect(state.entries).toEqual([{ title: BACKGROUND_AGENT.description, agentId: BACKGROUND_AGENT.agentId }])
  })

  it('still tells the run sheet the agent runs, for the transcript it opens', () => {
    expect(agentRunState(drawnRun(messages), handStartedInputs(messages, false)).agentsRunning).toBe(true)
    const none = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: false }
    expect(agentRunState(drawnRun(messages), none).agentsRunning).toBe(false)
  })
})

describe('a background Agent call with no result yet', () => {
  const callOnly = backgroundAgentLaunchMessages({ withResult: false })

  // The Claude app names an agent from the background task its call launched,
  // and a call still being made has none: a bare "Running agent", no icon
  // (ei4.java:930-1023; the user's screenshot, 2026-10-16).
  it('runs, naming nothing and drawing no icon, while the turn making it is live', () => {
    const state = agentRunState(drawnRun(callOnly), handStartedInputs(callOnly, true))
    expect(state.running).toBe(true)
    expect(state.subject).toBeNull()
    expect(state.icon).toBeNull()
  })

  it('stops once the turn has ended with the result missing', () => {
    const state = agentRunState(drawnRun(callOnly), handStartedInputs(callOnly, false))
    expect(state.running).toBe(false)
    expect(state.subject).toBeNull()
  })
})

// The structured lane carries a per-call `state`. A call it still marks
// running is not in flight once its result is there, or once the turn is over.
describe('an Agent call the structured lane marks running', () => {
  const idle = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }
  const live: NativeChatBlock = { type: 'tool-call', name: 'Agent', input: { description: 'Review' }, callId: 't1', state: 'running' }

  it('is finished once its own result has landed, though its state was never updated', () => {
    const blocks: NativeChatBlock[] = [live, { type: 'tool-result', output: 'Review done.', callId: 't1' }]
    expect(agentRunState(blocks, idle).running).toBe(false)
  })

  it('does not keep sweeping after the turn has ended', () => {
    expect(agentRunState([live], { ...idle, agentWorking: false }).running).toBe(false)
  })
})

describe('degenerate runs', () => {
  const working = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }

  it('an empty run, and a lone result, never run', () => {
    expect(agentRunState([], working)).toEqual({ running: false, agentsRunning: false, entries: [], subject: null, icon: null })
    expect(agentRunState([{ type: 'tool-result', output: 'orphan' }], working).running).toBe(false)
  })
})
