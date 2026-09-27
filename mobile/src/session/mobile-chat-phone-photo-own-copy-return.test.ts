// Fifth review of the photo binder (2026-09-26), each case failing on
// cdbc8a35. Orca's hook reports a phone photo sent with no words as its
// markers alone, `[Image #73]`, and the phone read that copy's time as the
// only proof it was the send's: but a copy read on a return to the chat is
// timed by when the pane's state began, one read after a missed update by a
// later ping, and the beacon's copy has no time at all. Each drew an "Image
// on Desktop" bubble beside the phone's own photo, and a phone clock a couple
// of seconds ahead of the desk's flashed one on a fresh send.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  TEMP,
  agentRow,
  userRow,
  before,
  hookCopy,
  promptRow,
  companionRow,
  claudeScreen,
  landingHarness,
  SESSION,
  at
} from './mobile-chat-phone-photo-landing.test-support'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import { noteLiveRowsArrived } from './mid-turn-written-before'

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

/** The tab status read afresh, as on a return to the chat: `working` while
 *  the turn runs, `done` once it has ended. */
const statusFirstSight = (state: 'working' | 'done', prompt: string, updatedAt: string, stateStartedAt: string) => [
  ...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
    state,
    prompt,
    updatedAt: at(updatedAt),
    stateStartedAt: at(stateStartedAt)
  }).prompts
]

describe('a phone photo with no words that Claude took mid-turn', () => {
  const { show, send, framesFrom, lastFrame, unmount } = landingHarness(frames)
  const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
  const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
  const deskCopies = () => lastFrame().filter((bubble) => bubble.images.includes('D'))
  const phoneCopies = () => lastFrame().filter((bubble) => bubble.images === 'P')

  async function sendAndLetClaudeTakeIt(): Promise<void> {
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const own = hookCopy('07:03:54.573', '[Image #73]')
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    await show('07:04:37.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    expect([phoneCopies().length, deskCopies()]).toEqual([1, []])
  }

  it('draws no "Image on Desktop" beside it when the chat comes back in the same turn', async () => {
    await sendAndLetClaudeTakeIt()
    unmount()
    const later = [...tookIt, agentRow('44906d18', 'Still fixing.', '07:05:30.000')]
    const status = statusFirstSight('working', '[Image #73]', '07:05:40.000', '07:02:10.000')
    await show('07:06:00.000', { messages: later, working: true, prompts: status, queued: [] })
    await show('07:06:01.000', { messages: later, working: true, prompts: status, queued: [] })
    expect([phoneCopies().length, deskCopies()]).toEqual([1, []])
  })

  it('draws no "Image on Desktop" beside it when the chat is toggled off and on', async () => {
    await sendAndLetClaudeTakeIt()
    const later = [...tookIt, agentRow('44906d18', 'Still fixing.', '07:05:30.000')]
    const status = statusFirstSight('working', '[Image #73]', '07:05:40.000', '07:02:10.000')
    await show('07:06:00.000', { messages: later, working: true, prompts: status, queued: [] })
    await show('07:06:01.000', { messages: later, working: true, prompts: status, queued: [] })
    expect(deskCopies()).toEqual([])
  })

  it('draws no "Image on Desktop" beside it when the chat comes back after the turn ended', async () => {
    await sendAndLetClaudeTakeIt()
    unmount()
    const ended = [...tookIt, agentRow('55906d18', 'Fixed and verified.', '07:06:00.000')]
    const status = statusFirstSight('done', '[Image #73]', '07:06:00.100', '07:06:00.050')
    await show('07:10:00.000', { messages: ended, working: false, prompts: status, queued: [] })
    await show('07:10:01.000', { messages: ended, working: false, prompts: status, queued: [] })
    expect([phoneCopies().length, deskCopies()]).toEqual([1, []])
  })

  it('draws no "Image on Desktop" beside it when the status update was missed and read on a later ping', async () => {
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    await show('07:03:55.000', { messages: working, working: true, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    await show('07:04:36.000', { messages: tookIt, working: true, queued: [] })
    // The relay re-dials; the status now carries the prompt, timed by the
    // last tool event, 46 s after the send.
    const late = hookCopy('07:04:40.000', '[Image #73]')
    await show('07:04:50.000', { messages: tookIt, working: true, prompts: late, queued: [] })
    await show('07:04:51.000', { messages: tookIt, working: true, prompts: late, queued: [] })
    expect(deskCopies()).toEqual([])
  })

  it('draws no "Image on Desktop" from the beacon’s untimed copy once the status has moved on', async () => {
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const beaconOwn = { nonce: '101', text: '[Image #73]' }
    const own = [...hookCopy('07:03:54.573', '[Image #73]'), beaconOwn]
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    const ended = [...tookIt, agentRow('55906d18', 'Fixed and verified.', '07:06:00.000')]
    await show('07:06:01.000', { messages: ended, working: false, prompts: own, queued: [] })
    unmount()
    const next = [
      ...ended,
      userRow('t1t1t1t1', ['thanks, what next?'], '07:20:00.000'),
      agentRow('66906d18', 'Next is the fold.', '07:20:05.000')
    ]
    const merged = [...statusFirstSight('done', 'thanks, what next?', '07:20:05.100', '07:20:05.050'), beaconOwn]
    await show('07:25:00.000', { messages: next, working: false, prompts: merged, queued: [] })
    await show('07:25:01.000', { messages: next, working: false, prompts: merged, queued: [] })
    expect([phoneCopies().length, deskCopies()]).toEqual([1, []])
  })

  it('never flashes "Image on Desktop" when the phone’s clock runs 2 s ahead of the desk’s', async () => {
    await show('07:00:00.000', { messages: before })
    // Phone 07:00:20.000 is desk 07:00:18.000; no live row has arrived yet.
    await send('07:00:20.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const sent = frames.length
    const prompts = hookCopy('07:00:18.600', '[Image #17]')
    await show('07:00:20.700', { messages: before, prompts, working: true })
    await show('07:00:20.800', { messages: before, prompts, working: true })
    const landed = [...before, promptRow('add90135', 17, 1, '', '07:00:18.500'), companionRow('344189e5', [A], '07:00:18.500')]
    await show('07:00:21.000', { messages: landed, prompts, working: true })
    const replied = [...landed, agentRow('d4f3162c', 'A cat.', '07:00:29.000')]
    await show('07:00:32.000', { messages: replied, prompts })
    await show('07:00:33.000', { messages: replied, prompts })
    const flashed = framesFrom(sent).filter((frame) => frame.some((bubble) => bubble.images.includes('D')))
    expect([lastFrame(), flashed]).toEqual([[{ id: 'add90135', images: 'P', text: '' }], []])
  })

  it('never flashes "Image on Desktop" mid-turn when the phone’s clock runs 2 s ahead of the desk’s', async () => {
    const running = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:22.000', { messages: running, working: true })
    // Phone 07:03:56.000 is desk 07:03:54.000.
    await send('07:03:56.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const sent = frames.length
    const own = hookCopy('07:03:54.573', '[Image #73]')
    await show('07:03:56.700', { messages: running, working: true, prompts: own, queued: [] })
    await show('07:03:57.000', { messages: running, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const fixer = agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')
    noteLiveRowsArrived([fixer], at('07:04:35.000'))
    await show('07:04:35.000', { messages: [...running, fixer], working: true, prompts: own, queued: [] })
    await show('07:04:36.000', { messages: [...running, fixer], working: true, prompts: own, queued: [] })
    const flashed = framesFrom(sent).filter((frame) => frame.some((bubble) => bubble.images.includes('D')))
    expect(flashed).toEqual([])
  })
})
