import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAC_HOST_COMMAND_TIMEOUT_MS, runMacHostCommand } from './run-mac-host-command'
import { THROWAWAY_TERMINAL_POLL_MS, THROWAWAY_TERMINAL_SECRET_POLL_MS } from './throwaway-terminal'

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

async function run(fake: ReturnType<typeof fakeClient>, command = COMMAND, options: { secret?: boolean } = {}) {
  const pending = runMacHostCommand({ client: fake.client, worktreeId: 'wt-1', command, ...options })
  // The slower of the two paces, so a watch on either has finished.
  await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_TIMEOUT_MS + THROWAWAY_TERMINAL_SECRET_POLL_MS)
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

  // Review, 2026-09-26: every screen read returns the unlock's command line, and that
  // line is the password. The faster poll the state check got would have sent it
  // across the relay two and a half times as often; an unlock keeps its old pace.
  it('reads an unlock screen, which shows the password, no more often than before', async () => {
    const secret = fakeClient([['still typing']])
    await run(secret, SECRET, { secret: true })
    const plain = fakeClient([['still working']])
    await run(plain)
    const reads = (fake: ReturnType<typeof fakeClient>) =>
      fake.methods().filter((method) => method === 'terminal.read').length
    // 400 ms was the pace before 2026-09-26.
    expect(reads(secret)).toBeLessThanOrEqual(MAC_HOST_COMMAND_TIMEOUT_MS / 400)
    expect(reads(plain)).toBeGreaterThan(MAC_HOST_COMMAND_TIMEOUT_MS / 400)
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
    expect(fake.methods()).toContain('terminal.closeTab')
  })

  // Review, 2026-09-26: Unlock types the password into whatever is in front on the
  // Mac. The command now checks the screen is locked first and types nothing if it
  // is not, and the phone must say which of the two happened.
  it("says the Mac isn't locked and nothing was typed, as soon as the unlock says so", async () => {
    const fake = fakeClient([[SECRET, 'CUIREFUSED unlocked']])
    expect(await run(fake, SECRET, { secret: true })).toEqual({
      ok: false,
      reason: "The Mac isn't locked, so nothing was typed."
    })
    expect(fake.methods()).toEqual(['session.tabs.createTerminal', 'terminal.read', 'session.tabs.close'])
  })

  it("says it couldn't confirm the Mac is locked and nothing was typed, when the check could not tell", async () => {
    const fake = fakeClient([[SECRET, 'CUIREFUSED unconfirmed']])
    expect(await run(fake, SECRET, { secret: true })).toEqual({
      ok: false,
      reason: "Couldn't confirm the Mac is locked, so nothing was typed."
    })
    expect(fake.calls.at(-1)?.method).toBe('session.tabs.close')
  })

  // 2026-10-10, Danny: on a Modern Standby PC the display goes off only once a
  // keeper holds the PC awake. When the keeper never said it was holding, the
  // script refuses, and the toast must say why, not "did not finish".
  it('says it could not keep the PC awake and left the display on, when the Windows script refuses for that', async () => {
    const fake = fakeClient([['PS C:\\>', 'CUIREFUSED keepawake']])
    expect(await run(fake)).toEqual({
      ok: false,
      reason: "Couldn't keep this PC awake with its display off, so the display was left on."
    })
  })

  it("does not take the unlock's own echo of its refusal for a refusal", async () => {
    const fake = fakeClient([[`${SECRET} (unlocked) printf 'CUIREFUSED %s\\n' unlocked ;;`]])
    const outcome = await run(fake, SECRET, { secret: true })
    expect(outcome.ok === false && outcome.reason).toMatch(/did not finish/i)
  })

  // A request sent while the link is down parks and goes out on the next socket
  // (rpc-client-connect-wait-replay.test.ts), and the direct client's wait has no
  // end. An unlock parked that way would type the password whenever the phone next
  // reached the Mac, minutes or hours after the tap.
  it('never leaves an unlock waiting to be delivered on a later connection', async () => {
    let connected = false
    const parked: (() => void)[] = []
    const delivered: string[] = []
    const client = {
      sendRequest: vi.fn(async (method: string, _params?: unknown, options?: { failWhenDisconnected?: boolean }) => {
        if (!connected) {
          if (options?.failWhenDisconnected) {
            throw new Error(`Not connected: ${method}`)
          }
          await new Promise<void>((resolve) => parked.push(resolve))
        }
        delivered.push(method)
        return method === 'session.tabs.createTerminal'
          ? okResponse({ tab: { id: 'tab-9', type: 'terminal', terminal: 'term-9' } })
          : okResponse({ terminal: { lines: ['CUIDONE ok'] } })
      })
    }
    let outcome: unknown = null
    void runMacHostCommand({ client, worktreeId: 'wt-1', command: SECRET, secret: true }).then((value) => {
      outcome = value
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toEqual({ ok: false, reason: 'The Mac did not answer.' })
    connected = true
    parked.forEach((resume) => resume())
    await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_TIMEOUT_MS + THROWAWAY_TERMINAL_SECRET_POLL_MS)
    expect(delivered).not.toContain('session.tabs.createTerminal')
  })

  // 2026-09-23, from the phone: Wake display on a Windows host that did not
  // answer said "The Mac did not answer."
  it('names the PC, not the Mac, in every failure a Windows host can cause', async () => {
    const silent = {
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    }
    const refused = fakeClient([], {
      'session.tabs.createTerminal': { id: '1', ok: false, error: { code: 'x', message: '' }, _meta: { runtimeId: 'r' } }
    })
    const unfinished = fakeClient([['PS C:\\>']])
    const pending = [silent, refused.client, unfinished.client].map((client) =>
      runMacHostCommand({ client, worktreeId: 'wt-1', command: COMMAND, hostNoun: 'PC' })
    )
    await vi.advanceTimersByTimeAsync(MAC_HOST_COMMAND_TIMEOUT_MS + THROWAWAY_TERMINAL_POLL_MS)
    const outcomes = await Promise.all(pending)
    expect(outcomes).toEqual([
      { ok: false, reason: 'The PC did not answer.' },
      { ok: false, reason: 'The PC refused the command.' },
      { ok: false, reason: 'The PC did not finish that. Check the desktop.' }
    ])
  })
})
