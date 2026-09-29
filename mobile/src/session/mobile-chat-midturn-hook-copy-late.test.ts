// A hook copy that reaches the phone long after its status twin: the
// terminal's bytes stall while the tab status keeps flowing, and the merge
// takes a copy that came more than 30 s after its status copy for a later
// submission (desktop-prompt-merge.ts). The rows say it is not: it names a row
// at or before the status copy's time, with no words written between
// (withoutLateHookTwins, desk-prompt-row-owners.ts). The review of d147a9c4,
// A3; the other cases of the hook's copies are in
// mobile-chat-midturn-beacon-evidence.test.ts.
import { describe, expect, it, vi } from 'vitest'
import {
  at,
  SECOND_SEND,
  EARLIER,
  WRITTEN_BEFORE_SECOND,
  BEFORE_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  working,
  statusReader,
  drawn,
  beaconCopy,
  midturnChat
} from './mobile-chat-midturn-prompt.test-support'

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

const hooked = { promptHook: true }
const WORDS = 'yes, go ahead with the migration'
const LONG = `${SECOND_SEND} and also please check whether the session list on the account page still shows the ended sessions after a refresh, then run the whole suite again on staging`

describe('a hook copy that reaches the phone 45 s after its status copy', () => {
  const { unmount, showAt } = midturnChat(frames, () => 'claude')
  const bubblesOf = (words: string) =>
    drawn(frames.at(-1)!).filter((row) => row.role === 'user' && row.text.startsWith(words.replace(/\s+/g, ' ').slice(0, 40))).map((row) => row.text)

  for (const [label, words] of [
    ['of one line', WORDS],
    ['longer than the status field', LONG]
  ] as const) {
    it(`draws a mid-turn desk message ${label} once`, async () => {
      const late = beaconCopy('81201', words, WRITTEN_BEFORE_SECOND, '05:37:20.050')
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(words, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
      vi.setSystemTime(at('05:37:20.000'))
      prompts = reader.read(working(words, '05:36:34.891'), { beacon: [late] })
      await showAt('05:37:20.100', BEFORE_SECOND, prompts, true, [], hooked)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hooked)
      expect(bubblesOf(words)).toHaveLength(1)
      reader.unmount()
      unmount()
    })
  }

  // The guard: a copy that names a row written after the status copy's time
  // is another submission of the words (gap D), and is drawn.
  it('still draws a second message of the same words typed after words written since', async () => {
    const second = beaconCopy('81203', WORDS, 'c87c6d3e-1a98-4946-a845-df1e58f12acc', '05:37:20.050')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:05.000'))
    prompts = reader.read(working(WORDS, '05:36:04.891'))
    await showAt('05:36:05.100', BEFORE_SECOND.slice(0, 3), prompts, true, [], hooked)
    vi.setSystemTime(at('05:37:20.000'))
    prompts = reader.read(working(WORDS, '05:36:04.891'), { beacon: [second] })
    await showAt('05:37:20.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hooked)
    expect(bubblesOf(WORDS)).toHaveLength(2)
    reader.unmount()
    unmount()
  })
})
