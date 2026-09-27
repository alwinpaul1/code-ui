// The beacon's copy of a desk prompt, found by a chat that opened long after it
// arrived: the same shape as the tab-status copy of 2026-09-26 (session
// 76ba8f2f, mobile-chat-finished-turn-prompt-order.test.ts), by the other
// source. The beacon names the row the prompt was typed after (`at=`), and has
// no time. With that row on a page the chat had not loaded, the copy waited
// for it drawn at the tail, and after 30 readings stayed there for good. A
// relaunch restores up to 40 of them from the warm start. Probe of 2026-09-27
// on fix/prompt-leak: drawn under the 14:27 answer, as the status copy was.
// Times are the transcript's, in UTC.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { agentRow, userRow, landingHarness, at } from './mobile-chat-phone-photo-landing.test-support'
import { consumeAgentHudBeacons, getAgentHudBeacon, hydrateAgentHudBeacons, resetAgentHudBeacons, type DesktopPrompt } from './agent-hud-beacon'
import { agentMessagesOfBeacon, beaconAgentMessages } from './mobile-native-chat-agent-messages'
import { agentMessagePlacements, resetAgentMessageAnchorsForTests } from './mobile-native-chat-agent-message-rows'
import { SUBAGENT_REQUEST_PROMPT } from './fixtures/claude-agent-message-read-image-2.1.283'

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

const SESSION = '76ba8f2f-3727-4cbb-bfc4-3f09fba4d67b'
const PROMPT = 'lets ask mahdi later u continue the work'
const MIDTURN = 'and keep the old index until the counts match'

const previousAnswer = agentRow('8a3424c5-6eaa-4ca5-aad4-db36d49683fb', 'The earlier answer.', '13:15:13.988')
const prompt = userRow('0fa6fd3d-0037-4b14-918f-cff507b8568b', [PROMPT], '13:20:44.026')
const itsReply = agentRow('fb15adfa-9803-421e-8f7d-0fb35bd0c190', 'Continuing the work.', '13:21:07.140')
const stopping = agentRow('f352e96b-994b-4337-8811-9457a9b1a071', 'Stopping the old run.', '14:27:10.812')
const laterAnswer = agentRow(
  '7bb000ff-97ac-4987-b272-ef15019526ba',
  '…fill the one pending Gen4 sentence in the draft, and 2999 (distillation) starts. session:ok',
  '14:27:47.105'
)
const tailPage = [stopping, laterAnswer]

/** The beacon's copy, as the phone decoded it at 13:20 while the terminal was
 *  subscribed: the hook's nonce, the words, the row it was typed after. */
const beaconCopy = (text: string, nonce: string, seenAt?: number): DesktopPrompt => ({
  nonce,
  text,
  anchorId: previousAnswer.id,
  ...(seenAt === undefined ? {} : { seenAt })
})

function rowsIn(props: Record<string, unknown>): { id: string; text: string }[] {
  const { data } = buildMobileNativeChatTransientData({
    messages: props.messages as NativeChatMessage[],
    folded: props.folded as NativeChatMessage[],
    streaming: null,
    pending: props.pending as never,
    imagePreviewsByMessageId: props.imagePreviewsByMessageId as Record<string, string[]>
  })
  return data.map((message) => ({
    id: message.id,
    text: message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  }))
}
const deskRows = (frame: Record<string, unknown>) => rowsIn(frame).filter((row) => row.id.startsWith('desk-'))

