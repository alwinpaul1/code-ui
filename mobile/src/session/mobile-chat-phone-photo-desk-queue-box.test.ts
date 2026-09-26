// Fourth review of the photo binder (2026-09-26), each case failing on edf03b37.
// A desk photo of no words the agent's queue box lists is drawn there only.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { agentRow, before, hookCopy, claudeScreen, landingHarness } from './mobile-chat-phone-photo-landing.test-support'

vi.mock('expo-clipboard', () => ({ hasImageAsync: vi.fn(async () => false), getImageAsync: vi.fn(async () => null), setStringAsync: vi.fn() }))
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' }, StyleSheet: { create: (s: unknown) => s, absoluteFill: {} }, View: 'View' }))
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return { MobileNativeChatView: (props: Record<string, unknown>) => { frames.push(props); return h('ChatView', props) } }
})

describe('a desk photo the queue box lists', () => {
  const { show, lastFrame } = landingHarness(frames)

  it('draws a desk photo with no words that the queue box still lists in the box only, not also as a bubble above it', async () => {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    const desk = hookCopy('07:04:20.000', '[Image #74]')
    const box = queuedMessagesFromScreen(claudeScreen(['[Image #74]']))
    await show('07:04:21.000', { messages: working, working: true, prompts: desk, queued: box })
    await show('07:04:22.000', { messages: working, working: true, prompts: desk, queued: box })
    expect(lastFrame()).toEqual([])
  })
})
