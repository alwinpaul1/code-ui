import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  clearMobileSessionOptionRecordsForTests,
  useMobileNativeChatSessionOptions,
  type MobileNativeChatSessionOptionsController
} from './use-mobile-native-chat-session-options'
import { MODEL_PICK_GRACE_MS } from './mobile-native-chat-model-report-authority'

type HookArgs = Parameters<typeof useMobileNativeChatSessionOptions>[0]

describe('useMobileNativeChatSessionOptions', () => {
  let renderer: ReactTestRenderer | null = null
  let api: MobileNativeChatSessionOptionsController | null = null
  let hookArgs: HookArgs
  const dispatchCommand = vi.fn<HookArgs['dispatchCommand']>()
  const onAgentPicker = vi.fn()

  function Probe(): null {
    api = useMobileNativeChatSessionOptions(hookArgs)
    return null
  }

  const mount = (overrides: Partial<HookArgs> = {}): void => {
    hookArgs = {
      agent: 'claude',
      scopeKey: 'host\0worktree\0tab',
      reportedModel: null,
      dispatchCommand,
      onAgentPicker,
      ...overrides
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  const update = (overrides: Partial<HookArgs>): void => {
    hookArgs = { ...hookArgs, ...overrides }
    act(() => {
      renderer!.update(createElement(Probe))
    })
  }

  beforeEach(() => {
    clearMobileSessionOptionRecordsForTests()
    dispatchCommand.mockReset()
    dispatchCommand.mockResolvedValue('accepted')
    onAgentPicker.mockReset()
  })
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    api = null
  })

  it('serves the shared catalog snapshot for the agent', () => {
    mount()
    expect(api!.snapshot[0]).toMatchObject({ id: 'model', category: 'model' })
    expect(api!.snapshot[0]!.kind).toMatchObject({ type: 'select' })
  })

  it('returns an empty snapshot for agents without a catalog', () => {
    mount({ agent: 'amp' })
    expect(api!.snapshot).toEqual([])
  })

  it('does not expose catalog-backed agents outside the Claude and Codex scope', () => {
    mount({ agent: 'gemini' })
    expect(api!.snapshot).toEqual([])
  })

  it('applies a model pick through the catalog modelApply command', async () => {
    mount()
    let applied: boolean | undefined
    await act(async () => {
      applied = await api!.setOption('model', 'opus')
    })
    expect(applied).toBe(true)
    expect(dispatchCommand).toHaveBeenCalledWith('/model opus')
    const model = api!.snapshot[0]!
    expect(model).toMatchObject({ valueSource: 'dispatched' })
    expect(model.kind).toMatchObject({ currentValue: 'opus' })
  })

  it('keeps tracked truth when the dispatch is rejected', async () => {
    dispatchCommand.mockResolvedValue('rejected')
    mount()
    let applied: boolean | undefined
    await act(async () => {
      applied = await api!.setOption('model', 'opus')
    })
    expect(applied).toBe(false)
    expect(api!.snapshot[0]).toMatchObject({ valueSource: 'unknown' })
  })

  it('types the Codex picker command and switches to the terminal', async () => {
    mount({ agent: 'codex' })
    expect(api!.snapshot[0]?.action).toEqual({ type: 'agent-picker' })
    await act(async () => {
      await api!.invokeAction('model')
    })
    expect(dispatchCommand).toHaveBeenCalledWith('/model', { delivery: 'type' })
    expect(onAgentPicker).toHaveBeenCalledOnce()
  })

  it('types the Codex effort picker command', async () => {
    mount({ agent: 'codex', reportedModel: 'gpt-5.5' })
    await act(async () => {
      await api!.invokeAction('effort')
    })
    expect(dispatchCommand).toHaveBeenCalledWith('/model', { delivery: 'type' })
    expect(onAgentPicker).toHaveBeenCalledOnce()
  })

  it('seeds the current model from a hook-reported provider model', () => {
    mount({ reportedModel: 'claude-sonnet-5' })
    const model = api!.snapshot[0]!
    expect(model).toMatchObject({ valueSource: 'reported' })
    expect(model.kind).toMatchObject({ currentValue: 'sonnet' })
  })

  it('tracks typed commands via recordCommand', () => {
    mount()
    act(() => {
      api!.recordCommand('/model haiku')
    })
    expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'haiku' })
    expect(api!.snapshot[0]).toMatchObject({ valueSource: 'dispatched' })
  })

  it('applies an option under the tracked model and scopes it to that model', async () => {
    mount({ reportedModel: 'claude-sonnet-5' })
    await act(async () => {
      await api!.setOption('effort', 'low')
    })
    expect(dispatchCommand).toHaveBeenCalledWith('/effort low')
    const effort = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
    expect(effort).toMatchObject({ valueSource: 'dispatched' })
    expect(effort!.kind).toMatchObject({ currentValue: 'low' })
  })

  it('does not file an option under a model that changed mid-dispatch', async () => {
    const resolvers: ((outcome: MobileNativeChatSendOutcome) => void)[] = []
    dispatchCommand.mockImplementation(
      () => new Promise<MobileNativeChatSendOutcome>((resolve) => resolvers.push(resolve))
    )
    mount({ reportedModel: 'claude-sonnet-5' })
    let applied!: Promise<boolean>
    await act(async () => {
      applied = api!.setOption('effort', 'low')
      await Promise.resolve()
    })
    // A report lands while `/effort low` is still in flight and moves the model.
    update({ reportedModel: 'claude-opus-5' })
    await act(async () => {
      resolvers[0]!('accepted')
      await applied
    })
    // The effort must not be recorded against Opus — it was sent for Sonnet.
    const effort = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
    expect(effort?.kind).not.toMatchObject({ currentValue: 'low' })
  })

  // 2026-09-12 on the phone: Opus at extra high, switch to Fable from the
  // pill, pick Medium in the drawer that follows — and the pill kept reading
  // the old level. Two flows, both must land on the pick.
  it('shows the effort picked right after a model switch', async () => {
    mount({ reportedModel: 'claude-opus-5', reportedEffort: 'xhigh' })
    await act(async () => {
      await api!.setOption('model', 'fable')
    })
    await act(async () => {
      await api!.setOption('effort', 'medium')
    })
    expect(dispatchCommand).toHaveBeenLastCalledWith('/effort medium')
    const effort = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
    expect(effort!.kind).toMatchObject({ currentValue: 'medium' })
  })

  it('does not let the status line\'s pre-pick effort, arriving late, revert the pick', async () => {
    mount({ reportedModel: 'claude-opus-5', reportedEffort: 'xhigh' })
    await act(async () => {
      await api!.setOption('model', 'fable')
    })
    await act(async () => {
      await api!.setOption('effort', 'medium')
    })
    // The status line repaints for the model switch a beat later, still
    // carrying the effort from before `/effort medium` was sent.
    update({ reportedModel: 'claude-fable-5-1', reportedEffort: 'xhigh' })
    let effort = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
    expect(effort!.kind).toMatchObject({ currentValue: 'medium' })
    // Once it repaints with the pick, the report and the pick agree.
    update({ reportedModel: 'claude-fable-5-1', reportedEffort: 'medium' })
    effort = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
    expect(effort!.kind).toMatchObject({ currentValue: 'medium' })
    // And a genuinely new effort from the agent later still wins.
    update({ reportedModel: 'claude-fable-5-1', reportedEffort: 'high' })
    effort = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
    expect(effort!.kind).toMatchObject({ currentValue: 'high' })
  })

  it('does not revive a stale session-start report over a newer local pick', async () => {
    mount({ reportedModel: 'claude-sonnet-5' })
    await act(async () => {
      await api!.setOption('model', 'opus')
    })
    expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'opus' })
    // Leaving the tab and returning re-delivers the SAME session-start report,
    // which cannot have observed the `/model opus` sent after it.
    update({ scopeKey: 'host\0worktree\0other' })
    update({ scopeKey: 'host\0worktree\0tab' })
    expect(api!.snapshot[0]).toMatchObject({ valueSource: 'dispatched' })
    expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'opus' })
  })

  // 2026-09-15, the reported symptom, end to end: "it shows sometimes wrong
  // model". The user picks a model in the sheet, Claude declines the switch —
  // it confirms a cached-history change, and dismissing that leaves the model
  // alone — and the agent goes on being what it was. Its live report therefore
  // never CHANGES, and the old rule only applied a report that changed, so the
  // pill kept stating a model the session had never run. It did not heal on
  // remount either, because the latch outlives the component.
  it('gives up a pick the agent never honoured, and says what the agent says', async () => {
    vi.useFakeTimers()
    try {
      mount({ reportedModel: 'claude-opus-5', reportedEffort: 'high', reportedModelSource: 'live' })
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'opus' })
      await act(async () => {
        await api!.setOption('model', 'fable')
      })
      // Optimistic straight away, so the tap feels answered.
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'fable' })
      // The agent repaints, still Opus: the same report as before the pick.
      update({ reportedModel: 'claude-opus-5' })
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'fable' })
      // Once the grace lapses the agent's own word wins and the pill corrects.
      await act(async () => {
        vi.advanceTimersByTime(MODEL_PICK_GRACE_MS + 50)
      })
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'opus' })
      expect(api!.snapshot[0]).toMatchObject({ valueSource: 'reported' })
    } finally {
      vi.useRealTimers()
    }
  })

  // 2026-09-15, found by a regression probe: the wake timer was re-armed for a
  // FULL grace every time the effect re-ran, and it re-runs on `version`, which
  // every unrelated record write bumps. So a user changing effort, or typing a
  // command, every few seconds starved it — the timer never fired and the pill
  // stayed on a pick the agent had refused, indefinitely. It must be scheduled
  // for the time remaining on the pick, not a fresh grace.
  it('corrects the pill even while unrelated writes keep bumping the record', async () => {
    vi.useFakeTimers()
    try {
      mount({ reportedModel: 'claude-opus-5', reportedEffort: 'high', reportedModelSource: 'live' })
      await act(async () => {
        await api!.setOption('model', 'fable')
      })
      update({ reportedModel: 'claude-opus-5', reportedEffort: 'high', reportedModelSource: 'live' })
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'fable' })
      // Unrelated activity well inside the grace, repeatedly, past its end.
      for (let round = 0; round < 6; round += 1) {
        await act(async () => {
          vi.advanceTimersByTime(3000)
        })
        await act(async () => {
          await api!.setOption('effort', round % 2 === 0 ? 'medium' : 'low')
        })
      }
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'opus' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a pick the agent does honour', async () => {
    vi.useFakeTimers()
    try {
      mount({ reportedModel: 'claude-opus-5', reportedEffort: 'high', reportedModelSource: 'live' })
      await act(async () => {
        await api!.setOption('model', 'fable')
      })
      update({ reportedModel: 'claude-fable-5-1' })
      await act(async () => {
        vi.advanceTimersByTime(MODEL_PICK_GRACE_MS + 50)
      })
      expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'fable' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('still lets a genuinely new report supersede a local pick', async () => {
    mount({ reportedModel: 'claude-sonnet-5' })
    await act(async () => {
      await api!.setOption('model', 'opus')
    })
    update({ reportedModel: 'claude-haiku-4-5' })
    expect(api!.snapshot[0]).toMatchObject({ valueSource: 'reported' })
    expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'haiku' })
  })

  it('keeps the live tab’s tracked model when other tabs overflow the record cap', async () => {
    mount()
    await act(async () => {
      await api!.setOption('model', 'opus')
    })
    // Far more scopes than the cap, revisiting the live tab in between the way a
    // chat↔terminal flip does — insertion-order eviction would shed it.
    for (let index = 0; index < 40; index += 1) {
      update({ scopeKey: `host\0worktree\0overflow-${index}` })
      update({ scopeKey: 'host\0worktree\0tab' })
    }
    expect(api!.snapshot[0]).toMatchObject({ valueSource: 'dispatched' })
    expect(api!.snapshot[0]!.kind).toMatchObject({ currentValue: 'opus' })
  })

  it('keeps the latest queued operation pending until it settles', async () => {
    const resolvers: ((outcome: MobileNativeChatSendOutcome) => void)[] = []
    dispatchCommand.mockImplementation(
      () =>
        new Promise<MobileNativeChatSendOutcome>((resolve) => {
          resolvers.push(resolve)
        })
    )
    mount({ reportedModel: 'claude-sonnet-5' })
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    await act(async () => {
      first = api!.setOption('effort', 'low')
      second = api!.setOption('model', 'opus')
      await Promise.resolve()
    })
    expect(api!.pendingId).toBe('model')
    await act(async () => {
      resolvers[0]!('accepted')
      await Promise.resolve()
    })
    expect(dispatchCommand).toHaveBeenCalledTimes(2)
    expect(api!.pendingId).toBe('model')
    await act(async () => {
      resolvers[1]!('accepted')
      await Promise.all([first, second])
    })
    expect(api!.pendingId).toBeNull()
  })

  it('does not dispatch a queued option into a newly active tab', async () => {
    let resolveFirst!: (outcome: MobileNativeChatSendOutcome) => void
    dispatchCommand.mockImplementationOnce(
      () =>
        new Promise<MobileNativeChatSendOutcome>((resolve) => {
          resolveFirst = resolve
        })
    )
    mount({ reportedModel: 'claude-sonnet-5' })
    let first!: Promise<boolean>
    let queued!: Promise<boolean>
    await act(async () => {
      first = api!.setOption('effort', 'low')
      queued = api!.setOption('model', 'opus')
      await Promise.resolve()
    })
    update({ scopeKey: 'host\0worktree\0other-tab' })
    await act(async () => {
      resolveFirst('accepted')
      await first
    })
    await expect(queued).resolves.toBe(false)
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch queued work after unmount', async () => {
    let resolveFirst!: (outcome: MobileNativeChatSendOutcome) => void
    dispatchCommand.mockImplementationOnce(
      () =>
        new Promise<MobileNativeChatSendOutcome>((resolve) => {
          resolveFirst = resolve
        })
    )
    mount({ reportedModel: 'claude-sonnet-5' })
    let first!: Promise<boolean>
    let queued!: Promise<boolean>
    await act(async () => {
      first = api!.setOption('effort', 'low')
      queued = api!.setOption('model', 'opus')
      await Promise.resolve()
    })
    act(() => {
      renderer!.unmount()
    })
    renderer = null
    resolveFirst('accepted')
    await expect(first).resolves.toBe(true)
    await expect(queued).resolves.toBe(false)
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
  })
})
