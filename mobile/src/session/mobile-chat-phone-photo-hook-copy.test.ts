import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import {
  TEXT1,
  TEXT2,
  TEMP,
  PATHS1,
  PATHS2,
  PHOTOS1,
  PHOTOS2,
  agentRow,
  promptRow,
  companionRow,
  before,
  P1,
  C1,
  reply1,
  hookCopy,
  claudeScreen,
  words,
  landingHarness
} from './mobile-chat-phone-photo-landing.fixtures'

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

// Third review of the photo binder (2026-09-26), each probe failing on
// 1f1899c0. Orca's UserPromptSubmit hook reports every prompt on the tab
// status (`agentStatus.prompt`), the phone's too; for a photo sent with no
// words that prompt is only its markers, `[Image #17]`, which read as no
// words at all: it never paired with the phone's send, and never retired when
// its row landed, so it stood beside the phone's photo as its own "Image on
// Desktop" bubble for good. That is the reported symptom in its likeliest
// form (the Thesis session, Claude Code 2.1.283).
describe('a phone photo with Orca’s hook copy of its prompt on the tab', () => {
  const { show, send, framesFrom, lastFrame, drawing, unmount } = landingHarness(frames)
  const pasteOf = (name: string) => `${TEMP}/${name}.png`
  const nameOf = (uuidTail: string, ms: number) => `orca-paste-${ms}-${uuidTail}-bbbb-4ccc-8ddd-eeeeeeeeeeee`

  it('draws a photo with no words sent while idle once, as the phone’s picture, in every frame', async () => {
    const A = nameOf('aaaaaaaa', 1790406034000)
    await show('07:00:00.000', { messages: before })
    await send('07:00:18.000', '', ['file:///phone/c1.jpg'], [pasteOf(A)])
    const sent = frames.length
    const prompts = hookCopy('07:00:18.600', '[Image #17]')
    await show('07:00:18.700', { messages: before, prompts, working: true })
    const landed = [...before, promptRow('add90135', 17, 1, '', '07:00:18.500'), companionRow('344189e5', [A], '07:00:18.500')]
    await show('07:00:19.000', { messages: landed, prompts, working: true })
    await show('07:00:30.000', { messages: [...landed, agentRow('d4f3162c', 'A cat.', '07:00:29.000')], prompts })
    for (const frame of framesFrom(sent)) {
      expect(frame.filter((bubble) => bubble.images.includes('D'))).toEqual([])
      expect(frame.length).toBeLessThanOrEqual(1)
    }
    expect(lastFrame()).toEqual([{ id: 'add90135', images: 'P', text: '' }])
  })

  it('draws the reported photo with no words once, sent before the read settled, beside an older desk photo', async () => {
    const earlier = [
      agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000'),
      promptRow('4665aaaa', 16, 1, '', '08:43:47.644'),
      companionRow('4670aaaa', PATHS2.slice(0, 1), '08:43:47.644'),
      agentRow('4671aaaa', 'Looked at the earlier photo.', '08:44:10.000'),
      agentRow('0b0bbe84', 'Final answer of that turn.', '08:57:06.630')
    ]
    const P17 = promptRow('add90135', 17, 1, '', '09:30:03.923')
    const C17 = companionRow('344189e5', PATHS1.slice(0, 1), '09:30:03.923')
    const reply = agentRow('d4f3162c', 'Here is what the photo shows.', '09:30:13.156')
    await show('09:29:00.000', { messages: earlier.slice(0, 1), loading: true })
    await send('09:30:03.500', '', ['file:///phone/p17.jpg'], [pasteOf(PATHS1[0]!)])
    const prompts = hookCopy('09:30:03.930', '[Image #17]')
    await show('09:30:04.000', { messages: [...earlier, P17, C17], working: true, prompts })
    await show('09:30:14.000', { messages: [...earlier, P17, C17, reply], prompts })
    expect(lastFrame()).toEqual([
      { id: '4665aaaa', images: 'D', text: '' },
      { id: 'add90135', images: 'P', text: '' }
    ])
  })

  it('draws a photo with no words Claude took mid-turn once, as the phone’s picture, in every frame', async () => {
    const A = nameOf('aaaaaaaa', 1790406034000)
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [pasteOf(A)])
    const sent = frames.length
    const prompts = hookCopy('07:03:54.573', '[Image #73]')
    await show('07:03:55.000', { messages: working, working: true, prompts, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts, queued: [] })
    const ended = [...tookIt, agentRow('a392b851', 'Done.', '07:05:12.454')]
    await show('07:05:13.000', { messages: ended, prompts, queued: [] })
    await show('07:05:14.000', { messages: ended, prompts, queued: [] })
    for (const frame of framesFrom(sent)) {
      expect(frame.filter((bubble) => bubble.images.includes('D'))).toEqual([])
      expect(frame.length).toBeLessThanOrEqual(1)
    }
    expect(lastFrame()).toEqual([expect.objectContaining({ images: 'P', text: '' })])
  })

  // The first frame back painted the hook copy before the draft store had read
  // the send back: chips, then the photos (the flash, symptom 1).
  it('never draws a captioned phone photo as Image on Desktop when the chat comes back before its read', async () => {
    await show('07:00:00.000', { messages: before })
    await send('07:00:18.000', TEXT1, PHOTOS1, PATHS1.map((file) => pasteOf(file)))
    const prompts = hookCopy('07:00:19.600', `[Image #67] [Image #68] [Image #69] ${TEXT1}`)
    unmount()
    const back = frames.length
    await show('07:01:00.000', { messages: before, loading: true, prompts })
    await show('07:01:01.000', { messages: [...before, P1, C1], prompts, working: true })
    await show('07:01:02.000', { messages: [...before, P1, C1], prompts, working: true })
    for (const frame of framesFrom(back)) {
      expect(frame.filter((bubble) => bubble.images.includes('D'))).toEqual([])
      expect(drawing(frame, TEXT1).length).toBeLessThanOrEqual(1)
    }
    expect(lastFrame()).toEqual([{ id: '40b55aba', images: 'PPP', text: words(TEXT1) }])
  })
})

