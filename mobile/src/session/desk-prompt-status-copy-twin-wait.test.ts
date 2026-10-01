import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'
import { useDesktopPromptEchoes } from './use-desktop-prompt-echoes'
import { useWithoutScheduledTicks } from './scheduled-prompt-ticks'
import { STAND_IN_TWIN_WAIT_MS } from './desk-prompt-stand-in-place'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

// A mid-turn loop tick on a tab with the prompt hook reaches the phone twice:
// Orca's status copy first, then the hook's beacon copy, which alone carries
// the `sc=1` mark (agent-hud-prompt-hook-scheduled.test.ts). Until that mark
// arrived the status copy drew as a user bubble, and vanished a moment later:
// a flash of the loop's words every tick (2026-10-01). On a tab with the hook,
// a status copy the chat watched arrive waits for its hook twin for as long as
// a copy found after Orca's stand-in does (STAND_IN_TWIN_WAIT_MS), and is drawn
// after that if the twin never comes.

const SESSION = 'sess-1'
const TICK = 'Check the build host and report in one line.'
const T0 = Date.parse('2026-10-01T02:21:49.000Z')

const reply = (id: string, timestamp: number): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: 'working' }],
  timestamp,
  source: 'transcript'
})
const rows = [reply('r1', T0 - 60_000)]

/** Orca's status copy, as agent-status-prompts.ts makes it for a copy the chat watched arrive. */
const statusCopy = (text: string, extra: Partial<DesktopPrompt> = {}): DesktopPrompt => ({
  nonce: `${STATUS_PROMPT_NONCE_PREFIX}${SESSION}:${T0}:0`,
  text,
  at: T0,
  seenAt: Date.now(),
  ...extra
})
const hookCopy = (text: string, extra: Partial<DesktopPrompt> = {}): DesktopPrompt => ({
  nonce: '4101',
  text,
  anchorId: 'r1',
  typedAt: Math.floor(T0 / 1000) * 1000,
  seenAt: Date.now(),
  ...extra
})

type Props = { status: readonly DesktopPrompt[]; beacon: readonly DesktopPrompt[]; promptHook: boolean; messages?: readonly NativeChatMessage[] }
let latest: readonly MobileNativeChatPendingMessage[] = []

function Probe({ status, beacon, promptHook, messages = rows }: Props) {
  const merged = mergeDesktopPrompts(status, beacon)
  const kept = useWithoutScheduledTicks(merged, messages, SESSION)
  latest = useDesktopPromptEchoes(kept, messages, messages, false, true, promptHook)
  return null
}

describe('a status copy of a prompt, on a tab with the prompt hook', () => {
  let renderer: ReactTestRenderer | null = null
  const drawn: string[][] = []
  const render = (props: Props) => {
    act(() => {
      if (renderer === null) {
        renderer = create(createElement(Probe, props))
      } else {
        renderer.update(createElement(Probe, props))
      }
    })
    drawn.push(latest.map((echo) => echo.text))
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    drawn.length = 0
    latest = []
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('does not flash a tick whose hook mark arrives a second after the status copy', () => {
    render({ status: [statusCopy(TICK)], beacon: [], promptHook: true })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    render({ status: [statusCopy(TICK)], beacon: [hookCopy(TICK, { scheduled: true })], promptHook: true })
    act(() => {
      vi.advanceTimersByTime(STAND_IN_TWIN_WAIT_MS * 2)
    })
    render({ status: [statusCopy(TICK)], beacon: [hookCopy(TICK, { scheduled: true })], promptHook: true })
    expect(drawn.flat()).toEqual([])
  })

  it('draws a status copy whose twin never comes, after the wait', () => {
    render({ status: [statusCopy(TICK)], beacon: [], promptHook: true })
    expect(latest).toEqual([])
    // No new reading: only the timer the hook armed brings the copy back.
    act(() => {
      vi.advanceTimersByTime(STAND_IN_TWIN_WAIT_MS + 50)
    })
    expect(latest.map((echo) => echo.text)).toEqual([TICK])
  })

  it('draws a typed message once its hook twin arrives unmarked', () => {
    render({ status: [statusCopy('and keep the old table')], beacon: [], promptHook: true })
    expect(latest).toEqual([])
    act(() => {
      vi.advanceTimersByTime(800)
    })
    render({ status: [statusCopy('and keep the old table')], beacon: [hookCopy('and keep the old table')], promptHook: true })
    expect(latest.map((echo) => echo.text)).toEqual(['and keep the old table'])
  })

  it('draws a beacon copy at once on a host with no status', () => {
    render({ status: [], beacon: [hookCopy('typed at the desk')], promptHook: true })
    expect(latest.map((echo) => echo.text)).toEqual(['typed at the desk'])
  })

  it('draws it at once on a tab without the hook', () => {
    render({ status: [statusCopy('typed at the desk')], beacon: [], promptHook: false })
    expect(latest.map((echo) => echo.text)).toEqual(['typed at the desk'])
  })

  it('draws a copy the chat found, not watched arriving, at once', () => {
    render({ status: [statusCopy('typed before the chat opened', { atStateStart: true })], beacon: [], promptHook: true })
    expect(latest.map((echo) => echo.text)).toEqual(['typed before the chat opened'])
  })

  it('stops waiting when the status copy goes away', () => {
    render({ status: [statusCopy(TICK)], beacon: [], promptHook: true })
    render({ status: [], beacon: [], promptHook: true })
    act(() => {
      vi.advanceTimersByTime(STAND_IN_TWIN_WAIT_MS * 2)
    })
    expect(latest).toEqual([])
  })

  it('degenerate: nothing to wait for with no prompts and no rows', () => {
    render({ status: [], beacon: [], promptHook: true, messages: [] })
    act(() => {
      vi.advanceTimersByTime(STAND_IN_TWIN_WAIT_MS * 2)
    })
    expect(latest).toEqual([])
  })

  it('degenerate: a lone status copy over no rows is drawn after the wait', () => {
    render({ status: [statusCopy(TICK)], beacon: [], promptHook: true, messages: [] })
    expect(latest).toEqual([])
    act(() => {
      vi.advanceTimersByTime(STAND_IN_TWIN_WAIT_MS + 50)
    })
    expect(latest.map((echo) => echo.text)).toEqual([TICK])
  })
})
