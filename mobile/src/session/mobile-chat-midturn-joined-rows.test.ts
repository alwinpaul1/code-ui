// A user row made of several desk messages' words. A prompt typed at the
// desk can be made of earlier messages' words, and that one is no message's
// row but its own. Splitting such a row into its messages, for the row Claude
// writes when it dequeues several queued messages as one (c3844d00), lost a
// message taken mid-turn whichever evidence it asked for (the reviews of
// c3844d00 to 7b3a4685, J1 to J4), and was withdrawn: no row is split. These
// guard that.
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
  WRITTEN_AFTER_SECOND,
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

  // The review of b75a42e6 (J2): "ok continue" typed at the desk later in the
  // same turn, still queued when it ended, and dequeued as the next turn's
  // row: split for "ok" and "continue", the mid-turn message went away while
  // the chat was open.
  it('keeps the mid-turn message when a queued message of those words is dequeued at the turn end, on a Claude Code tab with the hook', async () => {
    agent = 'claude'
    const hook = { promptHook: true }
    const copyOk = beaconCopy('94000', OK, BEFORE_FIRST[0]!.id, '05:34:00.050')
    const copyContinue = beaconCopy('94001', CONTINUE, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const copyNext = beaconCopy('94002', OK_CONTINUE, WRITTEN_AFTER_SECOND, '05:38:10.050')
    const dequeued = user('7d1e0c5a-3b2f-4e61-9a8d-0c4b5e6f7a81', OK_CONTINUE, '05:46:54.300')
    const answer = text('8e2f1d6b-4c3a-4f72-8b9e-1d5c6f7a8b92', '05:47:20.000')
    const all = { beacon: [copyOk, copyContinue, copyNext] }
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(OK, '05:34:55.850'), { beacon: [copyOk] })
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hook)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(CONTINUE, '05:36:34.891'), { beacon: [copyOk, copyContinue] })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hook)
    vi.setSystemTime(at('05:38:10.000'))
    prompts = reader.read(working(OK_CONTINUE, '05:38:09.900'), all)
    await showAt('05:38:10.100', WHOLE_TURN.slice(0, -5), prompts, true, [OK_CONTINUE], hook)
    await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [OK_CONTINUE], hook)
    const run: NonNullable<AgentStatusPromptSource> = {
      ...working(OK_CONTINUE, '05:46:54.400'),
      stateStartedAt: at('05:46:54.200'),
      stateHistory: [...done(OK_CONTINUE).stateHistory!, { state: 'done', prompt: normalizePromptField(OK_CONTINUE), startedAt: TURN_ENDED }]
    }
    vi.setSystemTime(at('05:46:54.800'))
    prompts = reader.read(run, all)
    await showAt('05:46:56.000', [...WHOLE_TURN, dequeued], prompts, true, [], hook)
    await showAt('05:47:21.000', [...WHOLE_TURN, dequeued, answer], prompts, false, [], hook)
    expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:52:00.000'))
    prompts = again.read({ ...run, state: 'done', stateStartedAt: at('05:47:20.500') }, all)
    await showAt('05:52:00.100', [...WHOLE_TURN, dequeued, answer], prompts, false, [], hook)
    await showAt('05:52:01.000', [...WHOLE_TURN, dequeued, answer], prompts, false, [], hook)
    expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
    again.unmount()
    unmount()
  })

  // The review of 7b3a4685 (J4): "ok continue" typed at the desk while the
  // chat was away, no hook copy of it heard; the chat comes back to its row
  // and the status's copy of it. Split, the mid-turn "continue" was lost.
  it('keeps the mid-turn message after the chat comes back to a prompt of those words typed while it was away, on a Claude Code tab with the hook', async () => {
    agent = 'claude'
    const hook = { promptHook: true }
    const copyOk = beaconCopy('98000', OK, BEFORE_FIRST[0]!.id, '05:34:00.050')
    const copyContinue = beaconCopy('98001', CONTINUE, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const heard = { beacon: [copyOk, copyContinue] }
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(OK, '05:34:55.850'), { beacon: [copyOk] })
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hook)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(CONTINUE, '05:36:34.891'), heard)
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hook)
    await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hook)
    expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
    reader.unmount()
    unmount()
    const run: NonNullable<AgentStatusPromptSource> = {
      ...working(OK_CONTINUE, '05:49:47.000'),
      stateStartedAt: at('05:49:47.000'),
      stateHistory: [...done(CONTINUE).stateHistory!, { state: 'done', prompt: normalizePromptField(CONTINUE), startedAt: TURN_ENDED }]
    }
    const again = statusReader()
    vi.setSystemTime(at('05:52:00.000'))
    prompts = again.read({ ...run, state: 'done', stateStartedAt: at('05:50:05.500') }, heard)
    await showAt('05:52:00.100', [...WHOLE_TURN, NEXT_ROW, NEXT_REPLY], prompts, false, [], hook)
    await showAt('05:52:01.000', [...WHOLE_TURN, NEXT_ROW, NEXT_REPLY], prompts, false, [], hook)
    expect(placesOf(CONTINUE)).toEqual([WRITTEN_BEFORE_SECOND])
    again.unmount()
    unmount()
  })
})

