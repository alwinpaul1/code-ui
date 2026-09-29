// Sixth review of the photo binder (2026-09-26), each case failing on
// f91596d6: a phone photo of no words paired with the first markers-only
// hook copy it met, and at the send's first render its own copy had not
// arrived yet, so it took an older one (a desk screenshot's, or its own
// earlier photo's, read again after a tab switch) and drew its own copy as
// "Image on Desktop" beside it.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  TEMP,
  agentRow,
  before,
  promptRow,
  companionRow,
  claudeScreen,
  landingHarness,
  SESSION,
  at
} from './mobile-chat-phone-photo-landing.test-support'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt, type AgentStatusPromptState } from './agent-status-prompts'

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

const DESK = 'orca-paste-1790405800000-dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const B = 'orca-paste-1790406134000-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('a phone photo of no words sent while the tab status still shows an older markers-only prompt', () => {
  const { show, send, framesFrom, lastFrame, unmount } = landingHarness(frames)
  const deskBubbles = (frame: ReturnType<typeof lastFrame>, except: readonly string[]) =>
    frame.filter((bubble) => bubble.images.includes('D') && !except.includes(bubble.id))

  it('desk screenshot of no words started the turn; the phone opens the chat and sends a photo of no words that Claude takes mid-turn', async () => {
    const deskRow = promptRow('d35c0001', 72, 1, '', '07:01:00.000')
    const running = [
      ...before,
      deskRow,
      companionRow('d35c0002', [DESK], '07:01:00.000'),
      agentRow('080e05a3', 'Looking at the screenshot.', '07:01:05.000')
    ]
    // The chat is opened mid-turn: the tab status is read at first sight.
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      state: 'working',
      prompt: '[Image #72]',
      updatedAt: at('07:03:10.000'),
      stateStartedAt: at('07:01:00.100')
    })
    await show('07:03:20.000', { messages: running, working: true, prompts: [...state.prompts] })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const sent = frames.length
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: '[Image #73]', updatedAt: at('07:03:54.573') })
    await show('07:03:55.000', { messages: running, working: true, prompts: [...state.prompts], queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...running, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:04:37.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    const flashed = framesFrom(sent).filter((frame) => deskBubbles(frame, ['d35c0001']).length > 0)
    expect([lastFrame().filter((bubble) => bubble.images === 'P').length, deskBubbles(lastFrame(), ['d35c0001']), flashed.length]).toEqual([1, [], 0])
  })

  it('a second phone photo of no words after a tab switch, sent idle: never flashes "Image on Desktop"', async () => {
    await show('07:00:00.000', { messages: before })
    await send('07:00:20.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { state: 'working', prompt: '', updatedAt: at('07:00:20.600'), stateHistory: [{ state: 'done', prompt: '' }] })
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: '[Image #17]', updatedAt: at('07:00:20.600') })
    await show('07:00:21.000', { messages: before, working: true, prompts: [...state.prompts] })
    const first = [...before, promptRow('a17a17a1', 17, 1, '', '07:00:20.500'), companionRow('a17a17a2', [A], '07:00:20.500')]
    await show('07:00:22.000', { messages: first, working: true, prompts: [...state.prompts] })
    const replied = [...first, agentRow('d4f3162c', 'A cat.', '07:00:29.000')]
    await show('07:00:32.000', { messages: replied, prompts: [...state.prompts] })
    await show('07:00:33.000', { messages: replied, prompts: [...state.prompts] })
    expect(deskBubbles(lastFrame(), [])).toEqual([])
    // A tab switch and back: the status is read afresh.
    unmount()
    let back: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      state: 'done',
      prompt: '[Image #17]',
      updatedAt: at('07:00:29.100'),
      stateStartedAt: at('07:00:29.050')
    })
    await show('07:02:00.000', { messages: replied, prompts: [...back.prompts] })
    await show('07:02:01.000', { messages: replied, prompts: [...back.prompts] })
    await send('07:02:10.000', '', ['file:///phone/c2.jpg'], [`${TEMP}/${B}.png`])
    const sent = frames.length
    back = observeAgentStatusPrompt(back, SESSION, { state: 'working', prompt: '[Image #18]', updatedAt: at('07:02:10.600') })
    await show('07:02:10.700', { messages: replied, working: true, prompts: [...back.prompts] })
    await show('07:02:10.800', { messages: replied, working: true, prompts: [...back.prompts] })
    const second = [...replied, promptRow('b18b18b1', 18, 1, '', '07:02:10.500'), companionRow('b18b18b2', [B], '07:02:10.500')]
    await show('07:02:13.000', { messages: second, working: true, prompts: [...back.prompts] })
    const replied2 = [...second, agentRow('e4f3162c', 'A dog.', '07:02:20.000')]
    await show('07:02:22.000', { messages: replied2, prompts: [...back.prompts] })
    await show('07:02:23.000', { messages: replied2, prompts: [...back.prompts] })
    const flashed = framesFrom(sent).filter((frame) => deskBubbles(frame, []).length > 0)
    expect([lastFrame(), flashed]).toEqual([
      [
        { id: 'a17a17a1', images: 'P', text: '' },
        { id: 'b18b18b1', images: 'P', text: '' }
      ],
      []
    ])
  })

  it('a second phone photo of no words after a tab switch, which Claude takes mid-turn: no "Image on Desktop" beside it', async () => {
    const running = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:00:10.000')]
    await show('07:00:12.000', { messages: running, working: true })
    // First photo, taken mid-turn too, but it later lands... keep it simple: it
    // is sent idle before the turn in the other case; here the first photo
    // started this turn and has its row.
    await send('07:00:20.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { state: 'working', prompt: '', updatedAt: at('07:00:20.600'), stateHistory: [{ state: 'done', prompt: '' }] })
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: '[Image #17]', updatedAt: at('07:00:20.600') })
    const first = [...running, agentRow('0a0a0a0b', 'Done with the fold.', '07:00:19.000'), promptRow('a17a17a1', 17, 1, '', '07:00:20.500'), companionRow('a17a17a2', [A], '07:00:20.500')]
    await show('07:00:22.000', { messages: first, working: true, prompts: [...state.prompts] })
    const working = [...first, agentRow('d4f3162c', 'Looking at the cat, running a check.', '07:00:25.000')]
    await show('07:00:32.000', { messages: working, working: true, prompts: [...state.prompts] })
    // A tab switch and back mid-turn: the status is read afresh.
    unmount()
    let back: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      state: 'working',
      prompt: '[Image #17]',
      updatedAt: at('07:01:00.000'),
      stateStartedAt: at('07:00:20.550')
    })
    await show('07:02:00.000', { messages: working, working: true, prompts: [...back.prompts] })
    await send('07:02:10.000', '', ['file:///phone/c2.jpg'], [`${TEMP}/${B}.png`])
    const sent = frames.length
    back = observeAgentStatusPrompt(back, SESSION, { state: 'working', prompt: '[Image #18]', updatedAt: at('07:02:10.600') })
    await show('07:02:11.000', { messages: working, working: true, prompts: [...back.prompts], queued: queuedMessagesFromScreen(claudeScreen(['[Image #18]'])) })
    const tookIt = [...working, agentRow('33806c18', 'Also a dog.', '07:02:40.000')]
    await show('07:02:45.000', { messages: tookIt, working: true, prompts: [...back.prompts], queued: [] })
    await show('07:02:46.000', { messages: tookIt, working: true, prompts: [...back.prompts], queued: [] })
    const flashed = framesFrom(sent).filter((frame) => deskBubbles(frame, []).length > 0)
    expect([lastFrame().filter((bubble) => bubble.images === 'P').length, deskBubbles(lastFrame(), []), flashed.length]).toEqual([2, [], 0])
  })
})
