// Sixth review of the photo binder (2026-09-26), each case failing on
// f91596d6: a photo send made before the read settled could take a row with
// no photo stamped after it, less 5 s, by the phone's clock against the
// desk's; a phone 40 s behind, or an older row of its words 3.5 s before it,
// took the phone's photo, and the send's own row drew "Image on Desktop".
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  PATHS1,
  agentRow,
  userRow,
  promptRow,
  companionRow,
  at,
  claudeScreen,
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

describe('a photo message sent while the chat loads, and an older row of its words with no photo', () => {
  const { show, send, lastFrame, drawing } = landingHarness(frames)
  const WORDS = 'what about this one'

  it('phone clock 40 s behind the desk: the older row does not take the photo after a quiet minute', async () => {
    // Desk times are 40 s ahead of the phone's: the older row is 33.5 s
    // before the send by the desk's clock, as in the fourth review's case.
    const older = [
      agentRow('0a0a0a0a', 'Earlier answer.', '09:21:00.000'),
      userRow('old1old1', [WORDS], '09:30:10.000'),
      agentRow('0b0bbe84', 'Let me run the suite first.', '09:30:20.000')
    ]
    vi.setSystemTime(at('09:29:59.000'))
    await show('09:29:59.000', { messages: [], loading: true, working: true })
    await send('09:30:03.500', WORDS, ['file:///phone/p17.jpg'])
    const box = queuedMessagesFromScreen(claudeScreen([`[Image #17] ${WORDS}`]))
    await show('09:30:04.000', { messages: older, working: true, queued: box })
    await show('09:31:00.000', { messages: older, working: true, queued: box })
    await show('09:31:01.000', { messages: [...older], working: true, queued: box })
    const landed = [
      ...older,
      agentRow('0c0c0c0c', 'All green.', '09:31:50.000'),
      promptRow('new1new1', 17, 1, WORDS, '09:31:51.000'),
      companionRow('new2new2', PATHS1.slice(0, 1), '09:31:51.000')
    ]
    await show('09:31:12.000', { messages: landed, working: true, queued: [] })
    await show('09:31:13.000', { messages: landed, working: true, queued: [] })
    expect(drawing(lastFrame(), WORDS)).toEqual([
      { id: 'old1old1', images: '', text: WORDS },
      { id: 'new1new1', images: 'P', text: WORDS }
    ])
  })

  it('no skew: a desk row of the same words 3.5 s before the send does not take the photo', async () => {
    const older = [
      agentRow('0a0a0a0a', 'Earlier answer.', '09:20:00.000'),
      userRow('old1old1', [WORDS], '09:30:00.000'),
      agentRow('0b0bbe84', 'Let me run the suite first.', '09:30:02.000')
    ]
    vi.setSystemTime(at('09:29:59.000'))
    await show('09:29:59.000', { messages: [], loading: true, working: true })
    await send('09:30:03.500', WORDS, ['file:///phone/p17.jpg'])
    const box = queuedMessagesFromScreen(claudeScreen([`[Image #17] ${WORDS}`]))
    await show('09:30:04.000', { messages: older, working: true, queued: box })
    const landed = [
      ...older,
      agentRow('0c0c0c0c', 'All green.', '09:30:30.000'),
      promptRow('new1new1', 17, 1, WORDS, '09:30:31.000'),
      companionRow('new2new2', PATHS1.slice(0, 1), '09:30:31.000')
    ]
    await show('09:30:32.000', { messages: landed, working: true, queued: [] })
    await show('09:30:33.000', { messages: landed, working: true, queued: [] })
    expect(drawing(lastFrame(), WORDS)).toEqual([
      { id: 'old1old1', images: '', text: WORDS },
      { id: 'new1new1', images: 'P', text: WORDS }
    ])
  })
})