describe('a beacon copy of a desk prompt, found long after it arrived', () => {
  const { show } = landingHarness(frames)
  afterEach(() => resetAgentHudBeacons())

  it('is not drawn at the tail while the row it was typed after is on the page above', async () => {
    vi.setSystemTime(at('21:30:00.000'))
    const prompts = [beaconCopy(PROMPT, '48213', at('13:20:44.600'))]
    for (const clock of ['21:30:00.000', '21:30:01.000', '21:30:02.000']) {
      await show(clock, { messages: tailPage, hasMore: true, prompts })
    }
    expect(frames.flatMap(deskRows)).toEqual([])
    // The page above loads: its own row draws it, once, above its answer.
    const whole = [previousAnswer, prompt, itsReply, ...tailPage]
    await show('21:31:00.000', { messages: whole, hasMore: true, prompts })
    const rows = rowsIn(frames.at(-1)!)
    expect(rows.filter((row) => row.text === PROMPT).map((row) => row.id)).toEqual([prompt.id])
  })

  it('is drawn after that row once its page loads, when it was typed mid-turn and has no row of its own', async () => {
    vi.setSystemTime(at('21:30:00.000'))
    const prompts = [beaconCopy(MIDTURN, '48214', at('13:20:50.000'))]
    await show('21:30:00.000', { messages: tailPage, hasMore: true, prompts })
    await show('21:30:01.000', { messages: tailPage, hasMore: true, prompts })
    expect(frames.flatMap(deskRows)).toEqual([])
    await show('21:31:00.000', { messages: [previousAnswer, itsReply, ...tailPage], hasMore: true, prompts })
    await show('21:31:01.000', { messages: [previousAnswer, itsReply, ...tailPage], hasMore: true, prompts })
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    expect(ids).toEqual([previousAnswer.id, 'desk-48214', itsReply.id, stopping.id, laterAnswer.id])
  })

  it('is not drawn at the tail when the phone read it off the terminal hours before the chat opened', async () => {
    // The hook's frame, as the phone decoded it at 13:20:50 while the tab
    // showed its terminal.
    vi.setSystemTime(at('13:20:50.000'))
    consumeAgentHudBeacons(
      'terminal-paper-review',
      `\u001b]7777;CUIHUD1 agent=claude hk=1 sid=${SESSION} up=48216:and%20keep%20the%20old%20index%20until%20the%20counts%20match at=${previousAnswer.id}\u0007`
    )
    const prompts = getAgentHudBeacon('terminal-paper-review')?.desktopPrompts ?? []
    expect(prompts.map((copy) => copy.text)).toEqual([MIDTURN])
    vi.setSystemTime(at('21:30:00.000'))
    await show('21:30:00.000', { messages: tailPage, hasMore: true, prompts })
    await show('21:30:01.000', { messages: tailPage, hasMore: true, prompts })
    expect(frames.flatMap(deskRows)).toEqual([])
  })

  // Review of c685c0cd: the row a copy was typed after is often a tool call
  // Orca never projects. With every row loaded it never comes, so the copy is
  // never drawn, and the log says so, once.
  it('says once in the log why it is not drawn when the row it names never loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.setSystemTime(at('21:30:00.000'))
    const toolRow = 'c0ffee00-0000-4000-8000-000000000001'
    const prompts = [{ nonce: '48217', text: MIDTURN, anchorId: toolRow, seenAt: at('14:27:05.000') }]
    const whole = [previousAnswer, prompt, itsReply, ...tailPage]
    for (const clock of ['21:30:00.000', '21:30:01.000', '21:30:02.000']) {
      await show(clock, { messages: whole, hasMore: false, prompts })
    }
    expect(frames.flatMap(deskRows)).toEqual([])
    expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[desk-prompt]'))).toEqual([
      `[desk-prompt] not drawn: the beacon's copy of "and keep the old index until the…" was found long after it arrived, and the row it was typed after (${toolRow}) is not in the transcript`
    ])
    warn.mockRestore()
  })

  // Sixth review: before the chat's first read settles, `hasMore` is false
  // and no row is held, which read as "every row loaded, the row is missing".
  it('logs nothing while the first read is still in flight, and is drawn once when it lands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.setSystemTime(at('21:30:00.000'))
    const prompts = [beaconCopy(MIDTURN, '48218', at('13:20:50.000'))]
    await show('21:30:00.000', { messages: [], loading: true, prompts })
    await show('21:30:01.000', { messages: [], loading: true, prompts })
    const whole = [previousAnswer, itsReply, ...tailPage]
    await show('21:30:02.000', { messages: whole, hasMore: false, prompts })
    await show('21:30:03.000', { messages: whole, hasMore: false, prompts })
    expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[desk-prompt]'))).toEqual([])
    expect(rowsIn(frames.at(-1)!).map((row) => row.id)).toEqual([previousAnswer.id, 'desk-48218', itsReply.id, stopping.id, laterAnswer.id])
    warn.mockRestore()
  })

  it('still waits at the tail when it arrived just now, as the live case always has', async () => {
    vi.setSystemTime(at('21:30:00.000'))
    const prompts = [beaconCopy(MIDTURN, '48215', at('21:29:59.500'))]
    await show('21:30:00.000', { messages: tailPage, hasMore: true, prompts })
    expect(rowsIn(frames.at(-1)!).map((row) => row.id)).toEqual([stopping.id, laterAnswer.id, 'desk-48215'])
  })
})

