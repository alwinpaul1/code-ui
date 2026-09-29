// Seventh review of the photo binder (2026-09-26), failing on b52e0d53: a phone photo of no words starts a long turn. Back in the
// chat after a tab switch, the tab status still names it (`[Image #17]`, the
// last prompt the session took, timed by the idle state's start), and its
// row is above the 40 rows loaded. Nothing holds it any more (the send
// retired when its row landed), so the hook copy draws as "Image on Desktop"
// (twice: the witness remembered from it never pairs with it).
import { describe, expect, it, vi } from 'vitest'
import {
  TEMP,
  agentRow,
  promptRow,
  companionRow,
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

const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const pad = (n: number) => String(n).padStart(2, '0')

describe('the phone photo whose row is above the loaded window', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)

  // Known limit (also on main): when the photo's row lands in the same read as
  // the hook's copy, the send retires without claiming the copy, and nothing
  // remembers it as the phone's.
  it('does not come back as "Image on Desktop" after a tab switch once a long turn has pushed its row out of the window', async () => {
    const hi = agentRow('0a0a0a0a', 'Hi.', '06:59:00.000')
    await show('07:00:00.000', { messages: [hi] })
    await send('07:00:20.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { state: 'working', prompt: '', updatedAt: at('07:00:20.600') })
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: '[Image #17]', updatedAt: at('07:00:20.600') })
    // The hook's copy reaches the phone before the photo's row does.
    await show('07:00:21.000', { messages: [hi], working: true, prompts: [...state.prompts] })
    const first = [hi, promptRow('a17a17a1', 17, 1, '', '07:00:20.500'), companionRow('a17a17a2', [A], '07:00:20.500')]
    await show('07:00:22.000', { messages: first, working: true, prompts: [...state.prompts] })
    // Claude fixes what the screenshot shows, 40 rows and more.
    const work = Array.from({ length: 40 }, (_, index) => agentRow(`f${pad(index)}f${pad(index)}`, `Step ${index}.`, `07:01:${pad(index)}.000`))
    const fixed = [...first, ...work, agentRow('d4f3162c', 'Fixed.', '07:01:50.000')]
    await show('07:01:51.000', { messages: fixed, prompts: [...state.prompts] })
    expect(lastFrame().filter((bubble) => bubble.images.includes('D'))).toEqual([])
    // A tab switch and back: the status is read afresh, the last 40 rows.
    unmount()
    const back = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      state: 'done',
      prompt: '[Image #17]',
      updatedAt: at('07:01:50.100'),
      stateStartedAt: at('07:01:50.050')
    })
    const window = fixed.slice(-40)
    await show('07:03:00.000', { messages: window, prompts: [...back.prompts] })
    await show('07:03:01.000', { messages: window, prompts: [...back.prompts] })
    expect(lastFrame().filter((bubble) => bubble.images.includes('D'))).toEqual([])
  })
})
