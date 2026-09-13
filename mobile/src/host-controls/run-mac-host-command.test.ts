import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAC_HOST_COMMAND_TIMEOUT_MS, runMacHostCommand } from './run-mac-host-command'
import { THROWAWAY_TERMINAL_POLL_MS } from './throwaway-terminal'

const SECRET = "caffeinate -u -t 2; sleep 1; osascript -e 'keystroke \"hunter2\"'; printf 'CUIDONE %s\\n' ok"
const COMMAND = "pmset displaysleepnow; printf 'CUIDONE %s\\n' ok"

function okResponse(result: unknown) {
  return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
}

function fakeClient(screens: string[][], overrides: Record<string, unknown> = {}) {
  const calls: { method: string; params: unknown }[] = []
  let read = 0
  const client = {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (overrides[method]) {
        return overrides[method]
      }
      if (method === 'session.tabs.createTerminal') {
        return okResponse({ tab: { id: 'tab-9', type: 'terminal', terminal: 'term-9' } })
      }
      if (method === 'terminal.read') {
        const lines = screens[read] ?? screens.at(-1) ?? []
        read += 1
        return okResponse({ terminal: { lines } })
      }
      return okResponse({})
    })
  }
  return { client, calls, methods: () => calls.map((call) => call.method) }
}

async function run(fake: ReturnType<typeof fakeClient>, command = COMMAND) {
  const pending = runMacHostCommand({ client: fake.client, worktreeId: 'wt-1', command })
  await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_TIMEOUT_MS + THROWAWAY_TERMINAL_POLL_MS)
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('running a Mac control on the host', () => {
  it('opens a throwaway terminal in that worktree without stealing the desktop', async () => {
    const fake = fakeClient([[COMMAND, 'CUIDONE ok']])
    expect(await run(fake)).toEqual({ ok: true })
    expect(fake.calls[0]).toEqual({
      method: 'session.tabs.createTerminal',
      params: {
        worktree: 'id:wt-1',
        command: COMMAND,
        activate: false,
        select: false,
        navigation: 'caller'
      }
    })
  })

  it('closes the tab as soon as the shell says it is done, so no Terminal N is left on the desktop', async () => {
    // 2026-09-13: five dead "Terminal N" tabs stood in the desktop strip after a
    // few Mac controls. The old `; exit` killed the shell, and the desktop keeps an
    // exited terminal as a tab the phone can no longer close.
    const fake = fakeClient([['starting'], [COMMAND, 'CUIDONE ok']])
    await run(fake)
    expect(fake.methods()).toEqual([
      'session.tabs.createTerminal',
      'terminal.read',
      'terminal.read',
      'session.tabs.close'
    ])
    expect(fake.calls.at(-1)?.params).toEqual({ worktree: 'id:wt-1', tabId: 'tab-9', reason: 'user' })
  })

  it("does not take the command's own echo for the done marker", async () => {
    const fake = fakeClient([[COMMAND]])
    await run(fake)
    // Polled to the timeout — the echoed `CUIDONE %s` never counted as done.
    expect(fake.methods().filter((method) => method === 'terminal.read').length).toBeGreaterThan(20)
    expect(fake.calls.at(-1)?.method).toBe('session.tabs.close')
  })

  it('says so when the shell never reports done, instead of claiming success', async () => {
    // 2026-09-14 review: the marker was read and thrown away, so a wrong unlock
    // password looked exactly like a success and both outcomes ended in silence.
    const fake = fakeClient([['nothing']])
    const outcome = await run(fake)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toMatch(/did not finish/i)
    expect(fake.calls.at(-1)?.method).toBe('session.tabs.close')
  })

  it('reports a refused host without echoing the command back', async () => {
    const fake = fakeClient([], {
      'session.tabs.createTerminal': {
        id: '1',
        ok: false,
        error: { code: 'boom', message: 'worktree not found' },
        _meta: { runtimeId: 'r' }
      }
    })
    const outcome = await run(fake, SECRET)
    expect(outcome).toEqual({ ok: false, reason: 'worktree not found' })
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

  it('reports a host that opened no terminal rather than calling it sent', async () => {
    const fake = fakeClient([], { 'session.tabs.createTerminal': okResponse({}) })
    expect((await run(fake)).ok).toBe(false)
    expect(fake.calls).toHaveLength(1)
  })

  it('never shows the host\'s own words about a command that carries the password', async () => {
    const fake = fakeClient([], {
      'session.tabs.createTerminal': {
        id: '1',
        ok: false,
        error: { code: 'boom', message: `rejected: ${SECRET}` },
        _meta: { runtimeId: 'r' }
      }
    })
    const pending = runMacHostCommand({
      client: fake.client,
      worktreeId: 'wt-1',
      command: SECRET,
      secret: true
    })
    await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_TIMEOUT_MS)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('hunter2')
  })

  it('closes a terminal the host opened without a usable tab id', async () => {
    // Otherwise it stands on the desktop forever — and for unlock its
    // scrollback holds the password.
    const fake = fakeClient([['nothing']], {
      'session.tabs.createTerminal': okResponse({ tab: { terminal: 'term-9' } })
    })
    await run(fake)
    expect(fake.methods()).toContain('terminal.close')
  })
})
