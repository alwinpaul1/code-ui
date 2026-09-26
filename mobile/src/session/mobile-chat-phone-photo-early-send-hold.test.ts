// Fourth review of the photo binder (2026-09-26), each case failing on edf03b37.
// A send made before the read settled is held for the row naming its paths;
// an older row of the same words must not release it, whatever the timing.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  PATHS1,
  PATHS2,
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

describe('the early-send hold and an older row of the same words', () => {
  const { show, send, lastFrame, drawing, drafts } = landingHarness(frames)
  const WORDS = 'what about this one'

  it('draws the phone photo on its own row when Claude dequeues it after a long tool call', async () => {
    const older = [
      agentRow('0a0a0a0a', 'Earlier answer.', '09:20:00.000'),
      userRow('old1old1', [WORDS], '09:29:30.000'),
      agentRow('0b0bbe84', 'Let me run the suite first.', '09:29:40.000')
    ]
    vi.setSystemTime(at('09:29:59.000'))
    await show('09:29:59.000', { messages: [], loading: true, working: true })
    await send('09:30:03.500', WORDS, ['file:///phone/p17.jpg'])
    const box = queuedMessagesFromScreen(claudeScreen([`[Image #17] ${WORDS}`]))
    await show('09:30:04.000', { messages: older, working: true, queued: box })
    // A quiet minute: the command writes nothing. Then the relay re-dials
    // and the transcript is read again, the same rows in a new list.
    await show('09:31:00.000', { messages: older, working: true, queued: box })
    await show('09:31:01.000', { messages: [...older], working: true, queued: box })
    // The suite ends and Claude dequeues the message as its own row.
    const landed = [
      ...older,
      agentRow('0c0c0c0c', 'All green.', '09:31:10.000'),
      promptRow('new1new1', 17, 1, WORDS, '09:31:11.000'),
      companionRow('new2new2', PATHS1.slice(0, 1), '09:31:11.000')
    ]
    await show('09:31:12.000', { messages: landed, working: true, queued: [] })
    await show('09:31:13.000', { messages: landed, working: true, queued: [] })
    expect(drawing(lastFrame(), WORDS)).toEqual([
      { id: 'old1old1', images: '', text: WORDS },
      { id: 'new1new1', images: 'P', text: WORDS }
    ])
  })
  it('keeps a photo message sent before the read settled for its own row when an older photo message has the same words and a quiet minute passes', async () => {
    const older = [
      agentRow('0a0a0a0a', 'Earlier answer.', '09:20:00.000'),
      promptRow('old1old1', 16, 1, WORDS, '09:29:30.000'),
      companionRow('old2old2', PATHS2.slice(0, 1), '09:29:30.000'),
      agentRow('0b0bbe84', 'Let me run the suite first.', '09:29:40.000')
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
      agentRow('0c0c0c0c', 'All green.', '09:31:10.000'),
      promptRow('new1new1', 17, 1, WORDS, '09:31:11.000'),
      companionRow('new2new2', PATHS1.slice(0, 1), '09:31:11.000')
    ]
    await show('09:31:12.000', { messages: landed, working: true, queued: [] })
    await show('09:31:13.000', { messages: landed, working: true, queued: [] })
    expect(drawing(lastFrame(), WORDS)).toEqual([
      { id: 'old1old1', images: 'D', text: WORDS },
      { id: 'new1new1', images: 'P', text: WORDS }
    ])
  })
  it('keeps a photo message sent before the read settled for its own row when an older photo message of the same words was answered within seconds', async () => {
    // The same words with another photo a minute ago; Claude's first row of
    // that turn came 3 s after it and it is still running a command.
    const older = [
      agentRow('0a0a0a0a', 'Earlier answer.', '09:20:00.000'),
      promptRow('old1old1', 16, 1, WORDS, '09:29:37.000'),
      companionRow('old2old2', PATHS2.slice(0, 1), '09:29:37.000'),
      agentRow('0b0bbe84', 'Let me run the suite first.', '09:29:40.000')
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
      { id: 'old1old1', images: 'D', text: WORDS },
      { id: 'new1new1', images: 'P', text: WORDS }
    ])
  })
  // Fifth review (failing on cdbc8a35): the rule above kept such a send off
  // every row with no photo, and its own row can have none, when the paste did
  // not attach. It then stood as a second bubble for good.
  it('draws a photo message sent while the chat loads once when its row lands with its words and no photo', async () => {
    const earlier = [agentRow('0a0a0a0a', 'Earlier answer.', '09:20:00.000')]
    vi.setSystemTime(at('09:29:59.000'))
    await show('09:29:59.000', { messages: [], loading: true })
    await send('09:30:03.500', WORDS, ['file:///phone/p17.jpg'])
    await show('09:30:04.000', { messages: earlier })
    const landed = [...earlier, userRow('new1new1', [WORDS], '09:30:04.100')]
    await show('09:30:05.000', { messages: landed, working: true })
    const replied = [...landed, agentRow('0c0c0c0c', 'I do not see an image.', '09:30:10.000')]
    await show('09:30:11.000', { messages: replied })
    await show('09:31:11.000', { messages: replied })
    await show('10:31:11.000', { messages: [...replied] })
    expect([drawing(lastFrame(), WORDS), drafts()!.pending]).toEqual([[{ id: 'new1new1', images: 'P', text: WORDS }], []])
  })
})
