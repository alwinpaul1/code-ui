import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { collectHostImagePaths, loadHostImage, resetHostImagePreviewCacheForTests, useHostImagePreviews } from './use-host-image-previews'
import { showAgentImage } from './agent-image-visibility'
import { RETRY_MS } from './host-image-refusals'
import { SEND_CALL_ID, SEND_FILE_PATH, SEND_FILE_TURN } from './fixtures/claude-send-user-file-2.1.296'

// Thumbnails took a long time to appear (the user, 2026-10-11). For a
// scratchpad file the desktop shares the path only once the agent's TEXT
// names it (Orca 1.4.224's rule 1), and that text lands after the
// SendUserFile row. The first ask is refused, and the refusal held a 5 s
// cooldown: the text arrived, the hook asked again at once, and the cooldown
// answered for the desktop. The picture waited for the retry timer, or, once
// the hook's three tries were spent, for the next new row.

const READ_OR_SEND = SEND_FILE_TURN.filter((message) => message.id !== '6197b2c5-cc14-42c7-809e-adcbc21d0af6')
const NAMING_REPLY: NativeChatMessage = {
  id: '6197b2c5-cc14-42c7-809e-adcbc21d0af6',
  role: 'assistant',
  timestamp: Date.parse('2026-10-11T14:28:33.544Z'),
  source: 'transcript',
  blocks: [{ type: 'text', text: `I've sent you ${SEND_FILE_PATH}.` }]
}

/** The desktop's rule 1, as the phone sees it: it shares the path once the
 *  transcript holds assistant text naming it. */
