import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAC_HOST_COMMAND_CLOSE_DELAY_MS, runMacHostCommand } from './run-mac-host-command'

const SECRET = "caffeinate -u -t 2; sleep 1; osascript -e 'keystroke \"hunter2\"'; exit"

function fakeClient(responses: Record<string, unknown>) {
  const calls: { method: string; params: unknown }[] = []
  return {
    calls,
    client: {
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        calls.push({ method, params })
        return (
          responses[method] ?? {
            id: '1',
            ok: true,
            result: { tab: { id: 'tab-9', type: 'terminal' } },
            _meta: { runtimeId: 'r' }
          }
        )
      })
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('running a Mac control on the host', () => {
  it('opens a throwaway terminal in that worktree without stealing the desktop', async () => {
    const { client, calls } = fakeClient({})
    const outcome = await runMacHostCommand({ client, worktreeId: 'wt-1', command: 'pmset displaysleepnow; exit' })
    expect(outcome).toEqual({ ok: true })
    expect(calls[0]).toEqual({
      method: 'session.tabs.createTerminal',
      params: {
        worktree: 'id:wt-1',
        command: 'pmset displaysleepnow; exit',
        activate: false,
        select: false,
        navigation: 'caller'
      }
    })
  })

  it('closes the tab it opened, in case the shell outlives its own exit', async () => {
    const { client, calls } = fakeClient({})
    await runMacHostCommand({ client, worktreeId: 'wt-1', command: 'pmset displaysleepnow; exit' })
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_CLOSE_DELAY_MS)
    expect(calls[1]).toEqual({
      method: 'session.tabs.close',
      params: { worktree: 'id:wt-1', tabId: 'tab-9', reason: 'user' }
    })
  })

  it('reports a refused host without echoing the command back', async () => {
    const { client } = fakeClient({
      'session.tabs.createTerminal': {
        id: '1',
        ok: false,
        error: { code: 'boom', message: 'worktree not found' },
        _meta: { runtimeId: 'r' }
      }
    })
    const outcome = await runMacHostCommand({ client, worktreeId: 'wt-1', command: SECRET })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toBe('worktree not found')
  })

  it('never leaks the command — password and all — through a thrown error', async () => {
    const client = {
      sendRequest: vi.fn(async () => {
        throw new Error(`failed running ${SECRET}`)
      })
    }
    const outcome = await runMacHostCommand({ client, worktreeId: 'wt-1', command: SECRET })
    expect(outcome).toEqual({ ok: false, reason: 'The Mac did not answer.' })
    expect(JSON.stringify(outcome)).not.toContain('hunter2')
  })

  it('still counts as sent when the host answers without a tab to close', async () => {
    const { client, calls } = fakeClient({
      'session.tabs.createTerminal': { id: '1', ok: true, result: {}, _meta: { runtimeId: 'r' } }
    })
    expect(await runMacHostCommand({ client, worktreeId: 'wt-1', command: 'x; exit' })).toEqual({
      ok: true
    })
    await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_CLOSE_DELAY_MS)
    expect(calls).toHaveLength(1)
  })
})
