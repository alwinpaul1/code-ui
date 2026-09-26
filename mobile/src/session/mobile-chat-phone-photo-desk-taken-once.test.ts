// Seventh review of the photo binder (2026-09-26), failing on b52e0d53: a photo pasted at the desk with no words, which Claude takes
// mid-turn (no row), reaches the phone only as Orca's hook copy `[Image #72]`.
// The chat remembers it as a witness (`desk-<nonce>`), and the witness never
// pairs with the hook copy it came from, since a markers-only text has no key
// and only a phone photo send pairs with one. Both draw.
import { describe, expect, it, vi } from 'vitest'
import {
  agentRow,
  before,
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

describe('a desk photo of no words taken mid-turn', () => {
  const { show, lastFrame } = landingHarness(frames)

  it('is drawn once while the phone watches it arrive', async () => {
    const running = [...before, agentRow('080e05a3', 'Working on it.', '07:01:05.000')]
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      prompt: 'fix the build',
      updatedAt: at('07:01:00.000'),
      stateStartedAt: at('07:01:00.000')
    })
    await show('07:01:10.000', { messages: running, working: true, prompts: [...state.prompts] })
    state = observeAgentStatusPrompt(state, SESSION, { prompt: '[Image #72]', updatedAt: at('07:02:00.000') })
    await show('07:02:00.500', { messages: running, working: true, prompts: [...state.prompts] })
    await show('07:02:01.000', { messages: running, working: true, prompts: [...state.prompts] })
    const later = [...running, agentRow('33806c18', 'I see the screenshot.', '07:02:20.000')]
    await show('07:02:21.000', { messages: later, working: true, prompts: [...state.prompts] })
    await show('07:02:22.000', { messages: later, working: true, prompts: [...state.prompts] })
    expect(lastFrame().filter((bubble) => bubble.images === 'D')).toHaveLength(1)
  })

  it('is drawn once when the chat is opened after it', async () => {
    const running = [...before, agentRow('080e05a3', 'Working on it.', '07:01:05.000')]
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      prompt: '[Image #72]',
      updatedAt: at('07:03:10.000'),
      stateStartedAt: at('07:01:00.100')
    })
    await show('07:03:20.000', { messages: running, working: true, prompts: [...state.prompts] })
    await show('07:03:21.000', { messages: running, working: true, prompts: [...state.prompts] })
    expect(lastFrame().filter((bubble) => bubble.images === 'D')).toHaveLength(1)
  })
})