// A relaunch brings the beacon back from the warm start, its 40 desk prompts
// with it. A record an older build wrote has no arrival time on its prompts.
describe('a beacon copy of a desk prompt restored by the warm start', () => {
  const { show } = landingHarness(frames)
  afterEach(() => resetAgentHudBeacons())

  it('is not drawn at the tail, and nor is any of the 40, while their rows are unloaded', async () => {
    const fillers = Array.from({ length: 39 }, (_, index) => ({
      nonce: String(47000 + index),
      text: `earlier message ${index}`,
      anchorId: `9${String(index).padStart(7, '0')}-0000-4000-8000-000000000000`
    }))
    await AsyncStorage.setItem(
      'codeui:agent-hud-beacons.v2',
      JSON.stringify({
        'terminal-paper-review': {
          agent: 'claude',
          sessionId: SESSION,
          modelId: null,
          modelLabel: null,
          effort: null,
          usedTokens: null,
          windowTokens: null,
          usedPercent: null,
          limits: [],
          doneTaskIds: [],
          runningTaskIdsAt: null,
          launchedTaskIds: [],
          desktopPrompts: [...fillers, { nonce: '48213', text: PROMPT, anchorId: previousAnswer.id }],
          desktopPrompt: null,
          promptHook: true,
          receivedAt: at('14:27:47.600')
        }
      })
    )
    resetAgentHudBeacons()
    await hydrateAgentHudBeacons()
    const prompts = getAgentHudBeacon('terminal-paper-review')?.desktopPrompts ?? []
    expect(prompts).toHaveLength(40)
    vi.setSystemTime(at('21:30:00.000'))
    for (const clock of ['21:30:00.000', '21:30:01.000']) {
      await show(clock, { messages: tailPage, hasMore: true, prompts })
    }
    expect(frames.flatMap(deskRows)).toEqual([])
    await show('21:31:00.000', { messages: [previousAnswer, prompt, itsReply, ...tailPage], hasMore: true, prompts })
    expect(rowsIn(frames.at(-1)!).filter((row) => row.text === PROMPT).map((row) => row.id)).toEqual([prompt.id])
  })
})

