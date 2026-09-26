// Sixth review of the photo binder (2026-09-26), each case failing on
// f91596d6: a second phone photo of no words, sent seconds after the first or
// in a phone-launched session whose beacon still lists an older photo, took
// the older markers-only copy for its own.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  TEMP,
  agentRow,
  userRow,
  before,
  promptRow,
  companionRow,
  claudeScreen,
  landingHarness,
  SESSION
} from './mobile-chat-phone-photo-landing.test-support'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt, type AgentStatusPromptState } from './agent-status-prompts'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import type { DesktopPrompt } from './agent-hud-beacon'
import { at } from './mobile-chat-phone-photo-landing.test-support'

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

const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const B = 'orca-paste-1790406134000-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const live = (state: AgentStatusPromptState, prompt: string, clock: string) =>
  observeAgentStatusPrompt(state, SESSION, { prompt, updatedAt: at(clock) })

describe('two phone photos of no words close together', () => {
  const { show, send, framesFrom, lastFrame, unmount } = landingHarness(frames)
  const deskBubbles = (frame: ReturnType<typeof lastFrame>) => frame.filter((bubble) => bubble.images.includes('D'))

  it('a second photo of no words sent 3.5 s after the first one landed, taken mid-turn: no "Image on Desktop" beside it', async () => {
    await show('07:00:00.000', { messages: before })
    await send('07:00:20.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    let state = live(live(EMPTY_AGENT_STATUS_PROMPTS, '', '07:00:20.500'), '[Image #17]', '07:00:20.500')
    await show('07:00:20.600', { messages: before, working: true, prompts: [...state.prompts] })
    const first = [...before, promptRow('a17a17a1', 17, 1, '', '07:00:20.450'), companionRow('a17a17a2', [A], '07:00:20.450')]
    await show('07:00:21.000', { messages: first, working: true, prompts: [...state.prompts] })
    const working = [...first, agentRow('d4f3162c', 'Looking at the first photo.', '07:00:22.000')]
    await show('07:00:22.500', { messages: working, working: true, prompts: [...state.prompts] })
    // The second photo, while Claude works on the first.
    await send('07:00:24.000', '', ['file:///phone/c2.jpg'], [`${TEMP}/${B}.png`])
    const sent = frames.length
    state = live(state, '[Image #18]', '07:00:24.500')
    await show('07:00:25.000', { messages: working, working: true, prompts: [...state.prompts], queued: queuedMessagesFromScreen(claudeScreen(['[Image #18]'])) })
    const tookIt = [...working, agentRow('33806c18', 'And the second one.', '07:00:40.000')]
    await show('07:00:41.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:00:42.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    const flashed = framesFrom(sent).filter((frame) => deskBubbles(frame).length > 0)
    expect([lastFrame().filter((bubble) => bubble.images === 'P').length, deskBubbles(lastFrame()), flashed.length]).toEqual([2, [], 0])
  })

  it('beacon: an older photo of no words in the beacon history, a return to the chat, then a photo of no words taken mid-turn', async () => {
    const beacon: DesktopPrompt[] = []
    await show('07:00:00.000', { messages: before })
    await send('07:00:20.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    let state = live(live(EMPTY_AGENT_STATUS_PROMPTS, '', '07:00:20.500'), '[Image #17]', '07:00:20.500')
    beacon.push({ nonce: '201', text: '[Image #17]' })
    const first = [...before, promptRow('a17a17a1', 17, 1, '', '07:00:20.450'), companionRow('a17a17a2', [A], '07:00:20.450')]
    await show('07:00:21.000', { messages: first, working: true, prompts: mergeDesktopPrompts(state.prompts, beacon) })
    const replied = [...first, agentRow('d4f3162c', 'A cat.', '07:00:29.000')]
    await show('07:00:30.000', { messages: replied, prompts: mergeDesktopPrompts(state.prompts, beacon) })
    // A text from the phone starts a long turn.
    await send('07:01:00.000', 'and what breed is it?', [])
    state = live(state, 'and what breed is it?', '07:01:00.400')
    beacon.push({ nonce: '202', text: 'and what breed is it?' })
    const asked = [...replied, userRow('q1q1q1q1', ['and what breed is it?'], '07:01:00.350'), agentRow('d5f3162c', 'Let me look it up.', '07:01:03.000')]
    await show('07:01:04.000', { messages: asked, working: true, prompts: mergeDesktopPrompts(state.prompts, beacon) })
    // A tab switch and back, mid-turn.
    unmount()
    const back = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      prompt: 'and what breed is it?',
      updatedAt: at('07:01:40.000'),
      stateStartedAt: at('07:01:00.400')
    })
    await show('07:02:00.000', { messages: asked, working: true, prompts: mergeDesktopPrompts(back.prompts, beacon) })
    await send('07:02:10.000', '', ['file:///phone/c2.jpg'], [`${TEMP}/${B}.png`])
    const sent = frames.length
    const now = live(back, '[Image #18]', '07:02:10.500')
    beacon.push({ nonce: '203', text: '[Image #18]' })
    await show('07:02:11.000', { messages: asked, working: true, prompts: mergeDesktopPrompts(now.prompts, beacon), queued: queuedMessagesFromScreen(claudeScreen(['[Image #18]'])) })
    const tookIt = [...asked, agentRow('33806c18', 'Also a tabby.', '07:02:40.000')]
    await show('07:02:41.000', { messages: tookIt, working: true, prompts: mergeDesktopPrompts(now.prompts, beacon), queued: [] })
    await show('07:02:42.000', { messages: tookIt, working: true, prompts: mergeDesktopPrompts(now.prompts, beacon), queued: [] })
    const flashed = framesFrom(sent).filter((frame) => deskBubbles(frame).length > 0)
    expect([lastFrame().filter((bubble) => bubble.images === 'P').length, deskBubbles(lastFrame()), flashed.length]).toEqual([2, [], 0])
  })
})
