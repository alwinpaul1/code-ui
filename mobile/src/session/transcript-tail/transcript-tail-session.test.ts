import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRANSCRIPT_TAIL_CLOSE_GRACE_MS,
  TRANSCRIPT_TAIL_POLL_MS,
  acquireTranscriptTail,
  resetTranscriptTailsForTests,
  transcriptTailEntryCountForTests
} from './transcript-tail-session'
import {
  closeStrayTranscriptTailTerminal,
  ownedTranscriptTailHandles,
  ownsTranscriptTailTerminal
} from './transcript-tail-ownership'
import { TRANSCRIPT_TAIL_TAB_TITLE } from './transcript-tail-command'

const ROWS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/claude-2.1.277-transcript-rows.json', import.meta.url)),
    'utf8'
  )
) as Record<string, string>

type Call = { method: string; params: Record<string, unknown> }

/** The host as it answered on 2026-09-19 (Orca 1.4.205): `terminal.create`
 *  gives `{ terminal: { handle, tabId } }`, `terminal.read` gives the rows past
 *  the cursor with string cursors. `offline` makes every request REJECT the
 *  way the transport does with no socket; `refuseReads` makes the host ANSWER
 *  a read with a refusal, the way it does for a terminal that is gone. */
function fakeHost(
  options: {
    refuseCreate?: boolean
    refuseReads?: () => boolean
    offline?: () => boolean
    oldestCursor?: () => number | null
  } = {}
) {
  const calls: Call[] = []
  const stream: string[] = []
  let created = 0
  const client = {
    sendRequest: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (options.offline?.()) {
        throw new Error('Not connected')
      }
      calls.push({ method, params })
      if (method === 'terminal.create') {
        if (options.refuseCreate) {
          return { ok: false, error: { code: 'forbidden', message: 'no' } }
        }
        created += 1
        return { ok: true, result: { terminal: { handle: `term_${created}`, tabId: `tab_${created}` } } }
      }
      if (method === 'terminal.read') {
        if (options.refuseReads?.()) {
          return { ok: false, error: { code: 'runtime_error', message: 'unknown terminal' } }
        }
        const cursor = Number(params.cursor ?? 0)
        const oldest = options.oldestCursor?.() ?? 0
        const rows = stream.slice(Math.max(cursor, oldest))
        return {
          ok: true,
          result: {
            terminal: {
              tail: rows,
              nextCursor: String(stream.length),
              oldestCursor: String(oldest),
              latestCursor: String(stream.length),
              source: 'stream'
            }
          }
        }
      }
      if (method === 'terminal.closeTab' || method === 'terminal.rename') {
        return { ok: true, result: {} }
      }
      return { ok: false, error: { code: 'method_not_found', message: method } }
    })
  }
  return {
    client: client as never,
    calls,
    write: (...rows: string[]) => {
      stream.push(...rows)
    },
    created: () => created,
    closes: () => calls.filter((call) => call.method === 'terminal.closeTab').map((c) => c.params.terminal)
  }
}

const TARGET = {
  hostId: 'host-1',
  worktreeId: 'wt-1',
  file: { kind: 'path' as const, transcriptPath: '/Users/me/.claude/projects/-p/abc.jsonl' },
  platform: 'posix' as const
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  resetTranscriptTailsForTests()
  vi.useRealTimers()
})