// Combined review of 30c94116: a subagent's message the prompt hook carried is
// drawn as its own "Message from" row, placed by the row the hook named. Found
// long after it arrived with that row on a page not loaded, it took the tail,
// and the tail was stored as where it was drawn: after a relaunch that stored
// row won, and stayed even once the real row loaded.
describe('a subagent message the beacon carried, found long after it arrived', () => {
  const { show } = landingHarness(frames)
  afterEach(() => resetAgentMessageAnchorsForTests())
  const agentRows = (frame: Record<string, unknown>) => rowsIn(frame).filter((row) => row.id.startsWith('agent-message:'))

  it('is not drawn at the tail while the row it came after is on the page above, and no tail is stored for it', async () => {
    vi.setSystemTime(at('21:30:00.000'))
    const copy = { nonce: '48299', text: SUBAGENT_REQUEST_PROMPT, anchorId: previousAnswer.id, seenAt: at('13:20:50.000') }
    const agentMessages = beaconAgentMessages([copy])
    await show('21:30:00.000', { messages: tailPage, hasMore: true, promptHook: true, agentMessages })
    await show('21:30:01.000', { messages: tailPage, hasMore: true, promptHook: true, agentMessages })
    expect(frames.flatMap(agentRows)).toEqual([])
    expect(agentMessagePlacements(`tab:${'967668df-a7d9-40e7-964b-7812815c010d'}`, agentMessages)).toEqual([])
    const whole = [previousAnswer, itsReply, ...tailPage]
    await show('21:31:00.000', { messages: whole, hasMore: true, promptHook: true, agentMessages })
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    expect(ids.indexOf('agent-message:48299')).toBe(ids.indexOf(previousAnswer.id) + 1)
  })

  it('is not drawn at the tail when the phone read it off the terminal hours before the chat opened', async () => {
    vi.setSystemTime(at('13:20:50.000'))
    const text = encodeURIComponent(JSON.stringify(SUBAGENT_REQUEST_PROMPT).slice(1, -1))
    consumeAgentHudBeacons('terminal-paper-review', `\u001b]7777;CUIHUD1 agent=claude hk=1 sid=${SESSION} up=48297:${text} at=${previousAnswer.id}\u0007`)
    const agentMessages = agentMessagesOfBeacon(getAgentHudBeacon('terminal-paper-review'), 'terminal-paper-review')
    expect(agentMessages.map((message) => message.id)).toEqual(['agent-message:48297'])
    vi.setSystemTime(at('21:30:00.000'))
    await show('21:30:00.000', { messages: tailPage, hasMore: true, promptHook: true, agentMessages })
    await show('21:30:01.000', { messages: tailPage, hasMore: true, promptHook: true, agentMessages })
    expect(frames.flatMap(agentRows)).toEqual([])
    resetAgentHudBeacons()
  })

  // Review of bc9f07b4: the row it names can be one Orca never publishes. With
  // every row loaded it never comes, and the message is never drawn: the log
  // says so once, as a held desk copy's does.
  it('says once in the log why it is not drawn when the row it came after never loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.setSystemTime(at('21:30:00.000'))
    const toolRow = 'c0ffee00-0000-4000-8000-000000000002'
    const agentMessages = beaconAgentMessages([{ nonce: '48296', text: SUBAGENT_REQUEST_PROMPT, anchorId: toolRow, seenAt: at('14:27:05.000') }])
    const whole = [previousAnswer, itsReply, ...tailPage]
    for (const clock of ['21:30:00.000', '21:30:01.000', '21:30:02.000']) {
      await show(clock, { messages: whole, hasMore: false, promptHook: true, agentMessages })
    }
    expect(frames.flatMap(agentRows)).toEqual([])
    expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[agent-message]'))).toEqual([
      `[agent-message] not drawn: agent-message:48296 was found long after it arrived, and the row it came after (${toolRow}) is not in the transcript`
    ])
    warn.mockRestore()
  })

  it('moves to the row it came after once that row loads, after a relaunch brought back a stored tail', async () => {
    vi.setSystemTime(at('21:30:00.000'))
    // Stored by a build that kept the tail it was drawn at.
    const stored = { nonce: '48298', text: SUBAGENT_REQUEST_PROMPT, anchorId: previousAnswer.id, restored: true as const, drawnAfter: stopping.id }
    const agentMessages = beaconAgentMessages([stored])
    await show('21:30:00.000', { messages: tailPage, hasMore: true, promptHook: true, agentMessages })
    const whole = [previousAnswer, itsReply, ...tailPage]
    await show('21:31:00.000', { messages: whole, hasMore: true, promptHook: true, agentMessages })
    await show('21:31:01.000', { messages: whole, hasMore: true, promptHook: true, agentMessages })
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    expect(ids.indexOf('agent-message:48298')).toBe(ids.indexOf(previousAnswer.id) + 1)
  })
})

