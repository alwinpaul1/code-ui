// Fourth review of the photo binder (2026-09-26), each case failing on edf03b37.
// A photo pasted at the desk with no words is reported by Orca's hook as its
// markers alone, like the phone's photo of no words: a phone send must only
// stand for the hook copy timed within its own send window.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  TEMP,
  agentRow,
  before,
  hookCopy,
  claudeScreen,
  landingHarness,
  SESSION,
  at
} from './mobile-chat-phone-photo-landing.test-support'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'

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

describe('a photo pasted at the desk with no words', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)
  const pasteOf = (name: string) => `${TEMP}/${name}.png`
  const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('still draws the desk photo after the chat comes back, beside a phone photo Claude took mid-turn', async () => {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    // The phone sends one photo with no words while Claude works.
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [pasteOf(A)])
    const own = hookCopy('07:03:54.573', '[Image #73]')
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    // The user leaves the chat. At the desk, a screenshot is pasted with no
    // words while the same turn still runs; the tab status now holds it.
    unmount()
    // Back on the chat, the status is read afresh: its prompt is the desk's,
    // timed at first sight by when the pane's working state began.
    const desk = [
      ...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
        prompt: '[Image #74]',
        updatedAt: at('07:10:40.000'),
        stateStartedAt: at('07:02:10.000')
      }).prompts
    ]
    const later = [...tookIt, agentRow('44906d18', 'Still fixing.', '07:09:00.000')]
    await show('07:11:00.000', { messages: later, working: true, prompts: desk, queued: [] })
    await show('07:11:01.000', { messages: later, working: true, prompts: desk, queued: [] })
    const frame = lastFrame()
    // The phone's photo, and the desk's as its own "Image on Desktop" bubble.
    expect(frame.filter((bubble) => bubble.images === 'P')).toHaveLength(1)
    expect(frame.filter((bubble) => bubble.images.includes('D'))).toHaveLength(1)
  })

})
