// A user row made of several desk messages' words. Claude dequeues the
// messages still queued at a turn's end as one row, a line apart, and that
// row lands each of them (mobile-chat-midturn-beacon-evidence.test.ts, "two
// queued messages Claude dequeued as one row"). A prompt typed at the desk
// can be made of earlier messages' words too, and that one is no message's
// row but its own (the review of c3844d00, J1).
import { describe, expect, it, vi } from 'vitest'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import {
  at,
  WRITTEN_BEFORE_SECOND,
  BEFORE_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  LAST_REPLY,
  TURN_ENDED,
  text,
  user,
  working,
  done,
  statusReader,
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

const OK = 'ok'
const CONTINUE = 'continue'
const OK_CONTINUE = 'ok continue'
const NEXT_ROW = user('5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', OK_CONTINUE, '05:49:46.995')
const NEXT_REPLY = text('6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c', '05:50:05.000')

describe('a prompt typed at the desk made of earlier messages’ words', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, where } = midturnChat(frames, () => agent)
  const placesOf = (words: string) => {
    const found = where(words)
    return found.at.map((index) => found.after(index))
  }

  // "ok" was the pane's prompt when the chat opened; "continue" is typed at
  // the desk mid-turn and taken mid-turn, with no row; once the turn is over
  // "ok continue" is typed as the next turn's prompt. Split into the two, it
  // landed "continue" and retired its witness: the message was gone.
  for (const [kind, withHook] of [['claude', true], ['claude', false], ['codex', false]] as const) {
    it(`keeps the mid-turn message where it was sent, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab${withHook ? ' with the hook' : ' without the hook'}, and after the chat comes back`, async () => {
      agent = kind
      const hook = withHook ? { promptHook: true } : {}
      const copyContinue = beaconCopy('93001', CONTINUE, WRITTEN_BEFORE_SECOND, '05:36:35.050')
      const copyNext = beaconCopy('93002', OK_CONTINUE, LAST_REPLY, '05:49:47.050')
      const beacon = (list: ReturnType<typeof beaconCopy>[]) => (withHook ? { beacon: list } : {})
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(OK, '05:34:55.850'), beacon([]))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hook)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(CONTINUE, '05:36:34.891'), beacon([copyContinue]))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hook)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hook)
      vi.setSystemTime(at('05:46:51.100'))
      prompts = reader.read(done(CONTINUE), beacon([copyContinue]))
      await showAt('05:46:51.200', WHOLE_TURN, prompts, false, [], hook)
      expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
      const run: NonNullable<AgentStatusPromptSource> = {
        ...working(OK_CONTINUE, '05:49:47.000'),
        stateStartedAt: at('05:49:47.000'),
        stateHistory: [...done(CONTINUE).stateHistory!, { state: 'done', prompt: normalizePromptField(CONTINUE), startedAt: TURN_ENDED }]
      }
      vi.setSystemTime(at('05:49:47.100'))
      prompts = reader.read(run, beacon([copyContinue, copyNext]))
      await showAt('05:49:48.000', [...WHOLE_TURN, NEXT_ROW], prompts, true, [], hook)
      await showAt('05:50:06.000', [...WHOLE_TURN, NEXT_ROW, NEXT_REPLY], prompts, false, [], hook)
      expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:52:00.000'))
      prompts = again.read({ ...run, state: 'done', stateStartedAt: at('05:50:05.500') }, beacon([copyContinue, copyNext]))
      await showAt('05:52:00.100', [...WHOLE_TURN, NEXT_ROW, NEXT_REPLY], prompts, false, [], hook)
      await showAt('05:52:01.000', [...WHOLE_TURN, NEXT_ROW, NEXT_REPLY], prompts, false, [], hook)
      expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
      again.unmount()
      unmount()
    })
  }
})
