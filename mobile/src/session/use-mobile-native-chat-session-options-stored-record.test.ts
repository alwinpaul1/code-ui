import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import type * as SessionOptionRecords from '../storage/session-option-records'
import {
  resetMobileNativeChatSessionOptionRecordsForTests,
  useMobileNativeChatSessionOptions,
  type MobileNativeChatSessionOptionsController
} from './use-mobile-native-chat-session-options'

// The read is the real one unless a test makes it throw. It answers every
// failure it knows about (session-option-records.ts), so a throw out of it is
// the unknown one, which used to be an unhandled rejection with no line behind
// it (a half-written record threw out of the merge the same way).
const failure = vi.hoisted(() => ({ read: null as Error | null }))
vi.mock('../storage/session-option-records', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionOptionRecords>()
  return {
    ...actual,
    readSessionOptionRecord: (...args: Parameters<typeof actual.readSessionOptionRecord>) =>
      failure.read ? Promise.reject(failure.read) : actual.readSessionOptionRecord(...args)
  }
})

type HookArgs = Parameters<typeof useMobileNativeChatSessionOptions>[0]

const SCOPE = 'host\u0000worktree\u0000tab'
const KEY = `orca:sessionOptions:${encodeURIComponent(SCOPE)}`
// The in-memory store from vitest.setup.ts, read around the spy below so an
// assertion never waits on a held read or trips a refused one.
const memoryGetItem = AsyncStorage.getItem.bind(AsyncStorage)

// What the store does with this tab's key: answer at once, hold the read open
// until the test lets it go, or refuse it the way a locked database does.
const reads = { refuse: null as Error | null, release: null as (() => void) | null }
let held: Promise<void> | null = null

function holdReads(): void {
  held = new Promise<void>((resolve) => {
    reads.release = () => {
      held = null
      resolve()
    }
  })
}

let renderer: ReactTestRenderer | null = null
let api: MobileNativeChatSessionOptionsController | null = null
let hookArgs: HookArgs
const dispatchCommand = vi.fn<HookArgs['dispatchCommand']>()

function Probe(): null {
  api = useMobileNativeChatSessionOptions(hookArgs)
  return null
}

/** Every microtask chain the in-memory store starts, run out. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount(overrides: Partial<HookArgs> = {}): Promise<void> {
  hookArgs = {
    agent: 'claude',
    scopeKey: SCOPE,
    reportedModel: 'claude-opus-5',
    reportedModelSource: 'live',
    dispatchCommand,
    onAgentPicker: vi.fn(),
    ...overrides
  }
  await act(async () => {
    renderer = create(createElement(Probe))
  })
  await settle()
}

async function update(overrides: Partial<HookArgs>): Promise<void> {
  hookArgs = { ...hookArgs, ...overrides }
  await act(async () => {
    renderer!.update(createElement(Probe))
  })
  await settle()
}

function unmount(): void {
  act(() => {
    renderer?.unmount()
  })
  renderer = null
}

/** The effort the pill shows. */
function effort(): SessionOptionValue | undefined {
  const row = api!.snapshot.find((descriptor) => descriptor.id === 'effort')
  return row?.kind.type === 'select' ? row.kind.currentValue : undefined
}

async function stored(): Promise<unknown> {
  const raw = await memoryGetItem(KEY)
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

function writesToThisTab(): number {
  return vi.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === KEY).length
}

async function store(record: unknown): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(record))
  vi.mocked(AsyncStorage.setItem).mockClear()
}

const claudeHigh = {
  agent: 'claude',
  model: { value: 'opus', source: 'reported' },
  valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
}

beforeEach(async () => {
  resetMobileNativeChatSessionOptionRecordsForTests()
  await AsyncStorage.clear()
  failure.read = null
  reads.refuse = null
  reads.release = null
  held = null
  dispatchCommand.mockReset()
  dispatchCommand.mockResolvedValue('accepted')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(AsyncStorage, 'setItem')
  vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
    if (key === KEY) {
      if (held) {
        await held
      }
      if (reads.refuse) {
        throw reads.refuse
      }
    }
    return memoryGetItem(key)
  })
})

afterEach(() => {
  unmount()
  api = null
  vi.restoreAllMocks()
})

