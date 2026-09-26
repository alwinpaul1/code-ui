import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import { agentMessageOf, beaconAgentMessages } from './mobile-native-chat-agent-messages'
import { resetAgentMessageAnchorsForTests } from './mobile-native-chat-agent-message-rows'
import { peerNoticesFromScreen } from './mobile-terminal-peer-notices'
import { SUBAGENT_HANDBACK_PROMPT, SUBAGENT_REQUEST_PROMPT } from './fixtures/claude-agent-message-read-image-2.1.283'
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

import { agentRow, at, landingHarness, userRow } from './mobile-chat-phone-photo-landing.test-support'

// A subagent's message to its lead, Claude Code 2.1.283 (2026-09-26): the
// desktop TUI folds it in the turn as "› Message from @general-purpose (ctrl+o
// to expand)", and the phone drew nothing, because Orca's reader drops the
// records it arrives as. What the phone does receive is the controller's
// input here: the prompt hook's beacon, and the screen's row.

const AGENT_ID = 'a7a46867b4f497c96'
const PROMPT = userRow('p1', ['Why is the copy flickering?'], '12:40:00.000')
const OPENING = agentRow('a1', 'Reconnected. Opening Thesis main and scrolling to lever_energy.py.', '12:40:10.000')
const LAUNCH: NativeChatMessage[] = [
  {
    id: 'l1',
    role: 'assistant',
    timestamp: at('12:40:11.000'),
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Agent', input: { description: 'Copy flicker', subagent_type: 'general-purpose', prompt: '…' } }]
  },
  {
    id: 'l2',
    role: 'tool',
    timestamp: at('12:40:11.100'),
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: asyncAgentLaunchResult(AGENT_ID) }]
  }
]
const NEXT = agentRow('a2', "We're on a markdown file tab, so first the agent's probe #3.", '12:41:00.000')
const MESSAGES = [PROMPT, OPENING, ...LAUNCH, NEXT]
/** The TUI's own row, as the user's screenshot of the desktop shows it. */
const SCREEN_ROW = '› Message from @general-purpose (ctrl+o to expand)'

/** What the controller hands the overlay for these beacons. */
function fromBeacon(beacon: DesktopPrompt[]) {
  return { prompts: mergeDesktopPrompts([], beacon), agentMessages: beaconAgentMessages(beacon) }
}

describe("a subagent's message to this session", () => {
  const { show, lastFrame } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())
  const lastFolded = () => (frames.at(-1)!.folded as NativeChatMessage[]) ?? []
  const agentRows = () => lastFolded().flatMap((row) => (agentMessageOf(row) ? [agentMessageOf(row)!] : []))

  it('is drawn as "Message from general-purpose" after the step it came in, and never as the user bubble', async () => {
    const beacon = [{ nonce: '4101', text: SUBAGENT_REQUEST_PROMPT, anchorId: 'a1' }]
    await show('12:40:30.000', { messages: MESSAGES, working: true, promptHook: true, ...fromBeacon(beacon) })
    // The person's prompt is the only bubble: the message is not one.
    expect(lastFrame().map((bubble) => bubble.text)).toEqual(['Why is the copy flickering?'])
    expect(agentRows()).toEqual([
      { sender: 'general-purpose', body: expect.stringMatching(/^Request for one read-only device probe \(copy-flicker agent\)/) }
    ])
    const ids = lastFolded().map((row) => row.id)
    expect(ids.indexOf('agent-message:4101')).toBe(ids.indexOf('a1') + 1)
    expect(ids.indexOf('agent-message:4101')).toBeLessThan(ids.indexOf('a2'))
  })

  it("is drawn from the TUI's row on a tab launched without the prompt hook, with no words to show", async () => {
    const peerRows = peerNoticesFromScreen([SCREEN_ROW])
    await show('12:40:30.000', { messages: MESSAGES, working: true, promptHook: false, peerRows })
    expect(agentRows()).toEqual([{ sender: 'general-purpose', body: '' }])
    expect(lastFrame().map((bubble) => bubble.text)).toEqual(['Why is the copy flickering?'])
  })

  it('is drawn once on a tab with the prompt hook, where the screen shows the same message', async () => {
    const beacon = [{ nonce: '4102', text: SUBAGENT_HANDBACK_PROMPT, cut: true, anchorId: 'a1' }]
    const peerRows = peerNoticesFromScreen([SCREEN_ROW])
    await show('12:40:30.000', { messages: MESSAGES, working: true, promptHook: true, peerRows, ...fromBeacon(beacon) })
    expect(agentRows()).toEqual([
      { sender: 'general-purpose', body: '1. Verdict: has defects. Two of them are wrong numbers, and one of those reopens t…' }
    ])
  })
})
