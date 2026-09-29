// The cases the tab status alone cannot settle, and the prompt hook's own copy
// of each submission, which can (agent-hud-launch-args.ts; Claude Code tabs
// launched with the hook, `hk=1`). The status carries the pane's last prompt
// cut at 200 characters, and nothing when the pane's prompt did not change;
// the hook's copy carries the words as typed, up to 2,000 bytes, the text row
// they were typed after (`at=`), and a nonce of its own for every submission.
//
// Checked on Claude Code 2.1.284 (2026-09-29, a private tmux server with no
// Orca environment, a hook that logs each event): a prompt typed while a turn
// ran fired UserPromptSubmit at its enqueue, 21 ms after the Enter, and none
// when Claude dequeued it as its own turn after the first one ended. So a
// second copy of the same words is a second submission, never a dequeue.
//
// The report and its records are described in
// mobile-chat-midturn-prompt-after-reply.test.ts.

import { describe, expect, it, vi } from 'vitest'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import {
  at,
  SECOND_SEND,
  EARLIER,
  WRITTEN_BEFORE_SECOND,
  WRITTEN_AFTER_SECOND,
  BEFORE_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  working,
  done,
  statusReader,
  drawn,
  oneLine,
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
/** Over the status's 200 characters: the status carries its first 200. */
const BASE = `${SECOND_SEND} issue, and also please check whether the session list on the account page still shows the ended sessions after a refresh`
/** The user bubbles that carry the long messages' opening words. */
const longBubbles = () =>
  drawn(frames.at(-1)!)
    .filter((row) => row.role === 'user' && row.text.startsWith(oneLine(SECOND_SEND).slice(0, 60)))
    .map((row) => row.text)

describe('a long desk message, with the prompt hook’s copy of it', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, queueBox } = midturnChat(frames, () => agent)

  // W1 of the review of fix/midturn-gaps: the chat closed in the second
  // between the message's echo and the first box read that listed it, and
  // came back more than 30 s later with the message still queued. The chat
  // remembered the status's cut copy from the echo and the box's whole
  // reading from the box, and could not tell them from two messages that
  // share their first 200 characters: drawn beside the box row while it
  // waited, then cut and whole once Claude took it.
  it('draws it once, whole, when the chat closed before the box listed it and came back while it waited', async () => {
    agent = 'claude'
    const long = `${BASE}, first on staging`
    const hook = beaconCopy('71001', long, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(long, '05:36:34.891'), { beacon: [hook] })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    expect(longBubbles()).toHaveLength(1)
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:41:40.000'))
    prompts = again.read(working(long, '05:41:39.000'), { beacon: [hook] })
    await showAt('05:41:40.100', WHOLE_TURN.slice(0, -4), prompts, true, [long], hooked)
    await showAt('05:41:41.000', WHOLE_TURN.slice(0, -4), prompts, true, [long], hooked)
    expect(queueBox()).toEqual([oneLine(long)])
    expect(longBubbles()).toEqual([])
    // Taken mid-turn.
    await showAt('05:42:30.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    await showAt('05:42:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    expect(longBubbles()).toEqual([oneLine(long)])
    again.unmount()
    unmount()
    const last = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = last.read(done(long), { beacon: [hook] })
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false, [], hooked)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false, [], hooked)
    expect(longBubbles()).toEqual([oneLine(long)])
    last.unmount()
    unmount()
  })

  // The limit, pinned. Without the hook's copy (a Codex tab, a Windows host,
  // a Claude tab launched without the hook) the phone holds only the status's
  // 200-character cut and the box's whole reading, and the same inputs are
  // the two messages below. The store merges the two only when the box read
  // them within 30 s of the cut copy (mobile-native-chat-remember-echo.ts), so
  // here the message is drawn cut beside its box row while it waits and cut
  // and whole once Claude takes it: drawn twice, never lost. What would
  // settle it is the words past the field, which only the hook carries.
  for (const kind of ['claude', 'codex'] as const) {
    it(`still draws it cut and whole with no hook copy of it, on a ${kind === 'claude' ? 'Claude Code tab launched without the hook' : 'Codex tab'} (a limit)`, async () => {
      agent = kind
      const long = `${BASE}, first on staging`
      const cut = oneLine(normalizePromptField(long))
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(long, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:41:40.000'))
      prompts = again.read(working(long, '05:41:39.000'))
      await showAt('05:41:40.100', WHOLE_TURN.slice(0, -4), prompts, true, [long])
      await showAt('05:41:41.000', WHOLE_TURN.slice(0, -4), prompts, true, [long])
      expect(longBubbles()).toEqual([cut])
      await showAt('05:42:30.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
      await showAt('05:42:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
      expect(longBubbles()).toEqual([cut, oneLine(long)])
      again.unmount()
      unmount()
    })
  }

  // The case W1's merge window was kept for: two long messages that share
  // their first 200 characters, the first taken at once, the second queued
  // minutes later. The status carries one cut copy of the two; the hook
  // carries each whole.
  it('draws both of two long desk messages that share their first 200 characters, each whole, while open and after the chat comes back', async () => {
    agent = 'claude'
    const one = `${BASE}, first on staging`
    const two = `${BASE}, then on production with the new flag`
    const hookOne = beaconCopy('71002', one, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const hookTwo = beaconCopy('71003', two, WRITTEN_AFTER_SECOND, '05:39:29.100')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(one, '05:36:34.891'), { beacon: [hookOne] })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts, true, [], hooked)
    vi.setSystemTime(at('05:39:30.000'))
    prompts = reader.read(working(two, '05:39:29.000'), { beacon: [hookOne, hookTwo] })
    await showAt('05:39:30.100', WHOLE_TURN.slice(0, -4), prompts, true, [two], hooked)
    await showAt('05:39:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [two], hooked)
    await showAt('05:40:00.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    expect(longBubbles()).toEqual([oneLine(one), oneLine(two)])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = again.read(done(two), { beacon: [hookOne, hookTwo] })
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false, [], hooked)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false, [], hooked)
    expect(longBubbles()).toEqual([oneLine(one), oneLine(two)])
    again.unmount()
    unmount()
  })
})
