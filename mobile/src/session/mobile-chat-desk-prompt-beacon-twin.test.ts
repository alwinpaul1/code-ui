// Pre-merge review of 06911823: the tab status folds a prompt to one line and
// cuts it at 200 characters (normalizePromptField, the status's own rule); the
// beacon keeps the words as typed, up to 2,000 bytes. The merge matched the
// two copies of one message on exact text, so a multi-line or long prompt
// kept both and was drawn twice; with the status copy held back, the beacon's
// echo drew beside the stored witness of the same nonce, one list key twice.
import { describe, expect, it, vi } from 'vitest'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { agentRow, userRow, landingHarness, at, SESSION } from './mobile-chat-phone-photo-landing.test-support'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import type { DesktopPrompt } from './agent-hud-beacon'

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

function rowsIn(props: Record<string, unknown>): { id: string; text: string }[] {
  const { data } = buildMobileNativeChatTransientData({
    messages: props.messages as NativeChatMessage[],
    folded: props.folded as NativeChatMessage[],
    streaming: null,
    pending: props.pending as never,
    imagePreviewsByMessageId: props.imagePreviewsByMessageId as Record<string, string[]>
  })
  return data.map((message) => ({
    id: message.id,
    text: message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  }))
}

const opening = userRow('u1', ['now run the tests'], '07:00:00.000')
const a1 = agentRow('a1', 'Running the suite.', '07:00:40.000')
const MULTILINE = 'and paste the failing names here\n\nthen rerun only those'
const LONG = `${'check the fold on every screen size we ship, '.repeat(6)}and report back`

describe('a desk prompt that the tab status and the beacon both carried', () => {
  const { show, unmount } = landingHarness(frames)
  /** The desk bubbles drawn: the only desk message in these cases is the one. */
  const deskBubbles = () => rowsIn(frames.at(-1)!).filter((row) => row.id.startsWith('desk-'))

  for (const [name, text] of [['over several lines', MULTILINE], ['over 200 characters', LONG]] as const) {
    it(`is drawn once when it runs ${name}`, async () => {
      vi.setSystemTime(at('07:00:50.000'))
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { state: 'working', prompt: '', updatedAt: at('07:00:45.000'), stateHistory: [{ state: 'done', prompt: '' }] })
      state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: normalizePromptField(text), updatedAt: at('07:00:50.000') })
      const beacon: DesktopPrompt[] = [{ nonce: '9001', text, anchorId: 'a1', seenAt: at('07:00:50.000') }]
      const prompts = mergeDesktopPrompts(state.prompts, beacon)
      await show('07:00:51.000', { messages: [opening, a1], working: true, prompts })
      await show('07:00:52.000', { messages: [opening, a1], working: true, prompts })
      expect(deskBubbles()).toHaveLength(1)
    })
  }

  it('is drawn once, under one key, when the chat comes back and the status copy is held', async () => {
    vi.setSystemTime(at('07:00:50.000'))
    const beacon: DesktopPrompt[] = [{ nonce: '9001', text: MULTILINE, anchorId: 'a1', seenAt: at('07:00:50.000') }]
    await show('07:00:51.000', { messages: [opening, a1], working: true, prompts: mergeDesktopPrompts([], beacon) })
    await show('07:00:52.000', { messages: [opening, a1], working: true, prompts: mergeDesktopPrompts([], beacon) })
    unmount()
    // Back after the turn ended: the status's copy is found on a done pane
    // with no history to place it, and held.
    vi.setSystemTime(at('07:03:00.000'))
    const held = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
      state: 'done',
      prompt: normalizePromptField(MULTILINE),
      updatedAt: at('07:02:00.100'),
      stateStartedAt: at('07:02:00.050')
    })
    const answer = agentRow('a2', 'All done.', '07:02:00.000')
    const prompts = mergeDesktopPrompts(held.prompts, beacon)
    await show('07:03:00.000', { messages: [opening, a1, answer], prompts })
    await show('07:03:01.000', { messages: [opening, a1, answer], prompts })
    const ids = rowsIn(frames.at(-1)!).map((row) => row.id)
    expect(ids.filter((id) => id.startsWith('desk-'))).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
