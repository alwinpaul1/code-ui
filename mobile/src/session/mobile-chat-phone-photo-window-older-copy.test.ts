// Seventh review of the photo binder (2026-09-26), failing on b52e0d53: markersBefore reads only the rows the phone holds, and the
// phone holds the last 40. An older markers-only copy whose row is above that
// window is not ruled out, the phone's photo of no words binds to it at its
// first render, and its own copy then draws "Image on Desktop".
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  TEMP,
  agentRow,
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

const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const pad = (n: number) => String(n).padStart(2, '0')
/** 40 rows of Claude working, one a second from `minute`:00. */
const steps = (prefix: string, minute: string) =>
  Array.from({ length: 40 }, (_, index) => agentRow(`${prefix}${pad(index)}${prefix}${pad(index)}`, `Step ${index}.`, `${minute}:${pad(index)}.000`))

describe('an older markers-only copy whose row is above the loaded window', () => {
  const { show, send, framesFrom, lastFrame } = landingHarness(frames)
  const chipsOf = (frame: ReturnType<typeof lastFrame>, copyAt: string) =>
    frame.filter((bubble) => bubble.images.includes('D') && bubble.id.startsWith(`desk-status:${SESSION}:${at(copyAt)}`))

  it('desk screenshot of no words started a long turn: the phone photo of no words taken mid-turn draws no "Image on Desktop"', async () => {
    // The last 40 rows of the turn: the desk's `[Image #72]` row is older.
    const running = steps('r', '07:02')
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      prompt: '[Image #72]',
      updatedAt: at('07:03:10.000'),
      stateStartedAt: at('07:01:00.100')
    })
    await show('07:03:20.000', { messages: running, working: true, prompts: [...state.prompts] })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const sent = frames.length
    state = observeAgentStatusPrompt(state, SESSION, { prompt: '[Image #73]', updatedAt: at('07:03:54.573') })
    await show('07:03:55.000', { messages: running, working: true, prompts: [...state.prompts], queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...running, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:04:37.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    const flashed = framesFrom(sent).filter((frame) => chipsOf(frame, '07:03:54.573').length > 0)
    expect([lastFrame().filter((bubble) => bubble.images === 'P').length, chipsOf(lastFrame(), '07:03:54.573'), flashed.length]).toEqual([1, [], 0])
  })
})
