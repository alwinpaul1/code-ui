import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import { agentMessageOf, beaconAgentMessages } from './mobile-native-chat-agent-messages'
import { resetAgentMessageAnchorsForTests } from './mobile-native-chat-agent-message-rows'
import { agentTurnsByEnd } from './mobile-native-chat-turn-end'
import { peerNoticesFromScreen } from './mobile-terminal-peer-notices'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import {
  HANDBACK_IDLE_ROW,
  HANDBACK_QUEUED_PROMPT,
  LEAD_SEND_MESSAGE_INPUT,
  LEAD_SEND_MESSAGE_RESULT,
  TASK_NOTIFICATION_AFTER_HANDBACK
} from './fixtures/claude-subagent-handback-2.1.296'
import { asyncAgentLaunchResult } from './fixtures/claude-parallel-agents-2.1.281'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      frames.push(props)
      return h('ChatView', props)
    }
  }
})

import { SESSION, agentRow, at, landingHarness, userRow } from './mobile-chat-phone-photo-landing.test-support'

// User report, 2026-10-11, with screenshots of one session in both apps. At
// the end of a lead turn Code UI drew a folded "Message from general-purpose…"
// row; the Claude app draws nothing there: the reply ends, then only the
// "1 running task" line. The row stood for a background subagent handing its
// final report back (Claude Code 2.1.294–2.1.296; the records are in
// fixtures/claude-subagent-handback-2.1.296.ts). The lead's own SendMessage
// call is a different row, and the Claude app does draw it ("Messaged @…").

const AGENT_ID = 'af91594a71c8c11d0'
const PROMPT = userRow('p1', ['Fix the missing thumbnails'], '12:40:00.000')
const OPENING = agentRow('a1', 'Started an agent on the thumbnails. I will report when it hands back.', '12:40:10.000')
const LAUNCH: NativeChatMessage[] = [
  {
    id: 'l1',
    role: 'assistant',
    timestamp: at('12:40:11.000'),
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Agent', input: { description: 'Thumbnails', subagent_type: 'general-purpose', prompt: '…' } }]
  },
  {
    id: 'l2',
    role: 'tool',
    timestamp: at('12:40:11.100'),
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: asyncAgentLaunchResult(AGENT_ID) }]
  }
]
const NEXT = agentRow('a2', 'The agent is done. The thumbnails draw under the tool group now.', '12:41:00.000')

/** The TUI's row for a hand-back, from a real Claude Code 2.1.295 screen
 *  (`tmux capture-pane -p`, 126 columns, 2026-10-04). */
const SCREEN = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-usage-band-fullscreen-126-agent-finished-2.1.295.txt', import.meta.url)),
  'utf8'
).split('\n')

function fromBeacon(beacon: DesktopPrompt[]) {
  return { prompts: mergeDesktopPrompts([], beacon), agentMessages: beaconAgentMessages(beacon) }
}

