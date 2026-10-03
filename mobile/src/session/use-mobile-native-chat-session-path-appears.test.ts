import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { pathRelation } from './mobile-native-chat-subscribe-identity'
import { useMobileNativeChatSession, type MobileNativeChatSession } from './use-mobile-native-chat-session'

// Reported 2026-10-03 (Code UI 0.9.113, Claude Code 2.1.288, Orca 1.4.219): a Claude tab resumed from
// the phone's history showed its whole conversation in the terminal, then the chat went blank, or kept
// only the last rows, once the first prompt was sent. Orca's SessionStart hook names the session id
// before any prompt, and the first prompt's hook adds the transcript path; the chat keyed its identity
// by that path, so the same conversation looked like a new one. Fixtures are synthetic. The host stand-in
// answers like Orca's `nativeChat.subscribe` (src/shared has no reader; app.asar 1.4.219): the tail of ONE
// file, `limit` rows.

const SESSION = 'cccccccc-0000-4000-8000-000000000003'
const OTHER_SESSION = 'dddddddd-0000-4000-8000-000000000004'
const PATH = `/home/someone/.claude/projects/-work-gloria/${SESSION}.jsonl`
const OTHER_PATH = `/home/someone/.claude/projects/-work-elsewhere/${SESSION}.jsonl`

