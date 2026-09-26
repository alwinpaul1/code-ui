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

import { agentRow, at, landingHarness, userRow, words } from './mobile-chat-phone-photo-landing.test-support'

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

// Review of 2026-09-26: the beacon dropped every prompt the shared harness
// classifier matched, and it matches by a leading word or tag. A prompt the
// person typed mid-turn reaches the phone only by the beacon (Orca drops the
// queued_command record), so one that merely starts that way was drawn nowhere.
describe('a prompt the person typed at the desk, mid-turn, that starts with harness-like words', () => {
  const { show, lastFrame } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())
  const shows = async (text: string) => {
    await show('12:40:30.000', {
      messages: [PROMPT, OPENING],
      working: true,
      promptHook: true,
      ...fromBeacon([{ nonce: '5001', text, anchorId: 'a1' }])
    })
    return lastFrame().map((bubble) => bubble.text)
  }

  it('"A message arrived from …" is still drawn as the user bubble', async () => {
    const text = 'A message arrived from the backend team: the deploy failed, please check the logs'
    expect(await shows(text)).toEqual(['Why is the copy flickering?', text])
  })

  it('a prompt that opens by quoting an <agent-message> tag is still the user bubble, and no "Message from" row', async () => {
    const text = '<agent-message from="a1b2c3"> keeps showing in my log. Where does that tag come from?'
    expect(await shows(text)).toEqual(['Why is the copy flickering?', text])
    expect(agentRows()).toEqual([])
  })

  it('a prompt that quotes the whole opening line of one, and no closing tag, is still the user bubble', async () => {
    const text = '<agent-message from="a7a46867b4f497c96">\nwhat is this line in my log?'
    expect(await shows(text)).toEqual(['Why is the copy flickering?', words(text)])
    expect(agentRows()).toEqual([])
  })

  const lastFolded = () => (frames.at(-1)!.folded as NativeChatMessage[]) ?? []
  const agentRows = () => lastFolded().flatMap((row) => (agentMessageOf(row) ? [agentMessageOf(row)!] : []))
})

// Review of 2026-09-26: in a teammate session on a tab with the prompt hook,
// the lead's mid-turn follow-up (dropped by Orca as a queued_command) was
// filtered off the beacon as harness machinery, and with the hook on the
// screen's "› Message from @team-lead" row is not drawn either. The follow-up
// is the user's bubble, as main drew it and as a landed follow-up is drawn
// (teammateTask in mobile-native-chat-peer-messages.ts).
describe("the lead's mid-turn follow-up in a teammate session with the prompt hook", () => {
  const { show, lastFrame } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())

  it('is drawn once, as the bubble the lead\'s messages get', async () => {
    const task = userRow('task', ['<teammate-message teammate_id="team-lead">Build the job.</teammate-message>'], '12:40:00.000')
    const followUp = '<teammate-message teammate_id="team-lead">Also time the CPU path.</teammate-message>'
    await show('12:40:30.000', {
      messages: [task, agentRow('a1', 'Reading the code.', '12:40:10.000')],
      working: true,
      promptHook: true,
      peerRows: [{ sender: 'team-lead' }, { sender: 'team-lead' }],
      ...fromBeacon([{ nonce: '7001', text: followUp, anchorId: 'a1' }])
    })
    expect(lastFrame().filter((bubble) => bubble.text.includes('Also time the CPU path.'))).toHaveLength(1)
  })
})

// Review of 2026-09-26: the screen's peer notices were anchored on the tail of
// the chat WITH the "Message from" rows in it, so a notice seen while such a
// row was last took that synthetic id. Once the row was no longer drawn, the
// anchor resolved nowhere and the other session's bubble jumped to the top.
describe("another session's message seen while a subagent's row was the chat's last", () => {
  const { show } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())
  const ids = () => ((frames.at(-1)!.folded as NativeChatMessage[]) ?? []).map((row) => row.id)
  const messages = [PROMPT, OPENING]
  const agentMessages = beaconAgentMessages([{ nonce: '4101', text: SUBAGENT_REQUEST_PROMPT, anchorId: 'a1' }])
  const peerRows = [{ sender: 'code-ui-6f', body: 'Capture probe' }]

  it('is drawn after the subagent\'s row it was seen under, while that row is drawn', async () => {
    await show('12:40:30.000', { messages, working: true, promptHook: true, agentMessages })
    await show('12:40:40.000', { messages, working: true, promptHook: true, agentMessages, peerRows })
    expect(ids()).toEqual(['p1', 'a1', 'agent-message:4101', 'peer-notice:code-ui-6f:1'])
  })

  it('stays after the step it was seen under once that row is gone', async () => {
    await show('12:40:30.000', { messages, working: true, promptHook: true, agentMessages })
    await show('12:40:40.000', { messages, working: true, promptHook: true, agentMessages, peerRows })
    await show('12:41:00.000', { messages, working: true, promptHook: true, agentMessages: [], peerRows })
    expect(ids()).toEqual(['p1', 'a1', 'peer-notice:code-ui-6f:1'])
  })
})
