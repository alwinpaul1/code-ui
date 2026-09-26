// Fourth review of the photo binder (2026-09-26), each case failing on edf03b37.
// The draft store forgets a send after a day; its waiting copy must not keep
// hiding desk photos after that.
import { describe, expect, it, vi } from 'vitest'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { TEMP, agentRow, before, hookCopy, claudeScreen, landingHarness } from './mobile-chat-phone-photo-landing.test-support'

vi.mock('expo-clipboard', () => ({ hasImageAsync: vi.fn(async () => false), getImageAsync: vi.fn(async () => null), setStringAsync: vi.fn() }))
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' }, StyleSheet: { create: (s: unknown) => s, absoluteFill: {} }, View: 'View' }))
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return { MobileNativeChatView: (props: Record<string, unknown>) => { frames.push(props); return h('ChatView', props) } }
})

const nextDay = (clock: string) => new Date(Date.parse(`2026-09-27T${clock}Z`))

describe('a photo send from an earlier visit, a day later', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)
  const A = 'orca-paste-1790406034000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('still draws a desk photo pasted mid-turn the next day, when the phone photo Claude took mid-turn has expired from the store', async () => {
    const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    await show('07:03:20.000', { messages: working, working: true })
    await send('07:03:54.000', '', ['file:///phone/c1.jpg'], [`${TEMP}/${A}.png`])
    const own = hookCopy('07:03:54.573', '[Image #73]')
    await show('07:03:55.000', { messages: working, working: true, prompts: own, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73]'])) })
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    await show('07:04:36.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    await show('07:04:37.000', { messages: tookIt, working: true, prompts: own, queued: [] })
    unmount()
    // A day and a bit later, the same session, a long turn running.
    vi.setSystemTime(nextDay('08:00:00.000'))
    const today = [...tookIt, { ...agentRow('0d0d0d0d', 'Still refactoring.', '07:59:00.000'), timestamp: nextDay('07:59:00.000').getTime() }]
    const desk = [{ nonce: 'status:next-day:0', text: '[Image #90]', at: nextDay('08:00:30.000').getTime() }]
    vi.setSystemTime(nextDay('08:01:00.000'))
    await show('07:00:00.000', { messages: today, working: true, prompts: desk, queued: [] })
    await show('07:00:00.000', { messages: today, working: true, prompts: desk, queued: [] })
    // The desk's photo is drawn (1f1899c0 draws it, twice: the known witness duplicate).
    expect(lastFrame().filter((bubble) => bubble.images.includes('D')).length).toBeGreaterThanOrEqual(1)
  })
})