describe('the transcript tail terminal', () => {
  it('opens one background terminal running the tail, named so the phone can hide it', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    const create = host.calls.find((call) => call.method === 'terminal.create')
    expect(create?.params).toMatchObject({
      worktree: 'id:wt-1',
      title: TRANSCRIPT_TAIL_TAB_TITLE,
      activate: false,
      focus: false
    })
    expect(create?.params.command).toContain("tail -n 60 -F '/Users/me/.claude/projects/-p/abc.jsonl'")
    // Named again once it exists: the host adopts it under a default name.
    expect(host.calls.find((call) => call.method === 'terminal.rename')?.params).toEqual({
      terminal: 'term_1',
      title: TRANSCRIPT_TAIL_TAB_TITLE
    })
    expect([...ownedTranscriptTailHandles()]).toEqual(['term_1'])
    lease.release()
  })

  it('turns rows the host streams into prompts, queue and the live call', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    const seen = vi.fn()
    lease.subscribe(seen)
    await vi.advanceTimersByTimeAsync(0)
    host.write(ROWS.queueEnqueue!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS)
    expect(lease.getState().queue).toEqual(['Use jev plugin and dig deeper into code'])
    host.write(ROWS.queueRemove!, ROWS.queuedCommandText!, ROWS.assistantToolUse!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS)
    const state = lease.getState()
    expect(state.queue).toEqual([])
    expect(state.prompts.map((prompt) => prompt.text)).toEqual([
      'Use jev plugin and dig deeper into code'
    ])
    expect(state.liveCall?.name).toBe('Bash')
    host.write(ROWS.userToolResult!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS)
    expect(lease.getState().liveCall).toBeNull()
    expect(seen).toHaveBeenCalled()
    lease.release()
  })

  it('reads from the cursor the host handed back, never re-reading rows', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    host.write(ROWS.queueEnqueue!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 3)
    const reads = host.calls.filter((call) => call.method === 'terminal.read')
    expect(reads.length).toBeGreaterThanOrEqual(3)
    expect(reads.at(-1)?.params.cursor).toBe(1)
    // The one enqueue was applied once, not once per poll.
    expect(lease.getState().queue).toEqual(['Use jev plugin and dig deeper into code'])
    lease.release()
  })

  it('is shared by every reader of the same transcript and closed after the last lets go', async () => {
    const host = fakeHost()
    const first = acquireTranscriptTail(host.client, TARGET)
    const second = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    expect(host.created()).toBe(1)
    first.release()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS + 1)
    expect(host.calls.some((call) => call.method === 'terminal.closeTab')).toBe(false)
    second.release()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS + 1)
    expect(host.calls.find((call) => call.method === 'terminal.closeTab')?.params).toEqual({
      terminal: 'term_1'
    })
    expect(transcriptTailEntryCountForTests()).toBe(0)
  })

  it('survives a quick switch away and back without a second terminal', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    lease.release()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS / 2)
    const again = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS)
    expect(host.created()).toBe(1)
    expect(host.calls.some((call) => call.method === 'terminal.closeTab')).toBe(false)
    again.release()
  })

  it('keeps the chat working when the host refuses the terminal', async () => {
    const host = fakeHost({ refuseCreate: true })
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 5)
    expect(lease.getState().prompts).toEqual([])
    // One refusal, not one per poll.
    expect(host.calls.filter((call) => call.method === 'terminal.create')).toHaveLength(1)
    lease.release()
  })

  it('reopens the terminal, closing the old one, after the host keeps refusing reads', async () => {
    let refusing = false
    const host = fakeHost({ refuseReads: () => refusing })
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    expect(host.created()).toBe(1)
    refusing = true
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 6)
    refusing = false
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 2)
    expect(host.created()).toBe(2)
    expect(host.closes()).toEqual(['term_1'])
    lease.release()
  })

  it('a network drop leaves the terminal alone and picks up on the same handle', async () => {
    // Review 2026-09-19: a rejected request was counted as "terminal gone",
    // so every background/foreground cycle orphaned a live tail on the desktop.
    let offline = false
    const host = fakeHost({ offline: () => offline })
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    offline = true
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 8)
    offline = false
    host.write(ROWS.queueEnqueue!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 2)
    expect(host.created()).toBe(1)
    expect(host.closes()).toEqual([])
    expect(lease.getState().queue).toHaveLength(1)
    lease.release()
  })

  it('a close that could not be delivered lands with the next connected lease', async () => {
    let offline = false
    const host = fakeHost({ offline: () => offline })
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    offline = true
    lease.release()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS + 1)
    expect(host.closes()).toEqual([])
    offline = false
    const again = acquireTranscriptTail(host.client, {
      ...TARGET,
      file: { kind: 'path', transcriptPath: '/other.jsonl' }
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(host.closes()).toEqual(['term_1'])
    again.release()
  })

  it('starts its state over with a fresh terminal, so a replayed backlog is not applied twice', async () => {
    let refusing = false
    const host = fakeHost({ refuseReads: () => refusing })
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    host.write(ROWS.queueEnqueue!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS)
    expect(lease.getState().queue).toHaveLength(1)
    refusing = true
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 6)
    refusing = false
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 3)
    expect(host.created()).toBe(2)
    expect(lease.getState().queue).toHaveLength(1)
    lease.release()
  })

  it('forgets the queue and the live call when the host dropped rows between reads', async () => {
    let oldest = 0
    const host = fakeHost({ oldestCursor: () => oldest })
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(0)
    host.write(ROWS.queueEnqueue!, ROWS.assistantToolUse!)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS)
    expect(lease.getState().queue).toHaveLength(1)
    expect(lease.getState().liveCall).not.toBeNull()
    // The remove and the tool_result fell out of the window before the next read.
    host.write(ROWS.queueRemove!, ROWS.userToolResult!, ROWS.hookSuccess!)
    oldest = 5
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS)
    expect(lease.getState().queue).toEqual([])
    expect(lease.getState().liveCall).toBeNull()
    lease.release()
  })

  it('stops polling while nobody reads, and resumes on the next lease', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 2)
    lease.release()
    const before = host.calls.filter((call) => call.method === 'terminal.read').length
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS / 2)
    expect(host.calls.filter((call) => call.method === 'terminal.read')).toHaveLength(before)
    const again = acquireTranscriptTail(host.client, TARGET)
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_POLL_MS * 2)
    expect(host.calls.filter((call) => call.method === 'terminal.read').length).toBeGreaterThan(before)
    again.release()
  })

  it('closes a tail terminal an earlier process left behind, never its own', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    // While the create is in flight every tail terminal may be ours.
    expect(ownsTranscriptTailTerminal('term_1')).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(ownsTranscriptTailTerminal('term_1')).toBe(true)
    closeStrayTranscriptTailTerminal(host.client, TARGET.hostId, 'term_1')
    closeStrayTranscriptTailTerminal(host.client, TARGET.hostId, 'term_stale')
    await vi.advanceTimersByTimeAsync(0)
    expect(host.closes()).toEqual(['term_stale'])
    lease.release()
  })

  it('closes a terminal that was still being created when the reader left', async () => {
    const host = fakeHost()
    const lease = acquireTranscriptTail(host.client, TARGET)
    lease.release()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_CLOSE_GRACE_MS + 1)
    expect(host.calls.find((call) => call.method === 'terminal.closeTab')?.params).toEqual({
      terminal: 'term_1'
    })
  })
})