describe("a subagent's hand-back, which the Claude app draws nothing for", () => {
  const { show, lastFrame } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())
  const lastFolded = () => (frames.at(-1)!.folded as NativeChatMessage[]) ?? []
  const ids = () => lastFolded().map((row) => row.id)
  const agentRows = () => lastFolded().flatMap((row) => (agentMessageOf(row) ? [agentMessageOf(row)!] : []))
  const bubbles = () => lastFrame().map((bubble) => bubble.text)
  /** The tab status's copy of a prompt, folded to one line and cut at 200
   *  characters as Orca's hook leaves it, read a second before the screen. */
  const statusOf = (prompt: string) => {
    vi.setSystemTime(at('12:40:29.000'))
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { prompt: '', updatedAt: at('12:40:20.000') })
    state = observeAgentStatusPrompt(state, SESSION, { prompt: prompt.replaceAll(/\n+/g, ' ').slice(0, 200), updatedAt: at('12:40:21.000') })
    return state.agentMessages ?? []
  }

  it('draws no "Message from" row after the reply when it arrives at the end of a turn', async () => {
    const beacon = [{ nonce: '7101', text: HANDBACK_IDLE_ROW, anchorId: 'a1' }]
    await show('12:40:30.000', { messages: [PROMPT, OPENING, ...LAUNCH], working: false, promptHook: true, ...fromBeacon(beacon) })
    expect(agentRows()).toEqual([])
    expect(ids()).not.toContain('agent-message:7101')
    // Nor is it the user's bubble.
    expect(bubbles()).toEqual(['Fix the missing thumbnails'])
  })

  it('draws no row for a hand-back the hook cut mid-report, taken while the lead worked', async () => {
    const beacon = [{ nonce: '7102', text: HANDBACK_QUEUED_PROMPT.slice(0, 700), cut: true, anchorId: 'a1' }]
    await show('12:40:30.000', { messages: [PROMPT, OPENING, ...LAUNCH], working: true, promptHook: true, ...fromBeacon(beacon) })
    expect(agentRows()).toEqual([])
    expect(bubbles()).toEqual(['Fix the missing thumbnails'])
  })

  it("draws no row for the TUI's hand-back row on a tab launched without the prompt hook", async () => {
    await show('12:40:30.000', {
      messages: [PROMPT, OPENING, ...LAUNCH],
      working: true,
      promptHook: false,
      peerRows: peerNoticesFromScreen(SCREEN)
    })
    expect(agentRows()).toEqual([])
    expect(ids().some((id) => id.startsWith('peer-notice:'))).toBe(false)
    expect(bubbles()).toEqual(['Fix the missing thumbnails'])
  })

  it("draws no row for the TUI's row when the tab status says the message was a hand-back", async () => {
    await show('12:40:30.000', {
      messages: [PROMPT, OPENING, ...LAUNCH],
      working: true,
      promptHook: false,
      peerRows: peerNoticesFromScreen(SCREEN),
      statusAgentMessages: statusOf(HANDBACK_QUEUED_PROMPT)
    })
    expect(agentRows()).toEqual([])
  })

  it('leaves a turn whose only row would be the hand-back with no row and no turn', async () => {
    const beacon = [{ nonce: '7103', text: HANDBACK_IDLE_ROW, anchorId: 'p1' }]
    await show('12:40:30.000', { messages: [PROMPT], working: false, promptHook: true, ...fromBeacon(beacon) })
    expect(ids()).toEqual(['p1'])
    expect([...agentTurnsByEnd(lastFolded()).keys()]).toEqual([])
  })

  it('leaves the rows and turns on both sides of a hand-back between two assistant rows as they are without it', async () => {
    const messages = [PROMPT, OPENING, ...LAUNCH, NEXT]
    await show('12:40:30.000', { messages, working: false, promptHook: true })
    const without = ids()
    const turnsWithout = [...agentTurnsByEnd(lastFolded())].map(([end, turn]) => [end, turn.replyRows.map((row) => row.id)])
    resetAgentMessageAnchorsForTests()
    const beacon = [{ nonce: '7104', text: HANDBACK_IDLE_ROW, anchorId: 'a1' }]
    await show('12:41:30.000', { messages, working: false, promptHook: true, ...fromBeacon(beacon) })
    expect(ids()).toEqual(without)
    expect([...agentTurnsByEnd(lastFolded())].map(([end, turn]) => [end, turn.replyRows.map((row) => row.id)])).toEqual(turnsWithout)
  })
})

describe('the rows around a hand-back that the Claude app does draw, or hides itself', () => {
  const { show, lastFrame } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())
  const lastFolded = () => (frames.at(-1)!.folded as NativeChatMessage[]) ?? []

  it("keeps the lead's SendMessage call, which the Claude app draws as \"Messaged @agent\"", async () => {
    const send: NativeChatMessage[] = [
      {
        id: 's1',
        role: 'assistant',
        timestamp: at('12:40:20.000'),
        source: 'transcript',
        blocks: [{ type: 'tool-call', name: 'SendMessage', input: LEAD_SEND_MESSAGE_INPUT }]
      },
      {
        id: 's2',
        role: 'tool',
        timestamp: at('12:40:20.100'),
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: LEAD_SEND_MESSAGE_RESULT }]
      }
    ]
    await show('12:40:30.000', { messages: [PROMPT, OPENING, ...send], working: false, promptHook: true })
    const calls = lastFolded().flatMap((row) => row.blocks.filter((block) => block.type === 'tool-call').map((block) => block.name))
    expect(calls).toContain('SendMessage')
  })

  it('hides the task-notification turn that follows a hand-back, and draws no row for it', async () => {
    const notice = userRow('n1', [TASK_NOTIFICATION_AFTER_HANDBACK], '12:40:31.000')
    await show('12:40:40.000', { messages: [PROMPT, OPENING, notice, NEXT], working: false, promptHook: true })
    expect(lastFrame().map((bubble) => bubble.text)).toEqual(['Fix the missing thumbnails'])
    expect(lastFolded().map((row) => row.id)).not.toContain('n1')
  })
})
