// Eighth review of the photo binder (2026-09-26), failing on 4064ae8d: a
// keyless witness paired with its prompt BY ID, and a status
// prompt's nonce is `status:<session>:<stateStartedAt>:0` at every first
// sight in the same working state, so a later first sight reuses the id.
import { describe, expect, it, vi } from 'vitest'
import { agentRow, before, landingHarness, SESSION, at } from './mobile-chat-phone-photo-landing.test-support'
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

describe('a desk photo of no words, then a desk text, both mid-turn, then a tab switch', () => {
  const { show, lastFrame, unmount, drawing } = landingHarness(frames)
  const FOLLOW = 'also check the logs'

  it('keeps the desk photo and draws the desk text once after the tab switch', async () => {
    const running = [...before, agentRow('080e05a3', 'Working on it.', '07:01:05.000')]
    // The phone opens the chat while the desk screenshot is the status prompt.
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      prompt: '[Image #74]',
      updatedAt: at('07:03:10.000'),
      stateStartedAt: at('07:01:00.100')
    })
    await show('07:03:20.000', { messages: running, working: true, prompts: [...state.prompts] })
    await show('07:03:21.000', { messages: running, working: true, prompts: [...state.prompts] })
    // The desk types a follow-up, mid-turn, while the phone watches.
    state = observeAgentStatusPrompt(state, SESSION, { prompt: FOLLOW, updatedAt: at('07:04:00.000') })
    await show('07:04:00.500', { messages: running, working: true, prompts: [...state.prompts] })
    await show('07:04:01.000', { messages: running, working: true, prompts: [...state.prompts] })
    const beforeSwitch = lastFrame()
    // Tab switch and back, same turn: the status is read afresh.
    unmount()
    const back = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      prompt: FOLLOW,
      updatedAt: at('07:04:30.000'),
      stateStartedAt: at('07:01:00.100')
    })
    await show('07:05:00.000', { messages: running, working: true, prompts: [...back.prompts] })
    await show('07:05:01.000', { messages: running, working: true, prompts: [...back.prompts] })
    const after = lastFrame()
    void beforeSwitch
    // After the switch: the desk photo once, the desk text once.
    expect([after.filter((b) => b.images === 'D').length, drawing(after, FOLLOW).length]).toEqual([1, 1])
  })
})
