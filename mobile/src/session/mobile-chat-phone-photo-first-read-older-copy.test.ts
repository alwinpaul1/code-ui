// Seventh review of the photo binder (2026-09-26), failing on b52e0d53: markersBefore is read off the rows the phone holds at the
// send. A photo of no words sent while the chat's first read is in flight
// (no kept transcript for this session) records 0, so the older markers-only
// copy the tab status shows at first sight is not ruled out.
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

describe('a photo of no words sent before the chat\'s first read settles', () => {
  const { show, send, framesFrom, lastFrame } = landingHarness(frames)
  const ownCopyChips = (frame: ReturnType<typeof lastFrame>) =>
    frame.filter((bubble) => bubble.images.includes('D') && bubble.id.startsWith(`desk-status:${SESSION}:${at('07:03:24.573')}`))

  it('desk screenshot of no words started the turn; the phone opens the chat and sends a photo of no words at once, taken mid-turn: no "Image on Desktop" for it', async () => {
    const running = [
      ...before,
      promptRow('d35c0001', 72, 1, '', '07:01:00.000'),
      companionRow('d35c0002', [DESK], '07:01:00.000'),
      agentRow('080e05a3', 'Looking at the screenshot.', '07:01:05.000')
    ]
    let state: AgentStatusPromptState = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      state: 'working',
      prompt: '[Image #72]',
      updatedAt: at('07:03:10.000'),
      stateStartedAt: at('07:01:00.100')
    })
    // First open of this session on the phone: nothing kept, the read in flight.
    await show('07:03:20.000', { messages: [], loading: true, working: true, prompts: [...state.prompts] })
    await send('07:03:24.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const sent = frames.length
    await show('07:03:24.300', { messages: running, working: true, prompts: [...state.prompts] })
    state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: '[Image #73]', updatedAt: at('07:03:24.573') })
    await show('07:03:25.000', { messages: running, working: true, prompts: [...state.prompts], queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...running, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    await show('07:04:37.000', { messages: tookIt, working: true, prompts: [...state.prompts], queued: [] })
    const flashed = framesFrom(sent).filter((frame) => ownCopyChips(frame).length > 0)
    expect([lastFrame().filter((bubble) => bubble.images === 'P').length, ownCopyChips(lastFrame()), flashed.length]).toEqual([1, [], 0])
  })
})
