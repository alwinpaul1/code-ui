// Final review of fix/midturn-prompt-at-end, 2026-09-29: Orca cuts the tab
// status's prompt field at 200 characters, and one character earlier when the
// cut would leave half an emoji (`truncatePreservingSurrogates` in
// src/shared/agent-status-field-normalization.ts). The status reader flagged a
// copy as cut only at 200, so a copy cut at 199 before an emoji was taken for
// the whole message: it matched neither the phone's own send of the message
// nor the row of it that landed, and the message was drawn twice. bbd4659d
// fixed the same off-by-one in the witness memory; this is the reader's.
import { describe, expect, it, vi } from 'vitest'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import { agentRow, at, before, landingHarness, SESSION, userRow } from './mobile-chat-phone-photo-landing.test-support'

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

/** Its status copy is cut at 199 characters, before the emoji. */
const CUT_BEFORE_EMOJI = `${'word '.repeat(39)}abc \u{1F600} and the rest of the message`
/** Its status copy is cut at 200 characters. */
const CUT_AT_THE_FIELD = `${'word '.repeat(40)}and the rest of the message`

/** Orca's copy of a submission on the tab status, watched arriving: the pane
 *  idle with no prompt, then working with the prompt folded and cut. */
function statusCopy(text: string, clock: string): DesktopPrompt[] {
  const history = [{ state: 'done', prompt: '', startedAt: at('06:58:00.000') }]
  let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
    state: 'done',
    prompt: '',
    updatedAt: at('06:58:40.000'),
    stateStartedAt: at('06:58:40.000'),
    stateHistory: history,
    providerSession: { id: SESSION }
  })
  state = observeAgentStatusPrompt(state, SESSION, {
    state: 'working',
    prompt: normalizePromptField(text),
    updatedAt: at(clock),
    stateStartedAt: at(clock),
    stateHistory: [...history, { state: 'done', prompt: '', startedAt: at('06:58:40.000') }],
    providerSession: { id: SESSION }
  })
  return [...state.prompts]
}

describe('a message whose status copy Orca cut', () => {
  const { show, send, lastFrame, unmount } = landingHarness(frames)
  const drawnTimes = () => lastFrame().filter((bubble) => bubble.text.startsWith('word word')).length

  it('is the copy Orca makes', () => {
    expect(normalizePromptField(CUT_BEFORE_EMOJI)).toHaveLength(199)
    expect(normalizePromptField(CUT_AT_THE_FIELD)).toHaveLength(200)
  })

  for (const [label, text] of [
    ['before an emoji, at 199 characters', CUT_BEFORE_EMOJI],
    ['at the field, at 200 characters', CUT_AT_THE_FIELD]
  ] as const) {
    it(`${label}: is drawn once when it starts a turn and its row lands`, async () => {
      await show('07:00:00.000', { messages: before })
      const prompts = statusCopy(text, '07:00:10.000')
      await show('07:00:10.500', { messages: before, working: true, prompts })
      expect(drawnTimes()).toBe(1)
      const row: NativeChatMessage = userRow('4c1d2e3f', [text], '07:00:09.980')
      await show('07:00:11.000', { messages: [...before, row], working: true, prompts })
      await show('07:00:11.500', { messages: [...before, row], working: true, prompts })
      expect(drawnTimes()).toBe(1)
      unmount()
    })

    it(`${label}: is drawn once when the phone sends it mid-turn`, async () => {
      await show('07:00:00.000', { messages: before, working: true })
      await send('07:00:20.000', text, [])
      const prompts = statusCopy(text, '07:00:20.100')
      await show('07:00:20.500', { messages: before, working: true, prompts })
      // Claude took it; the reply to it comes.
      const reply = agentRow('9a8b7c6d', 'On it.', '07:00:38.000')
      await show('07:00:40.000', { messages: [...before, reply], working: true, prompts })
      await show('07:00:41.000', { messages: [...before, reply], working: true, prompts })
      expect(drawnTimes()).toBe(1)
      unmount()
    })
  }
})
