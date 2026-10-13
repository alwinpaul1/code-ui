// An effort pick is a request until the agent states it (native-chat-effort-pick.ts).
//
// The queue screen is fixtures/queued-tap-recall-2.1.296-0.153.4's capture of
// Claude Code 2.1.296 working with one message queued (`tmux capture-pane`, the
// user's own setup), read by the HUD's own queue reader. Only the queued words are
// swapped for `/effort high`, so that row is MODELLED: 2.1.296 itself runs
// `/effort` mid-turn (`immediate: true`), and the 2.1.206 transcript that showed a
// queued `/effort` holds no screen. The working screen with no queue is the lead of
// fixtures/claude-busy-lead-tasks-2.1.296, blank rows dropped as Orca's read does.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { busyScreen } from './fixtures/claude-busy-lead-tasks-2.1.296'
import { CLAUDE_ONE_QUEUED_2_1_296, CLAUDE_QUEUED_TEXT } from './fixtures/queued-tap-recall-2.1.296-0.153.4'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'
import {
  clearEffortPicksForTests,
  EFFORT_PICK_CONFIRM_MS,
  effortPickGivenUpMessage,
  judgeEffortPick,
  type EffortPick
} from './native-chat-effort-pick'
import {
  clearMobileSessionOptionRecordsForTests,
  useMobileNativeChatSessionOptions,
  type MobileNativeChatSessionOptionsController
} from './use-mobile-native-chat-session-options'

const BUSY = busyScreen('screen-busy-lead-mid.txt', { dropBlank: true })
const PLACEHOLDER = 'Press up to edit queued messages'

/** What the HUD reads out of the queue box of a screen with `words` queued. */
function queuedOnScreen(words: string): string[] {
  const screen = CLAUDE_ONE_QUEUED_2_1_296.map((row) => row.replace(CLAUDE_QUEUED_TEXT, words))
  return queueBoxReadFromScreen(screen, 'claude', PLACEHOLDER).entries
}

const pick = (at = 0): EffortPick => ({ value: 'high', at })

describe('judging an effort pick against what the agent states', () => {
  it('confirms it the moment the agent states the level, whatever its case', () => {
    expect(judgeEffortPick(pick(), { reportedEffort: 'HIGH', queuedMessages: [], now: 1 })).toEqual({
      kind: 'confirmed',
      value: 'high'
    })
  })

  it('waits inside the window while the agent still states the old level', () => {
    const verdict = judgeEffortPick(pick(), { reportedEffort: 'medium', queuedMessages: [], now: 4_000 })
    expect(verdict).toEqual({ kind: 'pending', value: 'high', queued: false, remainingMs: EFFORT_PICK_CONFIRM_MS - 4_000 })
  })

  it('gives it up at the end of the window, naming both levels', () => {
    const verdict = judgeEffortPick(pick(), {
      reportedEffort: 'medium',
      queuedMessages: [],
      now: EFFORT_PICK_CONFIRM_MS
    })
    expect(verdict).toEqual({
      kind: 'given-up',
      value: 'high',
      reported: 'medium',
      message: 'Effort is still Medium: the agent did not take High. Try again.'
    })
  })

  it('says the change is unconfirmed, not refused, when the agent states no effort at all', () => {
    expect(effortPickGivenUpMessage('xhigh', null)).toBe(
      'Sent Extra, but the agent has not said its effort, so the change is not confirmed.'
    )
  })

  it('reads a queued /effort off the busy screen and holds the window open while it stays there', () => {
    const queued = queuedOnScreen('/effort high')
    expect(queued).toEqual(['/effort high'])
    const waiting = pick()
    const late = EFFORT_PICK_CONFIRM_MS * 3
    expect(judgeEffortPick(waiting, { reportedEffort: 'medium', queuedMessages: queued, now: late })).toMatchObject({
      kind: 'pending',
      queued: true
    })
    // Once the box no longer shows it, the window runs from the last sighting.
    expect(judgeEffortPick(waiting, { reportedEffort: 'medium', queuedMessages: [], now: late + 1 })).toMatchObject({
      kind: 'pending',
      queued: false
    })
    expect(
      judgeEffortPick(waiting, { reportedEffort: 'medium', queuedMessages: [], now: late + EFFORT_PICK_CONFIRM_MS })
    ).toMatchObject({ kind: 'given-up' })
  })

  it('does not take another queued message for the pick', () => {
    for (const words of ['/effort low', 'also set effort high']) {
      const queued = queuedOnScreen(words)
      expect(queued).toEqual([words])
      expect(judgeEffortPick(pick(), { reportedEffort: 'medium', queuedMessages: queued, now: 1 })).toMatchObject({
        queued: false
      })
    }
  })

  it('sees no queue on the busy screen with nothing queued, or on an empty one', () => {
    expect(queueBoxReadFromScreen(BUSY, 'claude', PLACEHOLDER).entries).toEqual([])
    expect(judgeEffortPick(pick(), { reportedEffort: null, queuedMessages: [], now: 1 })).toMatchObject({
      kind: 'pending',
      queued: false
    })
  })
})

// Codex picks effort in its own `/model` picker (codex-picker-apply.ts), which
// reports success only once its footer names the pair. The same rule holds: the
// sheet waits for Codex's statement, and a pick the picker could not make leaves
// nothing waiting.
describe('a Codex effort pick', () => {
  type HookArgs = Parameters<typeof useMobileNativeChatSessionOptions>[0]
  let renderer: ReactTestRenderer | null = null
  let api: MobileNativeChatSessionOptionsController | null = null
  let hookArgs: HookArgs
  const applyOverride = vi.fn<NonNullable<HookArgs['applyOverride']>>()
  const readBack = vi.fn()

  function Probe(): null {
    api = useMobileNativeChatSessionOptions(hookArgs)
    return null
  }
  const render = (overrides: Partial<HookArgs> = {}): void => {
    hookArgs = { ...hookArgs, ...overrides }
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe))
      } else {
        renderer = create(createElement(Probe))
      }
    })
  }

  beforeEach(() => {
    clearMobileSessionOptionRecordsForTests()
    clearEffortPicksForTests()
    applyOverride.mockReset()
    readBack.mockReset()
    hookArgs = {
      agent: 'codex',
      scopeKey: 'host\0wt\0codex-tab',
      reportedModel: 'gpt-5.6-sol',
      reportedEffort: 'medium',
      reportedModelSource: 'live',
      dispatchCommand: vi.fn(),
      applyOverride,
      readBack
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
  })

  it('waits for the footer to state the level the picker set, then stops waiting', async () => {
    applyOverride.mockResolvedValue(true)
    render()
    await act(async () => {
      await api!.setOption('effort', 'xhigh')
    })
    expect(api!.pendingEffort).toEqual({ value: 'xhigh', queued: false })
    expect(readBack).toHaveBeenCalled()
    render({ reportedEffort: 'xhigh' })
    expect(api!.pendingEffort).toBeNull()
  })

  it('leaves nothing waiting when the picker could not make the pick', async () => {
    applyOverride.mockResolvedValue(false)
    render()
    await act(async () => {
      await api!.setOption('effort', 'xhigh')
    })
    expect(api!.pendingEffort).toBeNull()
  })
})