describe('what the third review of the path rule found', () => {
  const { show, send, lastFrame, drawing, unmount } = landingHarness(frames)
  const drawnPreviews = () => frames.at(-1)!.imagePreviewsByMessageId as Record<string, string[]>

  // Regression from 4e25d63e: the first message's photos were stored on its
  // companion, the row that named them in a window starting there, and moved
  // onto the next message's prompt once the older page loaded above.
  it('keeps each photo message with its own photos after the older page loads above a window that started at a companion', async () => {
    const reply2 = agentRow('r2r2r2r2', 'Both photos seen.', '07:00:40.000')
    await show('07:00:00.000', { messages: before })
    await send('07:00:18.000', TEXT1, PHOTOS1)
    await send('07:00:19.000', TEXT2, PHOTOS2)
    unmount()
    const P2b = promptRow('e96491cb', 70, 3, TEXT2, '07:00:20.100')
    const C2b = companionRow('394fac0f', PATHS2, '07:00:20.100')
    await show('07:05:00.000', { messages: [C1, P2b, C2b, reply2] })
    expect(drawing(lastFrame(), TEXT2)).toEqual([{ id: 'e96491cb', images: 'PPP', text: words(TEXT2) }])
    await show('07:05:10.000', { messages: [...before, P1, C1, P2b, C2b, reply2] })
    await show('07:05:11.000', { messages: [...before, P1, C1, P2b, C2b, reply2] })
    expect(lastFrame()).toEqual([
      { id: '40b55aba', images: 'PPP', text: words(TEXT1) },
      { id: 'e96491cb', images: 'PPP', text: words(TEXT2) }
    ])
    expect(drawnPreviews()['e96491cb']).toEqual(PHOTOS2)
  })

  // Regression from 1f1899c0: a first send made before the read settled, never
  // delivered, was held for a row naming its path that never comes, beside
  // the resend's row, for a day.
  it('draws a photo message once when it is sent again after a first send, made before the read settled, was never delivered', async () => {
    const LOST = `${TEMP}/orca-paste-1790406010000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`
    const AGAIN = `${TEMP}/orca-paste-1790406070000-11111111-2222-4333-8444-555555555555.png`
    await show('07:00:00.000', { messages: before, loading: true })
    await send('07:00:18.000', TEXT1, ['file:///phone/shot.jpg'], [LOST])
    await show('07:00:30.000', { messages: before })
    await send('07:01:10.000', TEXT1, ['file:///phone/shot.jpg'], [AGAIN])
    const landed = [
      ...before,
      promptRow('r1r1r1r1', 67, 1, TEXT1, '07:01:10.500'),
      companionRow('r1c1r1c1', [AGAIN.slice(TEMP.length + 1, -4)], '07:01:10.500')
    ]
    await show('07:01:11.000', { messages: landed, working: true })
    await show('07:01:40.000', { messages: [...landed, reply1] })
    await show('08:01:40.000', { messages: [...landed, reply1] })
    expect(drawing(lastFrame(), TEXT1)).toEqual([{ id: 'r1r1r1r1', images: 'P', text: words(TEXT1) }])
  })
})

