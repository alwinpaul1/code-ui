// Review of 2026-09-30: the tab status's desk prompts were numbered by how
// many the chat kept, which stops at 64, so every prompt read after that got
// the same nonce as the one before it when both were placed by the same run
// start (agent-status-prompts-past-the-cap.test.ts). The chat keys a desk echo
// by its nonce: its row id, its remembered anchor, its waits. The row id is
// the chat list's key (MobileNativeChatView's keyExtractor), and two rows under
// one key are two items React can draw as one. This drives the real overlay
// with such a session and reads back the rows it hands the list.
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import type { DesktopPrompt } from './agent-hud-beacon'
import { SESSION, agentRow, at, landingHarness } from './mobile-chat-phone-photo-landing.test-support'

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

const RUN = at('06:59:00.000')
const earlier = agentRow('94b09904', 'One shell, two agents.', '06:58:36.593')

/** Messages typed while the agent asked something, all in the run that began
 *  at RUN, each read off the tab status as it came. */
function statusPrompts(count: number): DesktopPrompt[] {
  let state = EMPTY_AGENT_STATUS_PROMPTS
  for (let index = 0; index < count; index += 1) {
    const text = `desk message ${index}`
    state = observeAgentStatusPrompt(state, SESSION, {
      state: 'waiting',
      prompt: text,
      updatedAt: RUN + 30_000 + index * 100,
      stateStartedAt: RUN + 20_000 + index * 100,
      stateHistory: [{ state: 'working', prompt: text, startedAt: RUN }]
    })
  }
  return [...state.prompts]
}

describe('desk messages a session sends after the chat has read 64', () => {
  const { show, lastFrame, drawing } = landingHarness(frames)

  it('hands the list each of the last two once, under a key of its own', async () => {
    const prompts = statusPrompts(66)
    await show('07:00:00.000', { messages: [earlier], prompts })
    await show('07:00:01.000', { messages: [earlier], prompts })
    const frame = lastFrame()
    expect(drawing(frame, 'desk message 64')).toHaveLength(1)
    expect(drawing(frame, 'desk message 65')).toHaveLength(1)
    expect(new Set(frame.map((bubble) => bubble.id)).size).toBe(frame.length)
  })
})