function row(index: number): NativeChatMessage {
  return {
    id: `r${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    blocks: [{ type: 'text', text: `row ${index}` }],
    timestamp: index,
    source: 'transcript'
  }
}
const rows = (count: number): NativeChatMessage[] => Array.from({ length: count }, (_unused, index) => row(index))

type Props = { agent?: string; sessionId?: string | null; transcriptPath: string | null }
type Sub = { params: { limit: number; transcriptPath?: string; sessionId: string }; emit: (frame: unknown) => void }

describe('useMobileNativeChatSession: the transcript path appears for a resumed session', () => {
  let renderer: ReactTestRenderer | null = null
  let state: MobileNativeChatSession | null = null
  let subs: Sub[] = []
  let warn: { mock: { calls: unknown[][] }; mockRestore: () => void }
  const sendRequest = vi.fn()
  const client = {
    sendRequest,
    subscribe: vi.fn((_method: string, params: Sub['params'], emit: Sub['emit']) => {
      subs.push({ params, emit })
      return () => {}
    })
  } as unknown as RpcClient

  beforeEach(() => {
    vi.useFakeTimers()
    state = null
    subs = []
    sendRequest.mockReset()
    resetNativeChatTranscriptCacheForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
    vi.useRealTimers()
  })

  function Harness(props: Props): null {
    state = useMobileNativeChatSession({
      client,
      sourceIdentity: 'host-a\0workspace-a',
      agent: props.agent ?? 'claude',
      sessionId: props.sessionId === undefined ? SESSION : props.sessionId,
      transcriptPath: props.transcriptPath
    })
    return null
  }
  const mount = async (props: Props) => {
    await act(async () => {
      renderer = create(createElement(Harness, props))
    })
  }
  const rerender = async (props: Props) => {
    await act(async () => renderer?.update(createElement(Harness, props)))
  }
  const answer = (index: number, file: NativeChatMessage[], extra: Record<string, unknown> = {}) =>
    act(() =>
      subs[index]!.emit({
        type: 'snapshot',
        messages: file.slice(-subs[index]!.params.limit),
        hasMore: file.length > subs[index]!.params.limit,
        beforeOffset: Math.max(0, file.length - subs[index]!.params.limit),
        ...extra
      })
    )
  const ids = () => state?.messages.map((entry) => entry.id)
  const silence = async () => act(async () => void vi.advanceTimersByTime(20_001))

  it.each(['claude', 'codex'])(
    'keeps the %s chat on screen while the first prompt names the transcript path',
    async (agent) => {
      const file = rows(30)
      await mount({ agent, transcriptPath: null })
      answer(0, file)
      expect(ids()).toHaveLength(30)

      await rerender({ agent, transcriptPath: PATH })
      // The host reads by path now: a second subscribe, and nothing blanked in between.
      expect(subs).toHaveLength(2)
      expect(subs[1]!.params.transcriptPath).toBe(PATH)
      expect(ids()).toHaveLength(30)
      expect(state?.status).toBe('ready')

      const grown = [...file, row(30)]
      answer(1, grown)
      expect(ids()).toEqual(grown.map((entry) => entry.id))
    }
  )

  it('does not shrink a resumed chat to its last rows when the path-bearing re-read is slow', async () => {
    const file = rows(30)
    await mount({ transcriptPath: null })
    answer(0, file)
    await rerender({ transcriptPath: PATH })
    await silence()
    await silence()
    // Every rung asks for at least what is already shown.
    expect(Math.min(...subs.slice(1).map((sub) => sub.params.limit))).toBeGreaterThanOrEqual(30)
    expect(ids()).toHaveLength(30)
    answer(subs.length - 1, [...file, row(30)])
    expect(ids()).toEqual([...file, row(30)].map((entry) => entry.id))
  })

  it('clears the chat for a different session id', async () => {
    await mount({ transcriptPath: PATH })
    answer(0, rows(30))
    await rerender({ sessionId: OTHER_SESSION, transcriptPath: null })
    expect(ids()).toEqual([])
    answer(1, [row(100)])
    expect(ids()).toEqual(['r100'])
  })

  it('does not present the rows of one file as another when the same id moves to a different path', async () => {
    await mount({ transcriptPath: PATH })
    answer(0, rows(30))
    await rerender({ transcriptPath: OTHER_PATH })
    expect(ids()).toEqual([])
    answer(1, [row(100)])
    expect(ids()).toEqual(['r100'])
  })

  it('keeps reading the same file when the status stops naming the path', async () => {
    await mount({ transcriptPath: PATH })
    answer(0, rows(30))
    await rerender({ transcriptPath: null })
    expect(subs).toHaveLength(1)
    expect(ids()).toHaveLength(30)
  })

  it('still pages back after a ladder rung of 4 when the host leaves hasMore out', async () => {
    await mount({ transcriptPath: PATH })
    await silence()
    await silence()
    const last = subs.length - 1
    expect(subs[last]!.params.limit).toBe(4)
    act(() => subs[last]!.emit({ type: 'snapshot', messages: rows(30).slice(-4), beforeOffset: 900 }))
    expect(ids()).toEqual(['r26', 'r27', 'r28', 'r29'])
    expect(state?.hasMore).toBe(true)
    sendRequest.mockResolvedValue({
      ok: true,
      result: { messages: rows(30).slice(-64, -4), hasMore: false, beforeOffset: 0 }
    })
    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'nativeChat.readSession',
      expect.objectContaining({ beforeOffset: 900 })
    )
    expect(ids()).toHaveLength(30)
  })

  const page = async (messages: NativeChatMessage[], extra: Record<string, unknown>) => {
    sendRequest.mockResolvedValueOnce({ ok: true, result: { messages, ...extra } })
    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  describe('rows paged back before the path re-read', () => {
    it('keeps every row after the first live append when the user had paged back to 160', async () => {
      const file = rows(300)
      await mount({ transcriptPath: null })
      answer(0, file)
      await page(file.slice(200, 260), { hasMore: true, beforeOffset: 200 })
      await page(file.slice(140, 200), { hasMore: true, beforeOffset: 140 })
      expect(ids()).toHaveLength(160)
      await rerender({ transcriptPath: PATH })
      answer(1, [...file, row(300)])
      expect(ids()).toHaveLength(200)
      act(() => subs[1]!.emit({ type: 'appended', messages: [row(301)] }))
      expect(ids()).toHaveLength(200)
      expect(ids()?.[0]).toBe('r102')
    })

    it('does not shrink on load earlier from a host that sends no beforeOffset', async () => {
      const file = rows(300)
      await mount({ transcriptPath: null })
      act(() => subs[0]!.emit({ type: 'snapshot', messages: file.slice(-40), hasMore: true }))
      await page(file.slice(-100), { hasMore: true })
      await page(file.slice(-160), { hasMore: true })
      await rerender({ transcriptPath: PATH })
      act(() => subs[1]!.emit({ type: 'snapshot', messages: file.slice(-200), hasMore: true }))
      expect(ids()).toHaveLength(200)
      sendRequest.mockImplementationOnce(async (_method: string, params: { limit: number }) => ({
        ok: true,
        result: { messages: file.slice(-params.limit), hasMore: true }
      }))
      await act(async () => {
        state?.loadEarlier()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(ids()!.length).toBeGreaterThanOrEqual(200)
    })

    it('judges a later replacement without hasMore against the usual window, not the re-read one', async () => {
      await mount({ transcriptPath: null })
      answer(0, rows(160)) // the first window is 40 rows, so the re-read asks for 80
      await rerender({ transcriptPath: PATH })
      expect(subs[1]!.params.limit).toBe(80)
      answer(1, rows(160))
      act(() => subs[1]!.emit({ type: 'replacement', messages: rows(60), beforeOffset: 0 }))
      expect(state?.hasMore).toBe(true)
    })
  })

  describe('rows kept for one file are never shown as another file\'s', () => {
    it('shows nothing of file P for the same session read at P2 after a trip through the terminal', async () => {
      await mount({ transcriptPath: PATH })
      answer(0, rows(30))
      await rerender({ agent: null as unknown as string, sessionId: null, transcriptPath: null })
      await rerender({ transcriptPath: OTHER_PATH })
      expect(ids()).toEqual([])
      act(() => subs.at(-1)!.emit({ type: 'snapshot', messages: [], hasMore: false }))
      expect(ids()).toEqual([])
    })

    it('still keeps the rows when only the path appears and the path-bearing read comes back empty', async () => {
      await mount({ transcriptPath: null })
      answer(0, rows(30))
      await rerender({ transcriptPath: PATH })
      act(() => subs[1]!.emit({ type: 'snapshot', messages: [], hasMore: false }))
      expect(ids()).toHaveLength(30)
    })

    it('still clears for the same path after a trip through the terminal only when the session differs', async () => {
      await mount({ transcriptPath: PATH })
      answer(0, rows(30))
      await rerender({ agent: null as unknown as string, sessionId: null, transcriptPath: null })
      await rerender({ transcriptPath: PATH })
      expect(subs.at(-1)!.params.transcriptPath).toBe(PATH)
      answer(subs.length - 1, rows(30))
      expect(ids()).toHaveLength(30)
    })
  })

  describe('degenerate transcripts', () => {
    it.each(['claude', 'codex'])('an empty %s transcript stays empty and ready when the path appears', async (agent) => {
      await mount({ agent, transcriptPath: null })
      answer(0, [])
      await rerender({ agent, transcriptPath: PATH })
      expect(ids()).toEqual([])
      answer(1, [])
      expect(ids()).toEqual([])
      expect(state?.status).toBe('ready')
      act(() => subs[1]!.emit({ type: 'appended', messages: [row(0)] }))
      expect(ids()).toEqual(['r0'])
    })

    it.each(['claude', 'codex'])('a one-row %s transcript keeps its row when the path appears', async (agent) => {
      await mount({ agent, transcriptPath: null })
      answer(0, rows(1))
      await rerender({ agent, transcriptPath: PATH })
      expect(ids()).toEqual(['r0'])
      answer(1, rows(1))
      expect(ids()).toEqual(['r0'])
      expect(state?.hasMore).toBe(false)
    })
  })

  describe('the log line', () => {
    const lines = () => warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.startsWith('[native-chat] subscribe'))

    it('says why each subscribe ran, with the file name only and the first snapshot', async () => {
      await mount({ transcriptPath: null })
      answer(0, rows(30))
      await rerender({ transcriptPath: PATH })
      answer(1, rows(30))
      expect(lines()).toEqual([
        '[native-chat] subscribe session=cccccccc agent=claude path=none limit=40 reason=first snapshot rows=30 hasMore=false',
        `[native-chat] subscribe session=cccccccc agent=claude path=same limit=70 reason=path-only snapshot rows=30 hasMore=false`
      ])
      expect(lines().join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\.jsonl|\/home/)
    })

    it('names a silent host and the ladder step', async () => {
      await mount({ transcriptPath: PATH })
      await silence()
      act(() => subs[1]!.emit({ type: 'snapshot', messages: [], hasMore: false, pending: true }))
      expect(lines()).toEqual([
        `[native-chat] subscribe session=cccccccc agent=claude path=same limit=40 reason=first snapshot=none after 20s`,
        `[native-chat] subscribe session=cccccccc agent=claude path=same limit=12 reason=ladder snapshot rows=0 hasMore=false pending=true`
      ])
    })

    it('says a moved path and a new session', async () => {
      await mount({ transcriptPath: PATH })
      answer(0, rows(2))
      await rerender({ transcriptPath: OTHER_PATH })
      answer(1, rows(2))
      await rerender({ sessionId: OTHER_SESSION, transcriptPath: null })
      answer(2, rows(2))
      expect(lines().map((line: string) => /reason=(\S+)/.exec(line)?.[1])).toEqual(['first', 'path-moved', 'new-session'])
      expect(lines()[1]).toContain('path=same')
      expect(pathRelation(`/x/${OTHER_SESSION}.jsonl`, SESSION)).toBe('other')
      expect(pathRelation('C:\\p\\rollout-2026-10-03T01-02-03-' + SESSION + '.jsonl', SESSION)).toBe('same')
    })

    it('gives an agent or host change its own reason, not path-moved', async () => {
      await mount({ transcriptPath: PATH })
      answer(0, rows(2))
      await rerender({ agent: 'codex', transcriptPath: PATH })
      answer(1, rows(2))
      expect(lines().map((line: string) => /reason=(\S+)/.exec(line)?.[1])).toEqual(['first', 'new-source'])
    })
  })
})

describe('the transcript path pin is derived while rendering, never written there', () => {
  it('holds no ref write outside an effect or callback in the hook source', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(import.meta.dirname, 'use-mobile-native-chat-session.ts'), 'utf8')
    let depth = 0
    const renderWrites: string[] = []
    for (const raw of source.split('\n')) {
      const line = raw.trim()
      if (depth <= 1 && /^\w*[Pp]in\w*Ref\.current\s*=[^=]/.test(line)) {
        renderWrites.push(line)
      }
      for (const char of raw) {
        depth += char === '{' ? 1 : char === '}' ? -1 : 0
      }
    }
    expect(renderWrites).toEqual([])
    expect(source).not.toMatch(/pathPinRef/)
  })
})