function desktop(named: () => boolean) {
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'files.resolveTerminalPath') {
      return named()
        ? { ok: true, result: { openTarget: { kind: 'absolute-file', absolutePath: SEND_FILE_PATH, grantId: 'grant' } } }
        : { ok: true, result: {} }
    }
    return { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: 'iVBORw0K' } }
  })
  return { sendRequest } as unknown as RpcClient & { sendRequest: typeof sendRequest }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a picture the desktop shares once the agent names it', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetHostImagePreviewCacheForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function mount(client: RpcClient, messages: NativeChatMessage[], out: { previews: Record<string, string[]> }) {
    const terminalHandleRef = { current: 'term' }
    const local = {}
    // No view here: the pictures' slots are taken as on screen, which is
    // when the hook asks for them (agent-image-visibility.ts).
    for (const path of Object.values(collectHostImagePaths(messages, undefined)).flat()) {
      showAgentImage(path)
    }
    function Probe({ rows }: { rows: NativeChatMessage[] }) {
      out.previews = useHostImagePreviews({
        client,
        enabled: true,
        hostId: 'host',
        worktreeId: 'worktree',
        nativeChatContext: { tabId: 'tab', sessionId: 'session' },
        terminalHandleRef,
        messages: rows,
        localPreviews: local
      })
      return null
    }
    renderer = create(createElement(Probe, { rows: messages }))
    return (rows: NativeChatMessage[]) => renderer!.update(createElement(Probe, { rows }))
  }

  it('is asked for again the moment the reply naming its path lands, not after a cooldown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let named = false
    const client = desktop(() => named)
    const out = { previews: {} as Record<string, string[]> }
    let update: (rows: NativeChatMessage[]) => void = () => undefined
    await act(async () => {
      update = mount(client, READ_OR_SEND, out)
      await settle()
    })
    expect(out.previews[SEND_CALL_ID]).toEqual([''])
    // The reply lands well inside the 5 s cooldown the refusal set.
    named = true
    await act(async () => {
      update([...READ_OR_SEND, NAMING_REPLY])
      await settle()
    })
    expect(out.previews[SEND_CALL_ID]).toEqual(['data:image/png;base64,iVBORw0K'])
  })

  it('is asked for again when the reply lands while the refused ask is still on its way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let answerFirst: (value: unknown) => void = () => undefined
    const sendRequest = vi.fn((method: string) => {
      if (method !== 'files.resolveTerminalPath') {
        return Promise.resolve({ ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: 'iVBORw0K' } })
      }
      if (sendRequest.mock.calls.filter((call) => call[0] === method).length === 1) {
        // The first ask, sent before the text named the path: refused, late.
        return new Promise((resolve) => {
          answerFirst = resolve
        })
      }
      return Promise.resolve({ ok: true, result: { openTarget: { kind: 'absolute-file', absolutePath: SEND_FILE_PATH, grantId: 'grant' } } })
    })
    const client = { sendRequest } as unknown as RpcClient
    const args = { client, hostId: 'host', worktreeId: 'worktree', nativeChatContext: { tabId: 'tab', sessionId: 'session' }, terminalHandle: 'term', path: SEND_FILE_PATH, files: null }
    const first = loadHostImage({ ...args, agentTextNamesPath: false })
    const second = loadHostImage({ ...args, agentTextNamesPath: true })
    answerFirst({ ok: true, result: {} })
    expect(await first).toBeNull()
    expect(await second).toBe('data:image/png;base64,iVBORw0K')
  })

  // The other half of the wait: every new row re-ran the hook over EVERY
  // picture of the session, and each refused one was asked again whenever
  // its 5 s had run out. A long session holds dozens of scratchpad reads the
  // desktop will never share (63 images in session 0954729d), so each new row
  // sent dozens of asks down the relay ahead of the one picture that could
  // load. A refusal now waits longer each time, until the evidence changes.
  it('backs off a path the desktop keeps refusing, instead of asking every 5 s for as long as the chat runs', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client = desktop(() => false)
    const args = { client, hostId: 'host', worktreeId: 'worktree', nativeChatContext: { tabId: 'tab', sessionId: 'session' }, terminalHandle: 'term', path: SEND_FILE_PATH, files: null, agentTextNamesPath: false }
    for (let second = 0; second < 60; second += 1) {
      await loadHostImage(args)
      await vi.advanceTimersByTimeAsync(1000)
    }
    const asks = client.sendRequest.mock.calls.filter((call) => call[0] === 'files.resolveTerminalPath').length
    expect(asks).toBeLessThanOrEqual(5)
    vi.useRealTimers()
  })

  // Opus review of the ask (2026-10-13): an earlier mention the desktop's rule
  // rejects (a markdown link, parentheses) counts as "named" loosely, so the
  // refusals backed off as named ones, and the reply to the phone's ask that
  // names the path in backticks waited minutes behind them.
  it('is asked for again at once when a clean reply follows a loose mention the desktop refused', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let clean = false
    const client = desktop(() => clean)
    const args = { client, hostId: 'host', worktreeId: 'worktree', nativeChatContext: { tabId: 'tab', sessionId: 'session' }, terminalHandle: 'term', path: SEND_FILE_PATH, files: null, agentTextNamesPath: true }
    for (let tries = 0; tries < 5; tries += 1) {
      await vi.advanceTimersByTimeAsync(tries === 0 ? 0 : RETRY_MS * 2 ** (tries - 1))
      await loadHostImage({ ...args, agentTextNamesPathCleanly: false })
    }
    // The fifth refusal holds the path for 80 s; the clean reply lands now.
    await vi.advanceTimersByTimeAsync(1000)
    clean = true
    expect(await loadHostImage({ ...args, agentTextNamesPathCleanly: true })).toBe('data:image/png;base64,iVBORw0K')
    vi.useRealTimers()
  })

  it('keeps asking every 5 s while the ask itself fails (the relay, not the path)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sendRequest = vi.fn(async () => {
      throw new Error('relay closed')
    })
    const client = { sendRequest } as unknown as RpcClient
    const args = { client, hostId: 'host', worktreeId: 'worktree', nativeChatContext: null, terminalHandle: 'term', path: SEND_FILE_PATH, files: null, agentTextNamesPath: false }
    for (let second = 0; second < 30; second += 1) {
      await loadHostImage(args)
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(sendRequest.mock.calls.length).toBe(6)
  })

  it('is not asked for again once it has loaded, however often the chat redraws', async () => {
    const client = desktop(() => true)
    const out = { previews: {} as Record<string, string[]> }
    let update: (rows: NativeChatMessage[]) => void = () => undefined
    await act(async () => {
      update = mount(client, [...READ_OR_SEND, NAMING_REPLY], out)
      await settle()
    })
    const asked = client.sendRequest.mock.calls.length
    expect(out.previews[SEND_CALL_ID]).toEqual(['data:image/png;base64,iVBORw0K'])
    for (let redraw = 0; redraw < 3; redraw += 1) {
      await act(async () => {
        update([...READ_OR_SEND, NAMING_REPLY, { ...NAMING_REPLY, id: `later-${redraw}`, blocks: [{ type: 'text', text: 'More.' }] }])
        await settle()
      })
    }
    expect(client.sendRequest.mock.calls.length).toBe(asked)
  })
})