// Effort and toggles are never reported back by the agent, so after Android
// kills the app they come back only from disk. A Claude or Codex tab never
// read them: its snapshot made a live record during render, the restore
// returned early for any scope that already had one, and the first bump (the
// agent reporting its model) wrote that record, holding only the model, over
// the stored one. Every stored pick for every model in the tab was gone.
describe('a Claude or Codex tab reopened after the process died', () => {
  it('restores a stored effort pick for a Claude tab on a cold start', async () => {
    await store(claudeHigh)
    await mount()
    expect(effort()).toBe('high')
    expect(await stored()).toMatchObject({
      agent: 'claude',
      valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
    })
  })

  it('restores a stored effort pick for a Codex tab on a cold start', async () => {
    await store({
      agent: 'codex',
      valuesByModel: { 'gpt-5.5': { effort: { value: 'high', source: 'dispatched' } } }
    })
    await mount({ agent: 'codex', reportedModel: 'gpt-5.5' })
    expect(effort()).toBe('high')
    expect(await stored()).toMatchObject({
      agent: 'codex',
      valuesByModel: { 'gpt-5.5': { effort: { value: 'high', source: 'dispatched' } } }
    })
  })

  // The usual cold start: the disk answers in milliseconds, the agent's model
  // only once the relay is up. The vendored report apply fills a record that
  // had no model with nothing for the reported one, which emptied the pick the
  // restore had just put there.
  it('keeps a restored effort pick when the agent reports its model after the restore', async () => {
    await store(claudeHigh)
    await mount({ reportedModel: null })
    await update({ reportedModel: 'claude-opus-5' })
    expect(effort()).toBe('high')
    expect(await stored()).toMatchObject({
      valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
    })
  })

  it('writes nothing over stored picks before the stored record is read', async () => {
    await store(claudeHigh)
    holdReads()
    // The reported model arrives first and bumps the record.
    await mount()
    expect(writesToThisTab()).toBe(0)
    expect(await stored()).toEqual(claudeHigh)

    reads.release?.()
    await settle()
    expect(effort()).toBe('high')
    // One write once the read has landed: the merged record, not the partial one.
    expect(writesToThisTab()).toBe(1)
    expect(await stored()).toEqual({
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
    })
  })

  it('keeps a pick made while the stored record is being read, and every other stored pick', async () => {
    await store({
      agent: 'claude',
      valuesByModel: {
        opus: { effort: { value: 'high', source: 'dispatched' } },
        sonnet: { effort: { value: 'max', source: 'dispatched' } }
      }
    })
    holdReads()
    await mount()
    await act(async () => {
      await api!.setOption('effort', 'low')
    })
    expect(dispatchCommand).toHaveBeenCalledWith('/effort low')
    expect(writesToThisTab()).toBe(0)

    reads.release?.()
    await settle()
    // The newer pick in memory wins over the stored one for the same model.
    expect(effort()).toBe('low')
    expect(await stored()).toMatchObject({
      valuesByModel: {
        opus: { effort: { value: 'low', source: 'dispatched' } },
        sonnet: { effort: { value: 'max', source: 'dispatched' } }
      }
    })
  })

  it('ignores a stored record another agent left under the tab', async () => {
    await store({ agent: 'codex', valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } } })
    await mount()
    expect(effort()).not.toBe('high')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('restores nothing, and logs nothing, from a stored record with no picks', async () => {
    await store({ agent: 'claude', valuesByModel: {} })
    await mount()
    expect(effort()).not.toBe('high')
    expect(console.warn).not.toHaveBeenCalled()
    expect(await stored()).toEqual({
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: { opus: {} }
    })
  })

  it('saves the first picks of a tab that has nothing stored', async () => {
    await mount()
    await act(async () => {
      await api!.setOption('effort', 'low')
    })
    await settle()
    expect(await stored()).toMatchObject({
      valuesByModel: { opus: { effort: { value: 'low', source: 'dispatched' } } }
    })
  })

  // Only 32 tab records are kept in memory. One pushed out used to stay
  // "restored" for the rest of the run, so coming back to that tab made a
  // fresh record, never read the disk, and wrote the fresh record over it.
  it('restores a tab’s picks after other tabs pushed its record out of memory', async () => {
    await mount()
    await act(async () => {
      await api!.setOption('effort', 'low')
    })
    await settle()
    for (let tab = 0; tab < 40; tab += 1) {
      await update({ scopeKey: `host\u0000worktree\u0000other-${tab}` })
    }
    await update({ scopeKey: SCOPE })
    expect(effort()).toBe('low')
    expect(await stored()).toMatchObject({
      valuesByModel: { opus: { effort: { value: 'low', source: 'dispatched' } } }
    })
  })
})

describe('a chat whose stored option picks cannot be read', () => {
  const locked = (): Error => new Error('database is locked (code 5 SQLITE_BUSY)')

  function warnedLine(): string {
    expect(console.warn).toHaveBeenCalledTimes(1)
    return String(vi.mocked(console.warn).mock.calls[0]?.[0])
  }

  it('does not write over stored picks after a refused read', async () => {
    await store(claudeHigh)
    reads.refuse = locked()
    await mount()
    await act(async () => {
      await api!.setOption('effort', 'low')
    })
    await settle()
    // The pick still works for this run...
    expect(effort()).toBe('low')
    // ...but nothing that could replace what the store would not show us.
    expect(writesToThisTab()).toBe(0)
    expect(await stored()).toEqual(claudeHigh)
    const line = warnedLine()
    expect(line).toContain('[session-options] picks for')
    expect(line).toContain('worktree')
    expect(line).toContain('tab')
    expect(line).toContain('SQLITE_BUSY')
  })

  it('reads again after a refused read and restores then', async () => {
    await store(claudeHigh)
    reads.refuse = locked()
    await mount()
    expect(effort()).not.toBe('high')
    unmount()

    reads.refuse = null
    await mount()
    expect(effort()).toBe('high')
    expect(await stored()).toMatchObject({
      valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
    })
  })

  it('saves a pick made while the read was refused once a later read lands', async () => {
    await store(claudeHigh)
    reads.refuse = locked()
    await mount()
    await act(async () => {
      await api!.setOption('effort', 'low')
    })
    unmount()

    reads.refuse = null
    await mount()
    expect(effort()).toBe('low')
    expect(await stored()).toMatchObject({
      valuesByModel: { opus: { effort: { value: 'low', source: 'dispatched' } } }
    })
  })

  it('says which chat’s picks were not restored, and why, in one line, when the read throws', async () => {
    failure.read = new TypeError('Cannot convert undefined or null to object')
    await mount({ agent: 'amp', reportedModel: null })
    const line = warnedLine()
    expect(line).toContain('worktree')
    expect(line).toContain('tab')
    expect(line).toContain('Cannot convert undefined or null to object')
  })

  it('logs nothing when the restore reads nothing', async () => {
    await mount()
    expect(console.warn).not.toHaveBeenCalled()
  })
})
