import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNKNOWN_MAC_HOST_STATE } from './mac-host-state'
import {
  MAC_HOST_STATE_PROBE_INTERVAL_MS,
  MAC_HOST_STATE_PROBE_TIMEOUT_MS,
  WINDOWS_HOST_STATE_PROBE_TIMEOUT_MS,
  probeMacHostState
} from './probe-mac-host-state'
import { WINDOWS_HOST_STATE_PROBE_COMMAND } from './windows-host-state'

function okResponse(result: unknown) {
  return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
}

function fakeClient(screens: string[][]) {
  const calls: { method: string; params: unknown }[] = []
  let read = 0
  const client = {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (method === 'session.tabs.createTerminal') {
        return okResponse({ tab: { id: 'tab-9', type: 'terminal', terminal: 'term-9' } })
      }
      if (method === 'terminal.read') {
        const lines = screens[read] ?? []
        read += 1
        return okResponse({ terminal: { lines } })
      }
      return okResponse({})
    })
  }
  return { client, calls, methods: () => calls.map((call) => call.method) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function runProbe(screens: string[][]) {
  const fake = fakeClient(screens)
  const pending = probeMacHostState({ client: fake.client, worktreeId: 'wt-1' })
  await vi.advanceTimersByTimeAsync(MAC_HOST_STATE_PROBE_TIMEOUT_MS + MAC_HOST_STATE_PROBE_INTERVAL_MS)
  return { state: await pending, ...fake }
}

describe('asking the Mac what state it is in', () => {
  it('keeps reading the screen until the marker is painted', async () => {
    const { state, calls, methods } = await runProbe([
      [],
      ['still starting up'],
      ['CUIMAC lock=1 mute=true display=off end']
    ])
    expect(state).toEqual({ lock: 'locked', display: 'off', mute: 'muted' })
    expect(calls[0]?.method).toBe('session.tabs.createTerminal')
    expect(calls[1]).toEqual({
      method: 'terminal.read',
      params: { terminal: 'term-9', screen: true }
    })
    // Three reads and then it stops — no polling on after the answer arrives.
    expect(methods().filter((method) => method === 'terminal.read')).toHaveLength(3)
  })

  it('closes the throwaway tab once it has its answer', async () => {
    const { calls } = await runProbe([['CUIMAC lock=0 mute=false display=on end']])
    expect(calls.at(-1)).toEqual({
      method: 'session.tabs.close',
      params: { worktree: 'id:wt-1', tabId: 'tab-9', reason: 'user' }
    })
  })

  // 2026-09-26: the poll waited 400 ms after every read, so an answer painted just
  // after one read sat on the screen for most of half a second before the phone
  // looked again, on every open of the sheet.
  it('sees an answer painted between two reads within a fifth of a second', async () => {
    let paintedAt: number | null = null
    const start = Date.now()
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'session.tabs.createTerminal') {
          return okResponse({ tab: { id: 'tab-9', type: 'terminal', terminal: 'term-9' } })
        }
        if (method === 'terminal.read') {
          // The Mac paints its answer 10 ms after the first read.
          paintedAt ??= Date.now() + 10
          const lines = Date.now() >= paintedAt ? ['CUIMAC lock=0 mute=false display=on end'] : []
          return okResponse({ terminal: { lines } })
        }
        return okResponse({})
      })
    }
    let answeredAt: number | null = null
    void probeMacHostState({ client, worktreeId: 'wt-1' }).then(() => {
      answeredAt = Date.now()
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(answeredAt).not.toBeNull()
    expect(answeredAt! - (paintedAt ?? start)).toBeLessThanOrEqual(200)
  })

  it('gives up as unknown rather than waiting forever', async () => {
    const { state, methods } = await runProbe([])
    expect(state).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(methods()).toContain('session.tabs.close')
  })

  it('closes the tab even when the Mac never answers', async () => {
    const { calls } = await runProbe([['nothing here']])
    expect(calls.at(-1)?.method).toBe('session.tabs.close')
  })

  it('reports unknown when the host will not open a terminal at all', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        id: '1',
        ok: false as const,
        error: { code: 'nope', message: 'no worktree' },
        _meta: { runtimeId: 'r' }
      }))
    }
    const pending = probeMacHostState({ client, worktreeId: 'wt-1' })
    await vi.advanceTimersByTimeAsync(MAC_HOST_STATE_PROBE_TIMEOUT_MS)
    expect(await pending).toEqual(UNKNOWN_MAC_HOST_STATE)
  })

  it('reports unknown when the link throws instead of answering', async () => {
    const client = {
      sendRequest: vi.fn(async () => {
        throw new Error('socket gone')
      })
    }
    const pending = probeMacHostState({ client, worktreeId: 'wt-1' })
    await vi.advanceTimersByTimeAsync(MAC_HOST_STATE_PROBE_TIMEOUT_MS)
    expect(await pending).toEqual(UNKNOWN_MAC_HOST_STATE)
  })
})

describe('asking a Windows PC what state it is in', () => {
  async function runWindowsProbe(screens: string[][]) {
    const fake = fakeClient(screens)
    const pending = probeMacHostState({ client: fake.client, worktreeId: 'wt-1', platform: 'win32' })
    await vi.advanceTimersByTimeAsync(WINDOWS_HOST_STATE_PROBE_TIMEOUT_MS + MAC_HOST_STATE_PROBE_INTERVAL_MS)
    return { state: await pending, ...fake }
  }

  it('runs the Windows probe, not the Mac one, and reads its marker', async () => {
    const { state, calls } = await runWindowsProbe([[], ['CUIWIN mute=false display=off standby=classic']])
    expect(calls[0]?.params).toMatchObject({ command: WINDOWS_HOST_STATE_PROBE_COMMAND })
    expect(state).toEqual({ lock: 'unknown', display: 'off', mute: 'unmuted' })
  })

  // The Windows marker carries no lock, so a rule that waited for a lock answer
  // before ending the watch would hold the display and mute rows for all 15 s.
  it('answers as soon as the PC has said display and mute, with no lock to wait for', async () => {
    const { state, methods } = await runWindowsProbe([[], ['CUIWIN mute=true display=on standby=classic'], ['never read']])
    expect(state).toEqual({ lock: 'unknown', display: 'on', mute: 'muted' })
    expect(methods().filter((method) => method === 'terminal.read')).toHaveLength(2)
  })

  it('does not take a Mac marker for a Windows answer', async () => {
    const { state } = await runWindowsProbe([['CUIMAC lock=1 mute=true display=off end']])
    expect(state).toEqual(UNKNOWN_MAC_HOST_STATE)
  })

  it('waits longer than the Mac, for a cold powershell start', async () => {
    // A marker painted after the Mac's budget but inside the Windows one still counts.
    const reads = Math.floor(MAC_HOST_STATE_PROBE_TIMEOUT_MS / MAC_HOST_STATE_PROBE_INTERVAL_MS) + 2
    const screens: string[][] = [...Array.from({ length: reads }, () => []), ['CUIWIN mute=true display=unknown standby=classic']]
    const { state } = await runWindowsProbe(screens)
    expect(state).toEqual({ lock: 'unknown', display: 'unknown', mute: 'muted' })
  })
})
