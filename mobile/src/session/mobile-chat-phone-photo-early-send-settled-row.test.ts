// Seventh review of the photo binder (2026-09-26), failing on b52e0d53: a photo message sent while the chat loads, whose own row
// lands with its words and no photo (the fifth review's case). b52e0d53 lets
// such a send take a photo-less row only after the last row of the read it
// settled on (settledTailId). Two ordinary reads break that: the settled
// read already holds the own row, and the settled read is empty (null tail).
import { describe, expect, it, vi } from 'vitest'
import {
  agentRow,
  userRow,
  at,
  landingHarness
} from './mobile-chat-phone-photo-landing.test-support'

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


describe('an early photo send whose photo-less row the settled read cannot place after its tail', () => {
  const { show, send, lastFrame, drawing, drafts } = landingHarness(frames)
  const WORDS = 'what about this one'

  it('draws once when the first settled read already holds its row (Claude wrote it before the read came back)', async () => {
    const earlier = [agentRow('0a0a0a0a', 'Earlier answer.', '09:20:00.000')]
    vi.setSystemTime(at('09:29:59.000'))
    await show('09:29:59.000', { messages: [], loading: true })
    await send('09:30:03.500', WORDS, ['file:///phone/p17.jpg'])
    const landed = [...earlier, userRow('new1new1', [WORDS], '09:30:04.100')]
    await show('09:30:05.000', { messages: landed, working: true })
    const replied = [...landed, agentRow('0c0c0c0c', 'I do not see an image.', '09:30:10.000')]
    await show('09:30:11.000', { messages: replied })
    await show('09:31:11.000', { messages: replied })
    await show('10:31:11.000', { messages: [...replied] })
    expect([drawing(lastFrame(), WORDS), drafts()!.pending]).toEqual([[{ id: 'new1new1', images: 'P', text: WORDS }], []])
  })

  it('draws once when the read settles on an empty conversation (a new session) and its row lands after', async () => {
    vi.setSystemTime(at('09:29:59.000'))
    await show('09:29:59.000', { messages: [], loading: true })
    await send('09:30:03.500', WORDS, ['file:///phone/p17.jpg'])
    await show('09:30:04.000', { messages: [] })
    const landed = [userRow('new1new1', [WORDS], '09:30:04.100')]
    await show('09:30:05.000', { messages: landed, working: true })
    const replied = [...landed, agentRow('0c0c0c0c', 'I do not see an image.', '09:30:10.000')]
    await show('09:30:11.000', { messages: replied })
    await show('09:31:11.000', { messages: [...replied] })
    expect([drawing(lastFrame(), WORDS), drafts()!.pending.length]).toEqual([[{ id: 'new1new1', images: 'P', text: WORDS }], 0])
  })
})
